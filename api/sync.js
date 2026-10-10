import { cors, send, setup, problems, bodyOf } from '../lib/http.js';
import { tokenMatches } from '../lib/auth.js';
import { checkItem, push, pull, MAX_ITEMS, PAGE } from '../lib/sync.js';

// GET  /api/sync?since=<rev>      → {rev, items, more}: the items changed after revision <rev> (0: all of them).
//                                   With more: true, ask again with since=rev for the next page.
// POST /api/sync {items: [...]}    → {rev, accepted}: stores the items newer than the server's copy.
// Both need "Authorization: Bearer <token>" (see /api/login).
export function syncHandler(context) {
  return async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const config = setup(context), list = problems(config);
    if (list.length) return send(res, 503, { error: list.join(' ') });
    if (!tokenMatches(config.password, req.headers.authorization)) return send(res, 401, { error: '다시 로그인해 주세요. (비밀번호가 바뀌었거나 토큰이 없습니다)' });
    if (req.method === 'GET') {
      const since = Number(new URL(req.url, 'http://local').searchParams.get('since') || 0);
      if (!Number.isInteger(since) || since < 0) return send(res, 400, { error: 'since는 0 이상의 정수여야 합니다.' });
      return send(res, 200, await pull(config.store, since, PAGE));
    }
    if (req.method === 'POST') {
      let body; try { body = await bodyOf(req); } catch { return send(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' }); }
      const items = Array.isArray(body?.items) ? body.items : null;
      if (!items) return send(res, 400, { error: 'items 배열이 필요합니다.' });
      if (items.length > MAX_ITEMS) return send(res, 413, { error: `한 번에 ${MAX_ITEMS}개까지 보낼 수 있습니다.` });
      for (const [index, item] of items.entries()) { const reason = checkItem(item); if (reason) return send(res, 400, { error: `items[${index}]: ${reason}` }); }
      return send(res, 200, await push(config.store, items));
    }
    return send(res, 405, { error: 'GET 또는 POST만 지원합니다.' });
  };
}

export default syncHandler();
