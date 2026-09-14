import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeConfig } from '../src/worker/config.js';
import { fetchCustomSubscription, fetchConvertedSubscription } from '../src/worker/adapters/converters.js';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveSettings } from '../src/worker/routes/settings.js';
import { readPersistedSettings } from '../src/worker/storage/settings.js';
import { renderMainPage } from '../src/worker/ui/home.js';
import { renderSettingsPage } from '../src/worker/ui/pages.js';

const source = 'https://app.example.com/s/private_subscription_id?base64&source=normalized';
const custom = 'https://custom.example.com/private_gateway_key';
const node = 'trojan://node-secret@node.example.com:443#Node';
const outputs = {
 loon: '[Proxy]\nNode = trojan,node.example.com,443,node-secret',
 quanx: '[server_local]\ntrojan=node.example.com:443, password=node-secret, tag=Node',
 surge: '[Proxy]\nNode = trojan,node.example.com,443,node-secret',
 clash: 'proxies: []', singbox: '{"outbounds":[]}', base64: Buffer.from(node).toString('base64')
};
const runtime = settings => createRuntimeConfig({ ADMIN_PASSWORD: 'secret' }, {
 converterMode: 'custom', customConverterURL: custom, ...settings
});
const serve = async (format, fetchImpl, options = {}) => serveSubscription(
 new Request('https://app.example.com/s/private_subscription_id?' + format, { headers: { 'User-Agent': 'Loon/3.2.4', ...options.headers }, signal: options.signal }),
 {}, {}, await runtime(options.settings), options.sourceData || node, options.access || 'share', false, 'private_subscription_id', 'Share', { ...options, fetchImpl }
);

test('every custom target uses Subconverter and preserves the gateway path without embedding node credentials', async () => {
 for (const [target, content] of Object.entries(outputs)) {
  let calls = 0;
  const result = await fetchCustomSubscription(custom, target, source, {}, {
   configURL: 'https://rules.example.com/config.ini', fetchImpl: async (input, init) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.pathname, '/private_gateway_key/sub');
    assert.equal(url.searchParams.get('target'), target === 'base64' ? 'mixed' : target);
    assert.equal(url.searchParams.get('url'), source);
    assert.equal(url.searchParams.get('config'), 'https://rules.example.com/config.ini');
    assert.doesNotMatch(url.href, /node-secret|node\.example\.com|data%3A/);
    assert.equal(new Headers(init.headers).get('Cache-Control'), 'no-store, no-cache, max-age=0');
    return new Response(content);
   }
  });
  assert.ok(result, target);
  assert.equal(await result.response.text(), content);
  assert.equal(calls, 1);
 }
});

test('HTTP 200 invalid content falls back and fails when defaults also return invalid content', async () => {
 for (const format of ['loon', 'quanx']) {
  for (const content of ['', '<html>Not found</html>', '{"error":"unsupported target"}', 'proxies: []', Buffer.from(node).toString('base64')]) {
   const calls = [], timings = [];
   const response = await serve(format, async input => { calls.push(new URL(input).hostname); return new Response(content); }, { timings });
   assert.equal(response.status, 502);
   assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'failed');
   assert.deepEqual(calls, ['custom.example.com', 'subapi.cmliussss.net']);
   assert.ok(timings.some(value => value.startsWith('conversion_custom;')));
   assert.ok(timings.some(value => value.startsWith('conversion_fallback;')));
  }
 }
});

test('all converted targets attempt defaults after custom HTTP failure for main and shared subscriptions', async () => {
 for (const access of ['main', 'share']) {
  for (const format of ['loon', 'quanx', 'surge', 'clash', 'singbox']) {
   let calls = 0;
   const response = await serve(format, async input => {
    calls++;
    assert.equal(new URL(input).hostname, calls === 1 ? 'custom.example.com' : 'subapi.cmliussss.net');
    return new Response('unavailable', { status: 503 });
   }, { access });
   assert.equal(response.status, 502);
   assert.equal(calls, 2);
  }
 }
});

