export const BANNER_DELAY = 5000;

export function closestBanner(track) {
  const left = track.getBoundingClientRect().left;
  let closest = 0;
  let distance = Infinity;
  Array.from(track.children).forEach((slide, index) => {
    const nextDistance = Math.abs(slide.getBoundingClientRect().left - left);
    if (nextDistance < distance) { distance = nextDistance; closest = index; }
  });
  return closest;
}

// One restartable timer; all event subscriptions and pending work are released on unmount.
export function startBannerAutoplay({ root, track, advance, browser = window, doc = document }) {
  if (track.children.length < 2) return () => {};
  const motion = browser.matchMedia('(prefers-reduced-motion: reduce)');
  let timer;
  let stopped = false;
  let dragging = false;
  const listeners = [];
  function reset() {
    browser.clearTimeout(timer);
    if (stopped || dragging || doc.hidden || motion.matches) return;
    timer = browser.setTimeout(() => { advance(); reset(); }, BANNER_DELAY);
  }
  function listen(target, name, handler) {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  }
  listen(root, 'pointerdown', () => { dragging = true; reset(); });
  listen(doc, 'pointerup', () => { if (dragging) { dragging = false; reset(); } });
  listen(doc, 'pointercancel', () => { if (dragging) { dragging = false; reset(); } });
  // Hover or a retained dot/link focus must not suspend autoplay indefinitely.
  // Interactions restart the delay without moving keyboard focus.
  listen(root, 'focusin', reset);
  listen(root, 'keydown', reset);
  listen(root, 'click', reset);
  listen(track, 'scroll', reset);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) dragging = false; reset(); });
  listen(motion, 'change', reset);
  reset();
  return () => {
    stopped = true;
    browser.clearTimeout(timer);
    listeners.forEach((remove) => remove());
  };
}
