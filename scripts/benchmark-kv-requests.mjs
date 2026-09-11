import worker from '../src/worker/app.js';
import { MemoryKV } from './lib/memory-kv.mjs';
import { MemoryD1 } from './lib/memory-d1.mjs';
import { withStorageBindings } from '../src/worker/storage/d1.js';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { saveShare } from '../src/worker/storage/shares.js';

const rows = [];
for (const [label, path, api] of [
	['Anonymous root', '/', false],
	['Invalid nested path', '/scanner/config.php', false],
	['Invalid Token', '/unknown-token', false],
	['Login page', '/login', false],
	['Main Token', '/benchmark-token?base64', false],
	['Main /s/ link', '/s/benchmark_main_id?base64', false],
	['Main /s/ + API nodes', '/s/benchmark_main_id?base64', true],
	['Share /s/ link', '/s/benchmark_share_id?base64', false],
	['Missing share', '/s/benchmark_missing_id', false]
]) {
	let counts;
	const increment = key => { if (counts) counts[key] = (counts[key] || 0) + 1; };
	const kv = new MemoryKV({ before(op) { increment('kv' + op[0].toUpperCase() + op.slice(1)); } });
	const db = new MemoryD1({ initialized: true, before(op) { increment('d1' + op[0].toUpperCase() + op.slice(1)); } });
	const storage = withStorageBindings({ KV: kv, DB: db }).KV;
	const env = { KV: kv, DB: db, ADMIN_PASSWORD: 'local-password', SESSION_SECRET: 'local-secret', TOKEN: 'benchmark-token', API_SUBSCRIPTION_ENABLED: String(api) };
	await storage.put('identity', JSON.stringify({ mainSubscriptionId: 'benchmark_main_id' }));
	const content = 'trojan://local@node.example.com:443#Benchmark';
	await saveMainRecord(storage, content);
	await saveShare(storage, { id: 'benchmark_share_id', name: 'Benchmark', content });
	for (const phase of ['cold', 'warm']) {
		counts = { kvGet: 0, kvList: 0, kvPut: 0, kvDelete: 0, d1First: 0, d1All: 0, d1Run: 0, d1Batch: 0 };
		const pending = [];
		const response = await worker.fetch(new Request('https://benchmark.invalid' + path), env, { waitUntil(task) { pending.push(task); } });
		await response.text();
		await Promise.all(pending);
		rows.push({ route: label, phase, status: response.status, ...counts });
	}
}
console.table(rows);
console.log('Local MemoryD1/MemoryKV operation counts only. Warm means the same isolate within 60 seconds. Full logging is enabled for deterministic counts; no production storage is accessed.');
