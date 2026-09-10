export function normalizeSharePayload(payload) {
	const name = String(payload && payload.name || '').trim().replace(/[\r\n\0]/g, '').slice(0, 80);
	const lines = String(payload && payload.content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	const uniqueLines = [...new Set(lines)];
	const content = uniqueLines.join('\n');
	if (!name) throw new Error('请输入分享名称');
	if (!content) throw new Error('请至少填写一个节点或订阅链接');
	const nodePattern = /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard|socks|socks5):\/\//i;
	const isSubscriptionURL = line => {
		if (!/^https?:\/\//i.test(line)) return false;
		try {
			const parsed = new URL(line);
			return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
		} catch {
			return false;
		}
	};
	const invalidIndex = uniqueLines.findIndex(line => !nodePattern.test(line) && !isSubscriptionURL(line));
	if (invalidIndex >= 0) throw new Error(`第 ${invalidIndex + 1} 行不是支持的节点或订阅链接`);
	if (new TextEncoder().encode(content).length > 1024 * 1024) throw new Error('分享内容不能超过 1 MB');
	const sourceCount = uniqueLines.filter(isSubscriptionURL).length;
	return { name, content, nodeCount: uniqueLines.length - sourceCount, sourceCount };
}
