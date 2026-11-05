import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeFingerprint as key } from '../src/shared/node-fingerprint.js';
import { importMainOriginals, reconcileMainEndpoints } from '../src/shared/main-subscription.js';

const base = 'vless://aabbccdd-1234-5678-abcd-123456789abc@node.example.com:443?type=ws&security=tls&path=%2Fws&sni=tls.example.com#First';
const renamed = 'vless://AABBCCDD-1234-5678-ABCD-123456789ABC@NODE.EXAMPLE.COM:0443?sni=tls.example.com&path=/ws&security=tls&type=ws#Second';
const b64 = value => Buffer.from(value).toString('base64url');

test('connection keys ignore display names, parameter order, equivalent escapes, UUID case and IPv6 spelling', () => {
 assert.equal(key(base), key(renamed));
 assert.equal(key('trojan://p%40ss@[2001:0DB8:0:0:0:0:0:1]:443#A'), key('trojan://p%40ss@[2001:db8::1]:443#B'));
 assert.equal(key('hy2://secret@NODE.example.com/#A'), key('hysteria2://secret@node.example.com:443#B'));
 assert.equal(key('vless://id@node.example.com:443?type=ws'), key('vless://id@node.example.com:443?security=none&path=%2F&encryption=none&type=ws'));
});

test('credentials, protocol, transport, security and unknown parameter differences remain distinct', () => {
 for (const modified of [
  base.replace('aabbccdd', 'bbbbbbbb'), base.replace(':443?', ':8443?'), base.replace('node.example', 'other.example'),
  base.replace('vless://', 'trojan://'), base.replace('type=ws', 'type=grpc'), base.replace('tls.example', 'other.example'),
  base.replace('path=%2Fws', 'path=%2FWS'), base.replace('security=tls', 'security=reality'),
  base.replace('#First', '&host=other.example#First'), base.replace('#First', '&pbk=public-key#First'),
  base.replace('#First', '&unknown=value#First'), base.replace('#First', '&encryption=#First')
 ]) assert.notEqual(key(base), key(modified));
 assert.notEqual(key('trojan://Password@node.example.com:443'), key('trojan://password@node.example.com:443'));
 assert.notEqual(key(base), key(base.replace('path=%2Fws', 'path=%252Fws')));
 assert.notEqual(key(base.replace('#First', '&x=1&x=2')), key(base.replace('#First', '&x=2&x=1')));
 assert.equal(key(base.replace('#First', '&x=1&x=2&y=3')), key(base.replace('#First', '&y=3&x=1&x=2')));
});

test('VMess JSON canonicalizes encoding and key order while preserving arbitrary connection fields', () => {
 const data = { v: '2', ps: '原名', add: 'NODE.example.com', port: '443', id: 'id', aid: '0', net: 'ws', path: '/ws', tls: 'tls', extra: { b: 2, a: 1 } };
 const uri = 'vmess://' + Buffer.from(JSON.stringify(data)).toString('base64');
 const equivalent = { ...data, v: 2, ps: '新名称', add: 'node.example.com', port: 443, aid: 0, scy: 'auto', extra: { a: 1, b: 2 } };
 assert.equal(key(uri), key('vmess://' + b64(JSON.stringify(Object.fromEntries(Object.entries(equivalent).reverse())))));
 for (const changes of [{ id: 'different' }, { path: '/other' }, { tls: '' }, { extra: { a: 1, b: 3 } }, { sni: 'other.example.com' }]) {
  assert.notEqual(key(uri), key('vmess://' + b64(JSON.stringify({ ...data, ...changes }))));
 }
});

test('SS plain, SIP002 and legacy Base64 forms compare by method/password and plugin options', () => {
 const params = '?plugin=v2ray-plugin%3Btls%3Bhost%3Dexample.com';
 const plain = 'ss://aes-128-gcm:p%3Aa%40ss@node.example.com:443/' + params + '#A';
 const modern = 'ss://' + b64('aes-128-gcm:p:a@ss') + '@NODE.example.com:443' + params + '#B';
 const legacy = 'ss://' + b64('aes-128-gcm:p:a@ss@node.example.com:443') + params + '#C';
 assert.equal(key(plain), key(modern));
 assert.equal(key(plain), key(legacy));
 assert.notEqual(key(plain), key(plain.replace('p%3Aa%40ss', 'different')));
 assert.notEqual(key(plain), key(plain.replace('aes-128-gcm', 'aes-256-gcm')));
 assert.notEqual(key(plain), key(plain.replace('host%3Dexample', 'host%3Dother')));
});

test('SSR names are ignored but password and obfuscation options are retained', () => {
 const core = 'node.example.com:443:auth_sha1_v4:aes-256-cfb:tls1.2_ticket_auth:' + b64('secret');
 const uri = 'ssr://' + b64(core + '/?remarks=' + b64('First') + '&obfsparam=abc');
 assert.equal(key(uri), key('ssr://' + b64(core + '/?obfsparam=abc&remarks=' + b64('Second'))));
 assert.notEqual(key(uri), key('ssr://' + b64(core + '/?obfsparam=def')));
 assert.notEqual(key(uri), key('ssr://' + b64(core.replace(b64('secret'), b64('other')) + '/?obfsparam=abc')));
});

test('subscription URLs, unsupported protocols and invalid links use exact text including fragments', () => {
 for (const text of ['https://example.com/sub?token=secret#A', 'custom://id@node.example.com:443#A', 'vmess://bad#A', 'vmess://' + b64('{}') + '#A', 'ss://bad#A', 'vless://id@node.example.com:99999#A', 'vless://id@node.example.com:443?x=%FF#A']) {
  assert.equal(key('  ' + text + '  '), 'text:' + text);
  assert.notEqual(key(text), key(text.replace('#A', '#B')));
 }
 assert.notEqual(key('https://example.com/?a=1&b=2'), key('https://example.com/?b=2&a=1'));
});

test('append skips existing and batch duplicates, preserves first record and counts additions', () => {
 const previous = { id: 'old', content: base, enabled: false };
 const extra = 'trojan://secret@new.example.com:443#New';
 const result = importMainOriginals([previous], [renamed, extra, extra.replace('#New', '#Again')]);
 assert.equal(result.added, 1);
 assert.equal(result.duplicates, 2);
 assert.equal(result.originals.length, 2);
 assert.equal(result.originals[0], previous);
 assert.equal(result.originals[1].content, extra);
 assert.notEqual(result.originals[1].id, previous.id);
 const unchanged = importMainOriginals(result.originals, [renamed, extra]);
 assert.equal(unchanged.added, 0);
 assert.equal(unchanged.duplicates, 2);
 assert.deepEqual(unchanged.originals, result.originals);
});

test('replace/import preserves first existing identity and transfers duplicate endpoint associations', () => {
 const previous = [{ id: 'old', content: base, enabled: false }, { id: 'duplicate', content: renamed, enabled: true }, { id: 'removed', content: 'trojan://pw@old.example.com:443' }];
 const result = importMainOriginals(previous, [renamed, base], { replace: true });
 assert.deepEqual(result, { originals: [previous[0]], added: 0, duplicates: 1 });
 const endpoints = [{ id: 'e1', enabled: true, originalIds: ['duplicate', 'old', 'removed'] }, { id: 'e2', enabled: true, originalIds: ['removed'] }];
 assert.deepEqual(reconcileMainEndpoints(endpoints, result.originals, previous), [
  { id: 'e1', enabled: true, originalIds: ['old'] }, { id: 'e2', enabled: false, originalIds: [] }
 ]);
});
