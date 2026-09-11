import { appendRecord, listRecords, readJSON, writeJSON, StorageError, isObject } from './kv.js';
import { normalizeStoredNode } from '../domain/generated-nodes.js';
import { cachedView, invalidateView, MAX_CACHED_KEYS } from './view-cache.js';

const PREFIX = 'NODE2LINK.v3.nodes.';
const CACHE_KEY = 'NODE2LINK.cache.nodes.v3';

export async function readNodeRecords(kv, normalize, { deduplicate = true, fresh = true } = {}) {
	if (!kv) return [];
	const [listed, cached] = await Promise.all([
		cachedView(kv, PREFIX, () => listRecords(kv, PREFIX, record => record?.schemaVersion === 2 && (Array.isArray(record.nodes) || Array.isArray(record.deletedIds))), { fresh, ttlMs: 15_000, cacheable: records => records.length <= MAX_CACHED_KEYS }),
		// D1 stores current nodes and applies deletions transactionally, so a KV
		// journal snapshot would be both redundant and capable of resurrecting a
		// deleted row. Raw-KV fallback retains the replay-safe derived snapshot.
		kv.isD1 ? null : readJSON(kv, CACHE_KEY, null, value => isObject(value) && value.schemaVersion === 2 && Array.isArray(value.applied) && Array.isArray(value.entries) && value.entries.every(entry => typeof entry.revision === 'string' && normalize(entry.node)) && Array.isArray(value.deleted)).catch(() => null)
	]);
	const applied = new Set(cached?.applied || []);
	const pending = listed.filter(record => !applied.has(record.name));
	const records = pending.map(record => record.value);
	const deleted = new Set([...(cached?.deleted || []), ...records.flatMap(record => record.deletedIds || [])]);
	const entries = [
		...(cached?.entries || []),
		...records.flatMap((record, index) => (record.nodes || []).map((node, position) => ({ node, revision: pending[index].name, position })))
	]
		.filter(entry => !deleted.has(entry.node.id))
		.sort((a, b) => a.revision.localeCompare(b.revision) || a.position - b.position);
	const nodes = entries.map(entry => entry.node);
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
	if (!kv.isD1 && pending.length >= 16) {
		// A stale/concurrent cache replacement cannot lose mutations: every read
		// replays all journal keys absent from that snapshot's explicit applied set.
		try { await writeJSON(kv, CACHE_KEY, { schemaVersion: 2, applied: [...applied, ...pending.map(key => key.name)], entries, deleted: [...deleted] }); }
		catch { /* Derived cache publication never changes mutation success. */ }
	}
	return result;
}

export async function appendNodeBatch(kv, nodes) {
	if (!nodes.length) return;
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { schemaVersion: 2, nodes }); }
	finally { invalidateView(kv, PREFIX); }
}

export async function deleteNodeRecord(kv, id, { requireExisting = false } = {}) {
	const nodes = await readNodeRecords(kv, normalizeStoredNode, { deduplicate: false });
	const target = nodes.find(node => node.id === id);
	if (!target && requireExisting) return false;
	const deletedIds = target ? nodes.filter(node => node.content === target.content).map(node => node.id) : [id];
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { schemaVersion: 2, deletedIds }); return true; }
	finally { invalidateView(kv, PREFIX); }
}
