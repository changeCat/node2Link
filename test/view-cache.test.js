import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedView, invalidateView } from '../src/worker/storage/view-cache.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { appendNodeBatch, deleteNodeRecord } from '../src/worker/storage/node-records.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';

test('administrative cache coalesces reads; authoritative reads bypass it', async () => {
	const kv = {};
	let calls = 0;
	const loader = async () => ++calls;
	assert.deepEqual(await Promise.all([cachedView(kv, 'view', loader, { fresh: false }), cachedView(kv, 'view', loader, { fresh: false })]), [1, 1]);
	assert.equal(await cachedView(kv, 'view', loader), 2);
	invalidateView(kv, 'view');
	assert.equal(await cachedView(kv, 'view', loader, { fresh: false }), 3);
});

test('invalidation prevents an in-flight stale result from repopulating the cache', async () => {
	const kv = {};
	let resume;
	const pending = cachedView(kv, 'view', () => new Promise(resolve => { resume = resolve; }), { fresh: false });
	await Promise.resolve();
	invalidateView(kv, 'view');
	resume('stale');
	await pending;
	assert.equal(await cachedView(kv, 'view', async () => 'new', { fresh: false }), 'new');
});

test('expired, failed and oversized views are not reused', async () => {
	const kv = {};
	await assert.rejects(cachedView(kv, 'view', async () => { throw new Error('offline'); }, { fresh: false }));
	let calls = 0;
	const loader = async () => ++calls;
	for (let i = 0; i < 2; i++) await cachedView(kv, 'view', loader, { fresh: false, cacheable: () => false });
	assert.equal(calls, 2);
	await cachedView(kv, 'view', loader, { fresh: false });
	const now = Date.now;
	try { Date.now = () => now() + 2100; assert.equal(await cachedView(kv, 'view', loader, { fresh: false }), 4); }
	finally { Date.now = now; }
});

test('node mutations invalidate warmed indexes and authoritative reads never reuse stale keys', async () => {
	let lists = 0;
	const kv = new MemoryKV({ before(op) { if (op === 'list') lists++; } });
	const nodes = normalizeDirectNodes({ node: 'vless://uuid@example.com:443#one' });
	await appendNodeBatch(kv, nodes);
	await readGeneratedNodes(kv, { fresh: false });
	await readGeneratedNodes(kv, { fresh: false });
	assert.equal(lists, 1);
	await readGeneratedNodes(kv);
	assert.equal(lists, 2);
	await deleteNodeRecord(kv, nodes[0].id);
	assert.deepEqual(await readGeneratedNodes(kv, { fresh: false }), []);
});
