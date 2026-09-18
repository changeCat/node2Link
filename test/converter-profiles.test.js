import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeConfig, DEFAULT_SUB_CONFIG } from '../src/worker/config.js';
import { fetchCustomSubscription } from '../src/worker/adapters/converters.js';
import { serveSubscription } from '../src/worker/services/subscription.js';
import { saveSettings } from '../src/worker/routes/settings.js';
import { readPersistedSettings } from '../src/worker/storage/settings.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';

const node = 'trojan://fake-secret@node.example.com:443#Node';
const profiles = [
 { id: 'vps', name: 'VPS', type: 'subconverter', url: 'https://vps.example.com/private-key' },
 { id: 'worker', name: 'Worker', type: 'sublink', url: 'https://worker.example.com/private-key' }
];
const outputs = { clash: 'proxies: []', singbox: '{"outbounds":[]}', surge: '[Proxy]\nNode = trojan,node.example.com,443,fake-secret', loon: '[Proxy]\nNode = trojan,node.example.com,443,fake-secret', quanx: '[server_local]\ntrojan=node.example.com:443,password=fake-secret,tag=Node', base64: Buffer.from(node).toString('base64') };
async function serve(active, format, fetchImpl, extra = {}) {
 const runtime = await createRuntimeConfig({ ADMIN_PASSWORD: 'test' }, { converterMode: 'custom', customConverters: profiles, activeCustomConverterId: active });
 return serveSubscription(new Request('https://app.example.com/s/profile_test_id?' + format, extra.requestInit), {}, {}, runtime, extra.source || node, 'share', false, 'profile_test_id', 'Nodes', { ...extra, fetchImpl });
}
const settingsRequest = payload => new Request('https://app.example.com/api/settings', { method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'conversion', converterMode: 'custom', ...payload }) });

test('multiple profiles persist in D1 and exactly the selected profile enters runtime', async () => {
 const env = withStorageBindings({ KV: new MemoryKV(), DB: new MemoryD1() });
 const response = await saveSettings(settingsRequest({ customConverters: profiles, activeCustomConverterId: 'worker' }), env, {});
 assert.equal(response.status, 200);
 const stored = await readPersistedSettings(env);
 assert.deepEqual(stored.customConverters, profiles);
 const runtime = await createRuntimeConfig({}, stored);
 assert.equal(runtime.customConverterType, 'sublink');
 assert.equal(runtime.customConverterURL, profiles[1].url);
 assert.equal(runtime.activeCustomConverterId, 'worker');
 const before = JSON.stringify(stored);
 for (const payload of [
  { customConverters: profiles, activeCustomConverterId: 'missing' },
  { customConverters: [profiles[0], profiles[0]], activeCustomConverterId: 'vps' },
  { customConverters: [{ ...profiles[0], type: 'unknown' }], activeCustomConverterId: 'vps' },
  { customConverters: [{ ...profiles[0], url: 'javascript:invalid' }], activeCustomConverterId: 'vps' },
  { customConverters: Array.from({ length: 11 }, (_, i) => ({ ...profiles[0], id: 'p' + i })), activeCustomConverterId: 'p0' },
  { customConverters: [], activeCustomConverterId: '' }
 ]) {
  assert.equal((await saveSettings(settingsRequest(payload), env, stored)).status, 400);
  assert.equal(JSON.stringify(await readPersistedSettings(env)), before);
 }
 const defaultResponse = await saveSettings(settingsRequest({ converterMode: 'default', customConverters: profiles, activeCustomConverterId: 'vps' }), env, stored);
 assert.equal(defaultResponse.status, 200);
 assert.equal((await createRuntimeConfig({}, await readPersistedSettings(env))).converterMode, 'default');
});

test('single-address migrations preserve current Subconverter and explicitly stored Sublink types', async () => {
 for (const type of [undefined, 'sublink']) {
  const runtime = await createRuntimeConfig({}, { converterMode: 'custom', customConverterURL: profiles[0].url, customConverterType: type });
  assert.equal(runtime.customConverters.length, 1);
  assert.equal(runtime.customConverterURL, profiles[0].url);
  assert.equal(runtime.customConverterType, type || 'subconverter');
 }
 const empty = await createRuntimeConfig({}, { converterMode: 'custom', customConverters: [], activeCustomConverterId: '', customConverterURL: profiles[0].url });
 assert.equal(empty.customConverterURL, ''); // Explicitly deleted lists never resurrect legacy addresses.
});

test('Sublink uses its target endpoint and newline-separated callback URLs', async () => {
 for (const target of ['clash', 'singbox', 'surge', 'base64']) {
  const result = await fetchCustomSubscription(profiles[1].url, target, 'https://app.example.com/s/source?base64&source=normalized|https://upstream.example.com/sub', {}, {
   converterType: 'sublink', configURL: 'https://rules.example.com/config.ini', fetchImpl: async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/private-key/' + (target === 'base64' ? 'xray' : target));
    assert.equal(url.searchParams.get('config'), 'https://app.example.com/s/source?base64&source=normalized\nhttps://upstream.example.com/sub');
    assert.doesNotMatch(url.href, /fake-secret|rules.example.com|data%3A/);
    return new Response(outputs[target]);
   }
  });
  assert.ok(result, target);
 }
});

