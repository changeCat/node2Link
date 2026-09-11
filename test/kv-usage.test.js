import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { createSessionCookie } from '../src/worker/auth.js';
import { saveMainRecord, readMainBackup } from '../src/worker/storage/main.js';
import { readPersistedSettings, readPublicSubscriptionSettings, saveSettingsSections } from '../src/worker/storage/settings.js';
import { saveShare, deleteShare, readShare, listShareSummaries } from '../src/worker/storage/shares.js';
import { saveGeneratedNodeSettings } from '../src/worker/storage/generated-nodes.js';

const origin = 'https://kv-usage.example.com';
const node = 'trojan://test@node.example.com:443#Saved';
const mainId = 'saved_main_id_123';
const shareId = 'saved_share_id_123';
const share = { id: shareId, name: 'Saved share', content: node, nodeCount: 1 };

function fixture(kv = new MemoryKV()) {
	const env = { KV: kv, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'secret', REQUESTLOG: '0' };
	const request = async (path, init) => {
		const pending = [];
		const response = await worker.fetch(new Request(origin + path, init), env, { waitUntil(task) { pending.push(task); } });
		await Promise.all(pending);
		return response;
	};
	return { kv, env, request };
}

test('anonymous root, invalid nested paths and unsupported methods avoid KV entirely', async () => {
	const { request } = fixture(new MemoryKV({ before() { throw new Error('unexpected KV operation'); } }));
	for (const [path, method, status] of [
		['/', 'GET', 303], ['/', 'POST', 303], ['/api/settings', 'POST', 401],
		['/api/shares', 'GET', 401], ['/api/unknown', 'GET', 404],
		['/scanner/config.php', 'GET', 404], ['/s/short', 'GET', 404],
		['/', 'OPTIONS', 405], ['/dashboard', 'POST', 405]
	]) assert.equal((await request(path, { method })).status, status, path + ' ' + method);
});

test('existing Token URLs including page names and encoded slashes survive routing changes', async () => {
	const { kv, env, request } = fixture();
	await saveMainRecord(kv, node);
	await kv.put('NODE2LINK.identity.json', JSON.stringify({ mainSubscriptionId: mainId }));
	await readPublicSubscriptionSettings(env);
	for (const token of ['login', 'robots.txt', 'encoded/token', 'ordinary-token']) {
		await saveSettingsSections(kv, { subscriptionToken: token }, 'entry');
		for (const path of ['/' + encodeURIComponent(token) + '?base64', '/?token=' + encodeURIComponent(token) + '&base64']) {
			const response = await request(path);
			assert.equal(response.status, 200, path);
			assert.equal(atob(await response.text()).trim(), node);
		}
	}
	await saveSettingsSections(kv, { subscriptionToken: 'rotated-token' }, 'entry');
	assert.equal((await request('/ordinary-token?base64')).status, 303);
	assert.equal((await request('/?token=ordinary-token&base64')).status, 303);
});

test('public subscriptions reduce lists without suppressing request logs', async () => {
	for (const kind of ['main', 'share']) {
		const { kv, env, request } = fixture();
		env.REQUESTLOG = '1';
		await kv.put('NODE2LINK.identity.json', JSON.stringify({ mainSubscriptionId: mainId }));
		await saveMainRecord(kv, node);
		await saveShare(kv, share);
		const before = structuredClone(kv.values);
		const counts = [];
		for (let i = 0; i < 2; i++) {
			const calls = { get: 0, list: 0, put: 0, delete: 0 };
			kv.before = op => { calls[op]++; };
			const response = await request('/s/' + (kind === 'main' ? mainId : shareId) + '?base64');
			assert.equal(response.status, 200);
			assert.equal(atob(await response.text()).trim(), node);
			counts.push(calls);
		}
		assert.deepEqual(counts.map(c => c.list), [0, 0], kind);
		assert.deepEqual(counts.map(c => c.put), [1, 1], kind);
		assert.deepEqual(counts.map(c => c.delete), [0, 0], kind);
		for (const [key, value] of before) assert.deepEqual(kv.values.get(key), value);
		assert.equal([...kv.values.keys()].filter(key => key.startsWith('NODE2LINK.request.')).length, 2);
	}
});

