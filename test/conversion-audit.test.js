import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLoonConversion, summarizeNodeProtocols } from '../src/worker/domain/conversion-audit.js';
import { createRuntimeConfig } from '../src/worker/config.js';
import { serveSubscription } from '../src/worker/services/subscription.js';

const vlessNodes = Array.from({ length: 14 }, (_, i) => 'vless://00000000-0000-4000-8000-' + String(i).padStart(12, '0') + '@vless' + i + '.example.com:443?type=ws&security=tls#VLESS' + i);
const hy2Nodes = Array.from({ length: 4 }, (_, i) => 'hy2://fictional-password@hy' + i + '.example.com:443?sni=example.com#HY' + i);
const source = [...vlessNodes, ...hy2Nodes].join('\n');
const hy2Output = hy2Nodes.map((_, i) => 'HY' + i + ' = Hysteria2,hy' + i + '.example.com,443,"fictional-password"').join('\n');
const vlessOutput = vlessNodes.map((_, i) => 'VLESS' + i + ' = VLESS,vless' + i + '.example.com,443,"fictional-id",transport=ws').join('\n');
const fullOutput = '[Proxy]\n' + vlessOutput + '\n' + hy2Output;

test('Loon audit catches 18 nodes becoming 4 with VLESS missing', () => {
 const audit = inspectLoonConversion(source, '[Proxy]\n' + hy2Output);
 assert.equal(audit.inputCount, 18);
 assert.equal(audit.outputCount, 4);
 assert.deepEqual(audit.missing, [{ protocol: 'vless', count: 14 }]);
 assert.equal(audit.check, 'incomplete');
 assert.equal(inspectLoonConversion(source, fullOutput).check, 'counts-match');
});

test('protocol losses are detected even when other protocols inflate the total count', () => {
 const inflated = Array.from({ length: 18 }, (_, i) => 'HY' + i + ' = hysteria2,host.example.com,443,password').join('\n');
 const audit = inspectLoonConversion(source, inflated);
 assert.equal(audit.outputCount, 18);
 assert.equal(audit.check, 'incomplete');
 assert.deepEqual(audit.missing, [{ protocol: 'vless', count: 14 }]);
});

test('counts ignore comments and proxy groups, canonicalize aliases and deduplicate identical source lines', () => {
 const input = 'hy2://secret@host:443#Node\nhy2://secret@host:443#Node\nhttps://upstream.example.com/sub';
 assert.deepEqual(summarizeNodeProtocols(input), { hysteria2: 1 });
 const audit = inspectLoonConversion(input, '# ignore = vless,host,443,id\n[Proxy]\n"Node = special" = Hysteria2,host,443,password\n[Proxy Group]\nVLESS = select,Node\n[Rule]\nFINAL,DIRECT');
 assert.equal(audit.inputCount, 1);
 assert.equal(audit.outputCount, 1);
 assert.equal(audit.check, 'counts-match');
});

test('remote resources and partially known sources are never claimed to be fully checked', () => {
 const remote = inspectLoonConversion(source, '[Proxy]\n' + hy2Output + '\n[Remote Proxy]\nRemote = https://source.example.com/base64');
 assert.equal(remote.hasRemoteNodes, true);
 assert.equal(remote.check, 'unverified');
 assert.deepEqual(remote.missing, []);
 assert.equal(inspectLoonConversion(source, fullOutput, { completeSource: false }).check, 'unverified');
 assert.equal(inspectLoonConversion(source, '[Proxy]\n' + hy2Output, { completeSource: false }).check, 'incomplete');
});

async function requestSubscription({ userAgent = 'Loon/975', output = fullOutput, mode = 'custom', env = {}, ctx = {}, suffix = '' } = {}) {
 const config = await createRuntimeConfig({ ADMIN_PASSWORD: 'secret', ...env }, { converterMode: mode, customConverterURL: 'https://custom.example.com/gateway-secret' });
 const calls = [];
 const response = await serveSubscription(new Request('https://app.example.com/s/audit_subscription_id' + suffix, { headers: { 'User-Agent': userAgent } }), {}, ctx, config, source, 'share', false, 'audit_subscription_id', 'Nodes', {
  fetchImpl: async input => {
   const url = new URL(input);
   calls.push(url);
   assert.equal(url.searchParams.get('target'), 'loon');
   assert.equal(url.searchParams.get('url'), 'https://app.example.com/s/audit_subscription_id?base64&source=normalized');
   return new Response(typeof output === 'function' ? output(url) : output);
  }
 });
 return { response, calls };
}

