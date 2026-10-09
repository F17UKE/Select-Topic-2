// Isolated presentation/render smoke: no server, database, authentication or provider calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Render real JSX without adding a test dependency. Only browser/framework boundaries are stubbed.
function component(file, context = {}) {
  const source = read(file);
  const { code } = transformSync(source, {
    filename: path.join(root, file), jsc: { parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === 'react' && context.hooks) return { ...React, ...context.hooks };
    if (id.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
    if (id === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (id === 'next/image') return (props) => React.createElement('img', Object.fromEntries(
      Object.entries(props).filter(([key]) => !['fill', 'priority', 'unoptimized'].includes(key)),
    ));
    if (id.endsWith('/use-merchant-staff') && context.staffSession) return { useMerchantStaff: () => context.staffSession };
    if (id.endsWith('/use-customer')) return { useCustomer: () => ({ customer: { id: 'fixture' }, loading: false }) };
    if (id.endsWith('/cart')) return { useCart: () => context.cart || ({ count: context.cartCount ?? 2 }) };
    if (id === 'next/navigation') return { usePathname: () => context.pathname || '/', useParams: () => ({ id: '1' }), useRouter: () => context.router || {}, useSearchParams: () => new URLSearchParams(context.query || '') };
    if (id.startsWith('.')) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
      return component(/\.(?:js|mjs)$/.test(resolved) ? resolved : `${resolved}.js`, context);
    }
    return require(id);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, process, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, queueMicrotask, console, ...context.globals });
  return module.exports;
}
const render = (file, name, props, context) => renderToStaticMarkup(React.createElement(component(file, context)[name], props));
const home = 'frontend/components/home/';

const paymentPage = 'frontend/app/orders/[id]/payment/page.js';
const paymentOrder = { id: 1, order_code: 'TEST-0001', store_name: 'Fixture Kitchen', total_amount: 435, payment_status: 'UNPAID', status: 'PENDING' };
const paymentQr = { image_data_url: 'data:image/png;base64,fixture', amount: 435,
  merchant: { store_name: 'Fixture Kitchen', promptpay_identifier: '******0099' } };
function paymentRender(values) {
  let index = 0;
  return render(paymentPage, 'default', {}, { pathname: '/orders/1/payment', hooks: {
    useState(initial) { return [index < values.length ? values[index++] : initial, () => {}]; },
  } });
}
test('dedicated payment render is minimal, masked and has accessible 4 MiB image upload without bottom nav', () => {
  const html = paymentRender([paymentOrder, { payment: { status: 'PENDING' } }, paymentQr, null, false, '', 'success']);
  for (const text of ['ยอดที่ต้องชำระ', '435', '******0099', '4 MB', 'เลือกรูปสลิป', 'บันทึก QR']) assert.ok(html.includes(text));
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /alt="QR Code PromptPay/);
  assert.match(html, /class="primaryCard"[^]*Fixture Kitchen[^]*class="qr"/);
  assert.match(html, /สแกน QR เพื่อชำระ/);
  assert.match(html, /JPG, PNG หรือ WebP · ไม่เกิน 4 MB/);
  assert.match(html, /class="form"[^]*อัปโหลดหลักฐานการชำระเงิน/);
  assert.doesNotMatch(html, /status-timeline|bottom-nav|rawSlip|EasySlip|รายการอาหาร|ข้อมูลจัดส่ง/);
});
test('already-paid payment renders success only; Order Detail has no upload/QR/provider calls', () => {
  const html = paymentRender([{ ...paymentOrder, payment_status: 'PAID' }, null, paymentQr, null, false, '', 'success']);
  assert.match(html, /ชำระเงินสำเร็จ/); assert.doesNotMatch(html, /type="file"|data:image|<form/);
  const detail = read('frontend/app/orders/[id]/page.js');
  assert.doesNotMatch(detail, /payment\/slip|payment\/qr|type="file"|mockScenario|preparePayment/);
  assert.match(detail, /\/orders\/\$\{id\}\/payment/);
  assert.match(detail, /order\.delivery_room_number/);
});
test('payment input errors remain safe and boundary validation accepts only supported <=4 MiB files', () => {
  const { validateSlipFile, paymentErrorMessage } = component('frontend/lib/payment-presentation.mjs');
  assert.equal(validateSlipFile({ type: 'image/png', size: 4194304 }), '');
  for (const file of [null, { type: 'text/plain', size: 1 }, { type: 'image/png', size: 4194305 }, { type: 'image/jpeg', size: 0 }]) assert.ok(validateSlipFile(file));
  assert.ok(!paymentErrorMessage('private-key-provider-response').includes('private'));
  assert.match(paymentErrorMessage('SLIP_NOT_FOUND'), /ไม่พบข้อมูลสลิป/);
  assert.equal(paymentErrorMessage('RECIPIENT_MISMATCH'), 'บัญชีผู้รับในสลิปไม่ตรงกับบัญชีรับชำระเงิน');
  assert.equal(paymentErrorMessage('INVALID_SLIP'), 'ไม่พบข้อมูลสลิป กรุณาใช้สลิปจากธนาคารที่มี QR ชัดเจน');
  assert.match(paymentErrorMessage('INVALID_IMAGE_FORMAT'), /ไฟล์รูปไม่ถูกต้อง/);
  assert.match(paymentErrorMessage('SLIP_PENDING'), /ธนาคารกำลังประมวลผล/);
  assert.match(paymentErrorMessage('INVALID_API_KEY'), /ติดต่อผู้ดูแล/);
  assert.match(paymentErrorMessage('SERVICE_EXPIRED'), /EasySlip หมดอายุ/);
  assert.match(paymentErrorMessage('QUOTA_EXCEEDED'), /ขีดจำกัด/);
  assert.match(paymentErrorMessage('EASYSLIP_UNAVAILABLE'), /ไม่สามารถเชื่อมต่อ/);
  const html = paymentRender([paymentOrder, null, paymentQr, null, false, 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ', 'success']);
  assert.match(html, /role="alert"/);
});
test('development payment diagnostics are collapsed, sanitized and absent when the API omits them', () => {
  const safe = paymentRender([paymentOrder, { payment: { status: 'FAILED', verification: { failure_code: 'IP_NOT_ALLOWED', diagnostic: {
    stage: 'PROVIDER', provider_code: 'IP_NOT_ALLOWED', http_status: 403, request_id: 'safe-request-id',
  } } } }, paymentQr, null, false, 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล', 'success']);
  for (const value of ['Developer tools', 'PROVIDER', 'IP_NOT_ALLOWED', '403', 'safe-request-id']) assert.match(safe, new RegExp(value));
  assert.doesNotMatch(safe, /<details[^>]* open|authorization|api[_ -]?key|rawSlip/i);
  const ordinary = paymentRender([paymentOrder, { payment: { status: 'FAILED', verification: { failure_code: 'IP_NOT_ALLOWED' } } }, paymentQr, null, false, '', 'success']);
  assert.doesNotMatch(ordinary, /Verification stage|safe-request-id/);
});
function paymentRuntime({ status = 'PENDING', verify, attempt, reconcile, environment = 'test' } = {}) {
  const values = [paymentOrder, { payment: { status }, verification_mode: 'mock' }, paymentQr,
    null, false, '', 'success'];
  const refs = [], effects = [], calls = [], timers = [], routes = [];
  let stateIndex = 0, refIndex = 0;
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  class TestForm { constructor() { this.fields = []; } append(...args) { this.fields.push(args); } }
  const page = component(paymentPage, { router: { replace: (route) => routes.push(route) }, hooks: {
    useCallback: (callback) => callback,
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], (value) => { values[i] = value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] || (refs[i] = { current: initial }); },
    useEffect(effect) { effects.push(effect); },
  }, globals: { process: { env: { NODE_ENV: environment } }, FormData: TestForm,
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/orders/1') return response({ order: paymentOrder });
      if (url.endsWith('/slip')) return response(await (verify?.(options) || { payment: { status: 'PAID' } }));
      if (url.endsWith('/payments')) return response(await (attempt?.(options) || { payment: { status: 'PENDING' } }));
      return response(await (reconcile?.(options) || { payment: { status: 'FAILED', verification: { failure_code: 'PROVIDER_ERROR' } } }));
    },
  } });
  const tree = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return page.default(); };
  const nodes = () => checkoutNodes(tree());
  const select = (file) => {
    const input = nodes().find((node) => node.props?.id === 'payment-slip');
    const target = { files: file ? [file] : [], value: file?.name || '' };
    const done = input.props.onChange({ target });
    return { done, target, input };
  };
  return { tree, nodes, select, values, calls, timers, effects, routes };
}
const validSlip = { type: 'image/jpeg', size: 100, name: 'slip.jpg' };

test('valid selection auto-uploads once, suppresses duplicate events, hides picker and redirects on authoritative PAID', async () => {
  let resolveVerification;
  const f = paymentRuntime({ verify: () => new Promise((resolve) => { resolveVerification = resolve; }) });
  const first = f.select(validSlip);
  assert.equal(first.target.value, '');
  await first.input.props.onChange({ target: { files: [validSlip], value: 'same.jpg' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.filter((call) => call.url.endsWith('/slip')).length, 1);
  assert.ok(!f.nodes().some((node) => node.props?.type === 'file' || node.props?.type === 'submit'));
  assert.ok(f.calls[1].options.body.fields.every(([name]) => ['slip', 'mockScenario'].includes(name)));
  resolveVerification({ payment: { status: 'PAID' } }); await first.done;
  // Even a stale DOM handler cannot re-upload after success but before React rerenders.
  await first.input.props.onChange({ target: { files: [validSlip], value: 'same.jpg' } });
  assert.equal(f.calls.length, 2);
  f.tree(); f.effects[1]();
  const redirect = f.timers.find((timer) => timer.ms === 1100); assert.ok(redirect); redirect.callback();
  assert.deepEqual(f.routes, ['/orders/1']);
});

test('cancel, missing file and invalid types/sizes make zero upload requests', async () => {
  for (const file of [null, undefined, ...['application/pdf', 'image/gif', 'image/svg+xml', 'image/heic', 'image/heif', 'text/plain', 'application/zip', 'application/msword', 'application/x-msdownload'].map((type) => ({ ...validSlip, type })), { ...validSlip, size: 4194305 }]) {
    const f = paymentRuntime(); f.values[5] = 'previous error';
    const picked = f.select(file); await picked.done;
    assert.equal(f.calls.length, 0);
    assert.equal(picked.target.value, '');
    if (!file) assert.equal(f.values[5], 'previous error', 'cancel preserves state');
  }
});

test('JPEG/JPG, PNG and WebP up to exactly 4 MiB automatically use the existing slip endpoint', async () => {
  for (const [name, type] of [['slip.jpeg', 'image/jpeg'], ['slip.jpg', 'image/jpeg'], ['slip.png', 'image/png'], ['slip.webp', 'image/webp']]) {
    const f = paymentRuntime(); const file = { name, type, size: 4194304 };
    await f.select(file).done;
    assert.equal(f.calls.filter((call) => call.url.endsWith('/slip')).length, 1);
    assert.equal(f.calls[1].options.body.fields[0][1], file);
  }
});

test('provider failure allows the same file to be selected again without a submit button', async () => {
  let count = 0;
  const f = paymentRuntime({ verify: () => ++count === 1
    ? { payment: { status: 'FAILED', verification: { failure_code: 'AMOUNT_MISMATCH' } } }
    : { payment: { status: 'PAID' } } });
  const first = f.select(validSlip); await first.done;
  assert.equal(first.target.value, ''); assert.match(f.values[5], /ยอดเงินในสลิปไม่ตรง/);
  assert.equal(f.routes.length, 0);
  await f.select(validSlip).done;
  assert.equal(count, 2); assert.equal(f.values[1].payment.status, 'PAID');
});

test('already paid and reconciling results hide picker and never initiate another verification', async () => {
  for (const status of ['PAID', 'PROCESSING', 'SUBMITTED', 'VERIFYING']) {
    const f = paymentRuntime({ status });
    assert.ok(!f.nodes().some((node) => node.props?.type === 'file'));
    assert.equal(f.calls.length, 0);
  }
  for (const status of ['PAID', 'PROCESSING']) {
    const f = paymentRuntime({ attempt: () => ({ payment: { status } }) });
    await f.select(validSlip).done;
    assert.equal(f.calls.length, 1, 'latest backend attempt blocks upload');
  }
});

test('upload timeout leaves busy state, reconciles before retry, and status errors never expose a new picker', async () => {
  const f = paymentRuntime({ verify: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))),
    reconcile: () => { throw new Error('offline'); } });
  const picked = f.select(validSlip);
  await new Promise((resolve) => setImmediate(resolve));
  f.timers.find((timer) => timer.ms === 70000).callback(); await picked.done;
  assert.equal(f.values[4], false, 'spinner ends'); assert.equal(f.values[7], true); assert.equal(f.values[8], true);
  assert.ok(!f.nodes().some((node) => node.props?.type === 'file'));
  await picked.input.props.onChange({ target: { files: [validSlip], value: 'same.jpg' } });
  assert.equal(f.calls.filter((call) => call.url.endsWith('/slip')).length, 1);
});

test('mock scenario is sent by auto-upload only in local/test presentation', async () => {
  for (const environment of ['test', 'production']) {
    const f = paymentRuntime({ environment }); f.values[6] = 'recipient_mismatch';
    const nodes = f.nodes(); assert.equal(nodes.some((node) => node.type === 'select'), environment === 'test');
    await f.select(validSlip).done;
    const scenario = f.calls[1].options.body.fields.find(([name]) => name === 'mockScenario');
    assert.deepEqual(scenario, environment === 'test' ? ['mockScenario', 'recipient_mismatch'] : undefined);
  }
});

test('durable payment state distinguishes empty PENDING from verified/pending-finalization', () => {
  const { paymentNeedsReconciliation, orderPaymentPresentation } = component('frontend/lib/payment-presentation.mjs');
  const normalizedPresentation = (order, payment) => JSON.parse(JSON.stringify(orderPaymentPresentation(order, payment)));
  assert.equal(paymentNeedsReconciliation({ status: 'PENDING', verification_status: 'PENDING' }), false);
  assert.equal(paymentNeedsReconciliation({ status: 'PENDING', verification: { status: 'VERIFIED' } }), true);
  assert.equal(paymentNeedsReconciliation({ status: 'PAID', verification_status: 'VERIFIED' }), false);
  assert.deepEqual(normalizedPresentation({ status: 'PENDING', payment_status: 'UNPAID' }, null), {
    paid: false, processing: false, status: 'UNPAID', canPay: true,
  });
  assert.deepEqual(normalizedPresentation({ status: 'PENDING', payment_status: 'UNPAID' }, { status: 'PROCESSING' }), {
    paid: false, processing: true, status: 'PENDING_VERIFICATION', canPay: false,
  });
  assert.deepEqual(normalizedPresentation({ status: 'PENDING', payment_status: 'UNPAID' }, { status: 'PENDING', reconciliation_available: true }), {
    paid: false, processing: true, status: 'PENDING_VERIFICATION', canPay: false,
  });
  assert.deepEqual(normalizedPresentation({ status: 'PENDING', payment_status: 'PAID' }, null), {
    paid: true, processing: false, status: 'PAID', canPay: false,
  });
});

test('stored-slip reconciliation uses the dedicated endpoint and never exposes another upload picker', async () => {
  const f = paymentRuntime({ reconcile: () => ({ payment: { status: 'PAID', verification_status: 'VERIFIED' } }) });
  f.values[1] = { payment: { status: 'PROCESSING', verification_status: 'PROCESSING', reconciliation_available: true, reconciliation_required: true } };
  assert.ok(!f.nodes().some((node) => node.props?.type === 'file'));
  assert.ok(!f.nodes().some((node) => node.type === 'img' && String(node.props?.alt || '').includes('QR Code')));
  const cleanup = f.effects[4]();
  await new Promise((resolve) => setImmediate(resolve));
  const call = f.calls.find((entry) => entry.url.endsWith('/payment/reconcile'));
  assert.ok(call);
  assert.ok(!f.calls.some((entry) => entry.url.endsWith('/payment/qr')));
  assert.equal(call.options.method, 'POST');
  assert.equal(f.values[1].payment.status, 'PAID');
  cleanup();
});

test('refresh recovers authoritative payment before allowing upload; reconciliation polls to PAID', async () => {
  for (const status of ['PAID', 'PROCESSING', 'PENDING']) {
    let current = status;
    const f = paymentRuntime({ reconcile: () => ({ payment: { status: current } }) });
    f.values[0] = null; f.values[1] = null; f.values[2] = null;
    f.tree(); const cleanup = f.effects[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.calls.map((call) => call.url), ['/api/orders/1', '/api/orders/1/payment']);
    assert.equal(f.values[1].payment.status, status);
    assert.ok(!f.nodes().some((node) => node.props?.type === 'file'));
    if (status === 'PROCESSING') {
      f.effects[2](); current = 'PAID';
      await f.timers.find((timer) => timer.ms === 2000).callback();
      assert.equal(f.values[1].payment.status, 'PAID');
      f.tree(); f.effects[1]();
      f.timers.find((timer) => timer.ms === 1100).callback();
      assert.deepEqual(f.routes, ['/orders/1']);
    }
    assert.ok(f.calls.every((call) => !call.options?.method), 'recovery never creates or uploads a new attempt');
    cleanup();
  }
});

test('QR save reuses exact server PNG with safe filename and gracefully handles unsupported/download/share failures', async () => {
  const { savePaymentQr, qrDownloadName } = component('frontend/lib/payment-presentation.mjs');
  const image = 'data:image/png;base64,aGVsbG8=';
  let clicked = 0, removed = 0; const anchor = { download: '', click() { clicked++; }, remove() { removed++; } };
  assert.equal(await savePaymentQr(image, 'LOC-000013', { document: { createElement: () => anchor, body: { appendChild() {} } } }), 'downloaded');
  assert.equal(anchor.href, image); assert.equal(anchor.download, 'promptpay-LOC-000013.png'); assert.equal(clicked, 1); assert.equal(removed, 1);
  assert.equal(qrDownloadName('../LOC/13?x'), 'promptpay-LOC13x.png');
  assert.equal(await savePaymentQr(image, 'LOC-1', { document: { createElement: () => ({}) } }), 'fallback');
  assert.equal(await savePaymentQr('javascript:bad', 'LOC-1', {}), 'fallback');
  assert.equal(await savePaymentQr(image, 'LOC-1', { document: { createElement() { throw new Error('unavailable'); } } }), 'fallback');
  class FakeFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } }
  const browser = { atob: () => 'hello', File: FakeFile, navigator: { canShare: () => true, share: async ({ files }) => { assert.equal(files[0].name, 'promptpay-LOC-1.png'); } } };
  assert.equal(await savePaymentQr(image, 'LOC-1', browser), 'shared');
  browser.navigator.share = async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; };
  assert.equal(await savePaymentQr(image, 'LOC-1', browser), 'cancelled');
});

