import type { AccountResponse, Credentials, PublicUser, SaveProfileRequest } from '../../../shared/api';
import { browserBackend, type KVBackend, type PersistentStore } from '../../core/storage';
import type { ArcadeEvent, RunSummary } from '../arcade';
import { defaultProfile, type Profile, sanitizeProfile } from '../profile';
import { ApiError, type CloudApi, liveApi, NetworkError, type RequestOptions } from './api';
import { newRunId, RunQueue, toRunRequest } from './queue';
import { type CloudPrefs, readPrefs, writePrefs } from './storage';

/** Quiet time after the last local change before the profile is sent. */
export const SAVE_DEBOUNCE_MS = 1500;
/** Largest body that can ride a keepalive request. Browsers share a 64 KB budget between them. */
export const KEEPALIVE_MAX_BYTES = 60_000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

/** Retry delays of 2 s, 4 s, 8 s and so on, capped at 60 s. */
export class Backoff {
  private attempt = 0;

  next(): number {
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}

export type SyncPhase = 'saved' | 'saving' | 'offline' | 'retry' | 'error';

export type CloudStatus =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'guest' }
  | { kind: 'account'; user: PublicUser; phase: SyncPhase; pendingRuns: number };

export type CloudNotice = { kind: 'refreshed' } | { kind: 'session-expired' };

export interface ProgressSummary {
  games: number;
  coins: number;
}

export interface ProgressChoice {
  username: string;
  device: ProgressSummary;
  account: ProgressSummary;
}

/** 'account' keeps the saved account progress. 'device' keeps what this device has. */
export type ProgressAnswer = 'account' | 'device';

export function summarizeProgress(p: Profile): ProgressSummary {
  let games = 0;
  for (const rec of Object.values(p.games)) games += rec.plays;
  return { games, coins: p.coins };
}

/** A device has progress once it has played a game or its coins differ from a fresh profile. */
export function hasLocalProgress(p: Profile): boolean {
  return summarizeProgress(p).games > 0 || p.coins !== defaultProfile().coins;
}

/** Moving targets and browser services, injectable so tests can drive them. */
export interface CloudEnv {
  /** Receives `online`, `offline` and `pagehide`. */
  win: EventTarget | null;
  /** Receives `visibilitychange`. */
  doc: EventTarget | null;
  isOnline(): boolean;
  isHidden(): boolean;
  storage: KVBackend | null;
  now(): number;
  newId(): string;
}

export interface CloudSyncOptions {
  store: PersistentStore<Profile>;
  /** The arcade's event source. Settled runs are queued for upload from here. */
  events: { on(fn: (e: ArcadeEvent) => void): () => void };
  /** Asked once when signing in finds progress on this device that differs from the account. */
  ask: (choice: ProgressChoice) => Promise<ProgressAnswer>;
  notify?: (notice: CloudNotice) => void;
  api?: CloudApi;
  env?: Partial<CloudEnv>;
}

type Timer = ReturnType<typeof setTimeout>;
type Base = 'checking' | 'unavailable' | 'guest';

function defaultEnv(): CloudEnv {
  return {
    win: typeof window === 'undefined' ? null : window,
    doc: typeof document === 'undefined' ? null : document,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    storage: browserBackend(),
    now: () => Date.now(),
    newId: newRunId,
  };
}

function clear(t: Timer | null): null {
  if (t !== null) clearTimeout(t);
  return null;
}

/** JSON with object keys sorted, so two equal profiles always compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = (v as Record<string, unknown>)[k];
    return out;
  });
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Errors worth another attempt: no answer at all, a server fault, or a rate limit. */
function isRetriable(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError)
    return err.status >= 500 || err.code === 'rate_limited' || err.code === 'not_found';
  return false;
}

/**
 * Keeps the local profile in step with the player's account. Guests never touch the network: the
 * controller stays idle until a session exists. Signed-in changes are saved after a quiet period,
 * and finished runs are posted with a client-generated id so a retry cannot record one twice.
 */
