import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseOrigin } from '../../server/config';

// Assembled from parts so no file in the repository holds a connection string with a password in it.
const SECRET_URI = [
  'mongodb+srv://',
  'app_user',
  ':',
  'fake-secret-value',
  '@cluster.example.net/?retryWrites=true',
].join('');

function expectProblem(env: Record<string, string>, fragment: string): void {
  let caught: unknown;
  try {
    loadConfig(env);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  expect((caught as Error).message).toContain(fragment);
}

describe('loadConfig', () => {
  it('uses development defaults when only the memory store is chosen', () => {
    const config = loadConfig({ DATA_STORE: 'memory' });
    expect(config).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 8787,
      dataStore: 'memory',
      mongoUri: null,
      mongoDb: 'neon_arcade',
      appOrigin: 'http://localhost:5173',
      cookieSecure: false,
      trustProxy: false,
    });
  });

  it('reads a full production configuration and turns on the production defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '9000',
      HOST: '127.0.0.1',
      MONGODB_URI: SECRET_URI,
      MONGODB_DB: 'arcade_prod',
      APP_ORIGIN: 'https://arcade.example.com/',
    });
    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dataStore).toBe('mongo');
    expect(config.mongoUri).toBe(SECRET_URI);
    expect(config.mongoDb).toBe('arcade_prod');
    expect(config.appOrigin).toBe('https://arcade.example.com');
    expect(config.cookieSecure).toBe(true);
    expect(config.trustProxy).toBe(true);
  });

  it('lets explicit flags override the production defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      MONGODB_URI: SECRET_URI,
      APP_ORIGIN: 'https://arcade.example.com',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
    });
    expect(config.cookieSecure).toBe(false);
    expect(config.trustProxy).toBe(false);
  });

  it('requires a Mongo URI unless the memory store is chosen', () => {
    expectProblem({}, 'MONGODB_URI is required unless DATA_STORE=memory.');
  });

  it('refuses the memory store in production', () => {
    expectProblem(
      { NODE_ENV: 'production', DATA_STORE: 'memory', APP_ORIGIN: 'https://arcade.example.com' },
      'DATA_STORE=memory is not allowed when NODE_ENV=production.',
    );
  });

  it('requires APP_ORIGIN in production only', () => {
    expectProblem(
      { NODE_ENV: 'production', MONGODB_URI: SECRET_URI },
      'APP_ORIGIN is required when NODE_ENV=production.',
    );
    expect(loadConfig({ DATA_STORE: 'memory' }).appOrigin).toBe('http://localhost:5173');
  });

  it('rejects an APP_ORIGIN that is not a bare origin', () => {
    expectProblem(
      { DATA_STORE: 'memory', APP_ORIGIN: 'https://arcade.example.com/play' },
      'APP_ORIGIN must be',
    );
    expectProblem({ DATA_STORE: 'memory', APP_ORIGIN: 'ftp://arcade.example.com' }, 'APP_ORIGIN must be');
    expectProblem({ DATA_STORE: 'memory', APP_ORIGIN: 'not a url' }, 'APP_ORIGIN must be');
  });

  it('rejects an out-of-range or non-numeric PORT', () => {
    for (const PORT of ['abc', '0', '65536', '99999', '8787.5']) {
      expectProblem({ DATA_STORE: 'memory', PORT }, 'PORT must be a whole number from 1 to 65535.');
    }
  });

  it('rejects a Mongo URI with the wrong scheme', () => {
    expectProblem(
      { MONGODB_URI: 'postgres://user:pw@host/db' },
      'MONGODB_URI must start with mongodb:// or mongodb+srv://.',
    );
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig({ DATA_STORE: 'memory', PORT: '', HOST: '' });
    expect(config.port).toBe(8787);
    expect(config.host).toBe('0.0.0.0');
  });

  it('never echoes a secret value in an error message', () => {
    let message = '';
    try {
      loadConfig({ MONGODB_URI: SECRET_URI.replace('mongodb+srv', 'http'), PORT: 'nope' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('PORT must be');
    expect(message).not.toContain('fake-secret-value');
    expect(message).not.toContain('cluster.example.net');
  });
});

describe('parseOrigin', () => {
  it('accepts scheme, host and port, and normalises a trailing slash', () => {
    expect(parseOrigin('https://arcade.example.com')).toBe('https://arcade.example.com');
    expect(parseOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
  });

  it('rejects paths, queries, fragments and credentials', () => {
    expect(parseOrigin('https://arcade.example.com/x')).toBeNull();
    expect(parseOrigin('https://arcade.example.com?x=1')).toBeNull();
    expect(parseOrigin('https://arcade.example.com#x')).toBeNull();
    expect(parseOrigin('https://user:pw@arcade.example.com')).toBeNull();
  });
});
