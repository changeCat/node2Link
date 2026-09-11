import { listKeys, readJSON, readRequiredJSON, mapConcurrent, StorageError, isObject, writeJSON, writeJSONBatch, revisionKey } from './kv.js';
import { cachedView, invalidateView, MAX_CACHED_KEYS } from './view-cache.js';

const PREFIX = 'shares.';
const REVOKED_PREFIX = 'revoked.';
const BODY_PREFIX = 'blob.share.';
const D1_INLINE_LIMIT = 1_800_000;
const validRevocation = value => isObject(value) && value.deleted === true
	&& (value.replacementId === undefined || isValidShareId(value.replacementId));
const validRecord = value => {
	if (!isObject(value) || !isObject(value.share) || !isValidShareId(value.share.id)
		|| (value.activationId !== undefined && !isValidShareId(value.activationId))) return false;
	const inline = typeof value.share.content === 'string';
	const overflow = typeof value.contentKey === 'string' && value.contentKey.startsWith(BODY_PREFIX);
	return inline !== overflow;
};

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

async function readStoredRecord(kv, id) {
	return readJSON(kv, PREFIX + id, null, validRecord);
}

export async function readShare(kv, id) {
	if (!kv || !isValidShareId(id)) return null;
	const [record, revoked] = await Promise.all([readStoredRecord(kv, id), revocation(kv, id)]);
	if (revoked || !record) return null;
	if (record.share.id !== id) throw new StorageError('分享内容格式异常');
	if (record.activationId && (await revocation(kv, record.activationId))?.replacementId !== id) return null;
	if (typeof record.share.content === 'string') return record.share;
	let content;
	try { content = await kv.get(record.contentKey); }
	catch (cause) { throw new StorageError(undefined, { cause }); }
	if (content === null || content === undefined) throw new StorageError('分享正文暂时不可用');
	return { ...record.share, content };
}

export async function listShareSummaries(kv, { fresh = false } = {}) {
	const summaries = await cachedView(kv, PREFIX, () => shareView(kv), {
		fresh, ttlMs: 15_000, cacheable: value => value.length <= MAX_CACHED_KEYS
	});
	return structuredClone(summaries);
}

// Normal shares fit in one D1 row and publish with their metadata transaction.
// Only a pathologically escaped value near D1's 2 MB row limit spills into an
// immutable KV blob, preserving the existing 1 MiB content limit.
export async function saveShare(kv, share, previousId) {
	if (!normalizeShareSummary(share) || typeof share.content !== 'string') throw new StorageError('分享格式异常');
	if (await revocation(kv, share.id)) throw new StorageError('分享已撤销，请刷新页面');
	const resetting = previousId && previousId !== share.id;
	const previousRecord = resetting ? await readStoredRecord(kv, previousId) : null;
	if (resetting && !await readShare(kv, previousId)) throw new StorageError('原分享已撤销，请刷新页面');
	const existing = await readStoredRecord(kv, share.id);
	const activationId = resetting ? previousId : existing?.activationId;
	const { content, ...summaryFields } = share;
	let record = { share: { ...summaryFields, content }, ...(activationId ? { activationId } : {}) };
	let contentKey;
	if (new TextEncoder().encode(JSON.stringify(record)).length > D1_INLINE_LIMIT) {
		contentKey = revisionKey(BODY_PREFIX + share.id + '.');
		record = { share: summaryFields, contentKey, ...(activationId ? { activationId } : {}) };
		try { await kv.put(contentKey, content); }
		catch (cause) { throw new StorageError(undefined, { cause }); }
	}
	invalidateView(kv, PREFIX);
	try {
		const metadata = { ...normalizeShareSummary(share), ...(activationId ? { activationId } : {}) };
		const records = [{ key: PREFIX + share.id, value: record, metadata }];
		if (resetting) {
			const marker = { deleted: true, replacementId: share.id };
			records.push({ key: REVOKED_PREFIX + previousId, value: marker, metadata: marker });
		}
		await writeJSONBatch(kv, records);
		const previousBody = resetting ? previousRecord?.contentKey : existing?.contentKey;
		if (previousBody && previousBody !== contentKey) {
			try { await kv.delete(previousBody); } catch { /* Orphan cleanup is best effort. */ }
		}
	} finally { invalidateView(kv, PREFIX); }
}

export async function deleteShare(kv, id) {
	if (!isValidShareId(id)) return;
	if (await revocation(kv, id)) return;
	const record = await readStoredRecord(kv, id);
	invalidateView(kv, PREFIX);
	try {
		await writeJSON(kv, REVOKED_PREFIX + id, { deleted: true }, { deleted: true });
		if (record?.contentKey) {
			try { await kv.delete(record.contentKey); } catch { /* Revocation remains authoritative. */ }
		}
	} finally { invalidateView(kv, PREFIX); }
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
