import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppOptions } from '../../server/app';
import type { Config } from '../../server/config';
import { MemoryRepository } from '../../server/db/memory';
import type { RateLimitOptions } from '../../server/http/rate-limit';

export const APP_ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    dataStore: 'memory',
    mongoUri: null,
    mongoDb: 'neon_arcade_test',
    appOrigin: APP_ORIGIN,
    cookieSecure: false,
    trustProxy: false,
    ...overrides,
  };
}

export interface TestServer {
  url: string;
  repo: MemoryRepository;
  /** Mutable clock in epoch milliseconds. Advance it to test expiry and windows. */
  clock: { now: number };
  logs: string[];
  close(): Promise<void>;
}

export interface StartOptions {
  config?: Partial<Config>;
  rateLimit?: RateLimitOptions;
  repo?: MemoryRepository;
  now?: number;
}

/** Starts the app on an ephemeral port with an in-memory repository and a controllable clock. */
export async function startServer(options: StartOptions = {}): Promise<TestServer> {
  const repo = options.repo ?? new MemoryRepository();
  const clock = { now: options.now ?? Date.UTC(2026, 0, 15, 12) };
  const logs: string[] = [];
  const appOptions: AppOptions = {
    config: testConfig(options.config),
    repo,
    now: () => clock.now,
    log: (line) => logs.push(line),
    rateLimit: options.rateLimit,
  };
  const app = createApp(appOptions);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    repo,
    clock,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface SendOptions {
  body?: unknown;
  /** Sent as the raw request body instead of JSON-encoding `body`. */
  raw?: string;
  /** Defaults to application/json for state-changing methods. Pass null to omit the header. */
  contentType?: string | null;
  /** Defaults to the app origin for state-changing methods, as a browser sends it. Pass null to omit. */
  origin?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- replies are read field by field in each test
export type Json = any;

export interface Reply {
  status: number;
  headers: Headers;
  body: Json;
  text: string;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE']);

/** One request to the test server. Mimics a browser: state-changing calls carry JSON type and origin. */
export async function send(
  server: TestServer,
  method: string,
  path: string,
  options: SendOptions = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  const stateChanging = STATE_CHANGING.has(method);
  let payload: string | undefined = options.raw;
  if (payload === undefined && stateChanging) payload = JSON.stringify(options.body ?? {});
  if (payload === undefined && options.body !== undefined) payload = JSON.stringify(options.body);

  const contentType =
    options.contentType === undefined ? (stateChanging ? 'application/json' : null) : options.contentType;
  if (contentType !== null) headers['Content-Type'] = contentType;
  const origin = options.origin === undefined ? (stateChanging ? APP_ORIGIN : null) : options.origin;
  if (origin !== null) headers.Origin = origin;
  if (options.cookie) headers.Cookie = options.cookie;

  const response = await fetch(`${server.url}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let body: Json = text;
  if (response.headers.get('content-type')?.includes('application/json')) body = JSON.parse(text);
  return { status: response.status, headers: response.headers, body, text };
}

/** The `na_session=...` pair from a reply's Set-Cookie, ready to send back as a Cookie header. */
export function sessionCookie(reply: Reply): string | undefined {
  for (const line of reply.headers.getSetCookie()) {
    const pair = line.split(';')[0] ?? '';
    if (pair.startsWith('na_session=') && pair.length > 'na_session='.length) return pair;
  }
  return undefined;
}

/** Registers a user and returns the session cookie plus the reply. */
export async function register(
  server: TestServer,
  username = 'alice_01',
  password = PASSWORD,
): Promise<{ cookie: string; reply: Reply }> {
  const reply = await send(server, 'POST', '/api/register', { body: { username, password } });
  const cookie = sessionCookie(reply);
  if (!cookie) throw new Error(`register failed: ${reply.status} ${reply.text}`);
  return { cookie, reply };
}
