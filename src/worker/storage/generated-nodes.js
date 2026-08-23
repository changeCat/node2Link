const SETTINGS_KEY = 'NODE2LINK.api-subscription.settings.json';
const NODES_KEY = 'NODE2LINK.api-subscription.nodes.json';
const SUPPORTED_PROTOCOL = /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i;
const MAX_NODES = 3000;
const MAX_TEMPLATE_LINES = 20;
const MAX_TEMPLATE_LINE_BYTES = 16 * 1024;
const MAX_STORED_BYTES = 20 * 1024 * 1024;

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json;charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
}

function requestHasSameOrigin(request) {
	const origin = request.headers.get('Origin');
	if (!origin) return false;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
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
	try {
		const parsed = new URL(`http://[${input}]/`);
		return Boolean(parsed.hostname);
	} catch {
		return false;
	}
}

function isDomain(value) {
	const input = String(value || '').toLowerCase();
	if (!input || input.length > 253 || isIPv4(input) || isIPv6(input)) return false;
	const labels = input.endsWith('.') ? input.slice(0, -1).split('.') : input.split('.');
	return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function normalizeEndpoint(payload) {
	const domain = String(payload && payload.domain || '').trim().toLowerCase().replace(/\.$/, '');
	const ip = String(payload && payload.ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
	if ((domain && ip) || (!domain && !ip)) throw new Error('请且仅请传入 domain 或 ip 参数');
	if (domain && !isDomain(domain)) throw new Error('domain 参数不是有效域名');
	if (ip && !isIPv4(ip) && !isIPv6(ip)) throw new Error('ip 参数不是有效的 IPv4 或 IPv6 地址');
	const port = Number(String(payload && payload.port || '').trim());
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port 参数必须是 1 到 65535 的整数');
	return { kind: domain ? 'domain' : 'ip', address: domain || ip, port };
}

function applyVariables(template, variables) {
	return String(template).replace(/\{\{(address|rawAddress|port|name|rawName|type)\}\}/g, (_match, key) => variables[key]);
}

export function normalizeGeneratedNodeSettings(payload = {}, previous = {}) {
	const tokenInput = String(payload.token ?? previous.token ?? '').trim();
	if (tokenInput && !/^[A-Za-z0-9_-]{16,128}$/.test(tokenInput)) {
		throw new Error('API Token 只能包含字母、数字、下划线或短横线，长度为 16–128 位');
	}
	const nodeTemplates = cleanLines(payload.nodeTemplate ?? previous.nodeTemplate ?? '');
	if (nodeTemplates.length > MAX_TEMPLATE_LINES) throw new Error(`节点模板不能超过 ${MAX_TEMPLATE_LINES} 行`);
	for (const [index, template] of nodeTemplates.entries()) {
		if (new TextEncoder().encode(template).length > MAX_TEMPLATE_LINE_BYTES) throw new Error(`节点模板第 ${index + 1} 行不能超过 16 KB`);
		if (!SUPPORTED_PROTOCOL.test(template)) throw new Error(`节点模板第 ${index + 1} 行不是支持的节点链接`);
		if (!/\{\{(?:address|rawAddress)\}\}/.test(template)) throw new Error(`节点模板第 ${index + 1} 行缺少 {{address}}`);
		if (!template.includes('{{port}}')) throw new Error(`节点模板第 ${index + 1} 行缺少 {{port}}`);
		if (!template.includes('{{name}}') && !template.includes('{{rawName}}')) throw new Error(`节点模板第 ${index + 1} 行缺少 {{name}}`);
	}
	const nameTemplate = String(payload.nameTemplate ?? previous.nameTemplate ?? 'CF-{{type}}-{{rawAddress}}:{{port}}')
		.trim().replace(/[\r\n\0]/g, '').slice(0, 160);
	if (!nameTemplate) throw new Error('请输入节点名称格式');
	if (!/\{\{(?:address|rawAddress)\}\}/.test(nameTemplate)) throw new Error('节点名称格式必须包含 {{rawAddress}} 或 {{address}}');
	return {
		token: tokenInput || createId(),
		nodeTemplate: nodeTemplates.join('\n'),
		nameTemplate,
		savedAt: String(previous.savedAt || '')
	};
}

export async function readGeneratedNodeSettings(kv, { ensureToken = false } = {}) {
	let parsed = {};
	try {
		const value = kv ? await kv.get(SETTINGS_KEY) : null;
		parsed = value ? JSON.parse(value) : {};
	} catch (error) {
		console.error('读取 API 订阅设置失败:', error);
	}
	const settings = normalizeGeneratedNodeSettings({}, parsed && typeof parsed === 'object' ? parsed : {});
	if (ensureToken && kv && (!parsed || parsed.token !== settings.token)) {
		await kv.put(SETTINGS_KEY, JSON.stringify(settings));
	}
	return settings;
}

function normalizeStoredNode(node) {
	if (!node || !/^[A-Za-z0-9_-]{12,64}$/.test(String(node.id || '')) || !SUPPORTED_PROTOCOL.test(String(node.content || ''))) return null;
	const kind = node.kind === 'domain' ? 'domain' : node.kind === 'ip' ? 'ip' : '';
	if (!kind) return null;
	const port = Number(node.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return {
		id: String(node.id),
		kind,
		address: String(node.address || '').slice(0, 253),
		port,
		name: String(node.name || '').slice(0, 240),
		content: String(node.content),
		createdAt: String(node.createdAt || '')
	};
}

export async function readGeneratedNodes(kv) {
	if (!kv) return [];
	try {
		const value = await kv.get(NODES_KEY);
		const parsed = value ? JSON.parse(value) : [];
		return Array.isArray(parsed) ? parsed.map(normalizeStoredNode).filter(Boolean) : [];
	} catch (error) {
		console.error('读取 API 订阅节点失败:', error);
		return [];
	}
}

export function generateNodesFromEndpoint(settings, payload, createdAt = new Date().toISOString()) {
	const endpoint = normalizeEndpoint(payload);
	const templates = cleanLines(settings.nodeTemplate);
	if (!templates.length) throw new Error('管理员尚未配置节点模板');
	const uriAddress = endpoint.kind === 'ip' && endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
	const type = endpoint.kind === 'domain' ? '域名' : 'IP';
	const baseVariables = {
		address: uriAddress,
		rawAddress: endpoint.address,
		port: String(endpoint.port),
		type,
		name: '',
		rawName: ''
	};
	const rawName = applyVariables(settings.nameTemplate, baseVariables).trim().slice(0, 240);
	if (!rawName) throw new Error('节点名称格式生成了空名称');
	const variables = { ...baseVariables, name: encodeURIComponent(rawName), rawName };
	return templates.map(template => ({
		id: createId(),
		...endpoint,
		name: rawName,
		content: applyVariables(template, variables),
		createdAt
	}));
}

export async function appendGeneratedNodes(kv, settings, payload) {
	const [existing, generated] = await Promise.all([
		readGeneratedNodes(kv),
		Promise.resolve(generateNodesFromEndpoint(settings, payload))
	]);
	const contents = new Set(existing.map(node => node.content));
	const added = generated.filter(node => !contents.has(node.content));
	if (existing.length + added.length > MAX_NODES) throw new Error(`API 订阅最多保存 ${MAX_NODES} 个节点`);
	const serialized = JSON.stringify([...existing, ...added]);
	if (new TextEncoder().encode(serialized).length > MAX_STORED_BYTES) throw new Error('API 订阅节点数据已达到 20 MB 上限，请删除部分节点后重试');
	if (added.length) await kv.put(NODES_KEY, serialized);
	return { added, duplicateCount: generated.length - added.length, total: existing.length + added.length };
}

export async function handlePublicNodeImport(request, env, url = new URL(request.url)) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse({ ok: false, message: 'Method Not Allowed' }, 405);
	try {
		const input = request.method === 'GET'
			? Object.fromEntries(url.searchParams)
			: (request.headers.get('Content-Type') || '').includes('application/json')
				? await request.json()
				: Object.fromEntries(await request.formData());
		const settings = await readGeneratedNodeSettings(env.KV);
		const token = String(input.token || request.headers.get('X-API-Token') || '');
		if (!settings.token || token !== settings.token) return jsonResponse({ ok: false, message: 'API Token 无效' }, 401);
		const result = await appendGeneratedNodes(env.KV, settings, input);
		return jsonResponse({
			ok: true,
			message: result.added.length ? `已追加 ${result.added.length} 个节点` : '节点已存在，未重复追加',
			added: result.added.length,
			duplicates: result.duplicateCount,
			total: result.total,
			nodes: result.added.map(node => ({ id: node.id, name: node.name, address: node.address, port: node.port }))
		}, result.added.length ? 201 : 200);
	} catch (error) {
		return jsonResponse({ ok: false, message: error.message || '追加节点失败' }, 400);
	}
}

export async function handleGeneratedNodesAPI(request, env, url = new URL(request.url)) {
	if (!env.KV) return jsonResponse({ ok: false, message: '请先绑定 KV 命名空间' }, 400);
	if (request.method === 'GET') {
		const [settings, nodes] = await Promise.all([
			readGeneratedNodeSettings(env.KV, { ensureToken: true }),
			readGeneratedNodes(env.KV)
		]);
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
	} catch (error) {
		return jsonResponse({ ok: false, message: error.message || '操作失败' }, 400);
	}
}
