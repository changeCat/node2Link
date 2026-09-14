import { compileMainConfig, normalizeMainConfig, isMainNode, MainValidationError } from '../../shared/main-subscription.js';
import { DEFAULT_MAIN_DATA } from '../config.js';
import { readJSON, readRequiredJSON, writeJSON, isObject, revisionKey } from './kv.js';

export const MAIN_HEAD_KEY = 'main.head';
const PREFIX = 'blob.main.';

async function readHead(kv) {
	return readJSON(kv, MAIN_HEAD_KEY, null, value => isObject(value)
		&& typeof value.current === 'string' && value.current.startsWith(PREFIX)
		&& (value.previous === null || typeof value.previous === 'string' && value.previous.startsWith(PREFIX)));
}

function validateMainRecord(value) {
 if (!isObject(value) || typeof value.content !== 'string' || !isObject(value.metadata)) return false;
 if (value.config === undefined && value.mainNodes === undefined) return true;
 try {
  const config = normalizeMainConfig(value.config);
  if (!Array.isArray(value.mainNodes)) return false;
  const lines = value.content.split('\n');
  const originals = new Map(config.originals.map(node => [node.id, node]));
  const endpoints = new Map(config.endpoints.map(endpoint => [endpoint.id, endpoint]));
  const seenLines = new Set(), seenIds = new Set();
  for (const node of value.mainNodes) {
   if (!isObject(node) || !Number.isInteger(node.line) || node.line < 0 || node.line >= lines.length || seenLines.has(node.line)
    || typeof node.id !== 'string' || seenIds.has(node.id) || typeof node.name !== 'string' || typeof node.originalName !== 'string'
    || !originals.has(node.originalId) || !isMainNode(lines[node.line])) return false;
   if (node.kind === 'original') {
    if (lines[node.line] !== originals.get(node.originalId).content) return false;
   } else if (node.kind === 'extension') {
    const endpoint = endpoints.get(node.endpointId);
    if (!endpoint?.enabled || !endpoint.originalIds.includes(node.originalId)) return false;
   } else return false;
   seenLines.add(node.line); seenIds.add(node.id);
  }
  return value.mainNodes.length === lines.filter(isMainNode).length;
 } catch { return false; }
}

async function readVersion(kv, revision) {
	const record = await readRequiredJSON(kv, revision, validateMainRecord);
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
	const compiled = typeof content === 'string' ? null : compileMainConfig(content);
	if (compiled) content = compiled.content;
	const metadata = { savedAt: new Date().toISOString(), bytes: new TextEncoder().encode(content).length, lines: content ? content.split(/\r?\n/).length : 0 };
	if (metadata.bytes > 20 * 1024 * 1024) throw new Error('主订阅内容不能超过 20 MB');
	metadata.revision = revisionKey(PREFIX);
	if (compiled) {
		metadata.originalCount = compiled.nodes.filter(node => node.kind === 'original').length;
		metadata.extensionCount = compiled.nodes.filter(node => node.kind === 'extension').length;
	}
	const lineIndexes = compiled ? new Map(content.split('\n').map((line, index) => [line, index])) : null;
	// Configuration and compiled output share one immutable revision. Store compact provenance.
	const record = { content, metadata, ...(compiled ? { config: compiled.config, mainNodes: compiled.nodes.map(({ content, ...node }) => ({ ...node, line: lineIndexes.get(content) })) } : {}) };
	if (compiled && new TextEncoder().encode(JSON.stringify(record)).length > 24 * 1024 * 1024) throw new MainValidationError('主订阅配置和生成结果合计不能超过 24 MB');
	// Publish the immutable body first, then atomically select current/previous.
	// A failed head write leaves the visible content and backup untouched.
	// Each version stores configuration and output together under the checked blob limit.
	await writeJSON(kv, metadata.revision, record);
	await writeJSON(kv, MAIN_HEAD_KEY, { current: metadata.revision, previous: head?.current || null });
	if (head?.previous) {
		try { await kv.delete(head.previous); } catch { /* Old-version cleanup is best effort. */ }
	}
	return metadata;
}

export async function readMainSubscriptionData(env) {
	const record = await readMainRecord(env.KV);
	return record.exists ? record.content : env.LINK || DEFAULT_MAIN_DATA;
}
