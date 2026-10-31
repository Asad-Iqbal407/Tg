import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '../../shared/api';
import type { Repository, StoredUser } from '../db/repository';
import { dummyHash, verifyPassword } from './password';

export const INVALID_CREDENTIALS_MESSAGE = 'Incorrect username or password.';

const USERNAME_MESSAGE = 'Username must be 3 to 20 letters, digits or underscores.';
const PASSWORD_MESSAGE = `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

/** Register: both fields are checked against the same rules the client shows. */
export const registerSchema = z.object(
  {
    username: z
      .string({ error: 'Username is required.' })
      .regex(USERNAME_PATTERN, { error: USERNAME_MESSAGE }),
    password: z
      .string({ error: 'Password is required.' })
      .min(PASSWORD_MIN_LENGTH, { error: PASSWORD_MESSAGE })
      .max(PASSWORD_MAX_LENGTH, { error: PASSWORD_MESSAGE }),
  },
  { error: 'Send a JSON object with username and password.' },
);

/**
 * Login only checks shape. A malformed username simply matches no account, so the response is the same
 * 401 as for a wrong password.
 */
export const loginSchema = z.object(
  {
    username: z
      .string({ error: 'Username and password are required.' })
      .max(64, { error: 'Username is too long.' }),
    password: z
      .string({ error: 'Username and password are required.' })
      .max(PASSWORD_MAX_LENGTH, { error: 'Password is too long.' }),
  },
  { error: 'Send a JSON object with username and password.' },
);

export type PasswordCheck = (password: string, stored: string) => Promise<boolean>;

/**
 * Returns the user when the credentials match. An unknown username is checked against the dummy hash,
 * so both failure paths do the same work. `verify` can be replaced in tests.
 */
export async function authenticate(
  repo: Repository,
  username: string,
  password: string,
  verify: PasswordCheck = verifyPassword,
): Promise<StoredUser | null> {
  const user = await repo.findUserByUsername(username);
  const hash = user ? user.passwordHash : await dummyHash();
  const matches = await verify(password, hash);
  return user !== null && matches ? user : null;
}
