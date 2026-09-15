// Presentation preferences are separate from the subscription configuration and drafts.
export function createDisplayOrder(storageKey) {
 let saved = {};
 try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { /* Use insertion order. */ }
 const orders = Object.fromEntries(['originals', 'endpoints'].map(key => [key, Array.isArray(saved[key]) ? saved[key].filter(id => typeof id === 'string') : []]));
 function ordered(items, key) {
  const positions = new Map(orders[key].map((id, index) => [id, index]));
  return [...items].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
 }
 function move(items, key, id, targetId, after) {
  const ids = ordered(items, key).map(item => item.id);
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return false;
  const next = ids.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + Number(after), 0, id);
  if (next.every((value, index) => value === ids[index])) return false;
  orders[key] = next;
  try { localStorage.setItem(storageKey, JSON.stringify(orders)); } catch { /* Sorting still works for this page. */ }
  return true;
 }
 function preview(nodes, config) {
  const originals = new Map(ordered(config.originals, 'originals').map((item, index) => [item.id, index]));
  const endpoints = new Map(ordered(config.endpoints, 'endpoints').map((item, index) => [item.id, index]));
  const childRank = node => node.kind === 'original' ? -1 : (endpoints.get(node.endpointId) ?? Infinity);
  return [...nodes].sort((a, b) => (originals.get(a.originalId) ?? Infinity) - (originals.get(b.originalId) ?? Infinity) || childRank(a) - childRank(b));
 }
 return { ordered, move, preview };
}

export function attachCardSorting(container, move, onChange) {
 let drag = null;
 const clearTarget = () => container.querySelectorAll('.sort-before,.sort-after').forEach(card => card.classList.remove('sort-before', 'sort-after'));
 function finish(cancelled = false) {
  if (!drag) return;
  const current = drag; drag = null;
  clearTarget(); current.card.classList.remove('is-sorting');
  if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  if (!cancelled && current.targetId && move(current.id, current.targetId, current.after)) onChange();
 }
 container.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-sort-handle]');
  if (!handle || event.button !== 0 || !event.isPrimary) return;
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
 container.addEventListener('keydown', event => {
  if (event.key === 'Escape') { finish(true); return; }
  const handle = event.target.closest('[data-sort-handle]');
  const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
  if (!handle || !delta) return;
  event.preventDefault();
  const cards = [...container.querySelectorAll('[data-display-id]')];
  const card = handle.closest('[data-display-id]'), target = cards[cards.indexOf(card) + delta];
  if (target && move(card.dataset.displayId, target.dataset.displayId, delta > 0)) {
   const id = card.dataset.displayId; onChange();
   [...container.querySelectorAll('[data-display-id]')].find(item => item.dataset.displayId === id)?.querySelector('[data-sort-handle]').focus();
  }
 });
}
