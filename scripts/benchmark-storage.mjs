import { MemoryKV } from './lib/memory-kv.mjs';
import { listShareSummaries, saveShare } from '../src/worker/storage/shares.js';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { readPersistedSettings, saveSettingsSections, SETTING_SECTIONS } from '../src/worker/storage/settings.js';

// Counts KV operations in a deterministic local adapter, not production latency.
// Use a large history with a small active view to model frequent edits/imports.
const results = [];
for (const history of [100, 1000, 10000]) {
	for (const kind of ['shares', 'nodes', 'settings']) {
		let counts;
		const kv = new MemoryKV({ before(op) { if (counts) counts[op] = (counts[op] || 0) + 1; } });
		for (let i = 0; i < history; i++) {
			if (kind === 'shares') await saveShare(kv, { id: 'benchmark_share_' + (i % 100), name: 'Share ' + i, content: 'vless://uuid@example.com:443#test', nodeCount: 1 });
			else if (kind === 'nodes') await appendNodeBatch(kv, normalizeDirectNodes({ node: 'vless://uuid@example.com:443#' + (i % 100) }));
			else await saveSettingsSections(kv, { pageTitle: 'Title ' + i, subscriptionToken: 'token-' + i, converterMode: 'default', displayFormats: ['sub'] }, Object.keys(SETTING_SECTIONS)[i % 4]);
		}
		const read = kind === 'shares' ? () => listShareSummaries(kv)
			: kind === 'nodes' ? () => readGeneratedNodes(kv, { fresh: false }) : () => readPersistedSettings({ KV: kv });
		for (const phase of ['cold', 'warm']) {
			counts = { get: 0, list: 0, put: 0 };
			const start = performance.now();
			const view = await read();
			results.push({ kind, history, phase, active: kind === 'settings' ? 4 : view.length, ...counts, localMs: Number((performance.now() - start).toFixed(2)) });
		}
	}
}
console.table(results);
console.log('Local MemoryKV only. Journal scans remain. Administrative indexes expire after 2 seconds; public and mutation reads bypass them. Settings reuse immutable bodies but always check current keys.');
