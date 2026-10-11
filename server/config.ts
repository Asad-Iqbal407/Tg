import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const DATA_STORES = ['mongo', 'memory'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type DataStore = (typeof DATA_STORES)[number];

export interface Config {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  dataStore: DataStore;
  /** Connection string. Never print it, log it or include it in an error message. */
  mongoUri: string | null;
  mongoDb: string;
  /** Exact origin of the browser app, for example https://arcade.example.com. */
  appOrigin: string;
  cookieSecure: boolean;
  trustProxy: boolean;
}

/** Thrown for invalid environment. The message lists every problem and never echoes a value. */
export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(['Invalid configuration:', ...problems.map((p) => `  - ${p}`)].join('\n'));
    this.name = 'ConfigError';
  }
}

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';
const DEFAULT_DB = 'neon_arcade';

const PORT_MESSAGE = 'PORT must be a whole number from 1 to 65535.';
const BOOLEAN_VALUES = ['true', 'false', '1', '0'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS, { error: 'NODE_ENV must be development, test or production.' }).optional(),
  PORT: z
    .string({ error: PORT_MESSAGE })
    .regex(/^\d{1,5}$/, { error: PORT_MESSAGE })
    .optional(),
  HOST: z.string({ error: 'HOST must be a string.' }).optional(),
  DATA_STORE: z.enum(DATA_STORES, { error: 'DATA_STORE must be mongo or memory.' }).optional(),
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI must be a string.' })
    .regex(/^mongodb(\+srv)?:\/\//, { error: 'MONGODB_URI must start with mongodb:// or mongodb+srv://.' })
    .optional(),
  MONGODB_DB: z
    .string({ error: 'MONGODB_DB must be a string.' })
    .regex(/^[A-Za-z0-9_-]{1,63}$/, {
      error: 'MONGODB_DB must be 1 to 63 letters, digits, underscores or hyphens.',
    })
    .optional(),
  APP_ORIGIN: z.string({ error: 'APP_ORIGIN must be a string.' }).optional(),
  COOKIE_SECURE: z.enum(BOOLEAN_VALUES, { error: 'COOKIE_SECURE must be true or false.' }).optional(),
  TRUST_PROXY: z.enum(BOOLEAN_VALUES, { error: 'TRUST_PROXY must be true or false.' }).optional(),
});

const ENV_KEYS = Object.keys(envSchema.shape);

/** Accepts an origin only: scheme, host and optional port. A trailing slash is allowed. */
export function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const httpScheme = url.protocol === 'http:' || url.protocol === 'https:';
  const bare = (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash;
  const anonymous = !url.username && !url.password;
  return httpScheme && bare && anonymous ? url.origin : null;
}

/** Reads and validates configuration. Throws ConfigError listing every problem found. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const picked: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== '') picked[key] = value;
  }

  const parsed = envSchema.safeParse(picked);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((issue) => issue.message));

  const env = parsed.data;
  const nodeEnv: NodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const dataStore: DataStore = env.DATA_STORE ?? 'mongo';
  const problems: string[] = [];

  if (dataStore === 'memory' && production) {
    problems.push('DATA_STORE=memory is not allowed when NODE_ENV=production.');
  }
  if (dataStore === 'mongo' && !env.MONGODB_URI) {
    problems.push('MONGODB_URI is required unless DATA_STORE=memory.');
  }
  const port = env.PORT === undefined ? DEFAULT_PORT : Number(env.PORT);
  if (port < 1 || port > 65535) problems.push(PORT_MESSAGE);

  let appOrigin = DEFAULT_DEV_ORIGIN;
  if (env.APP_ORIGIN !== undefined) {
    const origin = parseOrigin(env.APP_ORIGIN);
    if (origin) appOrigin = origin;
    else problems.push('APP_ORIGIN must be an origin such as https://arcade.example.com, with no path.');
  } else if (production) {
    problems.push('APP_ORIGIN is required when NODE_ENV=production.');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    host: env.HOST ?? DEFAULT_HOST,
    port,
    dataStore,
    mongoUri: env.MONGODB_URI ?? null,
    mongoDb: env.MONGODB_DB ?? DEFAULT_DB,
    appOrigin,
    cookieSecure: env.COOKIE_SECURE === undefined ? production : isTrue(env.COOKIE_SECURE),
    trustProxy: env.TRUST_PROXY === undefined ? production : isTrue(env.TRUST_PROXY),
  };
}

function isTrue(value: (typeof BOOLEAN_VALUES)[number]): boolean {
  return value === 'true' || value === '1';
}
