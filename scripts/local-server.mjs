import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../dist/_worker.js';

class MemoryKV {
	constructor() {
		this.values = new Map();
	}
	async get(key) {
		return this.values.has(key) ? this.values.get(key).value : null;
	}
	async put(key, value, options = {}) {
		this.values.set(key, { value: String(value), metadata: options.metadata });
	}
	async delete(key) {
		this.values.delete(key);
	}
	async list(options = {}) {
		const prefix = options.prefix || '';
		const keys = [...this.values.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([name, entry]) => ({ name, metadata: entry.metadata }))
			.slice(0, options.limit || 1000);
		return { keys, list_complete: true, cursor: '' };
	}
}

const distDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.NODE2LINK_DEV_PORT || 8788);
const env = {
	KV: new MemoryKV(),
	ADMIN_USERNAME: process.env.NODE2LINK_DEV_USERNAME || 'admin',
	ADMIN_PASSWORD: process.env.NODE2LINK_DEV_PASSWORD || 'dev-password',
	SESSION_SECRET: process.env.NODE2LINK_DEV_SESSION_SECRET || 'dev-session-secret',
	REQUESTLOG: '0'
};
const mimeTypes = {
	'.css': 'text/css;charset=utf-8',
	'.js': 'text/javascript;charset=utf-8',
	'.json': 'application/json;charset=utf-8',
	'.png': 'image/png'
};

function isStaticPath(pathname) {
	return pathname.startsWith('/assets/');
}

async function serveStatic(pathname, response) {
	const file = resolve(distDirectory, '.' + pathname);
	if (file !== distDirectory && !file.startsWith(distDirectory + sep)) {
		response.writeHead(403).end('Forbidden');
		return;
	}
	try {
		const content = await readFile(file);
		response.writeHead(200, {
			'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream',
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff'
		});
		response.end(content);
	} catch {
		response.writeHead(404).end('Not Found');
	}
}

async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	return chunks.length ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (nodeRequest, nodeResponse) => {
	try {
		const origin = `http://${nodeRequest.headers.host || `127.0.0.1:${port}`}`;
		const url = new URL(nodeRequest.url || '/', origin);
		if (isStaticPath(url.pathname)) return serveStatic(url.pathname, nodeResponse);

		const body = ['GET', 'HEAD'].includes(nodeRequest.method || 'GET') ? undefined : await readBody(nodeRequest);
		const request = new Request(url, {
			method: nodeRequest.method,
			headers: nodeRequest.headers,
			body
		});
		const pending = [];
		const response = await worker.fetch(request, env, { waitUntil(task) { pending.push(Promise.resolve(task)); } });
		const headers = Object.fromEntries(response.headers.entries());
		nodeResponse.writeHead(response.status, headers);
		nodeResponse.end(Buffer.from(await response.arrayBuffer()));
		void Promise.allSettled(pending);
	} catch (error) {
		nodeResponse.writeHead(500, { 'Content-Type': 'text/plain;charset=utf-8' });
		nodeResponse.end(error.stack || error.message);
	}
});

server.listen(port, '127.0.0.1', () => {
	console.log(`Node2Link local preview: http://127.0.0.1:${port}`);
	console.log(`Login: ${env.ADMIN_USERNAME} / ${env.ADMIN_PASSWORD}`);
});
