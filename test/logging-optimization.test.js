import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { resolveRequestLogging, createRuntimeConfig } from '../src/worker/config.js';
import { queueSubscriptionRequestLog, readSubscriptionRequestStats } from '../src/worker/storage/request-logs.js';
import { createSessionCookie } from '../src/worker/auth.js';
import { readPersistedSettings, readPublicSubscriptionSettings } from '../src/worker/storage/settings.js';
import { renderRequestsPage } from '../src/worker/ui/pages.js';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { handleGeneratedNodesAPI } from '../src/worker/routes/generated-nodes.js';

const node = 'trojan://test@node.example.com:443#Saved';
async function log(kv, mode, status = 200) {
	const pending = [];
	queueSubscriptionRequestLog({ waitUntil(task) { pending.push(task); } }, { KV: kv }, { status, access: 'main' }, { requestLogMode: mode, requestLogSampleRate: 0.1 });
	await Promise.all(pending);
}

test('logging defaults to sampling and preserves explicit full/off legacy configuration', () => {
	assert.equal(resolveRequestLogging({}).requestLogMode, 'sample');
	assert.equal(resolveRequestLogging({}).requestLogSampleRate, 0.1);
	assert.equal(resolveRequestLogging({ REQUESTLOG: '1' }).requestLogMode, 'full');
	assert.equal(resolveRequestLogging({ REQUESTLOG: '0' }).requestLogEnabled, false);
	assert.equal(resolveRequestLogging({ REQUESTLOG: '0' }, { requestLogMode: 'full' }).requestLogMode, 'full');
	assert.equal(resolveRequestLogging({ REQUESTLOG_SAMPLE_RATE: 'bad' }).requestLogSampleRate, 0.1);
});

test('sampling reduces normal writes, always keeps failures and never removes old logs', async () => {
	const kv = new MemoryKV();
	const random = Math.random;
	let draw = 0;
	try {
		Math.random = () => ((draw++ % 10) + 0.5) / 10;
		for (let i = 0; i < 100; i++) await log(kv, 'sample');
		assert.equal(kv.values.size, 10);
		Math.random = () => 0.99;
		await log(kv, 'sample', 502);
		assert.equal(kv.values.size, 11);
		await log(kv, 'full');
		assert.equal(kv.values.size, 12);
		await log(kv, 'off', 502);
		assert.equal(kv.values.size, 12);
		const stats = await readSubscriptionRequestStats(kv);
		assert.equal(stats.total, 12);
		assert.equal(stats.sampled, true);
		assert.equal(stats.main.failed, 1);
		const runtime = await createRuntimeConfig({});
		assert.match(await (await renderRequestsPage(null, { KV: kv }, runtime)).text(), /10%/);
	} finally { Math.random = random; }
});

test('request statistics reuse short views, invalidate on writes and retry failed reads', async () => {
	let lists = 0;
	const kv = new MemoryKV({ before(op) { if (op === 'list') lists++; } });
	await log(kv, 'full');
	assert.equal((await readSubscriptionRequestStats(kv)).total, 1);
	assert.equal((await readSubscriptionRequestStats(kv)).total, 1);
	assert.equal(lists, 1);
	await log(kv, 'full');
	assert.equal((await readSubscriptionRequestStats(kv)).total, 2);
	assert.equal(lists, 2);
	const now = Date.now;
	try {
		Date.now = () => now() + 16_000;
		kv.before = () => { throw new Error('outage'); };
		assert.equal((await readSubscriptionRequestStats(kv)).unavailable, true);
		kv.before = undefined;
		assert.equal((await readSubscriptionRequestStats(kv)).total, 2);
	} finally { Date.now = now; }
});

test('logging settings save independently, validate input and are honored by public reads', async () => {
	const kv = new MemoryKV();
	const env = { KV: kv, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'secret' };
	const cookie = (await createSessionCookie(env)).split(';')[0];
	const save = payload => worker.fetch(new Request('https://example.com/api/settings', {
		method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
	}), env, {});
	assert.equal((await save({ section: 'entry', subscriptionToken: 'kept-token' })).status, 200);
	for (const mode of ['sample', 'full', 'off']) {
		assert.equal((await save({ section: 'logging', requestLogMode: mode, requestLogSampleRate: 0.25 })).status, 200);
		const settings = await readPersistedSettings(env);
		assert.equal(settings.subscriptionToken, 'kept-token');
		const runtime = await createRuntimeConfig(env, await readPublicSubscriptionSettings(env));
		assert.equal(runtime.requestLogMode, mode);
		assert.equal(runtime.requestLogSampleRate, 0.25);
	}
	const before = structuredClone(kv.values);
	for (const [mode, rate] of [['unknown', 0.1], ['sample', 0], ['sample', 1.1], ['sample', 'bad']]) {
		assert.equal((await save({ section: 'logging', requestLogMode: mode, requestLogSampleRate: rate })).status, 400);
	}
	assert.deepEqual(kv.values, before);
});

test('malformed/oversized Token candidates and cross-origin mutations avoid storage', async () => {
	const env = { KV: new MemoryKV({ before() { throw new Error('unexpected storage'); } }), ADMIN_PASSWORD: 'password' };
	for (const path of ['/%ZZ', '/' + 'x'.repeat(129), '/?token=', '/?token=%00']) {
		const response = await worker.fetch(new Request('https://example.com' + path), env, {});
		assert.ok([303, 404].includes(response.status));
	}
	const response = await worker.fetch(new Request('https://example.com/api/settings', { method: 'POST', headers: { Origin: 'https://other.example.com' }, body: '{}' }), env, {});
	assert.equal(response.status, 403);
});

test('API deletion scans node history only once and rejects missing IDs without writes', async () => {
	let lists = 0;
	const kv = new MemoryKV();
	const nodes = normalizeDirectNodes({ node });
	await appendNodeBatch(kv, nodes);
	kv.before = (op, key) => { if (op === 'list' && key === 'NODE2LINK.v3.nodes.') lists++; };
	const remove = id => handleGeneratedNodesAPI(new Request('https://example.com/api/generated-nodes', {
		method: 'DELETE', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
	}), { KV: kv });
	assert.equal((await remove(nodes[0].id)).status, 200);
	assert.equal(lists, 1);
	const before = structuredClone(kv.values);
	assert.equal((await remove('missing')).status, 404);
	assert.deepEqual(kv.values, before);
});
