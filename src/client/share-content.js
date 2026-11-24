import { isShareSource, shareLines, shareOrigins } from '../shared/share-content.js';

const textarea = document.getElementById('shareContent');
const summary = document.getElementById('shareContentCounts');
let origins = new Map();

function syncCounts() {
 const counts = { p: 0, m: 0, u: 0, sources: 0 };
 origins = new Map(shareLines(textarea.value).map(line => {
  const origin = origins.get(line) || 'm';
  counts[isShareSource(line) ? 'sources' : origin]++;
  return [line, origin];
 }));
 summary.textContent = '勾选 ' + counts.p + ' 个节点 · 手动输入 ' + counts.m + ' 个节点 · ' + counts.sources + ' 个订阅源'
  + (counts.u ? ' · ' + counts.u + ' 个节点未记录录入方式' : '');
}
textarea.addEventListener('input', syncCounts);

export function loadShareContent(item = {}) {
 textarea.value = item.content || '';
 origins = shareOrigins(textarea.value, item.lineOrigins);
 syncCounts();
}

export function shareContentPayload() {
 return { content: textarea.value, lineOrigins: [...origins.values()].join('') };
}

export function currentShareLines() {
 return [...origins.keys()];
}

export function applyPickerChanges(changes) {
 for (const [line, checked] of changes) {
  if (!checked) origins.delete(line);
  else if (!origins.has(line)) origins.set(line, 'p');
 }
 textarea.value = currentShareLines().join('\n');
 syncCounts();
}
