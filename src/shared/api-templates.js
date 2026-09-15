export const DEFAULT_API_PORT = 8443;
export const MAX_API_TEMPLATES = 20;
export function optionalTemplatePort(value) {
 const input = String(value ?? '').trim();
 if (!input) return null;
 if (!/^\d+$/.test(input) || Number(input) < 1 || Number(input) > 65535) throw new Error('模板端口必须是 1 到 65535 的整数');
 return Number(input);
}
export function normalizeTemplateReferences(value) {
 if (!Array.isArray(value) || value.length > MAX_API_TEMPLATES) throw new Error('最多添加 20 个原始节点模板');
 const ids = new Set();
 return value.map(node => {
  if (typeof node?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(node.id)) throw new Error('原始节点 ID 无效');
  if (ids.has(node.id)) throw new Error('不能重复添加同一原始节点');
  ids.add(node.id);
  return { id: node.id, port: optionalTemplatePort(node.port) };
 });
}
