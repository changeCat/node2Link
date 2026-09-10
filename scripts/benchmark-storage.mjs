import { MemoryKV } from './lib/memory-kv.mjs';
import { listShareSummaries, saveShare } from '../src/worker/storage/shares.js';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';

// Counts KV operations in a deterministic local adapter, not production latency.
// Use a large history with a small active view to model frequent edits/imports.
const results = [];
for (const history of [100, 1000, 10000]) {
	for (const kind of ['shares', 'nodes']) {
		let counts;
		const kv = new MemoryKV({ before(op) { if (counts) counts[op] = (counts[op] || 0) + 1; } });
		for (let i = 0; i < history; i++) {
			if (kind === 'shares') await saveShare(kv, { id: 'benchmark_share_' + (i % 100), name: 'Share ' + i, content: 'vless://uuid@example.com:443#test', nodeCount: 1 });
			else await appendNodeBatch(kv, normalizeDirectNodes({ node: 'vless://uuid@example.com:443#' + (i % 100) }));
		}
		const read = kind === 'shares' ? () => listShareSummaries(kv) : () => readGeneratedNodes(kv, { fresh: false });
		for (const phase of ['cold', 'warm']) {
			counts = { get: 0, list: 0, put: 0 };
			const start = performance.now();
			const view = await read();
			results.push({ kind, history, phase, active: view.length, ...counts, localMs: Number((performance.now() - start).toFixed(2)) });
		}
	}
}
console.table(results);
console.log('Local MemoryKV only. Cold journal scans remain; warm administrative indexes expire after 2 seconds. Public subscriptions and mutation reads bypass this cache.');
