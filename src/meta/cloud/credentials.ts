import type { ApiErrorCode } from '../../../shared/api';
import { ApiError, NetworkError } from './api';

// Mirrors of USERNAME_PATTERN, PASSWORD_MIN_LENGTH and PASSWORD_MAX_LENGTH in shared/api.ts. The
// server stays the authority; tests assert these stay equal to the contract.
export const CLIENT_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const CLIENT_PASSWORD_MIN = 10;
export const CLIENT_PASSWORD_MAX = 128;

export type AuthMode = 'signin' | 'register';

export interface CredentialIssue {
  field: 'username' | 'password';
  message: string;
}

/** Returns the first problem with the form, or null when it can be sent. */
export function checkCredentials(username: string, password: string, mode: AuthMode): CredentialIssue | null {
  if (!CLIENT_USERNAME_PATTERN.test(username)) {
    return { field: 'username', message: 'Use 3–20 letters, numbers or underscores.' };
  }
  if (password.length > CLIENT_PASSWORD_MAX) {
    return { field: 'password', message: `Use at most ${CLIENT_PASSWORD_MAX} characters.` };
  }
  if (mode === 'register' && password.length < CLIENT_PASSWORD_MIN) {
    return { field: 'password', message: `Use at least ${CLIENT_PASSWORD_MIN} characters.` };
  }
  if (mode === 'signin' && password.length === 0) {
    return { field: 'password', message: 'Enter your password.' };
  }
  return null;
}

const ERROR_TEXT: Partial<Record<ApiErrorCode, string>> = {
  invalid_credentials: 'That username and password do not match.',
  username_taken: 'That username is already taken. Try another.',
  invalid_request: 'Check the username and password, then try again.',
  unauthorized: 'Your session has ended. Sign in again.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  payload_too_large: 'Your progress is too large to save to an account.',
  unsupported_media_type: 'The request could not be sent. Reload the page and try again.',
  forbidden_origin: 'The request was blocked. Reload the page and try again.',
  not_found: 'Accounts are unavailable right now.',
  unavailable: 'Accounts are unavailable right now.',
  server_error: 'The server ran into a problem. Try again shortly.',
  version_conflict: 'Your progress changed on another device. Try again.',
};

/** Plain-language text for a failed account request. */
export function describeCloudError(err: unknown): string {
  if (err instanceof ApiError) return ERROR_TEXT[err.code] ?? 'Something went wrong. Try again.';
  if (err instanceof NetworkError) {
    return err.reason === 'offline'
      ? "You're offline. Connect to the internet to sign in."
      : "Can't reach the server. Check your connection and try again.";
  }
  return 'Something went wrong. Try again.';
}
