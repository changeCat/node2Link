export class LoonPortHoppingError extends Error {
	constructor() {
		super('Unable to preserve Loon HY2 port hopping');
		this.name = 'LoonPortHoppingError';
	}
}

function normalizePorts(value) {
	if (!value || value.length > 4096) throw new LoonPortHoppingError();
	const ranges = value.split(',').map(item => {
		const match = item.trim().match(/^(\d{1,5})(?:\s*[-:]\s*(\d{1,5}))?$/);
		if (!match) throw new LoonPortHoppingError();
		const start = Number(match[1]), end = Number(match[2] || match[1]);
		if (start < 1 || end > 65535 || start > end) throw new LoonPortHoppingError();
		return [start, end];
	}).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged = [];
	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
		else merged.push([...range]);
	}
	return merged.map(([start, end]) => start === end ? String(start) : `${start}:${end}`).join(',');
}

const hostKey = value => value.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
const identity = (host, port, password) => JSON.stringify([hostKey(host), Number(port), password]);

// Split Loon fields without treating commas inside quoted passwords as delimiters.
function splitFields(value) {
	const fields = [];
	let start = 0, quoted = false;
	for (let i = 0; i < value.length; i++) {
		if (quoted && value[i] === '\\') { i++; continue; }
		if (value[i] === '"') {
			if (quoted && value[i + 1] === '"') { i++; continue; }
			quoted = !quoted;
		} else if (!quoted && value[i] === ',') {
			fields.push(value.slice(start, i));
			start = i + 1;
		}
	}
	if (quoted) throw new LoonPortHoppingError();
	fields.push(value.slice(start));
	return fields;
}

function fieldValue(value = '') {
	const text = value.trim();
	return text.startsWith('"') && text.endsWith('"')
		? text.slice(1, -1).replace(/""/g, '"').replace(/\\(["\\])/g, '$1') : text;
}

export function restoreLoonPortHopping(sourceContent, convertedContent) {
	const sources = new Map();
	for (const raw of String(sourceContent || '').split(/\r?\n/)) {
		const line = raw.trim();
		if (!/^(?:hysteria2|hy2):\/\//i.test(line)) continue;
		let url, password;
		try {
			url = new URL(line);
			password = decodeURIComponent(url.username + (url.password ? ':' + url.password : ''));
		} catch {
			if (/[?&]mport=/i.test(line)) throw new LoonPortHoppingError();
			continue;
		}
		const mport = url.searchParams.get('mport');
		const ports = mport === null ? '' : normalizePorts(mport);
		const key = identity(url.hostname, url.port || 443, password);
		const variants = sources.get(key) || new Set();
		variants.add(ports);
		sources.set(key, variants);
	}
	const hopping = new Map();
	for (const [key, variants] of sources) {
		if (![...variants].some(Boolean)) continue;
		// Never guess between different source settings sharing the same credentials.
		if (variants.size !== 1) throw new LoonPortHoppingError();
		hopping.set(key, [...variants][0]);
	}
	if (!hopping.size) return convertedContent;

	const matched = new Set();
	let section = '';
	const content = convertedContent.split(/(\r?\n)/).map(line => {
		const heading = line.trim().match(/^\[([^\]]+)\](?:\s*[#;].*)?$/);
		if (heading) { section = heading[1].trim().toLowerCase(); return line; }
		if ((section && section !== 'proxy') || /^\s*[#;]/.test(line)) return line;
		const match = line.match(/^(\s*.+?=\s*)(?:hysteria2|hy2)\s*,/i);
		if (!match) return line;
		const fields = splitFields(line.slice(match[1].length));
		const key = identity(fieldValue(fields[1]), fieldValue(fields[2]), fieldValue(fields[3]));
		const ports = hopping.get(key);
		if (!ports) return line;
		matched.add(key);
		const options = fields.slice(4);
		const intervalField = options.find(item => /^\s*hop-interval\s*=/i.test(item));
		const interval = intervalField ? fieldValue(intervalField.slice(intervalField.indexOf('=') + 1)) : '';
		// Preserve an explicit valid interval, otherwise use the project's 30-second default.
		const hopInterval = /^\d+$/.test(interval) && Number.isSafeInteger(Number(interval)) && Number(interval) > 0 ? Number(interval) : 30;
		const retained = options.filter(item => !/^\s*(?:server-ports|hop-interval)\s*=/i.test(item));
		return match[1] + [...fields.slice(0, 4), ...retained, `server-ports="${ports}"`, `hop-interval=${hopInterval}`].join(',');
	}).join('');
	if (matched.size !== hopping.size) throw new LoonPortHoppingError();
	return content;
}
