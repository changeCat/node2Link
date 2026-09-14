import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMainConfig, legacyMainConfig, extendMainNode, mainNodeName, parseMainEndpointLine } from '../src/shared/main-subscription.js';
import { readMainRecord, readMainBackup, saveMainRecord, MAIN_HEAD_KEY } from '../src/worker/storage/main.js';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { createSessionCookie } from '../src/worker/auth.js';
import worker from '../src/worker/app.js';

const raw = 'vless://uuid@origin.example.com:443?security=tls&type=ws&host=origin.example.com&sni=tls.example.com&path=%2Fa%3Fb%3D1&custom=first&custom=second#HongKong';
const other = 'hysteria2://secret@origin2.example.com:443?sni=origin2.example.com#HY2';
const endpoint = { id: 'endpoint-1', address: 'cf.example.com', port: 8443, label: '优选 A', enabled: true, originalIds: ['original-1'] };
const fixtureConfig = () => ({ version: 2, originals: [{ id: 'original-1', content: raw }, { id: 'original-2', content: other }], endpoints: [structuredClone(endpoint)] });

test('main compilation preserves originals, credentials and query bytes and expands only selected pairs', () => {
 const { nodes, content } = compileMainConfig(fixtureConfig());
 assert.equal(nodes.length, 3);
 assert.deepEqual(nodes.map(node => node.kind), ['original', 'extension', 'original']);
 assert.equal(nodes[0].content, raw);
 assert.equal(nodes[2].content, other);
 const extended = nodes[1].content;
 assert.equal(extended.split('?')[1].split('#')[0], raw.split('?')[1].split('#')[0]);
 assert.match(extended, /^vless:\/\/uuid@cf\.example\.com:8443\?/);
 assert.equal(mainNodeName(extended), 'HongKong · 优选 A');
 assert.equal(content.split('\n').length, 3);
});

