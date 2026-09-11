import { normalizeGeneratedNodeSettings, normalizeStoredNode } from '../domain/generated-nodes.js';
import { readJSON, isObject, writeJSON } from './kv.js';
import { hmacBase64Url, sessionSecret, adminPassword } from '../auth.js';
import { readNodeRecords } from './node-records.js';
const SETTINGS_KEY = 'NODE2LINK.api-subscription.settings.json';
const BOOTSTRAP_KEY = 'NODE2LINK.api-subscription.bootstrap.v3';
const initializing = new WeakMap();
export async function readGeneratedNodeSettings(kv) {
	const parsed = kv ? await readJSON(kv, SETTINGS_KEY, {}, isObject) : {};
	if (kv && !parsed.token) {
		const bootstrap = await readJSON(kv, BOOTSTRAP_KEY, null, value => /^[A-Za-z0-9_-]{16,128}$/.test(value?.token || ''));
		if (bootstrap) parsed.token = bootstrap.token;
	}
	let settings;
	try {
		settings = normalizeGeneratedNodeSettings({}, parsed, { generateToken: false });
	} catch (error) {
		console.warn('API 订阅旧模板不再兼容，请重新保存模板:', error.message);
		settings = normalizeGeneratedNodeSettings({ token: parsed?.token || '', nodeTemplate: '', nameTemplate: 'CF-{{type}}-{{address}}:{{port}}' }, {}, { generateToken: false });
	}
	return settings;
}

// Authenticated mutation only. The bootstrap key is separate from authoritative
// settings, so a late initialization cannot overwrite a rotated token/template.
export async function initializeGeneratedNodeSettings(env) {
	if (!env.KV || !adminPassword(env)) throw new Error('API Token 初始化需要已配置的管理员和 KV');
	if (!initializing.has(env.KV)) {
		const pending = initialize(env).finally(() => initializing.delete(env.KV));
		initializing.set(env.KV, pending);
	}
	return initializing.get(env.KV);
}

async function initialize(env) {
	const current = await readGeneratedNodeSettings(env.KV);
	if (current.token) return current;
	if (!env.KV || !adminPassword(env)) throw new Error('API Token 初始化需要已配置的管理员和 KV');
	const token = await hmacBase64Url('node2link-api-bootstrap-v1', sessionSecret(env));
	await writeJSON(env.KV, BOOTSTRAP_KEY, { token });
	const stored = await readGeneratedNodeSettings(env.KV);
	return { ...stored, token: stored.token || token };
}

export async function readGeneratedNodes(kv, options) {
	return readNodeRecords(kv, normalizeStoredNode, options);
}

export async function saveGeneratedNodeSettings(kv, settings) {
	await writeJSON(kv, SETTINGS_KEY, settings);
}
