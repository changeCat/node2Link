import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { StorageError, listKeys } from '../src/worker/storage/kv.js';
import { readGeneratedNodes, readGeneratedNodeSettings } from '../src/worker/storage/generated-nodes.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { appendGeneratedNodes } from '../src/worker/services/generated-nodes.js';
import { deleteNodeRecord } from '../src/worker/storage/node-records.js';
import { createShareId, saveShare, readShare, listShareSummaries, deleteShare } from '../src/worker/storage/shares.js';
import { readPersistedSettings, saveSettingsSections } from '../src/worker/storage/settings.js';
import { readMainRecord, readMainBackup, saveMainRecord } from '../src/worker/storage/main.js';

const node = name => `trojan://test@${name}.example.com:443#${name}`;
const envFor = kv => ({ KV: kv, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'independent-secret', REQUESTLOG: '0' });
const share = name => ({ id: createShareId(), name, content: node(name), nodeCount: 1, sourceCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

test('concurrent batches survive stale reads without overwriting unrelated nodes', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	const results = await Promise.all(['a', 'b', 'c'].map(name => appendGeneratedNodes(kv, {}, { node: node(name) })));
	assert.deepEqual(results.map(result => result.added.length), [1, 1, 1]);
	assert.deepEqual(new Set((await readGeneratedNodes(kv)).map(item => item.name)), new Set(['a', 'b', 'c']));
});

test('deleting a deduplicated node removes all visible concurrent duplicates', async () => {
	const kv = new MemoryKV();
	await Promise.all([appendGeneratedNodes(kv, {}, { node: node('same') }), appendGeneratedNodes(kv, {}, { node: node('same') })]);
	const nodes = await readGeneratedNodes(kv);
	assert.equal(nodes.length, 1);
	await deleteNodeRecord(kv, nodes[0].id);
	assert.deepEqual(await readGeneratedNodes(kv), []);
});

test('stale or missing derived snapshots replay every unpublished mutation', async () => {
	const kv = new MemoryKV();
	await Promise.all(Array.from({ length: 16 }, (_, i) => appendGeneratedNodes(kv, {}, { node: node('n' + i) })));
	assert.equal((await readGeneratedNodes(kv)).length, 16);
	const oldCache = await kv.get('NODE2LINK.cache.nodes.v2');
	assert.ok(oldCache);
	await Promise.all(Array.from({ length: 16 }, (_, i) => appendGeneratedNodes(kv, {}, { node: node('m' + i) })));
	assert.equal((await readGeneratedNodes(kv)).length, 32);
	await kv.put('NODE2LINK.cache.nodes.v2', oldCache);
	assert.equal((await readGeneratedNodes(kv)).length, 32);
	await kv.put('NODE2LINK.cache.nodes.v2', '{broken');
	assert.equal((await readGeneratedNodes(kv)).length, 32);
});

test('failed node reads and corrupt JSON cannot replace existing data', async () => {
	const kv = new MemoryKV();
	await appendGeneratedNodes(kv, {}, { node: node('existing') });
	const before = structuredClone(kv.values);
	kv.before = operation => { if (operation === 'get') throw new Error('outage'); };
	await assert.rejects(appendGeneratedNodes(kv, {}, { node: node('new') }), StorageError);
	assert.deepEqual(kv.values, before);
	kv.before = undefined;
	await kv.put('NODE2LINK.api-subscription.nodes.json', '{broken');
	const corrupt = structuredClone(kv.values);
	await assert.rejects(appendGeneratedNodes(kv, {}, { node: node('new') }), StorageError);
	assert.deepEqual(kv.values, corrupt);
});

test('legacy nodes remain readable and deletable alongside concurrent additions', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	const legacy = normalizeDirectNodes({ node: node('legacy') });
	await kv.put('NODE2LINK.api-subscription.nodes.json', JSON.stringify(legacy));
	await Promise.all([deleteNodeRecord(kv, legacy[0].id), appendGeneratedNodes(kv, {}, { node: node('new') })]);
	assert.deepEqual((await readGeneratedNodes(kv)).map(item => item.name), ['new']);
	await appendGeneratedNodes(kv, {}, { node: node('legacy') });
	assert.deepEqual((await readGeneratedNodes(kv)).map(item => item.name), ['new', 'legacy']);
	assert.equal(JSON.parse(await kv.get('NODE2LINK.api-subscription.nodes.json'))[0].id, legacy[0].id);
});

test('rejected batch publication leaves the entire existing batch untouched', async () => {
	const kv = new MemoryKV();
	await appendGeneratedNodes(kv, {}, { node: node('existing') });
	kv.before = operation => { if (operation === 'put') throw new Error('write failed'); };
	await assert.rejects(appendGeneratedNodes(kv, {}, { nodes: [node('a'), node('b')] }), StorageError);
	assert.deepEqual((await readGeneratedNodes(kv)).map(item => item.name), ['existing']);
});

test('login-page read outages do not change settings or initialize identities', async () => {
	const kv = new MemoryKV();
	await kv.put('NODE2LINK.settings.json', JSON.stringify({ mainSubscriptionId: 'abcdefghijklmnop', subscriptionName: 'Existing' }));
	const before = structuredClone(kv.values);
	kv.before = operation => { if (operation === 'get') throw new Error('outage'); };
	const response = await worker.fetch(new Request('https://example.com/login'), envFor(kv), {});
	assert.equal(response.status, 503);
	assert.deepEqual(kv.values, before);
});

