import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const assets = new URL('dist/assets/', root);
const pathOf = url => fileURLToPath(url);

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(new URL('public/', root), dist, { recursive: true });
await cp(new URL('sub.png', root), new URL('sub.png', dist));
await cp(
	new URL('node_modules/@keeex/qrcodejs-kx/qrcode.min.js', root),
	new URL('qrcode.min.js', assets)
);

await build({
	entryPoints: [pathOf(new URL('src/client/lucide.js', root))],
	outfile: pathOf(new URL('lucide.js', assets)),
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	minify: true,
	legalComments: 'none'
});

const versionInputs = await Promise.all([
	readFile(new URL('base.css', assets)),
	readFile(new URL('lucide.js', assets)),
	readFile(new URL('qrcode.min.js', assets)),
	readFile(new URL('src/client/qrcode-loader.js', root))
]);
const assetVersion = createHash('sha256').update(Buffer.concat(versionInputs)).digest('hex').slice(0, 12);
const define = { 'globalThis.__NODE2LINK_ASSET_VERSION__': JSON.stringify(assetVersion) };

await Promise.all([
	build({
		entryPoints: [pathOf(new URL('src/worker/index.js', root))],
		outfile: pathOf(new URL('_worker.js', dist)),
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		minify: true,
		legalComments: 'none',
		define
	}),
	build({
		entryPoints: [pathOf(new URL('src/client/qrcode-loader.js', root))],
		outfile: pathOf(new URL('qrcode-loader.js', assets)),
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		minify: true,
		legalComments: 'none',
		define
	})
]);

const worker = await readFile(new URL('_worker.js', dist));
const sizes = {
	workerBytes: worker.byteLength,
	assetVersion,
	generatedAt: new Date().toISOString()
};
await writeFile(new URL('build-info.json', dist), JSON.stringify(sizes, null, 2) + '\n');