test('stalled HTTP error bodies are cancelled immediately before fallback', async () => {
 for (const status of [404, 429, 500, 502, 503]) {
  let read = false, cancelled = false, calls = 0;
  const response = await serve('loon', async () => {
   calls++;
   return new Response(new ReadableStream({ pull() { read = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status });
  }, { conversionTimeoutMs: 100 });
  assert.equal(response.status, 502);
  assert.equal(cancelled, true);
  assert.equal(read, false);
  assert.equal(calls, 2);
 }
});

test('default converter backups still skip stalled error bodies', async () => {
 let read = false, cancelled = false;
 const result = await fetchConvertedSubscription([custom, 'https://backup.example.com'], 'loon', source, '', {}, {
  fetchImpl: async input => {
   if (new URL(input).hostname === 'backup.example.com') {
    assert.equal(cancelled, true);
    assert.equal(read, false);
    return new Response(outputs.loon);
   }
   return new Response(new ReadableStream({ pull() { read = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status: 503 });
  }
 });
 assert.equal(result.converter, 'https://backup.example.com');
});

test('network failures fall back while caller cancellation stops further requests', async () => {
 for (const cancel of [false, true]) {
  const controller = new AbortController(), calls = [];
  const response = await serve('loon', async input => {
   calls.push(new URL(input).hostname);
   if (cancel) controller.abort();
   throw new TypeError('connection failed');
  }, { signal: controller.signal });
  assert.equal(response.status, 502);
  assert.deepEqual(calls, cancel ? ['custom.example.com'] : ['custom.example.com', 'subapi.cmliussss.net']);
 }
});

test('legacy invalid active addresses fall back to defaults', async () => {
 for (const customConverterURL of ['', 'invalid']) {
  const response = await serve('loon', async input => { assert.equal(new URL(input).hostname, 'subapi.cmliussss.net'); return new Response(outputs.loon); }, { settings: { customConverterURL } });
  assert.equal(response.status, 200);
 }
});

test('structured upstream Base64 conversion failure returns 502 instead of partial local nodes', async () => {
 const calls = [];
 const response = await serve('base64', async input => {
  const url = new URL(input instanceof Request ? input.url : input);
  calls.push(url.hostname);
  return url.hostname === 'upstream.example.com' ? new Response('proxies: []') : new Response('unavailable', { status: 503 });
 }, { sourceData: node + '\nhttps://upstream.example.com/sub' });
 assert.equal(response.status, 502);
 assert.deepEqual(calls, ['upstream.example.com', 'custom.example.com', 'subapi.cmliussss.net']);
 assert.doesNotMatch(await response.text(), /node-secret/);
});

test('pure node Base64 stays local and converter callbacks never recurse', async () => {
 for (const headers of [{}, { 'User-Agent': 'subconverter/v0.9' }]) {
  const response = await serve('base64', async () => { throw new Error('Unexpected conversion'); }, { headers });
  assert.equal(response.status, 200);
  assert.match(Buffer.from(await response.text(), 'base64').toString(), /node-secret/);
 }
});

test('legacy settings migrate to one active typed profile without losing gateway paths', async () => {
 const env = withStorageBindings({ KV: new MemoryKV(), DB: new MemoryD1() });
 const request = body => new Request('https://app.example.com/api/settings', {
  method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
 });
 const saved = await saveSettings(request({ section: 'conversion', converterMode: 'custom', customConverterURL: custom }), env, {});
 assert.equal(saved.status, 200);
 const stored = await readPersistedSettings(env);
 assert.equal(stored.customConverterURL, custom);
 assert.equal(stored.customConverterType, 'subconverter');
 assert.equal(stored.customConverters.length, 1);
 assert.equal(stored.activeCustomConverterId, 'legacy');
 assert.equal((await createRuntimeConfig({}, stored)).converterMode, 'custom');
 assert.equal((await saveSettings(request({ section: 'conversion', converterMode: 'custom', customConverterURL: '' }), env, stored)).status, 400);
 assert.equal((await readPersistedSettings(env)).customConverterURL, custom);
});

test('main page highlights defaults and settings describe both custom types and fallback', async () => {
 const request = new Request('https://app.example.com');
 const defaultRuntime = await runtime({ converterMode: 'default' });
 const html = await renderMainPage(request, defaultRuntime, { content: node }).text();
 assert.match(html, /role="note"><strong>注意：当前未启用自建转换/);
 assert.match(html, /该服务可读取订阅来源和节点信息/);
 const customRuntime = await runtime();
 const customHTML = await renderMainPage(request, customRuntime, { content: node }).text();
 assert.doesNotMatch(customHTML, /注意：当前未启用自建转换/);
 const settingsHTML = await renderSettingsPage(request, customRuntime).text();
 assert.match(settingsHTML, /Subconverter/);
 assert.match(settingsHTML, /Sublink Worker/);
 assert.match(settingsHTML, /customConverterList/);
 assert.doesNotMatch(settingsHTML, /customConverterType/);
});

test('response headers and diagnostics never expose the gateway key or subscription credentials', async t => {
 const logs = [];
 t.mock.method(console, 'log', line => logs.push(line));
 const response = await serve('loon', async () => new Response(outputs.loon));
 assert.equal(response.status, 200);
 assert.equal(response.headers.get('X-Subconverter-Used'), 'https://custom.example.com');
 assert.doesNotMatch(JSON.stringify([...response.headers]), /private_gateway_key/);
 await serve('loon', async () => new Response('<html>node-secret</html>'));
 assert.doesNotMatch(logs.join('\n'), /node-secret|private_subscription_id|private_gateway_key|node\.example\.com/);
 assert.ok(logs.some(line => JSON.parse(line).event === 'converter.invalid_content'));
 assert.ok(logs.some(line => JSON.parse(line).event === 'converter.complete'));
});

test('notifications identify local, custom and default results without exposing gateway keys', async t => {
 const messages = [];
 t.mock.method(globalThis, 'fetch', async input => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.hostname, 'api.telegram.org');
  messages.push(url.searchParams.get('text'));
  return new Response('{"ok":true}');
 });
 for (const scenario of [
  { mode: 'custom', format: 'base64', fail: false, service: '未调用（无需转换）' },
  { mode: 'custom', format: 'loon', fail: false, service: '自建 Subconverter' },
  { mode: 'custom', format: 'loon', fail: true, service: '默认 Subconverter' },
  { mode: 'default', format: 'loon', fail: false, service: '默认 Subconverter' },
  { mode: 'default', format: 'loon', fail: true, service: '默认 Subconverter' }
 ]) {
  const config = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret', TGTOKEN: 'bot-token', TGID: 'chat-id' }, { converterMode: scenario.mode, customConverterURL: custom });
  const pending = [];
  const response = await serveSubscription(new Request('https://app.example.com/s/notify_unique_' + messages.length + '?' + scenario.format, { headers: { 'User-Agent': 'Loon/3.2.4' } }),
   {}, { waitUntil(task) { pending.push(task); } }, config, node, 'share', false, 'notify_unique_id', 'Share', {
    fetchImpl: async input => {
     assert.ok(['custom.example.com', 'subapi.cmliussss.net'].includes(new URL(input).hostname));
     return scenario.fail ? new Response('failed', { status: 503 }) : new Response(outputs.loon);
    }
   });
  await Promise.all(pending);
  assert.equal(response.status, scenario.fail ? 502 : 200);
  const message = messages.at(-1);
  assert.ok(message.includes('转换服务: ' + scenario.service));
  assert.ok(message.includes('订阅结果: ' + (scenario.fail ? '失败（HTTP 502）' : '成功')));
  if (scenario.fail && scenario.mode === 'custom') assert.match(message, /默认服务也不可用，已停止更新/);
  assert.doesNotMatch(message, /private_gateway_key|node-secret/);
 }
 assert.equal(messages.length, 5);
});