test('custom and default Loon outputs cannot silently discard VLESS', async () => {
 for (const mode of ['custom', 'default']) {
  const { response, calls } = await requestSubscription({ mode, output: '[Proxy]\n' + hy2Output });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /VLESS 14 个/);
  assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'incomplete');
  assert.equal(response.headers.get('X-Node2Link-Input-Nodes'), '18');
  assert.equal(response.headers.get('X-Node2Link-Output-Nodes'), '4');
  assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'failed');
  assert.equal(calls.length, mode === 'custom' ? 2 : 1);
  assert.equal(calls[0].hostname, mode === 'custom' ? 'custom.example.com' : 'subapi.cmliussss.net');
 }
});

test('all clients use the same format-based policy and retain all 18 supported nodes', async () => {
 for (const userAgent of ['v2rayN/7.24.9', 'Shadowrocket/3445', 'Loon/975']) {
  const { response, calls } = await requestSubscription({ userAgent });
  assert.equal(response.status, 200);
  if (userAgent.startsWith('Loon')) {
   assert.equal(calls.length, 1);
   assert.equal(calls[0].hostname, 'custom.example.com');
   assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
   assert.equal(await response.text(), fullOutput);
  } else {
   assert.equal(calls.length, 0);
   assert.equal(Buffer.from(await response.text(), 'base64').toString().trim(), source);
  }
 }
});

test('node loss notification includes safe counts, target and selected converter, without node secrets', async t => {
 const messages = [], pending = [], logs = [];
 t.mock.method(console, 'log', line => logs.push(line));
 t.mock.method(globalThis, 'fetch', async input => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.hostname, 'api.telegram.org');
  messages.push(url.searchParams.get('text'));
  return new Response('{"ok":true}');
 });
 const { response } = await requestSubscription({ output: '[Proxy]\n' + hy2Output, env: { TGTOKEN: 'fake-token', TGID: 'fake-chat' }, ctx: { waitUntil(task) { pending.push(task); } }, suffix: '?case=missing' });
 await Promise.all(pending);
 assert.equal(response.status, 502);
 assert.equal(messages.length, 1);
 assert.match(messages[0], /目标格式: Loon/);
 assert.match(messages[0], /订阅结果: 失败/);
 assert.match(messages[0], /自定义尝试: 自建 Subconverter/);
 assert.match(messages[0], /已读取 18，转换输出 4/);
 assert.match(messages[0], /缺少 VLESS 14 个/);
 assert.doesNotMatch(messages[0] + logs.join(''), /gateway-secret|fictional-password|audit_subscription_id|vless0/);
 assert.ok(logs.some(line => JSON.parse(line).conversionCheck === 'incomplete'));
});

test('Loon drops from 18 to 4 on custom and recovers all nodes through defaults', async () => {
 const { response, calls } = await requestSubscription({ output: url => url.hostname === 'custom.example.com' ? '[Proxy]\n' + hy2Output : fullOutput });
 assert.equal(response.status, 200);
 assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'fallback');
 assert.equal(response.headers.get('X-Subconverter-Used'), 'https://subapi.cmliussss.net');
 assert.equal(response.headers.get('X-Node2Link-Output-Nodes'), '18');
 assert.equal(response.headers.get('X-Node2Link-Conversion-Check'), 'counts-match');
 assert.equal(await response.text(), fullOutput);
 assert.deepEqual(calls.map(url => url.hostname), ['custom.example.com', 'subapi.cmliussss.net']);
});

test('default backups reject node loss before trying the next default backend', async () => {
 const { response, calls } = await requestSubscription({ mode: 'default', env: { SUBAPI: 'https://first.example.com,https://second.example.com' }, output: url => url.hostname === 'first.example.com' ? '[Proxy]\n' + hy2Output : fullOutput });
 assert.equal(response.status, 200);
 assert.equal(response.headers.get('X-Node2Link-Converter-Route'), 'default');
 assert.equal(response.headers.get('X-Subconverter-Used'), 'https://second.example.com');
 assert.equal(response.headers.get('X-Node2Link-Output-Nodes'), '18');
 assert.deepEqual(calls.map(url => url.hostname), ['first.example.com', 'second.example.com']);
});
