import { compileMainConfig, normalizeMainConfig, isMainNode, legacyMainConfig, MainValidationError } from '../../shared/main-subscription.js';
import { DEFAULT_MAIN_DATA } from '../config.js';
import { readJSON, readRequiredJSON, writeJSON, isObject, revisionKey } from './kv.js';

export const MAIN_HEAD_KEY = 'main.head';
const PREFIX = 'blob.main.';

async function readHead(kv) {
	return readJSON(kv, MAIN_HEAD_KEY, null, value => isObject(value)
		&& typeof value.current === 'string' && value.current.startsWith(PREFIX)
		&& (value.previous === null || typeof value.previous === 'string' && value.previous.startsWith(PREFIX))
		&& (value.history === undefined || Array.isArray(value.history) && value.history.length <= 20 && value.history.every(item => isObject(item) && typeof item.revision === 'string' && item.revision.startsWith(PREFIX) && typeof item.savedAt === 'string' && Number.isInteger(item.count))));
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

async function hashOriginals(originals) {
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(originals)));
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function historyFromHead(kv, head) {
 if (!head) return [];
 const records = await Promise.all([head.current, head.previous].filter(Boolean).map(key => readVersion(kv, key)));
 const versions = [];
 for (const record of records) {
  const originals = (record.config || legacyMainConfig(record.content)).originals;
  const hash = await hashOriginals(originals);
  if (versions.at(-1)?.hash !== hash) versions.push({ revision: record.revision, savedAt: record.metadata.savedAt || '', count: originals.length, hash });
 }
 return versions;
}

export async function readOriginalHistory(kv, limit = 3) {
 const head = await readHead(kv);
 return (head?.history || await historyFromHead(kv, head)).slice(0, limit);
}

export async function readOriginalVersion(kv, revision, limit = 3) {
 const history = await readOriginalHistory(kv, limit);
 if (!history.some(item => item.revision === revision)) throw new MainValidationError('该原始节点版本已不在保留范围内，请重新打开历史版本');
 const record = await readVersion(kv, revision);
 return { originals: (record.config || legacyMainConfig(record.content)).originals, metadata: record.metadata };
}

export class MainConflictError extends Error {
	constructor() { super('主订阅已在其他页面更新。当前编辑已保留，请先导出当前内容，再刷新页面合并修改。'); this.status = 409; }
}

export async function saveMainRecord(kv, content, { expectedRevision, historyLimit = 3 } = {}) {
	const head = await readHead(kv);
	if (expectedRevision !== undefined && expectedRevision !== (head?.current || 'uninitialized')) throw new MainConflictError();
	if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 20) throw new MainValidationError('历史版本数量必须为 1 到 20 的整数');
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
	const originals = (record.config || legacyMainConfig(content)).originals;
 const originalHash = await hashOriginals(originals);
 let history = head?.history || await historyFromHead(kv, head);
 if (originalHash !== (head?.originalHash || history[0]?.hash)) history = [{ revision: metadata.revision, savedAt: metadata.savedAt, count: originals.length }, ...history];
 history = history.slice(0, historyLimit);
	await writeJSON(kv, metadata.revision, record);
 const nextHead = { current: metadata.revision, previous: head?.current || null, originalHash, history };
 await writeJSON(kv, MAIN_HEAD_KEY, nextHead);
 const retained = new Set([nextHead.current, nextHead.previous, ...history.map(item => item.revision)]);
 for (const old of new Set([head?.current, head?.previous, ...(head?.history || []).map(item => item.revision)])) {
  if (old && !retained.has(old)) try { await kv.delete(old); } catch { /* Cleanup must never prevent publication. */ }
 }
	return metadata;
}

export async function readMainSubscriptionData(env) {
	const record = await readMainRecord(env.KV);
	return record.exists ? record.content : env.LINK || DEFAULT_MAIN_DATA;
}
