// Request-local measurements only; names are constants and never contain URLs or tokens.
export async function timed(timings, name, operation) {
	const started = performance.now();
	try { return await operation(); }
	finally { timings?.push(`${name};dur=${(performance.now() - started).toFixed(1)}`); }
}
