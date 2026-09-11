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
