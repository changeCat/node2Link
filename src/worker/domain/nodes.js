import { SUPPORTED_NODE_PROTOCOLS } from '../config.js';
export function encodeBase64(text) {
 const bytes = new TextEncoder().encode(text);
 // A multiple of three prevents padding between chunks. Limit arguments passed
 // to fromCharCode so multi-megabyte subscriptions cannot exhaust the stack.
 const chunkSize = 3 * 8192;
 const encoded = [];
 for (let offset = 0; offset < bytes.length; offset += chunkSize) {
  const chunk = bytes.subarray(offset, offset + chunkSize);
  encoded.push(btoa(String.fromCharCode(...chunk)));
 }
 return encoded.join('');
}

export function isV2rayNUserAgent(value) {
	return /(?:^|[^a-z0-9])v2rayn(?:$|[^a-z0-9])/i.test(String(value || ''));
}

export function normalizeV2rayNSubscription(content) {
	let filteredSsObfsTls = 0;
	let normalizedAnytlsSni = 0;
	const lines = String(content || '').split('\n');
	const compatibleLines = [];

	for (const originalLine of lines) {
		const line = originalLine.trim();
		if (/^ss:\/\//i.test(line)) {
			try {
				const plugin = new URL(line).searchParams.get('plugin') || '';
				const parts = plugin.split(';').map(part => part.trim().toLowerCase()).filter(Boolean);
				const pluginName = parts[0] === 'simple-obfs' ? 'obfs-local' : parts[0];
				if (pluginName === 'obfs-local' && parts.includes('obfs=tls')) {
					filteredSsObfsTls += 1;
					continue;
				}
			} catch (error) {
				// 无法解析的节点保持原样，由客户端决定是否接受。
			}
		}

		if (/^anytls:\/\//i.test(line)) {
			try {
				const parsed = new URL(line);
				const peer = parsed.searchParams.get('peer');
				if (peer && !parsed.searchParams.get('sni')) {
					parsed.searchParams.set('sni', peer);
					compatibleLines.push(parsed.toString());
					normalizedAnytlsSni += 1;
					continue;
				}
			} catch (error) {
				// 无法解析的节点保持原样，由客户端决定是否接受。
			}
		}

		compatibleLines.push(originalLine);
	}

	return {
		content: compatibleLines.join('\n'),
		filteredSsObfsTls,
		normalizedAnytlsSni
	};
}

// Accept the legacy list separators; encoded delimiters remain part of a URL.
// Keep ordering and duplicates here: callers decide when to deduplicate.
export function splitSubscriptionLinks(input) {
 return String(input ?? '').split(/[\r\n\t|'"]+/u)
  .map(link => link.trim()).filter(link => link.length > 0);
}

export function summarizeMainSubscriptionContent(content) {
	const summary = { nodes: 0, sources: 0 };
	for (const line of String(content || '').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^https?:\/\//i.test(trimmed)) {
			summary.sources += 1;
			continue;
		}
		const protocol = trimmed.match(/^([a-z0-9+.-]+):\/\//i)?.[1]?.toLowerCase();
		if (SUPPORTED_NODE_PROTOCOLS.includes(protocol)) summary.nodes += 1;
	}
	return summary;
}

export function base64Decode(str) {
	const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
	const decoder = new TextDecoder('utf-8');
	return decoder.decode(bytes);
}

export function clashFix(content) {
	if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
		let lines;
		if (content.includes('\r\n')) {
			lines = content.split('\r\n');
		} else {
			lines = content.split('\n');
		}

		let result = "";
		for (let line of lines) {
			if (line.includes('type: wireguard')) {
				const 备改内容 = `, mtu: 1280, udp: true`;
				const 正确内容 = `, mtu: 1280, remote-dns-resolve: true, udp: true`;
				result += line.replace(new RegExp(备改内容, 'g'), 正确内容) + '\n';
			} else {
				result += line + '\n';
			}
		}

		content = result;
	}
	return content;
}

export function isValidBase64(str) {
	// 先移除所有空白字符(空格、换行、回车等)
	const cleanStr = str.replace(/\s/g, '');
	const base64Regex = /^[A-Za-z0-9+/=]+$/;
	return base64Regex.test(cleanStr);
}

export function isStructuredSubscription(content) {
	const text = String(content || '');
	return /(?:^|\r?\n)\s*(?:proxies|proxy-providers)\s*:/i.test(text)
		|| /["']outbounds["']\s*:/i.test(text);
}
