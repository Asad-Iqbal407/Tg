import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Stored format: `scrypt$N$r$p$salt$key`, with the salt and key in base64url. The cost parameters travel
 * with each hash, so they can be raised later without invalidating existing passwords.
 */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** scrypt needs about 16 MB at these parameters; the default 32 MB ceiling leaves no headroom. */
const MAX_MEMORY = 64 * 1024 * 1024;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...params, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const actual = await deriveKey(password, parsed.salt, parsed.params);
  return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
}

let dummy: Promise<string> | undefined;

/**
 * A hash of a random password, created once. Checking a login against it costs the same as checking a
 * real account, so response time does not reveal which usernames exist.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummy;
}

function parseHash(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const [scheme, N, r, p, saltText, keyText, extra] = stored.split('$');
  if (scheme !== 'scrypt' || extra !== undefined || !saltText || !keyText) return null;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  return {
    params,
    salt: Buffer.from(saltText, 'base64url'),
    key: Buffer.from(keyText, 'base64url'),
  };
}
