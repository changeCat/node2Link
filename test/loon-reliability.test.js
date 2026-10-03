import test from 'node:test';
import assert from 'node:assert/strict';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { createRuntimeConfig } from '../src/worker/config.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';

const origin = 'https://app.example.com';
const path = '/s/loon_reliability_test';
const env = { ADMIN_PASSWORD: 'test-secret' };
const upstream = 'https://upstream.example.com/sub?token=private';
const node = 'trojan://password@edge.example.com:443#Node';
const output = '[Proxy]\nNode = trojan,edge.example.com,443,password';

test('explicit and adaptive Loon skip both custom types for main and shared subscriptions', async () => {
	for (const customConverterType of ['subconverter', 'sublink']) {
		const runtime = await createRuntimeConfig({ ...env, SUBAPI: 'https://default.example.com' }, {
			converterMode: 'custom', customConverterURL: 'https://custom.example.com', customConverterType
		});
		for (const access of ['main', 'share']) {
			for (const query of ['', '?loon']) {
				const calls = [], timings = [];
				const response = await serveSubscription(new Request(origin + path + query, {
					headers: { 'User-Agent': query ? 'Clash/1.0' : 'Loon/975' }
				}), env, {}, runtime, node, access, false, 'loon_reliability_test', 'Test', {
					timings, fetchImpl: async input => { calls.push(new URL(input)); return new Response(output); }
				});
				assert.equal(response.status, 200);
				assert.deepEqual(calls.map(url => url.origin), ['https://default.example.com']);
				assert.equal(calls[0].searchParams.get('target'), 'loon');
				assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'default');
				assert.equal(response.headers.get('X-Subconverter-Used'), 'https://default.example.com');
				assert.ok(timings.some(value => value.startsWith('conversion_default;')));
				assert.ok(!timings.some(value => /^conversion_(custom|fallback);/.test(value)));
				assert.equal(runtime.converterMode, 'custom');
			}
		}
	}
});

test('explicit and adaptive Loon use identical raw-source identities through a real callback', async () => {
	const runtime = await createRuntimeConfig(env);
	for (const query of ['', '?loon']) {
		const upstreamUAs = [];
		let converterCalls = 0;
		const fetchImpl = async input => {
			const url = new URL(input instanceof Request ? input.url : input);
			if (url.hostname === 'upstream.example.com') {
				const ua = input.headers.get('User-Agent');
				upstreamUAs.push(ua);
				// A typical adaptive upstream: the old forwarded identity selects
				// a structured profile, which then fails the strict source audit.
				return new Response(/loon|subconverter/i.test(ua) ? 'proxies: []' : btoa(node));
			}
			converterCalls++;
			assert.equal(url.searchParams.get('target'), 'loon');
			const callbackURL = url.searchParams.get('url');
			assert.doesNotMatch(callbackURL, /private|password|upstream/);
			const callback = await serveSubscription(new Request(callbackURL, { headers: { 'User-Agent': 'Loon/975' } }),
				env, {}, runtime, upstream, 'share', false, 'loon_reliability_test', 'Test', { fetchImpl });
			assert.equal(callback.status, 200);
			assert.equal(callback.headers.get('X-Node2Link-Format'), 'base64');
			assert.equal(Buffer.from(await callback.text(), 'base64').toString().trim(), node);
			return new Response(output);
		};
		const response = await serveSubscription(new Request(origin + path + query, { headers: { 'User-Agent': 'Loon/975' } }),
			env, {}, runtime, upstream, 'share', false, 'loon_reliability_test', 'Test', { fetchImpl });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
		assert.equal(converterCalls, 1);
		assert.equal(upstreamUAs.length, 2);
		assert.equal(upstreamUAs[0], upstreamUAs[1]);
		assert.doesNotMatch(upstreamUAs.join(' '), /loon|subconverter/i);
	}
});

