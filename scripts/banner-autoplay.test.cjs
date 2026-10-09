const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(reduced = false, slideCount = 3) {
  const { startBannerAutoplay, closestBanner } = await import('../frontend/lib/banner-autoplay.mjs');
  let now = 0;
  let id = 0;
  let calls = 0;
  let active = 0;
  const timers = new Map();
  const root = new EventTarget();
  const track = new EventTarget();
  track.getBoundingClientRect = () => ({ left: 16 });
  track.children = Array.from({ length: slideCount }, (_, index) => ({
    getBoundingClientRect: () => ({ left: 16 + (index - active) * 370 }),
  }));
  const doc = new EventTarget();
  const motion = new EventTarget();
  root.contains = (target) => target === root;
  doc.hidden = false;
  motion.matches = reduced;
  const browser = {
    matchMedia: () => motion,
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout: (key) => timers.delete(key),
  };
  const stop = startBannerAutoplay({ root, track, doc, browser, advance: () => {
    calls++;
    active = (closestBanner(track) + 1) % slideCount;
    emit(track, 'scroll');
  } });
  return { root, track, doc, motion, stop, calls: () => calls, active: () => active,
    select(index) { active = index; emit(track, 'scroll'); }, pending: () => timers.size,
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
  };
}
function emit(target, type, values = {}) { target.dispatchEvent(Object.assign(new Event(type), values)); }

test('autoplay advances each five seconds and cleanup removes timer and listeners', async () => {
  const f = await fixture();
  f.tick(4999); assert.equal(f.calls(), 0);
  f.tick(1); assert.equal(f.calls(), 1);
  f.tick(10000); assert.equal(f.calls(), 3);
  f.stop(); assert.equal(f.pending(), 0);
  emit(f.track, 'scroll'); f.tick(10000); assert.equal(f.calls(), 3);
});

test('swipe resets timer; drag pauses; retained focus resumes after five seconds without moving focus', async () => {
  const f = await fixture();
  f.tick(4000); emit(f.track, 'scroll'); f.tick(4000); assert.equal(f.calls(), 0);
  emit(f.root, 'pointerdown'); f.tick(10000); assert.equal(f.calls(), 0);
  emit(f.doc, 'pointerup'); f.tick(5000); assert.equal(f.calls(), 1);
  f.doc.activeElement = f.root;
  emit(f.root, 'focusin'); f.tick(4999); assert.equal(f.calls(), 1);
  f.tick(1); assert.equal(f.calls(), 2);
  assert.equal(f.doc.activeElement, f.root);
  f.stop();
});

test('reduced motion and hidden document disable autoplay including live preference changes', async () => {
  const f = await fixture(true);
  f.tick(15000); assert.equal(f.calls(), 0);
  f.motion.matches = false; emit(f.motion, 'change'); f.tick(5000); assert.equal(f.calls(), 1);
  f.doc.hidden = true; emit(f.doc, 'visibilitychange'); f.tick(10000); assert.equal(f.calls(), 1);
  f.doc.hidden = false; emit(f.doc, 'visibilitychange'); f.tick(5000); assert.equal(f.calls(), 2);
  f.motion.matches = true; emit(f.motion, 'change'); assert.equal(f.pending(), 0);
  f.stop();
});

test('stationary desktop mouse does not block autoplay', async () => {
  const f = await fixture();
  emit(f.root, 'pointerenter', { pointerType: 'mouse' }); f.tick(10000); assert.equal(f.calls(), 2);
  emit(f.root, 'pointerleave'); f.tick(5000); assert.equal(f.calls(), 3); f.stop();
});

test('zero/one slide starts no timer; two or more slides autoplay', async () => {
  for (const count of [0, 1, 2, 3]) {
    const f = await fixture(false, count);
    assert.equal(f.pending(), count > 1 ? 1 : 0);
    f.tick(5000); assert.equal(f.calls(), count > 1 ? 1 : 0); f.stop();
  }
});

test('manual dot selection resets timer; cancelled drag resumes and hidden drag cannot poison timer', async () => {
  const f = await fixture();
  f.tick(4500); emit(f.root, 'click'); f.tick(4999); assert.equal(f.calls(), 0);
  f.tick(1); assert.equal(f.calls(), 1);
  emit(f.root, 'pointerdown'); emit(f.doc, 'pointercancel'); f.tick(5000); assert.equal(f.calls(), 2);
  emit(f.root, 'pointerdown'); f.doc.hidden = true; emit(f.doc, 'visibilitychange');
  f.tick(10000); assert.equal(f.calls(), 2);
  f.doc.hidden = false; emit(f.doc, 'visibilitychange'); f.tick(5000); assert.equal(f.calls(), 3);
  f.stop();
});

test('nearest slide tracks manual swipe and next index wraps from last to first', async () => {
  const { closestBanner } = await import('../frontend/lib/banner-autoplay.mjs');
  for (let index = 0; index < 3; index++) {
    const track = { getBoundingClientRect: () => ({ left: 16 }), children: [0, 1, 2].map((i) => ({ getBoundingClientRect: () => ({ left: 16 + (i - index) * 370 }) })) };
    assert.equal(closestBanner(track), index);
    assert.equal((closestBanner(track) + 1) % 3, index === 2 ? 0 : index + 1);
  }
});

test('idle timeline is 1 → 2 → 3 → 1 at 0/5/10/15 seconds and manual selection continues from its slide', async () => {
  const f = await fixture();
  const timeline = [f.active() + 1];
  for (let step = 0; step < 3; step++) { f.tick(5000); timeline.push(f.active() + 1); }
  assert.deepEqual(timeline, [1, 2, 3, 1]);
  f.tick(3000); f.select(1); f.tick(4999); assert.equal(f.active(), 1);
  f.tick(1); assert.equal(f.active(), 2);
  f.stop();
});
