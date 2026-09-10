import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { createSessionCookie, isAuthenticated, hmacBase64Url } from '../src/worker/auth.js';
import { saveShare, deleteShare, readShare, listShareSummaries } from '../src/worker/storage/shares.js';
import { initializeGeneratedNodeSettings, readGeneratedNodeSettings, saveGeneratedNodeSettings } from '../src/worker/storage/generated-nodes.js';
import { handleGeneratedNodesAPI, handlePublicNodeImport } from '../src/worker/routes/generated-nodes.js';
import { readBoundedBody, MAX_IMPORT_BODY_BYTES } from '../src/worker/request-body.js';
import worker from '../src/worker/app.js';

const credentials = { ADMIN_USERNAME: 'admin.with.dots', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'fixed-test-secret' };
const apiSettings = { token: 'abcdefghijklmnop', nameTemplate: '{{address}}', nodeTemplate: '' };
const node = 'vless://uuid@example.com:443#test';
const share = { id: 'original_share_id', name: 'original', content: node, nodeCount: 1 };
const apiKey = 'NODE2LINK.api-subscription.settings.json';

test('password, username and session-secret changes each invalidate existing sessions', async () => {
	const cookie = (await createSessionCookie(credentials)).split(';')[0];
	const request = new Request('https://example.com', { headers: { Cookie: cookie } });
	assert.equal(await isAuthenticated(request, credentials), true);
	for (const patch of [{ ADMIN_PASSWORD: 'changed' }, { ADMIN_USERNAME: 'changed' }, { SESSION_SECRET: 'changed' }, { ADMIN_PASSWORD: '' }]) {
		assert.equal(await isAuthenticated(request, { ...credentials, ...patch }), false);
	}
	const payload = credentials.ADMIN_USERNAME + '.' + (Math.floor(Date.now() / 1000) + 60);
	const oldSignature = await hmacBase64Url(payload, credentials.SESSION_SECRET);
	assert.equal(await isAuthenticated(new Request(request.url, { headers: { Cookie: 'node2link_session=' + payload + '.' + oldSignature } }), credentials), false);
});

for (const legacy of [false, true]) {
	for (const operation of ['delete', 'reset']) {
		test(`${legacy ? 'legacy' : 'journal'} share ${operation} dominates late stale edits`, async () => {
			const kv = new MemoryKV({ pageSize: 1 });
			if (legacy) await kv.put('NODE2LINK.share.' + share.id, JSON.stringify(share));
			else await saveShare(kv, share);
			const stale = await readShare(kv, share.id);
			await listShareSummaries(kv); // Warm the administrative index.
			if (operation === 'reset') await saveShare(kv, { ...share, id: 'replacement_share_id' }, share.id);
			else await deleteShare(kv, share.id);
			await saveShare(kv, { ...stale, name: 'late edit' });
			assert.equal(await readShare(kv, share.id), null);
			assert.ok(!(await listShareSummaries(kv)).some(item => item.id === share.id));
			if (operation === 'reset') assert.equal((await readShare(kv, 'replacement_share_id')).content, node);
		});
	}
}

test('administrative GET does not initialize API credentials', async () => {
	const kv = new MemoryKV();
	assert.equal((await readGeneratedNodeSettings(kv)).token, '');
	const response = await handleGeneratedNodesAPI(new Request('https://example.com/api/generated-nodes'), { KV: kv });
	assert.equal((await response.json()).settings.token, '');
	assert.equal(kv.values.size, 0);
});

test('unavailable API configuration does not prevent administrator login', async () => {
	const kv = new MemoryKV({ before(op, key) { if (op === 'get' && key === apiKey) throw new Error('API settings unavailable'); } });
	const env = { ...credentials, KV: kv, API_SUBSCRIPTION_ENABLED: 'true', REQUESTLOG: '0' };
	const response = await worker.fetch(new Request('https://example.com/api/login', {
		method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
		body: JSON.stringify({ username: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD })
	}), env, {});
	assert.equal(response.status, 303);
	assert.ok(response.headers.get('Set-Cookie'));
	assert.ok(![...kv.values.keys()].some(key => key.includes('api-subscription')));
});

test('concurrent first initialization returns one credential without hot-key writes', async () => {
	const writes = [];
	const kv = new MemoryKV({ before(op, key) { if (op === 'put') writes.push(key); } });
	const results = await Promise.all(Array.from({ length: 10 }, () => initializeGeneratedNodeSettings({ ...credentials, KV: kv })));
	assert.equal(new Set(results.map(item => item.token)).size, 1);
	assert.equal((await readGeneratedNodeSettings(kv)).token, results[0].token);
	assert.equal(new Set(writes).size, writes.length);
	assert.ok(!writes.includes(apiKey));
});

