import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Emits sw.js with a precache manifest of every built asset, versioned by content. */
function serviceWorker(): Plugin {
  return {
    name: 'neon-arcade-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicDir = 'public';
      const publicFiles = listFiles(publicDir).map((f) => relative(publicDir, f).split('\\').join('/'));
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [...new Set([...built, ...publicFiles])].filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const name of built) {
        const chunk = bundle[name];
        if (!chunk) continue;
        hash.update(name);
        hash.update(
          chunk.type === 'chunk'
            ? chunk.code
            : typeof chunk.source === 'string'
              ? chunk.source
              : Buffer.from(chunk.source),
        );
      }
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
      const precache = ['./', ...files.map((f) => `./${f}`)];
      const template = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8');
      const source = template
        .replace('__VERSION__', version)
        .replace('/* __PRECACHE__ */ []', JSON.stringify(precache, null, 2));
      if (source.includes('__PRECACHE__') || source.includes('__VERSION__'))
        this.error('sw-template placeholders were not replaced');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build can be hosted from any sub-path (GitHub Pages, CDN folders, …).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    // Maps are generated for error-tracking uploads but not referenced from the shipped bundle.
    sourcemap: 'hidden',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
