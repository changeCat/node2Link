import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../_worker.js';

class MemoryKV {
	constructor() {
		this.values = new Map();
	}

	async get(key) {
		return this.values.has(key) ? this.values.get(key).value : null;
	}

	async put(key, value, options = {}) {
		this.values.set(key, { value: String(value), metadata: options.metadata });
	}

	async delete(key) {
		this.values.delete(key);
	}

	async list(options = {}) {
		const prefix = options.prefix || '';
		const keys = [...this.values.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([name, entry]) => ({ name, metadata: entry.metadata }));
		return { keys, list_complete: true, cursor: '' };
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

test('Telegram 订阅通知保留 UA 和域名，但不包含入口', async () => {
	const env = createEnv({ TGTOKEN: 'test-bot-token', TGID: 'test-chat-id' });
	const cookie = await login(env);
	const share = await createShare(env, cookie);
	const originalFetch = globalThis.fetch;
	let telegramText = '';

	globalThis.fetch = async input => {
		const url = new URL(String(input));
		if (url.hostname === 'ip-api.com') {
			return new Response(JSON.stringify({ country: '测试国家', city: '测试城市', org: '测试组织', as: 'AS64512' }), {
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
			headers: { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'TestClient/1.0' }
		}), env, ctx);
		assert.equal(response.status, 200);
		await Promise.all(ctx.pending);
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.match(telegramText, /UA: TestClient\/1\.0/);
	assert.match(telegramText, /域名: subscriptions\.example/);
	assert.doesNotMatch(telegramText, /入口:/);
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
