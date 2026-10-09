// Native dialog owns modal focus containment/inert background. This adds mobile-safe
// scroll locking, light dismissal and cleanup without changing review data or fetching.
export function openReviewDialog(dialog, trigger, browser = window, doc = document) {
  if (dialog.open) return () => {};
  const x = browser.scrollX;
  const y = browser.scrollY;
  const body = doc.body;
  const properties = ['position', 'top', 'left', 'width', 'overflow', 'padding-right'];
  const previous = properties.map((key) => [key, body.style.getPropertyValue(key), body.style.getPropertyPriority(key)]);
  const scrollbar = Math.max(0, browser.innerWidth - doc.documentElement.clientWidth);
  const padding = parseFloat(browser.getComputedStyle(body).paddingRight) || 0;
  dialog.showModal();
  body.style.setProperty('position', 'fixed');
  body.style.setProperty('top', `${-y}px`);
  body.style.setProperty('left', `${-x}px`);
  body.style.setProperty('width', '100%');
  body.style.setProperty('overflow', 'hidden');
  if (scrollbar) body.style.setProperty('padding-right', `${padding + scrollbar}px`);
  let finished = false;
  let backdropDown = false;
  function outside(event) {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  }
  function down(event) { backdropDown = outside(event); }
  function click(event) { if (backdropDown && outside(event)) finish(); backdropDown = false; }
  function cancel(event) { event.preventDefault(); finish(); }
  function finish() {
    if (finished) return;
    finished = true;
    dialog.removeEventListener('close', finish);
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('pointerdown', down);
    dialog.removeEventListener('click', click);
    if (dialog.open) dialog.close();
    previous.forEach(([key, value, priority]) => {
      if (value) body.style.setProperty(key, value, priority);
      else body.style.removeProperty(key);
    });
    browser.scrollTo({ left: x, top: y, behavior: 'instant' });
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  dialog.addEventListener('close', finish);
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('click', click);
  dialog.querySelector('[data-review-close]')?.focus({ preventScroll: true });
  return finish;
}
