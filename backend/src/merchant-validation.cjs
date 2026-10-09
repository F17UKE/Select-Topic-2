const { HttpError, textField, positiveId } = require('./http.cjs');
const bool = (v) => {
  if (typeof v !== 'boolean') throw new HttpError(400, 'invalid_boolean');
  return v;
};
const integer = (v, min = 0, max = 1000000) => {
  if (
    !Number.isSafeInteger(Number(v)) ||
    v === null ||
    v === '' ||
    !['number', 'string'].includes(typeof v) ||
    Number(v) < min ||
    Number(v) > max
  )
    throw new HttpError(400, 'invalid_integer');
  return Number(v);
};
const money = (v) => {
  if (!['number', 'string'].includes(typeof v)) throw new HttpError(400, 'invalid_amount');
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(v))) throw new HttpError(400, 'invalid_amount');
  return String(v);
};
const str = (v, max = 160, nullable = false) => textField(v, 'value', { max, nullable });
function fields(body, spec, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_request');
  const result = {};
  for (const key of required) if (body[key] === undefined) throw new HttpError(400, 'missing_' + key);
  for (const [key, parse] of Object.entries(spec))
    if (body[key] !== undefined) result[key] = parse(body[key]);
  if (!Object.keys(result).length) throw new HttpError(400, 'empty_update');
  return result;
}
module.exports = { bool, integer, money, str, fields, positiveId };