test('payment responsive contract caps QR/container and preserves touch/focus/safe-area', () => {
  const css = read('frontend/app/orders/[id]/payment/payment.module.css');
  assert.match(css, /max-width: 520px/); assert.match(css, /max-width: 100%/);
  assert.match(css, /payment-page-content\) \{[^}]*padding: 16px/);
  assert.match(css, /\.qr img \{ width: 240px/);
  assert.match(css, /\.qr img \{ width: 270px/);
  assert.match(css, /min-height: 52px/); assert.match(css, /focus-visible/); assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /overflow-wrap: anywhere/);
});

const checkoutSections = 'frontend/components/customer/checkout-sections.js';
const checkoutAddresses = [
  { id: 1, label: 'Home', dormitory_name: 'Local Dorm A', room_number: 'A-101', soi_name: 'Local Soi 1' },
  { id: 2, label: 'Work', dormitory_name: 'Local Dorm B', room_number: 'B-202', soi_name: 'Local Soi 2' },
];
function checkoutNodes(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(checkoutNodes);
  return [value, ...checkoutNodes(value.props?.children)];
}

function checkoutUiRuntime(name, props, globals = {}) {
  const values = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0;
  const loaded = component(checkoutSections, { globals, hooks: {
    useId: () => 'checkout-ui',
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], (value) => { values[i] = value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] || (refs[i] = { current: initial }); },
    useEffect: (effect) => effects.push(effect),
  } });
  function tree() { stateIndex = 0; refIndex = 0; effects.length = 0; return loaded[name](props); }
  return { tree, props, refs, effects, find: (predicate) => checkoutNodes(tree()).find(predicate) };
}

test('checkout address is one summary with a labelled dialog, not a native select', () => {
  const html = render(checkoutSections, 'CheckoutAddress', { addresses: checkoutAddresses, addressId: '1', selectedAddress: checkoutAddresses[0] });
  for (const label of ['ที่อยู่จัดส่ง', 'Home · Local Dorm A', 'ห้อง A-101', 'Local Soi 1', 'เปลี่ยน']) assert.ok(html.includes(label));
  assert.match(html, /<dialog[^>]+aria-modal="true" aria-labelledby=/);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
  assert.doesNotMatch(html, /<select|<dialog[^>]+ open/);
  const empty = render(checkoutSections, 'CheckoutAddress', { addresses: [], addressId: '' });
  assert.match(empty, /กรุณาเพิ่มที่อยู่/); assert.doesNotMatch(empty, /<dialog|<button/);
});

test('checkout address dialog forwards the unchanged saved ID and restores trigger focus', () => {
  let index = 0, opened = 0, closed = 0, focused = 0;
  const refs = [], changes = [], state = [];
  const { CheckoutAddress } = component(checkoutSections, { hooks: {
    useId: () => 'checkout-address', useState: () => [false, (value) => state.push(value)],
    useRef: () => refs[index++] || (refs[index - 1] = { current: null }),
  } });
  const nodes = checkoutNodes(CheckoutAddress({ addresses: checkoutAddresses, addressId: '1', selectedAddress: checkoutAddresses[0], onChange: (event) => changes.push(event.target.value) }));
  const dialog = nodes.find((n) => n.type === 'dialog');
  dialog.props.ref.current = { showModal: () => opened++, close: () => closed++, querySelector: () => ({ focus: () => focused++ }) };
  const trigger = nodes.find((n) => n.props?.['aria-haspopup'] === 'dialog');
  trigger.props.ref.current = { focus: () => focused++ };
  trigger.props.onClick(); assert.equal(opened, 1); assert.equal(focused, 1);
  nodes.find((n) => n.props?.['aria-pressed'] === false).props.onClick();
  assert.deepEqual(changes, ['2']); assert.equal(closed, 1);
  dialog.props.onClose(); assert.equal(focused, 2); assert.deepEqual(state, [true, false]);
});

test('checkout summary shares local-demo translations and preserves real merchant labels and line amounts', () => {
  const cart = { merchantName: 'Local Kitchen', items: [cartItem, { ...cartItem, id: 'rice', menuItemId: 2,
    name: 'Garlic Chicken Rice', imageUrl: '/demo/garlic-chicken.svg', quantity: 1,
    choices: [{ id: 99, groupName: 'Rice', name: 'Jasmine rice', extraPrice: 0 }] }] };
  const before = JSON.stringify(cart);
  const html = render(checkoutSections, 'CheckoutItems', { cart }, { globals: { process: { env: { NODE_ENV: 'development' } } } });
  for (const label of ['รายการอาหาร', 'href="/cart"', 'แก้ไข', '2 × Local Basil Rice', 'ระดับความเผ็ด: ไม่เผ็ด', 'ไข่ดาว', 'ชนิดข้าว: ข้าวหอมมะลิ', '฿140', 'หมายเหตุ:']) assert.ok(html.includes(label), label);
  const production = render(checkoutSections, 'CheckoutItems', { cart }, { globals: { process: { env: { NODE_ENV: 'production' } } } });
  assert.match(production, /Spiciness: Mild/); assert.match(production, /Rice: Jasmine rice/);
  assert.equal(JSON.stringify(cart), before);
});

test('checkout totals use authoritative quote and hide exactly zero discount', () => {
  for (const discount of ['0.00', '30.00']) {
    const html = render(checkoutSections, 'CheckoutTotals', { quote: { subtotal_amount: '435.00', delivery_fee: '15.00',
      discount_amount: discount, total_amount: discount === '0.00' ? '450.00' : '420.00', coupon_snapshot: { code: 'FIXTURE' } } });
    assert.equal(html.includes('ส่วนลด'), discount !== '0.00');
    for (const label of ['ค่าอาหาร', 'ค่าส่ง', 'ยอดสุทธิ', '฿435', discount === '0.00' ? '฿450' : '฿420']) assert.ok(html.includes(label));
    assert.doesNotMatch(html, /−฿0/);
  }
  assert.doesNotMatch(render(checkoutSections, 'CheckoutTotals', { quote: null }), /฿0/);
});

test('checkout selected promotion/coupon has removal and the original mutually-exclusive policy helper', () => {
  const props = { promotions: [{ id: 11, name: 'Lunch offer' }], promotionId: '11', couponInput: '', couponCode: '',
    onPromotionChange() {}, onCouponInput() {}, onApplyCoupon() {}, onRemoveCoupon() {} };
  let html = render(checkoutSections, 'CheckoutDiscounts', props);
  for (const label of ['ส่วนลด', 'โปรโมชัน', 'มีโค้ดส่วนลด?', 'เลือกใช้โปรโมชันหรือโค้ดส่วนลดอย่างใดอย่างหนึ่ง', 'ไม่ใช้โปรโมชัน']) assert.ok(html.includes(label));
  html = render(checkoutSections, 'CheckoutDiscounts', { ...props, promotionId: '', couponCode: 'FIXTURE', quote: { coupon_snapshot: { code: 'FIXTURE' }, discount_amount: '30.00' } });
  assert.match(html, /นำคูปองออก/); assert.doesNotMatch(html, /นำโปรโมชันออก/);
  const changes = [];
  const tree = component(checkoutSections).CheckoutPromotion({ ...props, onChange: (event) => changes.push(event.target.value) });
  checkoutNodes(tree).find((n) => n.type === 'button').props.onClick();
  assert.deepEqual(changes, ['']);
});

function checkoutRuntime({ quoteResponse, timers = {} } = {}) {
  const values = [checkoutAddresses, '1', { accepting_orders: true, delivery: { available: true, fee: 15 } },
    [{ id: 11, name: 'Lunch offer' }], '', '', '', null, '', false, false, '', 1,
    { pending: false, key: null, kind: null, error: '' }];
  const requests = [], navigations = [], refs = [], effects = [];
  let index = 0, refIndex = 0, clears = 0;
  const loaded = component('frontend/app/checkout/page.js', {
    cart: { ...cartData, clear: () => clears++ }, router: { replace: (url) => navigations.push(url) },
    hooks: {
      useState: () => { const i = index++; return [values[i], (value) => { values[i] = value; }]; },
      useRef: (initial) => { const i = refIndex++; return refs[i] || (refs[i] = { current: initial }); }, useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
    },
    globals: { ...timers, crypto: { randomUUID: () => 'fixture-idempotency-key' }, fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (url === '/api/orders/quote' && quoteResponse) {
        const response = await quoteResponse(JSON.parse(options.body), options);
        if (response !== undefined) return response;
      }
      const intent = options?.body ? JSON.parse(options.body) : {};
      const body = url.startsWith('/api/merchants/') ? { merchant: { accepting_orders: true, delivery: { available: true, fee: 25 } } }
        : url === '/api/orders/quote' ? { quote: { subtotal_amount: '140.00', delivery_fee: values[2].delivery.fee,
          discount_amount: intent.couponCode ? '10.00' : '0.00', total_amount: intent.couponCode ? '155.00' : '165.00',
          coupon_snapshot: intent.couponCode ? { code: intent.couponCode } : null,
          promotion_snapshot: intent.promotionId ? { id: intent.promotionId, name: 'Lunch offer' } : null } }
          : { order: { id: 'fixture-order' } };
      return { ok: true, status: 200, json: async () => body };
    } },
  });
  function tree() { index = 0; refIndex = 0; effects.length = 0; return loaded.default(); }
  function find(predicate) { return checkoutNodes(tree()).find(predicate); }
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { values, requests, navigations, refs, tree, find, clears: () => clears,
    async quote() { tree(); effects[2](); await settle(); }, settle,
    unmount() { tree(); effects[2]()?.(); } };
}

test('checkout regression blank coupon cannot invalidate the current quote', async () => {
  const f = checkoutRuntime(); await f.quote();
  const before = f.values[7];
  f.find((n) => n.type?.name === 'CheckoutDiscounts').props.onApplyCoupon();
  assert.equal(f.values[7], before);
});

test('checkout regression empty apply control is semantically disabled', () => {
  const html = render(checkoutSections, 'CheckoutDiscounts', { promotions: [], promotionId: '', couponInput: '   ', couponCode: '', onCouponInput() {} });
  assert.match(html, /<button[^>]*disabled=""[^>]*>ใช้โค้ด<\/button>/);
});

for (const input of ['', ' ', '     ']) test(`checkout blank/Enter guard makes no request (${JSON.stringify(input)})`, async () => {
  const f = checkoutRuntime(); await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  discounts().props.onCouponInput({ target: { value: input } });
  const before = f.requests.length;
  const ui = checkoutUiRuntime('CheckoutDiscounts', discounts().props);
  const button = ui.find((n) => n.type === 'button' && n.props.type === 'submit');
  assert.equal(button.props.disabled, true); assert.equal(button.props['aria-disabled'], true);
  let prevented = false;
  await ui.find((n) => n.type === 'form').props.onSubmit({ preventDefault: () => { prevented = true; } });
  await discounts().props.onApplyCoupon(); // Defense in depth, bypassing the DOM guard.
  assert.equal(prevented, true); assert.equal(f.requests.length, before);
  assert.equal(discounts().props.quoting, false);
});

test('checkout one coupon action ignores repeated clicks/Enter and preserves total while pending', async () => {
  let release;
  const f = checkoutRuntime({ quoteResponse: (intent) => intent.couponCode ? new Promise((resolve) => { release = resolve; }) : undefined });
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  const cta = () => f.find((n) => n.props?.['aria-busy'] !== undefined && n.type === 'button');
  discounts().props.onCouponInput({ target: { value: ' welcome10 ' } });
  const ui = checkoutUiRuntime('CheckoutDiscounts', discounts().props);
  const submit = ui.find((n) => n.type === 'form').props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  await discounts().props.onApplyCoupon();
  assert.equal(f.requests.filter((r) => r.url === '/api/orders/quote').length, 2); // Initial + one action.
  assert.equal(discounts().props.quoting, true); assert.equal(f.values[6], '');
  assert.equal(cta().props.disabled, true);
  assert.equal(f.find((n) => n.type?.name === 'CheckoutTotals').props.quote.total_amount, '165.00');
  assert.equal(checkoutNodes(f.tree()).some((n) => n.type?.name === 'LoadingCards'), false);
  release(undefined); await first;
  assert.equal(f.values[6], 'WELCOME10'); assert.equal(discounts().props.quoting, false);
  assert.equal(cta().props.disabled, false);
  assert.equal(discounts().props.quote.total_amount, '155.00');
  const before = f.requests.length;
  await discounts().props.onApplyCoupon(); await f.quote();
  assert.equal(f.requests.length, before); // No same-value or effect-driven duplicate refresh.
});

for (const kind of ['coupon_unavailable', 'coupon_minimum_not_met', 'invalid_coupon_code', 'network', 'http500', 'malformed', 'missing-money', 'wrong-coupon']) {
  test(`checkout coupon ${kind} settles, preserves confirmed promotion/total and permits retry`, async () => {
    let fail = true;
    const f = checkoutRuntime({ quoteResponse: (intent) => {
      if (!intent.couponCode || !fail) return;
      if (kind === 'network') throw new Error('private network diagnostic');
      if (kind === 'malformed') return { ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } };
      if (kind === 'missing-money') return { ok: true, status: 200, json: async () => ({ quote: {} }) };
      if (kind === 'wrong-coupon') return { ok: true, status: 200, json: async () => ({ quote: { subtotal_amount: '140.00', delivery_fee: 25, discount_amount: '10.00', total_amount: '155.00', coupon_snapshot: { code: 'WRONG' } } }) };
      return { ok: false, status: kind === 'http500' ? 500 : 422, json: async () => ({ error: kind, message: 'private SQL diagnostic' }) };
    } });
    await f.quote();
    const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
    await discounts().props.onPromotionChange({ target: { value: '11' } });
    const before = f.values[7];
    discounts().props.onCouponInput({ target: { value: 'bad' } });
    await discounts().props.onApplyCoupon();
    assert.equal(discounts().props.quoting, false); assert.equal(f.values[7], before);
    assert.equal(f.values[4], '11'); assert.equal(f.values[6], '');
    assert.equal(f.find((n) => n.type === 'button' && n.props['aria-busy'] !== undefined).props.disabled, false);
    const html = render(checkoutSections, 'CheckoutDiscounts', discounts().props);
    assert.match(html, /role="alert"/); assert.match(html, /<input id="coupon-code"/);
    assert.doesNotMatch(html, /private|SQL|กำลังตรวจสอบ/);
    assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?Lunch offer/);
    fail = false;
    await discounts().props.onApplyCoupon();
    assert.equal(discounts().props.discountError, ''); assert.equal(f.values[6], 'BAD');
    assert.equal(f.values[4], ''); assert.equal(discounts().props.quote.total_amount, '155.00');
  });
}

test('checkout promotion failure preserves coupon, success switches only after quote and repeat selection is a no-op', async () => {
  let rejectPromotion = true;
  const f = checkoutRuntime({ quoteResponse: (intent) => {
    if (intent.promotionId && rejectPromotion) return { ok: false, status: 422, json: async () => ({ error: 'promotion_unavailable' }) };
  } });
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  discounts().props.onCouponInput({ target: { value: 'fixture' } }); await discounts().props.onApplyCoupon();
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  assert.equal(discounts().props.quoting, false); assert.equal(f.values[6], 'FIXTURE');
  assert.equal(f.values[4], ''); assert.equal(discounts().props.quote.total_amount, '155.00');
  rejectPromotion = false;
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  assert.equal(f.values[6], ''); assert.equal(f.values[4], '11');
  assert.equal(discounts().props.quote.promotion_snapshot.id, 11);
  const before = f.requests.length;
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  await f.quote(); assert.equal(f.requests.length, before); assert.equal(discounts().props.quoting, false);
});

test('checkout timeout releases pending even when transport does not respond to abort', async () => {
  let expire, aborted = false;
  const f = checkoutRuntime({ timers: { setTimeout: (fn) => { expire = fn; return 1; }, clearTimeout() {} },
    quoteResponse: (intent, options) => {
      if (intent.couponCode) { options.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }
    } });
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  discounts().props.onCouponInput({ target: { value: 'fixture' } });
  const pending = discounts().props.onApplyCoupon(); expire(); await pending;
  assert.equal(aborted, true); assert.equal(discounts().props.quoting, false);
  assert.equal(discounts().props.quote.total_amount, '165.00'); assert.equal(f.values[6], '');
  assert.equal(discounts().props.discountError, 'quote_failed');
});

test('checkout cancellation ignores late discount result and a new address gets its own authoritative quote', async () => {
  let release;
  const f = checkoutRuntime({ quoteResponse: (intent) => intent.couponCode ? new Promise((resolve) => { release = resolve; }) : undefined });
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  discounts().props.onCouponInput({ target: { value: 'fixture' } });
  const pending = discounts().props.onApplyCoupon();
  const before = f.values[7];
  f.unmount(); await pending;
  release(undefined); await f.settle();
  assert.equal(f.values[7], before); assert.equal(f.values[6], '');
  f.find((n) => n.type?.name === 'CheckoutAddress').props.onChange({ target: { value: '2' } });
  await f.settle(); await f.quote();
  assert.equal(discounts().props.quoting, false);
  assert.equal(JSON.parse(f.values[7].key).addressId, 2);
});

test('checkout initial quote failure stops skeleton, keeps confirm disabled and offers bounded retry', async () => {
  let fail = true;
  const f = checkoutRuntime({ quoteResponse: () => { if (fail) throw new Error('offline'); } });
  await f.quote();
  assert.equal(f.find((n) => n.type?.name === 'CheckoutDiscounts').props.quoting, false);
  assert.equal(checkoutNodes(f.tree()).some((n) => n.type?.name === 'LoadingCards'), false);
  assert.equal(f.find((n) => n.type === 'button' && n.props['aria-busy'] !== undefined).props.disabled, true);
  fail = false;
  await f.find((n) => n.type === 'button' && n.props.children === 'ลองตรวจสอบยอดอีกครั้ง').props.onClick();
  assert.equal(f.find((n) => n.type === 'button' && n.props['aria-busy'] !== undefined).props.disabled, false);
});

