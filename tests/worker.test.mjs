import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../dist/_worker.js';

class MemoryKV {
	constructor() {
		this.values = new Map();
		this.getCalls = [];
		this.listCalls = [];
	}

	async get(key) {
		this.getCalls.push(key);
		return this.values.has(key) ? this.values.get(key).value : null;
	}

	async put(key, value, options = {}) {
		this.values.set(key, { value: String(value), metadata: options.metadata });
	}

	async delete(key) {
		this.values.delete(key);
	}

	async list(options = {}) {
		this.listCalls.push(options);
		const prefix = options.prefix || '';
		const keys = [...this.values.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([name, entry]) => ({ name, metadata: entry.metadata }))
			.slice(0, options.limit || 1000);
		return { keys, list_complete: keys.length === [...this.values.keys()].filter(key => key.startsWith(prefix)).length, cursor: '' };
	}

	resetMetrics() {
		this.getCalls = [];
		this.listCalls = [];
	}
}

function createContext() {
	const pending = [];
	return {
		pending,
		waitUntil(task) {
			pending.push(Promise.resolve(task));
		}
	};
}

async function login(env) {
	const response = await worker.fetch(new Request('https://subscriptions.example/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://subscriptions.example' },
		body: JSON.stringify({ username: 'admin', password: env.ADMIN_PASSWORD })
	}), env, createContext());
	assert.equal(response.status, 303);
	return response.headers.get('Set-Cookie').split(';', 1)[0];
}

async function callShareAPI(env, cookie, method, body) {
	return worker.fetch(new Request('https://subscriptions.example/api/shares', {
		method,
		headers: {
			'Content-Type': 'application/json',
			Cookie: cookie,
			Origin: 'https://subscriptions.example'
		},
		body: JSON.stringify(body)
	}), env, createContext());
}

async function createShare(env, cookie) {
	const response = await callShareAPI(env, cookie, 'POST', {
		name: '测试分享',
		content: 'vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls#test'
	});
	assert.equal(response.status, 201);
	return (await response.json()).share;
}

function createEnv(overrides = {}) {
	return {
		KV: new MemoryKV(),
		ADMIN_PASSWORD: 'test-password',
		SESSION_SECRET: 'test-session-secret',
		REQUESTLOG: '0',
		...overrides
	};
}

