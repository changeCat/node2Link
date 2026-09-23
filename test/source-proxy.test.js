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

test('Loon converts protected structured sources without exposing their URLs', async () => {
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
				return url.hostname === 'structured.example.com'
					? new Response('proxies:\n  - name: remote\n    type: trojan\n    server: edge.example.com\n    port: 443')
					: new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id\nremote = trojan,edge.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'unverified');
	assert.deepEqual(calls.map(url => url.hostname), ['structured.example.com', 'subapi.cmliussss.net']);
	const sources = calls[1].searchParams.get('url').split('|');
	assert.equal(sources.length, 2);
	assert.match(new URL(sources[1]).pathname, /^\/_node2link\/source\//);
	assert.doesNotMatch(calls[1].href, /structured\.example\.com|do-not-expose/);
});

test('Loon refuses structured sources when an opaque proxy cannot be created', async () => {
	const runtime = await createRuntimeConfig({});
	let converterCalls = 0;
	const response = await serveSubscription(
		new Request('https://app.example.com/s/unprotected_loon_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		{}, {}, runtime, 'vless://id@direct.example.com:443#direct\nhttps://structured.example.com/private.yaml?token=secret',
		'share', false, 'unprotected_loon_test', 'Unprotected Loon', {
			fetchImpl: async input => {
				if (new URL(input instanceof Request ? input.url : String(input)).hostname === 'structured.example.com') return new Response('proxies:\n  - name: remote');
				converterCalls++;
				return new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id');
			}
		}
	);
	assert.equal(response.status, 502);
	assert.equal(converterCalls, 0);
});

test('Loon converts protected remote WARP and includes local WARP only once', async () => {
	const warpURL = 'https://warp.example.com/private?token=do-not-expose';
	const warpNode = 'trojan://password@warp-local.example.com:443#local-warp';
	const warpEnv = { ...env, WARP: warpURL + '\n' + warpNode };
	const runtime = await createRuntimeConfig(warpEnv);
	let converterURL;
	const response = await serveSubscription(
		new Request('https://app.example.com/s/strict_warp_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		warpEnv, {}, runtime, 'vless://id@direct.example.com:443#direct',
		'share', true, 'strict_warp_test', 'Strict WARP Loon', {
			fetchImpl: async input => {
				converterURL = new URL(input instanceof Request ? input.url : String(input));
				return new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id\nwarp = trojan,warp.example.com,443,password\nlocal = trojan,warp-local.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'unverified');
	const sources = converterURL.searchParams.get('url').split('|');
	assert.equal(sources.length, 2);
	assert.equal(new URL(sources[0]).searchParams.get('warp'), '1');
	assert.match(new URL(sources[1]).pathname, /^\/_node2link\/source\//);
	assert.doesNotMatch(converterURL.href, /warp\.example\.com|do-not-expose|warp-local\.example\.com/);
	const callback = await serveSubscription(new Request(sources[0], { headers: { 'User-Agent': 'subconverter/v0.9' } }), warpEnv, {}, runtime, 'vless://id@direct.example.com:443#direct', 'share', true, 'strict_warp_test', 'Strict WARP Loon');
	assert.equal(callback.status, 200);
	const callbackNodes = Buffer.from(await callback.text(), 'base64').toString().trim().split('\n');
	assert.equal(callbackNodes.filter(line => line === warpNode).length, 1);
});

test('Loon counts local WARP nodes in its normalized callback', async () => {
	const warpNode = 'trojan://password@warp-local.example.com:443#local-warp';
	const warpEnv = { ...env, WARP: warpNode };
	const runtime = await createRuntimeConfig(warpEnv);
	let converterSource;
	const response = await serveSubscription(
		new Request('https://app.example.com/s/local_warp_test?loon', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		warpEnv, {}, runtime, 'vless://id@direct.example.com:443#direct',
		'share', true, 'local_warp_test', 'Local WARP Loon', {
			fetchImpl: async input => {
				converterSource = new URL(input instanceof Request ? input.url : String(input)).searchParams.get('url');
				return new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id\nwarp = trojan,warp-local.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
	assert.equal(converterSource.split('|').length, 1);
	assert.equal(new URL(converterSource).searchParams.get('warp'), '1');
	const callback = await serveSubscription(new Request(converterSource, { headers: { 'User-Agent': 'subconverter/v0.9' } }), warpEnv, {}, runtime, 'vless://id@direct.example.com:443#direct', 'share', true, 'local_warp_test', 'Local WARP Loon');
	assert.equal(callback.status, 200);
	const callbackNodes = Buffer.from(await callback.text(), 'base64').toString().trim().split('\n');
	assert.equal(callbackNodes.filter(line => line === warpNode).length, 1);
});

test('structured Base64 sources are encrypted before converter fallback', async () => {
	const runtime = await createRuntimeConfig(env);
	const structuredURL = 'https://structured.example.com/private.yaml?token=do-not-expose';
	const converterCalls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/protected_base64_test?base64'), env, {}, runtime, structuredURL,
		'share', false, 'protected_base64_test', 'Protected Base64', {
			fetchImpl: async input => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				if (url.hostname === 'structured.example.com') return new Response('proxies:\n  - name: remote\n    type: trojan\n    server: edge.example.com\n    port: 443');
				converterCalls.push(url);
				return new Response(btoa('trojan://password@edge.example.com:443#remote'));
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(converterCalls.length, 1);
	const protectedSource = converterCalls[0].searchParams.get('url');
	assert.match(new URL(protectedSource).pathname, /^\/_node2link\/source\//);
	assert.doesNotMatch(converterCalls[0].href, /structured\.example\.com|do-not-expose/);
});

test('structured sources fail closed when no encryption secret is available', async () => {
	const runtime = await createRuntimeConfig({});
	let converterCalls = 0;
	const response = await serveSubscription(
		new Request('https://app.example.com/s/unprotected_base64_test?base64'), {}, {}, runtime,
		'https://structured.example.com/private.yaml?token=do-not-expose', 'share', false,
		'unprotected_base64_test', 'Unprotected Base64', { fetchImpl: async input => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === 'structured.example.com') return new Response('proxies:\n  - name: remote');
			converterCalls++;
			return new Response(btoa('trojan://password@edge.example.com:443#remote'));
		} }
	);
	assert.equal(response.status, 502);
	assert.equal(converterCalls, 0);
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
