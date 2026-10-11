import { describe, expect, it } from 'vitest';
import { resolve } from '../../server/loader';

/** Stands in for Node's resolver: only files that exist with their full name resolve. */
function fakeNext(files: string[]) {
  return async (specifier: string) => {
    if (files.includes(specifier)) return { url: `file:///dist/${specifier}` };
    throw Object.assign(new Error(`Cannot find module ${specifier}`), { code: 'ERR_MODULE_NOT_FOUND' });
  };
}

const context = { parentURL: 'file:///dist/src/meta/profile.js' };

describe('resolve hook', () => {
  it('retries an extensionless relative specifier with .js', async () => {
    const next = fakeNext(['../core/storage.js']);
    expect(await resolve('../core/storage', context, next)).toEqual({
      url: 'file:///dist/../core/storage.js',
    });
  });

  it('leaves specifiers that already resolve, and packages, untouched', async () => {
    const seen: string[] = [];
    const next = async (specifier: string) => {
      seen.push(specifier);
      return { url: `file:///x/${specifier}` };
    };
    await resolve('./catalog.js', context, next);
    await resolve('express', context, next);
    expect(seen).toEqual(['./catalog.js', 'express']);
  });

  it('rethrows the original error when the retry does not help', async () => {
    const next = fakeNext([]);
    await expect(resolve('./missing', context, next)).rejects.toThrow('Cannot find module ./missing');
  });
});
