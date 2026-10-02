const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');

function integer(env, name, fallback, min, max) {
  const raw = env[name] || String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(raw);
}

function databaseConfig(env = process.env, { required = false } = {}) {
  const names = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = names.filter((name) => !env[name]);
  if (missing.length === names.length && !required) return null;
  if (missing.length) throw new Error(`Missing database environment variables: ${missing.join(', ')}`);
  const mode = env.DB_SSL_MODE || 'disable';
  if (!['disable', 'verify-full'].includes(mode)) throw new Error('DB_SSL_MODE must be disable or verify-full');
  if (mode === 'disable' && env.DB_SSL_CA_FILE) throw new Error('DB_SSL_CA_FILE requires verify-full');
  const ssl = mode === 'verify-full' ? {
    rejectUnauthorized: true,
    ...(env.DB_SSL_CA_FILE ? { ca: fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8') } : {}),
  } : false;
  const connectTimeout = integer(env, 'DB_CONNECT_TIMEOUT_MS', 2000, 100, 10000);
  const queryTimeout = integer(env, 'DB_QUERY_TIMEOUT_MS', 2000, 100, 10000);
  return {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: integer(env, 'DB_PORT', 5432, 1, 65535),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl,
      application_name: 'select-topic-2-backend',
      connectionTimeoutMillis: connectTimeout,
      statement_timeout: queryTimeout,
      query_timeout: queryTimeout,
    },
    pool: { min: 0, max: integer(env, 'DB_POOL_MAX', 2, 1, 5) },
    acquireConnectionTimeout: connectTimeout,
    migrations: { directory: path.resolve(__dirname, '../migrations'), loadExtensions: ['.cjs'] },
    seeds: { directory: path.resolve(__dirname, '../seeds'), loadExtensions: ['.cjs'] },
  };
}

function serverConfig(env = process.env) {
  return { host: env.HOST || '127.0.0.1', port: integer(env, 'PORT', 3001, 1, 65535) };
}

function boolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function paymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const verificationMode = env.PAYMENT_VERIFICATION_MODE || (production ? 'checkslip' : 'mock');
  if (!['mock', 'checkslip'].includes(verificationMode)) {
    throw new Error('PAYMENT_VERIFICATION_MODE must be mock or checkslip');
  }
  if (production && verificationMode === 'mock') {
    throw new Error('Mock payment verification is forbidden in production');
  }
  let checkslipApiUrl = null;
  let checkslipApiKey = null;
  if (verificationMode === 'checkslip') {
    const missing = ['CHECKSLIP_API_URL', 'CHECKSLIP_API_KEY'].filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing CheckSlip environment variables: ${missing.join(', ')}`);
    try {
      checkslipApiUrl = new URL(env.CHECKSLIP_API_URL);
    } catch {
      throw new Error('CHECKSLIP_API_URL must be an absolute HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(checkslipApiUrl.protocol)
      || checkslipApiUrl.username || checkslipApiUrl.password || checkslipApiUrl.hash) {
      throw new Error('CHECKSLIP_API_URL must be an absolute HTTP(S) URL without credentials or fragment');
    }
    if (production && checkslipApiUrl.protocol !== 'https:') {
      throw new Error('CHECKSLIP_API_URL must use HTTPS in production');
    }
    checkslipApiKey = env.CHECKSLIP_API_KEY;
  }
  const storageMode = env.SLIP_STORAGE_MODE || (production ? 'object' : 'local');
  if (!['local', 'object'].includes(storageMode)) throw new Error('SLIP_STORAGE_MODE must be local or object');
  const objectNames = [
    'SLIP_OBJECT_STORAGE_ENDPOINT',
    'SLIP_OBJECT_STORAGE_REGION',
    'SLIP_OBJECT_STORAGE_BUCKET',
    'SLIP_OBJECT_STORAGE_ACCESS_KEY',
    'SLIP_OBJECT_STORAGE_SECRET_KEY',
  ];
  let objectStorageEndpoint = null;
  let objectStorageCa = null;
  if (storageMode === 'object') {
    const missing = objectNames.filter((name) => !env[name]);
    if (missing.length) throw new Error(`Missing object storage environment variables: ${missing.join(', ')}`);
    try {
      objectStorageEndpoint = new URL(env.SLIP_OBJECT_STORAGE_ENDPOINT);
    } catch {
      throw new Error('SLIP_OBJECT_STORAGE_ENDPOINT must be an absolute HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(objectStorageEndpoint.protocol)
      || objectStorageEndpoint.username || objectStorageEndpoint.password || objectStorageEndpoint.hash) {
      throw new Error('SLIP_OBJECT_STORAGE_ENDPOINT must be an absolute HTTP(S) URL without credentials or fragment');
    }
    if (production && objectStorageEndpoint.protocol !== 'https:') {
      throw new Error('SLIP_OBJECT_STORAGE_ENDPOINT must use HTTPS in production');
    }
    if (env.SLIP_OBJECT_STORAGE_CA_FILE) {
      if (objectStorageEndpoint.protocol !== 'https:') {
        throw new Error('SLIP_OBJECT_STORAGE_CA_FILE requires an HTTPS object storage endpoint');
      }
      try {
        objectStorageCa = fs.readFileSync(env.SLIP_OBJECT_STORAGE_CA_FILE, 'utf8');
        tls.createSecureContext({ ca: objectStorageCa });
      } catch {
        throw new Error('SLIP_OBJECT_STORAGE_CA_FILE must be a readable, valid CA certificate bundle');
      }
    }
  }
  return {
    verificationMode,
    storageRoot: path.resolve(env.SLIP_STORAGE_DIR || path.resolve(__dirname, '../storage')),
    maxUploadBytes: integer(env, 'SLIP_MAX_BYTES', 5 * 1024 * 1024, 1024, 10 * 1024 * 1024),
    retentionHours: integer(env, 'PAYMENT_PRIVATE_RETENTION_HOURS', 24, 1, 168),
    storageMode,
    objectStorageEndpoint,
    objectStorageRegion: env.SLIP_OBJECT_STORAGE_REGION || null,
    objectStorageBucket: env.SLIP_OBJECT_STORAGE_BUCKET || null,
    objectStorageAccessKey: env.SLIP_OBJECT_STORAGE_ACCESS_KEY || null,
    objectStorageSecretKey: env.SLIP_OBJECT_STORAGE_SECRET_KEY || null,
    objectStorageForcePathStyle: boolean(env, 'SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE', false),
    objectStorageCa,
    checkslipApiUrl,
    checkslipApiKey,
    checkslipConnectTimeoutMs: integer(env, 'CHECKSLIP_CONNECT_TIMEOUT_MS', 3000, 100, 30000),
    checkslipRequestTimeoutMs: integer(env, 'CHECKSLIP_REQUEST_TIMEOUT_MS', 10000, 500, 60000),
  };
}

module.exports = { databaseConfig, serverConfig, paymentConfig };
