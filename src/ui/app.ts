import type { AudioEngine, MusicTheme, SfxName } from '../core/audio';
import { getGame } from '../games/registry';
import type { BoostId, GameId } from '../games/types';
import type { ArcadeService } from '../meta/arcade';
import { type CloudNotice, CloudSync } from '../meta/cloud/sync';
import { levelInfo } from '../meta/progression';
import type { Profile, Settings } from '../meta/profile';
import { clear, compact, fmt, h, prefersReducedMotion } from './dom';
import { icon, type IconName } from './icons';
import { openLobby } from './lobby';
import { Toaster } from './overlay';
import { PlayScreen } from './play';
import { askProgressChoice } from './screens/account';
import { achievementsScreen } from './screens/achievements';
import { homeScreen } from './screens/home';
import { leaderboardScreen } from './screens/leaderboard';
import { missionsScreen } from './screens/missions';
import { profileScreen } from './screens/profile';
import { settingsScreen } from './screens/settings';
import { shopScreen } from './screens/shop';

export interface Screen {
  el: HTMLElement;
  destroy?(): void;
}

type ScreenFactory = (app: App, params: string[]) => Screen;

const ROUTES: Record<string, { factory: ScreenFactory; title: string }> = {
  '': { factory: homeScreen, title: 'Arcade' },
  missions: { factory: missionsScreen, title: 'Missions' },
  shop: { factory: shopScreen, title: 'Shop' },
  achievements: { factory: achievementsScreen, title: 'Awards' },
  leaderboard: { factory: leaderboardScreen, title: 'Hall of Fame' },
  profile: { factory: profileScreen, title: 'Profile' },
  settings: { factory: settingsScreen, title: 'Settings' },
};

const NAV: { route: string; label: string; icon: IconName; badge?: 'missions' }[] = [
  { route: '', label: 'Arcade', icon: 'home' },
  { route: 'missions', label: 'Missions', icon: 'target', badge: 'missions' },
  { route: 'shop', label: 'Shop', icon: 'cart' },
  { route: 'achievements', label: 'Awards', icon: 'trophy' },
  { route: 'leaderboard', label: 'Ranks', icon: 'chart' },
  { route: 'profile', label: 'Profile', icon: 'user' },
];

const MENU_MUSIC: MusicTheme = {
  bpm: 92,
  root: 57,
  scale: 'pentatonic',
  progression: [0, 4, 2, 3],
  seed: 7,
  lead: 'triangle',
};

export class App {
  readonly toaster: Toaster;
  readonly overlayHost: HTMLElement;
  /** Account sync. Idle for guests; see src/meta/cloud/sync.ts. */
  readonly cloud: CloudSync;
  private readonly header: HTMLElement;
  private readonly main: HTMLElement;
  private readonly nav: HTMLElement;
  private screen: Screen | null = null;
  private play: PlayScreen | null = null;
  private pendingBoosts: { gameId: GameId; boosts: BoostId[] } | null = null;
  private pendingLobby: GameId | null = null;
  private readonly hud: {
    level: HTMLElement;
    ring: HTMLElement;
    xp: HTMLElement;
    coins: HTMLElement;
    gems: HTMLElement;
    name: HTMLElement;
    daily: HTMLElement;
  };
  private readonly navBadges = new Map<string, HTMLElement>();
  private readonly navLinks = new Map<string, HTMLAnchorElement>();
  private menuMusic = false;

  constructor(
    root: HTMLElement,
    readonly arcade: ArcadeService,
    readonly audio: AudioEngine,
  ) {
    clear(root);
    this.hud = {
      level: h('span', { class: 'player-chip__level' }),
      ring: h('span', { class: 'player-chip__ring' }),
      xp: h('span', { class: 'xpbar__fill' }),
      coins: h('span', { class: 'currency__value' }),
      gems: h('span', { class: 'currency__value' }),
      name: h('span', { class: 'player-chip__name' }),
      daily: h('span', { class: 'dot', attrs: { hidden: true } }),
    };
    this.header = this.buildHeader();
    this.main = h('main', { class: 'main', attrs: { id: 'main', tabindex: '-1' } });
    this.nav = this.buildNav();
    this.overlayHost = h('div', { class: 'overlay-host' });
    root.append(
      h('a', {
        class: 'skip-link',
        text: 'Skip to content',
        attrs: { href: '#main' },
        on: {
          click: (e) => {
            e.preventDefault();
            this.main.focus();
          },
        },
      }),
      this.header,
      this.main,
      this.nav,
      this.overlayHost,
    );
    this.toaster = new Toaster(root);
    this.cloud = new CloudSync({
      store: arcade.store,
      events: arcade,
      ask: (choice) => askProgressChoice(this.overlayHost, choice),
      notify: (notice) => this.cloudNotice(notice),
    });
  }

