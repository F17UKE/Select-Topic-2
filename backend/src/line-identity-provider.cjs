const { HttpError } = require('./http.cjs');

function validSubject(value) {
  return typeof value === 'string' && /^U[A-Za-z0-9_-]{1,63}$/.test(value);
}

function validateClaims(claims, channelId, now = Date.now()) {
  const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (!audiences.includes(channelId)) throw new HttpError(401, 'line_audience_mismatch');
  if (claims.iss !== 'https://access.line.me') throw new HttpError(401, 'invalid_line_token');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= now) {
    throw new HttpError(401, 'line_token_expired');
  }
  if (!validSubject(claims.sub)) throw new HttpError(401, 'invalid_line_token');
  return claims;
}

function createLineIdentityProvider({ fetchImpl = fetch, verifyUrl = 'https://api.line.me/oauth2/v2.1/verify' } = {}) {
  async function verifyIdToken(idToken, channelId) {
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
      throw new HttpError(401, 'invalid_line_token');
    }
    let response;
    try {
      response = await fetchImpl(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new HttpError(503, 'line_identity_unavailable');
    }
    if (!response.ok) throw new HttpError(401, 'invalid_line_token');
    let claims;
    try { claims = await response.json(); }
    catch { throw new HttpError(401, 'invalid_line_token'); }
    return validateClaims(claims, channelId);
  }
  return { verifyIdToken };
}

module.exports = { createLineIdentityProvider, validateClaims };
