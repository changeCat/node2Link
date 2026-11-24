export function shareLines(content) {
	return [...new Set(String(content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function isShareSource(line) {
	return /^https?:\/\//i.test(line);
}

// One character per normalized line keeps provenance compact even for large shares.
export function shareOrigins(content, lineOrigins = '') {
	return new Map(shareLines(content).map((line, index) => [line, lineOrigins[index] || 'u']));
}
