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
	catch (cause) {
		if (cause instanceof StorageError) throw cause;
		throw new StorageError(undefined, { cause });
	}
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

export async function readJSONMap(kv, keys, fallback = {}, validate = () => true) {
	if (typeof kv.getMany !== 'function') {
		return new Map(await Promise.all(keys.map(async key => [key, await readJSON(kv, key, fallback, validate)])));
	}
	let values;
	try { values = await kv.getMany(keys); }
	catch (cause) { if (cause instanceof StorageError) throw cause; throw new StorageError(undefined, { cause }); }
	const result = new Map();
	for (const key of keys) {
		const value = values.get(key);
		if (value === null || value === undefined) { result.set(key, structuredClone(fallback)); continue; }
		try { const parsed = JSON.parse(value); if (!validate(parsed)) throw new Error('Invalid record'); result.set(key, parsed); }
		catch (cause) { throw new StorageError('存储数据格式异常，已停止操作以保护原数据', { cause }); }
	}
	return result;
}

export async function writeJSON(kv, key, value, metadata) {
	const serialized = JSON.stringify(value);
	for (let attempt = 0; ; attempt++) {
		try { await kv.put(key, serialized, metadata ? { metadata } : undefined); return; }
		catch (cause) {
			// Fixed current keys are subject to KV's one-write-per-second limit.
			// Retry only explicit throttling, with a bounded backoff; persistent
			// quota exhaustion still surfaces as a storage failure.
			if (attempt >= 2 || !(cause?.status === 429 || /\b429\b/.test(String(cause?.message)))) {
				throw new StorageError(undefined, { cause });
			}
			await new Promise(resolve => setTimeout(resolve, 1100 * (attempt + 1)));
		}
	}
}

export async function writeJSONBatch(kv, records) {
	const serialized = records.map(record => ({
		key: record.key, value: JSON.stringify(record.value),
		options: record.metadata === undefined ? undefined : { metadata: record.metadata }
	}));
	if (typeof kv.putMany === 'function') {
		try { return await kv.putMany(serialized); }
		catch (cause) { if (cause instanceof StorageError) throw cause; throw new StorageError(undefined, { cause }); }
	}
	for (const record of records) await writeJSON(kv, record.key, record.value, record.metadata);
}

export async function listRecords(kv, prefix, validate = isObject) {
	if (typeof kv.listWithValues !== 'function') {
		const keys = await listKeys(kv, prefix);
		return mapConcurrent(keys, 6, async key => ({ ...key, value: await readRequiredJSON(kv, key.name, validate) }));
	}
	const records = [];
	let cursor;
	const seen = new Set();
	try {
		do {
			const page = await kv.listWithValues({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
			for (const record of page.records) {
				let value;
				try { value = JSON.parse(record.value); if (!validate(value)) throw new Error('Invalid record'); }
				catch (cause) { throw new StorageError('存储数据格式异常，已停止操作以保护原数据', { cause }); }
				records.push({ name: record.name, metadata: record.metadata, value });
			}
			if (page.list_complete) break;
			if (!page.cursor || seen.has(page.cursor)) throw new Error('Invalid D1 cursor');
			cursor = page.cursor;
			seen.add(cursor);
		} while (true);
	} catch (cause) { if (cause instanceof StorageError) throw cause; throw new StorageError(undefined, { cause }); }
	return records.sort((a, b) => a.name.localeCompare(b.name));
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
