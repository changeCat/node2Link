import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64, splitSubscriptionLinks } from '../src/worker/domain/nodes.js';
import { createRuntimeConfig, DEFAULT_SUB_CONVERTER, DEFAULT_SUB_CONFIG } from '../src/worker/config.js';
import { getSUB } from '../src/worker/adapters/upstream.js';
import { serveSubscription } from '../src/worker/services/subscription.js';

const node = 'vless://id@node.example.com:443#Test';

test('UTF-8 Base64 matches the platform oracle across padding, Unicode and large chunk boundaries', () => {
 const samples = ['', 'f', 'fo', 'foo', 'café', '香港节点 🚀', '\u0000\u00ff', '\ud800', '汉🚀'.repeat(300000)];
 for (const length of [24575, 24576, 24577, 49151, 49152, 49153]) samples.push('x'.repeat(length) + 'é汉🚀');
 for (const text of samples) assert.equal(encodeBase64(text), Buffer.from(text, 'utf8').toString('base64'));
});

test('subscription link splitting handles legacy separators and whitespace without altering encoded URLs or ordering', () => {
 const url = 'https://source.example.com/sub?token=a%7Cb%27c%22d#My Name';
 assert.deepEqual(splitSubscriptionLinks(' \t"' + node + '" | \r\n' + url + "'" + node + '\n '), [node, url, node]);
 for (const input of [null, undefined, '', String.fromCharCode(32, 13, 10, 9, 124, 34, 39)]) assert.deepEqual(splitSubscriptionLinks(input), []);
});

test('default branding uses node2Link and persisted titles retain precedence', async () => {
 const defaults = await createRuntimeConfig({});
 assert.equal(defaults.FileName, 'node2Link'); assert.equal(defaults.pageTitle, 'node2Link');
 assert.deepEqual(defaults.subConverters, [DEFAULT_SUB_CONVERTER]); assert.equal(defaults.subConfig, DEFAULT_SUB_CONFIG);
 const fromEnv = await createRuntimeConfig({ SUBNAME: 'Environment title' });
 assert.equal(fromEnv.FileName, 'Environment title');
 const configured = await createRuntimeConfig({ SUBNAME: 'Environment title' }, { subscriptionName: 'My subscription', pageTitle: 'My console' });
 assert.equal(configured.FileName, 'My subscription'); assert.equal(configured.pageTitle, 'My console');
});

test('upstream requests identify node2Link while retaining client compatibility and excluding private headers', async () => {
 const incoming = new Request('https://app.example.com/', { headers: { Cookie: 'private', Authorization: 'Bearer private', Accept: 'text/plain' } });
 const result = await getSUB(['https://source.example.com/sub'], incoming, 'clash', 'Client/1.0', {
  fetchImpl: async request => {
   assert.equal(request.headers.get('User-Agent'), 'v2rayN/6.45 node2Link clash (Client/1.0)');
   assert.equal(request.headers.get('Accept'), 'text/plain');
   assert.equal(request.headers.get('Cookie'), null); assert.equal(request.headers.get('Authorization'), null);
   return new Response('  ' + node + '\r\n');
  }
 });
 assert.deepEqual(result[0], [node]); assert.equal(result.failures, 0);
});

test('subscription responses preserve Latin-1 and Unicode names and brand converter fallback requests', async () => {
 const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret' });
 for (const name of ['café', '香港 🚀']) {
  const content = node.replace('#Test', '#' + name);
  const response = await serveSubscription(new Request('https://app.example.com/?base64'), {}, {}, runtime, content, 'main', false);
  assert.equal(Buffer.from(await response.text(), 'base64').toString('utf8').trim(), content);
  assert.equal(Buffer.from(response.headers.get('Profile-Title').slice(7), 'base64').toString(), 'node2Link');
 }
 let requests = 0;
 const converted = await serveSubscription(new Request('https://app.example.com/?clash'), {}, {}, runtime, node, 'main', false, '', '', {
  fetchImpl: async (_url, init) => {
   requests++; assert.equal(new Headers(init.headers).get('User-Agent'), 'node2Link');
   return new Response('proxies: []');
  }
 });
 assert.equal(converted.status, 200); assert.equal(requests, 1);
 let mixedRequests = 0;
 const mixed = await serveSubscription(new Request('https://app.example.com/?base64'), { ADMIN_PASSWORD: 'secret' }, {}, runtime, 'https://source.example.com/sub', 'main', false, '', '', {
  fetchImpl: async (url, init) => {
   if (url instanceof Request) return new Response('proxies: []');
   mixedRequests++; assert.equal(new Headers(init.headers).get('User-Agent'), 'v2rayN/6.45 node2Link');
   return new Response(Buffer.from(node).toString('base64'));
  }
 });
 assert.equal(mixed.status, 200); assert.equal(mixedRequests, 1);
});
