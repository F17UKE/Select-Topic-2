const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');
const { validateClaims } = require('./line-identity-provider.cjs');

const SESSION_COOKIE = 'customer_session';

function booleanValue(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ENABLE_DEV_LOGIN must be true or false');
}

function customerAuthConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const mode = env.CUSTOMER_AUTH_MODE || (production ? 'line' : 'mock');
  if (!['mock', 'line'].includes(mode)) {
    throw new Error('CUSTOMER_AUTH_MODE must be mock or line');
  }
  const devLoginEnabled = booleanValue(env.ENABLE_DEV_LOGIN, false);
  if (production && (mode === 'mock' || devLoginEnabled)) {
    throw new Error('Mock customer authentication and dev login are forbidden in production');
  }
  if (devLoginEnabled && mode !== 'mock') {
    throw new Error('ENABLE_DEV_LOGIN requires CUSTOMER_AUTH_MODE=mock');
  }
  return {
    mode,
    devLoginEnabled,
    devLineUserId: env.DEV_CUSTOMER_LINE_USER_ID || 'U_LOCAL_CUSTOMER_001',
    secureCookie: production,
    lineChannelId: env.LINE_CHANNEL_ID || '',
    liffId: env.LINE_LIFF_ID || '',
  };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function createCustomerAuth({ db, config = customerAuthConfig(), identityProvider, randomUUID = crypto.randomUUID }) {
  const sessions = new Map();

  async function findCustomer(lineUserId) {
    return db('customers')
      .select('id', 'line_user_id', 'display_name', 'profile_image_url', 'phone', 'email')
      .where({ line_user_id: lineUserId, is_active: true })
      .first();
  }

  async function loginDevelopmentCustomer() {
    if (config.mode !== 'mock' || !config.devLoginEnabled) {
      throw new HttpError(404, 'not_found');
    }
    const customer = await findCustomer(config.devLineUserId);
    if (!customer) {
      throw new HttpError(503, 'dev_customer_missing', 'Run the local seed before using dev login');
    }
    const token = randomUUID();
    sessions.set(token, { customerId: customer.id, createdAt: Date.now() });
    return { token, customer };
  }

  async function loginLineCustomer(idToken) {
    if (config.mode !== 'line') throw new HttpError(404, 'not_found');
    if (!identityProvider || !config.lineChannelId) throw new HttpError(503, 'line_auth_not_configured');
    const verified = await identityProvider.verifyIdToken(idToken, config.lineChannelId);
    const claims = validateClaims(verified, config.lineChannelId);
    let customer = await findCustomer(claims.sub);
    if (!customer) {
      try {
        [customer] = await db('customers').insert({
          line_user_id: claims.sub,
          display_name: typeof claims.name === 'string' ? claims.name.slice(0, 160) : null,
          profile_image_url: typeof claims.picture === 'string' ? claims.picture.slice(0, 2048) : null,
          email: typeof claims.email === 'string' ? claims.email.slice(0, 320) : null,
          is_active: true,
        }).returning(['id', 'line_user_id', 'display_name', 'profile_image_url', 'phone', 'email']);
      } catch (error) {
        if (error.code !== '23505') throw error;
        customer = await findCustomer(claims.sub);
      }
    }
    if (!customer) throw new HttpError(401, 'line_customer_inactive');
    const address = await db('customer_addresses').where({ customer_id: customer.id }).first('id');
    const token = randomUUID();
    sessions.set(token, { customerId: customer.id, createdAt: Date.now() });
    return { token, customer, onboarding_required: !customer.phone || !address };
  }

  async function authenticate(req) {
    const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer || readCookie(req.get('cookie'), SESSION_COOKIE);
    const session = token ? sessions.get(token) : null;
    if (!session) throw new HttpError(401, 'authentication_required');
    const customer = await db('customers')
      .select('id', 'line_user_id', 'display_name', 'profile_image_url', 'phone', 'email')
      .where({ id: session.customerId, is_active: true })
      .first();
    if (!customer) {
      sessions.delete(token);
      throw new HttpError(401, 'authentication_required');
    }
    return { token, customer };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  function cookie(token) {
    const secure = config.secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`;
  }

  function clearCookie() {
    const secure = config.secureCookie ? '; Secure' : '';
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  }

  return { config, loginDevelopmentCustomer, loginLineCustomer, authenticate, logout, cookie, clearCookie };
}

module.exports = { SESSION_COOKIE, customerAuthConfig, createCustomerAuth };
