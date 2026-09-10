import { normalizeGeneratedNodeSettings, normalizeStoredNode } from '../domain/generated-nodes.js';
import { readJSON, isObject, StorageError, writeJSON } from './kv.js';
import { readNodeRecords } from './node-records.js';
const SETTINGS_KEY = 'NODE2LINK.api-subscription.settings.json';
export async function readGeneratedNodeSettings(kv, { ensureToken = false } = {}) {
	const parsed = kv ? await readJSON(kv, SETTINGS_KEY, {}, isObject) : {};
	let settings;
	try {
		settings = normalizeGeneratedNodeSettings({}, parsed && typeof parsed === 'object' ? parsed : {});
	} catch (error) {
		console.warn('API 订阅旧模板不再兼容，请重新保存模板:', error.message);
		settings = normalizeGeneratedNodeSettings({ token: parsed?.token || '', nodeTemplate: '', nameTemplate: 'CF-{{type}}-{{address}}:{{port}}' });
	}
	if (ensureToken && kv && (!parsed || parsed.token !== settings.token)) await writeJSON(kv, SETTINGS_KEY, settings);
	return settings;
}

export async function readGeneratedNodes(kv) {
	return readNodeRecords(kv, normalizeStoredNode);
}

export async function saveGeneratedNodeSettings(kv, settings) {
	await writeJSON(kv, SETTINGS_KEY, settings);
}
