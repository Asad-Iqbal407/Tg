export interface KVBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryBackend implements KVBackend {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage when usable (it throws in some private modes / sandboxed iframes), memory otherwise. */
export function browserBackend(): KVBackend {
  try {
    const ls = window.localStorage;
    const probe = '__arcade_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryBackend();
  }
}

interface Envelope {
  v: number;
  savedAt: number;
  data: unknown;
}

export interface StoreOptions<T> {
  key: string;
  version: number;
  backend: KVBackend;
  defaults: () => T;
  /** Coerces arbitrary (possibly corrupted or hand-edited) data into a valid T. */
  sanitize: (raw: unknown) => T;
  /** Upgrades data saved by an older schema version. */
  migrate?: (raw: unknown, fromVersion: number) => unknown;
  /** Debounce for writes triggered by `update`. */
  saveDelayMs?: number;
}

export type StoreListener<T> = (state: T) => void;

/**
 * Versioned, validated, debounced persistent state container. Writes are coalesced and
 * flushed on `pagehide`, and data is always passed through `sanitize` on load and import, so a
 * corrupted save can never crash the app.
 */
export class PersistentStore<T> {
  private state: T;
  private readonly listeners = new Set<StoreListener<T>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: unknown = null;

  constructor(private readonly opts: StoreOptions<T>) {
    this.state = this.load();
  }

  get(): T {
    return this.state;
  }

  get error(): unknown {
    return this.lastError;
  }

  update(mutator: (draft: T) => void): void {
    mutator(this.state);
    this.scheduleSave();
    this.emit();
  }

  replace(next: T): void {
    this.state = next;
    this.save();
    this.emit();
  }

  subscribe(fn: StoreListener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(): void {
    this.replace(this.opts.defaults());
  }

  /** Re-read from the backend (e.g. after another tab saved). */
  reload(): void {
    this.state = this.load();
    this.emit();
  }

  save(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const env: Envelope = { v: this.opts.version, savedAt: Date.now(), data: this.state };
    try {
      this.opts.backend.setItem(this.opts.key, JSON.stringify(env));
      this.lastError = null;
    } catch (err) {
      // Quota exceeded or storage disabled: keep running with in-memory state.
      this.lastError = err;
    }
  }

  flush(): void {
    if (this.saveTimer !== null) this.save();
  }

  exportJson(): string {
    const env: Envelope = { v: this.opts.version, savedAt: Date.now(), data: this.state };
    return JSON.stringify(env, null, 2);
  }

  /** Returns false (and leaves state untouched) when the payload is not a recognisable save. */
  importJson(json: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }
    if (!isEnvelope(parsed) || parsed.v > this.opts.version) return false;
    this.replace(this.decode(parsed));
    return true;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => this.save(), this.opts.saveDelayMs ?? 250);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  private load(): T {
    let raw: string | null = null;
    try {
      raw = this.opts.backend.getItem(this.opts.key);
    } catch (err) {
      this.lastError = err;
    }
    if (raw === null) return this.opts.defaults();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isEnvelope(parsed)) return this.opts.defaults();
      return this.decode(parsed);
    } catch (err) {
      this.lastError = err;
      return this.opts.defaults();
    }
  }

  private decode(env: Envelope): T {
    let data = env.data;
    if (env.v < this.opts.version && this.opts.migrate) data = this.opts.migrate(data, env.v);
    return this.opts.sanitize(data);
  }
}

function isEnvelope(x: unknown): x is Envelope {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as Envelope).v === 'number' &&
    Number.isFinite((x as Envelope).v) &&
    'data' in x
  );
}

// ---------------------------------------------------------------- sanitizing helpers

export function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function int(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(num(v, fallback, min, max));
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function str(v: unknown, fallback: string, maxLen = 200): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : fallback;
}

export function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function safeKey(k: string): boolean {
  return !UNSAFE_KEYS.has(k) && k.length <= 64;
}

export function numberRecord(v: unknown, min = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj(v))) {
    if (!safeKey(k)) continue;
    if (typeof val === 'number' && Number.isFinite(val) && val >= min) out[k] = val;
  }
  return out;
}