test('checkout cancellation returning to a confirmed payload does not leave pending or request again', async () => {
  const f = checkoutRuntime({ quoteResponse: (intent) => intent.couponCode ? new Promise(() => {}) : undefined });
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  discounts().props.onCouponInput({ target: { value: 'fixture' } });
  const pending = discounts().props.onApplyCoupon();
  f.unmount(); await pending;
  const requests = f.requests.length;
  await f.quote();
  assert.equal(f.requests.length, requests); assert.equal(discounts().props.quoting, false);
  assert.equal(discounts().props.quote.total_amount, '165.00');
});

test('checkout mock flow preserves address/note, promotion XOR coupon, authoritative quote and order payload', async () => {
  const f = checkoutRuntime();
  await f.quote();
  const address = () => f.find((n) => n.type?.name === 'CheckoutAddress');
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  const submit = () => f.find((n) => n.type === 'button' && n.props.onClick);
  address().props.onChange({ target: { value: '2' } }); await f.settle();
  assert.equal(f.values[1], '2'); assert.equal(f.values[2].delivery.fee, 25);
  assert.equal(submit().props.disabled, true);
  f.find((n) => n.type?.name === 'CheckoutDeliveryNote').props.onChange({ target: { value: 'ฝากไว้ที่ล็อบบี้' } });
  await f.quote();
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  assert.equal(f.values[4], '11'); assert.equal(f.values[6], '');
  await discounts().props.onPromotionChange({ target: { value: '' } });
  assert.equal(f.values[4], ''); assert.equal(f.values[7].value.promotion_snapshot, null);
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  discounts().props.onCouponInput({ target: { value: ' fixture ' } });
  await discounts().props.onApplyCoupon();
  assert.equal(f.values[4], ''); assert.equal(f.values[6], 'FIXTURE');
  await f.quote();
  assert.equal(f.find((n) => n.type?.name === 'CheckoutTotals').props.quote.total_amount, '155.00');
  assert.equal(submit().props.disabled, false);
  const pending = submit().props.onClick();
  assert.equal(submit().props.disabled, true); assert.equal(submit().props['aria-busy'], true);
  await pending;
  const order = f.requests.find((r) => r.url === '/api/orders');
  assert.deepEqual(JSON.parse(order.body), { merchantId: 1, addressId: 2, deliveryType: 'DELIVERY', deliveryNote: 'ฝากไว้ที่ล็อบบี้',
    promotionId: null, couponCode: 'FIXTURE', items: [{ menuItemId: 1, quantity: 2, note: cartItem.note, optionChoiceIds: [11, 21] }] });
  assert.equal(order.headers['Idempotency-Key'], 'fixture-idempotency-key');
  assert.equal(f.clears(), 1); assert.deepEqual(f.navigations, ['/orders/fixture-order/payment']);
  assert.equal(f.requests.filter((r) => r.url === '/api/orders').length, 1);
  await discounts().props.onRemoveCoupon(); assert.equal(f.values[6], ''); assert.equal(f.values[7].value.coupon_snapshot, null);
});

test('checkout stale quote and invalid-order guards stay disabled; retried handler retains idempotency key', async () => {
  const f = checkoutRuntime();
  const button = () => f.find((n) => n.type === 'button');
  assert.equal(button().props.disabled, true);
  await f.quote();
  for (const [index, invalid] of [[0, []], [9, true], [10, true], [7, null],
    [2, { accepting_orders: false, delivery: { available: true, fee: 15 } }],
    [2, { accepting_orders: true, delivery: { available: false } }]]) {
    const previous = f.values[index]; f.values[index] = invalid;
    assert.equal(button().props.disabled, true);
    f.values[index] = previous;
  }
  const handler = button().props.onClick;
  await Promise.all([handler(), handler()]);
  const requests = f.requests.filter((r) => r.url === '/api/orders');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(requests[0].body, requests[1].body);
});

