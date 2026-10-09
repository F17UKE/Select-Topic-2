const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('./http.cjs');

const SESSION_COOKIE = 'admin_session';
const CSRF_COOKIE = 'admin_csrf';
const SESSION_HOURS = 10;
const IDLE_MINUTES = 30;

const permissions = {
  dashboard: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE'],
  merchantsRead: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  merchantsWrite: ['SUPER_ADMIN'],
  customersRead: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  customersWrite: ['SUPER_ADMIN', 'ADMIN'],
  ordersRead: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE'],
  paymentsRead: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE'],
  deliveryAreasWrite: ['SUPER_ADMIN', 'ADMIN'],
  contentWrite: ['SUPER_ADMIN', 'ADMIN'],
  auditRead: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  adminUsersWrite: ['SUPER_ADMIN'],
  settingsWrite: ['SUPER_ADMIN'],
  systemStatusRead: ['SUPER_ADMIN', 'ADMIN'],
  reportsRead: ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
};

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}
function safeAdmin(row) {
  const admin = { ...row };
  delete admin.password_hash;
  return admin;
}

function createAdminAuth({ db, audit, secureCookie = process.env.NODE_ENV === 'production', now = Date.now }) {
  const attempts = new Map();
  const revealAttempts = new Map();
  const financeAttempts = new Map();
  const dummyHash = '$2b$12$8VlPofArSwOWg.7ZeDjxeOvlNfIzZHQ53hjrO40ARvU2zJpMUshwq';

  function rateKey(username, ip) { return `${ip || 'unknown'}:${String(username || '').toLowerCase()}`; }
  function rateLimit(username, ip) {
    const key = rateKey(username, ip);
    const cutoff = now() - 15 * 60 * 1000;
    const recent = (attempts.get(key) || []).filter((item) => item > cutoff);
    if (recent.length >= 5) throw new HttpError(429, 'admin_login_rate_limited', 'ลองใหม่ภายหลัง');
    recent.push(now());
    attempts.set(key, recent);
    return key;
  }

  async function login(username, password, context = {}) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)
      || typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(401, 'invalid_admin_credentials', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const key = rateLimit(username, context.ip);
    const admin = await db('platform_admins').whereRaw('lower(username) = lower(?)', [username])
      .where({ is_active: true }).whereNull('deleted_at').first();
    const valid = await bcrypt.compare(password, admin?.password_hash || dummyHash);
    if (!admin || !valid) throw new HttpError(401, 'invalid_admin_credentials', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    attempts.delete(key);
    const sessionToken = token();
    const csrfToken = token();
    const expiresAt = new Date(now() + SESSION_HOURS * 60 * 60 * 1000);
    await db.transaction(async (trx) => {
      if (context.currentToken) {
        await trx('platform_admin_sessions').where({ token_hash: hash(context.currentToken) })
          .whereNull('revoked_at').update({ revoked_at: trx.fn.now() });
      }
      await trx('platform_admin_sessions').insert({
        admin_id: admin.id,
        token_hash: hash(sessionToken),
        csrf_token_hash: hash(csrfToken),
        ip_address: context.ip || null,
        user_agent: String(context.userAgent || '').slice(0, 512) || null,
        expires_at: expiresAt,
      });
      await trx('platform_admins').where({ id: admin.id }).update({ last_login_at: trx.fn.now(), updated_at: trx.fn.now() });
      await audit.append({ actorId: admin.id, action: 'ADMIN_LOGIN', entityType: 'PLATFORM_ADMIN', entityId: admin.id, ip: context.ip }, trx);
    });
    return { token: sessionToken, csrfToken, admin: safeAdmin(admin) };
  }

  async function authenticate(req, { csrf = false } = {}) {
    const rawToken = readCookie(req.get('cookie'), SESSION_COOKIE);
    if (!rawToken) throw new HttpError(401, 'admin_authentication_required', 'กรุณาเข้าสู่ระบบ');
    const session = await db('platform_admin_sessions as s')
      .join('platform_admins as a', 'a.id', 's.admin_id')
      .select('s.id as session_id', 's.csrf_token_hash', 's.last_seen_at', 's.expires_at',
        'a.id', 'a.username', 'a.full_name', 'a.email', 'a.role', 'a.is_active', 'a.last_login_at')
      .where({ 's.token_hash': hash(rawToken), 'a.is_active': true })
      .whereNull('s.revoked_at').whereNull('a.deleted_at').first();
    const expired = !session || new Date(session.expires_at).getTime() <= now();
    const idle = session && new Date(session.last_seen_at).getTime() < now() - IDLE_MINUTES * 60 * 1000;
    if (expired || idle) {
      if (session) await db('platform_admin_sessions').where({ id: session.session_id }).update({ revoked_at: db.fn.now() });
      throw new HttpError(401, 'admin_authentication_required', 'Session หมดอายุ');
    }
    if (csrf) {
      const supplied = req.get('x-csrf-token');
      const cookieToken = readCookie(req.get('cookie'), CSRF_COOKIE);
      if (!supplied || !cookieToken || supplied !== cookieToken || hash(supplied) !== session.csrf_token_hash) {
        throw new HttpError(403, 'invalid_csrf_token', 'CSRF token ไม่ถูกต้อง');
      }
    }
    await db('platform_admin_sessions').where({ id: session.session_id }).update({ last_seen_at: db.fn.now() });
    delete session.csrf_token_hash;
    delete session.last_seen_at;
    delete session.expires_at;
    return { token: rawToken, admin: session };
  }

  async function reauthenticateForSecret(admin, password) {
    requirePermission(admin, 'settingsWrite');
    // Count every request, including successes, before awaiting bcrypt. Scoped to
    // the admin (not session/IP) so logging in again cannot reset the window.
    const cutoff = now() - 15 * 60 * 1000;
    for (const [id, values] of revealAttempts) {
      if (values.every((value) => value <= cutoff)) revealAttempts.delete(id);
    }
    const recent = (revealAttempts.get(admin.id) || []).filter((value) => value > cutoff);
    if (recent.length >= 5) throw new HttpError(429, 'secret_reveal_rate_limited', 'ลองใหม่ภายหลัง');
    recent.push(now()); revealAttempts.set(admin.id, recent);
    const current = await db('platform_admins').where({ id: admin.id, role: 'SUPER_ADMIN', is_active: true }).whereNull('deleted_at').first();
    const validInput = typeof password === 'string' && password.length >= 8 && password.length <= 200;
    const valid = await bcrypt.compare(validInput ? password : '', current?.password_hash || dummyHash);
    if (!current || !validInput || !valid) throw new HttpError(401, 'invalid_reauth_password', 'รหัสผ่านไม่ถูกต้อง');
  }

  async function logout(rawToken, admin, context = {}) {
    if (!rawToken) return;
    await db.transaction(async (trx) => {
      await trx('platform_admin_sessions').where({ token_hash: hash(rawToken) }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await audit.append({ actorId: admin.id, action: 'ADMIN_LOGOUT', entityType: 'PLATFORM_ADMIN', entityId: admin.id, ip: context.ip }, trx);
    });
  }

  async function reauthenticateFinance(admin, password) {
    requirePermission(admin, 'settingsWrite');
    const recent = (financeAttempts.get(admin.id) || []).filter(t => t > now() - 900000);
    if (recent.length >= 5) throw new HttpError(429, 'finance_reauth_rate_limited', 'ลองใหม่ภายหลัง');
    recent.push(now()); financeAttempts.set(admin.id, recent);
    const current = await db('platform_admins').where({ id: admin.id, role: 'SUPER_ADMIN', is_active: true }).whereNull('deleted_at').first();
    const validInput = typeof password === 'string' && password.length >= 8 && password.length <= 200;
    const valid = await bcrypt.compare(validInput ? password : '', current?.password_hash || dummyHash);
    if (!current || !validInput || !valid) throw new HttpError(401, 'invalid_reauth_password', 'รหัสผ่านไม่ถูกต้อง');
    financeAttempts.delete(admin.id);
  }

  function requirePermission(admin, permission) {
    if (!permissions[permission]?.includes(admin.role)) {
      throw new HttpError(403, 'admin_permission_denied', 'ไม่มีสิทธิ์ดำเนินการ');
    }
  }
  function sessionToken(req) { return readCookie(req.get('cookie'), SESSION_COOKIE); }
  function cookies(sessionToken, csrfToken) {
    const secure = secureCookie ? '; Secure' : '';
    return [
      `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`,
      `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`,
    ];
  }
  function clearCookies() {
    const secure = secureCookie ? '; Secure' : '';
    return [
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
      `${CSRF_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    ];
  }
  return { login, authenticate, reauthenticateForSecret, reauthenticateFinance, logout, requirePermission, sessionToken, cookies, clearCookies, permissions };
}

module.exports = { createAdminAuth, permissions };
