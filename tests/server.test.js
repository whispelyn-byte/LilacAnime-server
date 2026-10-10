import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, redisStore } from '../lib/store.js';
import { tokenFor } from '../lib/auth.js';
import { statusHandler } from '../api/status.js';
import { loginHandler, LOCK_AFTER } from '../api/login.js';
import { syncHandler } from '../api/sync.js';

const PASSWORD = 'correct horse';
async function call(handler, { method = 'GET', url = '/', body, headers = {}, ip = '1.2.3.4' } = {}) {
  const req = { method, url, body, headers: { 'x-forwarded-for': ip, ...headers } }, res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  await new Promise(resolve => { res.end = text => { res.text = text; resolve(); }; handler(req, res); });
  return { status: res.statusCode, body: res.text ? JSON.parse(res.text) : null, headers: res.headers };
}
function server(store = memoryStore(), password = PASSWORD) {
  const context = { store, password };
  return { status: statusHandler(context), login: loginHandler(context), sync: syncHandler(context), store };
}
const auth = { authorization: `Bearer ${tokenFor(PASSWORD)}` };
const anime = (id, updated, extra = {}) => ({ collection: 'library', id, updated, data: { mal_id: id, title: `작품 ${id}`, ...extra } });

test('status says what is missing before the owner finishes the setup', async () => {
  const missing = await call(statusHandler({ store: null, password: null }));
  assert.equal(missing.body.ready, false); assert.equal(missing.body.problems.length, 2);
  assert.equal(missing.headers['access-control-allow-origin'], '*');
  assert.deepEqual((await call(server().status)).body, { app: 'lilacanime-server', version: 1, ready: true, problems: [] });
  assert.equal((await call(syncHandler({ store: null, password: PASSWORD }), { headers: auth })).status, 503);
});

