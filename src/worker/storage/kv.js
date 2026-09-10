// KV is eventually consistent. Never turn a failed read into an empty record.
export class StorageError extends Error {
	constructor(message = '存储暂时不可用，请稍后重试', options) {
		super(message, options);
		this.name = 'StorageError';
		this.status = 503;
	}
}

export async function readText(kv, key) {
	try { return await kv.get(key); }
	catch (cause) { throw new StorageError(undefined, { cause }); }
}

export async function readJSON(kv, key, fallback, validate = () => true) {
	const value = await readText(kv, key);
	if (value === null || value === undefined) return fallback;
	try {
		const parsed = JSON.parse(value);
		if (!validate(parsed)) throw new Error('Invalid record');
		return parsed;
	} catch (cause) { throw new StorageError('存储数据格式异常，已停止操作以保护原数据', { cause }); }
}

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function writeJSON(kv, key, value, metadata) {
	try { await kv.put(key, JSON.stringify(value), metadata ? { metadata } : undefined); }
	catch (cause) { throw new StorageError(undefined, { cause }); }
}

export async function listKeys(kv, prefix) {
	const keys = [];
	let cursor;
	const seen = new Set();
	try {
		do {
			const page = await kv.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
			keys.push(...page.keys);
			if (page.list_complete) break;
			if (!page.cursor || seen.has(page.cursor)) throw new Error('Invalid KV cursor');
			cursor = page.cursor;
			seen.add(cursor);
		} while (true);
	} catch (cause) { throw new StorageError(undefined, { cause }); }
	return keys.sort((a, b) => a.name.localeCompare(b.name));
}

// A mutation is published in one unique key: unrelated writers cannot overwrite it.
// Ordering is deterministic; it is not a distributed transaction or a global lock.
let lastRevision = 0;
export function revisionKey(prefix) {
	lastRevision = Math.max(Date.now(), lastRevision + 1);
	return prefix + String(lastRevision).padStart(13, '0') + '.' + crypto.randomUUID();
}

export async function appendRecord(kv, prefix, value, metadata) {
	const key = revisionKey(prefix);
	await writeJSON(kv, key, value, metadata);
	return key;
}

export async function readRequiredJSON(kv, key, validate = isObject) {
	const value = await readJSON(kv, key, null, validate);
	// A listed key whose value isn't visible yet must not silently disappear.
	if (value === null) throw new StorageError();
	return value;
}

export async function mapConcurrent(items, concurrency, mapper) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await mapper(items[index], index);
		}
	}));
	return results;
}