test('protocol suitability is deliberately left to the owner, including UDP and custom schemes', () => {
 const config = fixtureConfig();
 config.endpoints[0].originalIds = ['original-1', 'original-2'];
 assert.equal(compileMainConfig(config).nodes.length, 4);
 assert.match(extendMainNode('custom+transport://secret@origin.example.com:123?keep=yes#Custom', endpoint, 'New'), /^custom\+transport:\/\/secret@cf.example.com:8443\?keep=yes#New$/);
});

test('VMess JSON retains arbitrary fields and correctly encodes Unicode names', () => {
 const original = { v: '2', ps: '日本', add: 'origin.example.com', port: '443', id: 'id', net: 'ws', host: 'host.example.com', sni: 'sni.example.com', path: '/ws', tls: 'tls', unknown: { keep: true } };
 const uri = 'vmess://' + Buffer.from(JSON.stringify(original)).toString('base64');
 const extended = extendMainNode(uri, endpoint, '日本 · 优选');
 const decoded = JSON.parse(Buffer.from(extended.slice(8), 'base64').toString());
 assert.deepEqual(decoded, { ...original, add: endpoint.address, port: '8443', ps: '日本 · 优选' });
 assert.equal(mainNodeName(extended), '日本 · 优选');
});

test('SS modern and legacy encodings preserve credentials and plugin parameters', () => {
 const suffix = '?plugin=v2ray-plugin%3Btls%3Bhost%3Dorigin.example.com%3Bpath%3D%2Fws';
 const userinfo = Buffer.from('aes-128-gcm:p:a:ss').toString('base64url');
 const modern = `ss://${userinfo}@origin.example.com:443/${suffix}#Old`;
 assert.equal(extendMainNode(modern, endpoint, 'New'), `ss://${userinfo}@cf.example.com:8443/${suffix}#New`);
 const legacy = 'ss://' + Buffer.from('aes-128-gcm:p:a:ss@origin.example.com:443').toString('base64') + suffix + '#Old';
 const result = extendMainNode(legacy, endpoint, 'New');
 assert.equal(Buffer.from(result.slice(5).split('?')[0], 'base64').toString(), 'aes-128-gcm:p:a:ss@cf.example.com:8443');
 assert.ok(result.endsWith(suffix + '#New'));
});

test('SSR address replacement preserves encoded password, obfs and protocol options', () => {
 const core = 'origin.example.com:443:auth_sha1_v4:aes-256-cfb:tls1.2_ticket_auth:cGFzcw/?obfsparam=abc&protoparam=def&remarks=T2xk';
 const uri = 'ssr://' + Buffer.from(core).toString('base64url');
 const result = extendMainNode(uri, endpoint, 'SSR 优选');
 const decoded = Buffer.from(result.slice(6), 'base64url').toString();
 assert.ok(decoded.startsWith('cf.example.com:8443:auth_sha1_v4:aes-256-cfb:tls1.2_ticket_auth:cGFzcw/?obfsparam=abc&protoparam=def&remarks='));
 assert.equal(mainNodeName(result), 'SSR 优选');
});

test('endpoint input accepts domains, fixed ports and bracketed IPv6 without randomization', () => {
 assert.deepEqual(parseMainEndpointLine('CF.Example.com:2053', 443), { address: 'cf.example.com', port: 2053 });
 assert.deepEqual(parseMainEndpointLine('[2001:db8::1]:8443'), { address: '2001:db8::1', port: 8443 });
 assert.deepEqual(parseMainEndpointLine('2001:db8::1'), { address: '2001:db8::1', port: 443 });
 assert.deepEqual(parseMainEndpointLine('203.0.113.10'), { address: '203.0.113.10', port: 443 });
 assert.throws(() => parseMainEndpointLine('https://cf.example.com'), /有效/);
 assert.throws(() => parseMainEndpointLine('cf.example.com:65536'), /端口/);
 assert.throws(() => parseMainEndpointLine('999.0.0.1'), /IPv4/);
 assert.match(extendMainNode('trojan://pw@[2001:db8::2]:443?sni=origin.example.com#Old', { address: '2001:db8::1', port: 8443 }, 'New'), /^trojan:\/\/pw@\[2001:db8::1\]:8443\?sni=origin.example.com#New$/);
});

test('stable identities survive original and endpoint edits, disabled addresses stop output', () => {
 const config = fixtureConfig(), before = compileMainConfig(config);
 config.originals[0].content = raw.replace('uuid@', 'new-uuid@').replace('#HongKong', '#Renamed');
 config.endpoints[0].address = 'new.example.com';
 const after = compileMainConfig(config);
 assert.equal(before.nodes[1].id, after.nodes[1].id);
 assert.match(after.nodes[1].content, /new-uuid@new.example.com/);
 config.endpoints[0].enabled = false;
 assert.equal(compileMainConfig(config).nodes.length, 2);
});

test('invalid bindings or malformed encoded templates reject publication, while raw legacy content stays readable', () => {
 const config = fixtureConfig();
 config.endpoints[0].originalIds.push('missing');
 assert.throws(() => compileMainConfig(config), /原始节点已不存在/);
 config.endpoints[0].originalIds = ['original-1'];
 config.originals[0].content = 'vmess://broken';
 assert.throws(() => compileMainConfig(config), /无法解析/);
 config.endpoints = [];
 assert.equal(compileMainConfig(config).nodes[0].content, 'vmess://broken');
 const legacy = legacyMainConfig(raw + '\n' + 'https://upstream.example.com/sub');
 assert.equal(compileMainConfig(legacy).content, raw + '\nhttps://upstream.example.com/sub');
 legacy.endpoints = [{ ...endpoint, originalIds: ['legacy-1'] }];
 assert.throws(() => compileMainConfig(legacy), /订阅源/);
});

test('immutable main versions retain configuration, provenance and previous output on failed writes', async () => {
 const kv = new MemoryKV(), config = fixtureConfig();
 await saveMainRecord(kv, raw);
 const metadata = await saveMainRecord(kv, config);
 const record = await readMainRecord(kv);
 assert.deepEqual(record.config, config);
 assert.equal(record.mainNodes.length, 3);
 assert.equal(record.content.split('\n')[record.mainNodes[1].line], compileMainConfig(config).nodes[1].content);
 assert.equal(metadata.extensionCount, 1);
 assert.equal((await readMainBackup(kv)).content, raw);
 kv.before = (op, key) => { if (op === 'put' && key === MAIN_HEAD_KEY) throw new Error('publication failed'); };
 config.endpoints[0].address = 'different.example.com';
 await assert.rejects(saveMainRecord(kv, config));
 assert.deepEqual(await readMainRecord(kv), record);
 assert.equal((await readMainBackup(kv)).content, raw);
});

test('main save, subscription, picker and conflict handling use one saved revision without changing API settings', async () => {
 const origin = 'https://main.example.com';
 const env = { KV: new MemoryKV(), DB: new MemoryD1(), ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-secret', TOKEN: 'main-token' };
 env.KV = withStorageBindings(env).KV;
 const headers = { Cookie: (await createSessionCookie(env)).split(';')[0], Origin: origin, 'Content-Type': 'application/json', 'X-Node2Link-Action': 'save-config', 'X-Node2Link-Revision': 'uninitialized' };
 const request = (path, init = {}) => worker.fetch(new Request(origin + path, init), env, { waitUntil() {} });
 const config = fixtureConfig();
 await env.KV.put('api.settings', JSON.stringify({ sentinel: 'untouched' }));
 const response = await request('/', { method: 'POST', headers, body: JSON.stringify(config) });
 assert.equal(response.status, 200);
 const { metadata } = await response.json();
 const candidates = await (await request('/api/node-candidates?source=local', { headers })).json();
 assert.equal(candidates.revision, metadata.revision);
 assert.equal(candidates.nodes.length, 3);
 assert.equal(candidates.nodes[1].kind, 'extension');
 const subscription = Buffer.from(await (await request('/main-token?b64')).text(), 'base64').toString();
 assert.deepEqual(subscription.trim().split('\n'), candidates.nodes.map(node => node.content));
 const page = await (await request('/', { headers })).text();
 assert.ok(page.includes('优选域名 / IP 与端口'));
 assert.ok(page.includes('id="endpointTargets"'));
 const invalid = fixtureConfig(); invalid.endpoints[0].originalIds = ['missing'];
 const currentHeaders = { ...headers, 'X-Node2Link-Revision': metadata.revision };
 assert.equal((await request('/', { method: 'POST', headers: currentHeaders, body: JSON.stringify(invalid) })).status, 400);
 assert.equal((await request('/', { method: 'POST', headers, body: JSON.stringify(config) })).status, 409);
 assert.equal((await readMainRecord(env.KV)).revision, metadata.revision);
 assert.equal(await env.KV.get('api.settings'), JSON.stringify({ sentinel: 'untouched' }));
});


test('corrupt structured main versions fail closed rather than losing configuration or candidate provenance', async () => {
 const kv = new MemoryKV();
 const metadata = await saveMainRecord(kv, fixtureConfig());
 const saved = JSON.parse(await kv.get(metadata.revision));
 for (const mutate of [
  value => { value.config = null; },
  value => { value.mainNodes = []; },
  value => { value.mainNodes[1].line = 999; },
  value => { value.mainNodes[1].endpointId = 'missing'; }
 ]) {
  const corrupt = structuredClone(saved); mutate(corrupt);
  await kv.put(metadata.revision, JSON.stringify(corrupt));
  await assert.rejects(readMainRecord(kv), /存储数据格式异常/);
 }
});
