// Compare only counts and protocol names; never expose node names or credentials.
const aliases = { shadowsocks: 'ss', shadowsocksr: 'ssr', hy2: 'hysteria2', socks: 'socks5' };
const protocols = new Set(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'wireguard', 'socks5', 'anytls', 'snell', 'http', 'https']);
const canonical = value => aliases[value.toLowerCase()] || value.toLowerCase();

export function summarizeNodeProtocols(content) {
 const counts = {};
 for (const line of new Set(String(content || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))) {
  const scheme = line.match(/^([a-z0-9+.-]+):\/\//i)?.[1];
  if (!scheme || /^(?:http|https)$/i.test(scheme)) continue;
  const type = canonical(scheme);
  if (protocols.has(type)) counts[type] = (counts[type] || 0) + 1;
 }
 return counts;
}

export function inspectLoonConversion(sourceContent, convertedContent, { completeSource = true } = {}) {
 const input = summarizeNodeProtocols(sourceContent);
 const output = {};
 let section = '', hasRemoteNodes = false;
 for (const raw of String(convertedContent || '').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || /^[#;]/.test(line)) continue;
  const heading = line.match(/^\[([^\]]+)\](?:\s*[#;].*)?$/);
  if (heading) { section = heading[1].trim().toLowerCase(); continue; }
  if (section === 'remote proxy') { hasRemoteNodes = true; continue; }
  if (section && section !== 'proxy') continue;
  const match = line.match(/^.+?=\s*([a-z0-9-]+)\s*,/i);
  if (!match) continue;
  const type = canonical(match[1]);
  // Unknown future protocols still count as output but are never inferred as input.
  output[type] = (output[type] || 0) + 1;
 }
 const inputCount = Object.values(input).reduce((sum, count) => sum + count, 0);
 const outputCount = Object.values(output).reduce((sum, count) => sum + count, 0);
 const missing = hasRemoteNodes ? [] : Object.entries(input)
  .filter(([type, count]) => (output[type] || 0) < count)
  .map(([protocol, count]) => ({ protocol, count: count - (output[protocol] || 0) }));
 return { inputCount, outputCount, missing, hasRemoteNodes, completeSource,
  check: missing.length ? 'incomplete' : hasRemoteNodes || !completeSource || !inputCount ? 'unverified' : 'counts-match' };
}
