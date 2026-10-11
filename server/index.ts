// Entry point: `tsx watch server/index.ts` in development, `node dist-server/server/index.js` in production.
//
// The resolve hook must be registered before any server module is loaded, because module specifiers are
// resolved before a module runs. This file therefore has no relative imports of its own and loads the
// application with a dynamic import after registering the hook.
import { register } from 'node:module';

register('./loader.js', import.meta.url);

try {
  const { run } = await import('./main');
  await run();
} catch (error) {
  // Configuration errors already list every problem and never include a secret value.
  const message =
    error instanceof Error
      ? error.name === 'ConfigError'
        ? error.message
        : `${error.name}: ${error.message}`
      : 'Unknown startup error.';
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
