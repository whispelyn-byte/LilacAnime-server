import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// The password is the one the owner set on the Vercel project (LILAC_PASSWORD). Apps sign in with it once and keep a
// token made from it, never the password itself; changing the password signs every device out.
export const MIN_PASSWORD = 8;

export function passwordOf(env = process.env) {
  const value = String(env.LILAC_PASSWORD || '');
  return value.length >= MIN_PASSWORD ? value : null;
}

export function tokenFor(password) {
  return createHmac('sha256', password).update('lilacanime-sync-v1').digest('base64url');
}

const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

export function passwordMatches(password, given) { return Boolean(password) && typeof given === 'string' && same(password, given); }

export function tokenMatches(password, header) {
  const given = String(header || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  return Boolean(password && given) && same(tokenFor(password), given);
}
