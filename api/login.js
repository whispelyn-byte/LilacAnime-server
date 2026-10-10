import { cors, send, setup, problems, bodyOf, clientAddress } from '../lib/http.js';
import { passwordMatches, tokenFor } from '../lib/auth.js';

// POST /api/login {password} → {token}: the token the app keeps and sends as "Authorization: Bearer <token>".
// Ten wrong passwords from one address lock it out for 10 minutes.
export const LOCK_AFTER = 10, LOCK_SECONDS = 600;

export function loginHandler(context) {
  return async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method !== 'POST') return send(res, 405, { error: 'POST만 지원합니다.' });
    const config = setup(context), list = problems(config);
    if (list.length) return send(res, 503, { error: list.join(' ') });
    const key = `login-fail:${clientAddress(req)}`;
    let body; try { body = await bodyOf(req); } catch { return send(res, 400, { error: 'JSON 본문이 올바르지 않습니다.' }); }
    if (!passwordMatches(config.password, body?.password)) {
      const count = await config.store.hit(key, LOCK_SECONDS);
      return count > LOCK_AFTER ? send(res, 429, { error: '비밀번호를 너무 많이 틀렸습니다. 10분 뒤에 다시 해 보세요.' }) : send(res, 401, { error: '비밀번호가 맞지 않습니다.' });
    }
    await config.store.clearHits(key);
    return send(res, 200, { token: tokenFor(config.password) });
  };
}

export default loginHandler();
