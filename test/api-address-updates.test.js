import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKV } from '../scripts/lib/memory-kv.mjs';
import { MemoryD1 } from '../scripts/lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { readGeneratedNodes, saveGeneratedNodeSettings } from '../src/worker/storage/generated-nodes.js';
import { appendNodeBatch, deleteNodeRecord } from '../src/worker/storage/node-records.js';
import { appendGeneratedNodes } from '../src/worker/services/generated-nodes.js';
import { generateNodesFromEndpoints } from '../src/worker/domain/generated-nodes.js';
import { handlePublicNodeImport } from '../src/worker/routes/generated-nodes.js';

const legacy = { token: 'address-update-token', nameTemplate: '{{address}}:{{port}}', nodeTemplate: 'vless://secret@{{address}}:{{port}}#{{name}}' };
const config = { version: 2, originals: [
 { id: 'one', content: 'vless://secret@origin.example.com:443?sni=origin.example.com#One' },
 { id: 'two', content: 'trojan://password@origin.example.com:443?sni=origin.example.com#Two' }
], endpoints: [] };
const settings = { token: legacy.token, nameTemplate: '{{name}}-{{address}}:{{port}}', sourceTemplates: [{ id: 'one', port: 2053 }, { id: 'two', port: null }] };
function storage(kind) {
 let failing = false;
 const kv = new MemoryKV({ before(op, key) { if (failing && op === 'put' && key.startsWith('nodes.')) throw new Error('write failed'); } });
 const db = new MemoryD1({ before(op) { if (failing && op === 'batch') throw new Error('write failed'); } });
 return { kv: kind === 'KV' ? kv : withStorageBindings({ KV: kv, DB: db }).KV, db, fail() { failing = true; } };
}

