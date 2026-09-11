import worker from '../src/worker/app.js';
import { MemoryKV } from './lib/memory-kv.mjs';
import { saveMainRecord } from '../src/worker/storage/main.js';
import { saveShare } from '../src/worker/storage/shares.js';

const rows = [];
for (const [label, path, api] of [
	['Anonymous root', '/', false],
	['Invalid nested path', '/scanner/config.php', false],
	['Login page', '/login', false],
	['Main Token', '/benchmark-token?base64', false],
	['Main /s/ link', '/s/benchmark_main_id?base64', false],
	['Main /s/ + API nodes', '/s/benchmark_main_id?base64', true],
	['Share /s/ link', '/s/benchmark_share_id?base64', false],
	['Missing share', '/s/benchmark_missing_id', false]
]) {
	let counts;
	const kv = new MemoryKV({ before(op) { if (counts) counts[op]++; } });
	const env = { KV: kv, ADMIN_PASSWORD: 'local-password', SESSION_SECRET: 'local-secret', TOKEN: 'benchmark-token', API_SUBSCRIPTION_ENABLED: String(api) };
	await kv.put('NODE2LINK.identity.json', JSON.stringify({ mainSubscriptionId: 'benchmark_main_id' }));
	const content = 'trojan://local@node.example.com:443#Benchmark';
	await saveMainRecord(kv, content);
	await saveShare(kv, { id: 'benchmark_share_id', name: 'Benchmark', content });
	for (const phase of ['cold', 'warm']) {
		counts = { get: 0, list: 0, put: 0, delete: 0 };
		const pending = [];
		const response = await worker.fetch(new Request('https://benchmark.invalid' + path), env, { waitUntil(task) { pending.push(task); } });
		await response.text();
		await Promise.all(pending);
		rows.push({ route: label, phase, status: response.status, ...counts });
	}
}
console.table(rows);
console.log('Local operation counts only; warm means the same isolate within 60 seconds. Default request logging remains enabled. No production KV access.');
