import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { createRuntimeConfig } from '../src/worker/config.js';
import { queueSubscriptionRequestLog, readSubscriptionRequestStats } from '../src/worker/storage/request-logs.js';
import { renderRequestsPage } from '../src/worker/ui/pages.js';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { handleGeneratedNodesAPI } from '../src/worker/routes/generated-nodes.js';
import { saveSettings } from '../src/worker/routes/settings.js';

const node = 'trojan://test@node.example.com:443#Saved';
async function log(kv, status = 200) {
	const pending = [];
	queueSubscriptionRequestLog({ waitUntil(task) { pending.push(task); } }, { KV: kv }, { status, access: 'main' });
	await Promise.all(pending);
}

test('complete logging retains every successful and failed subscription request', async () => {
	const kv = new MemoryKV();
	await log(kv);
	await log(kv);
	await log(kv, 502);
	assert.equal(kv.values.size, 3);
	const stats = await readSubscriptionRequestStats(kv);
	assert.equal(stats.total, 3);
	assert.equal(stats.main.failed, 1);
	assert.equal(Object.hasOwn(stats, 'sampled'), false);
	const runtime = await createRuntimeConfig({});
	const html = await (await renderRequestsPage(null, { KV: kv }, runtime)).text();
	assert.doesNotMatch(html, /采样|关闭新请求记录/);
});

test('request statistics reuse short views, invalidate on writes and retry failed reads', async () => {
	let lists = 0;
	const kv = new MemoryKV({ before(op) { if (op === 'list') lists++; } });
	await log(kv);
	assert.equal((await readSubscriptionRequestStats(kv)).total, 1);
	assert.equal((await readSubscriptionRequestStats(kv)).total, 1);
	assert.equal(lists, 1);
	await log(kv);
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

test('removed logging settings are rejected without a storage write', async () => {
	const kv = new MemoryKV({ before() { throw new Error('unexpected storage'); } });
	const response = await saveSettings(new Request('https://example.com/api/settings', {
		method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'logging', requestLogMode: 'off' })
	}), { KV: kv }, {});
	assert.equal(response.status, 400);
	assert.match((await response.json()).message, /不存在/);
});

test('malformed/oversized Token candidates and cross-origin mutations avoid storage', async () => {
	const env = { KV: new MemoryKV({ before() { throw new Error('unexpected storage'); } }), DB: new MemoryD1(), ADMIN_PASSWORD: 'password' };
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
	kv.before = (op, key) => { if (op === 'list' && key === 'nodes.') lists++; };
	const remove = id => handleGeneratedNodesAPI(new Request('https://example.com/api/generated-nodes', {
		method: 'DELETE', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
	}), { KV: kv });
	assert.equal((await remove(nodes[0].id)).status, 200);
	assert.equal(lists, 1);
	const before = structuredClone(kv.values);
	assert.equal((await remove('missing')).status, 404);
	assert.deepEqual(kv.values, before);
});