test('ordinary GET initialization is read-only; concurrent logins preserve one identity', async () => {
	const kv = new MemoryKV();
	const env = envFor(kv);
	const get = await worker.fetch(new Request('https://example.com/login'), env, {});
	assert.equal(get.status, 200);
	assert.equal(kv.values.size, 0);
	const login = () => worker.fetch(new Request('https://example.com/api/login', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'password' }) }), env, {});
	assert.deepEqual((await Promise.all([login(), login()])).map(response => response.status), [303, 303]);
	const identity = (await readPersistedSettings(env)).mainSubscriptionId;
	assert.match(identity, /^[A-Za-z0-9_-]{12,64}$/);
	assert.equal((await readPersistedSettings({ ...env, SESSION_SECRET: 'rotated' })).mainSubscriptionId, identity);
});

test('concurrent saves of independent setting sections retain both changes', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	await kv.put('NODE2LINK.settings.json', JSON.stringify({ subscriptionName: 'Old', subscriptionToken: 'old', mainSubscriptionId: 'abcdefghijklmnop' }));
	await Promise.all([
		saveSettingsSections(kv, { subscriptionName: 'New', pageTitle: 'Title', browserIconURL: '', savedAt: '2026-01-01' }, 'display'),
		saveSettingsSections(kv, { subscriptionToken: 'new', savedAt: '2026-01-02' }, 'entry')
	]);
	const settings = await readPersistedSettings({ KV: kv });
	assert.equal(settings.subscriptionName, 'New');
	assert.equal(settings.subscriptionToken, 'new');
	assert.equal(settings.mainSubscriptionId, 'abcdefghijklmnop');
});

test('failed API settings reads cannot rotate the token', async () => {
	const kv = new MemoryKV();
	await kv.put('NODE2LINK.api-subscription.settings.json', JSON.stringify({ token: 'abcdefghijklmnop' }));
	const before = structuredClone(kv.values);
	kv.before = operation => { if (operation === 'get') throw new Error('outage'); };
	await assert.rejects(readGeneratedNodeSettings(kv, { ensureToken: true }), StorageError);
	assert.deepEqual(kv.values, before);
});

test('concurrent shares retain both summaries; reset publication is atomic', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	const a = share('a'), b = share('b');
	await Promise.all([saveShare(kv, a), saveShare(kv, b)]);
	assert.equal((await listShareSummaries(kv)).length, 2);
	const reset = { ...a, id: createShareId() };
	kv.before = operation => { if (operation === 'put') throw new Error('outage'); };
	await assert.rejects(saveShare(kv, reset, a.id), StorageError);
	assert.equal((await readShare(kv, a.id)).content, a.content);
	assert.equal(await readShare(kv, reset.id), null);
	kv.before = undefined;
	await saveShare(kv, reset, a.id);
	assert.equal(await readShare(kv, a.id), null);
	assert.equal((await readShare(kv, reset.id)).content, a.content);
	await deleteShare(kv, b.id);
	assert.deepEqual((await listShareSummaries(kv)).map(item => item.id), [reset.id]);
});

test('legacy orphan shares are listed without a destructive read-time migration', async () => {
	const kv = new MemoryKV();
	const old = share('legacy');
	await kv.put('NODE2LINK.share.' + old.id, JSON.stringify(old));
	const before = structuredClone(kv.values);
	assert.equal((await listShareSummaries(kv))[0].id, old.id);
	assert.deepEqual(kv.values, before);
	await deleteShare(kv, old.id);
	assert.equal(await readShare(kv, old.id), null);
});

test('main snapshots keep content and metadata together with the previous version', async () => {
	const kv = new MemoryKV({ pageSize: 1 });
	await kv.put('/LINK.txt', 'legacy');
	await saveMainRecord(kv, 'first');
	assert.equal((await readMainBackup(kv)).content, 'legacy');
	await saveMainRecord(kv, 'second');
	assert.equal((await readMainRecord(kv)).content, 'second');
	assert.equal((await readMainRecord(kv)).metadata.bytes, 6);
	assert.equal((await readMainBackup(kv)).content, 'first');
	kv.before = operation => { if (operation === 'put') throw new Error('outage'); };
	await assert.rejects(saveMainRecord(kv, 'failed'), StorageError);
	assert.equal((await readMainRecord(kv)).content, 'second');
	assert.equal((await readMainBackup(kv)).content, 'first');
	assert.equal(await kv.get('/LINK.txt'), 'legacy');
});

test('shared KV adapter models metadata, TTL and lexicographic pagination', async () => {
	let now = 0;
	const kv = new MemoryKV({ pageSize: 1, now: () => now });
	await kv.put('p.b', 'b', { metadata: { count: 2 } });
	await kv.put('p.a', 'a', { expirationTtl: 60 });
	assert.deepEqual((await listKeys(kv, 'p.')).map(key => key.name), ['p.a', 'p.b']);
	assert.equal((await kv.list({ prefix: 'p.b' })).keys[0].metadata.count, 2);
	now = 60001;
	assert.equal(await kv.get('p.a'), null);
	assert.deepEqual((await listKeys(kv, 'p.')).map(key => key.name), ['p.b']);
});
