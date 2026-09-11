import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, logRemote } from '../src/worker/adapters/http.js';
import { fetchConvertedSubscription } from '../src/worker/adapters/converters.js';
import { getSUB } from '../src/worker/adapters/upstream.js';
import { createRuntimeConfig } from '../src/worker/config.js';
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

test('conversion passes a direct callback and upstream once; failures do not masquerade as another format', async () => {
	const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' });
	const content = 'trojan://secret@direct.example.com:443#direct\nhttps://upstream.example.com/private?token=secret';
	const calls = [];
	const options = { fetchImpl: async input => { calls.push(String(input)); return new Response('proxies: []'); } };
	const response = await serveSubscription(new Request('https://app.example.com/s/abcdefghijklmnop?clash'), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', options);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('X-Node2Link-Format'), 'clash');
	assert.equal(calls.length, 1);
	const sources = new URL(calls[0]).searchParams.get('url').split('|');
	assert.equal(new URL(sources[0]).searchParams.get('source'), 'direct');
	assert.equal(sources[1], 'https://upstream.example.com/private?token=secret');
	const callback = await serveSubscription(new Request(sources[0]), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', { fetchImpl: async () => { throw new Error('must not refetch upstream'); } });
	assert.equal(Buffer.from(await callback.text(), 'base64').toString(), 'trojan://secret@direct.example.com:443#direct\n');
	const failed = await serveSubscription(new Request('https://app.example.com/s/abcdefghijklmnop?clash'), {}, {}, runtime, content, 'share', false, 'abcdefghijklmnop', 'Share', { fetchImpl: async () => new Response('failed', { status: 503 }) });
	assert.equal(failed.status, 502);
	assert.match(await failed.text(), /订阅转换失败/);
});

test('remote diagnostics exclude subscription paths, tokens and response content', t => {
	const lines = [];
	t.mock.method(console, 'log', line => lines.push(line));
	logRemote('upstream.failed', 'https://user:password@example.com/private-id?token=secret', { type: 'TimeoutError' });
	assert.equal(JSON.parse(lines[0]).host, 'example.com');
	assert.doesNotMatch(lines.join(''), /password|private-id|secret/);
});