test('a late bootstrap write cannot undo a concurrent token rotation or template save', async () => {
	let resume, entered;
	const waiting = new Promise(resolve => { entered = resolve; });
	const barrier = new Promise(resolve => { resume = resolve; });
	const kv = new MemoryKV({ async before(op, key) {
		if (op === 'put' && key.startsWith('NODE2LINK.api-subscription.bootstrap.')) { entered(); await barrier; }
	} });
	const initialization = initializeGeneratedNodeSettings({ ...credentials, KV: kv });
	await waiting;
	await saveGeneratedNodeSettings(kv, apiSettings);
	resume();
	assert.equal((await initialization).token, apiSettings.token);
	assert.equal((await readGeneratedNodeSettings(kv)).token, apiSettings.token);
});

test('existing API credentials survive initialization and administrator credential changes', async () => {
	const kv = new MemoryKV();
	await saveGeneratedNodeSettings(kv, apiSettings);
	assert.equal((await initializeGeneratedNodeSettings({ ...credentials, ADMIN_PASSWORD: 'new', KV: kv })).token, apiSettings.token);
	assert.equal(kv.values.size, 1);
});

test('bootstrap mutation is protected by login and same-origin checks', async () => {
	const env = { ...credentials, KV: new MemoryKV(), API_SUBSCRIPTION_ENABLED: 'true', REQUESTLOG: '0' };
	const url = 'https://example.com/api/generated-nodes';
	const body = JSON.stringify({ action: 'initialize' });
	const anonymous = await worker.fetch(new Request(url, { method: 'POST', body }), env, {});
	assert.equal(anonymous.status, 401);
	const cookie = (await createSessionCookie(env)).split(';')[0];
	const crossOrigin = await worker.fetch(new Request(url, { method: 'POST', body, headers: { Cookie: cookie, Origin: 'https://other.example.com' } }), env, {});
	assert.equal(crossOrigin.status, 403);
	assert.equal(env.KV.values.size, 0);
});

test('invalid header token rejects and cancels an unconsumed request body', async () => {
	const kv = new MemoryKV();
	await saveGeneratedNodeSettings(kv, apiSettings);
	let pulled = false, cancelled = false;
	const stream = new ReadableStream({ pull() { pulled = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
	const request = new Request('https://example.com/api/import', { method: 'POST', duplex: 'half', body: stream, headers: { 'X-API-Token': 'invalid', 'Content-Type': 'application/json' } });
	assert.equal((await handlePublicNodeImport(request, { KV: kv })).status, 401);
	assert.equal(pulled, false);
	assert.equal(cancelled, true);
});

test('streaming body limit counts bytes without trusting Content-Length', async () => {
	let cancelled = false;
	const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(6)); }, cancel() { cancelled = true; } });
	await assert.rejects(readBoundedBody(new Request('https://example.com', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': '1' } }), 10), { status: 413 });
	assert.equal(cancelled, true);
	assert.equal((await readBoundedBody(new Request('https://example.com', { method: 'POST', body: '中文' }), 6)).length, 6);
});

test('oversized imports return 413 and publish no nodes', async () => {
	const kv = new MemoryKV();
	await saveGeneratedNodeSettings(kv, apiSettings);
	const request = new Request('https://example.com/api/import', { method: 'POST', body: node, headers: { 'X-API-Token': apiSettings.token, 'Content-Type': 'text/plain', 'Content-Length': String(MAX_IMPORT_BODY_BYTES + 1) } });
	assert.equal((await handlePublicNodeImport(request, { KV: kv })).status, 413);
	assert.equal(kv.values.size, 1);
});

test('stalled and aborted request bodies are cancelled without waiting indefinitely', async () => {
	let cancelled = false;
	const stream = new ReadableStream({ cancel() { cancelled = true; } });
	await assert.rejects(readBoundedBody(new Request('https://example.com', { method: 'POST', body: stream, duplex: 'half' }), 100, 15), { status: 408 });
	assert.equal(cancelled, true);
	const controller = new AbortController();
	const pending = readBoundedBody(new Request('https://example.com', { method: 'POST', body: new ReadableStream(), duplex: 'half', signal: controller.signal }));
	controller.abort();
	await assert.rejects(pending, { status: 400 });
});

test('bounded imports retain body-token JSON, URL-encoded and multipart compatibility', async () => {
	for (const type of ['json', 'urlencoded', 'multipart']) {
		const kv = new MemoryKV();
		await saveGeneratedNodeSettings(kv, apiSettings);
		let body, headers = {};
		if (type === 'json') { body = JSON.stringify({ token: apiSettings.token, node }); headers['Content-Type'] = 'application/json'; }
		else if (type === 'urlencoded') body = new URLSearchParams({ token: apiSettings.token, node });
		else { body = new FormData(); body.set('token', apiSettings.token); body.set('node', node); }
		assert.equal((await handlePublicNodeImport(new Request('https://example.com/api/import', { method: 'POST', body, headers }), { KV: kv })).status, 201, type);
	}
});
