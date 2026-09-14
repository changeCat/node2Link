import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, logRemote } from '../src/worker/adapters/http.js';
import { fetchConvertedSubscription } from '../src/worker/adapters/converters.js';
import { getSUB } from '../src/worker/adapters/upstream.js';
import { CONVERTER_FETCH_TIMEOUT_MS, REMOTE_FETCH_TIMEOUT_MS, createRuntimeConfig } from '../src/worker/config.js';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { selectSubscriptionFormat } from '../src/worker/domain/formats.js';

test('remote deadline includes a stalled response body', async () => {
	let cancelled = false;
	const fetchImpl = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial')); }, cancel() { cancelled = true; } }));
	await assert.rejects(fetchWithTimeout('https://example.com', {}, 20, { fetchImpl }), error => error.name === 'TimeoutError');
	assert.equal(cancelled, true);
});

test('stream size limits work without Content-Length', async () => {
	await assert.rejects(fetchWithTimeout('https://example.com', {}, 100, { maxBytes: 2, fetchImpl: async () => new Response('123') }), RangeError);
});

test('a slow converter leaves time for the backup', async () => {
	const attempts = [];
	const result = await fetchConvertedSubscription(['https://slow.example.com', 'https://backup.example.com'], 'clash', 'https://source.example.com', '', {}, {
		timeoutMs: 150, attemptTimeoutMs: 20,
		fetchImpl: async input => {
			attempts.push(new URL(input).hostname);
			return new URL(input).hostname.startsWith('slow') ? new Response(new ReadableStream()) : new Response('proxies: []');
		}
	});
	assert.equal(result.converter, 'https://backup.example.com');
	assert.deepEqual(attempts, ['slow.example.com', 'backup.example.com']);
});

test('conversion body gets a longer deadline while ordinary upstreams stay bounded', async () => {
	assert.equal(REMOTE_FETCH_TIMEOUT_MS, 8000);
	assert.equal(CONVERTER_FETCH_TIMEOUT_MS, 30000);
	const result = await fetchConvertedSubscription(['https://converter.example.com'], 'loon', 'https://source.example.com', '', {}, {
		timeoutMs: 20,
		conversionTimeoutMs: 100,
		fetchImpl: async () => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('[Proxy]\n'));
				setTimeout(() => { controller.enqueue(new TextEncoder().encode('node = trojan,example.com,443,password')); controller.close(); }, 40);
			}
		}))
	});
	assert.equal(result.converter, 'https://converter.example.com');
	assert.match(await result.response.text(), /node = trojan/);
});

test('upstream concurrency is bounded while input ordering is retained', async () => {
	let active = 0, maxActive = 0;
	const sources = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
	const result = await getSUB(sources, new Request('https://app.example.com'), 'v2rayn', '', {
		concurrency: 2,
		fetchImpl: async request => {
			active++; maxActive = Math.max(maxActive, active);
			await new Promise(resolve => setTimeout(resolve, 3));
			active--;
			return new Response('trojan://test@host:443#' + new URL(request.url).pathname.slice(1));
		}
	});
	assert.equal(maxActive, 2);
	assert.deepEqual(result[0].map(line => Number(line.split('#')[1])), Array.from({ length: 10 }, (_, i) => i));
});

test('explicit format parameters override missing and conflicting User-Agent', () => {
	assert.equal(selectSubscriptionFormat(new URL('https://example.com?clash'), null), 'clash');
	assert.equal(selectSubscriptionFormat(new URL('https://example.com?clash'), 'sing-box'), 'clash');
	assert.equal(selectSubscriptionFormat(new URL('https://example.com?base64&clash'), 'Clash'), 'base64');
});

