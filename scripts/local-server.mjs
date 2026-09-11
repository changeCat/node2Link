import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../dist/_worker.js';

import { MemoryKV } from './lib/memory-kv.mjs';
import { MemoryD1 } from './lib/memory-d1.mjs';

const distDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.NODE2LINK_DEV_PORT || 8788);
const env = {
	KV: new MemoryKV(),
	DB: new MemoryD1(),
	ADMIN_USERNAME: process.env.NODE2LINK_DEV_USERNAME || 'admin',
	ADMIN_PASSWORD: process.env.NODE2LINK_DEV_PASSWORD || 'dev-password',
	SESSION_SECRET: process.env.NODE2LINK_DEV_SESSION_SECRET || 'dev-session-secret',
	API_SUBSCRIPTION_ENABLED: process.env.API_SUBSCRIPTION_ENABLED || process.env.NODE2LINK_DEV_API_SUBSCRIPTION_ENABLED || 'false',
	REQUESTLOG: process.env.NODE2LINK_DEV_REQUESTLOG || '0'
};
const mimeTypes = {
	'.css': 'text/css;charset=utf-8',
	'.js': 'text/javascript;charset=utf-8',
	'.json': 'application/json;charset=utf-8',
	'.png': 'image/png'
};

// Forward with backpressure. On early rejection, detach the stream before
// draining the HTTP request so cancellation cannot enqueue into a closed stream.
function requestBody(request) {
	let detach;
	return new ReadableStream({
		start(controller) {
			let closed = false;
			const data = chunk => {
				if (closed) return;
				controller.enqueue(chunk);
				if (controller.desiredSize <= 0) request.pause();
			};
			const end = () => { detach(); controller.close(); };
			const error = cause => { detach(); controller.error(cause); };
			detach = () => {
				closed = true;
				request.off('data', data).off('end', end).off('error', error);
			};
			request.on('data', data).once('end', end).once('error', error);
			request.pause();
		},
		pull() { request.resume(); },
		cancel() { detach(); request.on('error', () => {}); request.resume(); }
	}, { highWaterMark: 0 });
}

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

const server = createServer(async (nodeRequest, nodeResponse) => {
	try {
		const origin = `http://${nodeRequest.headers.host || `127.0.0.1:${port}`}`;
		const url = new URL(nodeRequest.url || '/', origin);
		if (isStaticPath(url.pathname)) return serveStatic(url.pathname, nodeResponse);

		const body = ['GET', 'HEAD'].includes(nodeRequest.method || 'GET') ? undefined : requestBody(nodeRequest);
		const request = new Request(url, {
			method: nodeRequest.method,
			headers: nodeRequest.headers,
			body,
			...(body ? { duplex: 'half' } : {})
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
