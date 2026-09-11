// Optional, short-lived views. Credentials, identity, subscription content and
// revocation reads bypass this cache. Bindings are isolated and weakly held.
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
	const entry = slot(kv, name);
	entry.generation++;
	delete entry.value;
	delete entry.pending;
}

export async function cachedView(kv, name, loader, { fresh = true, cacheable = () => true, ttlMs = TTL_MS } = {}) {
	if (fresh) return loader();
	const entry = slot(kv, name);
	if (entry.expires > Date.now() && Object.hasOwn(entry, 'value')) return entry.value;
	if (entry.pending) return entry.pending;
	const generation = entry.generation;
	const pending = Promise.resolve().then(loader).then(value => {
		if (entry.generation === generation && cacheable(value)) {
			entry.value = value;
			entry.expires = Date.now() + ttlMs;
		}
		return value;
	}).finally(() => { if (entry.pending === pending) delete entry.pending; });
	entry.pending = pending;
	return pending;
}
