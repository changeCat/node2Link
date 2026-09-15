import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { readGeneratedNodeSettings, saveGeneratedNodeSettings, readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { normalizeGeneratedNodeSettings, generateNodesFromEndpoints } from '../src/worker/domain/generated-nodes.js';
import { readAPITemplateOriginals } from '../src/worker/services/generated-nodes.js';
import { handleGeneratedNodesAPI, handlePublicNodeImport } from '../src/worker/routes/generated-nodes.js';

const first = 'vless://secret@origin.example.com:443?security=tls&sni=origin.example.com&host=origin.example.com&path=%2Fws&x=1&x=2#原始一';
const second = 'hysteria2://password@other.example.com:443?sni=other.example.com#原始二';
const token = 'template-test-token';
const nameTemplate = '{{name}}-{{address}}:{{port}}';
const config = () => ({ version: 2, originals: [{ id: 'one', content: first }, { id: 'two', content: second }, { id: 'upstream', content: 'https://sub.example.com' }], endpoints: [{ id: 'edge', address: 'edge.example.com', port: 443, enabled: true, label: '', originalIds: ['one'] }] });
const put = (env, payload) => handleGeneratedNodesAPI(new Request('https://app.example/api/generated-nodes', { method: 'PUT', headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env);

for (const storage of ['KV', 'D1']) test(`${storage}: select originals, persist snapshots, import, reject stale IDs and keep legacy settings`, async () => {
 const env = storage === 'KV' ? { KV: new MemoryKV() } : withStorageBindings({ DB: new MemoryD1(), KV: new MemoryKV() });
 await saveMainRecord(env.KV, config());
 const originals = await readAPITemplateOriginals(env.KV);
 assert.deepEqual(originals.map(node => node.id), ['one', 'two']);
 const response = await put(env, { token, nameTemplate, originalIds: ['two', 'one'], sourceTemplates: [{ id: 'one', content: 'vless://forged@evil.example:443' }] });
 assert.equal(response.status, 200);
 const settings = await readGeneratedNodeSettings(env.KV);
 assert.equal(settings.nodeTemplate, '');
 assert.deepEqual(settings.sourceTemplates.map(node => node.content), [second, first]);
 await saveMainRecord(env.KV, { version: 2, originals: [], endpoints: [] });
 const imported = await handlePublicNodeImport(new Request(`https://app.example/api/import?token=${token}&address=203.0.113.1&port=8443`), env);
 assert.equal(imported.status, 201);
 const nodes = await readGeneratedNodes(env.KV);
 assert.equal(nodes.length, 2);
 assert.equal(nodes[0].name, '原始二-203.0.113.1:8443');
 assert.equal(nodes[1].content, 'vless://secret@203.0.113.1:8443?security=tls&sni=origin.example.com&host=origin.example.com&path=%2Fws&x=1&x=2#' + encodeURIComponent('原始一-203.0.113.1:8443'));
 const stale = await put(env, { originalIds: ['one'] });
 assert.equal(stale.status, 400);
 assert.match((await stale.json()).message, /已不存在/);
 assert.deepEqual(await readGeneratedNodeSettings(env.KV), settings);
 for (const originalIds of [[], ['one', 'one'], ['upstream'], ['main-extension-one:edge'], Array.from({ length: 21 }, (_, i) => String(i))]) {
  assert.equal((await put(env, { originalIds })).status, 400);
 }
 // Credential-only saves keep snapshots even after the main originals were removed.
 assert.equal((await put(env, { token: 'rotated-template-token' })).status, 200);
 assert.deepEqual((await readGeneratedNodeSettings(env.KV)).sourceTemplates, settings.sourceTemplates);
 const legacy = normalizeGeneratedNodeSettings({ token, nameTemplate: '{{address}}', nodeTemplate: 'trojan://legacy@{{address}}:{{port}}#{{name}}' });
 await saveGeneratedNodeSettings(env.KV, legacy);
 assert.equal((await put(env, { token: 'new-legacy-token' })).status, 200);
 assert.equal((await readGeneratedNodeSettings(env.KV)).nodeTemplate, legacy.nodeTemplate);
 await saveMainRecord(env.KV, config());
 assert.equal((await put(env, { originalIds: ['one'] })).status, 200);
 assert.equal((await readGeneratedNodeSettings(env.KV)).nodeTemplate, '');
});

test('encoded VMess, legacy SS and SSR templates replace only endpoint and name', () => {
 const b64 = text => Buffer.from(text).toString('base64');
 const vmess = { v: '2', add: 'origin.example.com', port: '443', ps: '原始 VMess', id: 'private-id', host: 'front.example.com', path: '/ws', tls: 'tls', extra: { keep: true } };
 const originals = [
  { id: 'vmess', content: 'vmess://' + b64(JSON.stringify(vmess)) },
  { id: 'ss', content: 'ss://' + b64('aes-128-gcm:password@origin.example.com:8388') + '?plugin=obfs-local%3Bobfs%3Dhttp#SS' },
  { id: 'ssr', content: 'ssr://' + b64('origin.example.com:443:origin:aes-128-cfb:plain:cGFzcw/?obfsparam=YWJj&remarks=' + b64('SSR')) }
 ];
 const settings = normalizeGeneratedNodeSettings({ token, nameTemplate, sourceTemplates: originals });
 const nodes = generateNodesFromEndpoints(settings, { address: '2001:db8::1', port: 8443 });
 const data = JSON.parse(Buffer.from(nodes[0].content.slice(8), 'base64').toString());
 assert.deepEqual(data, { ...vmess, add: '2001:db8::1', port: '8443', ps: '原始 VMess-2001:db8::1:8443' });
 assert.match(Buffer.from(nodes[1].content.slice(5).split('?')[0], 'base64').toString(), /aes-128-gcm:password@\[2001:db8::1\]:8443/);
 assert.match(nodes[1].content, /plugin=obfs-local%3Bobfs%3Dhttp/);
 assert.match(Buffer.from(nodes[2].content.slice(6), 'base64').toString(), /^\[2001:db8::1\]:8443:origin:aes-128-cfb:plain:cGFzcw\/\?obfsparam=YWJj&remarks=/);
});

test('malformed originals remain visible but cannot be selected or partially imported', async () => {
 const env = { KV: new MemoryKV() };
 await saveMainRecord(env.KV, { version: 2, originals: [{ id: 'one', content: first }, { id: 'broken', content: 'vmess://invalid-json' }], endpoints: [] });
 const originals = await readAPITemplateOriginals(env.KV);
 assert.equal(originals.length, 2);
 assert.ok(originals[1].error);
 const result = await put(env, { originalIds: ['one', 'broken'] });
 assert.equal(result.status, 400);
 assert.equal((await readGeneratedNodeSettings(env.KV)).token, '');
 assert.deepEqual(await readGeneratedNodes(env.KV), []);
});