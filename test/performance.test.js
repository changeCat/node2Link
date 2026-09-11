import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { createSessionCookie } from '../src/worker/auth.js';
import { saveSettingsSections, readPersistedSettings } from '../src/worker/storage/settings.js';
import { saveMainRecord } from '../src/worker/storage/main.js';

const origin = 'https://performance.example.com';
const node = 'vless://id@local.example.com:443#Local';

async function fixture() {
	const kv = new MemoryKV();
	const db = new MemoryD1();
	const env = { KV: kv, DB: db, ADMIN_PASSWORD: 'password', TOKEN: 'original-token', API_SUBSCRIPTION_ENABLED: 'true' };
	const storage = withStorageBindings(env).KV;
	const headers = { Cookie: (await createSessionCookie(env)).split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
	const request = (path, init = {}) => worker.fetch(new Request(origin + path, { headers, ...init }), env, { waitUntil() {} });
	return { kv, db, env, storage, headers, request };
}

test('settings use batched D1 reads and never touch KV', async () => {
	const { kv, db, env, storage, request } = await fixture();
	await saveMainRecord(storage, node);
	await saveSettingsSections(storage, { subscriptionToken: 'first-token' }, 'entry');
	await saveSettingsSections(storage, { displayFormats: ['sub', 'b64'] }, 'clients');
	await saveSettingsSections(storage, { pageTitle: 'Title' }, 'display');
	kv.before = () => { throw new Error('settings must not touch KV'); };
	db.metrics.first = 0;
	db.metrics.all = 0;
	const first = await readPersistedSettings({ ...env, KV: storage });
	first.displayFormats.push('clash');
	const second = await readPersistedSettings({ ...env, KV: storage });
	assert.deepEqual(second.displayFormats, ['sub', 'b64']);
	assert.equal(db.metrics.first, 2);
	assert.equal(db.metrics.all, 2);
	await saveSettingsSections(storage, { subscriptionToken: 'second-token' }, 'entry');
	kv.before = undefined;
	assert.equal((await request('/first-token?base64', { headers: {} })).status, 303);
	assert.equal((await request('/second-token?base64', { headers: {} })).status, 200);
});

test('independent management APIs authenticate before storage and skip site settings', async () => {
	const { db, request } = await fixture();
	let operations = 0;
	db.before = () => { operations++; };
	assert.equal((await request('/api/shares', { headers: {} })).status, 401);
	assert.equal((await request('/api/node-candidates', { headers: {} })).status, 401);
	assert.equal(operations, 0);
	db.before = (_operation, _sql, params) => {
		if (params.some(value => value === 'identity' || String(value).startsWith('settings.'))) throw new Error('unrelated site settings read');
	};
	assert.equal((await request('/api/shares', { method: 'POST', body: JSON.stringify({ name: 'Fast share', content: node }) })).status, 201);
	assert.equal((await request('/api/shares')).status, 200);
	assert.equal((await request('/api/generated-nodes')).status, 200);
	assert.equal((await request('/api/node-candidates?source=local')).status, 200);
	assert.equal((await request('/api/logout', { method: 'POST' })).status, 303);
});

test('shares page does not load main bodies or generated nodes before the picker opens', async () => {
	const { kv, db, storage, request } = await fixture();
	await saveMainRecord(storage, node);
	kv.before = () => { throw new Error('eager main body read'); };
	db.before = (_operation, sql) => { if (sql.includes('node2link_nodes')) throw new Error('eager node read'); };
	const response = await request('/shares');
	assert.equal(response.status, 200);
	assert.doesNotMatch(await response.text(), /local\.example\.com/);
});

test('local picker skips upstream and full picker retains local nodes on upstream failure', async () => {
	const { storage, request } = await fixture();
	await saveMainRecord(storage, node + '\nhttps://upstream.example.com/private-token');
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