  start(): void {
    this.applySettings(this.settings);
    this.arcade.store.subscribe(() => this.refreshHud());
    this.cloud.start();
    this.arcade.on((e) => {
      switch (e.type) {
        case 'achievement':
          this.toaster.show({
            title: `Achievement: ${e.def.name}`,
            body: `+${fmt(e.def.reward.coins)} coins${e.def.reward.gems ? ` · +${e.def.reward.gems} gems` : ''}`,
            icon: 'trophy',
            tone: 'gold',
            ms: 4500,
          });
          this.sfx('reward');
          break;
        case 'level-up':
          this.toaster.show({
            title: `Level ${e.reward.level}!`,
            body: `+${fmt(e.reward.coins)} coins · +${e.reward.gems} gem${e.reward.gems > 1 ? 's' : ''}`,
            icon: 'star',
            tone: 'success',
            ms: 4500,
          });
          this.sfx('levelup');
          break;
        case 'mission-complete':
          this.toaster.show({
            title: 'Mission complete!',
            body: `${e.mission.label} — claim your reward`,
            icon: 'target',
            tone: 'success',
          });
          break;
        default:
          break;
      }
    });
    window.addEventListener('hashchange', () => this.route());
    const unlock = () => {
      this.audio.unlock();
      if (!this.play) this.startMenuMusic();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    setInterval(() => {
      this.arcade.ensureMissions();
      this.refreshHud();
    }, 60_000);
    this.refreshHud();
    this.route();
  }

  get settings(): Settings {
    return this.arcade.profile.settings;
  }

  get reducedMotion(): boolean {
    return this.settings.reducedMotion || prefersReducedMotion();
  }

  sfx(name: SfxName): void {
    this.audio.play(name);
  }

  haptic(ms: number): void {
    if (this.settings.haptics && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* unsupported */
      }
    }
  }

  updateSettings(patch: Partial<Settings>): void {
    this.arcade.updateSettings(patch);
    this.applySettings(this.settings);
  }

  private applySettings(s: Settings): void {
    this.audio.setVolumes(s);
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
  }

  navigate(path: string): void {
    const target = `#/${path}`;
    if (location.hash === target) this.route();
    else location.hash = target;
  }

  /** Called by the lobby: start a run with the chosen boosts. */
  launch(gameId: GameId, boosts: BoostId[]): void {
    this.pendingBoosts = { gameId, boosts };
    this.navigate(`play/${gameId}`);
  }

  openLobby(gameId: GameId): void {
    const def = getGame(gameId);
    if (def) openLobby(this, def);
  }

  /** Navigate home, then open the lobby once the route has rendered. */
  returnToLobby(gameId: GameId): void {
    this.pendingLobby = gameId;
    this.navigate('');
  }

  takePendingBoosts(gameId: GameId): BoostId[] {
    const p = this.pendingBoosts;
    this.pendingBoosts = null;
    return p && p.gameId === gameId ? p.boosts : [];
  }

  private cloudNotice(notice: CloudNotice): void {
    if (notice.kind === 'refreshed') {
      this.toaster.show({
        title: 'Progress updated',
        body: 'Your account has newer progress from another device, so this device now matches it.',
        icon: 'sparkle',
        tone: 'info',
        ms: 5000,
      });
    } else {
      this.toaster.show({
        title: 'Signed out',
        body: 'Your session ended. Sign in again to keep syncing.',
        icon: 'user',
        tone: 'error',
        ms: 5000,
      });
    }
  }

  private startMenuMusic(): void {
    if (this.menuMusic) return;
    this.menuMusic = true;
    this.audio.startMusic(MENU_MUSIC);
  }

  private stopMenuMusic(): void {
    if (!this.menuMusic) return;
    this.menuMusic = false;
    this.audio.stopMusic();
  }

