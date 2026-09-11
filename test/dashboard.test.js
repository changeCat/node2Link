import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { summarizeDashboard, readDashboard } from '../src/worker/services/dashboard.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { saveShare } from '../src/worker/storage/shares.js';
import { createSessionCookie } from '../src/worker/auth.js';

const node = 'vless://private-id@example.com:443#Local';
const now = Date.parse('2026-09-10T12:00:00Z');
const date = days => new Date(now + days * 86400000).toISOString();

test('dashboard deduplicates local/API nodes and counts sources without counting share copies', () => {
	const data = summarizeDashboard({ content: node + '\n' + node + '\nhttps://source.example.com/private\nhttps://source.example.com/private\ninvalid' }, [
		{ content: node }, { content: 'trojan://pw@other.example.com:443#Other' }
	], [{ name: 'Copy', nodeCount: 100, sourceCount: 10 }], now);
	assert.equal(data.nodeCount, 2);
	assert.equal(data.mainCount, 1);
	assert.equal(data.apiCount, 2);
	assert.equal(data.sourceCount, 1);
	assert.equal(data.protocols.reduce((sum, item) => sum + item.count, 0), 2);
	assert.equal(data.shareCounts.active, 1);
	assert.doesNotMatch(JSON.stringify(data), /private-id|source\.example\.com/);
});

test('dashboard handles expiry boundaries, paused shares, old shares and bounded recent lists', () => {
	const shares = [
		{ name: 'Forever' }, { name: 'Now', expiresAt: date(0) },
		{ name: 'Tomorrow', expiresAt: date(1) }, { name: 'Week', expiresAt: date(7) },
		{ name: 'Later', expiresAt: date(8) }, { name: 'Paused', paused: true, expiresAt: date(2) },
		{ name: 'Paused expired', paused: true, expiresAt: date(-1) }
	];
	const generated = Array.from({ length: 12 }, (_, i) => ({ name: 'Node ' + i, createdAt: date(-i) }));
	const data = summarizeDashboard({ metadata: { savedAt: 'invalid' } }, generated, shares, now);
	assert.deepEqual(data.shareCounts, { active: 4, paused: 2, expired: 1 });
	assert.equal(data.expiringCount, 3);
	assert.deepEqual(data.expiring.map(share => share.name), ['Tomorrow', 'Paused', 'Week']);
	assert.equal(data.recent.length, 8);
	assert.equal(data.recent[0].name, 'Node 0');
	assert.equal(data.recent.at(-1).name, 'Node 7');
});

test('dashboard reads existing records only and respects the API feature switch', async () => {
	const kv = new MemoryKV();
	await saveMainRecord(kv, node + '\nhttps://source.example.com/private');
	let writes = 0;
	kv.before = (op, key) => {
		if (op === 'put') writes++;
		if (key.includes('api-subscription') || key.startsWith('nodes.')) throw new Error('API should remain disabled');
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => { throw new Error('Dashboard must not fetch upstream'); };
	try {
		const data = await readDashboard({ KV: kv }, { apiSubscriptionEnabled: false });
		assert.equal(data.nodeCount, 1);
		assert.equal(data.sourceCount, 1);
		assert.equal(writes, 0);
	} finally { globalThis.fetch = originalFetch; }
});

test('dashboard requires login, escapes names and never embeds node bodies', async () => {
	const env = { KV: new MemoryKV(), DB: new MemoryD1(), ADMIN_PASSWORD: 'password' };
	env.KV = withStorageBindings(env).KV;
	await saveMainRecord(env.KV, node);
	await saveShare(env.KV, { id: 'dashboard_share_123', name: '<img src=x onerror=alert(1)>', content: node, updatedAt: date(0), expiresAt: date(1) });
	const request = headers => worker.fetch(new Request('https://example.com/dashboard', { headers }), env, {});
	assert.equal((await request()).status, 303);
	const response = await request({ Cookie: (await createSessionCookie(env)).split(';')[0] });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'no-store');
	const html = await response.text();
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.doesNotMatch(html, /<img src=x|private-id|href="\/api-subscriptions"/);
	assert.match(html, /data-stat="nodes">1/);
});

test('dashboard supports empty bound storage and surfaces D1 failure instead of false zero counts', async () => {
	const db = new MemoryD1();
	const env = { KV: new MemoryKV(), DB: db, ADMIN_PASSWORD: 'password' };
	env.KV = withStorageBindings(env).KV;
	const headers = { Cookie: (await createSessionCookie(env)).split(';')[0] };
	const request = () => worker.fetch(new Request('https://example.com/dashboard', { headers }), env, {});
	const first = await request();
	assert.equal(first.status, 200);
	assert.match(await first.text(), /data-stat="nodes">0/);
	db.before = operation => { if (operation === 'first') throw new Error('outage'); };
	assert.equal((await request()).status, 503);
});
