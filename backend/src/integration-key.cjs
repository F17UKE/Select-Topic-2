const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const developmentKeyFile = path.resolve(__dirname, '../.runtime/integration-settings.key');

function validateKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)
    || Buffer.from(value, 'base64').length !== 32 || Buffer.from(value, 'base64').toString('base64') !== value) {
    throw new Error('Invalid integration encryption key: expected base64 for 32 random bytes');
  }
  return value;
}

function readKey(filename) {
  let fd;
  try {
    // Do not follow a substituted key-file symlink or accept a publicly readable POSIX key.
    if (!fs.lstatSync(filename).isFile()) throw new Error();
    fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 128 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error();
    return validateKey(fs.readFileSync(fd, 'utf8').trim());
  } catch {
    // Never include filesystem contents, supplied keys, or OS error objects in startup logs.
    throw new Error('Integration encryption key file is unreadable, invalid, or has unsafe permissions');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function createPersistentKey(filename) {
  let temporary;
  let fd;
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    fd = fs.openSync(temporary, 'wx', 0o600);
    if (process.platform === 'win32') {
      // Node's mode bits do not restrict Windows ACLs. Only this user and SYSTEM may access it.
      execFileSync('icacls.exe', [temporary, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(F)`, '*S-1-5-18:(F)'], { stdio: 'ignore', windowsHide: true });
    }
    fs.writeFileSync(fd, `${crypto.randomBytes(32).toString('base64')}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Publish a complete file atomically without replacing a concurrent winner's key.
    try { fs.linkSync(temporary, filename); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } catch {
    throw new Error('Unable to persist development integration encryption key');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function resolveIntegrationKey(env = process.env) {
  if (env.INTEGRATION_SETTINGS_ENCRYPTION_KEY) {
    return { encoded: validateKey(env.INTEGRATION_SETTINGS_ENCRYPTION_KEY), source: 'ENVIRONMENT' };
  }
  const development = ['development', 'local'].includes(env.NODE_ENV || 'development');
  const configuredFile = env.INTEGRATION_SETTINGS_KEY_FILE;
  if (!configuredFile && !development) return { encoded: undefined, source: 'UNAVAILABLE' };
  if (configuredFile && !path.isAbsolute(configuredFile)) throw new Error('INTEGRATION_SETTINGS_KEY_FILE must be an absolute path');
  const filename = configuredFile || developmentKeyFile;
  if (development) {
    try { fs.lstatSync(filename); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Integration encryption key file is inaccessible');
      createPersistentKey(filename);
    }
  }
  return { encoded: readKey(filename), source: development ? 'DEVELOPMENT_FILE' : 'PERSISTENT_FILE' };
}

module.exports = { resolveIntegrationKey };
