import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { MemoryRepository } from './db/memory';
import { MongoRepository } from './db/mongo';
import type { Repository } from './db/repository';
import { writeLine } from './http/logging';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Starts the API and returns once it is listening. Shutdown is handled on SIGTERM and SIGINT. */
export async function run(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();
  const repo = await connectRepository(config);
  await repo.ensureIndexes();

  const app = createApp({ config, repo, log: writeLine });
  const server = createServer(app);
  server.once('error', (error: Error) => {
    process.stderr.write(`Could not listen on ${config.host}:${config.port}: ${error.message}\n`);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    writeLine(`neon-arcade API listening on port ${config.port} (data store: ${config.dataStore})`);
  });

  let stopping: Promise<void> | undefined;
  const stop = (signal: string): void => {
    stopping ??= (async () => {
      writeLine(`Received ${signal}, shutting down.`);
      setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        server.closeAllConnections();
      });
      await repo.close();
    })();
    stopping.then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(
          `Shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
        );
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

async function connectRepository(config: ReturnType<typeof loadConfig>): Promise<Repository> {
  if (config.dataStore === 'memory') return new MemoryRepository();
  if (config.mongoUri === null) throw new ConfigError(['MONGODB_URI is required unless DATA_STORE=memory.']);
  return MongoRepository.connect(config.mongoUri, config.mongoDb);
}

/**
 * Reads .env from the working directory for local runs. Variables already set in the environment win.
 * Production never reads the file, so a stray copy inside an image cannot change its configuration.
 */
function loadLocalEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (existsSync('.env')) process.loadEnvFile('.env');
}
