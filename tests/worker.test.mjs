import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../_worker.js';

class MemoryKV {
	constructor() {
		this.values = new Map();
		this.metadata = new Map();
	}

	async get(key) {
		return this.values.has(key) ? this.values.get(key) : null;
	}

	async put(key, value, options = {}) {
		this.values.set(key, String(value));
		if (options.metadata) this.metadata.set(key, options.metadata);
	}

	async delete(key) {
		this.values.delete(key);
		this.metadata.delete(key);
	}

	async list({ prefix = '', limit = 1000 } = {}) {
		const keys = [...this.values.keys()]
			.filter(key => key.startsWith(prefix))
			.sort()
			.slice(0, limit)
			.map(name => ({ name, metadata: this.metadata.get(name) }));
		return { keys, list_complete: true };
	}
}

const kv = new MemoryKV();
await kv.put('LINK.txt', 'vless://main-node');
const env = {
	KV: kv,
	ADMIN_USERNAME: 'admin',
	ADMIN_PASSWORD: 'correct horse battery staple',
	SESSION_SECRET: '独立随机密钥-session-test',
	TOKEN: 'auto',
	REQUESTLOG: '0'
};
const ctx = { waitUntil() {} };

const call = (path, init = {}) => worker.fetch(new Request('https://example.com' + path, init), env, ctx);
const compileInlineScripts = html => {
	for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		if (match[1].trim()) new vm.Script(match[1]);
	}
};

let response = await call('/');
assert.equal(response.status, 303);
assert.equal(response.headers.get('location'), 'https://example.com/login');

response = await call('/login');
assert.equal(response.status, 200);
const loginHTML = await response.text();
assert.match(loginHTML, /id="username"/);
assert.doesNotMatch(loginHTML, /id="username"[^>]*value=/);
assert.doesNotMatch(loginHTML, /独立随机密钥|Service is running|Edge Gateway/);
assert.match(loginHTML, /rel="icon"/);

response = await call('/auto?base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/main-node/);

response = await call('/?token=auto&base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/main-node/);

response = await call('/api/login', {
	method: 'POST',
	headers: { Origin: 'https://example.com', 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ username: 'admin', password: env.ADMIN_PASSWORD })
});
assert.equal(response.status, 303);
const cookie = response.headers.get('set-cookie').split(';', 1)[0];
assert.match(cookie, /^node2link_session=/);

const authHeaders = { Cookie: cookie, Origin: 'https://example.com' };
response = await call('/', { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } });
assert.equal(response.status, 200);
const homeHTML = await response.text();
assert.match(homeHTML, /订阅控制台/);
assert.match(homeHTML, /href="\/shares"/);
assert.match(homeHTML, /https:\/\/example\.com\/auto/);
assert.match(homeHTML, /转换信息/);
assert.match(homeHTML, /当前转换后端/);
assert.match(homeHTML, /规则配置/);
assert.doesNotMatch(homeHTML, /<h2 id="share-title">节点分享<\/h2>/);
assert.doesNotMatch(homeHTML.slice(homeHTML.indexOf('<body>')), /<div class="brand">/);
assert.doesNotMatch(homeHTML, /当前入口|访客 Token/);
assert.doesNotMatch(homeHTML, /Service is running|Edge Gateway/);
const homeBody = homeHTML.slice(homeHTML.indexOf('<body>'));
assert.ok(homeBody.indexOf('header-overview') < homeBody.indexOf('header-actions'));
compileInlineScripts(homeHTML);

