const SETTINGS_KEY = 'NODE2LINK.api-subscription.settings.json';
const NODES_KEY = 'NODE2LINK.api-subscription.nodes.json';
const SUPPORTED_PROTOCOL = /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i;
const CLOUDFLARE_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
const MAX_NODES = 3000;
const MAX_TEMPLATE_LINES = 20;
const MAX_TEMPLATE_LINE_BYTES = 16 * 1024;
const MAX_STORED_BYTES = 20 * 1024 * 1024;

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function requestHasSameOrigin(request) {
	const origin = request.headers.get('Origin');
	if (!origin) return false;
	try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function createId() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanLines(value) {
	return [...new Set(String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

function isIPv4(value) {
	const parts = String(value).split('.');
	return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIPv6(value) {
	const input = String(value || '').replace(/^\[|\]$/g, '');
	if (!input.includes(':') || !/^[0-9a-f:]+$/i.test(input)) return false;
	try { return Boolean(new URL(`http://[${input}]/`).hostname); } catch { return false; }
}

function isDomain(value) {
	const input = String(value || '').toLowerCase();
	if (!input || input.length > 253 || isIPv4(input) || isIPv6(input)) return false;
	const labels = input.endsWith('.') ? input.slice(0, -1).split('.') : input.split('.');
	return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function randomCloudflareHTTPSPort() {
	const random = new Uint32Array(1);
	crypto.getRandomValues(random);
	return CLOUDFLARE_HTTPS_PORTS[random[0] % CLOUDFLARE_HTTPS_PORTS.length];
}

function normalizeEndpoint(payload) {
	const address = String(payload?.address || '').trim();
	if (!address) throw new Error('请传入 address 参数');
	const input = address.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
	const addressType = isDomain(input) ? 'domain' : isIPv4(input) || isIPv6(input) ? 'ip' : '';
	if (!addressType) throw new Error('address 参数不是有效的域名、IPv4 或 IPv6 地址');
	const portInput = String(payload?.port || '').trim();
	const port = portInput ? Number(portInput) : randomCloudflareHTTPSPort();
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port 参数必须是 1 到 65535 的整数');
	return { kind: 'endpoint', addressType, address: input, port };
}

function applyFilter(value, filter) {
	const [operation, ...args] = filter.split(':');
	if (operation === 'slice') {
		const start = args[0] === '' || args[0] === undefined ? 0 : Number(args[0]);
		const end = args[1] === '' || args[1] === undefined ? undefined : Number(args[1]);
		if (!Number.isInteger(start) || (end !== undefined && !Number.isInteger(end))) throw new Error(`无效的 slice 截取操作：${filter}`);
		return String(value).slice(start, end);
	}
	if (operation === 'split') {
		const separator = args[0] ?? '';
		const index = Number(args[1] ?? 0);
		if (!separator || !Number.isInteger(index)) throw new Error(`无效的 split 分段操作：${filter}`);
		const parts = String(value).split(separator);
		return parts[index < 0 ? parts.length + index : index] || '';
	}
	throw new Error(`不支持的模板操作：${operation}`);
}

function applyVariables(template, variables) {
	return String(template).replace(/\{\{(address|port|name|type)((?:\|[^{}|]+)*)\}\}/g, (_match, key, filters) => {
		let value = variables[key];
		for (const filter of String(filters || '').split('|').filter(Boolean)) value = applyFilter(value, filter);
		return value;
	});
}

function hasVariable(template, names) {
	return new RegExp(`\\{\\{(?:${names.join('|')})(?:\\|[^{}|]+)*\\}\\}`).test(template);
}

export function normalizeGeneratedNodeSettings(payload = {}, previous = {}) {
	const tokenInput = String(payload.token ?? previous.token ?? '').trim();
	if (tokenInput && !/^[A-Za-z0-9_-]{16,128}$/.test(tokenInput)) throw new Error('API Token 只能包含字母、数字、下划线或短横线，长度为 16–128 位');
	const nodeTemplates = cleanLines(payload.nodeTemplate ?? previous.nodeTemplate ?? '');
	if (nodeTemplates.length > MAX_TEMPLATE_LINES) throw new Error(`节点模板不能超过 ${MAX_TEMPLATE_LINES} 行`);
	for (const [index, template] of nodeTemplates.entries()) {
		if (new TextEncoder().encode(template).length > MAX_TEMPLATE_LINE_BYTES) throw new Error(`节点模板第 ${index + 1} 行不能超过 16 KB`);
		if (!SUPPORTED_PROTOCOL.test(template)) throw new Error(`节点模板第 ${index + 1} 行不是支持的节点链接`);
		if (!hasVariable(template, ['address'])) throw new Error(`节点模板第 ${index + 1} 行缺少 {{address}}`);
		if (!hasVariable(template, ['port'])) throw new Error(`节点模板第 ${index + 1} 行缺少 {{port}}`);
		if (!hasVariable(template, ['name'])) throw new Error(`节点模板第 ${index + 1} 行缺少 {{name}}`);
		applyVariables(template, { address: '', port: '', name: '', type: '' });
	}
	const nameTemplate = String(payload.nameTemplate ?? previous.nameTemplate ?? 'CF-{{type}}-{{address}}:{{port}}').trim().replace(/[\r\n\0]/g, '').slice(0, 160);
	if (!nameTemplate) throw new Error('请输入节点名称格式');
	if (!hasVariable(nameTemplate, ['address'])) throw new Error('节点名称格式必须包含 {{address}}');
	applyVariables(nameTemplate, { address: '', port: '', name: '', type: '' });
	return { token: tokenInput || createId(), nodeTemplate: nodeTemplates.join('\n'), nameTemplate, savedAt: String(previous.savedAt || '') };
}

export async function readGeneratedNodeSettings(kv, { ensureToken = false } = {}) {
	let parsed = {};
	try { const value = kv ? await kv.get(SETTINGS_KEY) : null; parsed = value ? JSON.parse(value) : {}; }
	catch (error) { console.error('读取 API 订阅设置失败:', error); }
	let settings;
	try {
		settings = normalizeGeneratedNodeSettings({}, parsed && typeof parsed === 'object' ? parsed : {});
	} catch (error) {
		console.warn('API 订阅旧模板不再兼容，请重新保存模板:', error.message);
		settings = normalizeGeneratedNodeSettings({ token: parsed?.token || '', nodeTemplate: '', nameTemplate: 'CF-{{type}}-{{address}}:{{port}}' });
	}
	if (ensureToken && kv && (!parsed || parsed.token !== settings.token)) await kv.put(SETTINGS_KEY, JSON.stringify(settings));
	return settings;
}

function normalizeStoredNode(node) {
	if (!node || !/^[A-Za-z0-9_-]{12,64}$/.test(String(node.id || '')) || !SUPPORTED_PROTOCOL.test(String(node.content || ''))) return null;
	const kind = node.kind === 'raw' ? 'raw' : ['endpoint', 'domain', 'ip'].includes(node.kind) ? 'endpoint' : '';
	if (!kind) return null;
	const port = node.port === null || node.port === undefined || node.port === '' ? null : Number(node.port);
	if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
	return {
		id: String(node.id), kind,
		addressType: node.addressType === 'domain' || node.kind === 'domain' ? 'domain' : node.addressType === 'ip' || node.kind === 'ip' ? 'ip' : '',
		address: String(node.address || '').slice(0, 253), port,
		name: String(node.name || '').slice(0, 240), content: String(node.content), createdAt: String(node.createdAt || '')
	};
}

export async function readGeneratedNodes(kv) {
	if (!kv) return [];
	try {
		const value = await kv.get(NODES_KEY);
		const parsed = value ? JSON.parse(value) : [];
		return Array.isArray(parsed) ? parsed.map(normalizeStoredNode).filter(Boolean) : [];
	} catch (error) { console.error('读取 API 订阅节点失败:', error); return []; }
}

export function generateNodesFromEndpoint(settings, payload, createdAt = new Date().toISOString()) {
	const endpoint = normalizeEndpoint(payload);
	const templates = cleanLines(settings.nodeTemplate);
	if (!templates.length) throw new Error('管理员尚未配置节点模板');
	const uriAddress = endpoint.addressType === 'ip' && endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
	const nameVariables = { address: endpoint.address, port: String(endpoint.port), type: endpoint.addressType === 'domain' ? '域名' : 'IP', name: '' };
	const generatedName = applyVariables(settings.nameTemplate, nameVariables).trim().slice(0, 240);
	if (!generatedName) throw new Error('节点名称格式生成了空名称');
	const variables = { ...nameVariables, address: uriAddress, name: encodeURIComponent(generatedName) };
	return templates.map(template => ({ id: createId(), ...endpoint, name: generatedName, content: applyVariables(template, variables), createdAt }));
}

function directNodeName(content, index) {
	const hashIndex = content.lastIndexOf('#');
	if (hashIndex >= 0 && hashIndex < content.length - 1) {
		try { const decoded = decodeURIComponent(content.slice(hashIndex + 1)).trim(); if (decoded) return decoded.slice(0, 240); } catch {}
	}
	return `API 完整节点 ${index + 1}`;
}

function directNodeEndpoint(content) {
	const match = content.match(/^[a-z0-9+.-]+:\/\/(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/?#\s]+)(?::(\d{1,5}))?/i);
	if (!match) return { address: '', port: null };
	const address = match[1].replace(/^\[|\]$/g, '');
	const port = match[2] ? Number(match[2]) : null;
	return { address: address.slice(0, 253), port: port && port <= 65535 ? port : null };
}

export function normalizeDirectNodes(payload, createdAt = new Date().toISOString()) {
	const value = payload && (payload.node ?? payload.nodes ?? payload.content);
	const lines = cleanLines(value);
	if (!lines.length) throw new Error('请传入完整节点参数 node');
	if (lines.length > MAX_TEMPLATE_LINES) throw new Error(`一次最多上传 ${MAX_TEMPLATE_LINES} 个完整节点`);
	return lines.map((content, index) => {
		if (new TextEncoder().encode(content).length > MAX_TEMPLATE_LINE_BYTES) throw new Error(`完整节点第 ${index + 1} 行不能超过 16 KB`);
		if (!SUPPORTED_PROTOCOL.test(content)) throw new Error(`完整节点第 ${index + 1} 行不是支持的节点链接`);
		return { id: createId(), kind: 'raw', addressType: '', ...directNodeEndpoint(content), name: directNodeName(content, index), content, createdAt };
	});
}

export async function appendGeneratedNodes(kv, settings, payload) {
	const isDirect = payload && (payload.node !== undefined || payload.nodes !== undefined || payload.content !== undefined);
	const [existing, generated] = await Promise.all([readGeneratedNodes(kv), Promise.resolve(isDirect ? normalizeDirectNodes(payload) : generateNodesFromEndpoint(settings, payload))]);
	const contents = new Set(existing.map(node => node.content));
	const added = generated.filter(node => !contents.has(node.content));
	if (existing.length + added.length > MAX_NODES) throw new Error(`API 订阅最多保存 ${MAX_NODES} 个节点`);
	const serialized = JSON.stringify([...existing, ...added]);
	if (new TextEncoder().encode(serialized).length > MAX_STORED_BYTES) throw new Error('API 订阅节点数据已达到 20 MB 上限，请删除部分节点后重试');
	if (added.length) await kv.put(NODES_KEY, serialized);
	return { added, duplicateCount: generated.length - added.length, total: existing.length + added.length, mode: isDirect ? 'direct' : 'template' };
}

export async function handlePublicNodeImport(request, env, url = new URL(request.url)) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	try {
		const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : (request.headers.get('Content-Type') || '').includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
		const settings = await readGeneratedNodeSettings(env.KV);
		const token = String(input.token || request.headers.get('X-API-Token') || '');
		if (!settings.token || token !== settings.token) return jsonResponse({ ok: false, message: 'API Token 无效' }, 401);
		const result = await appendGeneratedNodes(env.KV, settings, input);
		return jsonResponse({ ok: true, message: result.added.length ? `已追加 ${result.added.length} 个节点` : '节点已存在，未重复追加', added: result.added.length, duplicates: result.duplicateCount, total: result.total, mode: result.mode, nodes: result.added.map(node => ({ id: node.id, name: node.name, address: node.address, port: node.port })) }, result.added.length ? 201 : 200);
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '追加节点失败' }, 400); }
}

export async function handleGeneratedNodesAPI(request, env) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') {
		const [settings, nodes] = await Promise.all([readGeneratedNodeSettings(env.KV, { ensureToken: true }), readGeneratedNodes(env.KV)]);
		return jsonResponse({ ok: true, settings, nodes });
	}
	if (!requestHasSameOrigin(request)) return jsonResponse({ ok: false, message: '请求来源无效' }, 403);
	try {
		const payload = await request.json();
		if (request.method === 'PUT') {
			const previous = await readGeneratedNodeSettings(env.KV);
			const settings = normalizeGeneratedNodeSettings(payload, previous);
			settings.savedAt = new Date().toISOString();
			await env.KV.put(SETTINGS_KEY, JSON.stringify(settings));
			return jsonResponse({ ok: true, settings });
		}
		if (request.method === 'DELETE') {
			const id = String(payload.id || '');
			const nodes = await readGeneratedNodes(env.KV);
			if (!nodes.some(node => node.id === id)) return jsonResponse({ ok: false, message: '节点不存在' }, 404);
			await env.KV.put(NODES_KEY, JSON.stringify(nodes.filter(node => node.id !== id)));
			return jsonResponse({ ok: true });
		}
		return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	} catch (error) { return jsonResponse({ ok: false, message: error.message || '操作失败' }, 400); }
}
