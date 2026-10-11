import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../shared/api';
import { loginSchema, registerSchema } from '../../server/auth/credentials';

function firstMessage(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } },
  value: unknown,
) {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error?.issues[0]?.message as string;
}

describe('registerSchema', () => {
  it('accepts a valid username and password', () => {
    expect(
      registerSchema.safeParse({ username: 'Ada_99', password: 'x'.repeat(PASSWORD_MIN_LENGTH) }).success,
    ).toBe(true);
  });

  it('enforces the username pattern from the API contract', () => {
    const message = 'Username must be 3 to 20 letters, digits or underscores.';
    for (const username of ['ab', 'a'.repeat(21), 'has space', 'dash-name', 'dot.name', 'ünïcode']) {
      expect(firstMessage(registerSchema, { username, password: 'x'.repeat(12) })).toBe(message);
    }
    expect(registerSchema.safeParse({ username: 'a'.repeat(20), password: 'x'.repeat(12) }).success).toBe(
      true,
    );
    expect(registerSchema.safeParse({ username: 'abc', password: 'x'.repeat(12) }).success).toBe(true);
  });

  it('enforces the password length limits from the API contract', () => {
    const message = `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
    const username = 'ok_name';
    expect(firstMessage(registerSchema, { username, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) })).toBe(
      message,
    );
    expect(firstMessage(registerSchema, { username, password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) })).toBe(
      message,
    );
    expect(registerSchema.safeParse({ username, password: 'x'.repeat(PASSWORD_MAX_LENGTH) }).success).toBe(
      true,
    );
  });

  it('gives readable messages for missing fields and non-object bodies', () => {
    expect(firstMessage(registerSchema, { password: 'x'.repeat(12) })).toBe('Username is required.');
    expect(firstMessage(registerSchema, { username: 'ok_name' })).toBe('Password is required.');
    expect(firstMessage(registerSchema, undefined)).toBe('Send a JSON object with username and password.');
  });
});

describe('loginSchema', () => {
  it('accepts any strings within the length bounds, so malformed names fail as wrong credentials', () => {
    expect(loginSchema.safeParse({ username: 'not valid!', password: 'whatever' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: '', password: '' }).success).toBe(true);
  });

  it('rejects oversized fields and missing fields', () => {
    expect(firstMessage(loginSchema, { username: 'u'.repeat(65), password: 'p' })).toBe(
      'Username is too long.',
    );
    expect(firstMessage(loginSchema, { username: 'u', password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1) })).toBe(
      'Password is too long.',
    );
    expect(firstMessage(loginSchema, { password: 'p' })).toBe('Username and password are required.');
  });
});
