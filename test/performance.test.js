import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { createSessionCookie } from '../src/worker/auth.js';
import { saveSettingsSections, readPersistedSettings } from '../src/worker/storage/settings.js';
import { saveMainRecord } from '../src/worker/storage/main.js';

const origin = 'https://performance.example.com';
const node = 'vless://id@local.example.com:443#Local';
async function fixture(kv = new MemoryKV()) {
	const env = { KV: kv, ADMIN_PASSWORD: 'password', TOKEN: 'original-token', API_SUBSCRIPTION_ENABLED: 'true', REQUESTLOG: '0' };
	const headers = { Cookie: (await createSessionCookie(env)).split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
	const request = (path, init = {}) => worker.fetch(new Request(origin + path, { headers, ...init }), env, { waitUntil() {} });
	return { env, headers, request };
}

test('immutable settings bodies are reused but latest keys and token revocations stay fresh', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	const { env, request } = await fixture(kv);
	await saveMainRecord(kv, node);
	await saveSettingsSections(kv, { subscriptionToken: 'first-token' }, 'entry');
	await saveSettingsSections(kv, { displayFormats: ['sub', 'b64'] }, 'clients');
	await saveSettingsSections(kv, { pageTitle: 'Title' }, 'display');
	let bodyReads = 0;
	kv.before = (op, key) => { if (op === 'get' && key.startsWith('NODE2LINK.v2.settings.')) bodyReads++; };
	const first = await readPersistedSettings(env);
	assert.equal(bodyReads, 3);
	first.displayFormats.push('clash');
	const second = await readPersistedSettings(env);
	assert.equal(bodyReads, 3);
	assert.deepEqual(second.displayFormats, ['sub', 'b64']);
	await saveSettingsSections(kv, { subscriptionToken: 'second-token' }, 'entry');
	assert.equal((await request('/first-token?base64', { headers: {} })).status, 303);
	assert.equal((await request('/second-token?base64', { headers: {} })).status, 200);
	assert.equal(bodyReads, 4);
	assert.equal((await readPersistedSettings({ KV: new MemoryKV() })).subscriptionToken, undefined);
});

test('a cached old settings record cannot hide a failed read of its replacement', async () => {
	const { env, request } = await fixture();
	await saveSettingsSections(env.KV, { subscriptionToken: 'first-token' }, 'entry');
	await readPersistedSettings(env);
	await saveSettingsSections(env.KV, { subscriptionToken: 'second-token' }, 'entry');
	env.KV.before = (op, key) => { if (op === 'get' && key.startsWith('NODE2LINK.v2.settings.')) throw new Error('outage'); };
	const response = await request('/first-token?base64', { headers: {} });
	assert.equal(response.status, 503);
	assert.match(response.headers.get('Server-Timing'), /settings;dur=[\d.]+/);
});

test('oversized immutable settings bodies are not retained in the small cache', async () => {
	const { env } = await fixture();
	await saveSettingsSections(env.KV, { browserIconURL: 'x'.repeat(65535) }, 'display');
	let reads = 0;
	env.KV.before = (op, key) => { if (op === 'get' && key.startsWith('NODE2LINK.v2.settings.')) reads++; };
	await readPersistedSettings(env);
	await readPersistedSettings(env);
	assert.equal(reads, 2);
});

test('independent management APIs skip site settings and still authenticate before storage', async () => {
	const { env, request } = await fixture();
	env.KV.before = () => { throw new Error('unexpected storage access'); };
	assert.equal((await request('/api/shares', { headers: {} })).status, 401);
	assert.equal((await request('/api/node-candidates', { headers: {} })).status, 401);
	env.KV.before = (op, key) => { if (key === 'NODE2LINK.settings.json' || key === 'NODE2LINK.identity.json' || key.startsWith('NODE2LINK.v2.settings.')) throw new Error('unrelated settings read'); };
	assert.equal((await request('/api/shares', { method: 'POST', body: JSON.stringify({ name: 'Fast share', content: node }) })).status, 201);
	assert.equal((await request('/api/shares')).status, 200);
	assert.equal((await request('/api/generated-nodes')).status, 200);
	assert.equal((await request('/api/node-candidates?source=local')).status, 200);
	assert.equal((await request('/api/logout', { method: 'POST' })).status, 303);
});

test('shares HTML does not load main or generated nodes before the picker opens', async () => {
	const { env, request } = await fixture();
	await saveMainRecord(env.KV, node);
	env.KV.before = (op, key) => {
		if (key.startsWith('NODE2LINK.v2.main.') || key.startsWith('NODE2LINK.v2.nodes.') || key.includes('api-subscription.nodes')) throw new Error('eager candidate read');
	};
	const response = await request('/shares');
	assert.equal(response.status, 200);
	assert.doesNotMatch(await response.text(), /local\.example\.com/);
});

test('local picker requests skip upstream; full requests retain local nodes on upstream failure', async () => {
	const { env, request } = await fixture();
	await saveMainRecord(env.KV, node + '\nhttps://upstream.example.com/private-token');
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => { calls++; return new Response('unavailable', { status: 503 }); };
	try {
		const local = await (await request('/api/node-candidates?source=local')).json();
		assert.equal(calls, 0);
		assert.equal(local.hasUpstream, true);
		assert.equal(local.nodes[0].content, node);
		const fullResponse = await request('/api/node-candidates');
		const full = await fullResponse.json();
		assert.equal(calls, 1);
		assert.equal(full.upstreamFailures, 1);
		assert.deepEqual(full.nodes, local.nodes);
		const timing = fullResponse.headers.get('Server-Timing');
		assert.match(timing, /candidates_read;dur=[\d.]+/);
		assert.match(timing, /upstream;dur=[\d.]+/);
		assert.doesNotMatch(timing, /private-token|example\.com/);
	} finally { globalThis.fetch = originalFetch; }
});
