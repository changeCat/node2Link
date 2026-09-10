import { SUPPORTED_NODE_PROTOCOLS } from '../config.js';
export function encodeBase64(data) {
	const binary = new TextEncoder().encode(data);
	let base64 = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	for (let i = 0; i < binary.length; i += 3) {
		const byte1 = binary[i];
		const byte2 = binary[i + 1] || 0;
		const byte3 = binary[i + 2] || 0;
		base64 += chars[byte1 >> 2];
		base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
		base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
		base64 += chars[byte3 & 63];
	}
	const padding = 3 - (binary.length % 3 || 3);
	return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
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

export async function ADD(envadd) {
	var addtext = envadd.replace(/[	"'|\r\n]+/g, '\n').replace(/\n+/g, '\n');	// 替换为换行
	//console.log(addtext);
	if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
	const add = addtext.split('\n');
	//console.log(add);
	return add;
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
