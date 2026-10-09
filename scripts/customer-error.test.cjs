const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('customer presentation maps unauthorized and never reveals arbitrary error/provider messages', async () => {
  const { customerErrorMessage } = await import('../frontend/lib/customer-error.mjs');
  assert.equal(customerErrorMessage({ status: 401 }), 'กรุณาเข้าสู่ระบบอีกครั้ง');
  assert.equal(customerErrorMessage({ body: { error: 'authentication_required' } }), 'กรุณาเข้าสู่ระบบอีกครั้ง');
  for (const message of ['internal_error', 'ECONNRESET', 'Failed to fetch', 'database password=private', 'provider secret', 'ข้อความลับจาก provider', '__proto__', 'constructor', 'toString']) {
    const result = customerErrorMessage({ message, stack: message, body: { error: message, message } });
    assert.equal(result, 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    assert.ok(!result.includes(message));
  }
});

test('Profile, Orders and customer session presentation use the safe boundary for every caught error', () => {
  for (const file of ['app/profile/page.js', 'app/orders/page.js', 'app/orders/[id]/page.js', 'lib/use-customer.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8');
    assert.match(source, /customerErrorMessage\(requestError\)/);
    assert.doesNotMatch(source, /set(?:Error|EngagementError)\(requestError\.message\)/);
  }
});
