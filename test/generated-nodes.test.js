import test from 'node:test';
import assert from 'node:assert/strict';

import {
	appendGeneratedNodes,
	generateNodesFromEndpoint,
	handlePublicNodeImport,
	normalizeGeneratedNodeSettings,
	readGeneratedNodes
} from '../src/worker/storage/generated-nodes.js';
import worker from '../src/worker/app.js';

class MemoryKV {
	constructor() { this.values = new Map(); }
	async get(key) { return this.values.has(key) ? this.values.get(key) : null; }
	async put(key, value) { this.values.set(key, String(value)); }
	async delete(key) { this.values.delete(key); }
	async list(options = {}) {
		const prefix = options.prefix || '';
		return { keys: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: '' };
	}
}

const settings = normalizeGeneratedNodeSettings({
	token: 'abcdefghijklmnop',
	nameTemplate: 'CF-{{type}}-{{rawAddress}}:{{port}}',
	nodeTemplate: 'vless://uuid@{{address}}:{{port}}?security=tls#{{name}}'
});

function assertInlineScriptsParse(html) {
	for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]));
	}
}

test('域名参数会替换地址、端口和固定名称', () => {
	const [node] = generateNodesFromEndpoint(settings, { domain: 'CDN.Example.COM.', port: '8443' }, '2026-01-01T00:00:00.000Z');
	assert.equal(node.kind, 'domain');
	assert.equal(node.address, 'cdn.example.com');
	assert.equal(node.name, 'CF-域名-cdn.example.com:8443');
	assert.equal(node.content, 'vless://uuid@cdn.example.com:8443?security=tls#CF-%E5%9F%9F%E5%90%8D-cdn.example.com%3A8443');
});

test('IPv6 地址在节点 authority 中自动加方括号', () => {
	const [node] = generateNodesFromEndpoint(settings, { ip: '2606:4700:4700::1111', port: 443 });
	assert.equal(node.address, '2606:4700:4700::1111');
	assert.match(node.content, /@\[2606:4700:4700::1111\]:443/);
});

test('模板必须含地址、端口和名称占位符', () => {
	assert.throws(() => normalizeGeneratedNodeSettings({
		token: 'abcdefghijklmnop',
		nameTemplate: '{{rawAddress}}',
		nodeTemplate: 'vless://uuid@example.com:443#fixed'
	}), /缺少 \{\{address\}\}/);
});

test('重复调用不会重复追加，新增节点保留追加顺序', async () => {
	const kv = new MemoryKV();
	const first = await appendGeneratedNodes(kv, settings, { domain: 'one.example.com', port: 443 });
	const duplicate = await appendGeneratedNodes(kv, settings, { domain: 'one.example.com', port: 443 });
	const second = await appendGeneratedNodes(kv, settings, { ip: '1.1.1.1', port: 2053 });
	const nodes = await readGeneratedNodes(kv);
	assert.equal(first.added.length, 1);
	assert.equal(duplicate.added.length, 0);
	assert.equal(duplicate.duplicateCount, 1);
	assert.equal(second.added.length, 1);
	assert.deepEqual(nodes.map(node => node.address), ['one.example.com', '1.1.1.1']);
});

test('公开导入接口要求正确 Token 且只接受 domain 或 ip 二选一', async () => {
	const kv = new MemoryKV();
	await kv.put('NODE2LINK.api-subscription.settings.json', JSON.stringify(settings));
	const unauthorized = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=wrong&domain=cdn.example.com&port=443'),
		{ KV: kv }
	);
	assert.equal(unauthorized.status, 401);

	const invalid = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=abcdefghijklmnop&domain=cdn.example.com&ip=1.1.1.1&port=443'),
		{ KV: kv }
	);
	assert.equal(invalid.status, 400);

	const created = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=abcdefghijklmnop&domain=cdn.example.com&port=443'),
		{ KV: kv }
	);
	assert.equal(created.status, 201);
	assert.equal((await created.json()).added, 1);
});

