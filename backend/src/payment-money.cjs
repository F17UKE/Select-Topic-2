// Decimal THB boundary: reject, never round, a fractional satang.
function satang(value) {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
module.exports = { satang };
