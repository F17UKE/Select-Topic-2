// Synthetic native-dialog boundary tests; no browser/DB/provider mutation.
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { openReviewDialog } = await import('../frontend/lib/review-dialog.mjs');
  const values = new Map([['overflow', ['auto', 'important']], ['padding-right', ['3px', '']]]);
  const style = {
    getPropertyValue: (key) => values.get(key)?.[0] || '',
    getPropertyPriority: (key) => values.get(key)?.[1] || '',
    setProperty: (key, value, priority = '') => values.set(key, [value, priority]),
    removeProperty: (key) => values.delete(key),
  };
  const original = JSON.stringify([...values]);
  const doc = { body: { style }, documentElement: { clientWidth: 390 } };
  let focus = 'trigger';
  let restored;
  let restores = 0;
  const browser = { scrollX: 0, scrollY: 321, innerWidth: 405, getComputedStyle: () => ({ paddingRight: '3px' }), scrollTo: (value) => { restored = value; restores++; } };
  const dialog = new EventTarget();
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  dialog.getBoundingClientRect = () => ({ left: 10, right: 380, top: 200, bottom: 700 });
  dialog.querySelector = () => ({ focus: () => { focus = 'close'; } });
  const trigger = { isConnected: true, focus: (options) => { assert.equal(options.preventScroll, true); focus = 'trigger'; } };
  const start = () => openReviewDialog(dialog, trigger, browser, doc);
  return { dialog, doc, values, original, trigger, start, focus: () => focus, restored: () => restored, restores: () => restores };
}
function pointer(dialog, type, x, y) { dialog.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y })); }

test('open focuses close control, fixes body at current scroll and compensates scrollbar', async () => {
  const f = await fixture();
  const dispose = f.start();
  assert.equal(f.dialog.open, true);
  assert.equal(f.focus(), 'close');
  assert.equal(f.doc.body.style.getPropertyValue('position'), 'fixed');
  assert.equal(f.doc.body.style.getPropertyValue('top'), '-321px');
  assert.equal(f.doc.body.style.getPropertyValue('overflow'), 'hidden');
  assert.equal(f.doc.body.style.getPropertyValue('padding-right'), '18px');
  dispose();
});

test('X/native close restores original styles, scroll and rating-trigger focus', async () => {
  const f = await fixture();
  f.start(); f.dialog.close();
  assert.equal(f.focus(), 'trigger');
  assert.equal(JSON.stringify([...f.values]), f.original);
  assert.deepEqual(f.restored(), { left: 0, top: 321, behavior: 'instant' });
});

test('Escape native cancel closes once and restores scroll lock', async () => {
  const f = await fixture();
  f.start();
  const event = new Event('cancel', { cancelable: true });
  f.dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.restores(), 1);
  assert.equal(f.focus(), 'trigger');
});

test('backdrop closes; inside padding and a drag beginning inside do not dismiss', async () => {
  const f = await fixture();
  f.start();
  pointer(f.dialog, 'pointerdown', 30, 250); pointer(f.dialog, 'click', 30, 250);
  assert.equal(f.dialog.open, true);
  pointer(f.dialog, 'pointerdown', 30, 250); pointer(f.dialog, 'click', 1, 100);
  assert.equal(f.dialog.open, true);
  pointer(f.dialog, 'pointerdown', 1, 100); pointer(f.dialog, 'click', 1, 100);
  assert.equal(f.dialog.open, false);
  assert.equal(f.focus(), 'trigger');
});

test('unmount cleanup is idempotent, detaches handlers and does not focus detached trigger', async () => {
  const f = await fixture();
  const dispose = f.start();
  f.trigger.isConnected = false;
  dispose(); dispose();
  assert.equal(f.dialog.open, false);
  assert.equal(f.restores(), 1);
  assert.equal(f.focus(), 'close');
  f.dialog.dispatchEvent(new Event('cancel'));
  assert.equal(f.restores(), 1);
  assert.equal(JSON.stringify([...f.values]), f.original);
});

test('reopen creates fresh lock and restores focus after each close', async () => {
  const f = await fixture();
  f.start(); f.dialog.close();
  f.start(); assert.equal(f.focus(), 'close'); f.dialog.close();
  assert.equal(f.restores(), 2);
  assert.equal(f.focus(), 'trigger');
  assert.equal(JSON.stringify([...f.values]), f.original);
});