test('retired storage is ignored without read-time migration or deletion', async () => {
	const { kv, env, request } = fixture(new MemoryKV({ pageSize: 1 }));
	await kv.put('NODE2LINK.settings.json', JSON.stringify({ subscriptionToken: 'old-token' }));
	await kv.put('/LINK.txt', node);
	await kv.put('/LINK.backup.txt', 'legacy backup');
	await kv.put('NODE2LINK.share.' + shareId, JSON.stringify(share));
	await kv.put('NODE2LINK.v2.settings.old', '{broken');
	await kv.put('NODE2LINK.v2.main.old', '{broken');
	await kv.put('NODE2LINK.v2.shares.old', '{broken');
	await saveSettingsSections(kv, { pageTitle: 'Updated title', savedAt: '2026-01-02' }, 'display');
	await saveShare(kv, { ...share, id: 'new_share_id_123' });
	const before = structuredClone(kv.values);
	assert.equal((await request('/old-token?base64')).status, 303);
	assert.equal((await request('/s/' + shareId + '?base64')).status, 404);
	const response = await request('/s/new_share_id_123?base64');
	assert.equal(response.status, 200);
	assert.equal(atob(await response.text()).trim(), node);
	assert.equal(await readMainBackup(kv), null);
	assert.equal((await listShareSummaries(kv)).length, 1);
	assert.equal((await readPersistedSettings(env)).savedAt, '2026-01-02');
	assert.deepEqual(kv.values, before);
});

test('share lookup reads current detail and terminal revocation by key without scans', async () => {
	const { kv } = fixture(new MemoryKV({ pageSize: 1 }));
	await saveShare(kv, share);
	const operations = [];
	kv.before = (op, key) => { operations.push([op, key]); };
	assert.equal((await readShare(kv, shareId)).content, node);
	assert.deepEqual(operations, [['get', 'NODE2LINK.v3.shares.' + shareId], ['get', 'NODE2LINK.v3.revoked.' + shareId]]);
	assert.ok(!operations.some(([op]) => op === 'list'));
	kv.before = undefined;
	await saveShare(kv, { ...share, name: 'Updated' });
	assert.equal((await readShare(kv, shareId)).name, 'Updated');
	await deleteShare(kv, shareId);
	await assert.rejects(saveShare(kv, { ...share, name: 'Late old writer' }), /撤销/);
	assert.equal(await readShare(kv, shareId), null);
});

test('warm public settings never hide remote pause, deletion, reset or main identity changes', async () => {
	const { kv, env, request } = fixture(new MemoryKV({ pageSize: 1 }));
	const remote = new MemoryKV();
	remote.values = kv.values;
	await saveShare(kv, share);
	assert.equal((await request('/s/' + shareId + '?base64')).status, 200);
	await saveShare(remote, { ...share, paused: true });
	assert.equal((await request('/s/' + shareId + '?base64')).status, 410);
	await saveShare(remote, { ...share, expiresAt: '2000-01-01T00:00:00Z' });
	assert.equal((await request('/s/' + shareId + '?base64')).status, 410);
	await saveShare(remote, { ...share, id: 'reset_share_id_123' }, shareId);
	assert.equal((await request('/s/' + shareId + '?base64')).status, 404);
	assert.equal((await request('/s/reset_share_id_123?base64')).status, 200);
	await deleteShare(remote, 'reset_share_id_123');
	assert.equal((await request('/s/reset_share_id_123?base64')).status, 404);
	await kv.put('NODE2LINK.identity.json', JSON.stringify({ mainSubscriptionId: mainId }));
	assert.equal((await readPublicSubscriptionSettings(env)).mainSubscriptionId, mainId);
	await kv.put('NODE2LINK.identity.json', JSON.stringify({ mainSubscriptionId: 'changed_main_id_123' }));
	assert.equal((await readPublicSubscriptionSettings(env)).mainSubscriptionId, 'changed_main_id_123');
});

