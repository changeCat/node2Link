const byId = id => document.getElementById(id);
const shareList = byId('requestShares');
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });
function localTime(value) {
	const date = value && new Date(value);
	return date && Number.isFinite(date.getTime()) ? dates.format(date) : '时间未知';
}
document.querySelectorAll('time[datetime]').forEach(time => {
	if (time.dateTime) time.textContent = localTime(time.dateTime);
});

function pager(id, previous, next) {
	const nav = byId(id);
	const back = nav.querySelector('[data-prev]'), forward = nav.querySelector('[data-next]');
	back.addEventListener('click', previous);
	forward.addEventListener('click', next);
	return (label, hasPrevious, hasNext, hidden = false) => {
		nav.hidden = hidden;
		back.disabled = !hasPrevious;
		forward.disabled = !hasNext;
		nav.querySelector('span').textContent = label;
	};
}

if (shareList) {
	const rows = [...shareList.rows].map(row => ({
		row, match: [row.cells[0].textContent, row.cells[1].textContent].join('\n').toLowerCase()
	}));
	let page = 0;
	const search = byId('shareSearch');
	const setPage = pager('sharePager', () => { page--; showShares(); }, () => { page++; showShares(); });
	function showShares() {
		const query = search.value.trim().toLowerCase();
		let count = 0;
		for (const { row, match } of rows) {
			const matches = match.includes(query);
			row.hidden = !matches || Math.floor(count / 20) !== page;
			if (matches) count++;
		}
		const pages = Math.ceil(count / 20);
		setPage(`第 ${page + 1} / ${pages} 页`, page > 0, page + 1 < pages, pages < 2);
		byId('shareEmpty').hidden = count > 0;
		byId('shareEmpty').textContent = query ? '没有匹配的分享' : '暂无分享链接';
	}
	search.addEventListener('input', () => { page = 0; showShares(); });
	showShares();
}

const dialog = byId('historyDialog');
const client = byId('historyClient'), failed = byId('historyFailed');
const status = byId('historyStatus'), retry = byId('historyRetry'), body = byId('historyRows');
const table = body.closest('table');
const setPage = pager('historyPager', () => loadPage(page - 1), () => loadPage(page + 1));
const formatNames = { base64: 'Base64', clash: 'Clash', singbox: 'Sing-box', surge: 'Surge', quanx: 'QuanX', loon: 'Loon' };
let scope, page, cursors, start, pending;

function renderEvent(event) {
	const row = document.createElement('tr');
	const region = [...new Set([event.country === 'XX' ? '' : event.country, event.region, event.city].filter(Boolean))].join(' / ');
	const values = [
		['', localTime(event.requestedAt)], ['客户端', event.client || '其他客户端'], ['来源 IP', event.ip || '未记录'],
		['地区', region || '未记录'], ['格式', formatNames[event.format] || event.format || '未知'],
		['HTTP', event.status ?? '未知'], ['耗时', event.durationMs == null ? '未知' : event.durationMs + ' ms']
	];
	for (const [label, value] of values) {
		const cell = row.insertCell();
		cell.dataset.label = label;
		cell.textContent = value;
	}
	if (event.userAgent) {
		const ua = document.createElement('small');
		ua.textContent = event.userAgent;
		row.cells[1].append(ua);
	}
	if (event.status >= 400) row.cells[5].className = 'failed';
	return row;
}

async function loadPage(index) {
	pending?.abort();
	const controller = new AbortController();
	pending = controller;
	page = index;
	body.replaceChildren();
	table.hidden = retry.hidden = true;
	status.hidden = false;
	status.textContent = '正在读取请求…';
	setPage('第 ' + (page + 1) + ' 页', false, false);
	const params = new URLSearchParams({ scope });
	if (start) params.set('start', start);
	if (cursors[index]) params.set('after', cursors[index]);
	if (client.value) params.set('client', client.value);
	if (failed.checked) params.set('failed', '1');
	try {
		const response = await fetch('/api/requests?' + params, { signal: controller.signal, cache: 'no-store' });
		const data = await response.json();
		if (!response.ok) throw new Error(data.message || '读取失败');
		if (controller.signal.aborted || !dialog.open) return;
		start = data.start;
		cursors.length = index + 1;
		if (data.next) cursors.push(data.next);
		body.replaceChildren(...data.events.map(renderEvent));
		body.closest('.history-scroll').scrollTop = 0;
		table.hidden = !data.events.length;
		status.hidden = !table.hidden;
		status.textContent = '没有符合条件的请求';
		setPage('第 ' + (page + 1) + ' 页', page > 0, Boolean(data.next));
	} catch (error) {
		if (controller.signal.aborted || !dialog.open) return;
		status.textContent = error.message;
		retry.hidden = false;
		setPage('第 ' + (page + 1) + ' 页', page > 0, false);
	}
}
function resetPages() {
	start = '';
	cursors = [''];
	loadPage(0);
}
document.querySelectorAll('[data-details]').forEach(button => button.addEventListener('click', () => {
	const row = button.closest('tr');
	scope = row.dataset.scope;
	byId('historyTitle').textContent = row.querySelector('.request-name').textContent + ' · 请求明细';
	const options = JSON.parse(row.dataset.clients).map(item => new Option(`${item.name}（${item.count} 次）`, item.name));
	client.replaceChildren(new Option('全部客户端', ''), ...options);
	failed.checked = false;
	dialog.showModal();
	resetPages();
}));
client.addEventListener('change', resetPages);
failed.addEventListener('change', resetPages);
retry.addEventListener('click', () => loadPage(page));
byId('closeHistory').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { if (!dialog.open) pending?.abort(); });
