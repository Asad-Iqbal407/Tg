import type { KVBackend } from '../../core/storage';
import { asRecord } from './guards';

// Every access is wrapped: storage can be blocked, full or throwing, and the game must carry on.

export function readKey(backend: KVBackend | null, key: string): string | null {
  if (!backend) return null;
  try {
    return backend.getItem(key);
  } catch {
    return null;
  }
}

export function writeKey(backend: KVBackend | null, key: string, value: string): void {
  try {
    backend?.setItem(key, value);
  } catch {
    // Quota exceeded or storage disabled: keep working from memory.
  }
}

export function dropKey(backend: KVBackend | null, key: string): void {
  try {
    backend?.removeItem(key);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

export const CLOUD_PREFS_KEY = 'neon-arcade:cloud';

/** The account this device last synced, and whether a change is still waiting to reach the server. */
export interface SyncBinding {
  userId: string;
  /** The server version this device builds on. */
  version: number;
  /** True while local changes have not been acknowledged, so a reload must send them again. */
  pending: boolean;
}

export interface CloudPrefs {
  binding: SyncBinding | null;
  /**
   * Set when the player signed out on this device. The session cookie may still be valid, so this
   * stops the next visit from signing them straight back in.
   */
  signedOutUserId: string | null;
}

export function readPrefs(backend: KVBackend | null): CloudPrefs {
  const empty: CloudPrefs = { binding: null, signedOutUserId: null };
  const raw = readKey(backend, CLOUD_PREFS_KEY);
  if (raw === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  const o = asRecord(parsed);
  if (o === null) return empty;
  const b = asRecord(o.binding);
  const binding: SyncBinding | null =
    b !== null &&
    typeof b.userId === 'string' &&
    typeof b.version === 'number' &&
    Number.isFinite(b.version) &&
    typeof b.pending === 'boolean'
      ? { userId: b.userId, version: b.version, pending: b.pending }
      : null;
  const signedOutUserId = typeof o.signedOutUserId === 'string' ? o.signedOutUserId : null;
  return { binding, signedOutUserId };
}

export function writePrefs(backend: KVBackend | null, prefs: CloudPrefs): void {
  if (prefs.binding === null && prefs.signedOutUserId === null) {
    dropKey(backend, CLOUD_PREFS_KEY);
    return;
  }
  writeKey(backend, CLOUD_PREFS_KEY, JSON.stringify(prefs));
}
