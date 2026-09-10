import { DEFAULT_MAIN_DATA } from '../config.js';
import { readText, readJSON, readRequiredJSON, writeJSON, isObject, revisionKey, StorageError } from './kv.js';

const PREFIX = 'NODE2LINK.v2.main.';

async function latestSnapshots(kv, count = 2) {
	const keys = [];
	let cursor;
	const seen = new Set();
	try {
		do {
			const page = await kv.list({ prefix: PREFIX, limit: count - keys.length, ...(cursor ? { cursor } : {}) });
			keys.push(...page.keys);
			if (keys.length >= count || page.list_complete) break;
			if (!page.cursor || seen.has(page.cursor)) throw new Error('Invalid cursor');
			cursor = page.cursor;
			seen.add(cursor);
		} while (true);
	} catch (cause) { throw new StorageError(undefined, { cause }); }
	return Promise.all(keys.slice(0, count).map(key => readRequiredJSON(kv, key.name, value => isObject(value) && typeof value.content === 'string' && isObject(value.metadata))));
}

async function legacyText(kv, key) {
	return await readText(kv, key) ?? await readText(kv, '/' + key);
}

export async function readMainRecord(kv) {
	const [current] = await latestSnapshots(kv, 1);
	if (current) return current;
	const [content, metadata] = await Promise.all([legacyText(kv, 'LINK.txt'), readJSON(kv, 'LINK.txt.meta.json', null, isObject)]);
	return { content: content ?? '', metadata };
}

export async function readMainBackup(kv) {
	const snapshots = await latestSnapshots(kv);
	if (snapshots[1]) return snapshots[1];
	const content = await legacyText(kv, snapshots.length ? 'LINK.txt' : 'LINK.backup.txt');
	if (content === null || content === undefined) return null;
	const metaKey = snapshots.length ? 'LINK.txt.meta.json' : 'LINK.backup.meta.json';
	return { content, metadata: await readJSON(kv, metaKey, null, isObject) };
}

export async function saveMainRecord(kv, content) {
	await readMainRecord(kv);
	const metadata = { savedAt: new Date().toISOString(), bytes: new TextEncoder().encode(content).length, lines: content ? content.split(/\r?\n/).length : 0 };
	if (metadata.bytes > 20 * 1024 * 1024) throw new Error('主订阅内容不能超过 20 MB');
	const revision = revisionKey('').split('.');
	const reverse = String(9999999999999 - Number(revision[0])).padStart(13, '0');
	await writeJSON(kv, PREFIX + reverse + '.' + revision.slice(1).join('.'), { schemaVersion: 2, content, metadata }, metadata);
	return metadata;
}

export async function readKVValueWithLegacyFallback(kv, key) {
	if (key === 'LINK.txt') return (await readMainRecord(kv)).content;
	return legacyText(kv, key);
}

export async function readMainSubscriptionData(env) {
	if (!env.KV) return env.LINK || DEFAULT_MAIN_DATA;
	return (await readMainRecord(env.KV)).content || DEFAULT_MAIN_DATA;
}
