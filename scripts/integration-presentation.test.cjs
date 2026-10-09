const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const { fields } = require('../backend/src/integration-fields.cjs');
const filename = path.join(__dirname, '../frontend/app/admin/settings/integrations/page.js');
const source = fs.readFileSync(filename, 'utf8');
const view = { version: 1, encryption_ready: true, production: true,
  status: {}, fields: Object.entries(fields).map(([name, spec]) => ({ name, ...spec, source: 'DATABASE', configured: true,
    ...(spec.type === 'secret' ? { masked: 'ตั้งค่าแล้ว' } : { value: spec.default || spec.options?.[0] || '' }) })) };
function page({ draft = {}, role = 'SUPER_ADMIN', mutate = async () => view, onClear = () => {}, settings = view, onState = () => {}, confirmation = null, busy = false, accountTest = null, editing = null, runtime = {} } = {}) {
  const module = { exports: {} }; let index = 0;
  const states = [settings, draft, '', '', busy, null, confirmation, accountTest, editing, runtime];
  const { code } = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });
  vm.runInNewContext(code, { module, exports: module.exports, AbortSignal, require: (id) => {
    if (id === 'react') return { ...React, useRef: (value) => ({ current: value }), useEffect: () => {}, useCallback: (fn) => fn, useState: () => { const i = index++; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; onState(i, states[i]); if (i === 1) onClear(states[i]); }]; } };
    if (id.endsWith('integration-presentation.mjs')) {
      const helper = { exports: {} };
      const compiled = transformSync(fs.readFileSync(path.join(__dirname, '../frontend/lib/integration-presentation.mjs'), 'utf8'), { filename: 'integration-presentation.js', module: { type: 'commonjs' } });
      vm.runInNewContext(compiled.code, { module: helper, exports: helper.exports }); return helper.exports;
    }
    if (id.endsWith('admin-shell')) return { AdminShell: ({ children }) => React.createElement('main', null, children), AdminError: () => null, StatusBadge: () => null };
    if (id.endsWith('use-admin')) return { useAdmin: () => ({ admin: { role }, mutate }) };
    if (id.endsWith('/api')) return { api: async () => view };
    if (id.endsWith('.css')) return { primary: 'primary', secondary: 'secondary', clear: 'clear' };
    if (id.endsWith('integration-secret-reveal')) {
      const componentFile = path.join(__dirname, '../frontend/components/integration-secret-reveal.js');
      const compiled = transformSync(fs.readFileSync(componentFile, 'utf8'), { filename: componentFile, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
      const component = { exports: {} };
      vm.runInNewContext(compiled.code, { module: component, exports: component.exports, require: (name) => name.endsWith('.css') ? {} : require(name) });
      return component.exports;
    }
    return require(id);
  } });
  return module.exports.default();
}
function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && React.Children.toArray(node.props.children).join('') === label) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const found = findButton(child, label); if (found) return found; }
  return null;
}
test('four primary sections show current values, one canonical secret, no always-visible change fields', () => {
  const element = page(); const html = renderToStaticMarkup(element);
  assert.match(html, /ตั้งค่าแล้ว/); assert.match(html, /รอ Public HTTPS URL/);
  assert.equal((html.match(/id="integration-(payment|easyslip|login|messaging)"/g) || []).length, 4);
  assert.equal((html.match(/data-setting="LINE_WEBHOOK_SECRET"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-setting="LINE_CHANNEL_SECRET"/);
  assert.doesNotMatch(html, /id="(?:EASYSLIP_API_KEY|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|LINE_WEBHOOK_SECRET)"/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|NEXT_PUBLIC_.*KEY|process\.env/);
});
test('secret input clears on submission before the network completes; blank preserve is sent safely', async () => {
  const events = []; let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  const element = page({ confirmation: { kind: 'save', section: 'easyslip', clear: [] }, draft: { EASYSLIP_API_KEY: 'synthetic-form-input' }, mutate: (_url, options) => {
    assert.equal(JSON.parse(options.body).values.EASYSLIP_API_KEY, 'synthetic-form-input'); events.push('request'); return result;
  }, onClear: (state) => { assert.equal(state.EASYSLIP_API_KEY, undefined); events.push('clear'); } });
  const pending = findButton(element, 'ยืนยัน').props.onClick();
  assert.deepEqual(events, ['clear', 'request']);
  finish(view); await pending;
});

test('editing uses primary save and secondary cancel; secret changes are unavailable without encryption', () => {
  const element = page({ editing: 'EASYSLIP_API_KEY' });
  assert.equal(findButton(element, 'บันทึก').props.className, 'primary');
  assert.match(renderToStaticMarkup(element), /id="EASYSLIP_API_KEY"[^>]*type="password"/);
  const css = fs.readFileSync(path.join(path.dirname(filename), 'settings.module.css'), 'utf8');
  for (const required of ['background: #ac3520', ':hover:not(:disabled)', ':focus-visible', ':disabled', 'min-height: 44px']) assert.ok(css.includes(required));
});

test('save and real account test require in-page confirmation; cancel never submits', async () => {
  let calls = 0; const updates = new Map();
  const options = { onState: (i,v) => updates.set(i,v), mutate: async () => { calls++; return view; } };
  await findButton(page({ ...options, editing: 'EASYSLIP_API_KEY' }), 'บันทึก').props.onClick();
  assert.equal(calls, 0); assert.equal(updates.get(6).kind, 'save');
  assert.equal(updates.get(6).section, 'easyslip');
  await findButton(page({ ...options, confirmation: updates.get(6) }), 'ยกเลิก').props.onClick();
  assert.equal(updates.get(6), null); assert.equal(calls, 0);
  await findButton(page(options), 'ตรวจสอบบัญชี EasySlip').props.onClick();
  assert.equal(updates.get(6).kind, 'test'); assert.match(updates.get(6).message, /GET \/v2\/info/);
  assert.equal(calls, 0); assert.doesNotMatch(source, /window\.confirm/);
});

test('save endpoint, server result, feedback and unrelated drafts are preserved; duplicate clicks send once', async () => {
  let calls = 0; let finish; const updates = new Map();
  const result = new Promise((resolve) => { finish = resolve; });
  const element = page({ confirmation: { kind: 'save', section: 'easyslip', clear: [] }, draft: { EASYSLIP_API_KEY: 'synthetic-input', LINE_CHANNEL_ID: '1234567890' }, onState: (index, value) => updates.set(index, value), mutate: (url, options) => {
    calls++; assert.equal(url, '/api/admin/settings/integrations'); assert.equal(options.method, 'PATCH');
    assert.deepEqual(JSON.parse(options.body), { version: 1, values: { EASYSLIP_API_KEY: 'synthetic-input' }, clear: [], confirm: true });
    return result;
  } });
  const click = findButton(element, 'ยืนยัน').props.onClick;
  const first = click(); await click(); assert.equal(calls, 1); assert.equal(updates.get(4), 'save:easyslip');
  finish({ ...view, version: 2 }); await first;
  assert.equal(updates.get(0).version, 2); assert.match(updates.get(3), /บันทึกการตั้งค่าแล้ว/);
  assert.equal(updates.get(1).LINE_CHANNEL_ID, '1234567890'); assert.equal(updates.get(4), false);
  const pendingHtml = renderToStaticMarkup(page({ busy: 'save:easyslip', editing: 'EASYSLIP_API_KEY' }));
  assert.match(pendingHtml, /disabled="">กำลังบันทึก…/);
});

test('cancel sends nothing; save failure gives friendly feedback and allows retry without retaining secret', async () => {
  let calls = 0;
  await findButton(page({ editing: 'EASYSLIP_API_KEY', mutate: () => { calls++; } }), 'บันทึก').props.onClick();
  assert.equal(calls, 0);
  const updates = new Map();
  const element = page({ confirmation: { kind: 'save', section: 'easyslip', clear: [] }, draft: { EASYSLIP_API_KEY: 'synthetic-sensitive' }, onState: (i,v) => updates.set(i,v), mutate: async () => { calls++; throw Object.assign(new Error('internal SQL sensitive detail'), { status: 422 }); } });
  const click = findButton(element, 'ยืนยัน').props.onClick;
  await click(); await click(); assert.equal(calls, 2);
  assert.match(updates.get(2), /การตั้งค่าไม่ครบ/); assert.doesNotMatch(updates.get(2), /SQL|sensitive/);
  assert.equal(updates.get(1).EASYSLIP_API_KEY, undefined); assert.equal(updates.get(4), false);
});
test('normal Admin has no integration form or editable fields', () => {
  const html = renderToStaticMarkup(page({ role: 'ADMIN' }));
  assert.match(html, /ไม่มีสิทธิ์/); assert.doesNotMatch(html, /<input|<select/);
});

test('confirmed account test invokes endpoint once, renders loading then visible success and VERIFIED', async () => {
  const updates = new Map(); let finish; let calls = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const element = page({ confirmation: { kind: 'test' }, onState: (i,v) => updates.set(i,v), mutate: (url, options) => {
    calls++; assert.equal(url, '/api/admin/settings/integrations/test-easyslip');
    assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { version: 1, confirmRealRequest: true });
    assert.ok(options.signal instanceof AbortSignal); return pending;
  } });
  const click = findButton(element, 'ยืนยัน').props.onClick;
  const action = click(); await click(); assert.equal(calls, 1);
  const loading = renderToStaticMarkup(page({ busy: updates.get(4), accountTest: updates.get(7) }));
  assert.match(loading, /disabled="">กำลังตรวจสอบ\.\.\./);
  assert.match(loading, /role="status"[^>]*>.*กำลังตรวจสอบบัญชี EasySlip/s);
  finish({ result: 'ACCOUNT_AUTH_VERIFIED', version: 1, account_status: 'ACTIVE', unsafe: 'TEST_SECRET_DO_NOT_USE' });
  await action;
  const html = renderToStaticMarkup(page({ accountTest: updates.get(7) }));
  assert.match(html, /เชื่อมต่อ EasySlip สำเร็จ/); assert.match(html, /Real verification: VERIFIED/);
  assert.match(html, /สถานะบัญชี: เปิดใช้งาน/); assert.doesNotMatch(html, /TEST_SECRET_DO_NOT_USE/);
  assert.equal(updates.get(4), false);
  for (const overrides of [{ settings: { ...view, version: 2 } }, { draft: { EASYSLIP_API_KEY: 'unsaved-test-key' } }]) {
    assert.doesNotMatch(renderToStaticMarkup(page({ accountTest: updates.get(7), ...overrides })), /Real verification: VERIFIED/);
  }
  await findButton(page({ accountTest: updates.get(7), onState: (i,v) => updates.set(i,v) }), 'โหลดข้อมูลใหม่').props.onClick();
  assert.equal(updates.get(7), null);
});

test('account test failures render safe actionable errors including timeout and invalid key', async () => {
  for (const scenario of [
    { result: { failure_code: 'INVALID_API_KEY' }, text: 'API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน' },
    { result: { failure_code: 'PROVIDER_UNAVAILABLE' }, text: 'ไม่สามารถเชื่อมต่อ EasySlip ได้ กรุณาลองใหม่อีกครั้ง' },
    { error: new Error('raw timeout TEST_SECRET_DO_NOT_USE'), text: 'ไม่สามารถเชื่อมต่อ EasySlip ได้ กรุณาลองใหม่อีกครั้ง' },
    { error: { status: 422, body: { code: 'easyslip_api_key_missing' } }, text: 'กรุณาตั้งค่า EasySlip API Key ก่อน' },
  ]) {
    const updates = new Map();
    const element = page({ confirmation: { kind: 'test' }, onState: (i,v) => updates.set(i,v), mutate: async () => { if (scenario.error) throw scenario.error; return scenario.result; } });
    await findButton(element, 'ยืนยัน').props.onClick();
    const html = renderToStaticMarkup(page({ accountTest: updates.get(7) }));
    assert.ok(html.includes(scenario.text)); assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /TEST_SECRET_DO_NOT_USE|raw timeout|Real verification: VERIFIED/);
    assert.equal(updates.get(4), false);
  }
});