const settingsBeforeUpdate = JSON.parse(await kv.get('NODE2LINK.settings.json'));
response = await call('/s/' + settingsBeforeUpdate.mainSubscriptionId + '?base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/main-node/);

response = await call('/api/settings', {
	method: 'POST',
	headers: { ...authHeaders, 'Content-Type': 'application/json' },
	body: JSON.stringify({
		subscriptionName: '我的订阅',
		browserIconURL: 'https://example.com/custom-icon.png',
		subscriptionToken: 'entry2',
		converterMode: 'default',
		customConverterURL: '',
		subConfig: 'https://example.com/rules.ini'
	})
});
assert.equal(response.status, 200);
const updatedSettings = (await response.json()).settings;
assert.equal(updatedSettings.subscriptionName, '我的订阅');
assert.equal(updatedSettings.subscriptionToken, 'entry2');
assert.equal(updatedSettings.browserIconURL, 'https://example.com/custom-icon.png');
assert.equal(updatedSettings.subConfig, 'https://example.com/rules.ini');
assert.equal(Object.hasOwn(updatedSettings, 'legacySubscriptionToken'), false);

response = await call('/entry2?base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.equal(Buffer.from(response.headers.get('Profile-Title').slice(7), 'base64').toString(), '我的订阅');
assert.match(response.headers.get('Content-Disposition'), /%E6%88%91%E7%9A%84%E8%AE%A2%E9%98%85/);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/main-node/);

response = await call('/?token=entry2&base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/main-node/);

response = await call('/', { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } });
assert.equal(response.status, 200);
const updatedHomeHTML = await response.text();
assert.match(updatedHomeHTML, /https:\/\/example\.com\/rules\.ini/);
assert.match(updatedHomeHTML, /rel="icon" href="https:\/\/example\.com\/custom-icon\.png"/);
assert.match(updatedHomeHTML, /https:\/\/example\.com\/entry2/);

response = await call('/settings', { headers: { Cookie: cookie } });
assert.equal(response.status, 200);
const settingsHTML = await response.text();
assert.match(settingsHTML, /订阅入口 Token/);
assert.doesNotMatch(settingsHTML, /旧版订阅入口/);
assert.match(settingsHTML, /id="browserIconURL"/);
assert.match(settingsHTML, /id="subConfig"/);
assert.match(settingsHTML, /https:\/\/example\.com\/rules\.ini/);
assert.match(settingsHTML, /rel="icon" href="https:\/\/example\.com\/custom-icon\.png"/);
assert.match(settingsHTML, /header-overview/);
assert.doesNotMatch(settingsHTML.slice(settingsHTML.indexOf('<body>')), /<div class="brand">/);
assert.match(settingsHTML, /max-width:1440px/);
assert.match(settingsHTML, /1\. 基本显示/);
assert.match(settingsHTML, /2\. 订阅入口/);
assert.match(settingsHTML, /3\. 转换配置/);
compileInlineScripts(settingsHTML);

response = await call('/shares', { headers: { Cookie: cookie } });
assert.equal(response.status, 200);
const sharesHTML = await response.text();
assert.match(sharesHTML, /header-overview/);
assert.doesNotMatch(sharesHTML.slice(sharesHTML.indexOf('<body>')), /<div class="brand">/);
assert.match(sharesHTML, /minmax\(420px,.78fr\)/);
assert.match(sharesHTML, /#shareContent\{min-height:320px\}/);
assert.match(sharesHTML, /rel="icon" href="https:\/\/example\.com\/custom-icon\.png"/);
compileInlineScripts(sharesHTML);

response = await call('/api/shares', {
	method: 'POST',
	headers: { ...authHeaders, 'Content-Type': 'application/json' },
	body: JSON.stringify({ name: 'A 与 B', content: 'vless://node-a\n\nvless://node-b\nvless://node-a' })
});
assert.equal(response.status, 201);
const created = (await response.json()).share;
assert.equal(created.nodeCount, 2);
assert.match(created.id, /^[A-Za-z0-9_-]{24}$/);

response = await call('/s/' + created.id + '?base64', { headers: { 'User-Agent': 'test-client' } });
assert.equal(response.status, 200);
assert.match(Buffer.from(await response.text(), 'base64').toString(), /vless:\/\/node-a/);

response = await call('/api/shares', {
	method: 'PUT',
	headers: { ...authHeaders, 'Content-Type': 'application/json' },
	body: JSON.stringify({ id: created.id, name: 'C 与 D', content: 'trojan://node-c\ntrojan://node-d' })
});
assert.equal(response.status, 200);
assert.equal((await response.json()).share.id, created.id);

response = await call('/api/shares', {
	method: 'DELETE',
	headers: { ...authHeaders, 'Content-Type': 'application/json' },
	body: JSON.stringify({ id: created.id })
});
assert.equal(response.status, 200);
response = await call('/s/' + created.id);
assert.equal(response.status, 404);

response = await call('/auto', { headers: { Cookie: cookie } });
assert.equal(response.status, 404);

console.log('worker integration tests passed');
