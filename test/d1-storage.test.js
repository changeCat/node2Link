import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveSettingsSections, readPersistedSettings } from '../src/worker/storage/settings.js';
import { saveShare, readShare, listShareSummaries } from '../src/worker/storage/shares.js';
import { saveMainRecord, readMainRecord, readMainBackup } from '../src/worker/storage/main.js';
import { appendGeneratedNodes } from '../src/worker/services/generated-nodes.js';
import { readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { appendNodeBatch, deleteNodeRecord } from '../src/worker/storage/node-records.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { StorageError } from '../src/worker/storage/kv.js';

const node = name => `trojan://test@${name}.example.com:443#${name}`;
const share = (id, name = 'D1 share') => ({
	id, name, content: node(name), nodeCount: 1, sourceCount: 0,
	createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z'
});

function fixture(options) {
	const kvOps = [];
	const kv = new MemoryKV({ before(op, key) { kvOps.push([op, key]); } });
	const db = new MemoryD1(options);
	const env = withStorageBindings({ KV: kv, DB: db });
	return { kv, db, storage: env.KV, kvOps };
}

test('D1 schema initializes once and structured settings never touch KV', async () => {
	const { kv, db, storage, kvOps } = fixture();
	assert.equal((await readPersistedSettings({ KV: storage })).subscriptionToken, undefined);
	assert.equal(db.metrics.exec, 3);
	assert.equal(kvOps.length, 0);

	await saveSettingsSections(storage, {
		subscriptionToken: 'current-token',
		pageTitle: 'D1',
		displayFormats: ['sub'],
		savedAt: '2026-09-11T00:00:00.000Z'
	}, 'all');
	const settings = await readPersistedSettings({ KV: storage });
	assert.equal(settings.subscriptionToken, 'current-token');
	assert.equal(settings.pageTitle, 'D1');
	assert.equal(db.metrics.exec, 3);
});

test('D1 schema initialization recognizes Cloudflare errors with details in cause', async () => {
	class NestedMissingTableD1 extends MemoryD1 {
		assertInitialized() {
			if (!this.initialized) throw new Error('D1_ERROR', {
				cause: new Error('no such table: node2link_records')
			});
		}
	}
	const kv = new MemoryKV();
	const db = new NestedMissingTableD1();
	const { KV: storage } = withStorageBindings({ KV: kv, DB: db });
	assert.deepEqual(await readPersistedSettings({ KV: storage }), {});
	assert.equal(db.metrics.exec, 3);
});

test('D1 initialization failures retain their actionable storage message', async () => {
	const { storage } = fixture({ before(operation) {
		if (operation === 'exec') throw new Error('database unavailable');
	} });
	await assert.rejects(
		readPersistedSettings({ KV: storage }),
		error => error instanceof StorageError && error.message === 'D1 初始化失败，请确认 DB 绑定可用'
	);
});

test('ordinary shares stay entirely in D1 and reset atomically', async () => {
	const { kv, db, storage } = fixture({ initialized: true });
	const original = share('d1_original_share');
	const replacement = share('d1_replacement_share', 'Replacement');
	await saveShare(storage, original);
	assert.ok(db.records.has('shares.' + original.id));
	assert.equal([...kv.values.keys()].filter(key => key.startsWith('blob.share.')).length, 0);
	assert.equal((await readShare(storage, original.id)).content, original.content);

	let rejectBatch = true;
	db.before = operation => {
		if (operation === 'batch' && rejectBatch) throw new Error('transaction failed');
	};
	await assert.rejects(saveShare(storage, replacement, original.id), StorageError);
	assert.equal((await readShare(storage, original.id)).content, original.content);
	assert.equal(await readShare(storage, replacement.id), null);
	assert.deepEqual((await listShareSummaries(storage, { fresh: true })).map(item => item.id), [original.id]);

	rejectBatch = false;
	await saveShare(storage, replacement, original.id);
	assert.equal(await readShare(storage, original.id), null);
	assert.equal((await readShare(storage, replacement.id)).content, replacement.content);
	assert.deepEqual((await listShareSummaries(storage, { fresh: true })).map(item => item.id), [replacement.id]);
	assert.equal([...kv.values.keys()].filter(key => key.startsWith('blob.share.')).length, 0);
});

test('escaped share content spills to one exact KV key without changing the content limit', async () => {
	const { kv, db, storage } = fixture({ initialized: true });
	const item = share('d1_overflow_share');
	item.content = 'trojan://' + '\\'.repeat(900_000);
	await saveShare(storage, item);
	const blobs = [...kv.values.keys()].filter(key => key.startsWith('blob.share.'));
	assert.equal(blobs.length, 1);
	assert.equal((await readShare(storage, item.id)).content, item.content);
	assert.ok(new TextEncoder().encode(db.records.get('shares.' + item.id).value).length < 2_000_000);
});

test('node history is fetched by one indexed D1 range query without KV listing', async () => {
	const { db, storage, kvOps } = fixture({ initialized: true });
	for (let i = 0; i < 24; i++) await appendGeneratedNodes(storage, {}, { node: node('n' + i) });
	db.metrics.all = 0;
	kvOps.length = 0;
	assert.equal((await readGeneratedNodes(storage, { fresh: true })).length, 24);
	assert.equal(db.metrics.all, 1);
	assert.equal(db.nodes.size, 24);
	assert.equal([...db.records.keys()].some(key => key.startsWith('nodes.')), false);
	assert.equal(kvOps.length, 0);
	const first = (await readGeneratedNodes(storage, { fresh: true }))[0];
	await deleteNodeRecord(storage, first.id);
	assert.equal((await readGeneratedNodes(storage, { fresh: true })).length, 23);
	assert.equal(db.nodes.size, 23);
});

test('a 100-node import stays within one D1 batch and four parameter-safe statements', async () => {
	const { db, storage } = fixture({ initialized: true });
	const nodes = normalizeDirectNodes({ nodes: Array.from({ length: 100 }, (_, i) => node('batch' + i)) });
	await appendNodeBatch(storage, nodes);
	assert.equal(db.nodes.size, 100);
	assert.equal(db.metrics.batch, 1);
	assert.equal((await readGeneratedNodes(storage, { fresh: true })).length, 100);
});

test('large main bodies remain in KV and cleanup keeps current plus one backup', async () => {
	const { kv, db, storage } = fixture({ initialized: true });
	const body = 'a'.repeat(2 * 1024 * 1024 + 1);
	await saveMainRecord(storage, body + '1');
	await saveMainRecord(storage, body + '2');
	await saveMainRecord(storage, body + '3');
	assert.equal((await readMainRecord(storage)).content.at(-1), '3');
	assert.equal((await readMainBackup(storage)).content.at(-1), '2');
	assert.ok(db.records.has('main.head'));
	assert.equal([...kv.values.keys()].filter(key => key.startsWith('blob.main.')).length, 2);
	assert.ok([...db.records.values()].every(record => new TextEncoder().encode(record.value).length < 2 * 1024 * 1024));
});

test('D1 list honors metadata, TTL and cursor without reading values individually', async () => {
	const { storage, db } = fixture({ initialized: true });
	await storage.put('requests.b', '1', { metadata: { client: 'b' }, expiration: Math.floor(Date.now() / 1000) + 60 });
	await storage.put('requests.a', '1', { metadata: { client: 'a' }, expiration: Math.floor(Date.now() / 1000) - 1 });
	await storage.put('requests.c', '1', { metadata: { client: 'c' } });
	const first = await storage.list({ prefix: 'requests.', limit: 1 });
	assert.deepEqual(first.keys.map(key => key.name), ['requests.b']);
	assert.equal(first.list_complete, false);
	assert.deepEqual(first.keys[0].metadata, { client: 'b' });
	const second = await storage.list({ prefix: 'requests.', limit: 1, cursor: first.cursor });
	assert.deepEqual(second.keys.map(key => key.name), ['requests.c']);
	assert.equal(second.list_complete, true);
	assert.equal(db.records.has('requests.a'), false);
});
