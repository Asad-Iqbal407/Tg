import './styles/main.css';
import { AudioEngine } from './core/audio';
import { browserBackend, PersistentStore } from './core/storage';
import { GAMES } from './games/registry';
import { ArcadeService } from './meta/arcade';
import { defaultProfile, type Profile, PROFILE_VERSION, sanitizeProfile } from './meta/profile';
import { App } from './ui/app';

const STORAGE_KEY = 'neon-arcade:profile';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  const store = new PersistentStore<Profile>({
    key: STORAGE_KEY,
    version: PROFILE_VERSION,
    backend: browserBackend(),
    defaults: () => defaultProfile(),
    sanitize: sanitizeProfile,
  });
  const audio = new AudioEngine();
  const arcade = new ArcadeService(store, GAMES);
  const app = new App(root, arcade, audio);
  app.start();

  // Persist pending writes when the page is hidden or closed.
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });
  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      store.reload();
      app.refreshHud();
    }
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .catch((err: unknown) => console.warn('Service worker registration failed', err));
    });
  }
}

try {
  boot();
} catch (err) {
  console.error(err);
  const root = document.getElementById('app');
  if (root) {
    root.textContent = '';
    const msg = document.createElement('div');
    msg.className = 'fatal';
    msg.textContent =
      'Sorry — Neon Arcade failed to start. Please reload the page or try a different browser.';
    root.appendChild(msg);
  }
}
