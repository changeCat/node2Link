import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { StorageError } from '../src/worker/storage/kv.js';
import { saveMainRecord, readMainRecord, readMainBackup, MAIN_HEAD_KEY } from '../src/worker/storage/main.js';
import { saveShare, readShare, listShareSummaries, deleteShare } from '../src/worker/storage/shares.js';
import { saveSettingsSections, readPersistedSettings } from '../src/worker/storage/settings.js';
import { initializeGeneratedNodeSettings, readGeneratedNodeSettings } from '../src/worker/storage/generated-nodes.js';

const original = { id: 'original_share_id', name: 'Test', content: 'trojan://pw@example.com:443', nodeCount: 1 };
const replacement = { ...original, id: 'replacement_share_id' };

test('failed main head publication preserves the current content and previous version', async () => {
	const kv = new MemoryKV();
	await saveMainRecord(kv, 'first');
	await saveMainRecord(kv, 'second');
	kv.before = (op, key) => { if (op === 'put' && key === MAIN_HEAD_KEY) throw new Error('publication failed'); };
	await assert.rejects(saveMainRecord(kv, 'unpublished'), StorageError);
	assert.equal((await readMainRecord(kv)).content, 'second');
	assert.equal((await readMainBackup(kv)).content, 'first');
	kv.before = undefined;
	await saveMainRecord(kv, 'third');
	assert.equal((await readMainBackup(kv)).content, 'second');
});

test('missing or corrupt current bodies fail closed without falling back to archived content', async () => {
	const kv = new MemoryKV();
	await saveMainRecord(kv, 'first');
	const current = await saveMainRecord(kv, 'second');
	kv.values.delete(current.revision);
	await assert.rejects(readMainRecord(kv), StorageError);
	await kv.put(current.revision, '{broken');
	await assert.rejects(readMainRecord(kv), StorageError);
	await kv.put(MAIN_HEAD_KEY, '{broken');
	await assert.rejects(saveMainRecord(kv, 'third'), StorageError);
});

test('reset publication failure never exposes a staged replacement and retry completes the switch', async () => {
	const kv = new MemoryKV();
	await saveShare(kv, original);
	kv.before = (op, key) => { if (op === 'put' && key.startsWith('NODE2LINK.v3.revoked.')) throw new Error('publication failed'); };
	await assert.rejects(saveShare(kv, replacement, original.id), StorageError);
	assert.equal((await readShare(kv, original.id)).content, original.content);
	assert.equal(await readShare(kv, replacement.id), null);
	assert.deepEqual((await listShareSummaries(kv)).map(s => s.id), [original.id]);
	kv.before = undefined;
	await saveShare(kv, replacement, original.id);
	assert.equal(await readShare(kv, original.id), null);
	assert.equal((await readShare(kv, replacement.id)).content, original.content);
	assert.deepEqual((await listShareSummaries(kv)).map(s => s.id), [replacement.id]);
});

for (const action of ['delete', 'reset']) test('in-flight edit cannot resurrect an ID after concurrent ' + action, async () => {
	const kv = new MemoryKV();
	await saveShare(kv, original);
	let resume, entered;
	const paused = new Promise(resolve => { entered = resolve; });
	const barrier = new Promise(resolve => { resume = resolve; });
	kv.before = async (op, key) => {
		if (op === 'put' && key === 'NODE2LINK.v3.shares.' + original.id) { entered(); await barrier; }
	};
	const editing = saveShare(kv, { ...original, name: 'Late edit' });
	await paused;
	if (action === 'delete') await deleteShare(kv, original.id);
	else await saveShare(kv, replacement, original.id);
	resume();
	await editing;
	assert.equal(await readShare(kv, original.id), null);
	assert.ok(!(await listShareSummaries(kv)).some(s => s.id === original.id));
	if (action === 'reset') assert.equal((await readShare(kv, replacement.id)).content, original.content);
});

test('repeated settings and share edits do not grow history or subscription list cost', async () => {
	const kv = new MemoryKV();
	for (let i = 0; i < 100; i++) {
		await saveSettingsSections(kv, { subscriptionToken: 'token-' + i }, 'entry');
		await saveShare(kv, { ...original, name: 'Edit ' + i });
	}
	assert.equal(kv.values.size, 2);
	kv.before = op => { if (op !== 'get') throw new Error('Unexpected ' + op); };
	assert.equal((await readPersistedSettings({ KV: kv })).subscriptionToken, 'token-99');
	assert.equal((await readShare(kv, original.id)).name, 'Edit 99');
});

test('API credential initialization and later reads never list bootstrap history', async () => {
	const kv = new MemoryKV({ before(op) { if (op === 'list') throw new Error('Unexpected list'); } });
	await kv.put('NODE2LINK.api-subscription.bootstrap.retired', JSON.stringify({ token: 'retired-token-1234' }));
	assert.equal((await readGeneratedNodeSettings(kv)).token, '');
	const settings = await initializeGeneratedNodeSettings({ KV: kv, ADMIN_PASSWORD: 'password' });
	assert.ok(settings.token);
	assert.equal((await readGeneratedNodeSettings(kv)).token, settings.token);
});

test('main versions preserve the full 20 MiB input limit without one oversized combined backup value', async () => {
	const kv = new MemoryKV();
	const content = 'a'.repeat(20 * 1024 * 1024);
	await saveMainRecord(kv, content);
	await saveMainRecord(kv, content);
	assert.equal((await readMainRecord(kv)).metadata.bytes, 20 * 1024 * 1024);
	assert.equal((await readMainBackup(kv)).content.length, content.length);
	for (const { value } of kv.values.values()) assert.ok(new TextEncoder().encode(value).length < 25 * 1024 * 1024);
	await assert.rejects(saveMainRecord(kv, content + 'a'), /20 MB/);
});

test('explicit write throttling is retried with a bound and ordinary outages are not retried', async () => {
	const { writeJSON } = await import('../src/worker/storage/kv.js');
	const originalTimer = globalThis.setTimeout;
	globalThis.setTimeout = callback => originalTimer(callback, 0);
	try {
		let attempts = 0;
		const kv = new MemoryKV({ before(op) {
			if (op === 'put' && ++attempts === 1) throw Object.assign(new Error('Too Many Requests'), { status: 429 });
		} });
		await writeJSON(kv, 'current', { ok: true });
		assert.equal(attempts, 2);
		assert.equal(await kv.get('current'), '{"ok":true}');
		attempts = 0;
		kv.before = op => { if (op === 'put') { attempts++; throw new Error('KV PUT failed: 429'); } };
		await assert.rejects(writeJSON(kv, 'current', { ok: false }), StorageError);
		assert.equal(attempts, 3);
		assert.equal(await kv.get('current'), '{"ok":true}');
		attempts = 0;
		kv.before = op => { if (op === 'put') { attempts++; throw new Error('outage'); } };
		await assert.rejects(writeJSON(kv, 'current', {}), StorageError);
		assert.equal(attempts, 1);
	} finally { globalThis.setTimeout = originalTimer; }
});

test('an invalid token candidate reads only the current entry key and never scans', async () => {
	const { default: worker } = await import('../src/worker/app.js');
	const calls = [];
	const kv = new MemoryKV({ before(op, key) { calls.push([op, key]); } });
	const response = await worker.fetch(new Request('https://example.com/unknown-token'), { KV: kv, TOKEN: 'valid-token', ADMIN_PASSWORD: 'password' }, {});
	assert.equal(response.status, 303);
	assert.deepEqual(calls, [['get', 'NODE2LINK.v3.settings.entry']]);
});