for (const kind of ['KV', 'D1']) {
 test(kind + ': repeated address updates all templates in place and leaves other nodes intact', async () => {
  const { kv, db } = storage(kind);
  await saveMainRecord(kv, config);
  await appendGeneratedNodes(kv, settings, { address: 'edge.example.com', port: 443 });
  await appendGeneratedNodes(kv, settings, { address: 'other.example.com', port: 443 });
  await appendGeneratedNodes(kv, settings, { node: 'trojan://raw@edge.example.com:1234#Raw' });
  const before = await readGeneratedNodes(kv);
  const sortKeys = [...db.nodes.values()].map(row => row.sort_key);
  await readGeneratedNodes(kv, { fresh: false });
  const result = await appendGeneratedNodes(kv, settings, { address: 'EDGE.Example.COM.', port: 8443 });
  assert.equal(result.added.length, 0);
  assert.equal(result.updated.length, 2);
  assert.equal(result.total, 5);
  const after = await readGeneratedNodes(kv, { fresh: false });
  assert.deepEqual(after.map(node => [node.id, node.createdAt]), before.map(node => [node.id, node.createdAt]));
  assert.deepEqual(after.slice(0, 2).map(node => node.port), [8443, 8443]);
  assert.ok(after.slice(0, 2).every(node => node.name.endsWith(':8443') && node.content.includes('@edge.example.com:8443?')));
  assert.deepEqual(after.slice(2), before.slice(2));
  if (kind === 'D1') assert.deepEqual([...db.nodes.values()].map(row => row.sort_key), sortKeys);
  const repeated = await appendGeneratedNodes(kv, settings, { address: 'edge.example.com', port: 8443 });
  assert.equal(repeated.updated.length, 0);
  assert.equal(repeated.duplicateCount, 2);
  assert.equal(repeated.total, 5);
  const fallback = await appendGeneratedNodes(kv, settings, { address: 'edge.example.com' });
  assert.deepEqual(fallback.updated.map(node => node.port), [2053]);
  assert.deepEqual((await readGeneratedNodes(kv)).slice(0, 2).map(node => node.port), [2053, 8443]);
  const reordered = { ...settings, sourceTemplates: [...settings.sourceTemplates].reverse() };
  await appendGeneratedNodes(kv, reordered, { address: 'edge.example.com', port: 2096 });
  const reorderedNodes = await readGeneratedNodes(kv);
  assert.deepEqual(reorderedNodes.slice(0, 2).map(node => node.id), before.slice(0, 2).map(node => node.id));
  assert.deepEqual(reorderedNodes.slice(0, 2).map(node => node.content.split('://')[0]), ['vless', 'trojan']);
  await deleteNodeRecord(kv, before[0].id);
  assert.ok(!(await readGeneratedNodes(kv)).some(node => node.id === before[0].id));
 });

 test(kind + ': GET and JSON batches use the last normalized address and report updates', async () => {
  const { kv } = storage(kind);
  await saveGeneratedNodeSettings(kv, legacy);
  const request = path => handlePublicNodeImport(new Request('https://app.example/api/import?token=' + legacy.token + path), { KV: kv });
  const first = await request('&address=edge.example.com&port=443&address=EDGE.example.com.&port=2053');
  const initial = await first.json();
  assert.equal(first.status, 201);
  assert.equal(initial.added, 1);
  assert.equal(initial.duplicates, 1);
  assert.equal(initial.nodes[0].port, 2053);
  const response = await handlePublicNodeImport(new Request('https://app.example/api/import', {
   method: 'POST', headers: { 'X-API-Token': legacy.token, 'Content-Type': 'application/json' },
   body: JSON.stringify({ addresses: [{ address: 'edge.example.com', port: 443 }, { address: 'other.example.com', port: 2096 }, { address: 'edge.example.com', port: 8443 }] })
  }), { KV: kv });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.total, 2);
  assert.equal(result.nodes.find(node => node.address === 'edge.example.com').id, initial.nodes[0].id);
  assert.deepEqual((await readGeneratedNodes(kv)).map(node => [node.address, node.port]), [['edge.example.com', 8443], ['other.example.com', 2096]]);
  const update = await request('&address=edge.example.com&port=2087');
  assert.equal(update.status, 200);
  assert.equal((await update.json()).updated, 1);
  const lines = await appendGeneratedNodes(kv, legacy, { address: 'edge.example.com\nedge.example.com', port: ['443', '2096'] });
  assert.equal(lines.updated[0].port, 2096);
  const invalid = await request('&address=edge.example.com&port=0&address=edge.example.com&port=443');
  assert.equal(invalid.status, 400);
  assert.equal((await readGeneratedNodes(kv))[0].port, 2096);
 });

 test(kind + ': latest upload removes historical port variants in one write', async () => {
  const { kv } = storage(kind);
  const originals = generateNodesFromEndpoints(legacy, { address: 'edge.example.com', port: 443 }, '2026-01-01T00:00:00.000Z');
  await appendNodeBatch(kv, originals);
  await appendNodeBatch(kv, generateNodesFromEndpoints(legacy, { address: 'edge.example.com', port: 2053 }));
  await appendNodeBatch(kv, generateNodesFromEndpoints(legacy, { address: 'edge.example.com', port: 2053 }));
  const result = await appendGeneratedNodes(kv, legacy, { address: 'edge.example.com', port: 8443 });
  assert.equal(result.total, 1);
  const nodes = await readGeneratedNodes(kv, { deduplicate: false });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].port, 8443);
  assert.equal(nodes[0].id, originals[0].id);
  assert.equal(nodes[0].createdAt, originals[0].createdAt);
 });

 test(kind + ': failed replacement preserves old nodes without a partial update or deletion', async () => {
  const store = storage(kind);
  await appendNodeBatch(store.kv, generateNodesFromEndpoints(legacy, { address: 'edge.example.com', port: 443 }));
  await appendNodeBatch(store.kv, generateNodesFromEndpoints(legacy, { address: 'edge.example.com', port: 2053 }));
  const before = await readGeneratedNodes(store.kv);
  store.fail();
  await assert.rejects(appendGeneratedNodes(store.kv, legacy, { address: 'edge.example.com', port: 8443 }));
  assert.deepEqual(await readGeneratedNodes(store.kv), before);
 });
}
