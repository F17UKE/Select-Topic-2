const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('./http.cjs');
const { SESSION_SECONDS, sessionExpired } = require('./session-lifetime.cjs');

const SESSION_COOKIE = 'merchant_staff_session';

function booleanValue(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ENABLE_STAFF_DEV_LOGIN must be true or false');
}

function merchantStaffAuthConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const mode = env.MERCHANT_STAFF_AUTH_MODE || (production ? 'password' : 'mock');
  if (!['mock', 'password'].includes(mode)) throw new Error('MERCHANT_STAFF_AUTH_MODE must be mock or password');
  const devLoginEnabled = booleanValue(env.ENABLE_STAFF_DEV_LOGIN, false);
  if (production && (mode === 'mock' || devLoginEnabled)) {
    throw new Error('Mock merchant staff authentication and dev login are forbidden in production');
  }
  if (devLoginEnabled && mode !== 'mock') throw new Error('ENABLE_STAFF_DEV_LOGIN requires MERCHANT_STAFF_AUTH_MODE=mock');
  return {
    mode,
    devLoginEnabled,
    defaultUsername: env.DEV_MERCHANT_STAFF_USERNAME || 'local_manager',
    secureCookie: production,
  };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); }
      catch { return null; }
    }
  }
  return null;
}

function createMerchantStaffAuth({ db, config = merchantStaffAuthConfig(), randomUUID = crypto.randomUUID, now = Date.now }) {
  const sessions = new Map();
  const attempts = new Map();
  const dummyHash = '$2b$12$8VlPofArSwOWg.7ZeDjxeOvlNfIzZHQ53hjrO40ARvU2zJpMUshwq';

  async function findStaff(username) {
    return db('merchant_staffs as s')
      .join('merchants as m', 'm.id', 's.merchant_id')
      .select('s.id', 's.merchant_id', 's.username', 's.password_hash', 's.full_name', 's.phone', 's.role', 'm.store_name')
      .whereRaw('lower(s.username) = lower(?)', [username]).where({ 's.is_active': true })
      .whereNull('s.deleted_at').whereNull('m.deleted_at').first();
  }

  function publicStaff(staff) {
    const result = { ...staff };
    delete result.password_hash;
    return result;
  }

  function rateKey(username, ip) { return `${ip || 'unknown'}:${String(username || '').toLowerCase()}`; }
  function checkRateLimit(username, ip) {
    const key = rateKey(username, ip);
    const cutoff = Date.now() - 15 * 60 * 1000;
    const recent = (attempts.get(key) || []).filter((value) => value > cutoff);
    if (recent.length >= 5) throw new HttpError(429, 'staff_login_rate_limited');
    recent.push(Date.now());
    attempts.set(key, recent);
    return key;
  }

  async function loginDevelopmentStaff(username = config.defaultUsername) {
    if (config.mode !== 'mock' || !config.devLoginEnabled) throw new HttpError(404, 'not_found');
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)) {
      throw new HttpError(400, 'invalid_staff_username');
    }
    const staff = await findStaff(username);
    if (!staff) throw new HttpError(404, 'dev_staff_missing', 'Run the local seed before using staff dev login');
    const token = randomUUID();
    sessions.set(token, { staffId: staff.id, createdAt: now() });
    return { token, staff: publicStaff(staff) };
  }

  async function loginPassword(username, password, { ip, currentToken } = {}) {
    if (config.mode !== 'password') throw new HttpError(404, 'not_found');
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)
      || typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(401, 'invalid_staff_credentials');
    }
    const key = checkRateLimit(username, ip);
    const staff = await findStaff(username);
    const valid = await bcrypt.compare(password, staff?.password_hash || dummyHash);
    if (!staff || !valid) throw new HttpError(401, 'invalid_staff_credentials');
    attempts.delete(key);
    if (currentToken) sessions.delete(currentToken);
    const token = randomUUID();
    sessions.set(token, { staffId: staff.id, createdAt: now() });
    return { token, staff: publicStaff(staff) };
  }

  async function authenticate(req) {
    const token = readCookie(req.get('cookie'), SESSION_COOKIE);
    const session = token ? sessions.get(token) : null;
    if (!session || sessionExpired(session, now())) {
      if (token) sessions.delete(token);
      throw new HttpError(401, 'staff_authentication_required');
    }
    const staff = await db('merchant_staffs as s')
      .join('merchants as m', 'm.id', 's.merchant_id')
      .select('s.id', 's.merchant_id', 's.username', 's.full_name', 's.phone', 's.role', 'm.store_name')
      .where({ 's.id': session.staffId, 's.is_active': true })
      .whereNull('s.deleted_at').whereNull('m.deleted_at').first();
    if (!staff) {
      sessions.delete(token);
      throw new HttpError(401, 'staff_authentication_required');
    }
    return { token, staff };
  }

  function logout(token) { if (token) sessions.delete(token); }
  function sessionToken(req) { return readCookie(req.get('cookie'), SESSION_COOKIE); }
  function cookie(token) {
    const secure = config.secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${secure}`;
  }
  function clearCookie() {
    const secure = config.secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  }

  function revokeStaff(id) { for(const [token,session] of sessions) if(Number(session.staffId)===Number(id)) sessions.delete(token); }
  return { revokeStaff, config, loginDevelopmentStaff, loginPassword, authenticate, logout, sessionToken, cookie, clearCookie };
}

module.exports = { merchantStaffAuthConfig, createMerchantStaffAuth };