test('missing saved key gives visible guidance and never sends an account request', async () => {
  let calls = 0; const updates = new Map();
  const settings = { ...view, fields: view.fields.map((f) => f.name === 'EASYSLIP_API_KEY' ? { ...f, configured: false, masked: '' } : f) };
  const element = page({ settings, mutate: async () => { calls++; }, onState: (i,v) => updates.set(i,v) });
  const button = findButton(element, 'ตรวจสอบบัญชี EasySlip'); assert.equal(button.props.disabled, true);
  assert.match(renderToStaticMarkup(element), /กรุณาตั้งค่า EasySlip API Key ก่อน/);
  await button.props.onClick(); assert.equal(calls, 0); assert.equal(updates.get(7).state, 'error');
});

test('development persistent encryption readiness enables secrets without the bootstrap blocker', () => {
  const html = renderToStaticMarkup(page({ settings: { ...view, production: false, encryption_key_source: 'DEVELOPMENT_FILE' } }));
  assert.match(html, /การเข้ารหัส Secret พร้อมใช้งาน/);
  assert.match(html, /Development key ถูกจัดการโดยระบบ/);
  assert.doesNotMatch(html, /ยังไม่มี encryption master key|type="password"[^>]*disabled/);
  const production = renderToStaticMarkup(page({ settings: { ...view, encryption_key_source: 'PERSISTENT_FILE' } }));
  assert.doesNotMatch(production, /Development key/);
  const unavailable = renderToStaticMarkup(page({ settings: { ...view, encryption_ready: false }, editing: 'EASYSLIP_API_KEY' }));
  assert.match(unavailable, /ยังไม่มี encryption master key/);
  assert.match(unavailable, /type="password"[^>]*disabled/);
});

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
}
const setting = (tree, name) => find(tree, (node) => node.props?.['data-setting'] === name);
test('normal Edit prefills saved value; cancel clears draft and preserves current data', () => {
  const updates = new Map();
  const settings = { ...view, fields: view.fields.map((field) => field.name === 'LINE_CHANNEL_ID' ? { ...field, value: '2011234567' } : field) };
  const options = { settings, onState: (i,v) => updates.set(i,v) };
  findButton(setting(page(options), 'LINE_CHANNEL_ID'), 'แก้ไข').props.onClick();
  assert.equal(updates.get(8), 'LINE_CHANNEL_ID'); assert.equal(updates.get(1).LINE_CHANNEL_ID, '2011234567');
  const tree = page({ ...options, editing: updates.get(8), draft: updates.get(1) });
  assert.equal(find(tree, node => node.props?.id === 'LINE_CHANNEL_ID').props.value, '2011234567');
  findButton(setting(tree, 'LINE_CHANNEL_ID'), 'ยกเลิก').props.onClick();
  assert.equal(updates.get(8), null); assert.equal(Object.keys(updates.get(1)).length, 0);
  assert.match(renderToStaticMarkup(page(options)), /2011234567/);
});
for (const [name, section] of [['EASYSLIP_API_KEY','easyslip'], ['LINE_MESSAGING_CHANNEL_ACCESS_TOKEN','messaging'], ['LINE_WEBHOOK_SECRET','messaging']]) {
  test(`${name} change/save exits edit, drops plaintext and refresh remains masked`, async () => {
    const updates = new Map(); const token = 'synthetic-do-not-render';
    const options = { onState: (i,v) => updates.set(i,v) };
    const current = setting(page(options), name);
    const reveal = find(current, node => typeof node.type === 'function' && node.props.action);
    reveal.props.action.props.onClick();
    assert.equal(updates.get(8), name); assert.equal(updates.get(1)[name], '');
    await findButton(page({ ...options, editing: name, draft: { [name]: token }, confirmation: { kind: 'save', section, clear: [] }, mutate: async (_, options) => {
      assert.equal(JSON.parse(options.body).values[name], token); assert.equal(updates.get(1)[name], undefined);
      return { ...view, version: 2 };
    } }), 'ยืนยัน').props.onClick();
    assert.equal(updates.get(8), null); assert.equal(updates.get(1)[name], undefined);
    const html = renderToStaticMarkup(page({ settings: updates.get(0) }));
    assert.doesNotMatch(html, /synthetic-do-not-render/); assert.match(html, /••••••••/); assert.match(html, /ตั้งค่าแล้ว/);
  });
}
test('canonical secret uses webhook before legacy even if webhook is ENV; legacy reveal keeps original endpoint field', () => {
  for (const canonicalConfigured of [true, false]) {
    const settings = { ...view, fields: view.fields.map(field => field.name === 'LINE_WEBHOOK_SECRET' ? { ...field, configured: canonicalConfigured, source:'ENVIRONMENT', revealable:false } : { ...field, revealable:true }) };
    const updates = new Map();
    const item = setting(page({ settings, onState:(i,v)=>updates.set(i,v) }), 'LINE_WEBHOOK_SECRET');
    const reveal = find(item, node => typeof node.type === 'function' && node.props.action);
    assert.equal(reveal.props.field.name, canonicalConfigured ? 'LINE_WEBHOOK_SECRET' : 'LINE_CHANNEL_SECRET');
    assert.equal(reveal.props.field.revealable, !canonicalConfigured);
    reveal.props.action.props.onClick(); assert.equal(updates.get(8), 'LINE_WEBHOOK_SECRET');
  }
});
test('clear override is Advanced only, confirms ENV fallback and preserves backend clear API', async () => {
  const updates = new Map();
  const tree = page({ onState:(i,v)=>updates.set(i,v) });
  const advanced = find(tree, node=>node.type === 'details'); assert.equal(advanced.props.open, undefined);
  findButton(advanced, 'ลบค่าที่ตั้งในระบบ').props.onClick();
  assert.match(updates.get(6).message, /Server Environment/);
  let body;
  await findButton(page({ confirmation:updates.get(6), mutate:async (_,options)=>{body=JSON.parse(options.body);return view;} }), 'ยืนยัน').props.onClick();
  assert.equal(body.clear.length, 1); assert.equal(Object.keys(body.values).length, 0);
  assert.ok(!findButton(find(tree,node=>node.props?.id==='integration-payment'), 'ลบค่าที่ตั้งในระบบ'));
});
test('CheckSlip is conditional, EasySlip base URL Advanced, HTTPS and active state are distinct', () => {
  for (const provider of ['mock','easyslip','checkslip']) {
    const settings={...view,status:{ login:{configuration:'READY',enabled:true}, messaging:{configuration:'READY',enabled:true} },fields:view.fields.map(f=>f.name==='PAYMENT_VERIFICATION_MODE'?{...f,value:provider}:f)};
    const tree=page({settings});
    const payment=find(tree,node=>node.props?.id==='integration-payment');
    assert.equal(Boolean(setting(payment,'CHECKSLIP_API_KEY')),provider==='checkslip');
    assert.ok(setting(find(tree,node=>node.type==='details'),'EASYSLIP_API_BASE_URL'));
    assert.match(renderToStaticMarkup(tree), /รอ HTTPS/);
    assert.doesNotMatch(renderToStaticMarkup(tree), /บัญชี API ตรวจสอบแล้ว/);
  }
});
test('normal values from successful save and reload are server authoritative', async () => {
  const updates=new Map();
  const saved={...view,version:2,fields:view.fields.map(f=>f.name==='LINE_LIFF_ID'?{...f,value:'2011234567-saved'}:f)};
  await findButton(page({confirmation:{kind:'save',section:'login',clear:[]},draft:{LINE_LIFF_ID:'2011234567-saved'},onState:(i,v)=>updates.set(i,v),mutate:async()=>saved}), 'ยืนยัน').props.onClick();
  assert.equal(updates.get(8),null);
  assert.match(renderToStaticMarkup(page({settings:updates.get(0)})), /2011234567-saved/);
});

