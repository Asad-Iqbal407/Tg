import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { MongoRepository } from '../../server/db/mongo';
import { repositoryContract } from './repository.contract';

/**
 * Runs the repository contract against a real MongoDB (Atlas). It is skipped unless MONGODB_TEST_URI is
 * set, so the default test run never needs a database. The test creates a fresh database with a random
 * name and drops it at the end. Use a dedicated test cluster or a throwaway database user.
 */
const uri = process.env.MONGODB_TEST_URI;
const dbName = `neon_arcade_test_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

describe.skipIf(!uri)('MongoRepository against MongoDB', () => {
  let repo: MongoRepository | undefined;

  beforeAll(async () => {
    repo = await MongoRepository.connect(uri ?? '', dbName);
    await repo.ensureIndexes();
  });

  afterAll(async () => {
    await repo?.close();
    const client = new MongoClient(uri ?? '');
    try {
      await client.db(dbName).dropDatabase();
    } finally {
      await client.close();
    }
  });

  repositoryContract('MongoRepository', async () => {
    if (!repo) throw new Error('MongoRepository was not connected.');
    return repo;
  });
});
