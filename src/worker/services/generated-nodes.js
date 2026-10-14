import { normalizeTemplateReferences } from '../../shared/api-templates.js';
import { readMainRecord } from '../storage/main.js';
import { legacyMainConfig, isMainNode, extendMainNode } from '../../shared/main-subscription.js';
import { apiTemplateOriginal } from '../domain/generated-nodes.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
import { appendNodeBatch } from '../storage/node-records.js';
import { normalizeDirectNodes, normalizeEndpoints, generateNodesForEndpoint } from '../domain/generated-nodes.js';
const MAX_NODES = 3000;
const MAX_STORED_BYTES = 20 * 1024 * 1024;

// Resolve repeated addresses before generation so the final occurrence supplies the port.
function latestEndpointNodes(settings, payload) {
 const groups = new Map();
 for (const endpoint of normalizeEndpoints(payload)) {
  groups.set(endpoint.address, { endpoint, count: (groups.get(endpoint.address)?.count || 0) + 1 });
 }
 let duplicateCount = 0;
 const createdAt = new Date().toISOString();
 const nodes = [...groups.values()].flatMap(({ endpoint, count }) => {
  const generated = generateNodesForEndpoint(settings, endpoint, createdAt);
  duplicateCount += (count - 1) * generated.length;
  return generated;
 });
 return { nodes, duplicateCount };
}

// Match a template across port/name changes, including encoded node formats.
function templateIdentity(node) {
 try { return extendMainNode(node.content, { address: 'template.example.com', port: 443 }, 'template'); }
 catch { return node.content; }
}

export async function appendGeneratedNodes(kv, settings, payload) {
 const isDirect = payload && (payload.node !== undefined || payload.nodes !== undefined || payload.content !== undefined);
 const [existing, generated] = await Promise.all([
  readGeneratedNodes(kv, { deduplicate: Boolean(isDirect) }),
  isDirect ? Promise.resolve({ nodes: normalizeDirectNodes(payload), duplicateCount: 0 })
   : resolveAPITemplateSettings(kv, settings).then(current => latestEndpointNodes(current, payload))
 ]);
 const addresses = new Set(generated.nodes.map(node => node.address));
 const replaced = isDirect ? [] : existing.filter(node => node.kind === 'endpoint' && addresses.has(node.address));
 const replacedIds = new Set(replaced.map(node => node.id));
 const retained = existing.filter(node => !replacedIds.has(node.id));
 const contents = new Set(retained.map(node => node.content));
 const available = new Map();
 for (const node of replaced) {
  if (!available.has(node.address)) available.set(node.address, []);
  available.get(node.address).push(node);
 }
 const added = [], updated = [], unchanged = [];
 let duplicateCount = generated.duplicateCount;
 for (const node of generated.nodes) {
  if (contents.has(node.content)) { duplicateCount++; continue; }
  contents.add(node.content);
  const candidates = available.get(node.address) || [];
  // Keep each template's ID even if its order or effective port changed.
  const identity = templateIdentity(node);
  const match = candidates.findIndex(previous => templateIdentity(previous) === identity);
  const previous = candidates.splice(match < 0 ? 0 : match, 1)[0];
  if (!previous) added.push(node);
  else if (previous.content === node.content) { unchanged.push(previous); duplicateCount++; }
  else updated.push({ ...node, id: previous.id, createdAt: previous.createdAt });
 }
 const deletedIds = [...available.values()].flat().map(node => node.id);
 const finalNodes = [...retained, ...unchanged, ...updated, ...added];
 if (finalNodes.length > MAX_NODES) throw new Error('API 订阅最多保存 ' + MAX_NODES + ' 个节点');
 const bytes = new TextEncoder().encode(JSON.stringify(finalNodes)).length;
 if (bytes > MAX_STORED_BYTES) throw new Error('API 订阅节点数据已达到 20 MB 上限，请删除部分节点后重试');
 await appendNodeBatch(kv, [...updated, ...added], deletedIds);
 return { added, updated, duplicateCount, total: finalNodes.length, bytes, mode: isDirect ? 'direct' : 'template' };
}

export async function readAPITemplateOriginals(kv) {
 const record = await readMainRecord(kv);
 return (record.config || legacyMainConfig(record.content)).originals.filter(node => isMainNode(node.content)).map(apiTemplateOriginal);
}

export async function resolveAPITemplateSelection(kv, selection) {
 const references = normalizeTemplateReferences(selection);
 const originals = new Map((await readAPITemplateOriginals(kv)).map(node => [node.id, node]));
 return references.map(reference => {
  const original = originals.get(reference.id);
  if (!original) throw new Error('关联的原始节点已不存在，请移除失效模板');
  if (original.error) throw new Error(original.name + '：' + original.error);
  return { ...reference, content: original.content };
 });
}

// Read one current main revision per import, never generate from saved credential snapshots.
export async function resolveAPITemplateSettings(kv, settings) {
 if (!Array.isArray(settings.sourceTemplates)) return settings;
 return { ...settings, sourceTemplates: await resolveAPITemplateSelection(kv, settings.sourceTemplates) };
}
