import { normalizeGeneratedNodeSettings, normalizeStoredNode } from '../domain/generated-nodes.js';
import { readJSON, isObject, writeJSON, appendRecord, listKeys, readRequiredJSON } from './kv.js';
import { hmacBase64Url, sessionSecret, adminPassword } from '../auth.js';
import { readNodeRecords } from './node-records.js';
const SETTINGS_KEY = 'NODE2LINK.api-subscription.settings.json';
const BOOTSTRAP_PREFIX = 'NODE2LINK.api-subscription.bootstrap.';
export async function readGeneratedNodeSettings(kv) {
	const parsed = kv ? await readJSON(kv, SETTINGS_KEY, {}, isObject) : {};
	if (kv && !parsed.token) {
		const keys = await listKeys(kv, BOOTSTRAP_PREFIX);
		if (keys.length) parsed.token = (await readRequiredJSON(kv, keys[0].name, value => /^[A-Za-z0-9_-]{16,128}$/.test(value?.token || ''))).token;
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

// Authenticated mutation only. Concurrent first calls derive the same candidate
// and append unique records; late initialization cannot overwrite a rotated token.
export async function initializeGeneratedNodeSettings(env) {
	const current = await readGeneratedNodeSettings(env.KV);
	if (current.token) return current;
	if (!env.KV || !adminPassword(env)) throw new Error('API Token 初始化需要已配置的管理员和 KV');
	const token = await hmacBase64Url('node2link-api-bootstrap-v1', sessionSecret(env));
	await appendRecord(env.KV, BOOTSTRAP_PREFIX, { token });
	const stored = await readGeneratedNodeSettings(env.KV);
	return { ...stored, token: stored.token || token };
}

export async function readGeneratedNodes(kv, options) {
	return readNodeRecords(kv, normalizeStoredNode, options);
}

export async function saveGeneratedNodeSettings(kv, settings) {
	await writeJSON(kv, SETTINGS_KEY, settings);
}
