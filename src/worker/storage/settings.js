import { isObject, readJSON, readJSONMap, writeJSON, writeJSONBatch } from './kv.js';
import { isValidShareId } from './shares.js';
import { cachedView, invalidateView } from './view-cache.js';

export const SETTINGS_PREFIX = 'settings.';
const IDENTITY_KEY = 'identity';
const PUBLIC_VIEW = 'settings:public-presentation';
export const SETTING_SECTIONS = {
	display: ['subscriptionName', 'pageTitle', 'browserIconURL'],
	entry: ['subscriptionToken'],
	conversion: ['converterMode', 'customConverterURL', 'ruleMode', 'customSubConfigURL'],
	clients: ['displayFormats'],
	logging: ['requestLogMode', 'requestLogSampleRate']
};

async function readSections(kv, sections, entry) {
	const storedSections = sections.filter(section => section !== 'entry' || entry === undefined);
	const keys = storedSections.map(section => SETTINGS_PREFIX + section);
	const values = await readJSONMap(kv, keys, {}, isObject);
	const records = sections.map(section => section === 'entry' && entry !== undefined ? entry : values.get(SETTINGS_PREFIX + section));
	const settings = {};
	for (let i = 0; i < sections.length; i++) {
		const record = records[i];
		for (const field of SETTING_SECTIONS[sections[i]]) if (Object.hasOwn(record, field)) settings[field] = record[field];
		if (record.savedAt) settings.savedAt = [settings.savedAt || '', record.savedAt].sort().at(-1);
	}
	return settings;
}

export async function readSubscriptionEntry(env) {
	return readJSON(env.KV, SETTINGS_PREFIX + 'entry', {}, isObject);
}

export async function readPersistedSettings(env, { entry } = {}) {
	const [settings, identity] = await Promise.all([
		readSections(env.KV, Object.keys(SETTING_SECTIONS), entry),
		readJSON(env.KV, IDENTITY_KEY, {}, isObject)
	]);
	return { ...identity, ...settings };
}

// Only presentation is cached. Credentials and main identity are always read
// directly from KV; there is no persistent snapshot or additional auth cache.
export async function readPublicSubscriptionSettings(env) {
	const [settings, identity] = await Promise.all([
		cachedView(env.KV, PUBLIC_VIEW, () => readSections(env.KV, ['display', 'conversion', 'clients', 'logging']), {
			fresh: false, ttlMs: 60_000,
			cacheable: value => new TextEncoder().encode(JSON.stringify(value)).length <= 64 * 1024
		}),
		readJSON(env.KV, IDENTITY_KEY, {}, isObject)
	]);
	return { mainSubscriptionId: identity.mainSubscriptionId, ...structuredClone(settings) };
}

export async function saveSettingsSections(kv, settings, section) {
	const sections = section === 'all' ? Object.keys(SETTING_SECTIONS) : [section];
	if (sections.some(name => !Object.hasOwn(SETTING_SECTIONS, name))) throw new Error('Unknown settings section');
	invalidateView(kv, PUBLIC_VIEW);
	try {
		// The UI saves one section at a time. Independent sections never replace
		// each other, while an all-section save is committed in one D1 batch.
		const records = sections.map(name => {
			const patch = { savedAt: settings.savedAt };
			for (const field of SETTING_SECTIONS[name]) if (Object.hasOwn(settings, field)) patch[field] = settings[field];
			return { key: SETTINGS_PREFIX + name, value: patch };
		});
		await writeJSONBatch(kv, records);
	} finally { invalidateView(kv, PUBLIC_VIEW); }
}

export async function ensureMainIdentity(env, runtime, settings) {
	if (isValidShareId(settings.mainSubscriptionId) || !isValidShareId(runtime.mainSubscriptionId)) return;
	await writeJSON(env.KV, IDENTITY_KEY, { mainSubscriptionId: runtime.mainSubscriptionId });
}
