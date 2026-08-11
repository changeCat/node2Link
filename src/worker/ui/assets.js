const ASSET_VERSION = globalThis.__NODE2LINK_ASSET_VERSION__ || 'dev';

export function assetURL(name) {
	return `/assets/${encodeURIComponent(name)}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

export function basePageStyles() {
	return `@import url("${assetURL('base.css')}");`;
}
