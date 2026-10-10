// Where the synced items live: Upstash Redis (added to the Vercel project from the Marketplace), or memory for tests
// and local runs. Every write gets the next revision number, so a device asks for "everything after revision N" and
// never depends on its own clock.
//
// Keys (prefix lilac:v1:):
//   updated  hash   member → the item's time of change (ms), the one a newer write must beat
//   items    hash   member → the item as JSON
//   changes  zset   member scored by the revision of its last write
//   rev      string the last revision given out
// member: "<collection>\n<id>".

const PREFIX = 'lilac:v1:';
const KEY = { updated: `${PREFIX}updated`, items: `${PREFIX}items`, changes: `${PREFIX}changes`, rev: `${PREFIX}rev` };

// Upstash's REST API: a pipeline is a list of commands, answered in order.
export function redisStore(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  async function pipeline(commands) {
    if (!commands.length) return [];
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`);
    const results = await response.json();
    const failed = results.find(item => item.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    return results.map(item => item.result);
  }
  return {
    async updatedOf(members) {
      if (!members.length) return [];
      const [values] = await pipeline([['HMGET', KEY.updated, ...members]]);
      return values.map(value => (value == null ? null : Number(value)));
    },
    async read(members) {
      if (!members.length) return [];
      const [values] = await pipeline([['HMGET', KEY.items, ...members]]);
      return values;
    },
    async write(entries) {
      if (!entries.length) return this.rev();
      const [last] = await pipeline([['INCRBY', KEY.rev, entries.length]]), first = Number(last) - entries.length + 1;
      await pipeline([
        ['HSET', KEY.updated, ...entries.flatMap(entry => [entry.member, String(entry.updated)])],
        ['HSET', KEY.items, ...entries.flatMap(entry => [entry.member, entry.value])],
        ['ZADD', KEY.changes, ...entries.flatMap((entry, index) => [String(first + index), entry.member])],
      ]);
      return Number(last);
    },
    async changes(since, limit) {
      const [rows] = await pipeline([['ZRANGEBYSCORE', KEY.changes, `(${since}`, '+inf', 'WITHSCORES', 'LIMIT', '0', String(limit)]]);
      const members = [], revs = [];
      for (let i = 0; i < rows.length; i += 2) { members.push(rows[i]); revs.push(Number(rows[i + 1])); }
      if (!members.length) return [];
      const [values] = await pipeline([['HMGET', KEY.items, ...members]]);
      return members.map((member, index) => ({ member, rev: revs[index], value: values[index] })).filter(row => row.value != null);
    },
    async rev() { const [value] = await pipeline([['GET', KEY.rev]]); return Number(value) || 0; },
    // A counter that starts over after ttl seconds (failed sign-ins per address).
    async hit(key, ttl) {
      const [count] = await pipeline([['INCR', `${PREFIX}${key}`]]);
      if (Number(count) === 1) await pipeline([['EXPIRE', `${PREFIX}${key}`, String(ttl)]]);
      return Number(count);
    },
    async clearHits(key) { await pipeline([['DEL', `${PREFIX}${key}`]]); },
  };
}

export function memoryStore() {
  const updated = new Map(), items = new Map(), changes = new Map(), hits = new Map();
  let rev = 0;
  return {
    async updatedOf(members) { return members.map(member => (updated.has(member) ? updated.get(member) : null)); },
    async read(members) { return members.map(member => items.get(member) ?? null); },
    async write(entries) {
      for (const entry of entries) { rev++; updated.set(entry.member, entry.updated); items.set(entry.member, entry.value); changes.set(entry.member, rev); }
      return rev;
    },
    async changes(since, limit) {
      return [...changes].filter(([, at]) => at > since).sort((a, b) => a[1] - b[1]).slice(0, limit)
        .map(([member, at]) => ({ member, rev: at, value: items.get(member) }));
    },
    async rev() { return rev; },
    async hit(key, ttl) {
      const now = Date.now(), current = hits.get(key);
      const next = current && current.until > now ? { count: current.count + 1, until: current.until } : { count: 1, until: now + ttl * 1000 };
      hits.set(key, next); return next.count;
    },
    async clearHits(key) { hits.delete(key); },
  };
}
