import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreLoonPortHopping, LoonPortHoppingError } from '../src/worker/domain/loon-port-hopping.js';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { createRuntimeConfig } from '../src/worker/config.js';

const source = 'hysteria2://secret@edge.example.com:29229?insecure=1&mport=40001-40030#Original';
const line = 'Renamed = Hysteria2,edge.example.com,29229,"secret",skip-cert-verify=true,udp=true,download-bandwidth=100';

test('restores dropped hopping ports and defaults to 30 seconds without changing other fields', () => {
	const output = '[Proxy]\r\n' + line + '\r\n[Rule]\r\nFINAL,Renamed\r\n';
	const expected = '[Proxy]\r\n' + line + ',server-ports="40001:40030",hop-interval=30\r\n[Rule]\r\nFINAL,Renamed\r\n';
	assert.equal(restoreLoonPortHopping(source, output), expected);
	assert.equal(restoreLoonPortHopping(source, expected), expected);
});

test('source ports override stale converter ports and valid explicit intervals survive', () => {
	const output = line + ',server-ports="1:10",hop-interval=60,server-ports="20:30"';
	assert.equal(restoreLoonPortHopping(source, output), line + ',server-ports="40001:40030",hop-interval=60');
	assert.match(restoreLoonPortHopping(source, line + ',hop-interval=0'), /hop-interval=30$/);
});

test('uses credentials rather than node names or ordering to match the correct node', () => {
	const second = source.replace('secret@', 'other@').replace('40001-40030', '41001-41030');
	const otherLine = line.replace('"secret"', '"other"');
	const untouched = line.replace('"secret"', '"unrelated"');
	const result = restoreLoonPortHopping(source + '\n' + second, otherLine + '\n' + line + '\n' + untouched);
	assert.equal(result, otherLine + ',server-ports="41001:41030",hop-interval=30\n' + line + ',server-ports="40001:40030",hop-interval=30\n' + untouched);
});

test('supports hy2 aliases, IPv6, omitted source ports, and encoded quoted credentials', () => {
	const raw = 'hy2://' + encodeURIComponent('user:pa,ss"word\\end') + '@[2001:db8::1]?mport=443%2C40001-40030';
	const output = 'IPv6 = Hysteria2,[2001:db8::1],443,"user:pa,ss\\"word\\\\end",udp=true';
	assert.equal(restoreLoonPortHopping(raw, output), output + ',server-ports="443,40001:40030",hop-interval=30');
});

test('normalizes ranges and equivalent duplicate sources without expanding port lists', () => {
	const raw = source.replace('40001-40030', '40001%3A40020%2C40021-40030%2C40001');
	assert.equal(restoreLoonPortHopping(raw + '\n' + source, line), line + ',server-ports="40001:40030",hop-interval=30');
});

test('keeps nodes without mport and non-proxy sections unchanged', () => {
	assert.equal(restoreLoonPortHopping(source.replace('&mport=40001-40030', ''), line), line);
	const profile = '[Proxy]\n' + line + '\n[Remote Proxy]\n' + line;
	assert.equal(restoreLoonPortHopping(source, profile), '[Proxy]\n' + line + ',server-ports="40001:40030",hop-interval=30\n[Remote Proxy]\n' + line);
});

test('rejects invalid or ambiguous source ranges and unmatched conversion without exposing credentials', () => {
	for (const ports of ['', '0', '65536', '40030-40001', '40001,,40030', '40001-40030"\n[Rule]']) {
		assert.throws(() => restoreLoonPortHopping(source.replace('40001-40030', encodeURIComponent(ports)), line), LoonPortHoppingError);
	}
	for (const raw of [source + '\n' + source.replace('40001-40030', '41001-41030'), source + '\n' + source.replace('&mport=40001-40030', '')]) {
		assert.throws(() => restoreLoonPortHopping(raw, line), LoonPortHoppingError);
	}
	assert.throws(() => restoreLoonPortHopping(source, line.replace('"secret"', '"different"')), error => {
		assert.doesNotMatch(error.message, /secret|edge\.example/);
		return error instanceof LoonPortHoppingError;
	});
});

test('main, shared, explicit and adaptive Loon subscriptions repair converter output', async () => {
	const env = { ADMIN_PASSWORD: 'test-secret' };
	const runtime = await createRuntimeConfig(env);
	for (const access of ['main', 'share']) {
		for (const query of ['?loon', '']) {
			const response = await serveSubscription(new Request('https://app.example/s/hopping' + query, { headers: { 'User-Agent': 'Loon/996' } }),
				env, {}, runtime, source, access, false, 'hopping', 'Test', { fetchImpl: async () => new Response('[Proxy]\n' + line) });
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
			assert.match(await response.text(), /server-ports="40001:40030",hop-interval=30/);
		}
	}
});

test('Loon falls back when hopping nodes cannot be matched, and fails closed if none can preserve them', async () => {
	const env = { ADMIN_PASSWORD: 'test-secret', SUBAPI: 'https://first.example,https://second.example' };
	const runtime = await createRuntimeConfig(env);
	for (const recover of [true, false]) {
		const calls = [];
		const response = await serveSubscription(new Request('https://app.example/s/hopping?loon'), env, {}, runtime,
			source, 'share', false, 'hopping', 'Test', { fetchImpl: async input => {
				const host = new URL(input).hostname;
				calls.push(host);
				return new Response('[Proxy]\n' + (recover && host === 'second.example' ? line : line.replace('"secret"', '"different"')));
			} });
		assert.deepEqual(calls, ['first.example', 'second.example']);
		assert.equal(response.status, recover ? 200 : 502);
		if (recover) assert.match(await response.text(), /hop-interval=30/);
		else assert.doesNotMatch(await response.text(), /secret|edge\.example/);
	}
});

test('Base64 and other converter formats retain their existing output', async () => {
	const env = { ADMIN_PASSWORD: 'test-secret' };
	const runtime = await createRuntimeConfig(env);
	const base64 = await serveSubscription(new Request('https://app.example/s/hopping?base64'), env, {}, runtime, source, 'share', false);
	assert.equal(Buffer.from(await base64.text(), 'base64').toString().trim(), source);
	const clash = 'proxies: []';
	const converted = await serveSubscription(new Request('https://app.example/s/hopping?clash'), env, {}, runtime, source, 'share', false, '', '', {
		fetchImpl: async () => new Response(clash)
	});
	assert.equal(converted.status, 200);
	assert.doesNotMatch(await converted.text(), /server-ports|hop-interval/);
});
