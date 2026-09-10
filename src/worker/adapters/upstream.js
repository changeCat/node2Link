import { ADD, base64Decode, isValidBase64, isStructuredSubscription } from '../domain/nodes.js';
import { mapConcurrent } from '../storage/kv.js';
import { fetchWithTimeout, logRemote, REMOTE_FETCH_TIMEOUT_MS } from './http.js';

export async function getSUB(sources, request, appendUA, userAgentHeader, options = {}) {
 const urls = [...new Set(sources || [])].filter(Boolean);
 const deadline = Date.now() + (options.timeoutMs || REMOTE_FETCH_TIMEOUT_MS);
 let totalBytes = 0;
 const results = await mapConcurrent(urls, options.concurrency || 6, async url => {
  const startedAt = Date.now();
  try {
   if (startedAt >= deadline || totalBytes >= 32 * 1024 * 1024) throw new DOMException('Source budget exhausted', 'TimeoutError');
   const response = await getUrl(request, url, appendUA, userAgentHeader, request.signal, { ...options, timeoutMs: deadline - startedAt });
   if (!response.ok) { logRemote('upstream.response', url, { status: response.status }); return { failed: true }; }
   const content = await response.text();
   totalBytes += new TextEncoder().encode(content).length;
   if (totalBytes > 32 * 1024 * 1024) throw new RangeError('Aggregate source size exceeded');
   logRemote('upstream.complete', url, { durationMs: Date.now() - startedAt });
   if (isStructuredSubscription(content)) return { structured: url };
   if (content.includes('://')) return { content };
   if (isValidBase64(content)) return { content: base64Decode(content) };
   // Preserve the existing diagnostic node without logging source credentials.
   return { failed: true, content: 'trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#' + encodeURIComponent('异常订阅 ' + new URL(url).hostname) };
  } catch (error) {
   logRemote('upstream.failed', url, { type: error.name, durationMs: Date.now() - startedAt });
   return { failed: true };
  }
 });
 const result = [await ADD(results.map(item => item.content || '').join('\n')), results.map(item => item.structured).filter(Boolean).join('|')];
 result.failures = results.filter(item => item.failed).length;
 return result;
}

export async function getUrl(request, targetUrl, appendUA, userAgentHeader, signal, options = {}) {
 const headers = new Headers();
 headers.set('User-Agent', 'v2rayN/6.45 cmliu/CF-Workers-SUB ' + appendUA + '(' + userAgentHeader + ')');
 headers.set('Accept', request.headers.get('Accept') || '*/*');
 const outgoing = new Request(targetUrl, { method: 'GET', headers, signal, redirect: 'follow' });
 return fetchWithTimeout(outgoing, {}, options.timeoutMs || REMOTE_FETCH_TIMEOUT_MS, options);
}
