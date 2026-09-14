// Shared by the main editor and Worker. This module deliberately has no API-subscription dependencies.
export const MAIN_VERSION = 2;
export const MAIN_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
export const MAIN_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const MAX_BYTES = 20 * 1024 * 1024;
const encoder = new TextEncoder();
export class MainValidationError extends Error {
 constructor(message) { super(message); this.status = 400; }
}
const fail = message => { throw new MainValidationError(message); };
export const mainId = () => crypto.randomUUID();
export const mainLines = text => String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export const isMainSource = text => /^https?:\/\//i.test(text);
export const isMainNode = text => /^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !isMainSource(text);
export const originalText = config => config.originals.map(node => node.content).join('\n');

export function legacyMainConfig(content) {
 return { version: MAIN_VERSION, originals: mainLines(content).map((content, i) => ({ id: `legacy-${i}`, content })), endpoints: [] };
}

function decode64(value) {
 const text = value.replace(/-/g, '+').replace(/_/g, '/');
 return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text), ch => ch.charCodeAt(0)));
}
function encode64(value, urlSafe = false) {
 const bytes = encoder.encode(value);
 let binary = '';
 for (const byte of bytes) binary += String.fromCharCode(byte);
 const encoded = btoa(binary);
 return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
}
function decodeName(value) { try { return decodeURIComponent(value); } catch { return value; } }
export function mainNodeName(content, fallback = '未命名节点') {
 try {
  if (/^vmess:\/\//i.test(content) && !content.slice(8).includes('@')) {
   return String(JSON.parse(decode64(content.slice(8).split('#')[0])).ps || fallback);
  }
  if (/^ssr:\/\//i.test(content)) {
   const decoded = decode64(content.slice(6));
   const remarks = new URLSearchParams(decoded.split('/?')[1] || '').get('remarks');
   if (remarks) return decode64(remarks);
  }
 } catch { /* Raw nodes remain editable even when their encoded payload is malformed. */ }
 const hash = content.indexOf('#');
 return hash >= 0 && content.slice(hash + 1) ? decodeName(content.slice(hash + 1)) : fallback;
}

export function normalizeMainAddress(value) {
 let address = String(value || '').trim().toLowerCase().replace(/\.$/, '');
 if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
 if (address.includes(':')) {
  try { return new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { fail('请输入有效的 IPv6 地址'); }
 }
 if (/^[\d.]+$/.test(address)) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) fail('请输入有效的 IPv4 地址');
  return parts.map(Number).join('.');
 }
 if (address.length > 253 || !address.includes('.') || !address.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) fail('请输入有效的域名或 IP，不要包含协议、路径或端口');
 return address;
}

export function parseMainEndpointLine(line, defaultPort = 443) {
 let address = String(line).trim(), port = defaultPort;
 const bracketed = address.match(/^(\[[^\]]+\])(?::(\d+))?$/);
 const hostPort = address.match(/^([^:]+):(\d+)$/);
 if (bracketed || hostPort) {
  const match = bracketed || hostPort;
  address = match[1];
  if (match[2]) port = Number(match[2]);
 }
 return { address: normalizeMainAddress(address), port: normalizePort(port) };
}
function normalizePort(value) {
 if (!/^\d+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) fail('端口必须为 1–65535 的整数');
 return Number(value);
}

export function normalizeMainConfig(input, { allowIncomplete = false } = {}) {
 if (!input || input.version !== MAIN_VERSION || !Array.isArray(input.originals) || !Array.isArray(input.endpoints)) fail('主订阅配置格式无效');
 if (input.endpoints.length > 1000) fail('优选地址不能超过 1000 条');
 const ids = new Set();
 const idOf = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || ids.has(value)) fail('节点或优选地址 ID 无效或重复');
  ids.add(value); return value;
 };
 const originals = input.originals.map((node, index) => {
  const id = idOf(node?.id);
  if (typeof node.content !== 'string' || !node.content.trim() || /[\r\n\0]/.test(node.content)) fail(`原始节点第 ${index + 1} 项必须是单行内容`);
  return { id, content: node.content.trim() };
 });
 const nodes = new Map(originals.map(node => [node.id, node]));
 const endpoints = input.endpoints.map((endpoint, index) => {
  try {
   const id = idOf(endpoint?.id);
   const address = normalizeMainAddress(endpoint.address);
   const port = normalizePort(endpoint.port);
   if (typeof endpoint.enabled !== 'boolean' || !Array.isArray(endpoint.originalIds)) fail('启用状态或关联节点格式无效');
   const originalIds = [...new Set(endpoint.originalIds)];
   for (const originalId of originalIds) {
    if (typeof originalId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(originalId)) fail('关联节点 ID 无效');
    if (!nodes.has(originalId) && !allowIncomplete) fail('关联的原始节点已不存在，请重新选择');
    if (nodes.has(originalId) && !isMainNode(nodes.get(originalId).content) && !allowIncomplete) fail('订阅源或非节点文本不能作为扩展模板');
   }
   if (endpoint.enabled && !originalIds.length && !allowIncomplete) fail('请至少勾选一个原始节点，或停用此地址');
   const label = String(endpoint.label || '').trim();
   if (label.length > 160 || /[\r\n\0]/.test(label)) fail('备注不能超过 160 字，且不能换行');
   return { id, address, port, label, enabled: endpoint.enabled, originalIds };
  } catch (error) { fail(`优选地址第 ${index + 1} 条：${error.message}`); }
 });
 const config = { version: MAIN_VERSION, originals, endpoints };
 if (encoder.encode(JSON.stringify(config)).length > MAX_BYTES) fail('主订阅配置不能超过 20 MB');
 return config;
}

