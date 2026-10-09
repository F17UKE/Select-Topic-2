const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');
function createIntegrationCrypto(encoded) {
  if (encoded && !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('INTEGRATION_SETTINGS_ENCRYPTION_KEY must be base64 for 32 random bytes');
  const key = encoded ? Buffer.from(encoded, 'base64') : null;
  if (key && key.length !== 32) throw new Error('Invalid INTEGRATION_SETTINGS_ENCRYPTION_KEY');
  function requireKey() { if (!key) throw new HttpError(503, 'integration_encryption_unavailable'); }
  return {
    ready: Boolean(key),
    encrypt(name, value) {
      requireKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`integration:v1:${name}`));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
    },
    decrypt(name, envelope) {
      requireKey();
      try {
        const [version, iv, tag, data, extra] = envelope.split('.');
        if (version !== 'v1' || extra !== undefined) throw new Error();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAAD(Buffer.from(`integration:v1:${name}`));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch { throw new HttpError(503, 'integration_decryption_failed'); }
    },
  };
}
module.exports = { createIntegrationCrypto };
