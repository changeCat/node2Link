import { appendRecord, listKeys, mapConcurrent, readJSON, readRequiredJSON, writeJSON, StorageError, isObject } from './kv.js';
import { normalizeStoredNode } from '../domain/generated-nodes.js';

const LEGACY_KEY = 'NODE2LINK.api-subscription.nodes.json';
const PREFIX = 'NODE2LINK.v2.nodes.';
const CACHE_KEY = 'NODE2LINK.cache.nodes.v2';

export async function readNodeRecords(kv, normalize, { deduplicate = true } = {}) {
	if (!kv) return [];
	const [legacy, keys, cached] = await Promise.all([
		readJSON(kv, LEGACY_KEY, [], Array.isArray), listKeys(kv, PREFIX),
		// Only this derived cache may be discarded on failure. The authoritative
		// legacy value and immutable records must always be read successfully.
		readJSON(kv, CACHE_KEY, null, value => isObject(value) && value.schemaVersion === 2 && Array.isArray(value.applied) && Array.isArray(value.entries) && value.entries.every(entry => typeof entry.revision === 'string' && normalize(entry.node)) && Array.isArray(value.deleted)).catch(() => null)
	]);
	const applied = new Set(cached?.applied || []);
	const pending = keys.filter(key => !applied.has(key.name));
	const records = await mapConcurrent(pending, 6, key => readRequiredJSON(kv, key.name, record => record?.schemaVersion === 2 && (Array.isArray(record.nodes) || Array.isArray(record.deletedIds))));
	const deleted = new Set([...(cached?.deleted || []), ...records.flatMap(record => record.deletedIds || [])]);
	const entries = [
		...(cached?.entries || []),
		...records.flatMap((record, index) => (record.nodes || []).map((node, position) => ({ node, revision: pending[index].name, position })))
	]
		.filter(entry => !deleted.has(entry.node.id))
		.sort((a, b) => a.revision.localeCompare(b.revision) || a.position - b.position);
	const nodes = [...legacy, ...entries.map(entry => entry.node)];
	const contents = new Set();
	const result = nodes.map(node => {
		const normalized = normalize(node);
		if (!normalized) throw new StorageError('节点存储数据格式异常，已停止操作以保护原数据');
		return normalized;
	}).filter(node => {
		if (deleted.has(node.id) || (deduplicate && contents.has(node.content))) return false;
		contents.add(node.content);
		return true;
	});
	if (pending.length >= 16) {
		// A stale/concurrent cache replacement cannot lose mutations: every read
		// replays all journal keys absent from that snapshot's explicit applied set.
		try { await writeJSON(kv, CACHE_KEY, { schemaVersion: 2, applied: [...applied, ...pending.map(key => key.name)], entries, deleted: [...deleted] }); }
		catch { /* Derived cache publication never changes mutation success. */ }
	}
	return result;
}

export async function appendNodeBatch(kv, nodes) {
	if (nodes.length) await appendRecord(kv, PREFIX, { schemaVersion: 2, nodes });
}

export async function deleteNodeRecord(kv, id) {
	const nodes = await readNodeRecords(kv, normalizeStoredNode, { deduplicate: false });
	const target = nodes.find(node => node.id === id);
	const deletedIds = target ? nodes.filter(node => node.content === target.content).map(node => node.id) : [id];
	await appendRecord(kv, PREFIX, { schemaVersion: 2, deletedIds });
}