export class CloudSync {
  /** Settles once the first session check has finished, whatever the outcome. */
  readonly ready: Promise<void>;
  private settleReady: () => void = () => undefined;
  private readonly opts: CloudSyncOptions;
  private readonly store: PersistentStore<Profile>;
  private readonly api: CloudApi;
  private readonly env: CloudEnv;
  private readonly queue: RunQueue;
  private readonly listeners = new Set<(status: CloudStatus) => void>();
  private readonly unsubscribes: Array<() => void> = [];
  private prefs: CloudPrefs;
  /** The non-account states. Being signed in is implied by `user`. */
  private base: Base = 'checking';
  private user: PublicUser | null = null;
  private phase: SyncPhase = 'saved';
  /** The server version this device builds on: the one it last saw, or the one its next save uses. */
  private version = 0;
  /** Canonical JSON of the profile the server is known to hold. Null forces the next save to go out. */
  private acked: string | null = null;
  /** True while the store is being replaced with a cloud copy, so that change is not treated as local. */
  private applying = false;
  private saveTimer: Timer | null = null;
  private saveInFlight = false;
  private profileRetry: Timer | null = null;
  private readonly profileBackoff = new Backoff();
  private runsFlushing = false;
  private runRetry: Timer | null = null;
  private readonly runBackoff = new Backoff();
  private sessionRetry: Timer | null = null;
  private readonly sessionBackoff = new Backoff();
  /** Bumped on every account change, so replies to requests made for an earlier account are ignored. */
  private generation = 0;
  private started = false;
  private lastPublished = '';

  constructor(opts: CloudSyncOptions) {
    this.opts = opts;
    this.store = opts.store;
    this.api = opts.api ?? liveApi;
    this.env = { ...defaultEnv(), ...opts.env };
    this.queue = new RunQueue(this.env.storage);
    this.prefs = readPrefs(this.env.storage);
    this.ready = new Promise<void>((resolve) => {
      this.settleReady = () => resolve();
    });
  }

  /** The current status. */
  get current(): CloudStatus {
    return this.snapshot();
  }

  subscribe(fn: (status: CloudStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Begins syncing: checks the session, then listens for runs, changes and connectivity. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribes.push(
      this.opts.events.on((e) => {
        if (e.type === 'run-finished') this.queueRun(e.summary, e.startedAt);
      }),
      this.store.subscribe(() => this.onLocalChange()),
    );
    this.env.win?.addEventListener('online', this.onOnline);
    this.env.win?.addEventListener('offline', this.onOffline);
    this.env.win?.addEventListener('pagehide', this.onHide);
    this.env.doc?.addEventListener('visibilitychange', this.onVisibility);
    void this.checkSession();
  }

  /** Stops listening and cancels pending work. */
  dispose(): void {
    for (const off of this.unsubscribes.splice(0)) off();
    this.env.win?.removeEventListener('online', this.onOnline);
    this.env.win?.removeEventListener('offline', this.onOffline);
    this.env.win?.removeEventListener('pagehide', this.onHide);
    this.env.doc?.removeEventListener('visibilitychange', this.onVisibility);
    this.detach();
  }

  /** Checks the session again after the server could not be reached. */
  retry(): void {
    if (this.base !== 'unavailable') return;
    this.base = 'checking';
    this.publish();
    void this.checkSession();
  }

  /** Signs in. Rejects with ApiError or NetworkError so the form can explain the failure. */
  async signIn(credentials: Credentials): Promise<void> {
    const account = await this.api.login(credentials);
    await this.enter(account, 'login');
  }

  /** Creates an account and uploads this device's progress into it. */
  async register(credentials: Credentials): Promise<void> {
    const account = await this.api.register(credentials);
    await this.enter(account, 'register');
  }

  /**
   * Stops syncing and drops this account's queued runs. The local profile stays as the guest profile.
   */
  signOut(): void {
    const user = this.user;
    if (user === null) return;
    this.detach();
    this.queue.removeForUser(user.id);
    this.prefs = { binding: null, signedOutUserId: user.id };
    writePrefs(this.env.storage, this.prefs);
    this.base = 'guest';
    this.publish();
  }

  // ---------------------------------------------------------------- session & account

  private async checkSession(): Promise<void> {
    this.sessionRetry = clear(this.sessionRetry);
    const gen = this.generation;
    try {
      const { user } = await this.api.session();
      if (gen !== this.generation) return;
      if (user === null || user.id === this.prefs.signedOutUserId) {
        this.base = 'guest';
        this.publish();
        return;
      }
      const account = await this.api.getProfile();
      if (gen !== this.generation) return;
      this.sessionBackoff.reset();
      await this.enter(account, 'boot');
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof ApiError && err.status === 401) {
        this.base = 'guest';
        this.publish();
        return;
      }
      this.base = 'unavailable';
      this.publish();
      this.scheduleSessionRetry();
    } finally {
      this.settleReady();
    }
  }

  private scheduleSessionRetry(): void {
    this.sessionRetry = clear(this.sessionRetry);
    this.sessionRetry = setTimeout(() => {
      this.sessionRetry = null;
      void this.checkSession();
    }, this.sessionBackoff.next());
  }

