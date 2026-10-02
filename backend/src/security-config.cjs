function securityConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let allowedOrigin = null;
  if (env.APP_PUBLIC_URL) {
    try { allowedOrigin = new URL(env.APP_PUBLIC_URL).origin; }
    catch { throw new Error('APP_PUBLIC_URL must be an absolute URL'); }
  }
  if (production && !allowedOrigin) throw new Error('APP_PUBLIC_URL is required in production');
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || (production ? 1 : 0));
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 3');
  }
  return { production, allowedOrigin, trustProxyHops };
}

module.exports = { securityConfig };