function assertNoStoreResponse(response) {
	assert.equal(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate, max-age=0');
	assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
	assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
	assert.equal(response.headers.get('Pragma'), 'no-cache');
	assert.equal(response.headers.get('Expires'), '0');
}

test('重置分享链接后保留内容，并使旧链接失效', async () => {
	const env = createEnv();
	const cookie = await login(env);
	const original = await createShare(env, cookie);
	const resetResponse = await callShareAPI(env, cookie, 'PATCH', { id: original.id });

	assert.equal(resetResponse.status, 200);
	const reset = (await resetResponse.json()).share;
	assert.notEqual(reset.id, original.id);
	assert.equal(reset.name, original.name);
	assert.equal(reset.content, original.content);
	assert.equal(reset.createdAt, original.createdAt);

	const oldResponse = await worker.fetch(new Request(`https://subscriptions.example/s/${original.id}`), env, createContext());
	assert.equal(oldResponse.status, 404);

	const newResponse = await worker.fetch(new Request(`https://subscriptions.example/s/${reset.id}?base64`), env, createContext());
	assert.equal(newResponse.status, 200);
	assertNoStoreResponse(newResponse);
	assert.match(await newResponse.text(), /^[A-Za-z0-9+/]+=*$/);

	const pageResponse = await worker.fetch(
		new Request('https://subscriptions.example/shares', { headers: { Cookie: cookie } }),
		env,
		createContext()
	);
	const page = await pageResponse.text();
	assert.match(page, /重置链接/);
	assert.match(page, /call\('PATCH'/);
});

test('Telegram 订阅通知直接显示全部字段，但不包含入口', async () => {
	const env = createEnv({ TGTOKEN: 'test-bot-token', TGID: 'test-chat-id' });
	const cookie = await login(env);
	const share = await createShare(env, cookie);
	await env.KV.put(`NODE2LINK.share.${share.id}`, JSON.stringify({ ...share, name: '测试<&分享' }));
	const originalFetch = globalThis.fetch;
	let telegramText = '';

	globalThis.fetch = async input => {
		const url = new URL(String(input));
		if (url.hostname === 'ip-api.com') {
			return new Response(JSON.stringify({ country: '测试<国家&', city: '测试>城市', org: '测试&组织', as: 'AS<64512>' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		if (url.hostname === 'api.telegram.org') {
			telegramText = url.searchParams.get('text') || '';
			return new Response('ok');
		}
		throw new Error(`Unexpected fetch: ${url}`);
	};

	try {
		const ctx = createContext();
		const response = await worker.fetch(new Request(`https://subscriptions.example/s/${share.id}?base64`, {
			headers: { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'TestClient/1.0 <beta>&' }
		}), env, ctx);
		assert.equal(response.status, 200);
		await Promise.all(ctx.pending);
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.match(telegramText, /#获取订阅 测试&lt;&amp;分享/);
	assert.match(telegramText, /UA: TestClient\/1\.0 &lt;beta&gt;&amp;/);
	assert.match(telegramText, /域名: subscriptions\.example/);
	assert.match(telegramText, /国家: 测试&lt;国家&amp;/);
	assert.match(telegramText, /城市: 测试&gt;城市/);
	assert.match(telegramText, /组织: 测试&amp;组织/);
	assert.match(telegramText, /ASN: AS&lt;64512&gt;/);
	assert.doesNotMatch(telegramText, /入口:/);
	assert.doesNotMatch(telegramText, /tg-spoiler/);
	assert.doesNotMatch(telegramText, /<beta>/);
	assert.doesNotMatch(telegramText, new RegExp(share.id));
});

test('订阅转换请求和转换结果都禁止缓存', async () => {
	const env = createEnv({ SUBAPI: 'https://converter.example' });
	const cookie = await login(env);
	const share = await createShare(env, cookie);
	const originalFetch = globalThis.fetch;
	let converterInit;

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.hostname !== 'converter.example') throw new Error(`Unexpected fetch: ${url}`);
		converterInit = init;
		return new Response('proxies: []', { headers: { 'Content-Type': 'text/yaml' } });
	};

	let response;
	try {
		response = await worker.fetch(new Request(`https://subscriptions.example/s/${share.id}?clash`, {
			headers: { 'User-Agent': 'Clash/1.0' }
		}), env, createContext());
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.equal(response.status, 200);
	assert.equal(await response.text(), 'proxies: []');
	assertNoStoreResponse(response);
	assert.equal(converterInit.cache, 'no-store');
	const converterHeaders = new Headers(converterInit.headers);
	assert.equal(converterHeaders.get('Cache-Control'), 'no-store, no-cache, max-age=0');
	assert.equal(converterHeaders.get('Pragma'), 'no-cache');
});

test('分享摘要索引只读取一次，详情仅在编辑时按需加载', async () => {
	const env = createEnv();
	const cookie = await login(env);
	const ids = [];
	for (let index = 0; index < 100; index += 1) {
		const id = `share_${String(index).padStart(12, '0')}`;
		ids.push(id);
		await env.KV.put(`NODE2LINK.share.${id}`, JSON.stringify({
			id,
			name: `分享 ${index}`,
			content: `vless://00000000-0000-4000-8000-${String(index).padStart(12, '0')}@example.com:443?security=tls#test`,
			nodeCount: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		}));
	}
	await env.KV.put('NODE2LINK.shares.json', JSON.stringify(ids));

	// 第一次读取兼容旧 ID 索引，并自动写回摘要。
	let response = await worker.fetch(new Request('https://subscriptions.example/shares', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	const firstPage = await response.text();
	assert.doesNotMatch(firstPage, /@example\.com/);
	const migratedIndex = JSON.parse(await env.KV.get('NODE2LINK.shares.json'));
	assert.equal(typeof migratedIndex[0], 'string');
	assert.equal(typeof migratedIndex[100], 'object');
	assert.equal(migratedIndex.length, 200);

	env.KV.resetMetrics();
	response = await worker.fetch(new Request('https://subscriptions.example/shares', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.deepEqual(env.KV.getCalls.sort(), ['NODE2LINK.settings.json', 'NODE2LINK.shares.json'].sort());

	env.KV.resetMetrics();
	response = await worker.fetch(new Request(`https://subscriptions.example/api/shares?id=${ids[0]}`, {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.match((await response.json()).share.content, /^vless:\/\//);
	assert.deepEqual(env.KV.getCalls.sort(), [`NODE2LINK.share.${ids[0]}`, 'NODE2LINK.settings.json'].sort());

	env.KV.resetMetrics();
	response = await worker.fetch(new Request('https://subscriptions.example/requests', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.deepEqual(env.KV.getCalls.sort(), ['NODE2LINK.settings.json', 'NODE2LINK.shares.json'].sort());
	assert.equal(env.KV.listCalls.length, 1);
});

test('管理页面只引用项目自带的静态资源', async () => {
	const env = createEnv();
	const cookie = await login(env);
	await env.KV.put('LINK.txt', '');

	const homeResponse = await worker.fetch(new Request('https://subscriptions.example/', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.match(homeResponse.headers.get('Server-Timing') || '', /^app;dur=\d+$/);
	const home = await homeResponse.text();
	assert.match(home, /\/assets\/lucide\.js/);
	assert.match(home, /\/assets\/qrcode-loader\.js/);
	assert.doesNotMatch(home, /(?:unpkg\.com|cdn\.jsdelivr\.net)/);

	const sharesResponse = await worker.fetch(new Request('https://subscriptions.example/shares', {
		headers: { Cookie: cookie }
	}), env, createContext());
	const shares = await sharesResponse.text();
	assert.match(shares, /\/assets\/base\.css/);
	assert.match(shares, /\/assets\/qrcode\.min\.js/);
	assert.doesNotMatch(shares, /cdn\.jsdelivr\.net/);
});

test('首页只在新键缺失时读取并迁移旧 LINK 键', async () => {
	const env = createEnv();
	const cookie = await login(env);
	await env.KV.put('/LINK.txt', 'vless://legacy.example');

	env.KV.resetMetrics();
	let response = await worker.fetch(new Request('https://subscriptions.example/', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.equal(await env.KV.get('LINK.txt'), 'vless://legacy.example');
	assert.equal(await env.KV.get('/LINK.txt'), null);
	assert.ok(env.KV.getCalls.includes('/LINK.txt'));

	env.KV.resetMetrics();
	response = await worker.fetch(new Request('https://subscriptions.example/', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.deepEqual(env.KV.getCalls.sort(), ['LINK.txt', 'LINK.txt.meta.json', 'NODE2LINK.settings.json'].sort());
});

test('请求统计最多扫描最近 500 条事件', async () => {
	const env = createEnv({ REQUESTLOG: '1' });
	const cookie = await login(env);
	for (let index = 0; index < 600; index += 1) {
		await env.KV.put(`NODE2LINK.request.${String(index).padStart(4, '0')}`, '1', {
			metadata: {
				client: 'Clash',
				userAgent: 'Clash/1.0',
				format: 'clash',
				access: 'main',
				subscriptionId: '',
				requestedAt: new Date(2026, 0, 1, 0, 0, index).toISOString()
			}
		});
	}

	env.KV.resetMetrics();
	const response = await worker.fetch(new Request('https://subscriptions.example/requests', {
		headers: { Cookie: cookie }
	}), env, createContext());
	assert.equal(response.status, 200);
	assert.equal(env.KV.listCalls[0].limit, 500);
	assert.match(await response.text(), /记录较多，仅展示最近一部分/);
});
