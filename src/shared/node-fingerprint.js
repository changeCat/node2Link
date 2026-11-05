// Connection keys are only used in memory; never log them (they contain credentials).
// Unknown protocols and malformed links fall back to exact text comparison.
const uriProtocols = new Set(['vless', 'vmess', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'wireguard', 'socks', 'socks5']);
const invalid = () => { throw new Error('Invalid node'); };
function decode64(value) {
 return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)));
}
function stable(value) {
 if (Array.isArray(value)) return value.map(stable);
 if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
 return value;
}
function host(value) {
 if (typeof value !== 'string' || !value || /[\s/@?#%]/.test(value)) invalid();
 if (value.includes(':')) return new URL(`http://[${value.replace(/^\[|\]$/g, '')}]/`).hostname;
 if (!/^[a-z0-9_.-]+$/i.test(value)) invalid();
 return value.toLowerCase();
}
function port(value) {
 if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) invalid();
 return Number(value);
}
function uuid(value) {
 if (typeof value !== 'string' || !value) invalid();
 return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value) ? value.toLowerCase() : value;
}
function query(value) {
 const params = new URLSearchParams();
 // Decode strictly: malformed escapes must not silently collapse to replacement characters.
 for (const part of value.split('&').filter(Boolean)) {
  const split = part.indexOf('=');
  params.append(decodeURIComponent(split < 0 ? part : part.slice(0, split)), decodeURIComponent(split < 0 ? '' : part.slice(split + 1)));
 }
 return params;
}
function sortedParams(params) {
 // Stable sort retains the order of repeated values; first/last-wins clients differ.
 params.sort();
 return [...params];
}
function authority(value, defaultPort) {
 const match = value.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
 if (!match) invalid();
 return [host(match[1]), port(match[2] ?? defaultPort)];
}
function uriKey(protocol, body) {
 const split = body.indexOf('?');
 const location = split < 0 ? body : body.slice(0, split);
 const params = query(split < 0 ? '' : body.slice(split + 1));
 const slash = location.indexOf('/');
 const endpoint = slash < 0 ? location : location.slice(0, slash);
 const path = slash < 0 ? '' : location.slice(slash);
 const at = endpoint.lastIndexOf('@');
 let auth = at < 0 ? '' : decodeURIComponent(endpoint.slice(0, at));
 if (['vless', 'vmess', 'trojan', 'tuic', 'wireguard'].includes(protocol) && !auth) invalid();
 if (protocol === 'vless' || protocol === 'vmess') auth = uuid(auth);
 const address = authority(endpoint.slice(at + 1), protocol === 'hysteria2' ? 443 : undefined);
 // Defaults documented by XTLS/Xray-core discussion #716. Preserve empty/unknown values.
 if (protocol === 'vless' || protocol === 'vmess') {
  if (!params.has('encryption')) params.set('encryption', protocol === 'vless' ? 'none' : 'auto');
  if (!params.has('security')) params.set('security', 'none');
  if (params.getAll('type').length === 1 && ['ws', 'httpupgrade', 'xhttp'].includes(params.get('type')) && !params.has('path')) params.set('path', '/');
 }
 return [protocol, address, auth, protocol === 'hysteria2' && path === '/' ? '' : path, sortedParams(params)];
}
function vmessKey(body) {
 const data = JSON.parse(decode64(body));
 if (!data || typeof data !== 'object' || Array.isArray(data)) invalid();
 data.add = host(data.add);
 data.port = port(data.port);
 data.id = uuid(data.id);
 delete data.ps;
 if (data.v !== undefined) data.v = String(data.v);
 if (data.aid !== undefined) {
  if (!/^\d+$/.test(String(data.aid)) || !Number.isSafeInteger(Number(data.aid))) invalid();
  data.aid = Number(data.aid);
 }
 // v2rayN's documented default for omitted scy is auto.
 if (data.scy === undefined) data.scy = 'auto';
 return ['vmess-json', data];
}
function ssKey(body) {
 const split = body.indexOf('?');
 let location = split < 0 ? body : body.slice(0, split);
 const params = query(split < 0 ? '' : body.slice(split + 1));
 location = location.replace(/\/$/, '');
 const legacy = !location.includes('@');
 if (legacy) location = decode64(location);
 const at = location.lastIndexOf('@');
 if (at < 0) invalid();
 let auth = location.slice(0, at);
 if (!legacy) auth = auth.includes(':') ? decodeURIComponent(auth) : decode64(auth);
 if (auth.indexOf(':') <= 0) invalid();
 return ['ss', authority(location.slice(at + 1)), auth, sortedParams(params)];
}
function ssrKey(body) {
 const decoded = decode64(body);
 const split = decoded.indexOf('/?');
 const core = split < 0 ? decoded : decoded.slice(0, split);
 const match = core.match(/^(.*):(\d+):([^:]+):([^:]+):([^:]+):([^:]*)$/);
 if (!match) invalid();
 const params = query(split < 0 ? '' : decoded.slice(split + 2));
 params.delete('remarks');
 return ['ssr', host(match[1]), port(match[2]), match[3], match[4], match[5], decode64(match[6]), sortedParams(params)];
}

export function nodeFingerprint(content) {
 const text = String(content).trim();
 try {
  const match = text.match(/^([a-z][a-z0-9+.-]*):\/\/([^#]*)(?:#.*)?$/i);
  if (!match || /[\r\n\0]/.test(text)) invalid();
  let protocol = match[1].toLowerCase();
  if (protocol === 'hy2') protocol = 'hysteria2';
  const body = match[2];
  let key;
  if (protocol === 'vmess' && !body.includes('@')) key = vmessKey(body);
  else if (protocol === 'ss') key = ssKey(body);
  else if (protocol === 'ssr') key = ssrKey(body);
  else if (uriProtocols.has(protocol)) key = uriKey(protocol, body);
  else invalid(); // Includes HTTP(S) subscriptions: retain their entire URL, including tokens.
  return 'connection:' + JSON.stringify(stable(key));
 } catch { return 'text:' + text; }
}
