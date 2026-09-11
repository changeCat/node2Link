// Shared local/test adapter. It models ordering, metadata, pagination and TTL,
// but deliberately makes no claim to simulate Cloudflare's regional consistency.
export class MemoryKV {
	constructor({ now = () => Date.now(), pageSize = 1000, before } = {}) {
		this.values = new Map();
		this.now = now;
		this.pageSize = pageSize;
		this.before = before;
	}
	async get(key) {
		await this.before?.('get', key);
		const entry = this.values.get(key);
		if (entry?.expiresAt && entry.expiresAt <= this.now()) { this.values.delete(key); return null; }
		return entry?.value ?? null;
	}
	async getMany(keys) {
		return new Map(await Promise.all(keys.map(async key => [key, await this.get(key)])));
	}
	async put(key, value, options = {}) {
		await this.before?.('put', key);
		if (options.metadata && new TextEncoder().encode(JSON.stringify(options.metadata)).length > 1024) throw new Error('KV metadata exceeds 1024 bytes');
		this.values.set(key, { value: String(value), metadata: structuredClone(options.metadata), expiresAt: options.expirationTtl ? this.now() + options.expirationTtl * 1000 : options.expiration ? options.expiration * 1000 : null });
	}
	async delete(key) { await this.before?.('delete', key); this.values.delete(key); }
	async putMany(records) {
		for (const record of records) await this.put(record.key, record.value, record.options);
	}
	async list({ prefix = '', limit = 1000, cursor = '' } = {}) {
		await this.before?.('list', prefix);
		const keys = [...this.values].filter(([name, entry]) => name.startsWith(prefix) && (!entry.expiresAt || entry.expiresAt > this.now()))
			.map(([name, entry]) => ({ name, metadata: structuredClone(entry.metadata) }))
			.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
			.filter(key => !cursor || key.name > cursor);
		const page = keys.slice(0, Math.min(limit, this.pageSize));
		const complete = page.length === keys.length;
		return { keys: page, list_complete: complete, cursor: complete ? '' : page.at(-1).name };
	}
	async listWithValues(options = {}) {
		const page = await this.list(options);
		return {
			records: await Promise.all(page.keys.map(async key => ({ ...key, value: await this.get(key.name) }))),
			list_complete: page.list_complete,
			cursor: page.cursor
		};
	}
}
