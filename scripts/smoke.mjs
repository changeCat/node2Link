import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/_worker.js';
import { MemoryKV } from './lib/memory-kv.mjs';
import { MemoryD1 } from './lib/memory-d1.mjs';

// Exercise the deployable artifact, including its page-to-static-script links.
// All data is disposable in-memory data; no real providers or notifications run.
const origin = 'https://smoke.example.com';
const env = { KV: new MemoryKV(), DB: new MemoryD1(), ADMIN_PASSWORD: 'smoke-password', SESSION_SECRET: 'smoke-secret', API_SUBSCRIPTION_ENABLED: 'true' };
const ctx = { waitUntil(task) { void task.catch(() => {}); } };
const request = (path, init = {}) => worker.fetch(new Request(origin + path, init), env, ctx);
const login = await request('/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: env.ADMIN_PASSWORD }) });
assert.equal(login.status, 303);
const cookie = login.headers.get('Set-Cookie').split(';')[0];
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
const assets = new Set();
let mainPath;
for (const path of ['/', '/settings', '/shares', '/requests', '/api-subscriptions', '/dashboard']) {
	const response = await request(path, { headers });
	assert.equal(response.status, 200, path);
	assert.match(response.headers.get('Server-Timing'), /app;dur=/);
	const html = await response.text();
	if (path === '/') mainPath = html.match(/\/s\/[A-Za-z0-9_-]{12,64}/)?.[0];
	for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
		if (script[1].includes('application/json')) JSON.parse(script[2]);
		else if (script[2].trim()) new Function(script[2]);
		const src = script[1].match(/src="(\/assets\/[^"?]+)(?:\?[^" ]+)?"/);
		if (src) assets.add(src[1].split('/').at(-1));
	}
}
for (const asset of assets) new Function(await readFile(new URL('../dist/assets/' + asset, import.meta.url), 'utf8'));
for (const required of ['home.js', 'settings.js', 'shares.js', 'share-picker.js', 'generated-nodes.js', 'requests.js', 'dashboard.js']) assert.ok(assets.has(required), required);

const manual = 'trojan://manual@manual.example.com:443#Manual';
assert.equal((await request('/', { method: 'POST', headers, body: manual })).status, 200);
const settings = await (await request('/api/generated-nodes', { method: 'POST', headers, body: JSON.stringify({ action: 'initialize' }) })).json();
const generated = 'vless://generated@api.example.com:443#Generated';
assert.equal((await request('/api/import', { method: 'POST', headers: { 'X-API-Token': settings.settings.token, 'Content-Type': 'text/plain' }, body: generated })).status, 201);
const subscription = await request(mainPath + '?base64');
assert.equal(subscription.status, 200);
const decoded = Buffer.from(await subscription.text(), 'base64').toString('utf8');
assert.ok(decoded.includes(manual) && decoded.includes(generated));
const created = await (await request('/api/shares', { method: 'POST', headers, body: JSON.stringify({ name: 'Smoke share', content: manual }) })).json();
assert.equal((await request('/s/' + created.share.id + '?base64')).status, 200);
const reset = await (await request('/api/shares', { method: 'PATCH', headers, body: JSON.stringify({ id: created.share.id }) })).json();
assert.equal((await request('/s/' + created.share.id)).status, 404);
assert.equal((await request('/s/' + reset.share.id + '?base64')).status, 200);
assert.equal((await request('/api/shares', { method: 'DELETE', headers, body: JSON.stringify({ id: reset.share.id }) })).status, 200);
assert.equal((await request('/s/' + reset.share.id)).status, 404);
console.log(`Built Worker smoke check passed: 6 management pages, ${assets.size} scripts, main/API subscriptions and share lifecycle.`);
