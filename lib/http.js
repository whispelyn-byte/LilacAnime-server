import { redisStore } from './store.js';
import { passwordOf } from './auth.js';

export const VERSION = 1;

// Apps call the server from anywhere (and a token, not a cookie, signs them in), so any origin may ask.
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

export function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); }

// Vercel parses a JSON body into req.body; a local server may hand over the raw text.
export async function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let text = ''; for await (const chunk of req) text += chunk;
  return JSON.parse(text || '{}');
}

// What the handlers need, taken from the environment unless a test hands it over.
export function setup(context = {}) {
  const env = context.env || process.env;
  return { password: context.password !== undefined ? context.password : passwordOf(env), store: context.store !== undefined ? context.store : redisStore(env) };
}

// The problems that keep the server from working, said the way the owner fixes them.
export function problems({ password, store }) {
  const list = [];
  if (!password) list.push('Vercel 프로젝트 환경 변수 LILAC_PASSWORD(8자 이상)를 설정하고 다시 배포하세요.');
  if (!store) list.push('Vercel 프로젝트에 Upstash Redis(Storage 탭)를 연결하고 다시 배포하세요.');
  return list;
}

export function clientAddress(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim(); }
