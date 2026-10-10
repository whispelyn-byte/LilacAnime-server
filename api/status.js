import { cors, send, setup, problems, VERSION } from '../lib/http.js';

// GET /api/status: whether this is a LilacAnime server and whether it is set up. No sign-in needed (it tells nothing
// about the data), so an app can check an address before asking for the password.
export function statusHandler(context) {
  return async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method !== 'GET') return send(res, 405, { error: 'GET만 지원합니다.' });
    const list = problems(setup(context));
    return send(res, 200, { app: 'lilacanime-server', version: VERSION, ready: !list.length, problems: list });
  };
}

export default statusHandler();