function replaceAuthority(body, endpoint) {
 // Preserve credentials, query bytes, duplicate parameters, paths and unknown fields verbatim.
 const match = body.match(/^((?:[^/?#]*@)?)(\[[^\]]+\]|[^:/?#]+)(?::\d+)?([/?#].*)?$/);
 if (!match) fail('无法解析节点的连接地址和端口');
 const host = endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
 return `${match[1]}${host}:${endpoint.port}${match[3] || ''}`;
}

export function extendMainNode(content, endpoint, name) {
 try {
  const match = content.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (!match || isMainSource(content)) fail('无法解析节点链接');
  const [, scheme, input] = match;
  const protocol = scheme.toLowerCase();
  if (protocol === 'vmess' && !input.includes('@')) {
   const data = JSON.parse(decode64(input.split('#')[0]));
   if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.add !== 'string') fail('VMess JSON 缺少 add 字段');
   data.add = endpoint.address;
   data.port = typeof data.port === 'number' ? endpoint.port : String(endpoint.port);
   data.ps = name;
   return `${scheme}://${encode64(JSON.stringify(data))}`;
  }
  if (protocol === 'ssr') {
   const decoded = decode64(input);
   const split = decoded.indexOf('/?');
   const core = split < 0 ? decoded : decoded.slice(0, split);
   const parts = core.match(/^(.*?):(\d+):([^:]+):([^:]+):([^:]+):([^:]*)$/);
   if (!parts) fail('无法解析 SSR 节点');
   const host = endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
   const params = (split < 0 ? '' : decoded.slice(split + 2)).split('&').filter(part => part && !/^remarks=/.test(part));
   params.push(`remarks=${encode64(name, true)}`);
   return `${scheme}://${encode64(`${host}:${endpoint.port}:${parts[3]}:${parts[4]}:${parts[5]}:${parts[6]}/?${params.join('&')}`, true)}`;
  }
  const hash = input.indexOf('#');
  let body = hash < 0 ? input : input.slice(0, hash);
  if (protocol === 'ss' && !body.includes('@')) {
   const query = body.indexOf('?');
   const suffix = query < 0 ? '' : body.slice(query);
   const decoded = decode64((query < 0 ? body : body.slice(0, query)).replace(/\/$/, ''));
   if (!decoded.includes('@')) fail('无法解析 Shadowsocks 节点');
   body = encode64(replaceAuthority(decoded, endpoint)) + suffix;
  } else body = replaceAuthority(body, endpoint);
  return `${scheme}://${body}#${encodeURIComponent(name)}`;
 } catch (error) {
  throw new MainValidationError(error instanceof MainValidationError ? error.message : '节点编码或内容无法解析，请检查原始链接');
 }
}

export function compileMainConfig(input) {
 const config = normalizeMainConfig(input);
 const endpointsByOriginal = new Map();
 let count = 0;
 for (const endpoint of config.endpoints) {
  if (!endpoint.enabled) continue;
  count += endpoint.originalIds.length;
  if (count > 10000) fail('一次最多生成 10000 个扩展节点');
  for (const id of endpoint.originalIds) {
   if (!endpointsByOriginal.has(id)) endpointsByOriginal.set(id, []);
   endpointsByOriginal.get(id).push(endpoint);
  }
 }
 const nodes = [], lines = [], seen = new Set();
 let bytes = 0;
 const add = (content, node) => {
  if (seen.has(content)) return;
  bytes += encoder.encode(content).length + (lines.length ? 1 : 0);
  if (bytes > MAX_BYTES) fail('生成后的主订阅内容不能超过 20 MB');
  seen.add(content); lines.push(content);
  if (node) nodes.push({ ...node, content });
 };
 for (const [index, original] of config.originals.entries()) {
  const name = mainNodeName(original.content, `主订阅节点 ${index + 1}`);
  const base = { originalId: original.id, originalName: name };
  add(original.content, isMainNode(original.content) ? { ...base, id: `main-original-${original.id}`, kind: 'original', name } : null);
  for (const endpoint of endpointsByOriginal.get(original.id) || []) {
   const nameSuffix = endpoint.label || `${endpoint.address}:${endpoint.port}`;
   const extendedName = `${name} · ${nameSuffix}`;
   try {
    add(extendMainNode(original.content, endpoint, extendedName), { ...base, id: `main-extension-${original.id}-${endpoint.id}`, kind: 'extension', endpointId: endpoint.id, name: extendedName });
   } catch (error) { fail(`${name} → ${nameSuffix}：${error.message}`); }
  }
 }
 return { config, content: lines.join('\n'), nodes };
}
