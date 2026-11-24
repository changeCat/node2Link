import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { createSessionCookie } from '../src/worker/auth.js';
import { DEFAULT_MAIN_DATA } from '../src/worker/config.js';
import { readMainRecord, readMainSubscriptionData, saveMainRecord } from '../src/worker/storage/main.js';
import { readShare, listShareSummaries } from '../src/worker/storage/shares.js';
import { normalizeShareAvailability, isShareAvailable } from '../src/worker/domain/shares.js';
import { BODY_LIMITS } from '../src/worker/request-body.js';

const origin = 'https://personal.example.com';
const node = 'vless://uuid@example.com:443#Personal';
async function fixture() {
	const env = { KV: new MemoryKV(), DB: new MemoryD1(), ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-secret', API_SUBSCRIPTION_ENABLED: 'true', TOKEN: 'personal-token' };
	env.KV = withStorageBindings(env).KV;
	const headers = { Cookie: (await createSessionCookie(env)).split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
	const request = (path, init = {}) => worker.fetch(new Request(origin + path, init), env, { waitUntil() {} });
	const mutate = (method, payload) => request('/api/shares', { method, headers, body: JSON.stringify(payload) });
	return { env, headers, request, mutate };
}

test('only uninitialized main subscriptions fall back to the default source', async () => {
	const env = { KV: new MemoryKV() };
	assert.equal(await readMainSubscriptionData(env), DEFAULT_MAIN_DATA);
	assert.equal(await readMainSubscriptionData({ ...env, LINK: node }), node);
	await saveMainRecord(env.KV, '');
	assert.equal(await readMainSubscriptionData(env), '');
	await saveMainRecord(env.KV, node);
	await saveMainRecord(env.KV, '');
	assert.equal(await readMainSubscriptionData(env), '');
	assert.equal((await readMainRecord(env.KV)).exists, true);
});

test('clearing the main subscription returns an empty subscription without contacting the default upstream', async () => {
	const { env, headers, request } = await fixture();
	const revision = (await readMainRecord(env.KV)).revision;
	assert.equal((await request('/', { method: 'POST', headers: { ...headers, 'X-Node2Link-Revision': revision }, body: '' })).status, 200);
	const response = await request('/personal-token?base64');
	assert.equal(response.status, 200);
	assert.equal(await response.text(), '');
});

test('a stale main editor receives 409 and cannot replace the newer content', async () => {
	const { env, headers, request } = await fixture();
	const initial = await readMainRecord(env.KV);
	const newer = await request('/', { method: 'POST', headers: { ...headers, 'X-Node2Link-Revision': initial.revision }, body: node });
	assert.equal(newer.status, 200);
	const revision = (await newer.json()).metadata.revision;
	const stale = await request('/', { method: 'POST', headers: { ...headers, 'X-Node2Link-Revision': initial.revision }, body: 'stale edit' });
	assert.equal(stale.status, 409);
	assert.equal((await readMainRecord(env.KV)).content, node);
	assert.equal((await request('/', { method: 'POST', headers: { ...headers, 'X-Node2Link-Revision': revision }, body: '' })).status, 200);
});

test('main versions detect visible changes while callers without revision remain compatible', async () => {
	const { env, headers, request } = await fixture();
	await saveMainRecord(env.KV, node);
	const version = (await readMainRecord(env.KV)).revision;
	await saveMainRecord(env.KV, 'new current content');
	assert.equal((await request('/', { method: 'POST', headers: { ...headers, 'X-Node2Link-Revision': version }, body: 'stale' })).status, 409);
	assert.equal((await request('/', { method: 'POST', headers, body: node })).status, 200);
});

test('shares can pause, resume and expire without deleting their content or changing their URL', async () => {
	const { env, request, mutate } = await fixture();
	const created = await (await mutate('POST', { name: 'Personal share', content: node })).json();
	const id = created.share.id;
	assert.equal((await request('/s/' + id + '?base64')).status, 200);
	await listShareSummaries(env.KV);
	assert.equal((await mutate('PATCH', { id, action: 'availability', paused: true })).status, 200);
	assert.equal((await request('/s/' + id)).status, 410);
	assert.equal((await readShare(env.KV, id)).content, node);
	assert.equal((await listShareSummaries(env.KV))[0].paused, true);
	await mutate('PUT', { id, name: 'Edited while paused', content: node });
	assert.equal((await request('/s/' + id)).status, 410); // Old PUT callers preserve availability.
	await mutate('PATCH', { id, action: 'availability', paused: false });
	assert.equal((await request('/s/' + id + '?base64')).status, 200);
	await mutate('PATCH', { id, action: 'availability', expiresAt: '2000-01-01T00:00:00Z' });
	assert.equal((await request('/s/' + id + '?clash')).status, 410);
	await mutate('PATCH', { id, action: 'availability', paused: false });
	assert.equal((await request('/s/' + id)).status, 410); // Resume never clears expiry.
	await mutate('PATCH', { id, action: 'availability', expiresAt: '' });
	assert.equal((await request('/s/' + id + '?base64')).status, 200);
});

test('private share notes survive older edits and resets while request details stay per visit', async () => {
	const { env, headers, request, mutate } = await fixture();
	const name = '出差节点', note = '小林 <仅管理>';
	const { share } = await (await mutate('POST', { name, note, content: node })).json();
	await mutate('PUT', { id: share.id, name, content: node });
	const reset = await (await mutate('PATCH', { id: share.id, action: 'reset' })).json();
	assert.equal(reset.share.note, note);
	assert.equal((await listShareSummaries(env.KV))[0].note, note);

	const path = '/s/' + reset.share.id + '?base64';
	for (const [ip, cf] of [['2001:db8::1', { country: 'JP', region: 'Tokyo', city: 'Shibuya' }], ['192.0.2.8', undefined]]) {
		const visit = new Request(origin + path, { headers: { 'User-Agent': 'v2rayN/7', 'CF-Connecting-IP': ip } });
		visit.cf = cf;
		const tasks = [];
		const response = await worker.fetch(visit, env, { waitUntil(task) { tasks.push(task); } });
		assert.equal(Buffer.from(response.headers.get('Profile-Title').slice(7), 'base64').toString(), name);
		assert.equal(response.headers.get('Content-Disposition'), "attachment; filename*=utf-8''" + encodeURIComponent(name));
		assert.equal(Buffer.from(await response.text(), 'base64').toString().trim(), node);
		await Promise.all(tasks);
	}
	assert.equal((await request('/requests')).status, 303);
	const html = await (await request('/requests', { headers })).text();
	assert.match(html, /小林 &lt;仅管理&gt;/);
	assert.doesNotMatch(html, /2001:db8::1|192\.0\.2\.8/);
	const details = '/api/requests?scope=' + reset.share.id;
	assert.equal((await request(details)).status, 401);
	assert.equal((await request('/api/requests?scope=' + share.id, { headers })).status, 404);
	const { events } = await (await request(details, { headers })).json();
	assert.equal(events.length, 2);
	const jp = events.find(event => event.ip === '2001:db8::1');
	assert.deepEqual([jp.country, jp.region, jp.city, jp.status, jp.format], ['JP', 'Tokyo', 'Shibuya', 200, 'base64']);
	assert.equal(events.find(event => event.ip === '192.0.2.8').country, '');
	await mutate('PUT', { id: reset.share.id, name, content: node, note: '' });
	assert.equal((await listShareSummaries(env.KV))[0].note, '');
});

test('request summaries, filters and cursor pages use the configured rolling window', async t => {
	const { env, headers, request, mutate } = await fixture();
	const { share } = await (await mutate('POST', { name: 'Older traffic', content: node })).json();
	const now = Date.now();
	t.mock.method(Date, 'now', () => now);
	const cutoff = now - 7 * 86400_000;
	async function write(index, access, expirationTtl = 86400, at = now - 1000 + index) {
		const key = 'requests.' + (9999999999999 - at) + '.' + crypto.randomUUID();
		await env.KV.put(key, '1', { expirationTtl, metadata: {
			requestedAt: new Date(at).toISOString(), access, subscriptionId: share.id,
			client: index % 2 ? 'Loon' : 'Clash', status: index % 3 ? 200 : 502,
			userAgent: 'visit-' + index
		} });
	}
	await write(0, 'share', 86400, cutoff);
	for (let i = 1; i < 47; i++) await write(i, 'share');
	for (let i = 47; i < 560; i++) await write(i, 'main');
	await write(560, 'share', -1);
	await write(-1, 'share', 86400, cutoff - 1);
	await write(-2, 'main', 86400, cutoff - 1);
	const url = '/api/requests?scope=' + share.id;
	const fetchPage = async suffix => (await request(url + suffix, { headers })).json();
	const first = await fetchPage('');
	assert.equal(first.events.length, 20);
	assert.equal(first.events[0].userAgent, 'visit-46');
	await write(561, 'share');
	const second = await fetchPage('&start=' + first.start + '&after=' + first.next);
	const third = await fetchPage('&start=' + first.start + '&after=' + second.next);
	assert.deepEqual([...first.events, ...second.events, ...third.events].map(event => event.userAgent),
		Array.from({ length: 47 }, (_, index) => 'visit-' + (46 - index)));
	assert.equal(third.next, '');
	assert.deepEqual(await fetchPage('&start=' + first.start), first);
	const failures = await fetchPage('&client=Clash&failed=1');
	assert.equal(failures.events.length, 8);
	assert.ok(failures.events.every(event => event.client === 'Clash' && event.status === 502));
	const main = await (await request('/api/requests?scope=main', { headers })).json();
	assert.equal(main.events[0].userAgent, 'visit-559');
	const html = await (await request('/requests', { headers })).text();
	assert.match(html, /最近 7 天/);
	assert.match(html, /513 次/);
	assert.match(html, /48 次/);
	assert.equal((await request(url + '&after=invalid', { headers })).status, 400);

	const saveDays = requestHistoryDays => request('/api/settings', {
		method: 'POST', headers, body: JSON.stringify({ section: 'requests', requestHistoryDays })
	});
	const lastPage = '&start=' + first.start + '&after=' + second.next;
	assert.equal((await saveDays(30)).status, 200);
	const wide = await (await request('/requests', { headers })).text();
	assert.match(wide, /最近 30 天/);
	assert.match(wide, /514 次/);
	assert.match(wide, /49 次/);
	assert.equal((await fetchPage(lastPage)).events.at(-1).userAgent, 'visit--1');

	assert.equal((await saveDays(1)).status, 200);
	for (const invalid of [0, 31, 1.5, '7', null]) assert.equal((await saveDays(invalid)).status, 400);
	const narrow = await (await request('/requests', { headers })).text();
	assert.match(narrow, /最近 1 天/);
	assert.match(narrow, /513 次/);
	assert.match(narrow, /47 次/);
	assert.equal((await fetchPage(lastPage)).events.at(-1).userAgent, 'visit-1');
	assert.equal((await fetchPage('&client=Clash&failed=1')).events.length, 7);
});

test('reset keeps share restrictions and deleted shares cannot be resumed', async () => {
	const { request, mutate } = await fixture();
	const { share } = await (await mutate('POST', { name: 'Restricted', content: node, paused: true, expiresAt: '2099-01-01T00:00:00Z' })).json();
	assert.equal((await mutate('PATCH', { id: share.id, action: 'unknown' })).status, 400);
	assert.equal((await request('/s/' + share.id)).status, 410);
	const reset = await (await mutate('PATCH', { id: share.id })).json();
	assert.equal(reset.share.paused, true);
	assert.equal(reset.share.expiresAt, '2099-01-01T00:00:00.000Z');
	assert.equal((await request('/s/' + share.id)).status, 404);
	assert.equal((await request('/s/' + reset.share.id)).status, 410);
	await mutate('DELETE', { id: reset.share.id });
	assert.equal((await mutate('PATCH', { id: reset.share.id, action: 'availability', paused: false })).status, 404);
});

test('expiry uses absolute time and old shares stay enabled by default', () => {
	const { expiresAt } = normalizeShareAvailability({ expiresAt: '2026-09-10T16:00:00+08:00' });
	assert.equal(expiresAt, '2026-09-10T08:00:00.000Z');
	assert.equal(isShareAvailable({ expiresAt }, Date.parse(expiresAt) - 1), true);
	assert.equal(isShareAvailable({ expiresAt }, Date.parse(expiresAt)), false);
	assert.equal(isShareAvailable({}), true);
	assert.throws(() => normalizeShareAvailability({ paused: 'false' }));
	assert.throws(() => normalizeShareAvailability({ expiresAt: 'tomorrow' }));
});

for (const [path, method, limit] of [
	['/', 'POST', BODY_LIMITS.main], ['/api/shares', 'POST', BODY_LIMITS.share],
	['/api/settings', 'POST', BODY_LIMITS.settings], ['/api/generated-nodes', 'PUT', BODY_LIMITS.apiSettings],
	['/api/login', 'POST', BODY_LIMITS.login]
]) {
	test(`oversized ${path} requests return 413 without writing`, async () => {
		const { env, headers, request } = await fixture();
		const response = await request(path, { method, headers: { ...headers, 'Content-Length': String(limit + 1) }, body: '{}' });
		assert.equal(response.status, 413);
		assert.equal(env.KV.kv.values.size, 0);
	});
}

test('management JSON validation returns 400 for malformed or non-object payloads', async () => {
	const { request, headers, env } = await fixture();
	for (const body of ['null', '[]', '{']) {
		assert.equal((await request('/api/settings', { method: 'POST', headers, body })).status, 400);
	}
	assert.equal(env.KV.kv.values.size, 0);
});

test('share entry methods follow deduplicated lines across legacy edits and link resets', async () => {
	const { mutate } = await fixture();
	const source = 'https://example.com/sub';
	const payload = { name: 'Entry methods', content: [node, node, source].join('\n') };
	const { share } = await (await mutate('POST', { ...payload, lineOrigins: 'pm' })).json();
	assert.equal(share.lineOrigins, 'pm');
	const updated = { ...payload, id: share.id, content: [source, node, node + '2'].join('\n') };
	assert.equal((await mutate('PUT', { ...updated, lineOrigins: 'p' })).status, 400);
	const edit = await (await mutate('PUT', updated)).json();
	assert.equal(edit.share.lineOrigins, 'mpu');
	const reset = await (await mutate('PATCH', { id: share.id, action: 'reset' })).json();
	assert.equal(reset.share.lineOrigins, 'mpu');
});
