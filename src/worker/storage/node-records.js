import { appendRecord, listRecords, StorageError } from './kv.js';
import { normalizeStoredNode } from '../domain/generated-nodes.js';
import { cachedView, invalidateView, MAX_CACHED_KEYS } from './view-cache.js';

const PREFIX = 'nodes.';

export async function readNodeRecords(kv, normalize, { deduplicate = true, fresh = true } = {}) {
	const listed = await cachedView(kv, PREFIX, () => listRecords(kv, PREFIX,
		record => Array.isArray(record?.nodes) || Array.isArray(record?.deletedIds)), {
		fresh, ttlMs: 15_000, cacheable: records => records.length <= MAX_CACHED_KEYS
	});
	const deleted = new Set(listed.flatMap(record => record.value.deletedIds || []));
	const nodes = listed
		.flatMap(record => (record.value.nodes || []).map((node, position) => ({ node, revision: record.name, position })))
		.filter(entry => !deleted.has(entry.node.id))
		.sort((a, b) => a.revision.localeCompare(b.revision) || a.position - b.position)
		.map(entry => entry.node);
	const contents = new Set();
	return nodes.map(node => {
		const normalized = normalize(node);
		if (!normalized) throw new StorageError('节点存储数据格式异常，已停止操作');
		return normalized;
	}).filter(node => {
		if (deduplicate && contents.has(node.content)) return false;
		contents.add(node.content);
		return true;
	});
}

export async function appendNodeBatch(kv, nodes) {
	if (!nodes.length) return;
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { nodes }); }
	finally { invalidateView(kv, PREFIX); }
}

export async function deleteNodeRecord(kv, id, { requireExisting = false } = {}) {
	const nodes = await readNodeRecords(kv, normalizeStoredNode, { deduplicate: false });
	const target = nodes.find(node => node.id === id);
	if (!target && requireExisting) return false;
	const deletedIds = target ? nodes.filter(node => node.content === target.content).map(node => node.id) : [id];
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { deletedIds }); return true; }
	finally { invalidateView(kv, PREFIX); }
}
