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
	assert.equal(new URL(sources[0]).searchParams.has('source'), false);
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
				return new Response('[Proxy]\nupstream = trojan,edge.example.com,443,password');
			}
		}
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Format'), 'loon');
	assert.equal(converterSource, 'https://app.example.com/s/abcdefghijklmnop?base64');
	assert.doesNotMatch(converterSource, /upstream\.example\.com|token=secret/);
});

test('remote diagnostics exclude subscription paths, tokens and response content', t => {
	const lines = [];
	t.mock.method(console, 'log', line => lines.push(line));
	logRemote('upstream.failed', 'https://user:password@example.com/private-id?token=secret', { type: 'TimeoutError' });
	assert.equal(JSON.parse(lines[0]).host, 'example.com');
	assert.doesNotMatch(lines.join(''), /password|private-id|secret/);
});