test('登录后的模板配置、公开追加、主订阅隔离、分享候选和删除形成完整链路', async () => {
	const origin = 'https://sub.example.com';
	const env = {
		KV: new MemoryKV(),
		ADMIN_USERNAME: 'admin',
		ADMIN_PASSWORD: 'test-password',
		SESSION_SECRET: 'test-session-secret',
		REQUESTLOG: '0'
	};
	await env.KV.put('LINK.txt', 'vless://manual-id@manual.example.com:443#Manual');
	const ctx = { waitUntil() {} };
	const dispatch = (path, init = {}) => worker.fetch(new Request(origin + path, init), env, ctx);
	const login = await dispatch('/api/login', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'admin', password: 'test-password' })
	});
	assert.equal(login.status, 303);
	const cookie = login.headers.get('Set-Cookie').split(';')[0];
	const authenticatedHeaders = { Cookie: cookie };

	const initial = await (await dispatch('/api/generated-nodes', { headers: authenticatedHeaders })).json();
	const apiPageHTML = await (await dispatch('/api-subscriptions', { headers: authenticatedHeaders })).text();
	assert.match(apiPageHTML, /API 订阅/);
	assertInlineScriptsParse(apiPageHTML);
	const saved = await dispatch('/api/generated-nodes', {
		method: 'PUT',
		headers: { ...authenticatedHeaders, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			token: initial.settings.token,
			nameTemplate: 'CF-{{type}}-{{rawAddress}}:{{port}}',
			nodeTemplate: 'vless://test-id@{{address}}:{{port}}?security=tls#{{name}}'
		})
	});
	assert.equal(saved.status, 200);

	const domainImport = await dispatch(`/api/import?token=${initial.settings.token}&domain=edge.example.com&port=8443`);
	const ipImport = await dispatch(`/api/import?token=${initial.settings.token}&ip=8.8.8.8&port=2053`);
	assert.equal(domainImport.status, 201);
	assert.equal(ipImport.status, 201);
	const replacementToken = 'qrstuvwxyzABCDEF';
	const rotated = await dispatch('/api/generated-nodes', {
		method: 'PUT',
		headers: { ...authenticatedHeaders, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			token: replacementToken,
			nameTemplate: 'CF-{{type}}-{{rawAddress}}:{{port}}',
			nodeTemplate: 'vless://test-id@{{address}}:{{port}}?security=tls#{{name}}'
		})
	});
	assert.equal(rotated.status, 200);
	assert.equal((await rotated.json()).settings.token, replacementToken);
	assert.equal((await dispatch(`/api/import?token=${initial.settings.token}&domain=old-token.example.com&port=443`)).status, 401);
	assert.equal((await dispatch(`/api/import?token=${replacementToken}&domain=edge.example.com&port=8443`)).status, 200);
	const candidates = await (await dispatch('/api/node-candidates', { headers: authenticatedHeaders })).json();
	assert.deepEqual(candidates.nodes.map(node => node.source), ['main', 'api', 'api']);
	assert.match(candidates.nodes[0].content, /manual\.example\.com:443/);

	const rootHTML = await (await dispatch('/', { headers: authenticatedHeaders })).text();
	const mainPath = rootHTML.match(/\/s\/[A-Za-z0-9_-]{12,64}/)?.[0];
	assert.ok(mainPath);
	const encoded = await (await dispatch(mainPath + '?base64')).text();
	const decoded = Buffer.from(encoded, 'base64').toString('utf8');
	assert.match(decoded, /manual\.example\.com:443/);
	assert.doesNotMatch(decoded, /edge\.example\.com:8443/);
	assert.doesNotMatch(decoded, /8\.8\.8\.8:2053/);

	const shareHTML = await (await dispatch('/shares', { headers: authenticatedHeaders })).text();
	assert.match(shareHTML, /从已有节点选择/);
	assert.match(shareHTML, /CF-IP-8\.8\.8\.8:2053/);
	assertInlineScriptsParse(shareHTML);

	const nodes = (await (await dispatch('/api/generated-nodes', { headers: authenticatedHeaders })).json()).nodes;
	const deleted = await dispatch('/api/generated-nodes', {
		method: 'DELETE',
		headers: { ...authenticatedHeaders, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({ id: nodes[0].id })
	});
	assert.equal(deleted.status, 200);
	const remaining = (await (await dispatch('/api/generated-nodes', { headers: authenticatedHeaders })).json()).nodes;
	assert.equal(remaining.length, 1);
});
