const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

function load(file, dependencies = {}) {
  const filename = path.join(__dirname, '..', file);
  const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => dependencies[id] || require(id) });
  return module.exports;
}
const hooks = { ...React, useEffect: () => {}, useRef: (v) => ({ current: v }), useId: () => 'qa-dialog', useState: (v) => [v, () => {}] };
const ui = load('frontend/components/admin-ui.js', { react: hooks, '../lib/review-dialog.mjs': { openReviewDialog: () => {} } });
function shell(role, pathname = '/admin') {
  const session = { loading: false, admin: { role, full_name: 'Demo Admin' } };
  const components = load('frontend/components/admin-shell.js', { react: hooks, './admin-ui': ui,
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({ replace() {} }) },
    '../lib/use-admin': { useAdmin: () => session } });
  return renderToStaticMarkup(components.AdminShell({ title: 'Test', children: 'Content' }));
}

test('Admin navigation retains role visibility and never adds a customer bottom nav', () => {
  const support = shell('SUPPORT');
  assert.match(support, /href="\/admin\/merchants"/);
  assert.match(support, /href="\/admin\/orders"/);
  assert.doesNotMatch(support, /href="\/admin\/(users|settings|reports|banners)"/);
  const finance = shell('FINANCE');
  assert.match(finance, /href="\/admin\/reports"/);
  assert.doesNotMatch(finance, /href="\/admin\/(merchants|customers|users|settings)"/);
  const root = shell('SUPER_ADMIN');
  assert.match(root, /href="\/admin\/settings\/integrations"/);
  assert.doesNotMatch(root, /bottom-nav|customer-nav/);
});
test('nested settings route has exactly one active link and accessible navigation controls', () => {
  const html = shell('SUPER_ADMIN', '/admin/settings/integrations');
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /ข้ามไปเนื้อหา/);
  assert.match(html, /aria-label="เปิดเมนูผู้ดูแลระบบ"/);
  assert.match(html, /aria-label="เส้นทางหน้า"/);
});
test('responsive table retains header associations, money alignment and row identity', () => {
  const html = renderToStaticMarkup(React.createElement(ui.AdminDataTable, { columns: [{ key: 'code', label: 'ออเดอร์' }, { key: 'total', label: 'ยอด', type: 'money' }], items: [{ id: 7, code: 'DEMO-7', total: '120.00' }], render: (row, c) => row[c.key] }));
  assert.match(html, /scope="col"/); assert.match(html, /data-label="ยอด" class="numeric"/); assert.match(html, /DEMO-7/);
});
test('table has distinct loading and actionable empty states without fabricated records', () => {
  const props = { columns: [], items: [], render: () => '' };
  const loading = renderToStaticMarkup(React.createElement(ui.AdminDataTable, { ...props, loading: true }));
  assert.match(loading, /role="status"/); assert.doesNotMatch(loading, /<table/);
  const empty = renderToStaticMarkup(React.createElement(ui.AdminDataTable, props));
  assert.match(empty, /ลองเปลี่ยนคำค้นหา/); assert.doesNotMatch(empty, /<tr/);
});
test('flat order/payment details preserve every API field once and never fabricate times', async () => {
  const { adminDetailSections } = await import('../frontend/lib/admin-presentation.mjs');
  const data = { id: 1, order_code: 'DEMO', status: 'PAID', total_amount: '100.00', delivery_room_number: 'A', created_at: '2026-01-01', completed_at: null, items: [{ item_name: 'Snapshot meal' }], transaction_reference: '****1234' };
  const before = JSON.stringify(data);
  const result = adminDetailSections(data);
  const recovered = {};
  for (const { key, value } of result) {
    if (['overview', 'amounts', 'delivery', 'timestamps', 'technical'].includes(key)) Object.assign(recovered, value);
    else recovered[key] = value;
  }
  assert.deepEqual(recovered, data); assert.equal(JSON.stringify(data), before);
  assert.equal(result.find((s) => s.key === 'timestamps').value.completed_at, null);
  assert.equal(result.find((s) => s.key === 'items').value[0].item_name, 'Snapshot meal');
});
test('merchant grouping keeps all collections and masked recipient fields supplied by API', async () => {
  const { adminDetailSections } = await import('../frontend/lib/admin-presentation.mjs');
  const data = { ok: true, merchant: { id: 1, promptpay_id: '******1111', staff: [{ id: 1, role: 'RIDER' }, { id: 2, role: 'MANAGER' }], gallery: [], delivery_fees: [{ fee: '15.00' }], summary: {} } };
  const sections = Object.fromEntries(adminDetailSections(data, 'merchant').map((s) => [s.key, s.value]));
  assert.equal(sections.overview.promptpay_id, '******1111');
  assert.deepEqual(sections.riders, [data.merchant.staff[0]]);
  assert.deepEqual(sections.staff, [data.merchant.staff[1]]);
  assert.deepEqual(sections.gallery, []); assert.deepEqual(sections.summary, {});
  assert.deepEqual(sections.delivery_fees, data.merchant.delivery_fees); assert.equal(sections.delivery, undefined);
  assert.equal(sections.technical.id, 1); assert.equal(sections.ok, undefined);
});
test('actual order/payment response envelopes become sections instead of one nested API object', async () => {
  const { adminDetailSections } = await import('../frontend/lib/admin-presentation.mjs');
  for (const key of ['order', 'payment']) {
    const result = adminDetailSections({ ok: true, [key]: { order_code: 'LOC-1', total_amount: '50.00', created_at: null, items: [] } });
    assert.equal(result.find((s) => s.key === 'overview').value.order_code, 'LOC-1');
    assert.equal(result.find((s) => s.key === 'amounts').value.total_amount, '50.00');
    assert.ok(!result.some((s) => s.key === 'ok' || s.key === key));
  }
});
test('translated filter labels do not alter API enum values', async () => {
  const { adminStatusLabel } = await import('../frontend/lib/admin-presentation.mjs');
  assert.equal(adminStatusLabel('PUBLISHED'), 'เผยแพร่'); assert.equal(adminStatusLabel('future_status'), 'future_status');
  const content = fs.readFileSync(path.join(__dirname, '../frontend/components/admin-content-manager.js'), 'utf8');
  assert.match(content, /value=\{value\}>\{adminStatusLabel\(value\)\}/);
});
test('Admin editor confirms sensitive role/status edits before mutation and uses existing native dialog helper', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../frontend/components/admin-editor.js'), 'utf8');
  assert.ok(editor.indexOf('setConfirming(true); return;') < editor.indexOf('await session.mutate'));
  assert.match(editor, /values\.role !== initial\.role/);
  assert.match(editor, /values\.isActive !== initial\.isActive/);
  assert.doesNotMatch(editor, /window\.confirm/);
  const shared = fs.readFileSync(path.join(__dirname, '../frontend/components/admin-ui.js'), 'utf8');
  assert.match(shared, /openReviewDialog\(dialog, document\.activeElement\)/);
  assert.match(shared, /aria-labelledby=\{id\}/);
});
