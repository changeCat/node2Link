import { StorageError } from './kv.js';

const NODE_PREFIX = 'nodes.';
const MAIN_BODY_PREFIX = 'blob.main.';
const SHARE_BODY_PREFIX = 'blob.share.';
const REQUEST_PREFIX = 'requests.';

const bindings = new WeakMap();
const isBlobKey = key => key.startsWith(MAIN_BODY_PREFIX) || key.startsWith(SHARE_BODY_PREFIX);

function parseMetadata(value) {
	if (value === null || value === undefined || value === '') return undefined;
	try { return JSON.parse(value); }
	catch (cause) { throw new StorageError('D1 元数据格式异常', { cause }); }
}

function isCurrent(row) {
	return row && (row.expires_at === null || row.expires_at === undefined
		|| Number(row.expires_at) > Math.floor(Date.now() / 1000));
}

function upperBound(prefix) { return prefix + '\uffff'; }

function chunks(items, size) {
	const result = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

class AppStorage {
	constructor(kv, db) {
		this.kv = kv;
		this.db = db;
	}

	async get(key) {
		if (isBlobKey(key)) return this.kv.get(key);
		try {
			const row = await this.db.prepare('SELECT value, expires_at FROM node2link_records WHERE key = ?1').bind(key).first();
			return isCurrent(row) ? row.value : null;
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 读取失败', { cause });
		}
	}

	async getMany(keys) {
		const result = new Map(keys.map(key => [key, null]));
		const recordKeys = keys.filter(key => !isBlobKey(key));
		const blobKeys = keys.filter(isBlobKey);
		try {
			if (recordKeys.length) {
				const placeholders = recordKeys.map((_, index) => '?' + (index + 1)).join(',');
				const sql = `SELECT key, value, expires_at FROM node2link_records WHERE key IN (${placeholders})`;
				const { results = [] } = await this.db.prepare(sql).bind(...recordKeys).all();
				for (const row of results) if (isCurrent(row)) result.set(row.key, row.value);
			}
			await Promise.all(blobKeys.map(async key => result.set(key, await this.kv.get(key))));
			return result;
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 批量读取失败', { cause });
		}
	}

	statement(key, value, options = {}, now = Math.floor(Date.now() / 1000)) {
		const expiresAt = options.expirationTtl ? now + Number(options.expirationTtl)
			: options.expiration ? Number(options.expiration) : null;
		return this.db.prepare(`INSERT INTO node2link_records(key,value,metadata,expires_at,updated_at)
			VALUES(?1,?2,?3,?4,?5) ON CONFLICT(key) DO UPDATE SET
			value=excluded.value,metadata=excluded.metadata,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
			.bind(key, String(value), options.metadata === undefined ? null : JSON.stringify(options.metadata), expiresAt, now);
	}

	nodeStatements(key, serialized) {
		let record;
		try { record = JSON.parse(serialized); }
		catch (cause) { throw new StorageError('节点存储数据格式异常', { cause }); }
		if (!record || (!Array.isArray(record.nodes) && !Array.isArray(record.deletedIds))) {
			throw new StorageError('节点存储数据格式异常');
		}
		const nodes = record.nodes || [];
		const deletedIds = record.deletedIds || [];
		if (nodes.some(node => !node || typeof node.id !== 'string' || typeof node.content !== 'string')
			|| deletedIds.some(id => typeof id !== 'string')) throw new StorageError('节点存储数据格式异常');
		const now = Math.floor(Date.now() / 1000);
		const statements = [];
		for (const group of chunks(nodes.map((node, position) => ({ node, position })), 25)) {
			const params = [];
			const values = group.map(({ node, position }, index) => {
				const offset = index * 4;
				params.push(node.id, key + '.' + String(position).padStart(3, '0'), JSON.stringify(node), now);
				return `(?${offset + 1},?${offset + 2},?${offset + 3},?${offset + 4})`;
			}).join(',');
			statements.push(this.db.prepare(`INSERT INTO node2link_nodes(id,sort_key,value,updated_at) VALUES ${values} ON CONFLICT(id) DO NOTHING`).bind(...params));
		}
		for (const group of chunks(deletedIds, 100)) {
			const placeholders = group.map((_, index) => '?' + (index + 1)).join(',');
			statements.push(this.db.prepare(`DELETE FROM node2link_nodes WHERE id IN (${placeholders})`).bind(...group));
		}
		return statements;
	}

	async put(key, value, options = {}) {
		if (isBlobKey(key)) return this.kv.put(key, value, options);
		try {
			if (key.startsWith(NODE_PREFIX)) {
				const statements = this.nodeStatements(key, String(value));
				if (statements.length) await this.db.batch(statements);
				return;
			}
			await this.statement(key, value, options).run();
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 写入失败', { cause });
		}
	}

	async putMany(records) {
		if (!records.length) return;
		if (records.some(record => record.key.startsWith(NODE_PREFIX) || isBlobKey(record.key))) {
			for (const record of records) await this.put(record.key, record.value, record.options);
			return;
		}
		try {
			const now = Math.floor(Date.now() / 1000);
			await this.db.batch(records.map(record => this.statement(record.key, record.value, record.options, now)));
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 事务写入失败', { cause });
		}
	}

	async delete(key) {
		if (isBlobKey(key)) return this.kv.delete(key);
		try {
			await this.db.prepare('DELETE FROM node2link_records WHERE key = ?1').bind(key).run();
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 删除失败', { cause });
		}
	}

	async listNodes({ limit = 1000, cursor = '' } = {}, values = true) {
		const size = Math.max(1, Math.min(1000, Number(limit) || 1000));
		const columns = values ? 'sort_key, value' : 'sort_key';
		const { results = [] } = await this.db.prepare(`SELECT ${columns} FROM node2link_nodes
			WHERE sort_key > ?1 ORDER BY sort_key LIMIT ?2`).bind(cursor || '', size + 1).all();
		const complete = results.length <= size;
		const page = results.slice(0, size);
		return { page, complete, cursor: complete ? '' : page.at(-1)?.sort_key || '' };
	}

	async listWithValues({ prefix = '', limit = 1000, cursor = '' } = {}) {
		try {
			if (prefix === NODE_PREFIX) {
				const { page, complete, cursor: next } = await this.listNodes({ limit, cursor }, true);
				return {
					records: page.map(row => ({ name: row.sort_key, value: JSON.stringify({ nodes: [JSON.parse(row.value)] }) })),
					list_complete: complete, cursor: next
				};
			}
			if (isBlobKey(prefix)) throw new StorageError('正文不支持列表读取');
			const size = Math.max(1, Math.min(1000, Number(limit) || 1000));
			const now = Math.floor(Date.now() / 1000);
			const { results = [] } = await this.db.prepare(`SELECT key, value, metadata, expires_at FROM node2link_records
				WHERE key >= ?1 AND key < ?2 AND key > ?3 AND (expires_at IS NULL OR expires_at > ?4)
				ORDER BY key LIMIT ?5`).bind(prefix, upperBound(prefix), cursor || '', now, size + 1).all();
			const complete = results.length <= size;
			const page = results.slice(0, size);
			return {
				records: page.map(row => ({ name: row.key, value: row.value, metadata: parseMetadata(row.metadata) })),
				list_complete: complete, cursor: complete ? '' : page.at(-1)?.key || ''
			};
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 批量记录读取失败', { cause });
		}
	}

	async list({ prefix = '', limit = 1000, cursor = '' } = {}) {
		if (isBlobKey(prefix)) throw new StorageError('正文不支持列表读取');
		try {
			if (prefix === NODE_PREFIX) {
				const { page, complete, cursor: next } = await this.listNodes({ limit, cursor }, false);
				return { keys: page.map(row => ({ name: row.sort_key })), list_complete: complete, cursor: next };
			}
			const size = Math.max(1, Math.min(1000, Number(limit) || 1000));
			const now = Math.floor(Date.now() / 1000);
			if (prefix === REQUEST_PREFIX && !cursor) {
				await this.db.prepare('DELETE FROM node2link_records WHERE expires_at IS NOT NULL AND expires_at <= ?1').bind(now).run();
			}
			const { results = [] } = await this.db.prepare(`SELECT key, metadata FROM node2link_records
				WHERE key >= ?1 AND key < ?2 AND key > ?3 AND (expires_at IS NULL OR expires_at > ?4)
				ORDER BY key LIMIT ?5`).bind(prefix, upperBound(prefix), cursor || '', now, size + 1).all();
			const complete = results.length <= size;
			const page = results.slice(0, size);
			return {
				keys: page.map(row => ({ name: row.key, metadata: parseMetadata(row.metadata) })),
				list_complete: complete, cursor: complete ? '' : page.at(-1)?.key || ''
			};
		} catch (cause) {
			if (cause instanceof StorageError) throw cause;
			throw new StorageError('D1 列表读取失败', { cause });
		}
	}
}

export function withStorageBindings(env) {
	if (env?.KV instanceof AppStorage) return env;
	if (!env?.DB) throw new StorageError('未绑定 D1 数据库，请将数据库绑定为 DB');
	if (!env?.KV) throw new StorageError('未绑定 KV 命名空间，请将命名空间绑定为 KV');
	let byKV = bindings.get(env.DB);
	if (!byKV) bindings.set(env.DB, byKV = new WeakMap());
	let storage = byKV.get(env.KV);
	if (!storage) byKV.set(env.KV, storage = new AppStorage(env.KV, env.DB));
	return { ...env, KV: storage };
}
