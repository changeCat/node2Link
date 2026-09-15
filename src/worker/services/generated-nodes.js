import { readMainRecord } from '../storage/main.js';
import { legacyMainConfig, isMainNode } from '../../shared/main-subscription.js';
import { apiTemplateOriginal } from '../domain/generated-nodes.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
import { appendNodeBatch } from '../storage/node-records.js';
import { normalizeDirectNodes, generateNodesFromEndpoints } from '../domain/generated-nodes.js';
const MAX_NODES = 3000;
const MAX_STORED_BYTES = 20 * 1024 * 1024;

export async function appendGeneratedNodes(kv, settings, payload) {
	const isDirect = payload && (payload.node !== undefined || payload.nodes !== undefined || payload.content !== undefined);
	const [existing, generated] = await Promise.all([readGeneratedNodes(kv), Promise.resolve(isDirect ? normalizeDirectNodes(payload) : generateNodesFromEndpoints(settings, payload))]);
	const contents = new Set(existing.map(node => node.content));
	const added = [];
	let duplicateCount = 0;
	for (const node of generated) {
		if (contents.has(node.content)) duplicateCount += 1;
		else {
			contents.add(node.content);
			added.push(node);
		}
	}
	if (existing.length + added.length > MAX_NODES) throw new Error(`API 订阅最多保存 ${MAX_NODES} 个节点`);
	const serialized = JSON.stringify([...existing, ...added]);
	const bytes = new TextEncoder().encode(serialized).length;
	if (bytes > MAX_STORED_BYTES) throw new Error('API 订阅节点数据已达到 20 MB 上限，请删除部分节点后重试');
	await appendNodeBatch(kv, added);
	return { added, duplicateCount, total: existing.length + added.length, bytes, mode: isDirect ? 'direct' : 'template' };
}

export async function readAPITemplateOriginals(kv) {
 const record = await readMainRecord(kv);
 return (record.config || legacyMainConfig(record.content)).originals.filter(node => isMainNode(node.content)).map(apiTemplateOriginal);
}

export async function resolveAPITemplateSelection(kv, ids) {
 if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('请选择 1–20 个不同的原始节点');
 const originals = new Map((await readAPITemplateOriginals(kv)).map(node => [node.id, node]));
 return ids.map(id => {
  const original = originals.get(id);
  if (!original) throw new Error('所选原始节点已不存在，请刷新页面后重新选择');
  if (original.error) throw new Error(original.name + '：' + original.error);
  return { id, content: original.content };
 });
}
