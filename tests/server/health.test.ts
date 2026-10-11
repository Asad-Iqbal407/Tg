import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../../server/db/memory';
import { type TestServer, send, startServer } from './helpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

class PingableRepository extends MemoryRepository {
  constructor(private readonly up: boolean) {
    super();
  }

  override async ping(): Promise<boolean> {
    return this.up;
  }
}

describe('GET /api/health', () => {
  it('reports not-configured with 200 in memory mode', async () => {
    server = await startServer({ config: { dataStore: 'memory' } });
    const reply = await send(server, 'GET', '/api/health');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, database: 'not-configured' });
  });

  it('reports the database as up with 200 when the ping succeeds', async () => {
    server = await startServer({ config: { dataStore: 'mongo' }, repo: new PingableRepository(true) });
    const reply = await send(server, 'GET', '/api/health');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, database: 'up' });
  });

  it('reports the database as down with 503 when the ping fails', async () => {
    server = await startServer({ config: { dataStore: 'mongo' }, repo: new PingableRepository(false) });
    const reply = await send(server, 'GET', '/api/health');
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ ok: false, database: 'down' });
  });
});