  private route(): void {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    const head = parts[0] ?? '';

    this.screen?.destroy?.();
    this.screen = null;
    if (this.play) {
      this.play.destroy();
      this.play = null;
    }
    clear(this.main);
    clear(this.overlayHost);

    if (head === 'play') {
      const def = getGame(parts[1] ?? '');
      if (!def) {
        this.navigate('');
        return;
      }
      this.stopMenuMusic();
      document.body.classList.add('is-playing');
      document.title = `${def.title} · Neon Arcade`;
      this.play = new PlayScreen(this, def, this.takePendingBoosts(def.id));
      this.main.appendChild(this.play.el);
      this.play.start();
      return;
    }

    document.body.classList.remove('is-playing');
    const route = ROUTES[head] ?? ROUTES[''];
    if (!route) return;
    if (this.audio.unlocked) this.startMenuMusic();
    this.screen = route.factory(this, parts.slice(1));
    this.main.appendChild(this.screen.el);
    document.title = head ? `${route.title} · Neon Arcade` : 'Neon Arcade';
    for (const [r, a] of this.navLinks) {
      if (r === (ROUTES[head] ? head : '')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    window.scrollTo({ top: 0 });
    if (this.pendingLobby) {
      const id = this.pendingLobby;
      this.pendingLobby = null;
      this.openLobby(id);
    }
  }

  private buildHeader(): HTMLElement {
    const s = this.hud;
    return h(
      'header',
      { class: 'topbar' },
      h(
        'a',
        { class: 'brand', attrs: { href: '#/', 'aria-label': 'Neon Arcade home' } },
        h('span', { class: 'brand__mark' }, icon('sparkle')),
        h('span', { class: 'brand__name', text: 'Neon Arcade' }),
      ),
      h(
        'a',
        { class: 'player-chip', attrs: { href: '#/profile', 'aria-label': 'Your profile' } },
        h('span', { class: 'player-chip__avatar' }, s.ring, s.level),
        h('span', { class: 'player-chip__meta' }, s.name, h('span', { class: 'xpbar' }, s.xp)),
      ),
      h(
        'div',
        { class: 'currencies' },
        h(
          'a',
          { class: 'currency currency--coins', attrs: { href: '#/shop', 'aria-label': 'Coins' } },
          icon('coin', 'icon icon--coin'),
          s.coins,
        ),
        h(
          'a',
          { class: 'currency currency--gems', attrs: { href: '#/shop', 'aria-label': 'Gems' } },
          icon('gem', 'icon icon--gem'),
          s.gems,
        ),
        h(
          'a',
          { class: 'icon-btn topbar__daily', attrs: { href: '#/missions', 'aria-label': 'Daily reward' } },
          icon('gift'),
          s.daily,
        ),
        h(
          'a',
          { class: 'icon-btn', attrs: { href: '#/settings', 'aria-label': 'Settings' } },
          icon('settings'),
        ),
      ),
    );
  }

  private buildNav(): HTMLElement {
    const nav = h('nav', { class: 'tabbar', attrs: { 'aria-label': 'Main' } });
    for (const item of NAV) {
      const badge = h('span', { class: 'tabbar__badge', attrs: { hidden: true } });
      const a = h(
        'a',
        { class: 'tabbar__link', attrs: { href: `#/${item.route}` } },
        icon(item.icon),
        h('span', { text: item.label }),
        item.badge ? badge : null,
      );
      if (item.badge) this.navBadges.set(item.badge, badge);
      this.navLinks.set(item.route, a);
      nav.appendChild(a);
    }
    return nav;
  }

  refreshHud(): void {
    const p: Profile = this.arcade.profile;
    const info = levelInfo(p.xp);
    this.hud.level.textContent = String(info.level);
    this.hud.ring.style.setProperty('--p', String(info.progress));
    this.hud.xp.style.width = `${Math.round(info.progress * 100)}%`;
    this.hud.coins.textContent = compact(p.coins);
    this.hud.gems.textContent = compact(p.gems);
    this.hud.name.textContent = p.name;
    const pending = this.arcade.pendingCounts();
    this.hud.daily.hidden = pending.daily === 0;
    const mb = this.navBadges.get('missions');
    if (mb) {
      const n = pending.missions + pending.daily;
      mb.hidden = n === 0;
      mb.textContent = String(n);
    }
  }
}