test('checkout mobile/desktop contract reserves navigation space, constrains sheet and keeps 54px confirm', () => {
  const css = read('frontend/components/customer/checkout.module.css');
  for (const pattern of [/padding: 16px 16px 130px/, /bottom: calc\(69px \+ env\(safe-area-inset-bottom\)\)/,
    /width: min\(100%, 760px\)/, /max-height: 80dvh/, /overflow-y: auto/, /minmax\(0, 1fr\) auto/,
    /min-height: 54px/, /background: #ac3520/, /@media \(min-width: 640px\)/, /width: min\(560px, calc\(100% - 32px\)\)/]) assert.match(css, pattern);
  const source = read('frontend/app/checkout/page.js');
  assert.ok(source.indexOf('<CheckoutAddress') < source.indexOf('<CheckoutItems'));
  assert.ok(source.indexOf('<CheckoutDeliveryNote') < source.indexOf('</CheckoutAddress>'));
  assert.equal((source.match(/<CheckoutDeliveryNote/g) || []).length, 1);
  assert.doesNotMatch(source, /<textarea|styles.note/);
  assert.ok(source.indexOf('<CheckoutDiscounts') < source.indexOf('<CheckoutTotals'));
  assert.ok(source.indexOf('<CheckoutDiscounts') < source.indexOf('<CheckoutPayment'));
  assert.ok(source.indexOf('<CheckoutPayment') < source.indexOf('<CheckoutTotals'));
  assert.ok(source.indexOf('<CheckoutTotals') < source.indexOf('className={styles.confirmBar}'));
  assert.match(read(checkoutSections), /maxLength=\{1000\}/);
  assert.doesNotMatch(source, /checkout-address-select/);
});

test('checkout promotion list renders unchanged options with Thai discount metadata without nested dialog/select', () => {
  const promotions = [
    { id: 3, name: 'Welcome delivery', promotion_type: 'FREE_DELIVERY', minimum_order_amount: '50.00' },
    { id: 4, name: 'Lunch', promotion_type: 'PERCENTAGE', value: '10.00', maximum_discount_amount: '30.00', ends_at: '2030-12-20T00:00:00Z' },
    { id: 5, name: 'Dinner', promotion_type: 'FIXED_AMOUNT', value: '25.00' },
  ];
  const before = JSON.stringify(promotions);
  const html = render(checkoutSections, 'CheckoutPromotion', { promotions, promotionId: '4', onChange() {} });
  for (const text of ['ไม่ใช้โปรโมชัน', 'ส่งฟรี', 'ขั้นต่ำ ฿50', 'ลด 10%', 'สูงสุด ฿30', 'ใช้ได้ถึง', 'ลด ฿25']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<dialog|aria-haspopup/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(html, /<select|PERCENTAGE|FREE_DELIVERY|FIXED_AMOUNT/);
  const loading = render(checkoutSections, 'CheckoutPromotion', { promotions: [], promotionId: '', loading: true, onChange() {} });
  assert.match(loading, /role="status"/); assert.match(loading, /กำลังโหลดโปรโมชัน/); assert.doesNotMatch(loading, /<button/);
  assert.equal(JSON.stringify(promotions), before);
});

test('checkout promotion selection/none preserves original ID events in the combined sheet', () => {
  const values = [];
  const { CheckoutPromotion } = component(checkoutSections);
  const nodes = checkoutNodes(CheckoutPromotion({ promotions: [{ id: 31, name: 'Offer' }], promotionId: '',
    onChange: (event) => values.push(event.target.value) }));
  nodes.find((n) => n.props?.['aria-pressed'] === false).props.onClick();
  assert.deepEqual(values, ['31']);
  nodes.find((n) => n.props?.['aria-pressed'] === true).props.onClick();
  assert.deepEqual(values, ['31', '']);
});

test('checkout dialog backdrop closes only a gesture that starts and ends outside; content/padding stay open', () => {
  const { checkoutBackdrop } = component(checkoutSections);
  let closed = 0;
  const dialog = { dataset: {}, getBoundingClientRect: () => ({ left: 10, top: 10, right: 300, bottom: 600 }), close: () => closed++ };
  const event = (x, y, target = dialog) => ({ currentTarget: dialog, target, clientX: x, clientY: y });
  checkoutBackdrop.onPointerDown(event(20, 20));
  checkoutBackdrop.onClick(event(0, 0)); assert.equal(closed, 0);
  checkoutBackdrop.onPointerDown(event(20, 20, {}));
  checkoutBackdrop.onClick(event(20, 20, {})); assert.equal(closed, 0);
  checkoutBackdrop.onPointerDown(event(20, 20));
  checkoutBackdrop.onClick(event(20, 20)); assert.equal(closed, 0);
  checkoutBackdrop.onPointerDown(event(0, 0));
  checkoutBackdrop.onClick(event(0, 0)); assert.equal(closed, 1);
  assert.equal(dialog.dataset.backdropStart, undefined);
});

test('checkout coupon success requires matching current quote; pending/failure keep labelled input and safe error', () => {
  const props = { promotions: [], promotionId: '', couponInput: 'WELCOME10', couponCode: 'WELCOME10',
    onCouponInput() {}, onPromotionChange() {}, onApplyCoupon() {}, onRemoveCoupon() {} };
  const quote = { coupon_snapshot: { code: 'WELCOME10' }, discount_amount: '30.00' };
  const success = render(checkoutSections, 'CheckoutDiscounts', { ...props, quote });
  assert.doesNotMatch(success, /<input/); assert.match(success, /role="status"/);
  assert.match(success, /ลด ฿30/); assert.match(success, /นำคูปองออก/);
  for (const candidate of [{}, { quote: { ...quote, coupon_snapshot: { code: 'OTHER' } } }]) {
    const html = render(checkoutSections, 'CheckoutDiscounts', { ...props, ...candidate });
    assert.match(html, /<input id="coupon-code"/); assert.doesNotMatch(html, /ลด ฿30/);
  }
  const retained = render(checkoutSections, 'CheckoutDiscounts', { ...props, quote, quoting: true, pendingKind: 'remove' });
  assert.match(retained, /ลด ฿30/); assert.doesNotMatch(retained, /<input/);
  const pending = render(checkoutSections, 'CheckoutDiscounts', { ...props, quoting: true, pendingKind: 'coupon' });
  assert.match(pending, /disabled="" aria-busy="true"/); assert.match(pending, /กำลังตรวจสอบ/);
  const failed = render(checkoutSections, 'CheckoutDiscounts', { ...props, discountError: 'coupon_unavailable', pendingKind: 'coupon' });
  assert.match(failed, /aria-invalid="true" aria-describedby="checkout-coupon-error"/);
  assert.match(failed, /id="checkout-coupon-error"[^>]+role="alert"/);
  assert.match(failed, /ไม่พบโค้ดที่พร้อมใช้งาน/);
  const calls = [];
  const tree = checkoutUiRuntime('CheckoutDiscounts', { ...props, quote, onRemoveCoupon: () => calls.push('remove') }).tree();
  checkoutNodes(tree).find((n) => n.props?.['aria-label'] === 'นำคูปองออก').props.onClick();
  assert.deepEqual(calls, ['remove']);
});

test('checkout discount selection follows quote, never selects promotion with coupon, and retains original events', () => {
  const props = { promotions: [{ id: 4, name: 'Offer four' }, { id: 5, name: 'Offer five' }], promotionId: '4', couponInput: '', couponCode: '', onCouponInput() {} };
  for (const [overrides, expected] of [
    [{}, 'Offer four'],
    [{ promotionId: '5', quoting: true }, 'Offer five'],
    [{ quote: { promotion_snapshot: { id: 5 } } }, 'Offer five'],
    [{ quote: { promotion_snapshot: null } }, 'ไม่ใช้โปรโมชัน'],
    [{ couponCode: 'WELCOME10', quote: { coupon_snapshot: { code: 'WELCOME10' }, discount_amount: '30.00' } }, null],
    [{ couponCode: '', quoting: true, pendingKind: 'coupon', quote: { promotion_snapshot: { id: 4 } } }, 'Offer four'],
  ]) {
    const html = render(checkoutSections, 'CheckoutDiscounts', { ...props, ...overrides });
    const selected = [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)];
    assert.equal(selected.length, expected ? 1 : 0);
    if (expected) assert.ok(selected[0][1].includes(expected));
  }
  const calls = [];
  const { CheckoutPromotion } = component(checkoutSections);
  const options = checkoutNodes(CheckoutPromotion({ ...props, couponActive: true, onChange: (e) => calls.push(e.target.value) }));
  const buttons = options.filter((n) => n.type === 'button');
  assert.ok(buttons.every((n) => n.props['aria-pressed'] === false));
  assert.ok(options.filter((n) => n.type?.name === 'Icon').every((n) => n.props.name !== 'check'));
  buttons[2].props.onClick(); assert.deepEqual(calls, ['5']);
});

test('checkout discount coupon apply/remove and promotion reselection retain quote and payload authority', async () => {
  const f = checkoutRuntime();
  await f.quote();
  const discounts = () => f.find((n) => n.type?.name === 'CheckoutDiscounts');
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  discounts().props.onCouponInput({ target: { value: 'fixture' } });
  await discounts().props.onApplyCoupon(); await f.quote();
  let html = render(checkoutSections, 'CheckoutDiscounts', discounts().props);
  assert.doesNotMatch(html, /aria-pressed="true"|<input/);
  assert.match(html, /ลด ฿10/);
  await discounts().props.onRemoveCoupon();
  html = render(checkoutSections, 'CheckoutDiscounts', discounts().props);
  assert.match(html, /<input id="coupon-code"/);
  await discounts().props.onPromotionChange({ target: { value: '11' } });
  await f.quote();
  const body = JSON.parse(f.requests.filter((r) => r.url === '/api/orders/quote').at(-1).body);
  assert.equal(body.promotionId, 11); assert.equal(body.couponCode, null);
  assert.equal(discounts().props.quote.total_amount, '165.00');
  assert.equal(f.requests.filter((r) => r.url === '/api/orders').length, 0);
});

test('checkout discount keyboard viewport handling keeps input/apply together and cleans up on close', () => {
  const viewport = new EventTarget(); Object.assign(viewport, { height: 844, offsetTop: 0 });
  const values = new Map(); let scrolls = 0;
  const input = { id: 'coupon-code', parentElement: { scrollIntoView: (opts) => { assert.equal(opts.block, 'nearest'); scrolls++; } } };
  const doc = { activeElement: input };
  let opened = true;
  const sheet = { style: { setProperty: (k, v) => values.set(k, v), removeProperty: (k) => values.delete(k) }, contains: (node) => node === input };
  const effects = [];
  let index = 0;
  const { CheckoutDiscounts } = component(checkoutSections, { globals: { window: { visualViewport: viewport, innerHeight: 844 }, document: doc },
    hooks: { useRef: () => ({ current: index++ === 0 ? sheet : null }), useState: () => [opened, () => {}], useId: () => 'fixture', useEffect: (fn) => effects.push(fn) } });
  const props = { promotions: [], promotionId: '', couponInput: '', couponCode: '' };
  const tree = CheckoutDiscounts(props);
  const cleanup = effects[1]();
  viewport.height = 480; viewport.dispatchEvent(new Event('resize'));
  assert.equal(values.get('--discount-visible-height'), '480px');
  assert.equal(values.get('--discount-keyboard-offset'), '364px');
  viewport.offsetTop = 30; viewport.dispatchEvent(new Event('scroll'));
  assert.equal(values.get('--discount-keyboard-offset'), '334px');
  checkoutNodes(tree).find((n) => n.type === 'input').props.onFocus({ currentTarget: input });
  assert.equal(scrolls, 4);
  cleanup(); assert.equal(values.size, 0);
  viewport.dispatchEvent(new Event('resize')); assert.equal(scrolls, 4);
  opened = false; index = 0; effects.length = 0; CheckoutDiscounts(props);
  assert.equal(effects[1](), undefined);
});

test('checkout discount responsive/style contract scopes sheet below 768 and preserves accessible solid controls', () => {
  const css = read('frontend/components/customer/checkout.module.css');
  assert.match(css, /\.couponInput button \{ height: 46px;[^}]*color: #fff; background: #ac3520;[^}]*font-weight: 600/);
  assert.match(css, /\.couponInput button:disabled \{[^}]*cursor: not-allowed/);
  assert.match(css, /\.selectedDiscount \{[^}]*border: 1px solid #ac3520; border-radius: 15px; background: #fff3f0/);
  assert.match(css, /\.discountDialog \.addressOptions button\[aria-pressed="true"\] strong \{ font-weight: 600/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*\.discountDialog \{ inset: auto 0 var\(--discount-keyboard-offset, 0px\);[^}]*width: 100%; height: auto; border-radius: 24px 24px 0 0/);
  assert.match(css, /@media \(min-width: 768px\) \{\s*\.discountDialog \{ inset: 0; margin: auto; width: min\(560px, calc\(100% - 32px\)\); max-height: min\(80dvh/);
  assert.match(css, /max-height: min\(82dvh, var\(--discount-visible-height/);
  assert.match(css, /\.discountDialog \.dialogHeading \{ position: sticky;/);
  const html = render(checkoutSections, 'CheckoutDiscounts', { promotions: [], promotionId: '', couponInput: 'FIXTURE', couponCode: '', quoting: true, pendingKind: 'coupon', onCouponInput() {} });
  assert.match(html, /class="addressDialog discountDialog" aria-modal="true" aria-labelledby=/);
  assert.match(html, /aria-label="ปิดส่วนลดและคูปอง"/);
  assert.match(html, /disabled="" aria-busy="true" aria-disabled="true"[^>]*>กำลังตรวจสอบ\.\.\./);
});

test('checkout payment stays read-only PromptPay; presentation never reflects unknown backend errors', () => {
  const html = render(checkoutSections, 'CheckoutPayment', {});
  assert.match(html, /วิธีชำระเงิน/); assert.match(html, /PromptPay/);
  assert.match(html, /จะแสดง QR หลังยืนยันออเดอร์/);
  assert.doesNotMatch(html, /<button|<input|<select/);
  const { checkoutErrorMessage } = component(checkoutSections);
  for (const error of ['SQL connection failed /private', 'UNKNOWN_INTERNAL_CODE', 'constructor', '__proto__']) {
    const safe = checkoutErrorMessage(error);
    assert.equal(typeof safe, 'string'); assert.ok(!safe.includes(error));
    assert.match(safe, /กรุณาตรวจสอบข้อมูล/);
  }
  assert.match(checkoutErrorMessage('coupon_minimum_not_met'), /ขั้นต่ำ/);
  const css = read('frontend/components/customer/checkout.module.css');
  assert.match(css, /\.addressCard button \{[^}]*border-radius: 999px/);
  assert.match(css, /\.promotionTrigger \{[^}]*min-height: 48px/);
  assert.match(css, /aria-pressed="true"\] \{ border-color: #ac3520; background: #fff3f0/);
  assert.match(css, /focus-visible \{ outline: 3px solid #ac3520/);
});

test('checkout note stays inside the address card, collapses by default, saves exact text and cancel never writes', () => {
  const saved = [];
  const props = { value: '', onChange: (event) => { saved.push(event.target.value); props.value = event.target.value; } };
  const f = checkoutUiRuntime('CheckoutDeliveryNote', props);
  assert.equal(f.find((n) => n.type === 'textarea'), undefined);
  assert.equal(f.find((n) => n.type === 'button').props.children, '+ เพิ่มหมายเหตุ');
  f.find((n) => n.type === 'button').props.onClick();
  let input = f.find((n) => n.type === 'textarea');
  assert.equal(input.props.maxLength, 1000);
  assert.equal(f.find((n) => n.type === 'label').props.htmlFor, input.props.id);
  input.props.onChange({ target: { value: '  ฝากไว้ที่ล็อบบี้\nโทรเมื่อถึง  ' } });
  assert.equal(saved.length, 0);
  f.find((n) => n.type === 'button' && n.props.children === 'ยกเลิก').props.onClick();
  assert.equal(saved.length, 0); assert.equal(f.find((n) => n.type === 'textarea'), undefined);
  f.find((n) => n.type === 'button').props.onClick();
  input = f.find((n) => n.type === 'textarea'); assert.equal(input.props.value, '');
  input.props.onChange({ target: { value: '  ฝากไว้ที่ล็อบบี้\nโทรเมื่อถึง  ' } });
  f.find((n) => n.type === 'button' && n.props.children === 'บันทึก').props.onClick();
  assert.deepEqual(saved, ['  ฝากไว้ที่ล็อบบี้\nโทรเมื่อถึง  ']);
  assert.equal(f.find((n) => n.type === 'textarea'), undefined);
  assert.equal(f.find((n) => n.type === 'button').props.children, 'แก้ไข');
  f.find((n) => n.type === 'button').props.onClick();
  input = f.find((n) => n.type === 'textarea'); assert.equal(input.props.value, props.value);
  input.props.onChange({ target: { value: '' } });
  f.find((n) => n.type === 'button' && n.props.children === 'บันทึก').props.onClick();
  assert.deepEqual(saved, ['  ฝากไว้ที่ล็อบบี้\nโทรเมื่อถึง  ', '']);
  const route = checkoutRuntime();
  const address = route.find((n) => n.type?.name === 'CheckoutAddress');
  assert.equal(address.props.children.type.name, 'CheckoutDeliveryNote');
  assert.equal(checkoutNodes(route.tree()).filter((n) => n.type?.name === 'CheckoutDeliveryNote').length, 1);
});

test('checkout note editor focuses textarea on open and restores its trigger after save/cancel', () => {
  let focus = '';
  const f = checkoutUiRuntime('CheckoutDeliveryNote', { value: 'เดิม', onChange() {} });
  f.find((n) => n.type === 'button').props.onClick();
  const input = f.find((n) => n.type === 'textarea');
  input.props.ref.current = { focus: () => { focus = 'input'; } };
  f.effects[0](); assert.equal(focus, 'input');
  f.find((n) => n.type === 'button' && n.props.children === 'ยกเลิก').props.onClick();
  const trigger = f.find((n) => n.type === 'button');
  trigger.props.ref.current = { focus: () => { focus = 'trigger'; } };
  f.effects[0](); assert.equal(focus, 'trigger');
});

test('checkout main discount entry has no input outside one dialog and summarizes only confirmed quote', () => {
  const base = { promotions: [], promotionId: '', couponCode: '', couponInput: '', onCouponInput() {}, onPromotionChange() {} };
  for (const [overrides, label] of [
    [{}, 'เลือกโปรโมชันหรือคูปอง'],
    [{ promotionId: '4', quote: { promotion_snapshot: { name: 'ส่งฟรีต้อนรับ Local' }, discount_amount: '15.00' } }, 'ส่งฟรีต้อนรับ Local'],
    [{ couponCode: 'WELCOME10', quote: { coupon_snapshot: { code: 'WELCOME10' }, discount_amount: '30.00' } }, 'WELCOME10 · ลด ฿30'],
    [{ couponCode: '', quoting: true, pendingKind: 'coupon' }, 'กำลังตรวจสอบส่วนลด...'],
    [{ couponCode: '', discountError: 'coupon_unavailable', pendingKind: 'coupon' }, 'เลือกโปรโมชันหรือคูปอง'],
  ]) {
    const html = render(checkoutSections, 'CheckoutDiscounts', { ...base, ...overrides });
    assert.equal((html.match(/<dialog/g) || []).length, 1);
    const main = html.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
    assert.match(main, new RegExp(label));
    assert.equal((main.match(/<button/g) || []).length, 1);
    assert.doesNotMatch(main, /<input|<select|coupon-code/);
    assert.doesNotMatch(html, /XOR|promotion engine|coupon engine/);
    assert.match(html, /aria-label="ปิดส่วนลดและคูปอง"/);
    assert.match(html, /<dialog[^>]*aria-modal="true"/);
  }
});

test('checkout combined sheet stays open on coupon error and restores focus on X, Escape, backdrop and unmount', async () => {
  const styleValues = new Map([['overflow', 'auto']]);
  const style = { getPropertyValue: (key) => styleValues.get(key) || '', getPropertyPriority: () => '',
    setProperty: (key, value) => styleValues.set(key, value), removeProperty: (key) => styleValues.delete(key) };
  let focus = '', restored = 0;
  const browser = { scrollX: 0, scrollY: 150, innerWidth: 393, getComputedStyle: () => ({ paddingRight: '0px' }),
    scrollTo: (value) => { assert.equal(value.top, 150); restored++; } };
  const doc = { body: { style }, documentElement: { clientWidth: 393 } };
  const f = checkoutUiRuntime('CheckoutDiscounts', { promotions: [], promotionId: '', couponCode: '', couponInput: '', onCouponInput() {} },
    { window: browser, document: doc });
  const dialogNode = f.find((n) => n.type === 'dialog');
  const dialog = new EventTarget();
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  dialog.getBoundingClientRect = () => ({ left: 10, right: 380, top: 200, bottom: 700 });
  dialog.querySelector = (selector) => { assert.equal(selector, '[data-review-close]'); return { focus: () => { focus = 'close'; } }; };
  dialog.addEventListener('close', dialogNode.props.onClose);
  dialogNode.props.ref.current = dialog;
  const trigger = f.find((n) => n.props?.['aria-haspopup'] === 'dialog');
  trigger.props.ref.current = { isConnected: true, focus: () => { focus = 'trigger'; } };
  const unmount = f.effects[0]();
  const open = () => {
    trigger.props.onClick(); assert.equal(dialog.open, true); assert.equal(focus, 'close');
    assert.equal(styleValues.get('position'), 'fixed'); assert.equal(styleValues.get('overflow'), 'hidden');
    assert.equal(f.find((n) => n.props?.['aria-haspopup'] === 'dialog').props['aria-expanded'], true);
  };
  const closed = () => {
    assert.equal(dialog.open, false); assert.equal(focus, 'trigger');
    assert.equal(styleValues.get('overflow'), 'auto'); assert.equal(styleValues.has('position'), false);
    assert.equal(f.find((n) => n.props?.['aria-haspopup'] === 'dialog').props['aria-expanded'], false);
  };
  open();
  f.props.couponInput = 'BAD';
  f.props.onApplyCoupon = async () => { f.props.discountError = 'coupon_unavailable'; f.props.pendingKind = 'coupon'; };
  await f.find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(dialog.open, true);
  assert.equal(styleValues.get('overflow'), 'hidden');
  assert.equal(f.find((n) => n.type === 'button' && n.props.type === 'submit').props.disabled, false);
  assert.match(f.find((n) => n.props?.role === 'alert').props.children, /ไม่พบโค้ดที่พร้อมใช้งาน/);
  f.find((n) => n.props?.['data-review-close']).props.onClick(); closed();
  open(); const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel); closed(); assert.equal(cancel.defaultPrevented, true);
  open(); for (const type of ['pointerdown', 'click']) dialog.dispatchEvent(Object.assign(new Event(type), { clientX: 0, clientY: 0 })); closed();
  open(); unmount(); closed();
  assert.equal(restored, 4);
});

test('checkout visual note header keeps edit beside heading and clamps display without truncating saved draft', () => {
  const value = 'ฝากไว้ที่ล็อบบี้ โทรเมื่อถึง และแยกถุงอาหาร '.repeat(12);
  const f = checkoutUiRuntime('CheckoutDeliveryNote', { value, onChange() {} });
  const header = f.find((n) => n.props?.className === 'noteHeading');
  assert.deepEqual(Array.from(header.props.children).map((n) => n.type), ['h3', 'button']);
  assert.equal(checkoutNodes(header).find((n) => n.type === 'button').props.children, 'แก้ไข');
  const note = f.find((n) => n.props?.className === 'noteText');
  assert.equal(note.props.children, value); assert.equal(note.props.title, value);
  checkoutNodes(header).find((n) => n.type === 'button').props.onClick();
  assert.equal(f.find((n) => n.type === 'textarea').props.value, value);
  const css = read('frontend/components/customer/checkout.module.css');
  assert.match(css, /\.noteHeading \{ display: flex; align-items: center; justify-content: space-between/);
  assert.match(css, /\.noteText \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden/);
  assert.match(css, /\.noteEdit, \.noteActions button \{[^}]*min-height: 44px/);
});

test('checkout visual hierarchy uses a single discount border and a decorative compact payment icon', () => {
  const css = read('frontend/components/customer/checkout.module.css');
  assert.match(css, /\.merchant \{[^}]*color: #59524b; font-size: 13px; font-weight: 550/);
  assert.match(css, /\.discountSection > \.promotionTrigger \{ border: 0; padding: 8px 0/);
  assert.match(css, /\.section.discountSection \{ padding: 12px 16px/);
  const html = render(checkoutSections, 'CheckoutDiscounts', { promotions: [], promotionId: '', couponCode: '', couponInput: '', onCouponInput() {} });
  assert.match(html, /class="section discountSection"/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) || []).length, 1);
  const payment = render(checkoutSections, 'CheckoutPayment', {});
  assert.match(payment, /class="paymentRow"/);
  assert.match(payment, /class="paymentIcon" aria-hidden="true"/);
  assert.match(payment, /<strong>PromptPay<\/strong>/);
  assert.doesNotMatch(payment, /<button|<input|<select|<img/);
  assert.match(css, /\.paymentIcon \{[^}]*width: 38px; height: 38px/);
  assert.match(css, /\.paymentRow > div \{ min-width: 0; overflow-wrap: anywhere/);
});

test('checkout visual total divider is neutral and sticky terminology matches unchanged authoritative total', async () => {
  const css = read('frontend/components/customer/checkout.module.css');
  assert.match(css, /\.totals \.grandTotal \{[^}]*border-top: 1px solid #d8d1ca;[^}]*font-weight: 700/);
  assert.match(css, /\.grandTotal strong \{ color: #ac3520/);
  const f = checkoutRuntime(); await f.quote();
  const bar = f.find((n) => n.props?.className === 'confirmBar');
  const html = renderToStaticMarkup(bar);
  assert.match(html, /ยอดสุทธิ/); assert.doesNotMatch(html, /ยอดชำระ/);
  const total = f.find((n) => n.type?.name === 'CheckoutTotals').props.quote.total_amount;
  const { baht } = component('frontend/lib/api.js');
  assert.ok(html.includes(baht(total)));
  assert.equal(f.requests.filter((r) => r.url === '/api/orders').length, 0);
});

test('published banners take priority; three demos only in development with no usable images', async () => {
  const { homeBannerSlides } = await import('../frontend/lib/home-banners.mjs');
  const live = { id: 'published', image_url: '/published.png', title: 'Admin content' };
  assert.deepEqual(homeBannerSlides([live], [], true), [live]);
  assert.deepEqual(homeBannerSlides([live], [], false), [live]);
  assert.equal(homeBannerSlides([], [], true).length, 3);
  assert.equal(homeBannerSlides([live], ['/published.png'], true).length, 3);
  assert.deepEqual(homeBannerSlides([], [], false), [null]);
  assert.deepEqual(homeBannerSlides([live], ['/published.png'], false), [null]);
  assert.equal(homeBannerSlides([{ image_url: ' ' }], [], true).length, 3);
  assert.deepEqual(homeBannerSlides([live], [], true, true), [live]);
  assert.deepEqual(homeBannerSlides([live], [], false, true), [live]);
  assert.deepEqual(homeBannerSlides([], [], false, true), [null]);
  const sorted = [{ ...live, id: 3 }, { ...live, id: 1 }];
  assert.deepEqual(homeBannerSlides(sorted, [], true, false), sorted);
});

test('address dialog renders real saved labels, current selection and accessible opener without native select', () => {
  const html = render(`${home}home-header.js`, 'HomeHeader', {
    addresses: [{ id: 1, label: 'Home', dormitory_name: 'Local Dorm A', room_number: 'A-101', is_default: true },
      { id: 2, label: 'Campus', dormitory_name: 'Campus Place', room_number: 'C-204' }], addressId: '2', onAddressChange() {},
  });
  assert.match(html, /<dialog[^>]+aria-labelledby=/);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false" aria-controls=/);
  assert.match(html, /aria-pressed="true"[\s\S]*Campus/);
  assert.match(html, /ห้อง A-101/);
  assert.doesNotMatch(html, /<select/);
  assert.match(read(`${home}home-header.js`), /onAddressChange\(String\(address.id\)\)/);
});

test('notification badge is absent at zero and capped at 9+; header shortcuts are notification and profile only', () => {
  for (const count of [0, 1, 9, 12]) {
    const html = render(`${home}home-header.js`, 'HomeHeader', { addresses: [], unreadCount: count });
    assert.equal(html.includes('class="notificationBadge"'), count > 0);
    if (count === 12) assert.match(html, />9\+<\/span>/);
    assert.doesNotMatch(html, /href="\/favorites"/);
    assert.match(html, /href="\/notifications"/);
    assert.match(html, /aria-label="โปรไฟล์"/);
    const shortcuts = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...shortcuts.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), ['/notifications', '/profile']);
  }
});

test('promotions render Thai value, maximum, merchant, minimum and optional expiry without enum leakage', () => {
  for (const [type, label] of [['PERCENTAGE', 'ลด 10%'], ['FIXED_AMOUNT', 'ลด ฿10'], ['FREE_DELIVERY', 'ส่งฟรี']]) {
    const html = render(`${home}promotion-card.js`, 'PromotionCard', { promotion: {
      id: 101, name: 'ส่วนลดมื้ออร่อย', promotion_type: type, value: 10, minimum_order_amount: 50,
      maximum_discount_amount: 30, merchant_id: 22, ends_at: '2030-10-07T10:00:00Z',
    }, merchants: [{ id: 22, store_name: 'Fixture Kitchen' }] });
    assert.ok(html.includes(label));
    for (const text of ['ขั้นต่ำ ฿50', 'สูงสุด ฿30', 'Fixture Kitchen', 'ใช้ได้ถึง', 'href="/promotions/101"']) assert.ok(html.includes(text));
    assert.doesNotMatch(html, /PERCENTAGE|FIXED_AMOUNT|FREE_DELIVERY|merchant_id/);
  }
  const html = render(`${home}promotion-card.js`, 'PromotionCard', { promotion: { id: 1, name: 'มื้ออร่อย', promotion_type: 'FREE_DELIVERY' }, merchants: [] });
  assert.doesNotMatch(html, /ใช้ได้ถึง/);
});

test('store card retains real link, favorite state, rating, fee and lazy 3:2 image contract', () => {
  const html = render(`${home}discovery-store-card.js`, 'DiscoveryStoreCard', { merchant: {
    id: 22, store_name: 'Fixture Kitchen', primary_image: '/demo/local-kitchen.svg', is_favorite: true,
    accepting_orders: true, average_rating: 5, review_count: 2, location_text: 'Food court', delivery: { available: true, fee: 15 },
  }, addressId: '11', onFavoriteChange() {} });
  for (const text of ['/stores/22?addressId=11', 'เปิดอยู่', '5.0', '2 รีวิว', 'ค่าส่ง ฿15', 'aria-pressed="true"', 'loading="lazy"']) assert.ok(html.includes(text));
  const source = read(`${home}discovery-store-card.js`);
  assert.match(source, /method: favorite \? 'DELETE' : 'POST'/);
  assert.doesNotMatch(source, /\bpriority\b/);
});

test('customer Home final order is search, banner, two shortcuts and stores without retired sections', () => {
  const html = render('frontend/app/page.js', 'default', {});
  for (const text of ['สั่งอะไรดี? ค้นหาร้านหรือเมนู', 'กำลังโหลดโปรโมชัน', '/promotions', '/favorites', '/orders', 'ร้านแนะนำสำหรับคุณ', 'customer-bottom-nav']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /SELECT TOPIC|Recent Orders|รายการสั่งซื้อล่าสุด|home-recent-order|floatingCart|โปรโมชันสำหรับคุณ|โปรโมชั่นสำหรับคุณ|สั่งล่าสุด|ร้านโปรดของคุณ|ดูสถานะออเดอร์/);
  assert.ok(html.indexOf('role="search"') < html.indexOf('กำลังโหลดโปรโมชัน'));
  assert.ok(html.indexOf('กำลังโหลดโปรโมชัน') < html.indexOf('aria-label="ทางลัด"'));
  assert.ok(html.indexOf('aria-label="ทางลัด"') < html.indexOf('ร้านแนะนำสำหรับคุณ'));
  assert.equal((html.match(/href="\/cart"/g) || []).length, 1);
  assert.equal((html.match(/href="\/orders"/g) || []).length, 1);
});

test('responsive CSS contract: one mobile store, 44px controls, constrained nav and safe area', () => {
  const css = read(`${home}home.module.css`);
  for (const expected of [/width: min\(100%, 760px\)/, /\.storeGrid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
    /@media \(min-width: 640px\)/, /scrollbar-width: none/,
    /aspect-ratio: 20 \/ 9/, /aspect-ratio: 3 \/ 2/, /min-height: 44px/,
    /padding-bottom: calc\(90px \+ env\(safe-area-inset-bottom\)\)/, /prefers-reduced-motion/]) assert.match(css, expected);
});

test('banner rendered controls, loading and production empty state are graceful', () => {
  const html = render(`${home}promo-banner.js`, 'PromoBanner', { banners: [
    { id: 1, title: 'ร้านอร่อย', image_url: '/demo/local-kitchen.svg', target_type: 'STORE', target_value: '22' },
    { id: 2, title: 'เมนูแนะนำ', image_url: '/demo/basil-rice.svg', target_type: 'MENU', target_value: '33' },
  ] });
  for (const text of ['/stores/22', '/menu/33', 'ดูแบนเนอร์ 2', 'tabindex="-1"']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /แบนเนอร์ก่อนหน้า|แบนเนอร์ถัดไป/);
  assert.match(render(`${home}promo-banner.js`, 'PromoBanner', { loading: true }), /กำลังโหลดโปรโมชัน/);
});

test('new stores have no rating star; closed stores retain navigation and enabled favorite control', () => {
  const html = render(`${home}discovery-store-card.js`, 'DiscoveryStoreCard', { merchant: {
    id: 22, store_name: 'New Kitchen', review_count: 0, accepting_orders: false,
    primary_image: '/demo/local-kitchen.svg', delivery: { available: true, fee: 15 },
  }, onFavoriteChange() {} });
  assert.match(html, /class="rating">ร้านใหม่<\/span>/);
  assert.match(html, /class="storeVisual storeClosed"/);
  assert.match(html, /ปิดชั่วคราว/);
  assert.match(html, /href="\/stores\/22"/);
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(read(`${home}home.module.css`), /\.storeClosed \.storeImage, \.storeClosed \.storeFallback \{ opacity: \.8; \}/);
});

test('store promotion chips use actual API type/value and are absent without a promotion', () => {
  const merchant = { id: 22, store_name: 'Kitchen', review_count: 0, accepting_orders: true };
  for (const [promotion_type, value, text] of [['FREE_DELIVERY', 0, 'ส่งฟรี'], ['PERCENTAGE', 10, 'ลด 10%'], ['FIXED_AMOUNT', 30, 'ลด ฿30']]) {
    const html = render(`${home}discovery-store-card.js`, 'DiscoveryStoreCard', { merchant,
      promotion: { id: 101, name: 'Promotion fixture', promotion_type, value }, onFavoriteChange() {} });
    assert.match(html, /href="\/promotions\/101"/);
    assert.ok(html.includes(text));
  }
  assert.doesNotMatch(render(`${home}discovery-store-card.js`, 'DiscoveryStoreCard', { merchant }), /class="storePromo"/);
});

test('Home keeps two-column shortcuts, native search submit and API-backed promotion badge', () => {
  const css = read(`${home}home.module.css`);
  assert.match(css, /\.quickActions \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  const source = read('frontend/app/page.js');
  assert.match(source, /type="submit" aria-label="ค้นหา"><Icon name="search"/);
  assert.match(source, /onSubmit=\{submitSearch\}/);
  assert.match(source, /<HomeQuickActions promotionCount=\{promotions.length\} \/>/);
  assert.match(source, /api\('\/api\/promotions'\)/);
  assert.doesNotMatch(source, /<PromotionCard|promotions-title/);
});

test('two shortcuts retain titles, subtitles and routes without order navigation', () => {
  const html = render(`${home}home-navigation.js`, 'HomeQuickActions', {});
  for (const route of ['/promotions', '/favorites']) assert.ok(html.includes(`href="${route}"`));
  for (const label of ['โปรโมชัน', 'ดูสิทธิ์และส่วนลด', 'ร้านโปรด', 'ร้านที่บันทึกไว้']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /href="\/orders"/);
});

test('shared customer nav has exactly Home/Cart/Status, route active state and capped cart count', () => {
  for (const pathname of ['/', '/cart', '/checkout', '/orders', '/orders/123', '/profile', '/favorites', '/promotions']) {
    for (const cartCount of [0, 1, 9, 10]) {
      const html = render('frontend/components/app-shell.js', 'AppShell', {}, { pathname, cartCount });
      const nav = html.match(/<nav[^>]+customer-bottom-nav[\s\S]*?<\/nav>/)[0];
      assert.equal((nav.match(/<a /g) || []).length, 3);
      for (const label of ['หน้าแรก', 'ตะกร้า', 'สถานะ']) assert.ok(nav.includes(label));
      assert.doesNotMatch(nav, /href="\/profile"|โปรไฟล์/);
      const active = pathname.startsWith('/orders') ? '/orders' : pathname === '/checkout' ? '/cart' : pathname;
      if (['/', '/cart', '/orders'].includes(active)) assert.ok(nav.includes(`href="${active}" class="${active === '/cart' ? 'nav-cart ' : ''}is-active" aria-current="page"`));
      else assert.doesNotMatch(nav, /aria-current="page"/);
      assert.equal(nav.includes('class="cart-badge"'), cartCount > 0);
      if (cartCount > 0) assert.ok(nav.includes(`>${cartCount > 9 ? '9+' : cartCount}</b>`));
    }
  }
  const css = read('frontend/app/globals.css');
  assert.match(css, /\.app-shell \.bottom-nav.customer-bottom-nav \{[^}]*position: fixed;[^}]*width: min\(100%, 760px\);[^}]*repeat\(3, minmax\(0, 1fr\)\)[^}]*safe-area-inset-bottom/);
  assert.match(css, /\.app-shell \.customer-bottom-nav a \{[^}]*min-height: 52px/);
});

test('header uses profile avatar with an accessible fallback and preserves delivery label', () => {
  const header = render(`${home}home-header.js`, 'HomeHeader', { addresses: [], profileImage: '/demo/local-kitchen.svg' });
  assert.match(header, /class="profileAvatar"/);
  assert.match(header, /<span>จัดส่งที่<\/span>/);
  const fallback = render(`${home}home-header.js`, 'HomeHeader', { addresses: [] });
  assert.doesNotMatch(fallback, /class="profileAvatar"/);
  assert.match(fallback, /aria-label="โปรไฟล์"/);
});

test('promotion shortcut uses only supplied count, hides zero and caps at 9+', () => {
  for (const promotionCount of [0, 1, 9, 10]) {
    const html = render(`${home}home-navigation.js`, 'HomeQuickActions', { promotionCount });
    assert.equal((html.match(/<a /g) || []).length, 2);
    assert.equal(html.includes('class="notificationBadge"'), promotionCount > 0);
    if (promotionCount) assert.ok(html.includes(`>${promotionCount > 9 ? '9+' : promotionCount}</span>`));
  }
});

test('payment route suppresses shared nav including loading/error shells without affecting normal orders', () => {
  for (const pathname of ['/orders/123/payment', '/orders/123/payment/']) {
    assert.doesNotMatch(render('frontend/components/app-shell.js', 'AppShell', {}, { pathname }), /<nav/);
  }
  assert.doesNotMatch(render('frontend/components/app-shell.js', 'AppShell', { hideBottomNav: true }, { pathname: '/' }), /<nav/);
  assert.match(render('frontend/components/app-shell.js', 'AppShell', {}, { pathname: '/orders/123' }), /customer-bottom-nav/);
});

test('Home address and mobile controls retain ellipsis, two shortcuts and bounded image contracts', () => {
  const css = read(`${home}home.module.css`);
  assert.match(css, /\.address \{ min-width: 0; flex: 1;/);
  assert.match(css, /\.addressSelect > span \{[^}]*white-space: nowrap; text-overflow: ellipsis/);
  assert.match(css, /\.headerActions \{[^}]*flex-shrink: 0/);
  assert.match(css, /\.bannerTrack \{[^}]*overflow-x: auto/);
  assert.match(css, /\.bannerLink \{[^}]*aspect-ratio: 20 \/ 9; overflow: hidden/);
  assert.match(css, /\.search \{[^}]*height: 52px/);
});

test('real PromoBanner mounts autoplay, loops 1-2-3-1, resets on dot selection and cleans up', () => {
  const root = new EventTarget(), track = new EventTarget(), doc = new EventTarget(), motion = new EventTarget();
  let active = 0, nextTimer = 0;
  const timers = new Map(), refs = [{ current: root }, { current: track }], effects = [];
  doc.hidden = false; motion.matches = false;
  track.scrollLeft = 0;
  track.getBoundingClientRect = () => ({ left: 16 });
  track.children = [0, 1, 2].map((i) => ({ getBoundingClientRect: () => ({ left: 16 + (i - active) * 370 }) }));
  track.scrollTo = ({ left }) => { track.scrollLeft = left; active = Math.round(left / 370); track.dispatchEvent(new Event('scroll')); };
  const browser = { matchMedia: () => motion, setTimeout: (fn, delay) => { assert.equal(delay, 5000); timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id) => timers.delete(id) };
  let refIndex = 0;
  const { PromoBanner } = component(`${home}promo-banner.js`, { globals: { window: browser, document: doc }, hooks: {
    useState: (value) => [value, () => {}], useRef: () => refs[refIndex++], useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
  } });
  const tree = PromoBanner({ banners: [1, 2, 3].map((id) => ({ id, image_url: `/banner-${id}.png` })) });
  const stop = effects[0]();
  const tick = () => { assert.equal(timers.size, 1); const [id, fn] = [...timers][0]; timers.delete(id); fn(); };
  const sequence = [active + 1];
  for (let step = 0; step < 3; step++) { tick(); sequence.push(active + 1); }
  assert.deepEqual(sequence, [1, 2, 3, 1]);
  const dot = checkoutNodes(tree).find((node) => node.props?.['aria-label'] === 'ดูแบนเนอร์ 2');
  dot.props.onClick(); root.dispatchEvent(new Event('click'));
  assert.equal(active, 1); tick(); assert.equal(active, 2);
  stop(); assert.equal(timers.size, 0);
  root.dispatchEvent(new Event('click')); assert.equal(timers.size, 0);
  effects.length = 0; refIndex = 0;
  PromoBanner({ loading: true }); assert.equal(effects[0](), undefined); assert.equal(timers.size, 0);
});

const storeComponent = 'frontend/components/customer/store-detail-content.js';
const storeFixture = {
  id: 1, store_name: 'Fixture Kitchen', location_text: 'Main gate food court', phone: '0811111111',
  accepting_orders: true, is_active: true, is_favorite: true, review_count: 2, average_rating: 4.5,
  gallery: [{ id: 1, image_url: '/demo/local-kitchen.svg' }, { id: 2, image_url: '/demo/local-kitchen-2.svg' }],
  delivery: { available: true, fee: 15 },
  categories: [{ id: 2, name: 'Rice Dishes', items: [{ id: 1, name: 'Basil Rice', price: 60, description: 'Fragrant basil rice', image_url: '/demo/basil-rice.svg', is_available: true, stock_quantity: 10 }] }],
};

test('Store Detail uses real aggregate, single location, tel link, availability and delivery fee without fake ETA', () => {
  const html = render(storeComponent, 'StoreDetailContent', { merchant: storeFixture, reviews: [], onFavorite() {}, onCategory() {} });
  for (const text of ['4.5 (2 รีวิว)', 'ค่าส่ง', '฿15', 'เปิดอยู่', 'href="tel:0811111111"', 'aria-pressed="true"', 'เวลาจัดส่งขึ้นอยู่กับจำนวนออเดอร์']) assert.ok(html.includes(text));
  assert.equal((html.match(/Main gate food court/g) || []).length, 1);
  assert.doesNotMatch(html, /สอบถามเวลา|นาที|ระงับชั่วคราว/);
  const closed = render(storeComponent, 'StoreDetailContent', { merchant: { ...storeFixture, accepting_orders: false, review_count: 0 }, reviews: [] });
  assert.match(closed, /ปิดชั่วคราว/);
  assert.match(closed, /closedGallery/);
  assert.match(closed, /ร้านใหม่/);
  assert.match(closed, /href="\/menu\/1"/);
});

test('store gallery renders swipe/dots, only first image eager, accessible fallback and no autoplay', () => {
  const html = render(storeComponent, 'StoreGallery', { images: storeFixture.gallery, name: 'Kitchen' });
  assert.match(html, /ดูรูปภาพร้าน 2/);
  assert.equal((html.match(/loading="lazy"/g) || []).length, 1);
  assert.match(html, /aria-current="true"/);
  const empty = render(storeComponent, 'StoreGallery', { images: [], name: 'Kitchen' });
  assert.match(empty, /role="img" aria-label="Kitchen"/);
  assert.doesNotMatch(empty, /<button/);
  assert.doesNotMatch(read(storeComponent), /setInterval|setTimeout|startBannerAutoplay/);
  assert.match(read(storeComponent), /priority=\{hero\}/);
  assert.match(read(storeComponent), /hero=\{position === 0\}/);
});

test('only exact verification fixtures and empty categories are hidden without changing the input data', () => {
  const { visibleStoreCategories } = component(storeComponent);
  const categories = [...storeFixture.categories,
    { id: 3, name: 'Phase G Demo', items: [{ id: 99, name: 'Test' }] },
    { id: 4, name: 'Empty', items: [] },
    { id: 5, name: 'Desserts', items: [{ id: 88, name: 'Phase G Demo Rice' }] },
    { id: 6, name: 'Demo Kitchen Specials', items: [{ id: 89, name: 'Demo Kitchen Rice' }] },
  ];
  const before = JSON.stringify(categories);
  const visible = visibleStoreCategories(categories);
  assert.equal(JSON.stringify(categories), before);
  assert.equal(JSON.stringify(visible.map((c) => c.id)), '[2,6]');
  const html = render(storeComponent, 'StoreDetailContent', { merchant: { ...storeFixture, categories }, reviews: [] });
  assert.doesNotMatch(html, /Phase G Demo|>Empty<|>Desserts</);
  assert.match(html, /href="#category-2" aria-current="true"/);
  assert.match(html, /id="category-2"/);
  assert.match(html, /1 เมนู/);
  assert.match(html, /Demo Kitchen Rice/);
});

test('menu status presentation distinguishes zero stock and unavailable, retaining all detail links', () => {
  for (const [is_available, stock_quantity, badge] of [[true, 0, 'หมด'], [false, 5, 'ปิดขาย'], [true, null, null], [true, 3, null]]) {
    const html = render(storeComponent, 'StoreMenuCard', { item: { ...storeFixture.categories[0].items[0], is_available, stock_quantity } });
    assert.match(html, /href="\/menu\/1"/);
    assert.match(html, /฿60/);
    assert.match(html, /loading="lazy"/);
    assert.equal(html.includes('unavailableBadge'), !!badge);
    if (badge) assert.ok(html.includes(badge));
    assert.doesNotMatch(html, /aria-disabled|disabled=""/);
  }
});

test('reviews exist only inside closed dialog with actual aggregate, Thai dates and existing API limit', () => {
  const reviews = [1, 2, 3, 4].map((id) => ({ id, display_name: `Reviewer ${id}`, rating: 5, comment: `Review ${id}`, created_at: `2026-10-0${id}T08:00:00Z` }));
  const html = render(storeComponent, 'StoreReviews', { reviews, count: 4, average: 5 });
  assert.match(html, /aria-label="ดูรีวิวร้าน 4 รีวิว คะแนนเฉลี่ย 5.0"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]+role="dialog" aria-modal="true" aria-labelledby=/);
  assert.doesNotMatch(html, /<dialog[^>]*\bopen[\s=>]/);
  assert.match(html, />รีวิวร้าน<\/h2>/);
  assert.match(html, /จาก 4 รีวิว/);
  assert.equal((html.match(/<article/g) || []).length, 4);
  assert.ok(html.indexOf('Reviewer 4') < html.indexOf('Reviewer 3'));
  assert.match(html, /2569/);
  assert.match(html, /role="img" aria-label="5 จาก 5 ดาว"/);
  assert.match(html, /aria-label="ปิดรีวิวร้าน"/);
  assert.match(render(storeComponent, 'StoreReviews', { reviews: [], count: 1, average: 5 }), /ยังไม่มีรีวิว/);
  assert.match(render(storeComponent, 'StoreReviews', { reviews, count: 50, average: 5 }), /แสดง 4 รีวิวล่าสุดจากทั้งหมด 50 รีวิว/);
  const zero = render(storeComponent, 'StoreReviews', { reviews: [], count: 0 });
  assert.equal(zero, '<p>ร้านใหม่</p>');
  const page = render(storeComponent, 'StoreDetailContent', { merchant: storeFixture, reviews });
  const withoutDialog = page.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  assert.doesNotMatch(withoutDialog, /<article|Reviewer|รีวิวจากลูกค้า/);
  const noComment = render(storeComponent, 'StoreReviews', { reviews: [{ ...reviews[0], comment: '' }], count: 1, average: 5 });
  assert.doesNotMatch(noComment.match(/<article[\s\S]*?<\/article>/)[0], /<p/);
  assert.doesNotMatch(read(storeComponent), /\bfetch\(|\bapi\(/);
  assert.match(read('backend/src/customer-engagement.cjs'), /'r.status': 'PUBLISHED'/);
});

test('review responsive sheet/modal and full menu-link contracts preserve keyboard and data boundaries', () => {
  const css = read('frontend/components/customer/store-detail.module.css');
  for (const contract of [/\.reviewDialog \{[^}]*inset: auto 0 0/, /max-height: 80dvh/, /safe-area-inset-bottom/, /border-radius: 24px 24px 0 0/,
    /\.reviewDialog\[open\] \{ display: flex/, /\.reviewDialog::backdrop/, /\.reviewList \{[^}]*overflow-y: auto; overscroll-behavior: contain/,
    /@media \(min-width: 640px\) \{ \.reviewDialog \{ inset: 0; width: min\(560px/, /\.menuCard:active/, /\.delivery \{[^}]*width: fit-content/]) assert.match(css, contract);
  const html = render(storeComponent, 'StoreMenuCard', { item: storeFixture.categories[0].items[0] });
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /^<a[^>]+href="\/menu\/1"[\s\S]*<\/a>$/);
  assert.doesNotMatch(html, /<button|<input/);
});

test('store empty menu, header and shared navigation keep accessible customer-only contracts', () => {
  assert.match(render(storeComponent, 'StoreDetailContent', { merchant: { ...storeFixture, categories: [] }, reviews: [] }), /ร้านนี้ยังไม่มีเมนู/);
  const header = render('frontend/components/customer/detail-header.js', 'CustomerDetailHeader', { title: 'Kitchen', backHref: '/' });
  assert.match(header, /aria-label="ย้อนกลับ"/);
  const shell = render('frontend/components/app-shell.js', 'AppShell', { variant: 'customer-detail' }, { pathname: '/stores/1' });
  assert.doesNotMatch(shell, /aria-current="page"/);
  const css = read('frontend/components/customer/store-detail.module.css');
  for (const rule of [/aspect-ratio: 3 \/ 2/, /scroll-snap-type: x mandatory/, /position: sticky; top: 68px/, /grid-template-columns: minmax\(0, 1fr\)/, /width: 96px; height: 96px/, /-webkit-line-clamp: 2/, /:focus-visible/, /min-height: 44px/, /prefers-reduced-motion/]) assert.match(css, rule);
  const route = read('frontend/app/stores/[id]/page.js');
  assert.match(route, /method: next \? 'POST' : 'DELETE'/);
  assert.match(route, /<LoadingCards \/>/);
  assert.match(route, /if \(error\)/);
});

const menuOptions = 'frontend/components/customer/menu-options.js';
const menuFixture = {
  id: 1, merchant_id: 1, store_name: 'Local Kitchen', category_name: 'Rice Dishes', name: 'Local Basil Rice',
  image_url: '/demo/basil-rice.svg', price: 60, description: 'Fragrant basil rice', accepting_orders: true, is_available: true, stock_quantity: 20,
  option_groups: [
    { id: 10, name: 'Spiciness', is_required: true, min_choices: 1, max_choices: 1, choices: [{ id: 11, name: 'Mild', is_available: true, extra_price: 0 }, { id: 12, name: 'Hot', is_available: true, extra_price: 0 }] },
    { id: 20, name: 'Extras', is_required: false, min_choices: 0, max_choices: 2, choices: [{ id: 21, name: 'Fried egg', is_available: true, extra_price: 10 }, { id: 22, name: 'Extra rice', is_available: true, extra_price: 10 }, { id: 23, name: 'Unavailable', is_available: false, extra_price: 5 }] },
  ],
};

test('menu option groups retain native whole-row radio/checkbox semantics, selected state and min/max helpers', () => {
  const group = menuFixture.option_groups[0];
  const empty = render(menuOptions, 'MenuOptionGroup', { group, item: menuFixture, onToggle() {} });
  assert.match(empty, /<fieldset[^>]+aria-describedby="option-helper-10"/);
  assert.match(empty, /<legend/);
  assert.match(empty, /จำเป็น/);
  assert.match(empty, /กรุณาเลือก 1 รายการ/);
  assert.equal((empty.match(/type="radio"/g) || []).length, 2);
  assert.match(empty, /<label[^>]*><input/);
  const chosen = render(menuOptions, 'MenuOptionGroup', { group, item: menuFixture, selectedIds: [11], onToggle() {} });
  assert.match(chosen, /class="choice selected /);
  assert.match(chosen, /checked=""/);
  assert.doesNotMatch(chosen, /กรุณาเลือก/);
  assert.match(chosen, /เลือก 1 รายการ/);
  const extras = render(menuOptions, 'MenuOptionGroup', { group: menuFixture.option_groups[1], item: menuFixture, selectedIds: [21], onToggle() {} });
  assert.match(extras, /ไม่บังคับ/);
  assert.match(extras, /เลือกได้สูงสุด 2/);
  assert.match(extras, /type="checkbox"/);
  assert.match(extras, /disabled=""/);
  assert.match(extras, /ไม่พร้อมใช้งาน/);
  assert.match(extras, /\+฿10/);
});

test('Thai group labels apply only to the identified development seed, never arbitrary merchant names', () => {
  const { optionGroupTitle, optionRuleLabel } = component(menuOptions);
  assert.equal(optionGroupTitle(menuFixture.option_groups[0], menuFixture, true), 'ระดับความเผ็ด');
  assert.equal(optionGroupTitle(menuFixture.option_groups[1], menuFixture, true), 'เพิ่มเติม');
  assert.equal(optionGroupTitle(menuFixture.option_groups[0], menuFixture, false), 'Spiciness');
  assert.equal(optionGroupTitle(menuFixture.option_groups[0], { ...menuFixture, store_name: 'Merchant Kitchen' }, true), 'Spiciness');
  assert.equal(optionGroupTitle({ name: 'Chef special' }, menuFixture, true), 'Chef special');
  assert.equal(optionRuleLabel({ min_choices: 2, max_choices: 3 }), 'เลือกอย่างน้อย 2 รายการ · สูงสุด 3');
});

test('Thai choice copy is display-only and restricted to known local seed groups in development', () => {
  const { optionChoiceTitle } = component(menuOptions);
  const before = JSON.stringify(menuFixture);
  for (const [group, name, thai] of [['Spiciness', 'Mild', 'ไม่เผ็ด'], ['Spiciness', 'Medium', 'เผ็ดกลาง'], ['Spiciness', 'Hot', 'เผ็ดมาก'], ['Extras', 'Fried egg', 'ไข่ดาว'], ['Extras', 'Extra rice', 'เพิ่มข้าว']]) {
    const choice = { id: 123, name, extra_price: 10 };
    assert.equal(optionChoiceTitle(choice, { name: group }, menuFixture, true), thai);
    assert.equal(optionChoiceTitle(choice, { name: group }, menuFixture, false), name);
    assert.equal(optionChoiceTitle(choice, { name: group }, { ...menuFixture, store_name: 'Merchant Kitchen' }, true), name);
    assert.equal(optionChoiceTitle(choice, { name: group }, { ...menuFixture, image_url: '/merchant-food.jpg' }, true), name);
    assert.equal(optionChoiceTitle(choice, { name: 'Merchant choices' }, menuFixture, true), name);
    assert.equal(choice.id, 123); assert.equal(choice.name, name); assert.equal(choice.extra_price, 10);
  }
  assert.equal(optionChoiceTitle({ name: 'Chef special' }, { name: 'Extras' }, menuFixture, true), 'Chef special');
  assert.equal(JSON.stringify(menuFixture), before);
});

test('Rice translations apply only to the exact Local Garlic Chicken demo and preserve source values', () => {
  const { optionGroupTitle, optionChoiceTitle } = component(menuOptions);
  const item = { ...menuFixture, name: 'Garlic Chicken Rice', image_url: '/demo/garlic-chicken.svg' };
  const group = { id: 30, name: 'Rice' };
  const choices = [{ id: 31, name: 'Jasmine rice', extra_price: 0 }, { id: 32, name: 'Brown rice', extra_price: 10 }];
  const before = JSON.stringify({ item, group, choices });
  assert.equal(optionGroupTitle(group, item, true), 'ชนิดข้าว');
  for (const [index, label] of ['ข้าวหอมมะลิ', 'ข้าวกล้อง'].entries()) {
    assert.equal(optionChoiceTitle(choices[index], group, item, true), label);
  }
  for (const [candidate, development] of [[item, false], [{ ...item, store_name: 'Real Merchant' }, true],
    [{ ...item, name: 'Merchant Rice' }, true], [{ ...item, image_url: '/uploads/rice.jpg' }, true], [menuFixture, true]]) {
    assert.equal(optionGroupTitle(group, candidate, development), 'Rice');
    for (const choice of choices) assert.equal(optionChoiceTitle(choice, group, candidate, development), choice.name);
  }
  assert.equal(optionChoiceTitle(choices[0], { name: 'Chef choices' }, item, true), 'Jasmine rice');
  assert.equal(optionChoiceTitle({ name: 'Special rice' }, group, item, true), 'Special rice');
  assert.equal(JSON.stringify({ item, group, choices }), before);
});

function menuRuntime({ item = menuFixture, query = '', acceptsCart = true } = {}) {
  const state = [item, {}, 1, '', '', ''];
  let cursor = 0;
  const added = [];
  const navigations = [];
  const module = component('frontend/app/menu/[id]/page.js', {
    hooks: { useState(initial) { const slot = cursor++; if (state[slot] === undefined) state[slot] = initial; return [state[slot], (next) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }]; }, useMemo: (fn) => fn(), useEffect() {} },
    cart: { cart: { items: [] }, addOrUpdate: (...args) => { added.push(args); return acceptsCart; } },
    router: { push: (route) => navigations.push(route) }, query,
  });
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
  function tree() { cursor = 0; return module.default(); }
  function find(predicate) { return nodes(tree()).find(predicate); }
  return { state, added, navigations, tree, find,
    choice(group, id) { const node = find((n) => n.props?.group?.id === group); node.props.onToggle(node.props.group, id); },
    cta() { return find((n) => n.type === 'button' && Object.hasOwn(n.props, 'aria-disabled')); },
  };
}

test('real menu handlers preserve required validation, extras, quantity, note payload, total and Cart navigation', () => {
  const f = menuRuntime();
  assert.equal(f.cta().props.disabled, true);
  f.cta().props.onClick(); assert.equal(f.added.length, 0);
  f.choice(10, 11); assert.equal(f.cta().props.disabled, false);
  f.choice(20, 21);
  let total = f.find((n) => n.props?.['aria-live'] === 'polite');
  assert.match(renderToStaticMarkup(total), /฿70/);
  assert.match(renderToStaticMarkup(total), /รวมทั้งหมด/);
  f.find((n) => n.type === 'textarea').props.onChange({ target: { value: '  ไม่ใส่ผัก  ' } });
  f.find((n) => n.props?.['aria-label'] === 'เพิ่มจำนวน').props.onClick();
  total = f.find((n) => n.props?.['aria-live'] === 'polite');
  assert.match(renderToStaticMarkup(total), /฿140/);
  f.cta().props.onClick();
  const [payload, editingId] = f.added[0];
  assert.equal(editingId, null);
  assert.equal(payload.merchantId, 1); assert.equal(payload.menuItemId, 1);
  assert.equal(payload.unitPriceEstimate, 60); assert.equal(payload.quantity, 2);
  assert.equal(JSON.stringify(payload.optionChoiceIds), '[11,21]');
  assert.equal(payload.choices[1].extraPrice, 10); assert.equal(payload.note, 'ไม่ใส่ผัก');
  assert.equal(payload.choices[0].name, 'Mild'); assert.equal(payload.choices[1].name, 'Fried egg');
  assert.deepEqual(f.navigations, ['/cart']);
});

test('menu retains max selection, deselection, stock limits, unavailable CTA and failed-cart behavior', () => {
  const f = menuRuntime();
  f.choice(10, 11); f.choice(10, 12); assert.equal(JSON.stringify(f.state[1][10]), '[12]');
  f.choice(20, 21); f.choice(20, 22); f.choice(20, 23); assert.equal(JSON.stringify(f.state[1][20]), '[21,22]');
  f.choice(20, 21); assert.equal(JSON.stringify(f.state[1][20]), '[22]');
  assert.equal(f.find((n) => n.props?.['aria-label'] === 'ลดจำนวน').props.disabled, true);
  f.state[2] = 20; assert.equal(f.find((n) => n.props?.['aria-label'] === 'เพิ่มจำนวน').props.disabled, true);
  for (const item of [{ ...menuFixture, stock_quantity: 0 }, { ...menuFixture, is_available: false }, { ...menuFixture, accepting_orders: false }]) {
    const closed = menuRuntime({ item }); closed.choice(10, 11); assert.equal(closed.cta().props.disabled, true);
  }
  const denied = menuRuntime({ acceptsCart: false }); denied.choice(10, 11); denied.cta().props.onClick(); assert.deepEqual(denied.navigations, []);
  const noOptions = menuRuntime({ item: { ...menuFixture, option_groups: [] } });
  assert.equal(noOptions.find((n) => n.props?.className === 'option-groups'), undefined);
  assert.equal(noOptions.cta().props.disabled, false);
});

test('menu stock copy shows only low stock while sold-out and quantity limits remain unchanged', () => {
  for (const stock of [null, 0, 1, 3, 5, 6, 12, 14, 20]) {
    const f = menuRuntime({ item: { ...menuFixture, stock_quantity: stock } });
    f.choice(10, 11);
    const html = renderToStaticMarkup(f.tree());
    const quantity = renderToStaticMarkup(f.find((n) => n.props?.className === 'quantity'));
    if (stock >= 1 && stock <= 5) assert.ok(quantity.includes(`เหลือเพียง ${stock} รายการ`));
    else assert.doesNotMatch(quantity, /<small|เหลือ|มีสินค้า/);
    assert.equal(html.includes('>หมด</div>'), stock === 0);
    assert.equal(f.cta().props.disabled, stock === 0);
    if (stock === 0) continue;
    const limit = stock === null ? 99 : stock;
    f.state[2] = limit - 1;
    f.find((n) => n.props?.['aria-label'] === 'เพิ่มจำนวน').props.onClick();
    assert.equal(f.state[2], limit);
    const increase = f.find((n) => n.props?.['aria-label'] === 'เพิ่มจำนวน');
    assert.equal(increase.props.disabled, true);
    increase.props.onClick(); // Even a direct handler invocation retains the existing clamp.
    assert.equal(f.state[2], limit);
    f.cta().props.onClick();
    assert.equal(f.added[0][0].quantity, limit);
    assert.equal(f.added[0][0].unitPriceEstimate, 60);
    assert.equal(JSON.stringify(f.added[0][0].optionChoiceIds), '[11]');
  }
});

test('Local Rice selection retains English cart identifiers, names and price calculation', () => {
  const f = menuRuntime({ item: { ...menuFixture, name: 'Garlic Chicken Rice', image_url: '/demo/garlic-chicken.svg', price: 65, stock_quantity: 12,
    option_groups: [{ id: 30, name: 'Rice', is_required: true, min_choices: 1, max_choices: 1,
      choices: [{ id: 31, name: 'Jasmine rice', is_available: true, extra_price: 0 }, { id: 32, name: 'Brown rice', is_available: true, extra_price: 10 }] }] } });
  f.choice(30, 32);
  f.find((n) => n.props?.['aria-label'] === 'เพิ่มจำนวน').props.onClick();
  assert.match(renderToStaticMarkup(f.find((n) => n.props?.['aria-live'] === 'polite')), /฿150/);
  f.cta().props.onClick();
  const payload = f.added[0][0];
  assert.equal(JSON.stringify(payload.optionChoiceIds), '[32]');
  assert.equal(payload.choices[0].name, 'Brown rice');
  assert.equal(payload.choices[0].groupName, 'Rice');
  assert.equal(payload.choices[0].extraPrice, 10);
  assert.equal(payload.quantity, 2); assert.equal(payload.unitPriceEstimate, 65);
});

test('menu presentation preserves header/nav, hero ratio, sticky offset, note/quantity labels and content clearance', () => {
  const f = menuRuntime();
  const html = renderToStaticMarkup(f.tree());
  for (const text of ['รายละเอียดเมนู', 'Local Kitchen · Rice Dishes', 'Local Basil Rice', 'หมายเหตุถึงร้าน', 'เช่น ไม่ใส่ผัก แยกน้ำ', 'ลดจำนวน', 'เพิ่มจำนวน', 'aria-disabled="true"']) assert.ok(html.includes(text));
  assert.match(html, /customer-bottom-nav/);
  const css = read('frontend/components/customer/menu-detail.module.css');
  for (const rule of [/aspect-ratio: 4 \/ 3/, /-webkit-line-clamp: 3/, /min-height: 52px/, /\.selected, \.selected:hover \{[^}]*#fff7f5/, /min-height: 100px/, /min-height: 54px/, /bottom: calc\(69px \+ env\(safe-area-inset-bottom\)\)/, /width: min\(100%, 760px\)/, /padding: 16px 16px 110px/, /:focus-visible/]) assert.match(css, rule);
});

test('menu controls expose explicit selected colors, high-contrast fallback, spacing and 44px stepper', () => {
  const css = read('frontend/components/customer/menu-detail.module.css');
  for (const rule of [/input:checked \{ border-color: #ac3520/, /input\[type="radio"\]:checked::before \{[^}]*background: #ac3520/,
    /input\[type="checkbox"\]:checked \{ background: #ac3520/, /input\[type="checkbox"\]:checked::before \{[^}]*background: #fff;/,
    /forced-colors: active/, /appearance: auto/, /\.option-groups\) \{ gap: 22px/, /\.menuContent \{ display: grid; gap: 22px/,
    /\.quantity-control button\) \{ width: 44px; height: 44px/, /font-variant-numeric: tabular-nums/,
    /\.quantity-control button:disabled\) \{[^}]*cursor: not-allowed/]) assert.match(css, rule);
});

test('menu sections share one centered width authority and place note before final quantity control', () => {
  for (const item of [menuFixture, { ...menuFixture, option_groups: [] }]) {
    const f = menuRuntime({ item });
    const content = f.find((n) => n.props?.className === 'menuContent');
    assert.ok(content);
    const sections = content.props.children.filter((n) => n && n.props);
    assert.deepEqual(Array.from(sections, (n) => n.props.className), item.option_groups.length
      ? ['menu-detail-copy', 'option-groups', 'note', 'quantity'] : ['menu-detail-copy', 'note', 'quantity']);
    const html = renderToStaticMarkup(f.tree());
    assert.ok(html.indexOf('<textarea') < html.indexOf('id="menu-quantity-title"'));
    assert.ok(html.indexOf('id="menu-quantity-title"') < html.indexOf('class="purchaseBar"'));
  }
  const css = read('frontend/components/customer/menu-detail.module.css');
  assert.match(css, /\.menuContent \{[^}]*width: 100%; max-width: 620px;[^}]*margin-inline: auto; padding-inline: 0/);
  assert.match(css, /\.page \.menuContent > \* \{ width: 100%; max-width: none; min-width: 0; margin: 0;/);
  assert.match(css, /\.quantity \{[^}]*align-items: center; justify-content: space-between/);
  assert.match(css, /\.note textarea \{ width: 100%;[^}]*max-width: 100%;[^}]*border-radius: 15px/);
  assert.doesNotMatch(css, /\.quantity, \.note \{[^}]*border-top/);
});

test('menu hero uses real image when present and existing merchant guidance remains advisory', () => {
  const withImage = renderToStaticMarkup(menuRuntime().tree());
  assert.match(withImage, /src="\/demo\/basil-rice.svg"/);
  const noImage = renderToStaticMarkup(menuRuntime({ item: { ...menuFixture, image_url: null } }).tree());
  assert.doesNotMatch(noImage, /src="\/demo\/basil-rice.svg"/);
  assert.match(read('frontend/components/customer/menu-detail.module.css'), /menu-detail-image img\) \{ object-fit: cover/);
  const merchant = read('frontend/components/merchant-editors.js').split('export function ImageUpload')[1].split('export function StoreSettings')[0];
  assert.match(merchant, /แนะนำ 1000 × 1000 px/);
  assert.match(merchant, /JPG, PNG หรือ WebP/);
  assert.doesNotMatch(merchant, /naturalWidth|naturalHeight|createImageBitmap/);
});

test('unchanged real CartProvider preserves subtotal, badge, edit/note and one-merchant guard in memory', () => {
  const storage = new Map();
  let accepted = false;
  let nextId = 0;
  const { CartProvider } = component('frontend/lib/cart.js', {
    hooks: { useSyncExternalStore: (_, snapshot) => snapshot(), useMemo: (fn) => fn() },
    globals: { window: { localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, confirm: () => accepted }, crypto: { randomUUID: () => `fixture-${++nextId}` } },
  });
  const cart = () => CartProvider({ children: null }).props.value;
  const payload = { merchantId: 1, merchantName: 'Fixture Kitchen', menuItemId: 1, name: 'Rice', quantity: 2, unitPriceEstimate: 60,
    optionChoiceIds: [21], choices: [{ id: 21, extraPrice: 10 }], note: 'ไม่ใส่ผัก' };
  assert.equal(cart().addOrUpdate(payload), true);
  assert.equal(cart().count, 2); assert.equal(cart().estimatedSubtotal, 140);
  const id = cart().cart.items[0].id;
  assert.equal(cart().addOrUpdate({ ...payload, quantity: 1 }, id), true);
  assert.equal(cart().cart.items.length, 1); assert.equal(cart().estimatedSubtotal, 70);
  cart().setNote(id, 'แยกน้ำ'); assert.equal(cart().cart.items[0].note, 'แยกน้ำ');
  assert.equal(cart().addOrUpdate({ ...payload, merchantId: 2 }), false);
  assert.equal(cart().cart.merchantId, 1);
  accepted = true; assert.equal(cart().addOrUpdate({ ...payload, merchantId: 2 }), true);
  assert.equal(cart().cart.items.length, 1); assert.equal(cart().cart.merchantId, 2);
  cart().clear(); assert.equal(cart().count, 0); assert.equal(storage.size, 0);
});

const cartCard = 'frontend/components/customer/cart-item-card.js';
const cartControls = 'frontend/components/customer/cart-controls.js';
const cartItem = { id: 'cart-fixture', merchantId: 1, merchantName: 'Local Kitchen', menuItemId: 1, name: 'Local Basil Rice',
  imageUrl: '/demo/basil-rice.svg', unitPriceEstimate: 60, quantity: 2, note: 'ไม่ใส่ผัก แยกน้ำ', optionChoiceIds: [11, 21],
  choices: [{ id: 11, name: 'Mild', extraPrice: 0, groupId: 10, groupName: 'Spiciness' }, { id: 21, name: 'Fried egg', extraPrice: 10, groupId: 20, groupName: 'Extras' }] };
const cartData = { cart: { merchantId: 1, merchantName: 'Local Kitchen', items: [cartItem] }, count: 2, estimatedSubtotal: 140,
  setQuantity() {}, setNote() {}, removeItem() {}, clear() {} };

test('compact cart cards retain price math, edit route, notes and full accessible action row', () => {
  const html = render(cartCard, 'CartItemCard', { item: cartItem });
  assert.match(html, /฿140/); assert.match(html, /฿70 × 2/);
  assert.match(html, /หมายเหตุ:/); assert.match(html, /ไม่ใส่ผัก แยกน้ำ/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /href="\/menu\/1\?cartItem=cart-fixture"/);
  assert.match(html, /aria-label="เพิ่มจำนวน Local Basil Rice"/);
  assert.match(html, /aria-label="ลดจำนวน Local Basil Rice"/);
  assert.match(html, /aria-label="ลบ Local Basil Rice"/);
  assert.match(html, /sizes="84px"/);
  const single = render(cartCard, 'CartItemCard', { item: { ...cartItem, quantity: 1, note: '', choices: [] } });
  assert.match(single, /฿60/); assert.doesNotMatch(single, / × 1/);
  assert.match(single, /\+ เพิ่มหมายเหตุ/); assert.doesNotMatch(single, /<textarea|class="options"/);
});

test('cart option display reuses exact local Menu labels without translating merchant data or payload', () => {
  const { cartChoiceLabel } = component(cartCard);
  const before = JSON.stringify(cartItem);
  assert.equal(cartChoiceLabel(cartItem, cartItem.choices[0], true), 'ระดับความเผ็ด: ไม่เผ็ด');
  assert.equal(cartChoiceLabel(cartItem, cartItem.choices[1], true), 'เพิ่มเติม: ไข่ดาว +฿10');
  for (const [groupName, name, expected] of [
    ['Spiciness', 'Mild', 'ระดับความเผ็ด: ไม่เผ็ด'], ['Spiciness', 'Medium', 'ระดับความเผ็ด: เผ็ดกลาง'],
    ['Spiciness', 'Hot', 'ระดับความเผ็ด: เผ็ดมาก'], ['Extras', 'Fried egg', 'เพิ่มเติม: ไข่ดาว'], ['Extras', 'Extra rice', 'เพิ่มเติม: เพิ่มข้าว'],
  ]) {
    const choice = { id: 90, groupName, name, extraPrice: 0 };
    assert.equal(cartChoiceLabel(cartItem, choice, true), expected);
    assert.equal(cartChoiceLabel(cartItem, choice, false), `${groupName}: ${name}`);
    assert.equal(cartChoiceLabel({ ...cartItem, merchantName: 'Real Merchant' }, choice, true), `${groupName}: ${name}`);
    assert.equal(cartChoiceLabel({ ...cartItem, imageUrl: '/merchant/image.jpg' }, choice, true), `${groupName}: ${name}`);
    assert.equal(choice.id, 90); assert.equal(choice.name, name); assert.equal(choice.groupName, groupName);
  }
  assert.equal(cartChoiceLabel(cartItem, cartItem.choices[0], false), 'Spiciness: Mild');
  assert.equal(cartChoiceLabel({ ...cartItem, merchantName: 'Real Merchant' }, cartItem.choices[0], true), 'Spiciness: Mild');
  assert.equal(JSON.stringify(cartItem), before);
});

test('cart details put secondary unit breakdown under options, leaving only total at top right', () => {
  const { CartItemCard } = component(cartCard);
  for (const quantity of [1, 2]) {
    const item = { ...cartItem, name: 'Crispy Pork Basil Rice', unitPriceEstimate: 75, quantity, choices: [cartItem.choices[0]], note: '' };
    const tree = CartItemCard({ item });
    const children = Array.from(tree.props.children).filter((n) => n && n.props);
    const details = children.find((n) => n.props.className === 'copy');
    const blocks = Array.from(details.props.children).filter((n) => n && n.props);
    assert.deepEqual(blocks.map((n) => n.props.className), quantity > 1 ? ['itemTitle', 'options', 'unitBreakdown'] : ['itemTitle', 'options']);
    const title = renderToStaticMarkup(blocks[0]);
    assert.match(title, new RegExp(`฿${75 * quantity}`));
    assert.doesNotMatch(title, / × |unitBreakdown/);
    const html = render(cartCard, 'CartItemCard', { item });
    if (quantity > 1) {
      assert.match(html, /<p class="unitBreakdown">฿75 × 2<\/p>/);
      assert.ok(html.indexOf('class="options"') < html.indexOf('class="unitBreakdown"'));
      assert.ok(html.indexOf('class="unitBreakdown"') < html.indexOf('class="noteSummary"'));
    } else assert.doesNotMatch(html, /unitBreakdown| × 1/);
    assert.ok(html.indexOf('class="noteSummary"') < html.indexOf('class="actions"'));
  }
  const css = read('frontend/components/customer/cart.module.css');
  assert.match(css, /\.unitBreakdown \{ margin: 6px 0 0; color: #746d65; font-size: 12px/);
  assert.match(css, /\.price strong \{ color: #ac3520; font-size: 16px/);
});

test('additional seeded spicy meals translate only exact local tuples and preserve choices/payload', () => {
  const { cartChoiceLabel } = component(cartCard);
  const fixtures = [
    ['Local Kitchen', 'Crispy Pork Basil Rice', '/demo/basil-rice.svg'],
    ['Soi Noodle House', 'Tom Yum Noodles', '/demo/tom-yum-noodles.svg'],
    ['Soi Noodle House', 'Spicy Dry Noodles', '/demo/dry-noodles.svg'],
  ];
  for (const [merchantName, name, imageUrl] of fixtures) {
    const item = { ...cartItem, merchantName, name, imageUrl };
    const before = JSON.stringify(item);
    for (const [name, thai] of [['Mild', 'ไม่เผ็ด'], ['Medium', 'เผ็ดกลาง'], ['Hot', 'เผ็ดมาก']]) {
      const choice = { id: 111, groupId: 222, groupName: 'Spiciness', name, extraPrice: 0 };
      assert.equal(cartChoiceLabel(item, choice, true), `ระดับความเผ็ด: ${thai}`);
      for (const [candidate, development] of [[item, false], [{ ...item, merchantName: 'Real Merchant' }, true],
        [{ ...item, name: 'Merchant meal' }, true], [{ ...item, imageUrl: '/uploads/real-food.jpg' }, true]]) {
        assert.equal(cartChoiceLabel(candidate, choice, development), `Spiciness: ${name}`);
      }
      assert.equal(cartChoiceLabel(item, { ...choice, groupName: 'Chef choices' }, true), `Chef choices: ${name}`);
      assert.equal(choice.name, name); assert.equal(choice.id, 111); assert.equal(choice.groupId, 222);
    }
    assert.equal(JSON.stringify(item), before);
  }
  const html = render(cartCard, 'CartItemCard', { item: { ...cartItem, name: 'Crispy Pork Basil Rice', choices: [cartItem.choices[0]] } },
    { globals: { process: { env: { NODE_ENV: 'development' } } } });
  assert.match(html, /ระดับความเผ็ด: ไม่เผ็ด/);
  assert.doesNotMatch(html, /Spiciness|Mild/);
});

function cartControlRuntime(name, props) {
  const values = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const loaded = component(cartControls, { hooks: {
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], (next) => { values[i] = next; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] || (refs[i] = { current: initial }); },
    useId: () => 'fixture-control', useEffect() {},
  } });
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
  function tree() { stateIndex = 0; refIndex = 0; return loaded[name](props); }
  return { tree, find: (predicate) => nodes(tree()).find(predicate) };
}

test('inline note editor saves once with original item ID/string, cancel never writes, and returns compact', () => {
  const saved = [];
  const f = cartControlRuntime('CartNoteEditor', { item: cartItem, onNoteChange: (...args) => saved.push(args) });
  assert.equal(f.find((n) => n.type === 'textarea'), undefined);
  f.find((n) => n.type === 'button').props.onClick();
  assert.equal(f.find((n) => n.type === 'textarea').props.value, cartItem.note);
  const input = f.find((n) => n.type === 'textarea');
  assert.equal(input.props.maxLength, 500); assert.equal(input.props.placeholder, 'เช่น ไม่ใส่ผัก แยกน้ำ');
  assert.equal(f.find((n) => n.type === 'label').props.htmlFor, input.props.id);
  input.props.onChange({ target: { value: '  ไม่ใส่พริก  ' } });
  assert.equal(saved.length, 0);
  f.find((n) => n.type === 'button' && n.props.children === 'ยกเลิก').props.onClick();
  assert.equal(saved.length, 0); assert.equal(f.find((n) => n.type === 'textarea'), undefined);
  f.find((n) => n.type === 'button').props.onClick();
  assert.equal(f.find((n) => n.type === 'textarea').props.value, cartItem.note);
  f.find((n) => n.type === 'textarea').props.onChange({ target: { value: '  แยกน้ำ  ' } });
  f.find((n) => n.type === 'button' && n.props.children === 'บันทึก').props.onClick();
  assert.deepEqual(saved, [['cart-fixture', '  แยกน้ำ  ']]);
  assert.equal(f.find((n) => n.type === 'textarea'), undefined);
});

test('clear confirmation is initially closed, focuses cancel and only explicit confirm calls existing clear', () => {
  let cleared = 0, opened = 0, closed = 0, focused = 0;
  const f = cartControlRuntime('ClearCartButton', { onConfirm: () => cleared++ });
  const dialog = f.find((n) => n.type === 'dialog');
  assert.equal(dialog.props.open, undefined);
  assert.equal(dialog.props['aria-labelledby'], 'fixture-control-title');
  assert.equal(dialog.props['aria-describedby'], 'fixture-control-description');
  dialog.props.ref.current = { showModal: () => opened++, close: () => closed++ };
  const cancel = f.find((n) => n.type === 'button' && n.props.children === 'ยกเลิก');
  cancel.props.ref.current = { focus: () => focused++ };
  const trigger = f.find((n) => n.props?.['aria-haspopup'] === 'dialog');
  trigger.props.ref.current = { focus: () => focused++ };
  trigger.props.onClick(); assert.equal(opened, 1); assert.equal(focused, 1); assert.equal(cleared, 0);
  cancel.props.onClick(); assert.equal(closed, 1); assert.equal(cleared, 0);
  trigger.props.onClick();
  f.find((n) => n.type === 'button' && n.props.className === 'destructive').props.onClick();
  assert.equal(cleared, 1); assert.equal(closed, 2);
  dialog.props.onClose(); assert.equal(focused, 3);
  const html = render(cartControls, 'ClearCartButton', { onConfirm() {} });
  assert.match(html, /ล้างตะกร้าทั้งหมด\?/); assert.match(html, /สินค้าทั้งหมดในตะกร้าจะถูกนำออก/);
});

test('cart quantity/remove actions keep original calls including minus-at-one removal and 99 cap UI', () => {
  const calls = [];
  const { CartItemCard } = component(cartCard);
  function nodes(value) { if (!value || typeof value !== 'object') return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; }
  function buttons(quantity) { return nodes(CartItemCard({ item: { ...cartItem, quantity }, onQuantityChange: (...args) => calls.push(['quantity', ...args]), onRemove: (id) => calls.push(['remove', id]) })); }
  buttons(2).find((n) => n.props?.['aria-label']?.startsWith('ลดจำนวน')).props.onClick();
  buttons(2).find((n) => n.props?.['aria-label']?.startsWith('เพิ่มจำนวน')).props.onClick();
  buttons(1).find((n) => n.props?.['aria-label']?.startsWith('ลดจำนวน')).props.onClick();
  buttons(2).find((n) => n.props?.['aria-label'] === `ลบ ${cartItem.name}`).props.onClick();
  assert.deepEqual(calls, [['quantity', 'cart-fixture', 1], ['quantity', 'cart-fixture', 3], ['remove', 'cart-fixture'], ['remove', 'cart-fixture']]);
  assert.equal(buttons(99).find((n) => n.props?.['aria-label']?.startsWith('เพิ่มจำนวน')).props.disabled, true);
});

test('cart page keeps shared navigation/count and checkout, shows empty state without checkout or clear', () => {
  const html = render('frontend/app/cart/page.js', 'default', {}, { cart: cartData, pathname: '/cart' });
  for (const text of ['ตะกร้าของฉัน', 'Local Kitchen', '1 เมนู · 2 ชิ้น', 'รวมทั้งหมด', '฿140', 'ตรวจสอบออเดอร์', 'ยังไม่รวมค่าส่ง']) assert.ok(html.includes(text));
  assert.match(html, /href="\/stores\/1"/); assert.match(html, /href="\/checkout"/);
  assert.match(html, /class="cart-badge">2</);
  assert.match(html, /href="\/cart" class="nav-cart is-active" aria-current="page"/);
  assert.doesNotMatch(html, /ระบบจะคำนวณ/);
  const empty = render('frontend/app/cart/page.js', 'default', {}, { cart: { ...cartData, count: 0, cart: { items: [] } }, pathname: '/cart' });
  assert.match(empty, /ตะกร้ายังว่าง/); assert.match(empty, /เลือกเมนูที่ชอบแล้วกลับมาที่นี่ได้เลย/);
  assert.match(empty, /เลือกอาหาร/); assert.match(empty, /customer-bottom-nav/);
  assert.doesNotMatch(empty, /checkoutBar|ล้างตะกร้า|href="\/checkout"/);
});

test('cart header distinguishes line count from quantity even when two lines share the same menu ID', () => {
  const items = [cartItem, { ...cartItem, id: 'second-line', quantity: 1 }];
  const before = JSON.stringify(items);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const html = render('frontend/app/cart/page.js', 'default', {}, {
    cart: { ...cartData, cart: { ...cartData.cart, items }, count, estimatedSubtotal: 210 }, pathname: '/cart',
  });
  assert.match(html, /2 เมนู · 3 ชิ้น/);
  assert.doesNotMatch(html, /3 รายการ/);
  assert.match(html, /class="cart-badge">3</);
  assert.match(html, /฿210/);
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.equal(JSON.stringify(items), before);
});

test('cart scoped layout preserves 84px media, full-width actions, safe-area clearance and touch/focus contracts', () => {
  const css = read('frontend/components/customer/cart.module.css');
  for (const rule of [/grid-template-columns: 84px minmax\(0, 1fr\)/, /width: 84px; height: 84px/, /object-fit: cover/,
    /grid-column: 1 \/ -1/, /min-height: 44px/, /width: 44px; height: 44px/, /:disabled/,
    /bottom: calc\(69px \+ env\(safe-area-inset-bottom\)\)/, /width: min\(100%, 760px\)/,
    /padding: 16px 16px 130px/, /min-height: 54px/, /:focus-visible/, /\.confirmDialog::backdrop/]) assert.match(css, rule);
  assert.match(css, /\.headingActions > a \{[^}]*border: 1px solid #dedad6; border-radius: 999px/);
  assert.match(css, /\.clearButton \{[^}]*color: #b42318/);
});


test('staff portal routing isolates rider and kitchen while preserving permitted merchant navigation', () => {
  const { staffHome, staffRouteRedirect, merchantNavigation, orderFilters, staffErrorMessage } = component('frontend/lib/staff-portal.mjs');
  for (const [role, home] of Object.entries({ MANAGER: '/merchant', CASHIER: '/merchant/orders', KITCHEN: '/merchant/kitchen', RIDER: '/rider' })) {
    assert.equal(staffHome(role), home);
    assert.equal(staffRouteRedirect(role, home), null);
  }
  for (const path of ['/merchant', '/merchant/orders', '/merchant/kitchen', '/merchant/menu', '/merchant/orders/77']) assert.equal(staffRouteRedirect('RIDER', path), '/rider');
  assert.equal(staffRouteRedirect('KITCHEN', '/merchant'), '/merchant/kitchen');
  assert.equal(staffRouteRedirect('KITCHEN', '/merchant/orders/77'), null);
  assert.equal(staffRouteRedirect('MANAGER', '/rider/orders/77'), '/merchant');
  assert.equal(merchantNavigation('RIDER').length, 0);
  const kitchen = merchantNavigation('KITCHEN').map((item) => item.href);
  assert.deepEqual(Array.from(kitchen), ['/merchant/kitchen', '/merchant/menu']);
  assert.ok(!merchantNavigation('CASHIER').some((item) => ['/merchant/riders', '/merchant/staff', '/merchant/store'].includes(item.href)));
  assert.deepEqual(Array.from(orderFilters.find(([key]) => key === 'cancelled')[2]), ['CANCELLED', 'REJECTED']);
  assert.doesNotMatch(staffErrorMessage({ status: 403, body: { message: 'RIDER cannot perform VIEW' } }), /RIDER|VIEW|cannot perform/);
});

function staffSessionRuntime(role, pathname, loggedIn = true) {
  const values = [null, null, true, ''], effects = [], routes = [], calls = [];
  let index = 0;
  const hook = component('frontend/lib/use-merchant-staff.js', { pathname, router: { replace: (path) => routes.push(path) }, hooks: {
    useState(initial) { const i = index++; return [i in values ? values[i] : initial, (v) => { values[i] = v; }]; },
    useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
  }, globals: { fetch: async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/config') ? { mode: 'mock', dev_login_enabled: true } : { staff: { id: 1, role, merchant_id: 1 } };
    const unauthenticated = !loggedIn && url.endsWith('/me');
    return { ok: !unauthenticated, status: unauthenticated ? 401 : 200, json: async () => body };
  } } });
  const renderHook = () => { index = 0; effects.length = 0; return hook.useMerchantStaff(); };
  return { renderHook, effects, routes, calls };
}

test('real staff session hook hides unauthorized staff from page effects before redirect; login lands by verified role', async () => {
  for (const role of ['MANAGER', 'CASHIER', 'KITCHEN', 'RIDER']) {
    const f = staffSessionRuntime(role, '/merchant/kitchen');
    f.renderHook(); f.effects[1](); await new Promise((resolve) => setImmediate(resolve));
    const session = f.renderHook(); f.effects[0]();
    if (role === 'RIDER') { assert.equal(session.staff, null); assert.equal(session.loading, true); assert.deepEqual(f.routes, ['/rider']); }
    else assert.equal(session.staff.role, role);
    assert.ok(f.calls.every(({ url }) => url.startsWith('/api/merchant/auth/')));
    const login = staffSessionRuntime(role, '/merchant', false);
    login.renderHook(); login.effects[1](); await new Promise((resolve) => setImmediate(resolve));
    await login.renderHook().login('fixture');
    const expected = { MANAGER: '/merchant', CASHIER: '/merchant/orders', KITCHEN: '/merchant/kitchen', RIDER: '/rider' }[role];
    assert.deepEqual(login.routes, [expected]);
  }
});

test('merchant shell renders four manager mobile entries and a closed accessible More dialog; rider shell stays isolated', () => {
  const html = render('frontend/components/merchant-shell.js', 'MerchantShell', { staff: { role: 'MANAGER' }, children: 'Fixture' }, { pathname: '/merchant' });
  const nav = html.match(/<nav class="merchant-nav"[^]*?<\/nav>/)[0];
  for (const label of ['ภาพรวม', 'ออเดอร์', 'ครัว', 'เพิ่มเติม']) assert.ok(nav.includes(label));
  assert.match(html, /aria-haspopup="dialog"/); assert.doesNotMatch(html, /<dialog[^>]* open/);
  const kitchen = render('frontend/components/merchant-shell.js', 'MerchantShell', { staff: { role: 'KITCHEN' } }, { pathname: '/merchant/kitchen' });
  assert.doesNotMatch(kitchen, /href="\/merchant\/(riders|staff|reports|store)"/);
  const rider = render('frontend/components/rider-shell.js', 'RiderShell', {}, { pathname: '/rider' });
  assert.doesNotMatch(rider, /href="\/merchant/);
});

test('assignment picker shows server supplied workload, requires selection and never fabricates a merchant relationship', () => {
  const html = render('frontend/components/rider-assignment-picker.js', 'RiderAssignmentPicker', {
    riders: [{ id: 1, full_name: 'Own Rider', active_jobs: 0 }, { id: 2, full_name: 'Busy Rider', active_jobs: 2 }], selectedId: '1', busy: false,
  });
  for (const label of ['Own Rider', 'Busy Rider', 'ว่าง', 'มีงาน 2 งาน']) assert.ok(html.includes(label));
  assert.match(html, /type="radio"/); assert.doesNotMatch(html, /<dialog[^>]* open/);
  const empty = render('frontend/components/rider-assignment-picker.js', 'RiderAssignmentPicker', { riders: [], selectedId: '' });
  assert.match(empty, /disabled=""/);
});

test('merchant snapshot demo labels reuse customer mapping only with local provenance and never mutate snapshot', () => {
  const { snapshotChoiceLabel } = component('frontend/components/merchant-snapshot-label.js');
  const item = { item_name: 'Local Basil Rice', local_demo_menu: { name: 'Local Basil Rice', store_name: 'Local Kitchen', image_url: '/demo/basil-rice.svg' } };
  const choice = { choice_name: 'Mild', extra_price: 0, local_demo_group: 'Spiciness' };
  const before = JSON.stringify({ item, choice });
  assert.equal(snapshotChoiceLabel(item, choice, true), 'ระดับความเผ็ด: ไม่เผ็ด');
  assert.equal(snapshotChoiceLabel(item, choice, false), 'Mild');
  assert.equal(snapshotChoiceLabel({ item_name: 'Local Basil Rice' }, choice, true), 'Mild');
  assert.match(snapshotChoiceLabel({ ...item, local_demo_menu: { ...item.local_demo_menu, store_name: 'Real Store' } }, choice, true), /Mild/);
  assert.equal(JSON.stringify({ item, choice }), before);
});

test('merchant/rider responsive contracts retain bounded dialogs, wrapping navigation, two-column tablet KDS and independent rider routes', () => {
  const css = read('frontend/app/globals.css');
  for (const pattern of [/width: calc\(100% - 32px\)/, /max-height: 85dvh/, /portal-filters \{ display: flex; flex-wrap: wrap/, /repeat\(2,minmax\(0,1fr\)\)/, /portal-app.*focus-visible/]) assert.match(css, pattern);
  assert.doesNotMatch(read('frontend/app/merchant/kitchen/page.js'), /'ACCEPTED', 'PREPARING', 'READY'/);
});

test('management editors receive friendly errors even when backend denial contains permission internals', async () => {
  const { managementApi } = component('frontend/components/merchant-management.js', { globals: {
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'staff_permission_denied', message: 'RIDER cannot perform VIEW' }) }),
  } });
  await assert.rejects(() => managementApi('/store'), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.message, 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการนี้');
    return true;
  });
});


const kdsOrder = { id: 1, order_code: 'LOC-14', status: 'PREPARING', created_at: '2026-10-08T10:00:00Z',
  items: [{ id: 7, item_name: 'Fixture Rice', quantity: 1, choices: [], note: 'No cutlery', is_completed: false }] };
function staffUiRuntime(file, name, props = {}, globals = {}, initial = [], staffSession) {
  const values = [...initial], refs = [], effects = [];
  let index = 0, refIndex = 0;
  const loaded = component(file, { staffSession, globals, hooks: {
    useState(value) { const i = index++; if (!(i in values)) values[i] = typeof value === 'function' ? value() : value; return [values[i], (next) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef(value) { const i = refIndex++; return refs[i] || (refs[i] = { current: value }); }, useEffect: (fn) => effects.push(fn),
  } });
  const tree = () => { index = 0; refIndex = 0; effects.length = 0; return loaded[name](props); };
  return { tree, values, refs, effects, nodes: () => checkoutNodes(tree()) };
}

test('KDS presentation keeps role permissions, 15-minute warning, snapshot notes and explicit Ready', () => {
  const props = { order: kdsOrder, now: Date.parse('2026-10-08T10:20:00Z') };
  for (const role of ['MANAGER', 'KITCHEN', 'CASHIER']) {
    const html = render('frontend/components/kitchen-ticket.js', 'KitchenTicket', { ...props, role });
    assert.match(html, /รอ 20 นาที/); assert.match(html, /is-waiting/); assert.match(html, /No cutlery/);
    assert.equal(html.includes('type="checkbox"'), role !== 'CASHIER');
    assert.equal(html.includes('ทำครบทุกเมนู'), role !== 'CASHIER');
    assert.doesNotMatch(html, /อาหารพร้อมจัดส่ง/);
  }
  const completed = render('frontend/components/kitchen-ticket.js', 'KitchenTicket', { ...props, role: 'KITCHEN', order: { ...kdsOrder, items: [{ ...kdsOrder.items[0], is_completed: true }] } });
  assert.match(completed, /ครบทุกเมนูแล้ว/); assert.match(completed, /อาหารพร้อมจัดส่ง/);
  const accepted = render('frontend/components/kitchen-ticket.js', 'KitchenTicket', { ...props, role: 'KITCHEN', order: { ...kdsOrder, status: 'ACCEPTED' } });
  assert.doesNotMatch(accepted, /<button/); assert.match(accepted, /รอพนักงานเริ่ม/);
});

test('KDS checkbox reuses PATCH boolean payload, suppresses a duplicate event and preserves snapshots', async () => {
  const calls = [], updated = []; let release;
  const before = JSON.stringify(kdsOrder);
  const f = staffUiRuntime('frontend/components/kitchen-ticket.js', 'KitchenTicket', { order: kdsOrder, role: 'KITCHEN', now: 0, onUpdated: (order) => updated.push(order) }, {
    fetch: async (url, options) => { calls.push({ url, options }); await new Promise((resolve) => { release = resolve; }); return { ok: true, status: 200, json: async () => ({ order: { ...kdsOrder, items: [{ ...kdsOrder.items[0], is_completed: true }] } }) }; },
  });
  const checkbox = f.nodes().find((node) => node.props?.type === 'checkbox');
  const first = checkbox.props.onChange(); await checkbox.props.onChange();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/merchant/orders/1/items/7');
  assert.equal(calls[0].options.method, 'PATCH'); assert.equal(calls[0].options.body, '{"completed":true}');
  assert.equal(f.nodes().find((node) => node.props?.type === 'checkbox').props.disabled, true);
  release(); await first;
  assert.equal(updated.length, 1); assert.equal(JSON.stringify(kdsOrder), before);
});

test('Rider completion requires confirmation, Cancel sends nothing, and focus returns to trigger', () => {
  const actions = []; let shown = 0, closed = 0, focused = 0;
  const f = staffUiRuntime('frontend/components/rider-delivery-action.js', 'RiderDeliveryAction', { status: 'DELIVERING', busy: false, onTransition: (value) => actions.push(value) });
  let nodes = f.nodes();
  const dialog = nodes.find((node) => node.type === 'dialog');
  dialog.props.ref.current = { showModal: () => shown++, close: () => closed++ };
  const trigger = nodes.find((node) => node.type === 'button' && node.props.children === 'ส่งสำเร็จ');
  trigger.props.ref.current = { focus: () => focused++ };
  trigger.props.onClick(); assert.equal(shown, 1); assert.equal(actions.length, 0);
  nodes.find((node) => node.props?.children === 'ยกเลิก').props.onClick(); dialog.props.onClose();
  assert.equal(closed, 1); assert.equal(focused, 1); assert.equal(actions.length, 0);
  nodes.find((node) => node.props?.children === 'ยืนยันส่งสำเร็จ').props.onClick(); assert.deepEqual(actions, ['complete']);
  const complete = render('frontend/components/rider-delivery-action.js', 'RiderDeliveryAction', { status: 'COMPLETED' });
  assert.equal(complete, '');
});

test('real Rider detail request handler prevents double submission and uses existing transition endpoint', async () => {
  let release; const calls = [];
  const f = staffUiRuntime('frontend/app/rider/orders/[id]/page.js', 'default', {}, {
    fetch: async (url, options) => { calls.push({ url, options }); await new Promise((resolve) => { release = resolve; }); return { ok: true, status: 200, json: async () => ({ order: { ...kdsOrder, status: 'COMPLETED' } }) }; },
  }, [{ ...kdsOrder, status: 'DELIVERING' }, false, ''], { staff: { id: 8, role: 'RIDER', store_name: 'Fixture Store' }, loading: false });
  const action = f.nodes().find((node) => node.type?.name === 'RiderDeliveryAction');
  const first = action.props.onTransition('complete'); await action.props.onTransition('complete');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/rider/orders/1/complete');
  assert.equal(calls[0].options.body, '{}'); assert.equal(calls[0].options.method, 'POST');
  release(); await first; assert.equal(f.values[0].status, 'COMPLETED');
});

test('dashboard primary hierarchy is six cards and at most three quick actions with no invented totals', () => {
  const data = { metrics: { completed_orders: 2, revenue_today: '185.00' }, today_status: [{ status: 'PENDING', count: 1 }, { status: 'ACCEPTED', count: 1 }, { status: 'PREPARING', count: 2 }], recent: [] };
  const f = staffUiRuntime('frontend/components/merchant-management.js', 'Dashboard', { session: { staff: { id: 1, role: 'MANAGER', store_name: 'Fixture Store' } } }, {}, [data, '', 0, []]);
  const nodes = f.nodes(); assert.equal(nodes.filter((node) => node.type === 'article').length, 6);
  const quick = nodes.find((node) => node.props?.className?.includes('portal-quick-actions'));
  assert.equal(checkoutNodes(quick).filter((node) => node.props?.href).length, 3);
  const html = renderToStaticMarkup(f.tree());
  assert.match(html, /ยังไม่มีออเดอร์/); assert.doesNotMatch(html, /เฉลี่ยต่อออเดอร์|ไรเดอร์ที่เปิดใช้งาน|ACCEPTED/);
});

test('Developer tools are collapsed and absent from production even if mock config is accidentally supplied', () => {
  for (const environment of ['development', 'production']) {
    const html = render('frontend/components/staff-dev-tools.js', 'StaffDevTools', { enabled: true }, { globals: { process: { env: { NODE_ENV: environment } } } });
    if (environment === 'production') assert.equal(html, '');
    else { assert.match(html, /Developer tools/); assert.match(html, /local_rider/); assert.doesNotMatch(html, /<details[^>]* open/); }
  }
});

test('Rider job previews are assigned-response only and link to detail without exposing payment internals', () => {
  const html = render('frontend/components/rider-job-card.js', 'RiderJobCard', { order: { ...kdsOrder, status: 'READY', delivery: { label: 'Home', dormitory_name: 'Fixture Dorm', room_number: '101', contact_phone: '0800000000' }, provider_response: 'PRIVATE' }, storeName: 'Fixture Store' });
  for (const text of ['Home', '101', '0800000000', '/rider/orders/1', 'ดูรายละเอียด']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /PRIVATE|provider_response|payment/);
});

test('redesign responsive contracts provide sidebar, 1/2/3/4 KDS columns, safe sticky Rider action and compact timeline', () => {
  const css = read('frontend/app/globals.css');
  for (const pattern of [/grid-template-columns: 230px minmax\(0,1fr\)/, /max-width: 1400px/, /min-width: 1280px/, /repeat\(3,minmax\(0,1fr\)\)/, /repeat\(4,minmax\(0,1fr\)\)/, /bottom: calc\(70px \+ env\(safe-area-inset-bottom\)\)/, /status-timeline li \{ min-height: 47px/]) assert.match(css, pattern);
});

test('Customer receipt label translation requires matching menu ID, merchant and snapshot; totals are never sourced from catalog', () => {
  const item = { menu_item_id: 1, item_name: 'Local Basil Rice', choices: [{ menu_option_choice_id: 4, choice_name: 'Fried egg', extra_price: 10 }] };
  const menu = { id: 1, merchant_id: 1, name: 'Local Basil Rice', store_name: 'Local Kitchen', image_url: '/demo/basil-rice.svg', price: 999,
    option_groups: [{ name: 'Extras', choices: [{ id: 4, name: 'Fried egg', extra_price: 555 }] }] };
  for (const candidate of [menu, { ...menu, merchant_id: 2 }, { ...menu, name: 'Renamed food' }, null]) {
    const f = staffUiRuntime('frontend/components/customer/order-snapshot-choice.js', 'OrderSnapshotChoices', { item, merchantId: 1 }, { process: { env: { NODE_ENV: 'development' } } }, [candidate]);
    const html = renderToStaticMarkup(f.tree());
    assert.ok(html.includes(candidate === menu ? 'ไข่ดาว' : 'Fried egg'));
    assert.match(html, /10/); assert.doesNotMatch(html, /999|555/);
  }
});
