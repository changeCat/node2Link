// Optional, short-lived administrative views only. Authoritative reads bypass
// this cache. Weak keys let the runtime reclaim bindings after an isolate dies.
const bindings = new WeakMap();
const TTL_MS = 2000;
export const MAX_CACHED_KEYS = 20000;

function slot(kv, name) {
	let slots = bindings.get(kv);
	if (!slots) bindings.set(kv, slots = new Map());
	if (!slots.has(name)) slots.set(name, { generation: 0 });
	return slots.get(name);
}

export function invalidateView(kv, name) {
	if (!kv) return;
	const entry = slot(kv, name);
	entry.generation++;
	delete entry.value;
	delete entry.pending;
}

export async function cachedView(kv, name, loader, { fresh = true, cacheable = () => true } = {}) {
	if (!kv || fresh) return loader();
	const entry = slot(kv, name);
	if (entry.expires > Date.now() && Object.hasOwn(entry, 'value')) return entry.value;
	if (entry.pending) return entry.pending;
	const generation = entry.generation;
	const pending = Promise.resolve().then(loader).then(value => {
		if (entry.generation === generation && cacheable(value)) {
			entry.value = value;
			entry.expires = Date.now() + TTL_MS;
		}
		return value;
	}).finally(() => { if (entry.pending === pending) delete entry.pending; });
	entry.pending = pending;
	return pending;
}
