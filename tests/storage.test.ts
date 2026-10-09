import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KVBackend, MemoryBackend, numberRecord, PersistentStore } from '../src/core/storage';

interface State {
  n: number;
  tag: string;
}

const sanitize = (raw: unknown): State => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<State>;
  return {
    n: typeof o.n === 'number' && Number.isFinite(o.n) ? o.n : 0,
    tag: typeof o.tag === 'string' ? o.tag : 'default',
  };
};

function makeStore(backend: KVBackend, version = 2, migrate?: (raw: unknown, v: number) => unknown) {
  return new PersistentStore<State>({
    key: 'k',
    version,
    backend,
    defaults: () => ({ n: 0, tag: 'default' }),
    sanitize,
    migrate,
    saveDelayMs: 50,
  });
}

describe('PersistentStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts from defaults and debounces writes', () => {
    const backend = new MemoryBackend();
    const store = makeStore(backend);
    expect(store.get()).toEqual({ n: 0, tag: 'default' });
    store.update((s) => (s.n = 5));
    store.update((s) => (s.n = 6));
    expect(backend.getItem('k')).toBeNull();
    vi.advanceTimersByTime(60);
    expect(JSON.parse(backend.getItem('k') ?? '{}').data.n).toBe(6);
    expect(makeStore(backend).get().n).toBe(6);
  });

  it('flush writes pending changes immediately', () => {
    const backend = new MemoryBackend();
    const store = makeStore(backend);
    store.update((s) => (s.tag = 'x'));
    store.flush();
    expect(makeStore(backend).get().tag).toBe('x');
  });

  it('falls back to defaults on corrupted data', () => {
    const backend = new MemoryBackend();
    backend.setItem('k', '{not json');
    expect(makeStore(backend).get()).toEqual({ n: 0, tag: 'default' });
    backend.setItem('k', JSON.stringify({ hello: 'world' }));
    expect(makeStore(backend).get()).toEqual({ n: 0, tag: 'default' });
  });

  it('runs migrations for older versions', () => {
    const backend = new MemoryBackend();
    backend.setItem('k', JSON.stringify({ v: 1, savedAt: 0, data: { count: 9 } }));
    const store = makeStore(backend, 2, (raw) => ({ n: (raw as { count: number }).count, tag: 'migrated' }));
    expect(store.get()).toEqual({ n: 9, tag: 'migrated' });
  });

  it('round-trips exports and rejects invalid or future imports', () => {
    const store = makeStore(new MemoryBackend());
    store.update((s) => (s.n = 3));
    const json = store.exportJson();
    const other = makeStore(new MemoryBackend());
    expect(other.importJson(json)).toBe(true);
    expect(other.get().n).toBe(3);
    expect(other.importJson('nope')).toBe(false);
    expect(other.importJson(JSON.stringify({ v: 99, data: { n: 1 } }))).toBe(false);
    expect(other.get().n).toBe(3);
  });

  it('keeps running when the backend throws (quota / private mode)', () => {
    const broken: KVBackend = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const store = makeStore(broken);
    store.update((s) => (s.n = 1));
    expect(() => store.save()).not.toThrow();
    expect(store.get().n).toBe(1);
    expect(store.error).toBeInstanceOf(Error);
  });

  it('notifies subscribers', () => {
    const store = makeStore(new MemoryBackend());
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.n));
    store.update((s) => (s.n = 2));
    off();
    store.update((s) => (s.n = 3));
    expect(seen).toEqual([2]);
  });
});

describe('numberRecord', () => {
  it('drops unsafe keys and non-finite values', () => {
    const parsed = JSON.parse('{"__proto__": 5, "ok": 2, "neg": -1, "nan": "x", "constructor": 1}');
    const rec = numberRecord(parsed);
    expect(rec).toEqual({ ok: 2 });
    expect(Object.getPrototypeOf(rec)).toBe(Object.prototype);
  });
});
