const SUPPORTED_PROTOCOL = /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i;
const CLOUDFLARE_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
const MAX_TEMPLATE_LINES = 20;
const MAX_IMPORT_ITEMS = 100;
const MAX_TEMPLATE_LINE_BYTES = 16 * 1024;

export function createId() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function cleanLines(value) {
	return [...new Set(String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function cleanBatchValues(value) {
	const values = Array.isArray(value) ? value : [value];
	return values.flatMap(item => typeof item === 'string' ? cleanLines(item) : item === undefined || item === null ? [] : [item]);
}

export function isIPv4(value) {
	const parts = String(value).split('.');
	return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function isIPv6(value) {
	const input = String(value || '').replace(/^\[|\]$/g, '');
	if (!input.includes(':') || !/^[0-9a-f:]+$/i.test(input)) return false;
	try { return Boolean(new URL(`http://[${input}]/`).hostname); } catch { return false; }
}

export function isDomain(value) {
	const input = String(value || '').toLowerCase();
	if (!input || input.length > 253 || isIPv4(input) || isIPv6(input)) return false;
	const labels = input.endsWith('.') ? input.slice(0, -1).split('.') : input.split('.');
	return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function randomCloudflareHTTPSPort() {
	const random = new Uint32Array(1);
	crypto.getRandomValues(random);
	return CLOUDFLARE_HTTPS_PORTS[random[0] % CLOUDFLARE_HTTPS_PORTS.length];
}

export function normalizeEndpoint(payload) {
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

export function normalizeEndpoints(payload) {
	const input = payload?.addresses !== undefined ? payload.addresses : payload?.address;
	const addresses = cleanBatchValues(input);
	if (!addresses.length) throw new Error('请传入 address 参数');
	if (addresses.length > MAX_IMPORT_ITEMS) throw new Error(`一次最多导入 ${MAX_IMPORT_ITEMS} 个地址`);
	const ports = cleanBatchValues(payload?.port);
	if (ports.length > 1 && ports.length !== addresses.length) throw new Error('多个 port 参数必须与 address 参数数量一致');
	return addresses.map((item, index) => {
		const isObject = item && typeof item === 'object' && !Array.isArray(item);
		const address = isObject ? item.address : item;
		const port = isObject && Object.prototype.hasOwnProperty.call(item, 'port')
			? item.port
			: ports.length > 1 ? ports[index] : ports[0];
		try { return normalizeEndpoint({ address, port }); }
		catch (error) { throw new Error(addresses.length > 1 ? `第 ${index + 1} 个地址：${error.message}` : error.message); }
	});
}

export function applyFilter(value, filter) {
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

export function applyVariables(template, variables) {
	return String(template).replace(/\{\{(address|port|name|type)((?:\|[^{}|]+)*)\}\}/g, (_match, key, filters) => {
		let value = variables[key];
		for (const filter of String(filters || '').split('|').filter(Boolean)) value = applyFilter(value, filter);
		return value;
	});
}

export function hasVariable(template, names) {
	return new RegExp(`\\{\\{(?:${names.join('|')})(?:\\|[^{}|]+)*\\}\\}`).test(template);
}

export function normalizeGeneratedNodeSettings(payload = {}, previous = {}, { generateToken = true } = {}) {
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
	return { token: tokenInput || (generateToken ? createId() : ''), nodeTemplate: nodeTemplates.join('\n'), nameTemplate, savedAt: String(previous.savedAt || '') };
}

export function normalizeStoredNode(node) {
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

export function generateNodesForEndpoint(settings, endpoint, createdAt) {
	const templates = cleanLines(settings.nodeTemplate);
	if (!templates.length) throw new Error('管理员尚未配置节点模板');
	const uriAddress = endpoint.addressType === 'ip' && endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
	const nameVariables = { address: endpoint.address, port: String(endpoint.port), type: endpoint.addressType === 'domain' ? '域名' : 'IP', name: '' };
	const generatedName = applyVariables(settings.nameTemplate, nameVariables).trim().slice(0, 240);
	if (!generatedName) throw new Error('节点名称格式生成了空名称');
	const variables = { ...nameVariables, address: uriAddress, name: encodeURIComponent(generatedName) };
	return templates.map(template => ({ id: createId(), ...endpoint, name: generatedName, content: applyVariables(template, variables), createdAt }));
}

export function generateNodesFromEndpoints(settings, payload, createdAt = new Date().toISOString()) {
	return normalizeEndpoints(payload).flatMap(endpoint => generateNodesForEndpoint(settings, endpoint, createdAt));
}

export function directNodeName(content, index) {
	const hashIndex = content.lastIndexOf('#');
	if (hashIndex >= 0 && hashIndex < content.length - 1) {
		try { const decoded = decodeURIComponent(content.slice(hashIndex + 1)).trim(); if (decoded) return decoded.slice(0, 240); } catch {}
	}
	return `API 完整节点 ${index + 1}`;
}

export function directNodeEndpoint(content) {
	const match = content.match(/^[a-z0-9+.-]+:\/\/(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/?#\s]+)(?::(\d{1,5}))?/i);
	if (!match) return { address: '', port: null };
	const address = match[1].replace(/^\[|\]$/g, '');
	const port = match[2] ? Number(match[2]) : null;
	return { address: address.slice(0, 253), port: port && port <= 65535 ? port : null };
}

export function normalizeDirectNodes(payload, createdAt = new Date().toISOString()) {
	const value = payload && (payload.node ?? payload.nodes ?? payload.content);
	const lines = [...new Set(cleanBatchValues(value).map(line => String(line).trim()).filter(Boolean))];
	if (!lines.length) throw new Error('请传入完整节点参数 node');
	if (lines.length > MAX_IMPORT_ITEMS) throw new Error(`一次最多上传 ${MAX_IMPORT_ITEMS} 个完整节点`);
	return lines.map((content, index) => {
		if (new TextEncoder().encode(content).length > MAX_TEMPLATE_LINE_BYTES) throw new Error(`完整节点第 ${index + 1} 行不能超过 16 KB`);
		if (!SUPPORTED_PROTOCOL.test(content)) throw new Error(`完整节点第 ${index + 1} 行不是支持的节点链接`);
		return { id: createId(), kind: 'raw', addressType: '', ...directNodeEndpoint(content), name: directNodeName(content, index), content, createdAt };
	});
}
