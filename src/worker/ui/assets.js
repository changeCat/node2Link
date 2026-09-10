const ASSET_VERSION = globalThis.__NODE2LINK_ASSET_VERSION__ || 'dev';

export function assetURL(name) {
	return `/assets/${encodeURIComponent(name)}?v=${encodeURIComponent(ASSET_VERSION)}`;
}

export function basePageStyles() {
	return `@import url("${assetURL('base.css')}");`;
}

export function pageScript(name, data = {}) {
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	return `<script type="application/json" id="page-data-${name}">${json}</script><script src="${assetURL(name + '.js')}" defer></script>`;
}