test('Loon updates bypass converter source caches even when node counts stay the same', async () => {
	const runtime = await createRuntimeConfig(env);
	const cache = new Map();
	let content = node;
	for (const host of ['first.example.com', 'second.example.com']) {
		content = `trojan://password@${host}:443#Node`;
		const response = await serveSubscription(new Request(origin + path + '?loon'), env, {}, runtime,
			content, 'share', false, 'loon_reliability_test', 'Test', { fetchImpl: async input => {
				const sourceURL = new URL(input).searchParams.get('url');
				if (!cache.has(sourceURL)) {
					const callback = await serveSubscription(new Request(sourceURL), env, {}, runtime,
						content, 'share', false, 'loon_reliability_test', 'Test');
					assert.equal(callback.status, 200);
					cache.set(sourceURL, Buffer.from(await callback.text(), 'base64').toString());
				}
				const hostname = new URL(cache.get(sourceURL).trim()).hostname;
				return new Response(`[Proxy]\nNode = trojan,${hostname},443,password`);
			} });
		assert.equal(response.status, 200);
		assert.ok((await response.text()).includes(host));
	}
	assert.equal(cache.size, 2);
});

test('Loon retains API and WARP nodes in main callbacks without adding them to shares', async () => {
	const warpEnv = { ...env, API_SUBSCRIPTION_ENABLED: 'true', KV: new MemoryKV(), WARP: 'trojan://warp-password@warp.example.com:443#Warp' };
	await appendNodeBatch(warpEnv.KV, normalizeDirectNodes({ node: 'trojan://api-password@api.example.com:443#API' }));
	const runtime = await createRuntimeConfig(warpEnv);
	for (const access of ['main', 'share']) {
		const response = await serveSubscription(new Request(origin + path + '?loon'), warpEnv, {}, runtime, node,
			access, access === 'main', 'loon_reliability_test', 'Test', { fetchImpl: async input => {
				const sourceURL = new URL(input).searchParams.get('url');
				assert.doesNotMatch(sourceURL, /warp-password|trojan:|\|/);
				const callback = await serveSubscription(new Request(sourceURL), warpEnv, {}, runtime, node,
					access, access === 'main', 'loon_reliability_test', 'Test');
				assert.equal(callback.status, 200);
				const raw = Buffer.from(await callback.text(), 'base64').toString();
				assert.equal(raw.includes('warp.example.com'), access === 'main');
				assert.equal(raw.includes('api.example.com'), access === 'main');
				return new Response(output + (access === 'main' ? '\nAPI = trojan,api.example.com,443,api-password\nWarp = trojan,warp.example.com,443,warp-password' : ''));
			} });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('X-Node2Link-Input-Nodes'), access === 'main' ? '3' : '1');
		assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
	}
});

test('Loon recovers transient default failures without trying custom services', async () => {
	for (const mode of ['default', 'custom']) {
		for (const failure of [429, 502, 503, 'network']) {
			const runtime = await createRuntimeConfig(env, { converterMode: mode, customConverterURL: 'https://custom.example.com' });
			const sources = [];
			let defaults = 0;
			const response = await serveSubscription(new Request(origin + path + '?loon'), env, {}, runtime, node,
				'share', false, 'loon_reliability_test', 'Test', { fetchImpl: async input => {
					const url = new URL(input);
					sources.push(url.searchParams.get('url'));
					assert.equal(url.hostname, 'subapi.cmliussss.net');
					if (++defaults === 1) {
						if (failure === 'network') throw new TypeError('network interruption');
						return new Response('unavailable', { status: failure });
					}
					return new Response(output);
				} });
			assert.equal(response.status, 200);
			assert.equal(defaults, 2);
			assert.equal(sources.length, 2);
			assert.equal(new Set(sources).size, 1);
			assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'default');
		}
	}
});

test('Loon does not retry a stalled conversion past its deadline or return Base64 as success', async () => {
	const runtime = await createRuntimeConfig(env);
	let calls = 0, cancelled = false;
	const response = await serveSubscription(new Request(origin + path + '?loon'), env, {}, runtime, node,
		'share', false, 'loon_reliability_test', 'Test', { conversionTimeoutMs: 40, fetchImpl: async () => {
			calls++;
			return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
		} });
	assert.equal(response.status, 502);
	assert.equal(calls, 1);
	assert.equal(cancelled, true);
	assert.doesNotMatch(await response.text(), /password|trojan:\/\//);
});
