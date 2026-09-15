import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { readGeneratedNodeSettings, saveGeneratedNodeSettings, readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { normalizeGeneratedNodeSettings, generateNodesFromEndpoints } from '../src/worker/domain/generated-nodes.js';
import { readAPITemplateOriginals, resolveAPITemplateSettings } from '../src/worker/services/generated-nodes.js';
import { handleGeneratedNodesAPI, handlePublicNodeImport } from '../src/worker/routes/generated-nodes.js';

const first = 'vless://secret@origin.example.com:443?security=tls&sni=origin.example.com&host=origin.example.com&path=%2Fws&x=1&x=2#原始一';
const second = 'hysteria2://password@other.example.com:443?sni=other.example.com#原始二';
const token = 'template-test-token';
const nameTemplate = '{{name}}-{{address}}:{{port}}';
const config = () => ({ version: 2, originals: [{ id: 'one', content: first }, { id: 'two', content: second }, { id: 'upstream', content: 'https://sub.example.com' }], endpoints: [{ id: 'edge', address: 'edge.example.com', port: 443, enabled: true, label: '', originalIds: ['one'] }] });
const put = (env, payload) => handleGeneratedNodesAPI(new Request('https://app.example/api/generated-nodes', { method: 'PUT', headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), env);

for (const storage of ['KV', 'D1']) test(storage + ': live original bindings, port precedence and missing-source validation', async () => {
 const env = storage === 'KV' ? { KV: new MemoryKV() } : withStorageBindings({ DB: new MemoryD1(), KV: new MemoryKV() });
 await saveMainRecord(env.KV, config());
 assert.deepEqual((await readAPITemplateOriginals(env.KV)).map(node => node.id), ['one', 'two']);
 const templates = [{ id: 'two', port: 2053 }, { id: 'one', port: null }];
 const response = await put(env, { token, nameTemplate, templates: templates.map(node => ({ ...node, content: 'vless://forged@evil.example:443' })) });
 assert.equal(response.status, 200);
 const settings = await readGeneratedNodeSettings(env.KV);
 assert.equal(settings.nodeTemplate, '');
 assert.deepEqual(settings.sourceTemplates, templates);
 const call = (address, port) => handlePublicNodeImport(new Request('https://app.example/api/import?token=' + token + '&address=' + address + (port === undefined ? '' : '&port=' + port)), env);
 const initial = await call('203.0.113.1');
 assert.equal(initial.status, 201);
 const initialNodes = (await initial.json()).nodes;
 assert.deepEqual(initialNodes.map(node => node.port), [2053, 8443]);
 const supplied = await call('203.0.113.2', 443);
 assert.equal(supplied.status, 201);
 assert.deepEqual((await supplied.json()).nodes.map(node => node.port), [2053, 443]);
 // Editing main credentials, transport parameters and names takes effect without any API settings save.
 const edited = config();
 edited.originals[0].content = first.replace('secret@', 'updated-secret@').replace('sni=origin.example.com', 'sni=updated.example.com').replace('#原始一', '#已修改');
 await saveMainRecord(env.KV, edited);
 const updated = await call('203.0.113.2', 443);
 assert.equal(updated.status, 201);
 const result = await updated.json();
 assert.equal(result.added, 1); assert.equal(result.duplicates, 1);
 assert.equal(result.nodes[0].name, '已修改-203.0.113.2:443');
 const nodes = await readGeneratedNodes(env.KV);
 assert.match(nodes.at(-1).content, /updated-secret@203\.0\.113\.2:443.*sni=updated\.example\.com/);
 assert.deepEqual(await readGeneratedNodeSettings(env.KV), settings);
 // Removed originals never fall back to stale credentials or partially import the remaining template.
 await saveMainRecord(env.KV, { version: 2, originals: [{ id: 'two', content: second }], endpoints: [] });
 const failed = await call('203.0.113.3');
 assert.equal(failed.status, 400); assert.match((await failed.json()).message, /已不存在/);
 assert.equal((await readGeneratedNodes(env.KV)).length, nodes.length);
 for (const invalid of [[{ id: 'one' }], [{ id: 'two' }, { id: 'two' }], [{ id: 'upstream' }], [{ id: 'main-extension-one:edge' }], Array.from({ length: 21 }, (_, i) => ({ id: String(i) })), [{ id: 'two', port: 0 }], [{ id: 'two', port: 65536 }], [{ id: 'two', port: 1.2 }]]) {
  assert.equal((await put(env, { templates: invalid })).status, 400);
 }
 assert.deepEqual(await readGeneratedNodeSettings(env.KV), settings);
 assert.equal((await put(env, { token: 'rotated-template-token' })).status, 200);
 assert.deepEqual((await readGeneratedNodeSettings(env.KV)).sourceTemplates, templates);
 // Removing the final template is allowed, e.g. when retaining only direct-node imports.
 assert.equal((await put(env, { templates: [] })).status, 200);
 assert.deepEqual((await readGeneratedNodeSettings(env.KV)).sourceTemplates, []);
});

test('existing snapshots migrate to live references and use the latest original content', async () => {
 const kv = new MemoryKV();
 const current = config(); current.originals[0].content = first.replace('secret@', 'live-secret@');
 await saveMainRecord(kv, current);
 await saveGeneratedNodeSettings(kv, { token, nameTemplate, nodeTemplate: '', sourceTemplates: [{ id: 'one', content: first }] });
 const settings = await readGeneratedNodeSettings(kv);
 assert.deepEqual(settings.sourceTemplates, [{ id: 'one', port: null }]);
 const nodes = generateNodesFromEndpoints(await resolveAPITemplateSettings(kv, settings), { address: 'edge.example.com' });
 assert.match(nodes[0].content, /live-secret@edge\.example\.com:8443/);
});

test('address is required and optional per-address ports preserve batch positions', () => {
 const settings = { nameTemplate, sourceTemplates: [{ id: 'one', content: first, port: null }, { id: 'two', content: second, port: 2087 }] };
 assert.throws(() => generateNodesFromEndpoints(settings, { port: 443 }), /address/);
 const nodes = generateNodesFromEndpoints(settings, { address: ['first.example.com', 'second.example.com'], port: ['', '443'] });
 assert.deepEqual(nodes.map(node => node.port), [8443, 2087, 443, 2087]);
 assert.ok(nodes[0].name.endsWith(':8443'));
 assert.ok(nodes[1].name.endsWith(':2087'));
 for (const port of [0, -1, 65536, 1.5, 'abc']) assert.throws(() => generateNodesFromEndpoints(settings, { address: 'edge.example.com', port }), /port/);
});

test('encoded VMess, legacy SS and SSR templates replace only endpoint and name', async () => {
 const b64 = text => Buffer.from(text).toString('base64');
 const vmess = { v: '2', add: 'origin.example.com', port: '443', ps: '原始 VMess', id: 'private-id', host: 'front.example.com', path: '/ws', tls: 'tls', extra: { keep: true } };
 const originals = [
  { id: 'vmess', content: 'vmess://' + b64(JSON.stringify(vmess)) },
  { id: 'ss', content: 'ss://' + b64('aes-128-gcm:password@origin.example.com:8388') + '?plugin=obfs-local%3Bobfs%3Dhttp#SS' },
  { id: 'ssr', content: 'ssr://' + b64('origin.example.com:443:origin:aes-128-cfb:plain:cGFzcw/?obfsparam=YWJj&remarks=' + b64('SSR')) }
 ];
 const settings = normalizeGeneratedNodeSettings({ token, nameTemplate, sourceTemplates: originals });
 const kv = new MemoryKV();
 await saveMainRecord(kv, { version: 2, originals, endpoints: [] });
 const nodes = generateNodesFromEndpoints(await resolveAPITemplateSettings(kv, settings), { address: '2001:db8::1', port: 8443 });
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