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
	nameTemplate: 'CF-{{type}}-{{address}}:{{port}}',
	nodeTemplate: 'vless://uuid@{{address}}:{{port}}?security=tls#{{name}}'
});

function assertInlineScriptsParse(html) {
	for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]));
	}
}

test('address 域名会替换地址、端口和固定名称', () => {
	const [node] = generateNodesFromEndpoint(settings, { address: 'CDN.Example.COM.', port: '8443' }, '2026-01-01T00:00:00.000Z');
	assert.equal(node.kind, 'endpoint');
	assert.equal(node.addressType, 'domain');
	assert.equal(node.address, 'cdn.example.com');
	assert.equal(node.name, 'CF-域名-cdn.example.com:8443');
	assert.equal(node.content, 'vless://uuid@cdn.example.com:8443?security=tls#CF-%E5%9F%9F%E5%90%8D-cdn.example.com%3A8443');
});

test('统一 address 参数支持随机标准 HTTPS 端口和名称截取', () => {
	const slicedSettings = normalizeGeneratedNodeSettings({
		token: 'abcdefghijklmnop',
		nameTemplate: '{{address|split:.:0}}-{{address|slice:0:6}}-{{port}}',
		nodeTemplate: 'vless://uuid@{{address}}:{{port}}#{{name}}'
	});
	const [node] = generateNodesFromEndpoint(slicedSettings, { address: 'cfsaas.080112.xyz' });
	assert.ok([443, 2053, 2083, 2087, 2096, 8443].includes(node.port));
	assert.equal(node.name, `cfsaas-cfsaas-${node.port}`);
});

test('IPv6 address 在节点 authority 中自动加方括号，但名称保持原始地址', () => {
	const [node] = generateNodesFromEndpoint(settings, { address: '2606:4700:4700::1111', port: 443 });
	assert.equal(node.address, '2606:4700:4700::1111');
	assert.equal(node.name, 'CF-IP-2606:4700:4700::1111:443');
	assert.match(node.content, /@\[2606:4700:4700::1111\]:443/);
});

test('模板不再接受旧占位符', () => {
	assert.throws(() => normalizeGeneratedNodeSettings({
		token: 'abcdefghijklmnop',
		nameTemplate: '{{rawAddress}}',
		nodeTemplate: 'vless://uuid@{{rawAddress}}:{{port}}#{{rawName}}'
	}), /缺少 \{\{address\}\}/);
});

test('模板必须含地址、端口和名称占位符', () => {
	assert.throws(() => normalizeGeneratedNodeSettings({
		token: 'abcdefghijklmnop',
		nameTemplate: '{{address}}',
		nodeTemplate: 'vless://uuid@example.com:443#fixed'
	}), /缺少 \{\{address\}\}/);
});

test('重复调用不会重复追加，新增节点保留追加顺序', async () => {
	const kv = new MemoryKV();
	const first = await appendGeneratedNodes(kv, settings, { address: 'one.example.com', port: 443 });
	const duplicate = await appendGeneratedNodes(kv, settings, { address: 'one.example.com', port: 443 });
	const second = await appendGeneratedNodes(kv, settings, { address: '1.1.1.1', port: 2053 });
	const nodes = await readGeneratedNodes(kv);
	assert.equal(first.added.length, 1);
	assert.equal(duplicate.added.length, 0);
	assert.equal(duplicate.duplicateCount, 1);
	assert.equal(second.added.length, 1);
	assert.deepEqual(nodes.map(node => node.address), ['one.example.com', '1.1.1.1']);
});

