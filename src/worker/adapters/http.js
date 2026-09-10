export const REMOTE_FETCH_TIMEOUT_MS = 8000;
export const MAX_REMOTE_BYTES = 8 * 1024 * 1024;

async function readBody(response, signal, maxBytes) {
	if (Number(response.headers.get('Content-Length')) > maxBytes) {
		void response.body?.cancel();
		throw new RangeError('Remote response exceeds size limit');
	}
	if (!response.body) return null;
	const reader = response.body.getReader();
	const cancel = () => { void reader.cancel().catch(() => {}); };
	signal.addEventListener('abort', cancel, { once: true });
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) { cancel(); throw new RangeError('Remote response exceeds size limit'); }
			chunks.push(value);
		}
		const body = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
		return body;
	} finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

// The deadline includes DNS/headers AND the entire response body. fetchImpl is
// injectable so slow streams/failover can be tested without global mutations.
export async function fetchWithTimeout(input, init = {}, timeoutMs = REMOTE_FETCH_TIMEOUT_MS, { fetchImpl = globalThis.fetch, maxBytes = MAX_REMOTE_BYTES } = {}) {
	const controller = new AbortController();
	const sourceSignal = init.signal || (input instanceof Request ? input.signal : null);
	const forward = () => controller.abort(sourceSignal.reason);
	if (sourceSignal?.aborted) forward();
	else sourceSignal?.addEventListener('abort', forward, { once: true });
	let rejectAbort;
	const aborted = new Promise((_, reject) => { rejectAbort = reject; });
	const onAbort = () => rejectAbort(controller.signal.reason);
	controller.signal.addEventListener('abort', onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(new DOMException('Remote request timed out', 'TimeoutError')), Math.max(1, timeoutMs));
	try {
		controller.signal.throwIfAborted();
		return await Promise.race([aborted, (async () => {
			const response = await fetchImpl(input, { ...init, signal: controller.signal });
			if (controller.signal.aborted) {
				void response.body?.cancel().catch(() => {});
				controller.signal.throwIfAborted();
			}
			const body = await readBody(response, controller.signal, maxBytes);
			return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
		})()]);
	} finally {
		clearTimeout(timer);
		sourceSignal?.removeEventListener('abort', forward);
		controller.signal.removeEventListener('abort', onAbort);
	}
}

export function logRemote(event, input, fields = {}) {
	let host = 'invalid';
	try { host = new URL(input instanceof Request ? input.url : String(input)).hostname; } catch {}
	// Never log URL paths/query strings, credentials, response bodies or raw errors.
	console.log(JSON.stringify({ event, host, ...fields }));
}
