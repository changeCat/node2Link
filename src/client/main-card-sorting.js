// Return a reordered copy; publishing follows each editor section's save rules.
export function reorderCards(items, id, targetId, after) {
 const from = items.findIndex(item => item.id === id), target = items.findIndex(item => item.id === targetId);
 if (id === targetId || from < 0 || target < 0) return null;
 const next = items.filter(item => item.id !== id);
 next.splice(next.findIndex(item => item.id === targetId) + Number(after), 0, items[from]);
 return next.every((item, index) => item.id === items[index].id) ? null : next;
}

export function attachCardSorting(container, move) {
 let drag = null;
 const clearTarget = () => container.querySelectorAll('.sort-before,.sort-after').forEach(card => card.classList.remove('sort-before', 'sort-after'));
 async function finish(cancelled = false) {
  if (!drag) return;
  const current = drag; drag = null;
  clearTarget(); current.card.classList.remove('is-sorting');
  if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  if (!cancelled && current.targetId) await move(current.id, current.targetId, current.after);
 }
 container.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-sort-handle]');
  if (!handle || handle.disabled || event.button !== 0 || !event.isPrimary) return;
  const card = handle.closest('[data-display-id]');
  if (!card) return;
  event.preventDefault(); handle.focus();
  drag = { handle, card, id: card.dataset.displayId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  handle.setPointerCapture(event.pointerId);
 });
 container.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  event.preventDefault(); drag.card.classList.add('is-sorting');
  const bounds = container.getBoundingClientRect();
  if (event.clientY < bounds.top + 28) container.scrollTop -= 16;
  else if (event.clientY > bounds.bottom - 28) container.scrollTop += 16;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-display-id]');
  clearTarget(); drag.targetId = null;
  if (!target || target === drag.card || !container.contains(target)) return;
  const rect = target.getBoundingClientRect(), source = drag.card.getBoundingClientRect();
  const sameRow = Math.abs(source.top - rect.top) < Math.min(source.height, rect.height) / 2;
  drag.after = sameRow ? event.clientX >= rect.left + rect.width / 2 : event.clientY >= rect.top + rect.height / 2;
  drag.targetId = target.dataset.displayId;
  target.classList.add(drag.after ? 'sort-after' : 'sort-before');
 });
 container.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finish(); });
 container.addEventListener('pointercancel', () => finish(true));
 container.addEventListener('lostpointercapture', () => finish(true));
 container.addEventListener('keydown', async event => {
  if (event.key === 'Escape') { finish(true); return; }
  const handle = event.target.closest('[data-sort-handle]');
  const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
  if (!handle || handle.disabled || !delta) return;
  event.preventDefault();
  const cards = [...container.querySelectorAll('[data-display-id]')];
  const card = handle.closest('[data-display-id]'), target = cards[cards.indexOf(card) + delta];
  if (target && await move(card.dataset.displayId, target.dataset.displayId, delta > 0)) {
   const id = card.dataset.displayId;
   [...container.querySelectorAll('[data-display-id]')].find(item => item.dataset.displayId === id)?.querySelector('[data-sort-handle]').focus();
  }
 });
}