test('only the active profile is attempted and failure goes straight to default', async () => {
 for (const active of ['vps', 'worker']) {
  for (const fail of [false, true]) {
   const calls = [];
   const response = await serve(active, 'clash', async input => {
    const url = new URL(input); calls.push(url.hostname);
    if (fail && url.hostname !== 'subapi.cmliussss.net') return new Response('unavailable', { status: 503 });
    return new Response(outputs.clash);
   });
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('X-Node2Link-Converter-Route'), fail ? 'fallback' : 'custom');
   assert.deepEqual(calls, fail ? [active + '.example.com', 'subapi.cmliussss.net'] : [active + '.example.com']);
  }
 }
});

test('Sublink Loon and QuanX support is determined by actual responses, including after an upgrade', async () => {
 for (const target of ['loon', 'quanx']) {
  for (const customOutput of [null, '<html>missing endpoint</html>', outputs[target]]) {
   const calls = [];
   const response = await serve('worker', target, async input => {
    const url = new URL(input); calls.push(url.hostname);
    if (url.hostname === 'worker.example.com') {
     assert.equal(url.pathname, '/private-key/' + target);
     assert.match(url.searchParams.get('config'), /source=normalized/);
     return customOutput === null ? new Response('missing', { status: 404 }) : new Response(customOutput);
    }
    return new Response(outputs[target]);
   });
   const supported = customOutput === outputs[target];
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('X-Node2Link-Converter-Route'), supported ? 'custom' : 'fallback');
   assert.deepEqual(calls, supported ? ['worker.example.com'] : ['worker.example.com', 'subapi.cmliussss.net']);
  }
 }
});

test('rule configuration is fixed in code and cannot be overridden through old settings or the API', async () => {
 const runtime = await createRuntimeConfig({ SUBCONFIG: 'https://environment.example.com/rules.ini' }, { ruleMode: 'custom', customSubConfigURL: 'https://old.example.com/rules.ini' });
 assert.equal(runtime.subConfig, DEFAULT_SUB_CONFIG);
 assert.equal('ruleMode' in runtime, false);
 const env = withStorageBindings({ KV: new MemoryKV(), DB: new MemoryD1() });
 const response = await saveSettings(settingsRequest({ customConverters: profiles, activeCustomConverterId: 'vps', ruleMode: 'custom', customSubConfigURL: 'https://new.example.com/rules.ini' }), env, {});
 assert.equal(response.status, 400);
 assert.match(await response.text(), /不支持自定义/);
});

test('normalized callbacks cannot recursively convert structured sources with a Sublink user agent', async () => {
 const calls = [];
 const response = await serve('worker', 'base64&source=normalized', async input => {
  const url = new URL(input instanceof Request ? input.url : input); calls.push(url.hostname);
  assert.equal(url.hostname, 'upstream.example.com');
  return new Response('proxies: []');
 }, { source: node + '\nhttps://upstream.example.com/sub', requestInit: { headers: { 'User-Agent': 'Sublink-Worker' } } });
 assert.equal(response.status, 200);
 assert.equal(Buffer.from(await response.text(), 'base64').toString().trim(), node);
 assert.deepEqual(calls, ['upstream.example.com']);
});

test('upstream failure stops partial Base64 delivery without any converter request', async () => {
 const calls = [];
 const response = await serve('vps', 'base64', async input => {
  const url = new URL(input instanceof Request ? input.url : input); calls.push(url.hostname);
  return new Response('failed', { status: 503 });
 }, { source: node + '\nhttps://upstream.example.com/sub' });
 assert.equal(response.status, 502);
 assert.deepEqual(calls, ['upstream.example.com', 'upstream.example.com']);
 assert.doesNotMatch(await response.text(), /fake-secret/);
});

test('structured Base64 conversion falls back with no recursive conversion or inactive-profile calls', async () => {
 const calls = [];
 const response = await serve('worker', 'base64', async input => {
  const url = new URL(input instanceof Request ? input.url : input); calls.push(url.hostname);
  if (url.hostname === 'upstream.example.com') return new Response('proxies: []');
  if (url.hostname === 'worker.example.com') return new Response('<html>error</html>');
  assert.equal(url.searchParams.get('target'), 'mixed');
  return new Response(Buffer.from('vless://fake-id@other.example.com:443#Other').toString('base64'));
 }, { source: node + '\nhttps://upstream.example.com/sub' });
 assert.equal(response.status, 200);
 assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'fallback');
 const content = Buffer.from(await response.text(), 'base64').toString();
 assert.match(content, /trojan:\/\//);
 assert.match(content, /vless:\/\//);
 assert.deepEqual(calls, ['upstream.example.com', 'worker.example.com', 'subapi.cmliussss.net']);
});
