class MemoryD1Statement {
	constructor(db, sql) {
		this.db = db;
		this.sql = sql;
		this.params = [];
	}
	bind(...params) {
		const statement = new MemoryD1Statement(this.db, this.sql);
		statement.params = params;
		return statement;
	}
	async first() { return this.db.execute(this, 'first'); }
	async all() { return { results: await this.db.execute(this, 'all') }; }
	async run() { return this.db.execute(this, 'run'); }
}

export class MemoryD1 {
	constructor({ initialized = false, before } = {}) {
		this.initialized = initialized;
		this.before = before;
		this.records = new Map();
		this.nodes = new Map();
		this.metrics = { exec: 0, first: 0, all: 0, run: 0, batch: 0 };
	}

	prepare(sql) { return new MemoryD1Statement(this, sql); }

	async exec(sql) {
		await this.before?.('exec', sql, []);
		this.metrics.exec++;
		this.initialized = true;
		return { count: 4, duration: 0 };
	}

	async batch(statements) {
		this.assertInitialized();
		await this.before?.('batch', '', statements.map(statement => statement.params));
		this.metrics.batch++;
		const records = structuredClone(this.records);
		const nodes = structuredClone(this.nodes);
		const results = statements.map(statement => this.runStatement(statement, records, nodes));
		this.records = records;
		this.nodes = nodes;
		return results;
	}

	async execute(statement, operation) {
		if (/^CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i.test(statement.sql.trim())) {
			await this.before?.(operation, statement.sql, statement.params);
			this.metrics[operation]++;
			this.initialized = true;
			return { success: true, meta: { changes: 0 } };
		}
		this.assertInitialized();
		await this.before?.(operation, statement.sql, statement.params);
		this.metrics[operation]++;
		return this.runStatement(statement, this.records, this.nodes);
	}

	assertInitialized() {
		if (!this.initialized) throw new Error('no such table: node2link_records');
	}

	runStatement(statement, records, nodes) {
		const sql = statement.sql.replace(/\s+/g, ' ').trim();
		const params = statement.params;
		if (/^INSERT INTO node2link_records/i.test(sql)) {
			const [key, value, metadata, expires_at, updated_at] = params;
			records.set(key, { key, value, metadata, expires_at, updated_at });
			return { success: true, meta: { changes: 1 } };
		}
		if (/^INSERT INTO node2link_nodes/i.test(sql)) {
			let changes = 0;
			for (let index = 0; index < params.length; index += 4) {
				const [id, sort_key, value, updated_at] = params.slice(index, index + 4);
				if (!nodes.has(id)) {
					if ([...nodes.values()].some(row => row.sort_key === sort_key)) throw new Error('UNIQUE constraint failed: node2link_nodes.sort_key');
					nodes.set(id, { id, sort_key, value, updated_at });
					changes++;
				}
			}
			return { success: true, meta: { changes } };
		}
		if (/^DELETE FROM node2link_nodes WHERE id IN/i.test(sql)) {
			let changes = 0;
			for (const id of params) if (nodes.delete(id)) changes++;
			return { success: true, meta: { changes } };
		}
		if (/^DELETE FROM node2link_records WHERE expires_at/i.test(sql)) {
			let changes = 0;
			for (const [key, row] of records) {
				if (row.expires_at !== null && row.expires_at !== undefined && row.expires_at <= params[0]) {
					records.delete(key);
					changes++;
				}
			}
			return { success: true, meta: { changes } };
		}
		if (/^DELETE FROM node2link_records WHERE key/i.test(sql)) {
			const changed = records.delete(params[0]);
			return { success: true, meta: { changes: changed ? 1 : 0 } };
		}
		if (/^SELECT value, expires_at FROM node2link_records WHERE key =/i.test(sql)) {
			const row = records.get(params[0]);
			return row ? { value: row.value, expires_at: row.expires_at } : null;
		}
		if (/^SELECT key, value, expires_at FROM node2link_records WHERE key IN/i.test(sql)) {
			return params.flatMap(key => {
				const row = records.get(key);
				return row ? [{ key, value: row.value, expires_at: row.expires_at }] : [];
			});
		}
		if (/^SELECT sort_key, value FROM node2link_nodes/i.test(sql)) {
			return this.nodeRange(nodes, params).map(row => ({ sort_key: row.sort_key, value: row.value }));
		}
		if (/^SELECT sort_key FROM node2link_nodes/i.test(sql)) {
			return this.nodeRange(nodes, params).map(row => ({ sort_key: row.sort_key }));
		}
		if (/^SELECT key, value, metadata, expires_at FROM node2link_records/i.test(sql)) {
			return this.range(records, params).map(row => ({
				key: row.key, value: row.value, metadata: row.metadata, expires_at: row.expires_at
			}));
		}
		if (/^SELECT key, metadata FROM node2link_records/i.test(sql)) {
			return this.range(records, params).map(row => ({ key: row.key, metadata: row.metadata }));
		}
		throw new Error('Unsupported MemoryD1 statement: ' + sql);
	}

	range(records, [lower, upper, cursor, now, limit]) {
		return [...records.values()]
			.filter(row => row.key >= lower && row.key < upper && row.key > cursor
				&& (row.expires_at === null || row.expires_at === undefined || row.expires_at > now))
			.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
			.slice(0, Number(limit));
	}

	nodeRange(nodes, [cursor, limit]) {
		return [...nodes.values()]
			.filter(row => row.sort_key > cursor)
			.sort((a, b) => a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0)
			.slice(0, Number(limit));
	}
}
