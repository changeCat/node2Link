// Large enough for 100 x 16 KiB nodes even with JSON/unicode escaping.
export const MAX_IMPORT_BODY_BYTES = 12 * 1024 * 1024;
export const IMPORT_BODY_TIMEOUT_MS = 15000;

export class RequestBodyError extends Error {
	constructor(message, status) { super(message); this.status = status; }
}

export async function readBoundedBody(request, limit = MAX_IMPORT_BODY_BYTES, timeoutMs = IMPORT_BODY_TIMEOUT_MS) {
	const tooLarge = () => new RequestBodyError(`请求体不能超过 ${limit} 字节`, 413);
	if (Number(request.headers.get('Content-Length')) > limit) {
		void request.body?.cancel().catch(() => {});
		throw tooLarge();
	}
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks = [];
	let size = 0;
	let failure;
	const stop = error => { failure = error; void reader.cancel().catch(() => {}); };
	const abort = () => stop(new RequestBodyError('请求已取消', 400));
	const timer = setTimeout(() => stop(new RequestBodyError('读取请求体超时', 408)), timeoutMs);
	request.signal.addEventListener('abort', abort, { once: true });
	if (request.signal.aborted) abort();
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (failure) throw failure;
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				void reader.cancel().catch(() => {});
				throw tooLarge();
			}
			chunks.push(value);
		}
	} finally {
		clearTimeout(timer);
		request.signal.removeEventListener('abort', abort);
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}
