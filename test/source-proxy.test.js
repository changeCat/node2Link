import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/app.js';
import { createRuntimeConfig } from '../src/worker/config.js';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { createSourceProxyURL, readSourceProxyURL } from '../src/worker/source-proxy.js';

const env = { ADMIN_PASSWORD: 'source-proxy-test-secret' };
const upstreamURL = 'https://upstream.example.com/private?token=secret-value';

test('source proxy tokens hide, authenticate and expire upstream URLs', async () => {
	const now = Date.now();
	const proxyURL = await createSourceProxyURL(env, 'https://app.example.com', upstreamURL, { now, ttlMs: 1000 });
	const token = new URL(proxyURL).pathname.split('/').at(-1);
	assert.doesNotMatch(proxyURL, /upstream\.example\.com|secret-value/);
	assert.equal(await readSourceProxyURL(env, token, now + 999), upstreamURL);
	assert.equal(await readSourceProxyURL(env, token, now + 1001), '');
	assert.equal(await readSourceProxyURL({ ADMIN_PASSWORD: 'wrong-secret' }, token, now), '');
	const changed = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
	assert.equal(await readSourceProxyURL(env, changed, now), '');
});

test('source proxy bypasses D1 and forwards only the decrypted upstream request', async t => {
	const proxyURL = await createSourceProxyURL(env, 'https://app.example.com', upstreamURL);
	let forwarded;
	let attempts = 0;
	t.mock.method(globalThis, 'fetch', async input => {
		forwarded = input;
		attempts++;
		if (attempts === 1) return new Response('temporary failure', { status: 503 });
		return new Response('trojan://password@edge.example.com:443#node', { headers: { 'Content-Type': 'text/plain' } });
	});
	const response = await worker.fetch(new Request(proxyURL), env, {});
	assert.equal(response.status, 200);
	assert.equal(attempts, 2);
	assert.equal(forwarded.url, upstreamURL);
	assert.match(forwarded.headers.get('User-Agent'), /node2Link.*source-proxy/i);
	assert.equal(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate, max-age=0');
	assert.match(await response.text(), /edge\.example\.com/);
});

test('converted subscriptions use opaque sources once and preserve custom-to-default fallback', async () => {
	const runtime = await createRuntimeConfig(env, { converterMode: 'custom', customConverterURL: 'https://custom.example.com' });
	const structuredURL = 'https://structured.example.com/clash.yaml?access=private';
	const calls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/source_proxy_test?clash', { headers: { 'User-Agent': 'Clash/1.18' } }),
		env, {}, runtime, `vless://id@direct.example.com:443#direct\n${upstreamURL}\n${structuredURL}`,
		'share', false, 'source_proxy_test', 'Proxy test', {
			fetchImpl: async input => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				calls.push(url);
				return url.hostname === 'custom.example.com'
					? new Response('unavailable', { status: 503 })
					: new Response('proxies: []');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Source-Mode'), 'proxied');
	assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'fallback');
	assert.deepEqual(calls.map(url => url.hostname), ['custom.example.com', 'subapi.cmliussss.net']);
	const firstSources = calls[0].searchParams.get('url').split('|');
	const secondSources = calls[1].searchParams.get('url').split('|');
	assert.equal(firstSources.length, 3);
	assert.equal(new URL(firstSources[0]).searchParams.get('source'), 'direct');
	assert.ok(firstSources.slice(1).every(value => new URL(value).pathname.startsWith('/_node2link/source/')));
	assert.deepEqual(firstSources, secondSources);
	assert.doesNotMatch(calls.map(String).join('\n'), /upstream\.example\.com|structured\.example\.com|secret-value|access=private/);
});

test('Loon keeps strict normalized prefetch even when source proxy secrets are available', async () => {
	const runtime = await createRuntimeConfig(env);
	const calls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/strict_loon_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		env, {}, runtime, `vless://id@direct.example.com:443#direct\n${upstreamURL}`,
		'share', false, 'strict_loon_test', 'Strict Loon', {
			fetchImpl: async input => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				calls.push(url);
				if (url.hostname === 'upstream.example.com') return new Response('trojan://password@edge.example.com:443#upstream');
				return new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id,transport=ws\nupstream = trojan,edge.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Source-Mode'), null);
	assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
	assert.deepEqual(calls.map(url => url.hostname), ['upstream.example.com', 'subapi.cmliussss.net']);
	assert.equal(calls[1].searchParams.get('url'), 'https://app.example.com/s/strict_loon_test?base64&source=normalized');
});

test('Loon fails closed when a structured remote source cannot be counted safely', async () => {
	const runtime = await createRuntimeConfig(env);
	const structuredURL = 'https://structured.example.com/private.yaml?token=do-not-expose';
	const calls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/strict_structured_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		env, {}, runtime, `vless://id@direct.example.com:443#direct\n${structuredURL}`,
		'share', false, 'strict_structured_test', 'Strict structured Loon', {
			fetchImpl: async input => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				calls.push(url);
				return new Response('proxies:\n  - name: remote\n    type: trojan\n    server: edge.example.com\n    port: 443');
			}
		}
	);
	assert.equal(response.status, 502);
	assert.deepEqual(calls.map(url => url.hostname), ['structured.example.com']);
	assert.match(await response.text(), /避免节点缺失或来源泄露/);
});

test('Loon fails closed instead of exposing a remote WARP source', async () => {
	const warpURL = 'https://warp.example.com/private?token=do-not-expose';
	const strictEnv = { ...env, WARP: warpURL };
	const runtime = await createRuntimeConfig(strictEnv);
	let calls = 0;
	const response = await serveSubscription(
		new Request('https://app.example.com/s/strict_warp_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		strictEnv, {}, runtime, 'vless://id@direct.example.com:443#direct',
		'share', true, 'strict_warp_test', 'Strict WARP Loon', { fetchImpl: async () => { calls++; return new Response('[Proxy]\n'); } }
	);
	assert.equal(response.status, 502);
	assert.equal(calls, 0);
	assert.match(await response.text(), /避免节点缺失或来源泄露/);
});

test('too many proxy sources safely fall back to normalized prefetch', async () => {
	const runtime = await createRuntimeConfig(env);
	const sources = Array.from({ length: 9 }, (_, index) => `https://source${index}.example.com/sub`);
	const calls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/proxy_guard_test?clash', { headers: { 'User-Agent': 'Clash/1.18' } }),
		env, {}, runtime, sources.join('\n'), 'share', false, 'proxy_guard_test', 'Proxy guard', {
			fetchImpl: async input => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				calls.push(url);
				return url.hostname === 'subapi.cmliussss.net'
					? new Response('proxies: []')
					: new Response(`trojan://password@edge.example.com:443#${url.hostname}`);
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Source-Mode'), null);
	assert.equal(calls.filter(url => /^source\d+\.example\.com$/.test(url.hostname)).length, 9);
	const converterCall = calls.find(url => url.hostname === 'subapi.cmliussss.net');
	assert.equal(converterCall.searchParams.get('url'), 'https://app.example.com/s/proxy_guard_test?base64&source=normalized');
});