test('signing in gives the token; a wrong password is refused and too many lock the address out', async () => {
  const s = server();
  const ok = await call(s.login, { method: 'POST', body: { password: PASSWORD } });
  assert.equal(ok.status, 200); assert.equal(ok.body.token, tokenFor(PASSWORD));
  for (let i = 0; i < LOCK_AFTER; i++) assert.equal((await call(s.login, { method: 'POST', body: { password: 'nope' }, ip: '9.9.9.9' })).status, 401);
  assert.equal((await call(s.login, { method: 'POST', body: { password: PASSWORD }, ip: '9.9.9.9' })).status, 200, 'the right password still works and clears the count');
  for (let i = 0; i <= LOCK_AFTER; i++) await call(s.login, { method: 'POST', body: { password: 'nope' }, ip: '8.8.8.8' });
  assert.equal((await call(s.login, { method: 'POST', body: { password: 'nope' }, ip: '8.8.8.8' })).status, 429);
  assert.equal((await call(s.login, { method: 'POST', body: { password: 'nope' }, ip: '7.7.7.7' })).status, 401, 'other addresses are not locked');
  assert.equal((await call(s.sync, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(s.sync)).status, 401);
});

test('two devices: the later change of an item wins, removals reach the other device, pages follow revisions', async () => {
  const s = server();
  const pushed = await call(s.sync, { method: 'POST', headers: auth, body: { items: [anime('a', 100), anime('b', 100), { collection: 'history', id: 'h1', updated: 100, data: { progress: 10 } }] } });
  assert.deepEqual(pushed.body, { rev: 3, accepted: 3, current: [] });
  // The other device: everything, then nothing new.
  const all = await call(s.sync, { headers: auth, url: '/api/sync?since=0' });
  assert.equal(all.body.items.length, 3); assert.equal(all.body.rev, 3); assert.equal(all.body.more, false);
  assert.deepEqual((await call(s.sync, { headers: auth, url: '/api/sync?since=3' })).body, { items: [], more: false, rev: 3 });
  // An older change loses; a newer one and a removal win.
  const behind = (await call(s.sync, { method: 'POST', headers: auth, body: { items: [anime('a', 50, { title: 'old' })] } })).body;
  assert.deepEqual([behind.rev, behind.accepted, behind.current.map(item => [item.id, item.updated, item.data.title])], [3, 0, [['a', 100, '작품 a']]], 'a device behind gets the copy on the server back');
  // The same item twice in one batch: its later change (the removal) only.
  const second = await call(s.sync, { method: 'POST', headers: auth, body: { items: [anime('a', 140, { title: 'mid' }), anime('b', 200, { title: 'new' }), { collection: 'library', id: 'a', updated: 150, deleted: true }] } });
  assert.deepEqual(second.body, { rev: 5, accepted: 2, current: [] });
  assert.deepEqual((await call(s.sync, { method: 'POST', headers: auth, body: { items: [{ collection: 'library', id: 'a', updated: 150, deleted: true }] } })).body, { rev: 5, accepted: 0, current: [] }, 'sent again: nothing new, and its own copy is not sent back');
  const changed = await call(s.sync, { headers: auth, url: '/api/sync?since=3' });
  assert.deepEqual(changed.body.items.map(item => [item.id, item.deleted || false, item.data?.title, item.rev]), [['a', true, undefined, 4], ['b', false, 'new', 5]]);
});

test('a long history comes a page at a time', async () => {
  const s = server(), items = Array.from({ length: 1200 }, (_, i) => ({ collection: 'history', id: `h${i}`, updated: 1000 + i, data: { i } }));
  for (let i = 0; i < items.length; i += 500) await call(s.sync, { method: 'POST', headers: auth, body: { items: items.slice(i, i + 500) } });
  let since = 0, seen = 0, pages = 0, more = true;
  while (more) { const page = (await call(s.sync, { headers: auth, url: `/api/sync?since=${since}` })).body; seen += page.items.length; since = page.rev; more = page.more; pages++; }
  assert.equal(seen, 1200); assert.equal(pages, 3); assert.equal(since, 1200);
});

test('bad requests are refused with the reason', async () => {
  const s = server();
  const bad = async items => (await call(s.sync, { method: 'POST', headers: auth, body: { items } }));
  assert.equal((await bad([{ collection: 'settings', id: 'x', updated: 1, data: {} }])).status, 400);
  assert.equal((await bad([{ collection: 'library', id: '', updated: 1, data: {} }])).status, 400);
  assert.equal((await bad([{ collection: 'library', id: 'x', updated: 'now', data: {} }])).status, 400);
  assert.equal((await bad([{ collection: 'library', id: 'x', updated: 1 }])).status, 400);
  assert.equal((await bad(Array.from({ length: 501 }, (_, i) => anime(`x${i}`, 1)))).status, 413);
  assert.match((await bad([{ collection: 'library', id: 'x', updated: 1 }])).body.error, /items\[0\]/);
  assert.equal((await call(s.sync, { headers: auth, url: '/api/sync?since=-1' })).status, 400);
  const huge = await bad([anime('big', 1, { blob: 'x'.repeat(70 * 1024) })]);
  assert.deepEqual(huge.body, { rev: 0, accepted: 0, current: [] }, 'an item over 64 KB is left out');
});

// A stand-in for Upstash's REST pipeline: the Redis commands the store sends, run on maps.
function fakeUpstash() {
  const strings = new Map(), hashes = new Map(), zsets = new Map(), calls = [];
  const hash = key => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const zset = key => { if (!zsets.has(key)) zsets.set(key, new Map()); return zsets.get(key); };
  const run = ([name, key, ...args]) => {
    switch (name) {
      case 'HMGET': return args.map(field => hash(key).get(field) ?? null);
      case 'HSET': for (let i = 0; i < args.length; i += 2) hash(key).set(args[i], String(args[i + 1])); return args.length / 2;
      case 'INCRBY': { const value = Number(strings.get(key) || 0) + Number(args[0]); strings.set(key, String(value)); return value; }
      case 'INCR': return run(['INCRBY', key, 1]);
      case 'GET': return strings.get(key) ?? null;
      case 'EXPIRE': return 1;
      case 'DEL': strings.delete(key); return 1;
      case 'ZADD': for (let i = 0; i < args.length; i += 2) zset(key).set(args[i + 1], Number(args[i])); return args.length / 2;
      case 'ZRANGEBYSCORE': {
        const [min, max, withScores, limitWord, offset, count] = args;
        assert.equal(withScores, 'WITHSCORES'); assert.equal(limitWord, 'LIMIT'); assert.equal(max, '+inf'); assert.match(min, /^\(\d+$/);
        const rows = [...zset(key)].filter(([, score]) => score > Number(min.slice(1))).sort((a, b) => a[1] - b[1]).slice(Number(offset), Number(offset) + Number(count));
        return rows.flatMap(([member, score]) => [member, String(score)]);
      }
      default: throw new Error(`unexpected command ${name}`);
    }
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    const commands = JSON.parse(options.body);
    return { ok: true, json: async () => commands.map(command => ({ result: run(command) })) };
  };
  return { fetchImpl, calls };
}

test('the Upstash store speaks Redis through the REST pipeline, with either pair of Vercel variables', async () => {
  assert.equal(redisStore({}), null);
  const upstash = fakeUpstash();
  const store = redisStore({ KV_REST_API_URL: 'https://example.upstash.io/', KV_REST_API_TOKEN: 'tok' }, upstash.fetchImpl);
  const s = server(store);
  await call(s.sync, { method: 'POST', headers: auth, body: { items: [anime('a', 100), anime('b', 100)] } });
  await call(s.sync, { method: 'POST', headers: auth, body: { items: [anime('a', 300, { title: 'new' }), anime('b', 50)] } });
  const all = (await call(s.sync, { headers: auth, url: '/api/sync?since=0' })).body;
  assert.deepEqual(all.items.map(item => [item.id, item.data.title, item.rev]), [['b', '작품 b', 2], ['a', 'new', 3]]);
  assert.equal(all.rev, 3);
  assert.ok(upstash.calls.every(call => call.url === 'https://example.upstash.io/pipeline' && call.auth === 'Bearer tok'));
  for (let i = 0; i <= LOCK_AFTER; i++) await call(s.login, { method: 'POST', body: { password: 'nope' } });
  assert.equal((await call(s.login, { method: 'POST', body: { password: 'nope' } })).status, 429);
  assert.ok(redisStore({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }));
});