  /**
   * Takes an account's copy of the profile into this device. What happens to local progress depends on
   * what this device last synced: unsent changes go up, a clean copy yields to the account, and a device
   * with progress the account does not know about is asked about, once.
   */
  private async enter(account: AccountResponse, mode: 'login' | 'register' | 'boot'): Promise<void> {
    this.detach();
    const gen = this.generation;
    const user = account.user;
    if (this.prefs.signedOutUserId === user.id) {
      this.prefs = { ...this.prefs, signedOutUserId: null };
    }
    const cloud = sanitizeProfile(account.profile);
    const device = this.store.get();
    const bound = this.prefs.binding?.userId === user.id ? this.prefs.binding : null;
    let answer: ProgressAnswer = 'account';
    if (mode === 'register') {
      answer = 'device';
    } else if (bound) {
      answer = bound.pending ? 'device' : 'account';
    } else if (hasLocalProgress(device) && canonicalJson(device) !== canonicalJson(cloud)) {
      answer = await this.opts.ask({
        username: user.username,
        device: summarizeProgress(device),
        account: summarizeProgress(cloud),
      });
      if (gen !== this.generation) return;
    }
    this.user = user;
    if (answer === 'device') this.keepDevice(bound?.pending ? bound.version : account.version);
    else this.applyAccount(cloud, account.version);
    this.publish();
    void this.flushRuns();
  }

  /** This device's copy is the one to keep: send it, building on `baseVersion`. */
  private keepDevice(baseVersion: number): void {
    this.version = baseVersion;
    this.acked = null;
    this.phase = 'saving';
    this.persistBinding();
    void this.pushProfile();
  }

  /** Replaces the device profile with the account copy. This is not a local change, so nothing is sent. */
  private applyAccount(profile: Profile, version: number): void {
    this.stopSaving();
    this.version = version;
    this.applying = true;
    try {
      this.store.replace(profile);
    } finally {
      this.applying = false;
    }
    this.acked = canonicalJson(profile);
    this.phase = 'saved';
    this.persistBinding();
  }

  /** Stops syncing the current account. Queued runs stay where they are. */
  private detach(): void {
    this.generation += 1;
    this.stopSaving();
    this.runRetry = clear(this.runRetry);
    this.runBackoff.reset();
    this.sessionRetry = clear(this.sessionRetry);
    this.user = null;
    this.acked = null;
    this.phase = 'saved';
  }

  private expireSession(): void {
    this.detach();
    this.base = 'guest';
    this.notify({ kind: 'session-expired' });
    this.publish();
  }

  // ---------------------------------------------------------------- profile saves

  private onLocalChange(): void {
    if (this.applying || this.user === null || !this.isDirty()) return;
    this.phase = 'saving';
    this.persistBinding();
    this.scheduleSave();
    this.publish();
  }

