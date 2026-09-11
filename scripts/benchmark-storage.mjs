import { MemoryKV } from './lib/memory-kv.mjs';
import { MemoryD1 } from './lib/memory-d1.mjs';
import { withD1Storage } from '../src/worker/storage/d1.js';
import { listShareSummaries, saveShare } from '../src/worker/storage/shares.js';
import { appendNodeBatch } from '../src/worker/storage/node-records.js';
import { readGeneratedNodes } from '../src/worker/storage/generated-nodes.js';
import { normalizeDirectNodes } from '../src/worker/domain/generated-nodes.js';
import { readPersistedSettings, saveSettingsSections, SETTING_SECTIONS } from '../src/worker/storage/settings.js';

const results = [];
for (const history of [100, 1000, 10000]) {
	for (const kind of ['shares', 'nodes', 'settings']) {
		let counts;
		const increment = key => { if (counts) counts[key] = (counts[key] || 0) + 1; };
		const kv = new MemoryKV({ before(op) { increment('kv' + op[0].toUpperCase() + op.slice(1)); } });
		const db = new MemoryD1({ initialized: true, before(op) { increment('d1' + op[0].toUpperCase() + op.slice(1)); } });
		const storage = withD1Storage({ KV: kv, DB: db }).KV;
		const nodePool = Array.from({ length: 100 }, (_, i) => normalizeDirectNodes({ node: 'vless://uuid@example.com:443#' + i })[0]);
		for (let i = 0; i < history; i++) {
			if (kind === 'shares') await saveShare(storage, { id: 'benchmark_share_' + (i % 100), name: 'Share ' + i, content: 'vless://uuid@example.com:443#test', nodeCount: 1 });
			else if (kind === 'nodes') await appendNodeBatch(storage, [nodePool[i % nodePool.length]]);
			else await saveSettingsSections(storage, { pageTitle: 'Title ' + i, subscriptionToken: 'token-' + i, converterMode: 'default', displayFormats: ['sub'] }, Object.keys(SETTING_SECTIONS)[i % Object.keys(SETTING_SECTIONS).length]);
		}
		const read = kind === 'shares' ? () => listShareSummaries(storage)
			: kind === 'nodes' ? () => readGeneratedNodes(storage, { fresh: false }) : () => readPersistedSettings({ KV: storage });
		for (const phase of ['cold', 'warm']) {
			counts = { kvGet: 0, kvList: 0, kvPut: 0, d1First: 0, d1All: 0, d1Run: 0, d1Batch: 0 };
			const start = performance.now();
			const view = await read();
			results.push({ kind, history, phase, active: kind === 'settings' ? Object.keys(SETTING_SECTIONS).length : view.length, ...counts, localMs: Number((performance.now() - start).toFixed(2)) });
		}
	}
}
console.table(results);
console.log('Local hybrid MemoryD1/MemoryKV counts. Structured lists use indexed D1 queries; KV retains only immutable main bodies and rare oversized share bodies. Views expire after 15 seconds.');
