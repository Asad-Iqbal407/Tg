import { vi } from 'vitest';
import type {
  AccountResponse,
  Credentials,
  LeaderboardEntry,
  PublicUser,
  RunRequest,
  SaveProfileRequest,
} from '../shared/api';
import { MemoryBackend, PersistentStore } from '../src/core/storage';
import { GAMES } from '../src/games/registry';
import { ArcadeService } from '../src/meta/arcade';
import {
  type CloudEnv,
  CloudSync,
  type CloudNotice,
  type ProgressAnswer,
  type ProgressChoice,
} from '../src/meta/cloud/sync';
import { defaultProfile, PROFILE_VERSION, type Profile, sanitizeProfile } from '../src/meta/profile';

/** A request the fake server received. */
export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  keepalive: boolean;
  at: number;
}

interface Account {
  id: string;
  username: string;
  password: string;
  profile: Profile;
  version: number;
  runs: RunRequest[];
}

type Reply = Response | 'network' | 'hang';

interface Fault {
  method: string;
  path: string;
  times: number;
  respond: (call: RecordedCall) => Reply;
}

/** A Response stand-in. Plain promises keep the controller's timing predictable under fake timers. */
export function fakeResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

export function fakeHtml(status: number, html: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

/** A fake of the arcade server's contract routes, with the same version and duplicate-run rules. */
export class FakeCloud {
  readonly calls: RecordedCall[] = [];
  readonly leaderboards = new Map<string, LeaderboardEntry[]>();
  /** When true, every request fails as if the network were down. */
  networkDown = false;
  private readonly accounts = new Map<string, Account>();
  private sessionUserId: string | null = null;
  private readonly faults: Fault[] = [];
  private seq = 0;

  addAccount(username: string, password: string, profile: Profile, version = 1): void {
    this.accounts.set(username, { id: `u-${++this.seq}`, username, password, profile, version, runs: [] });
  }

  account(username: string): Account {
    const acc = this.accounts.get(username);
    if (!acc) throw new Error(`no account ${username}`);
    return acc;
  }

  /** Makes the fake browser hold this account's session cookie, as a previous sign-in would have. */
  cookieFor(username: string): void {
    this.sessionUserId = this.account(username).id;
  }

  /** Another device saved a newer copy of the profile. */
  remoteSave(username: string, profile: Profile): void {
    const acc = this.account(username);
    acc.profile = profile;
    acc.version += 1;
  }

  /** Stores a run as the server would, without replying. Used to simulate a lost reply. */
  recordRun(username: string, run: RunRequest): void {
    this.account(username).runs.push(run);
  }

  /** Answers the next `times` matching requests with what `respond` returns. */
  inject(method: string, path: string, times: number, respond: (call: RecordedCall) => Reply): void {
    this.faults.push({ method, path, times, respond });
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = input.replace(/^\.\/api\//, '');
    const body: unknown = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: RecordedCall = { method, path, body, keepalive: init.keepalive === true, at: Date.now() };
    this.calls.push(call);
    if (this.networkDown) throw new TypeError('Failed to fetch');
    const fault = this.faults.find((f) => f.times > 0 && f.method === method && f.path === path);
    let reply: Reply;
    if (fault) {
      fault.times -= 1;
      reply = fault.respond(call);
    } else {
      reply = this.route(call);
    }
    if (reply === 'network') throw new TypeError('Failed to fetch');
    if (reply === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    return reply;
  };

  private current(): Account | undefined {
    for (const acc of this.accounts.values()) if (acc.id === this.sessionUserId) return acc;
    return undefined;
  }

  private publicUser(acc: Account): PublicUser {
    return { id: acc.id, username: acc.username, createdAt: 1000 };
  }

  private accountBody(acc: Account): AccountResponse {
    return { user: this.publicUser(acc), profile: acc.profile, version: acc.version };
  }

  private route(call: RecordedCall): Response {
    const { method, path, body } = call;
    if (method === 'GET' && path === 'session') {
      const acc = this.current();
      return fakeResponse(200, { user: acc ? this.publicUser(acc) : null });
    }
    if (method === 'POST' && path === 'login') {
      const c = body as Credentials;
      const acc = this.accounts.get(c.username);
      if (!acc || acc.password !== c.password) {
        return fakeResponse(401, { error: 'invalid_credentials', message: 'Wrong username or password.' });
      }
      this.sessionUserId = acc.id;
      return fakeResponse(200, this.accountBody(acc));
    }
    if (method === 'POST' && path === 'register') {
      const c = body as Credentials;
      if (this.accounts.has(c.username)) {
        return fakeResponse(409, { error: 'username_taken', message: 'Taken.' });
      }
      this.addAccount(c.username, c.password, defaultProfile(1000));
      const acc = this.account(c.username);
      this.sessionUserId = acc.id;
      return fakeResponse(200, this.accountBody(acc));
    }
    const acc = this.current();
    if (!acc) return fakeResponse(401, { error: 'unauthorized', message: 'Sign in first.' });
    if (method === 'GET' && path === 'profile') return fakeResponse(200, this.accountBody(acc));
    if (method === 'PUT' && path === 'profile') {
      const req = body as SaveProfileRequest;
      if (req.baseVersion !== acc.version) {
        return fakeResponse(409, { error: 'version_conflict', message: 'Stale.', version: acc.version });
      }
      acc.version += 1;
      acc.profile = req.profile;
      return fakeResponse(200, { version: acc.version, savedAt: Date.now() });
    }
    if (method === 'POST' && path === 'runs') {
      const run = body as RunRequest;
      const duplicate = acc.runs.some((r) => r.clientRunId === run.clientRunId);
      if (!duplicate) acc.runs.push(run);
      return fakeResponse(200, { id: `run-${acc.runs.length}`, duplicate, createdAt: Date.now() });
    }
    if (method === 'GET' && path.startsWith('leaderboard/')) {
      const gameId = path.slice('leaderboard/'.length);
      return fakeResponse(200, { gameId, entries: this.leaderboards.get(gameId) ?? [] });
    }
    return fakeResponse(404, { error: 'not_found', message: 'No such route.' });
  }
}

/** Profile with some progress. `plays` lands on the runner game. */
export function profileWith(opts: { coins?: number; plays?: number }): Profile {
  const p = defaultProfile(1000);
  if (opts.coins !== undefined) p.coins = opts.coins;
  if (opts.plays !== undefined) p.games.runner.plays = opts.plays;
  return p;
}

/** A store, an arcade and a controller wired to a fake cloud, sharing one storage backend. */
export function harness(opts: {
  cloud: FakeCloud;
  backend?: MemoryBackend;
  online?: () => boolean;
  ask?: (choice: ProgressChoice) => Promise<ProgressAnswer>;
}) {
  // The controller's default API uses the global fetch, so every harness routes it to the fake server.
  vi.stubGlobal('fetch', opts.cloud.fetch);
  const backend = opts.backend ?? new MemoryBackend();
  const store = new PersistentStore<Profile>({
    key: 'neon-arcade:profile',
    version: PROFILE_VERSION,
    backend,
    defaults: () => defaultProfile(1000),
    sanitize: sanitizeProfile,
  });
  const arcade = new ArcadeService(store, GAMES, () => new Date(2026, 9, 9, 12));
  const asked: ProgressChoice[] = [];
  const notices: CloudNotice[] = [];
  let ids = 0;
  const env: Partial<CloudEnv> = {
    win: new EventTarget(),
    doc: new EventTarget(),
    isOnline: () => (opts.online ? opts.online() : true),
    isHidden: () => false,
    storage: backend,
    now: () => Date.now(),
    newId: () => `run-id-${++ids}`,
  };
  const sync = new CloudSync({
    store,
    events: arcade,
    ask: async (choice) => {
      asked.push(choice);
      return opts.ask ? opts.ask(choice) : 'account';
    },
    notify: (n) => notices.push(n),
    env,
  });
  return { backend, store, arcade, sync, asked, notices, env };
}

export type Harness = ReturnType<typeof harness>;

/** Finishes one run through the real arcade service, which emits the event the controller listens to. */
export function finishRun(arcade: ArcadeService, score = 500, coins = 10): void {
  const ticket = arcade.startRun('runner');
  arcade.finishRun(ticket, { score, coins, stats: { distance: 120 }, durationSec: 30 });
}

export function callsTo(cloud: FakeCloud, method: string, path: string): RecordedCall[] {
  return cloud.calls.filter((c) => c.method === method && c.path === path);
}