test('公开导入接口要求正确 Token 且只接受 address 参数', async () => {
	const kv = new MemoryKV();
	await kv.put('NODE2LINK.api-subscription.settings.json', JSON.stringify(settings));
	const unauthorized = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=wrong&address=cdn.example.com&port=443'),
		{ KV: kv }
	);
	assert.equal(unauthorized.status, 401);

	const invalid = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=abcdefghijklmnop&domain=cdn.example.com&port=443'),
		{ KV: kv }
	);
	assert.equal(invalid.status, 400);
	assert.equal((await invalid.json()).message, '请传入 address 参数');

	const created = await handlePublicNodeImport(
		new Request('https://sub.example.com/api/import?token=abcdefghijklmnop&address=cdn.example.com&port=443'),
		{ KV: kv }
	);
	assert.equal(created.status, 201);
	assert.equal((await created.json()).added, 1);

	const rawNode = 'vless://raw-id@raw.example.com:443?security=tls&type=ws#原始节点';
	const direct = await handlePublicNodeImport(new Request('https://sub.example.com/api/import', {
		method: 'POST',
		headers: { 'X-API-Token': 'abcdefghijklmnop', 'Content-Type': 'text/plain;charset=UTF-8' },
		body: rawNode
	}), { KV: kv });
	assert.equal(direct.status, 201);
	assert.equal((await direct.json()).mode, 'direct');
	assert.ok((await readGeneratedNodes(kv)).some(node => node.content === rawNode));
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
	assert.match(apiPageHTML, /模板使用样例/);
	assert.match(apiPageHTML, /API 调用/);
	assert.match(apiPageHTML, /原始节点无需转码/);
	assert.doesNotMatch(apiPageHTML, /class="placeholder-help"/);
	assert.match(apiPageHTML, /\{\{address\}\}<\/code>域名、IPv4 或 IPv6/);
	assert.match(apiPageHTML, /\{\{port\}\}<\/code>API 传入的端口/);
	assert.match(apiPageHTML, /\{\{name\}\}<\/code>由名称格式生成/);
	assert.match(apiPageHTML, /\{\{type\}\}<\/code>根据 address 自动判断/);
	assert.match(apiPageHTML, /复制 URL/);
	assert.match(apiPageHTML, /复制命令/);
	assert.match(apiPageHTML, /address=\{\{address\}\}&amp;port=\{\{port\}\}|address=\{\{address\}\}&port=\{\{port\}\}/);
	assert.match(apiPageHTML, /--data-binary "\{\{node\}\}"/);
	assert.match(apiPageHTML, /id="directExample"/);
	assert.ok(apiPageHTML.indexOf('class="quick-api"') < apiPageHTML.indexOf('id="saveSettings"'));
	assert.doesNotMatch(apiPageHTML, /\{\{rawAddress/);
	assert.doesNotMatch(apiPageHTML, /\{\{rawName/);
	assertInlineScriptsParse(apiPageHTML);
	const saved = await dispatch('/api/generated-nodes', {
		method: 'PUT',
		headers: { ...authenticatedHeaders, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			token: initial.settings.token,
			nameTemplate: 'CF-{{type}}-{{address}}:{{port}}',
			nodeTemplate: 'vless://test-id@{{address}}:{{port}}?security=tls#{{name}}'
		})
	});
	assert.equal(saved.status, 200);

	const domainImport = await dispatch(`/api/import?token=${initial.settings.token}&address=edge.example.com&port=8443`);
	const ipImport = await dispatch(`/api/import?token=${initial.settings.token}&address=8.8.8.8&port=2053`);
	assert.equal(domainImport.status, 201);
	assert.equal(ipImport.status, 201);
	const replacementToken = 'qrstuvwxyzABCDEF';
	const rotated = await dispatch('/api/generated-nodes', {
		method: 'PUT',
		headers: { ...authenticatedHeaders, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			token: replacementToken,
			nameTemplate: 'CF-{{type}}-{{address}}:{{port}}',
			nodeTemplate: 'vless://test-id@{{address}}:{{port}}?security=tls#{{name}}'
		})
	});
	assert.equal(rotated.status, 200);
	assert.equal((await rotated.json()).settings.token, replacementToken);
	assert.equal((await dispatch(`/api/import?token=${initial.settings.token}&address=old-token.example.com&port=443`)).status, 401);
	assert.equal((await dispatch(`/api/import?token=${replacementToken}&address=edge.example.com&port=8443`)).status, 200);
	const candidates = await (await dispatch('/api/node-candidates', { headers: authenticatedHeaders })).json();
	assert.deepEqual(candidates.nodes.map(node => node.source), ['main', 'api', 'api']);
	assert.match(candidates.nodes[0].content, /manual\.example\.com:443/);

	const rootHTML = await (await dispatch('/', { headers: authenticatedHeaders })).text();
	const mainPath = rootHTML.match(/\/s\/[A-Za-z0-9_-]{12,64}/)?.[0];
	assert.ok(mainPath);
	const encoded = await (await dispatch(mainPath + '?base64')).text();
	const decoded = Buffer.from(encoded, 'base64').toString('utf8');
	assert.match(decoded, /manual\.example\.com:443/);
	assert.match(decoded, /edge\.example\.com:8443/);
	assert.match(decoded, /8\.8\.8\.8:2053/);
	assert.ok(decoded.indexOf('manual.example.com:443') < decoded.indexOf('edge.example.com:8443'));

	const directNode = 'vless://direct-id@direct.example.com:443?security=tls#Direct';
	const directImport = await dispatch(`/api/import?token=${replacementToken}&node=${encodeURIComponent(directNode)}`);
	assert.equal(directImport.status, 201);
	assert.equal((await directImport.json()).mode, 'direct');
	const decodedWithDirect = Buffer.from(await (await dispatch(mainPath + '?base64')).text(), 'base64').toString('utf8');
	assert.match(decodedWithDirect, /direct\.example\.com:443/);

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
	assert.equal(remaining.length, 2);
});

test('API 新增节点和主订阅保存都会排队发送 Telegram 通知', async () => {
	const origin = 'https://notify.example.com';
	const env = {
		KV: new MemoryKV(),
		ADMIN_USERNAME: 'admin',
		ADMIN_PASSWORD: 'test-password',
		SESSION_SECRET: 'test-session-secret',
		TGTOKEN: '123:abc',
		TGID: '456',
		REQUESTLOG: '0'
	};
	await env.KV.put('NODE2LINK.api-subscription.settings.json', JSON.stringify(settings));
	const telegramMessages = [];
	const pending = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async input => {
		const url = String(input);
		if (url.startsWith('https://api.telegram.org/')) {
			telegramMessages.push(new URL(url).searchParams.get('text'));
			return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
		}
		return originalFetch(input);
	};
	try {
		const ctx = { waitUntil(task) { pending.push(task); } };
		const imported = await worker.fetch(new Request(origin + '/api/import?token=abcdefghijklmnop&address=notify.example.com&port=443'), env, ctx);
		assert.equal(imported.status, 201);
		const login = await worker.fetch(new Request(origin + '/api/login', {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'admin', password: 'test-password' })
		}), env, ctx);
		const cookie = login.headers.get('Set-Cookie').split(';')[0];
		const saved = await worker.fetch(new Request(origin + '/', {
			method: 'POST',
			headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'text/plain;charset=UTF-8' },
			body: 'vless://saved@main.example.com:443#Saved'
		}), env, ctx);
		assert.equal(saved.status, 200);
		await Promise.all(pending);
		assert.ok(telegramMessages.some(message => message.includes('#API 追加节点')));
		assert.ok(telegramMessages.some(message => message.includes('#主订阅已修改')));
	} finally {
		globalThis.fetch = originalFetch;
	}
});
