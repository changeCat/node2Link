import { appendRecord, isObject, listKeys, readJSON, readRequiredJSON, writeJSON } from './kv.js';
import { isValidShareId } from './shares.js';

export const SETTINGS_KEY = 'NODE2LINK.settings.json';
const PREFIX = 'NODE2LINK.v2.settings.';
const IDENTITY_KEY = 'NODE2LINK.identity.json';
// Journal records are immutable. Cache only their bodies, never the latest-key
// lookup, legacy settings or identity; token changes still read the current KV view.
const snapshotCaches = new WeakMap();
async function readSnapshot(kv, key) {
	let cache = snapshotCaches.get(kv);
	if (!cache) snapshotCaches.set(kv, cache = new Map());
	if (cache.has(key)) return cache.get(key);
	const record = await readRequiredJSON(kv, key);
	if (new TextEncoder().encode(JSON.stringify(record)).length <= 64 * 1024) {
		if (cache.size >= 8) cache.delete(cache.keys().next().value);
		cache.set(key, record);
	}
	return record;
}
export const SETTING_SECTIONS = {
	display: ['subscriptionName', 'pageTitle', 'browserIconURL'],
	entry: ['subscriptionToken'],
	conversion: ['converterMode', 'customConverterURL', 'ruleMode', 'customSubConfigURL'],
	clients: ['displayFormats']
};

export async function readPersistedSettings(env) {
	if (!env.KV) return {};
	const [legacy, keys, identity] = await Promise.all([
		readJSON(env.KV, SETTINGS_KEY, {}, isObject), listKeys(env.KV, PREFIX),
		readJSON(env.KV, IDENTITY_KEY, {}, isObject)
	]);
	const settings = { ...legacy, ...identity };
	const latest = new Map();
	for (const key of keys.reverse()) {
		const sections = key.metadata?.sections;
		if (!Array.isArray(sections)) {
			const record = await readSnapshot(env.KV, key.name);
			for (const section of record.sections) if (SETTING_SECTIONS[section] && !latest.has(section)) latest.set(section, key.name);
		} else for (const section of sections) if (SETTING_SECTIONS[section] && !latest.has(section)) latest.set(section, key.name);
		if (latest.size === Object.keys(SETTING_SECTIONS).length) break;
	}
	const records = new Map(await Promise.all([...new Set(latest.values())].map(async key => [key, await readSnapshot(env.KV, key)])));
	for (const [section, key] of latest) {
		const record = records.get(key);
		for (const field of SETTING_SECTIONS[section] || []) if (Object.hasOwn(record.settings, field)) settings[field] = structuredClone(record.settings[field]);
		settings.savedAt = [settings.savedAt || '', record.settings.savedAt || ''].sort().at(-1);
	}
	return settings;
}

export async function saveSettingsSections(kv, settings, section) {
	const sections = section === 'all' ? Object.keys(SETTING_SECTIONS) : [section];
	const patch = { savedAt: settings.savedAt };
	for (const name of sections) for (const field of SETTING_SECTIONS[name]) patch[field] = settings[field];
	await appendRecord(kv, PREFIX, { schemaVersion: 2, sections, settings: patch }, { sections });
}

// Called only after successful authentication. The candidate is deterministic so
// simultaneous first logins do not create different links. Legacy IDs win.
export async function ensureMainIdentity(env, runtime, settings) {
	if (!env.KV || isValidShareId(settings.mainSubscriptionId) || !isValidShareId(runtime.mainSubscriptionId)) return;
	await writeJSON(env.KV, IDENTITY_KEY, { mainSubscriptionId: runtime.mainSubscriptionId });
}