  private scheduleSave(): void {
    this.saveTimer = clear(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.pushProfile();
    }, SAVE_DEBOUNCE_MS);
  }

  private stopSaving(): void {
    this.saveTimer = clear(this.saveTimer);
    this.profileRetry = clear(this.profileRetry);
    this.profileBackoff.reset();
  }

  private async pushProfile(opts: RequestOptions = {}): Promise<void> {
    if (this.user === null || this.saveInFlight) return;
    const profile = this.store.get();
    const json = canonicalJson(profile);
    if (json === this.acked) {
      this.phase = 'saved';
      this.persistBinding();
      this.publish();
      return;
    }
    const request: SaveProfileRequest = { baseVersion: this.version, profile };
    if (opts.keepalive && jsonBytes(request) > KEEPALIVE_MAX_BYTES) {
      // Too big to send while the page is going away. The normal save picks it up.
      this.scheduleSave();
      return;
    }
    const gen = this.generation;
    this.profileRetry = clear(this.profileRetry);
    this.saveInFlight = true;
    this.phase = 'saving';
    this.publish();
    try {
      const res = await this.api.saveProfile(request, opts);
      if (gen !== this.generation) return;
      this.version = res.version;
      this.acked = json;
      this.profileBackoff.reset();
      this.phase = 'saved';
      this.persistBinding();
      if (this.isDirty()) {
        this.phase = 'saving';
        this.scheduleSave();
      }
      this.publish();
    } catch (err) {
      if (gen === this.generation) await this.onSaveFailed(err, gen);
    } finally {
      this.saveInFlight = false;
      // The account changed while this request was in flight, so the new account's changes wait on it.
      if (gen !== this.generation && this.user !== null && this.isDirty()) void this.pushProfile();
    }
  }

  private async onSaveFailed(err: unknown, gen: number): Promise<void> {
    if (err instanceof ApiError && err.code === 'version_conflict') {
      await this.refreshFromCloud(gen);
    } else if (err instanceof ApiError && err.status === 401) {
      this.expireSession();
    } else if (isRetriable(err)) {
      this.scheduleProfileRetry(err);
    } else {
      // Rejected for good. The copy stays on this device and the next change tries again.
      this.phase = 'error';
      this.publish();
    }
  }

  /** A newer copy exists on the server. The server wins: local changes not yet saved are dropped. */
  private async refreshFromCloud(gen: number): Promise<void> {
    try {
      const account = await this.api.getProfile();
      if (gen !== this.generation) return;
      this.applyAccount(sanitizeProfile(account.profile), account.version);
      this.publish();
      this.notify({ kind: 'refreshed' });
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof ApiError && err.status === 401) this.expireSession();
      else this.scheduleProfileRetry(err);
    }
  }

  private scheduleProfileRetry(err: unknown): void {
    this.profileRetry = clear(this.profileRetry);
    const offline = !this.env.isOnline() || (err instanceof NetworkError && err.reason === 'offline');
    this.phase = offline ? 'offline' : 'retry';
    this.profileRetry = setTimeout(() => {
      this.profileRetry = null;
      void this.pushProfile();
    }, this.profileBackoff.next());
    this.publish();
  }

  private isDirty(): boolean {
    return canonicalJson(this.store.get()) !== this.acked;
  }

  private persistBinding(): void {
    const user = this.user;
    if (user === null) return;
    this.prefs = {
      ...this.prefs,
      binding: { userId: user.id, version: this.version, pending: this.isDirty() },
    };
    writePrefs(this.env.storage, this.prefs);
  }

  // ---------------------------------------------------------------- runs

  private queueRun(summary: RunSummary, startedAt: number): void {
    const user = this.user;
    if (user === null) return; // guests never touch the network
    const run = toRunRequest(summary, startedAt, this.env.newId(), this.env.now());
    this.queue.add(user.id, run, this.env.now());
    this.publish();
    void this.flushRuns();
  }

  /** Posts queued runs one at a time, oldest first, for whichever account is signed in. */
  private async flushRuns(opts: RequestOptions = {}): Promise<void> {
    if (this.runsFlushing) return;
    this.runsFlushing = true;
    try {
      for (;;) {
        const user = this.user;
        const next = user === null ? undefined : this.queue.forUser(user.id)[0];
        if (next === undefined) break;
        const gen = this.generation;
        try {
          await this.api.postRun(next.run, opts);
          this.queue.remove(next.run.clientRunId);
          this.runBackoff.reset();
        } catch (err) {
          if (gen !== this.generation) continue;
          if (err instanceof ApiError && err.status === 401) {
            this.expireSession();
            break;
          }
          if (isRetriable(err)) {
            this.scheduleRunRetry();
            break;
          }
          // Rejected for good. Keeping it would retry forever.
          this.queue.remove(next.run.clientRunId);
        }
      }
    } finally {
      this.runsFlushing = false;
      this.publish();
    }
  }

  private scheduleRunRetry(): void {
    if (this.runRetry !== null) return;
    this.runRetry = setTimeout(() => {
      this.runRetry = null;
      void this.flushRuns();
    }, this.runBackoff.next());
  }

  // ---------------------------------------------------------------- browser events

  private readonly onOnline = (): void => {
    if (this.base === 'unavailable') {
      this.retry();
      return;
    }
    if (this.user === null) return;
    this.profileBackoff.reset();
    this.runBackoff.reset();
    this.profileRetry = clear(this.profileRetry);
    this.runRetry = clear(this.runRetry);
    void this.pushProfile();
    void this.flushRuns();
  };

  private readonly onOffline = (): void => {
    if (this.user !== null && this.isDirty()) {
      this.phase = 'offline';
      this.publish();
    }
  };

  /** Sends pending changes when the page is hidden or closed, and keeps them if that is not possible. */
  private readonly onHide = (): void => {
    if (this.user === null) return;
    if (this.isDirty()) {
      this.saveTimer = clear(this.saveTimer);
      void this.pushProfile({ keepalive: true });
    }
    void this.flushRuns({ keepalive: true });
  };

  private readonly onVisibility = (): void => {
    if (this.env.isHidden()) this.onHide();
  };

  // ---------------------------------------------------------------- status

  private snapshot(): CloudStatus {
    if (this.user !== null) {
      return {
        kind: 'account',
        user: this.user,
        phase: this.phase,
        pendingRuns: this.queue.count(this.user.id),
      };
    }
    if (this.base === 'unavailable') return { kind: 'unavailable' };
    if (this.base === 'guest') return { kind: 'guest' };
    return { kind: 'checking' };
  }

  private publish(): void {
    const status = this.snapshot();
    const key = JSON.stringify(status);
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    for (const fn of this.listeners) fn(status);
  }

  private notify(notice: CloudNotice): void {
    this.opts.notify?.(notice);
  }
}
