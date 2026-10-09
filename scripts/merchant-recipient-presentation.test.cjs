const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const filename = path.join(__dirname, '../frontend/components/admin-merchant-recipient.js');
const source = fs.readFileSync(filename, 'utf8');
const { code } = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });
const view = { version: 2, merchant_id: 1, source: 'DATABASE', configured: true, enabled: true, encryption_ready: true, promptpay_type: 'PHONE', promptpay_masked: '******0001', bank_code: '999', bank_number_masked: '******0033' };
function component({ data = view, editing = false, confirmation = null, role = 'SUPER_ADMIN', mutate = async () => view, draft = { bankCode: '999', bankNumber: '', enabled: true } } = {}) {
  const state = [data, draft, editing, false, '', '', confirmation]; let index = 0;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, encodeURIComponent, require: (name) => {
    if (name === 'react') return { ...React, useState: () => { const i = index++; return [state[i], (next) => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; }, useRef: (value) => ({ current: value }), useEffect: () => {}, useCallback: (fn) => fn };
    if (name.endsWith('use-admin')) return { useAdmin: () => ({ admin: { role }, mutate }) };
    if (name.endsWith('/api')) return { api: async () => view };
    if (name.endsWith('.css')) return {};
    return require(name);
  } });
  const element = module.exports.default({ merchantId: 1 });
  return { element, state, html: renderToStaticMarkup(element) };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
const button = (node, label) => find(node, (item) => item.type === 'button' && item.props.children === label);

test('recipient current values masked with source/readiness, replacement blank, no normal Admin controls', () => {
  const result = component({ editing: true });
  assert.match(result.html, /พร้อมตรวจสอบผู้รับเงิน|ระบบหลังบ้าน/);
  assert.match(result.html, /\*\*\*\*\*\*0033/);
  assert.match(result.html, /type="password"[^>]*value=""/);
  assert.doesNotMatch(result.html, /0000000033|0800000001/);
  assert.equal(component({ role: 'ADMIN' }).html, '');
  assert.match(component({ data: { ...view, source: 'ENVIRONMENT' } }).html, /Server Environment/);
  assert.match(component({ data: { ...view, source: 'NOT_CONFIGURED', configured: false } }).html, /ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|window\.confirm/);
});
test('save asks confirmation, sends merchant-scoped PATCH only, clears account immediately and guards double submit', async () => {
  let finish, calls = 0;
  const result = component({ editing: true, confirmation: 'save', draft: { bankCode: '999', bankNumber: '0000000033', enabled: true }, mutate: (url, options) => {
    calls++; assert.equal(url, '/api/admin/merchants/1/payment-recipient'); assert.equal(options.method, 'PATCH');
    assert.deepEqual(JSON.parse(options.body), { version: 2, bankCode: '999', bankNumber: '0000000033', enabled: true, confirm: true });
    return new Promise((resolve) => { finish = resolve; });
  } });
  const click = button(result.element, 'ยืนยัน').props.onClick;
  const pending = click(); await click(); assert.equal(calls, 1); assert.equal(result.state[1].bankNumber, ''); assert.equal(result.state[3], true);
  finish({ ...view, version: 3 }); await pending; assert.equal(result.state[0].version, 3); assert.equal(result.state[2], false);
  assert.match(result.state[5], /บันทึกบัญชีรับชำระเงินแล้ว/);
  const form = component({ editing: true }); find(form.element, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(form.state[6], 'save');
});
test('clear explicitly restores fallback, cancel does not send, validation/conflict errors are safe', async () => {
  let sent;
  const clear = component({ confirmation: 'clear', mutate: async (_url, options) => { sent = JSON.parse(options.body); return { ...view, source: 'ENVIRONMENT' }; } });
  await button(clear.element, 'ยืนยัน').props.onClick(); assert.deepEqual(sent, { version: 2, clear: true, confirm: true });
  const cancel = component({ confirmation: 'save', mutate: () => assert.fail('cancel must not send') });
  button(cancel.element, 'ยกเลิก').props.onClick(); assert.equal(cancel.state[6], null);
  for (const status of [400, 403, 409, 500]) {
    const fail = component({ confirmation: 'save', mutate: async () => { throw Object.assign(new Error('private account'), { status }); } });
    await button(fail.element, 'ยืนยัน').props.onClick(); assert.ok(fail.state[4]); assert.doesNotMatch(fail.state[4], /private account/); assert.equal(fail.state[1].bankNumber, '');
  }
});
