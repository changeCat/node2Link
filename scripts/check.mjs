import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(directory + '/' + entry.name) : [directory + '/' + entry.name]))).flat();
}

for (const file of [...(await Promise.all(['src', 'scripts', 'test', 'e2e'].map(files))).flat(), 'playwright.config.mjs'].filter(file => /\.m?js$/.test(file))) {
	const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
	if (result.status !== 0) process.exit(result.status || 1);
}

// Validate module resolution/exports as well as individual file syntax.
await build({ entryPoints: ['src/worker/index.js'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning' });
const routes = JSON.parse(await readFile('public/_routes.json', 'utf8'));
if (!routes.exclude.includes('/assets/*')) throw new Error('Pages static asset routing is required');
console.log('Source syntax and Worker module graph verified.');
