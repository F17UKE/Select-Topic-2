class HttpError extends Error {
  constructor(status, code, message = code, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function positiveId(raw, name = 'id') {
  if (!/^\d+$/.test(String(raw)) || Number(raw) < 1) {
    throw new HttpError(400, 'invalid_request', `${name} must be a positive integer`);
  }
  return Number(raw);
}

function textField(value, name, { min = 1, max, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', `${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length < min || (max && normalized.length > max)) {
    throw new HttpError(400, 'invalid_request', `${name} has an invalid length`);
  }
  return normalized;
}

module.exports = { HttpError, asyncRoute, positiveId, textField };
