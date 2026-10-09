const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const filename = path.join(__dirname, '../frontend/components/integration-secret-reveal.js');
const source = fs.readFileSync(filename, 'utf8');
const { code } = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });

function harness(mutate = async () => ({ value: 'synthetic-revealed-value' }), overrides = {}) {
  const state = [], refs = [], effects = [], timers = new Map(), listeners = new Map(), clipboard = [];
  const callbacks = [];
  let stateIndex, refIndex, effectIndex, callbackIndex, nextTimer = 0;
  const doc = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, encodeURIComponent,
    document: doc, window: doc, navigator: { clipboard: { writeText: async (value) => clipboard.push(value) } },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id),
    require: (name) => name === 'react' ? { ...React,
      useState: (initial) => { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef: (initial) => { const i = refIndex++; return refs[i] ||= { current: initial }; }, useCallback: (fn) => { const i = callbackIndex++; return callbacks[i] ||= fn; },
      useEffect: (fn, dependencies) => { const i = effectIndex++; if (!effects[i] || dependencies.some((d, n) => d !== effects[i].dependencies[n])) {
        effects[i]?.cleanup?.(); effects[i] = { dependencies, cleanup: fn() };
      } },
    } : name.endsWith('.css') ? {} : require(name),
  });
  const Component = module.exports.default;
  function render() {
    stateIndex = 0; refIndex = 0; effectIndex = 0; callbackIndex = 0;
    return Component({ field: { name: 'EASYSLIP_API_KEY', label: 'EasySlip API Key', configured: true, revealable: true, ...overrides }, mutate });
  }
  return { render, html: () => renderToStaticMarkup(render()), state, timers, clipboard, doc, listeners,
    unmount: () => { for (const effect of effects) effect.cleanup?.(); state.fill(undefined); } };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
function button(h, label) { return find(h.render(), (node) => node.type === 'button' && node.props.children === label); }
function open(h) { button(h, 'ดู Key').props.onClick(); }
function password(h) { find(h.render(), (node) => node.type === 'input' && node.props.type === 'password').props.onChange({ target: { value: 'synthetic-password' } }); }
function submit(h) { return find(h.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} }); }

test('default is masked with separate current field; reveal requires password POST; hide and reload clear it', async () => {
  const calls = [];
  const h = harness(async (url, options) => { calls.push({ url, options }); return { value: 'synthetic-revealed-value' }; });
  assert.match(h.html(), /readOnly=""[^>]*value="••••••••••••••••"/);
  assert.doesNotMatch(h.html(), /synthetic-revealed-value|>คัดลอก</);
  open(h); assert.equal(calls.length, 0); assert.equal(button(h, 'ยืนยัน').props.disabled, true);
  password(h); await submit(h);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].url, '/api/admin/settings/integrations/secrets/EASYSLIP_API_KEY/reveal');
  assert.deepEqual(JSON.parse(calls[0].options.body), { password: 'synthetic-password' });
  assert.equal(h.state[2], ''); assert.match(h.html(), /synthetic-revealed-value/);
  assert.equal(h.clipboard.length, 0); await button(h, 'คัดลอก').props.onClick();
  assert.deepEqual(h.clipboard, ['synthetic-revealed-value']); assert.match(h.html(), /คัดลอกแล้ว/);
  button(h, 'ซ่อน').props.onClick(); assert.doesNotMatch(h.html(), /synthetic-revealed-value|>คัดลอก</);
  assert.doesNotMatch(harness().html(), /synthetic-revealed-value/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|console\.|searchParams/);
});

test('timeout, visibility and pagehide remove plaintext; no automatic copy', async () => {
  for (const reason of ['timeout', 'visibilitychange', 'pagehide']) {
    const h = harness(); open(h); password(h); await submit(h);
    assert.equal(h.state[0], 'synthetic-revealed-value');
    if (reason === 'timeout') {
      const timer = [...h.timers.values()].find((item) => item.ms === 60000); assert.ok(timer); timer.fn();
    } else { h.doc.visibilityState = 'hidden'; h.listeners.get(reason)(); }
    assert.equal(h.state[0], ''); assert.equal(h.state[2], ''); assert.equal(h.clipboard.length, 0);
  }
});

test('cancel/unmount invalidates late responses and double submit sends once', async () => {
  for (const reason of ['cancel', 'unmount']) {
    let finish, count = 0;
    const h = harness(() => { count++; return new Promise((resolve) => { finish = resolve; }); });
    open(h); password(h); const pending = submit(h); await submit(h);
    assert.equal(count, 1); assert.equal(h.state[2], ''); assert.match(h.html(), /กำลังยืนยัน/);
    if (reason === 'cancel') button(h, 'ยกเลิก').props.onClick(); else h.unmount();
    finish({ value: 'synthetic-revealed-value' }); await pending;
    assert.ok(!h.state.includes('synthetic-revealed-value'));
  }
});

test('wrong password/rate limit/internal failures are safe visible errors; ENV reveal disabled', async () => {
  for (const [status, code, expected] of [[401, 'invalid_reauth_password', 'รหัสผ่านไม่ถูกต้อง'], [429, 'secret_reveal_rate_limited', '15 นาที'], [500, 'unknown', 'ไม่สามารถเปิดดูข้อมูลลับได้']]) {
    const h = harness(async () => { throw Object.assign(new Error('sensitive internal payload'), { status, body: { code } }); });
    open(h); password(h); await submit(h);
    assert.ok(h.html().includes(expected)); assert.doesNotMatch(h.html(), /sensitive internal|synthetic-revealed/);
    assert.equal(h.state[2], '');
  }
  const h = harness(undefined, { revealable: false });
  assert.equal(button(h, 'ดู Key').props.disabled, true); assert.match(h.html(), /Environment/);
});