test('conversion resolves ordinary upstreams through its base64 callback; failures do not masquerade as another format', async () => {
	const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' });
	const content = 'trojan://secret@direct.example.com:443#direct\nhttps://upstream.example.com/private?token=secret';
	const calls = [];
	const upstreamNode = 'trojan://upstream@edge.example.com:443#upstream';
	const options = { fetchImpl: async input => {
		const value = input instanceof Request ? input.url : String(input);
		calls.push(value);
		return value.startsWith('https://upstream.example.com/') ? new Response(upstreamNode) : new Response('proxies: []');
	} };
	const response = await serveSubscription(new Request('https://app.example.com/s/abcdefghijklmnop?clash'), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', options);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Format'), 'clash');
	assert.equal(calls.length, 2);
	const converterCall = calls.find(value => new URL(value).hostname.toLowerCase() === 'subapi.cmliussss.net');
	const sources = new URL(converterCall).searchParams.get('url').split('|');
	assert.equal(sources.length, 1);
	assert.equal(new URL(sources[0]).searchParams.get('source'), 'normalized');
	const callback = await serveSubscription(new Request(sources[0], { headers: { 'User-Agent': 'subconverter/v0.9' } }), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', { fetchImpl: async () => new Response(upstreamNode) });
	const callbackContent = Buffer.from(await callback.text(), 'base64').toString();
	assert.match(callbackContent, /direct\.example\.com/);
	assert.match(callbackContent, /edge\.example\.com/);
	const failed = await serveSubscription(new Request('https://app.example.com/s/abcdefghijklmnop?clash'), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', { fetchImpl: async () => new Response('failed', { status: 503 }) });
	assert.equal(failed.status, 502);
	assert.match(await failed.text(), /订阅转换失败/);
});

test('adaptive Loon keeps ordinary upstream URLs behind the normalized callback', async () => {
	const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' });
	const upstreamURL = 'https://upstream.example.com/private?token=secret';
	let converterSource = '';
	const response = await serveSubscription(
		new Request('https://app.example.com/s/abcdefghijklmnop', { headers: { 'User-Agent': 'Loon/3.2.4' } }),
		{}, {}, runtime, `vless://id@direct.example.com:443#direct\n${upstreamURL}`, 'share', false, 'abcdefghijklmnop', 'Share', {
			fetchImpl: async input => {
				const value = input instanceof Request ? input.url : String(input);
				if (value === upstreamURL) return new Response('trojan://upstream@edge.example.com:443#upstream');
				converterSource = new URL(value).searchParams.get('url');
				return new Response('[Proxy]\ndirect = VLESS,direct.example.com,443,id,transport=ws\nupstream = trojan,edge.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Format'), 'loon');
	assert.equal(converterSource, 'https://app.example.com/s/abcdefghijklmnop?base64&source=normalized');
	assert.doesNotMatch(converterSource, /upstream\.example\.com|token=secret/);
});

test('every converted format tries custom first and preserves callback-only node delivery', async () => {
 const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' }, { converterMode: 'custom', customConverterURL: 'https://custom.example.com' });
 const outputs = {
  loon: '[Proxy]\nnode = trojan,example.com,443,password',
  quanx: '[server_local]\ntrojan=example.com:443, password=password, tag=node',
  clash: 'proxies: []', singbox: '{"outbounds":[]}', surge: '[Proxy]\nnode = trojan,example.com,443,password'
 };
 for (const [format, content] of Object.entries(outputs)) {
  const calls = [];
  const timings = [];
  const response = await serveSubscription(new Request('https://app.example.com/s/abcdefghijklmnop?' + format, { headers: { 'User-Agent': 'Loon/3.2.4' } }), {}, {}, runtime,
   'trojan://private-password@example.com:443#node', 'share', false, 'abcdefghijklmnop', 'Share', { timings, fetchImpl: async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(url.hostname, 'custom.example.com');
    assert.equal(url.pathname, '/sub');
    assert.equal(url.searchParams.get('target'), format);
    assert.equal(url.searchParams.get('url'), 'https://app.example.com/s/abcdefghijklmnop?base64&source=normalized');
    assert.doesNotMatch(url.href, /private-password|data%3A/);
    assert.equal(new Headers(init.headers).get('Cache-Control'), 'no-store, no-cache, max-age=0');
    return new Response(content);
   } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'custom');
  assert.equal(response.headers.get('X-Subconverter-Used'), 'https://custom.example.com');
  assert.equal(calls.length, 1);
  assert.ok(timings.some(value => value.startsWith('conversion_custom;')));
  assert.ok(!timings.some(value => value.startsWith('conversion_fallback;')));
 }
});

test('custom Subconverter failure falls back and reports the actual service in the notification', async t => {
	const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret', TGTOKEN: 'bot-token', TGID: 'chat-id' }, {
		converterMode: 'custom',
		customConverterURL: 'https://custom.example.com'
	});
	const converterCalls = [];
	const telegramMessages = [];
	t.mock.method(globalThis, 'fetch', async input => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		telegramMessages.push(url.searchParams.get('text'));
		return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
	});
	const pending = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/fallback-notice-id?clash&case=custom-fallback', { headers: { 'User-Agent': 'Clash/1.0' } }),
		{}, { waitUntil(task) { pending.push(task); } }, runtime,
		'trojan://id@example.com:443#node', 'share', false, 'fallback-notice-id', 'Fallback notice', {
			fetchImpl: async input => {
				const value = input instanceof Request ? input.url : String(input);
				converterCalls.push(value);
				return new URL(value).hostname === 'custom.example.com'
					? new Response('unavailable', { status: 503 })
					: new Response('proxies: []');
			}
		}
	);
	await Promise.all(pending);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'fallback');
	assert.equal(response.headers.get('X-Subconverter-Used'), 'https://subapi.cmliussss.net');
	assert.deepEqual(converterCalls.map(value => new URL(value).hostname), ['custom.example.com', 'subapi.cmliussss.net']);
	assert.equal(telegramMessages.length, 1);
	assert.ok(telegramMessages[0].includes('转换服务: 默认 Subconverter（https://subapi.cmliussss.net）'));
	assert.match(telegramMessages[0], /订阅结果: 成功/);
	assert.match(telegramMessages[0], /回退结果: 已使用默认服务/);
});

test('an unreachable custom Subconverter leaves time for the default service', async () => {
	const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' }, {
		converterMode: 'custom',
		customConverterURL: 'https://custom.example.com'
	});
	const calls = [];
	const response = await serveSubscription(
		new Request('https://app.example.com/s/custom-timeout-id?surge'), {}, {}, runtime,
		'trojan://id@example.com:443#node', 'share', false, 'custom-timeout-id', 'Custom timeout', {
			conversionTimeoutMs: 200, customAttemptTimeoutMs: 20,
			fetchImpl: async input => {
				const value = input instanceof Request ? input.url : String(input);
				calls.push(value);
				return new URL(value).hostname === 'custom.example.com'
					? new Response(new ReadableStream())
					: new Response('[Proxy]\nnode = trojan,example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'fallback');
	assert.deepEqual(calls.map(value => new URL(value).hostname), ['custom.example.com', 'subapi.cmliussss.net']);
});

test('remote diagnostics exclude subscription paths, tokens and response content', t => {
	const lines = [];
	t.mock.method(console, 'log', line => lines.push(line));
	logRemote('upstream.failed', 'https://user:password@example.com/private-id?token=secret', { type: 'TimeoutError' });
	assert.equal(JSON.parse(lines[0]).host, 'example.com');
	assert.doesNotMatch(lines.join(''), /password|private-id|secret/);
});
