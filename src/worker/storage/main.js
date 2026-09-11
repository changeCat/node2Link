import { DEFAULT_MAIN_DATA } from '../config.js';
import { readJSON, readRequiredJSON, writeJSON, isObject, revisionKey } from './kv.js';

export const MAIN_HEAD_KEY = 'NODE2LINK.v3.main.head';
const PREFIX = 'NODE2LINK.v3.main.version.';

async function readHead(kv) {
	if (!kv) return null;
	return readJSON(kv, MAIN_HEAD_KEY, null, value => isObject(value)
		&& typeof value.current === 'string' && value.current.startsWith(PREFIX)
		&& (value.previous === null || typeof value.previous === 'string' && value.previous.startsWith(PREFIX)));
}

async function readVersion(kv, revision) {
	const record = await readRequiredJSON(kv, revision, value => isObject(value) && typeof value.content === 'string' && isObject(value.metadata));
	return { ...record, revision, exists: true };
}

export async function readMainRecord(kv) {
	const head = await readHead(kv);
	return head ? readVersion(kv, head.current) : { content: '', metadata: null, exists: false, revision: 'uninitialized' };
}

export async function readMainBackup(kv) {
	const head = await readHead(kv);
	return head?.previous ? readVersion(kv, head.previous) : null;
}

export class MainConflictError extends Error {
	constructor() { super('主订阅已在其他页面更新。当前编辑已保留，请先下载备份，再刷新页面合并修改。'); this.status = 409; }
}

export async function saveMainRecord(kv, content, { expectedRevision } = {}) {
	const head = await readHead(kv);
	if (expectedRevision !== undefined && expectedRevision !== (head?.current || 'uninitialized')) throw new MainConflictError();
	const metadata = { savedAt: new Date().toISOString(), bytes: new TextEncoder().encode(content).length, lines: content ? content.split(/\r?\n/).length : 0 };
	if (metadata.bytes > 20 * 1024 * 1024) throw new Error('主订阅内容不能超过 20 MB');
	metadata.revision = revisionKey(PREFIX);
	// Publish the immutable body first, then atomically select current/previous.
	// A failed head write leaves the visible content and backup untouched.
	// Separate bodies preserve the 20 MB limit without doubling a KV value.
	await writeJSON(kv, metadata.revision, { schemaVersion: 3, content, metadata });
	await writeJSON(kv, MAIN_HEAD_KEY, { current: metadata.revision, previous: head?.current || null });
	return metadata;
}

export async function readMainSubscriptionData(env) {
	if (!env.KV) return env.LINK || DEFAULT_MAIN_DATA;
	const record = await readMainRecord(env.KV);
	return record.exists ? record.content : DEFAULT_MAIN_DATA;
}
