import { listKeys, readJSON, readRequiredJSON, mapConcurrent, StorageError, isObject, writeJSON } from './kv.js';
import { cachedView, invalidateView, MAX_CACHED_KEYS } from './view-cache.js';

const PREFIX = 'NODE2LINK.v3.shares.';
const REVOKED_PREFIX = 'NODE2LINK.v3.revoked.';
const validRevocation = value => isObject(value) && value.deleted === true
	&& (value.replacementId === undefined || isValidShareId(value.replacementId));
const validRecord = value => isObject(value) && value.schemaVersion === 3
	&& isObject(value.share) && isValidShareId(value.share.id) && typeof value.share.content === 'string'
	&& (value.activationId === undefined || isValidShareId(value.activationId));

async function revocation(kv, id) {
	return readJSON(kv, REVOKED_PREFIX + id, null, validRevocation);
}

async function shareView(kv) {
	const [keys, revokedKeys] = await Promise.all([listKeys(kv, PREFIX), listKeys(kv, REVOKED_PREFIX)]);
	const revoked = new Map(await mapConcurrent(revokedKeys, 6, async key => [
		key.name.slice(REVOKED_PREFIX.length),
		validRevocation(key.metadata) ? key.metadata : await readRequiredJSON(kv, key.name, validRevocation)
	]));
	const summaries = await mapConcurrent(keys, 6, async key => {
		const id = key.name.slice(PREFIX.length);
		if (revoked.has(id)) return null;
		let metadata = key.metadata;
		if (!normalizeShareSummary(metadata)) {
			const record = await readRequiredJSON(kv, key.name, validRecord);
			metadata = { ...normalizeShareSummary(record.share), activationId: record.activationId };
		}
		if (metadata.id !== id) throw new StorageError('分享索引格式异常');
		if (metadata.activationId && revoked.get(metadata.activationId)?.replacementId !== id) return null;
		return normalizeShareSummary(metadata);
	});
	return summaries.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function readShare(kv, id) {
	if (!kv || !isValidShareId(id)) return null;
	const [record, revoked] = await Promise.all([
		readJSON(kv, PREFIX + id, null, validRecord), revocation(kv, id)
	]);
	if (revoked || !record) return null;
	if (record.share.id !== id) throw new StorageError('分享内容格式异常');
	if (record.activationId && (await revocation(kv, record.activationId))?.replacementId !== id) return null;
	return record.share;
}

export async function listShareSummaries(kv, { fresh = false } = {}) {
	if (!kv) return [];
	const summaries = await cachedView(kv, PREFIX, () => shareView(kv), {
		fresh, ttlMs: 15_000, cacheable: value => value.length <= MAX_CACHED_KEYS
	});
	return structuredClone(summaries);
}
export const readShareIndex = listShareSummaries;

// Reset stages an inactive new record, then uses one revocation marker to
// disable the old ID and activate the replacement. If publication fails, the
// old link remains usable and the staged replacement is hidden everywhere.
// Revocation markers are never removed or overwritten by ordinary edits.
export async function saveShare(kv, share, previousId) {
	if (!normalizeShareSummary(share) || typeof share.content !== 'string') throw new StorageError('分享格式异常');
	if (await revocation(kv, share.id)) throw new StorageError('分享已撤销，请刷新页面');
	const resetting = previousId && previousId !== share.id;
	if (resetting && !await readShare(kv, previousId)) throw new StorageError('原分享已撤销，请刷新页面');
	const existing = await readJSON(kv, PREFIX + share.id, null, validRecord);
	const activationId = resetting ? previousId : existing?.activationId;
	invalidateView(kv, PREFIX);
	try {
		await writeJSON(kv, PREFIX + share.id, { schemaVersion: 3, share, ...(activationId ? { activationId } : {}) },
			{ ...normalizeShareSummary(share), ...(activationId ? { activationId } : {}) });
		if (resetting) {
			const marker = { deleted: true, replacementId: share.id };
			await writeJSON(kv, REVOKED_PREFIX + previousId, marker, marker);
		}
	} finally { invalidateView(kv, PREFIX); }
}

export async function deleteShare(kv, id) {
	if (!isValidShareId(id)) return;
	if (await revocation(kv, id)) return;
	invalidateView(kv, PREFIX);
	try { await writeJSON(kv, REVOKED_PREFIX + id, { deleted: true }, { deleted: true }); }
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
