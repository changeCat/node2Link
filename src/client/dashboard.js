for (const element of document.querySelectorAll('[data-dashboard-time]')) {
	const date = new Date(element.dateTime);
	if (Number.isFinite(date.getTime())) element.textContent = date.toLocaleString();
}
const storageKey = 'node2link:dashboard-panels:' + location.host;
let preferences = {};
try {
	const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
	if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved;
} catch { /* Panels remain usable when local storage is unavailable. */ }
for (const panel of document.querySelectorAll('[data-dashboard-panel]')) {
	const name = panel.dataset.dashboardPanel;
	if (typeof preferences[name] === 'boolean') panel.open = preferences[name];
	panel.addEventListener('toggle', () => {
		preferences[name] = panel.open;
		try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {}
	});
}
