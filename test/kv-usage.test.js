import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { saveSettingsSections } from '../src/worker/storage/settings.js';
import { saveShare } from '../src/worker/storage/shares.js';

const origin = 'https://storage.example.com';
const node = 'trojan://test@node.example.com:443#Saved';
const mainId = 'saved_main_id_123';
const shareId = 'saved_share_id_123';

function fixture({ logging = '0' } = {}) {
	const operations = [];
	const kv = new MemoryKV({ before(op, key) { operations.push(['kv.' + op, key]); } });
	const db = new MemoryD1({ before(op) { operations.push(['d1.' + op]); } });
	const env = { KV: kv, DB: db, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'secret', REQUESTLOG: logging };
	const storage = withStorageBindings(env).KV;
	const request = async (path, init) => {
		const pending = [];
		const response = await worker.fetch(new Request(origin + path, init), env, { waitUntil(task) { pending.push(task); } });
		await Promise.all(pending);
		return response;
	};
	return { kv, db, env, storage, operations, request };
}

test('unrelated and unauthorized requests stop before any D1 or KV operation', async () => {
	const { request, operations } = fixture();
	for (const [path, method, status] of [
		['/', 'GET', 303], ['/', 'POST', 303], ['/api/settings', 'POST', 401],
		['/api/shares', 'GET', 401], ['/api/unknown', 'GET', 404],
		['/scanner/config.php', 'GET', 404], ['/s/short', 'GET', 404],
		['/', 'OPTIONS', 405], ['/dashboard', 'POST', 405]
	]) assert.equal((await request(path, { method })).status, status, path + ' ' + method);
	assert.deepEqual(operations, []);
});

test('login page reads only its display setting', async () => {
	const { storage, operations, request } = fixture();
	await saveSettingsSections(storage, { pageTitle: 'Private Console' }, 'display');
	operations.length = 0;
	const response = await request('/login');
	assert.equal(response.status, 200);
	assert.match(await response.text(), /Private Console/);
	assert.deepEqual(operations, [['d1.first']]);
});

test('main and ordinary share requests never list KV and logs are written to D1', async () => {
	for (const kind of ['main', 'share']) {
		const { storage, operations, request } = fixture({ logging: '1' });
		await storage.put('identity', JSON.stringify({ mainSubscriptionId: mainId }));
		await saveMainRecord(storage, node);
		await saveShare(storage, { id: shareId, name: 'Saved share', content: node, nodeCount: 1 });
		operations.length = 0;
		const response = await request('/s/' + (kind === 'main' ? mainId : shareId) + '?base64');
		assert.equal(response.status, 200);
		assert.equal(atob(await response.text()).trim(), node);
		assert.equal(operations.some(([op]) => op === 'kv.list' || op === 'kv.put' || op === 'kv.delete'), false);
		assert.equal(operations.filter(([op]) => op === 'kv.get').length, kind === 'main' ? 1 : 0);
		assert.equal(operations.filter(([op]) => op === 'd1.run').length, 1);
	}
});

test('configured Token environment variable remains the initial subscription entry', async () => {
	const { env, storage, request } = fixture();
	env.TOKEN = 'ordinary-token';
	env.LINKSUB = 'vless://extra@extra.example.com:443#Extra';
	await storage.put('identity', JSON.stringify({ mainSubscriptionId: mainId }));
	await saveMainRecord(storage, node);
	for (const path of ['/ordinary-token?base64', '/?token=ordinary-token&base64']) {
		const response = await request(path);
		assert.equal(response.status, 200);
		const content = atob(await response.text());
		assert.match(content, /node\.example\.com/);
		assert.match(content, /extra\.example\.com/);
	}
	await saveSettingsSections(storage, { subscriptionToken: 'rotated-token' }, 'entry');
	assert.equal((await request('/ordinary-token?base64')).status, 303);
});

test('missing required bindings return an explicit configuration error', async () => {
	const request = new Request(origin + '/login');
	const missingDB = await worker.fetch(request, { KV: new MemoryKV(), ADMIN_PASSWORD: 'password' }, {});
	assert.equal(missingDB.status, 503);
	assert.match((await missingDB.json()).message, /DB/);
	const missingKV = await worker.fetch(request, { DB: new MemoryD1(), ADMIN_PASSWORD: 'password' }, {});
	assert.equal(missingKV.status, 503);
	assert.match((await missingKV.json()).message, /KV/);
	const wrongDB = await worker.fetch(request, { DB: {}, KV: new MemoryKV(), ADMIN_PASSWORD: 'password' }, {});
	assert.equal(wrongDB.status, 503);
	assert.match((await wrongDB.json()).message, /D1/);
	const wrongKV = await worker.fetch(request, { DB: new MemoryD1(), KV: {}, ADMIN_PASSWORD: 'password' }, {});
	assert.equal(wrongKV.status, 503);
	assert.match((await wrongKV.json()).message, /KV/);
});