test('PromptPay type and identifier edit together so the existing pair validation stays atomic', () => {
  const updates = new Map();
  findButton(setting(page({onState:(i,v)=>updates.set(i,v)}),'PLATFORM_PROMPTPAY_TYPE'), 'แก้ไข').props.onClick();
  assert.equal(updates.get(8),'promptpay');
  assert.equal(updates.get(1).PLATFORM_PROMPTPAY_ID,'');
  const tree=page({editing:updates.get(8),draft:updates.get(1)});
  assert.ok(find(tree,node=>node.props?.id==='PLATFORM_PROMPTPAY_ID'));
  assert.ok(find(tree,node=>node.props?.id==='PLATFORM_PROMPTPAY_TYPE'));
  assert.ok(findButton(setting(tree,'PLATFORM_PROMPTPAY_NAME'),'บันทึก'));
});
test('provider options preserve production guard and Messaging presents disabled/real', () => {
  const production=renderToStaticMarkup(page({editing:'PAYMENT_VERIFICATION_MODE'}));
  assert.doesNotMatch(production, /<option[^>]*value="mock"/);
  const messaging=renderToStaticMarkup(page({editing:'LINE_MESSAGING_MODE',settings:{...view,production:false}}));
  assert.match(messaging, /<option[^>]*value="disabled"/); assert.match(messaging, /<option[^>]*value="real"/);
  assert.doesNotMatch(messaging, /<option[^>]*value="mock"/);
});
test('configured, selected and account verification never substitute for each other', async () => {
  const {integrationState}=await import('../frontend/lib/integration-presentation.mjs');
  const settings={...view,liff_endpoint:'https://example.invalid/',status:{login:{configuration:'READY',enabled:true},easyslip:{configuration:'READY',enabled:false}}};
  assert.equal(integrationState(settings,'login',false,'mock').activity,'ยังไม่ได้เปิดใช้งาน');
  assert.equal(integrationState(settings,'login',false,'line').activity,'เปิดใช้งาน');
  assert.equal(integrationState(settings,'login',false,null).activity,'ตรวจสอบสถานะไม่ได้');
  const slip=integrationState(settings,'easyslip',true,'mock');
  assert.equal(slip.activity,'ยังไม่ได้เลือกใช้งาน'); assert.equal(slip.verification,'บัญชี API ตรวจสอบแล้ว');
});
