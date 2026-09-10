import { appendRecord, listKeys, readJSON, readRequiredJSON, mapConcurrent, StorageError, isObject } from './kv.js';
import { cachedView, invalidateView, MAX_CACHED_KEYS } from './view-cache.js';

const PREFIX = 'NODE2LINK.v2.shares.';
const LEGACY_PREFIX = 'NODE2LINK.share.';

async function shareView(kv) {
	const [legacyIndex, legacyKeys, events] = await Promise.all([
		readJSON(kv, 'NODE2LINK.shares.json', [], Array.isArray),
		listKeys(kv, LEGACY_PREFIX), listKeys(kv, PREFIX)
	]);
	const summaries = new Map(legacyIndex.map(normalizeShareSummary).filter(Boolean).map(item => [item.id, item]));
	const entries = new Map(legacyKeys.map(key => {
		const id = key.name.slice(LEGACY_PREFIX.length);
		return [id, { key: key.name, summary: summaries.get(id) }];
	}));
	const revoked = new Set();
	for (const event of events) {
		const metadata = event.metadata || (await readRequiredJSON(kv, event.name)).index;
		if (!Array.isArray(metadata?.changes)) throw new StorageError('分享索引格式异常');
		for (const change of metadata.changes) {
			if (change.deleted) revoked.add(change.id);
			else {
				const summary = normalizeShareSummary(change);
				if (!summary) throw new StorageError('分享摘要格式异常');
				entries.set(change.id, { key: event.name, summary, event: true });
			}
		}
	}
	// Revocation is terminal, irrespective of event ordering. A late edit cannot
	// restore a deleted/reset ID, including IDs originally stored in legacy KV.
	for (const id of revoked) entries.delete(id);
	return entries;
}

async function readEntry(kv, id, entry) {
	const record = await readRequiredJSON(kv, entry.key);
	const share = entry.event ? record.share : record;
	if (!share || share.id !== id || typeof share.content !== 'string') throw new StorageError('分享内容格式异常');
	return share;
}

export async function readShare(kv, id) {
	if (!isValidShareId(id)) return null;
	const entry = (await shareView(kv)).get(id);
	return entry ? readEntry(kv, id, entry) : null;
}

export async function listShareSummaries(kv, { fresh = false } = {}) {
	if (!kv) return [];
	const entries = await cachedView(kv, PREFIX, () => shareView(kv), { fresh, cacheable: entries => entries.size <= MAX_CACHED_KEYS });
	const summaries = await mapConcurrent([...entries], 6, async ([id, entry]) => entry.summary || normalizeShareSummary(await readEntry(kv, id, entry)));
	return summaries.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export const readShareIndex = listShareSummaries;

// Content and index metadata are committed together in the same KV write.
// A reset publishes the old-ID tombstone and the new share atomically.
export async function saveShare(kv, share, previousId) {
	const changes = [normalizeShareSummary(share)];
	if (previousId && previousId !== share.id) changes.unshift({ id: previousId, deleted: true });
	const index = { changes };
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { schemaVersion: 2, share, index }, index); }
	finally { invalidateView(kv, PREFIX); }
}

export async function deleteShare(kv, id) {
	const index = { changes: [{ id, deleted: true }] };
	invalidateView(kv, PREFIX);
	try { await appendRecord(kv, PREFIX, { schemaVersion: 2, index }, index); }
	finally { invalidateView(kv, PREFIX); }
}

export function isValidShareId(value) {
	return /^[A-Za-z0-9_-]{12,64}$/.test(String(value || ''));
}

export function normalizeShareSummary(share) {
	if (!share || !isValidShareId(share.id)) return null;
	const name = String(share.name || '').trim().slice(0, 80);
	if (!name) return null;
	return {
		id: share.id,
		name,
		paused: share.paused === true,
		expiresAt: String(share.expiresAt || ''),
		nodeCount: Math.max(0, Number.parseInt(share.nodeCount, 10) || 0),
		sourceCount: Math.max(0, Number.parseInt(share.sourceCount, 10) || 0),
		createdAt: String(share.createdAt || ''),
		updatedAt: String(share.updatedAt || share.createdAt || '')
	};
}

export function createShareId() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