test('presentation view is isolated, expires and invalidates on local saves without caching credentials', async () => {
	const { kv, env } = fixture();
	await saveSettingsSections(kv, { pageTitle: 'Old', displayFormats: ['sub'], subscriptionToken: 'secret-token' }, 'all');
	const first = await readPublicSubscriptionSettings(env);
	assert.equal(first.subscriptionToken, undefined);
	first.displayFormats.push('clash');
	assert.deepEqual((await readPublicSubscriptionSettings(env)).displayFormats, ['sub']);
	assert.equal((await readPublicSubscriptionSettings({ KV: new MemoryKV() })).pageTitle, undefined);
	const remote = new MemoryKV();
	remote.values = kv.values;
	await saveSettingsSections(remote, { pageTitle: 'Remote' }, 'display');
	assert.equal((await readPublicSubscriptionSettings(env)).pageTitle, 'Old');
	assert.equal((await readPersistedSettings(env)).pageTitle, 'Remote');
	const now = Date.now;
	try {
		Date.now = () => now() + 61_000;
		assert.equal((await readPublicSubscriptionSettings(env)).pageTitle, 'Remote');
	} finally { Date.now = now; }
	await saveSettingsSections(kv, { pageTitle: 'Local' }, 'display');
	assert.equal((await readPublicSubscriptionSettings(env)).pageTitle, 'Local');
});

test('expired presentation views and authoritative failures never fall back to stale access data', async () => {
	const { kv, env, request } = fixture();
	await saveShare(kv, share);
	await readPublicSubscriptionSettings(env);
	kv.before = (op, key) => { if (key === 'NODE2LINK.identity.json') throw new Error('identity unavailable'); };
	assert.equal((await request('/s/' + shareId)).status, 503);
	kv.before = (op, key) => { if (op === 'get' && key.startsWith('NODE2LINK.v3.revoked.')) throw new Error('revocations unavailable'); };
	assert.equal((await request('/s/' + shareId)).status, 503);
	const now = Date.now;
	try {
		Date.now = () => now() + 61_000;
		kv.before = (op, key) => { if (op === 'get' && key.startsWith('NODE2LINK.v3.settings.')) throw new Error('settings unavailable'); };
		assert.equal((await request('/s/' + shareId)).status, 503);
	} finally { Date.now = now; }
});

test('imports skip unrelated site settings, preserve the API token and reject invalid callers', async () => {
	const { kv, env, request } = fixture();
	env.API_SUBSCRIPTION_ENABLED = 'true';
	const token = 'existing_api_token_123';
	await saveGeneratedNodeSettings(kv, { token });
	kv.before = (op, key) => {
		if (key === 'NODE2LINK.settings.json' || key === 'NODE2LINK.identity.json' || key.startsWith('NODE2LINK.v3.settings.')) throw new Error('unrelated site settings');
	};
	const response = await request('/api/import', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-API-Token': token }, body: node });
	assert.equal(response.status, 201);
	assert.equal((await request('/api/import?token=wrong')).status, 401);
	assert.equal(JSON.parse(await kv.get('NODE2LINK.api-subscription.settings.json')).token, token);
});

test('authenticated main page still loads saved content while anonymous root redirects without KV', async () => {
	const { kv, env, request } = fixture();
	await saveMainRecord(kv, node);
	const cookie = (await createSessionCookie(env)).split(';')[0];
	const response = await request('/', { headers: { Cookie: cookie } });
	assert.equal(response.status, 200);
	assert.ok((await response.text()).includes(node));
});
