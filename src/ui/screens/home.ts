import {
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_OF,
  type Category,
  matchesQuery,
  recentGames,
} from '../../games/categories';
import { GAMES } from '../../games/registry';
import type { GameDefinition } from '../../games/types';
import { ACHIEVEMENTS, unlockedCount } from '../../meta/achievements';
import { getSkin, toSkinData } from '../../meta/catalog';
import { DAILY_REWARDS } from '../../meta/daily';
import { levelInfo, levelUpReward } from '../../meta/progression';
import type { App, Screen } from '../app';
import { compact, fmt, h } from '../dom';
import { icon } from '../icons';
import { drawGamePreview, schedulePreview } from '../previews';
import { openAccountDialog, syncPhaseText } from './account';
import { missionList } from './missions';

const COUNT_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

/** "Ten" for 10: how the hero line counts the games (digits past twelve). */
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** What the games list is showing: everything, the starred games, or one category. */
type Filter = 'all' | 'favorites' | Category;

/** The search and filter, kept across redraws of the screen (claiming the daily reward redraws it). */
interface HomeView {
  filter: Filter;
  query: string;
}

const JUMP_BACK_IN = 4;

export function homeScreen(app: App): Screen {
  const el = h('section', { class: 'screen home' });
  const account = accountCard(app);
  const view: HomeView = { filter: 'all', query: '' };
  const render = () => {
    el.replaceChildren(hero(app, render), gamesSection(app, view), sidePanels(app, render, account.el));
  };
  render();
  account.refresh();
  const unsubscribe = app.cloud.subscribe(() => account.refresh());
  return { el, destroy: unsubscribe };
}

function hero(app: App, rerender: () => void): HTMLElement {
  const status = app.arcade.dailyStatus();
  const reward = app.arcade.dailyReward(status.index);
  const daily = h(
    'div',
    { class: `daily-card ${status.canClaim ? 'is-ready' : ''}` },
    h('div', { class: 'daily-card__icon' }, icon('gift')),
    h(
      'div',
      { class: 'daily-card__text' },
      h('strong', { text: status.canClaim ? 'Daily reward ready!' : 'Daily reward claimed' }),
      h('span', {
        text: status.canClaim
          ? `Day ${status.streak} · ${fmt(reward.coins)} coins${reward.gems ? ` + ${reward.gems} gems` : ''}${reward.boost ? ' + boost' : ''}`
          : `Streak: ${status.streak} day${status.streak === 1 ? '' : 's'} · come back tomorrow`,
      }),
    ),
    status.canClaim
      ? h(
          'button',
          {
            class: 'btn btn--gold',
            attrs: { type: 'button' },
            on: {
              click: () => {
                const res = app.arcade.claimDaily();
                if (res) {
                  app.sfx('reward');
                  app.toaster.show({
                    title: `Day ${res.streak} reward claimed!`,
                    body: `+${fmt(res.reward.coins)} coins${res.reward.gems ? ` · +${res.reward.gems} gems` : ''}${res.reward.boost ? ' · +1 boost' : ''}`,
                    icon: 'gift',
                    tone: 'gold',
                  });
                }
                rerender();
              },
            },
          },
          'Claim',
        )
      : h('a', { class: 'btn btn--ghost', attrs: { href: '#/missions' } }, 'Missions'),
  );
  const week = h('div', { class: 'daily-strip', attrs: { 'aria-hidden': 'true' } });
  const claimedToday = !status.canClaim;
  const pos = claimedToday ? status.index : status.index - 1;
  DAILY_REWARDS.forEach((_, i) => {
    week.appendChild(
      h('span', {
        class: `daily-strip__pip ${i <= pos ? 'is-done' : ''} ${i === status.index && status.canClaim ? 'is-today' : ''}`,
      }),
    );
  });
  daily.appendChild(week);
  return h(
    'div',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero__text' },
      h('h1', { class: 'hero__title' }, 'Neon ', h('span', { class: 'gradient-text', text: 'Arcade' })),
      h('p', {
        class: 'hero__subtitle',
        text: `${countWord(GAMES.length)} classic-inspired games. One shared reward system. Earn coins, level up, unlock skins and climb your Hall of Fame.`,
      }),
    ),
    daily,
  );
}

function gamesSection(app: App, view: HomeView): HTMLElement {
  const root = h('section', { class: 'games' });
  const list = h('div', { class: 'games__list' });
  const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'Filter games' } });

  const search = h('input', {
    class: 'search__input',
    attrs: {
      type: 'search',
      placeholder: 'Search games',
      'aria-label': 'Search games',
      autocomplete: 'off',
      spellcheck: false,
      enterkeyhint: 'search',
    },
    on: {
      input: () => {
        view.query = search.value;
        refresh();
      },
    },
  });
  search.value = view.query;

  const chipDefs = (): { id: Filter; label: string; count: number }[] => {
    const favs = app.arcade.profile.favorites;
    return [
      { id: 'all', label: 'All', count: GAMES.length },
      { id: 'favorites', label: '★ Favourites', count: favs.length },
      ...CATEGORIES.map((c) => ({
        id: c as Filter,
        label: CATEGORY_LABEL[c],
        count: GAMES.filter((g) => CATEGORY_OF[g.id] === c).length,
      })),
    ];
  };
  const renderChips = () => {
    chips.replaceChildren();
    for (const c of chipDefs()) {
      chips.appendChild(
        h(
          'button',
          {
            class: `chip ${view.filter === c.id ? 'is-on' : ''}`,
            attrs: { type: 'button', 'aria-pressed': view.filter === c.id ? 'true' : 'false' },
            on: {
              click: () => {
                app.sfx('click');
                view.filter = c.id;
                refresh();
              },
            },
          },
          c.label,
          h('span', { class: 'chip__count', text: String(c.count) }),
        ),
      );
    }
  };

  /** The games that pass the filter and the search, in the arcade's order (starred games first when starred is chosen). */
  const visible = (): GameDefinition[] => {
    const favs = app.arcade.profile.favorites;
    let games = GAMES.filter((g) => matchesQuery(g, view.query));
    if (view.filter === 'favorites') games = games.filter((g) => favs.includes(g.id));
    else if (view.filter !== 'all') games = games.filter((g) => CATEGORY_OF[g.id] === view.filter);
    return games;
  };

  const refresh = () => {
    renderChips();
    const games = visible();
    const browsing = view.filter === 'all' && view.query.trim() === '';
    list.replaceChildren();
    if (browsing) {
      const recent = recentGames(
        app.arcade.profile.games,
        GAMES.map((g) => g.id),
        JUMP_BACK_IN,
      );
      if (recent.length > 0) {
        const row = h('div', { class: 'game-grid game-grid--recent' });
        for (const id of recent) {
          const def = GAMES.find((g) => g.id === id);
          if (def) row.appendChild(gameCard(app, def, refresh));
        }
        list.append(h('h2', { class: 'section-title', text: 'Jump back in' }), row);
      }
      list.append(h('h2', { class: 'section-title', text: 'All games' }));
    }
    if (games.length === 0) {
      const none =
        view.filter === 'favorites' && view.query.trim() === ''
          ? 'No favourites yet. Tap the star on a game to add it here.'
          : 'No games match that.';
      list.append(
        h(
          'div',
          { class: 'games__empty' },
          h('p', { text: none }),
          h(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  view.filter = 'all';
                  view.query = '';
                  search.value = '';
                  refresh();
                },
              },
            },
            'Show all games',
          ),
        ),
      );
      return;
    }
    const grid = h('div', { class: 'game-grid' });
    for (const def of games) grid.appendChild(gameCard(app, def, refresh));
    list.append(
      grid,
      h('p', {
        class: 'games__count muted small',
        attrs: { 'aria-live': 'polite' },
        text:
          games.length === GAMES.length
            ? `${GAMES.length} games`
            : `${games.length} of ${GAMES.length} games`,
      }),
    );
  };
  refresh();

  root.append(
    h(
      'div',
      { class: 'games__bar' },
      h('h2', { class: 'section-title games__title', text: 'Games' }),
      h('label', { class: 'search' }, search),
    ),
    chips,
    list,
  );
  return root;
}

function gameCard(app: App, def: GameDefinition, onFavorite: () => void): HTMLElement {
  const p = app.arcade.profile;
  const rec = p.games[def.id];
  const art = h('canvas', {
    class: 'game-card__canvas',
    attrs: { width: 480, height: 270, 'aria-hidden': 'true' },
  });
  const skin = getSkin(p.equipped[def.id]);
  if (skin) schedulePreview(() => drawGamePreview(def, toSkinData(skin), art));
  const open = () => {
    app.sfx('click');
    app.openLobby(def.id);
  };
  const starred = app.arcade.isFavorite(def.id);
  const star = h(
    'button',
    {
      class: `game-card__fav ${starred ? 'is-on' : ''}`,
      attrs: {
        type: 'button',
        'aria-pressed': starred ? 'true' : 'false',
        'aria-label': starred ? `Remove ${def.title} from favourites` : `Add ${def.title} to favourites`,
      },
      on: {
        click: () => {
          app.sfx('click');
          app.arcade.toggleFavorite(def.id);
          onFavorite();
        },
      },
    },
    icon('star'),
  );
  const card = h(
    'article',
    { class: 'game-card' },
    h(
      'button',
      {
        class: 'game-card__art',
        attrs: { type: 'button', 'aria-label': `Open ${def.title}` },
        on: { click: open },
      },
      art,
      h('span', { class: 'game-card__play' }, icon('play')),
      h('span', { class: 'pill pill--dark', text: def.genre }),
    ),
    star,
    h(
      'div',
      { class: 'game-card__body' },
      h('h3', { class: 'game-card__title', text: def.title }),
      h('p', { class: 'game-card__tagline', text: def.tagline }),
      h(
        'div',
        { class: 'game-card__meta' },
        h('span', { attrs: { title: 'Best score' } }, icon('trophy'), rec.best > 0 ? compact(rec.best) : '—'),
        h('span', { attrs: { title: 'Plays' } }, icon('restart'), fmt(rec.plays)),
        h(
          'button',
          { class: 'btn btn--primary btn--sm', attrs: { type: 'button' }, on: { click: open } },
          'Play',
        ),
      ),
    ),
  );
  card.style.setProperty('--accent', def.accent);
  card.style.setProperty('--g1', def.gradient[0]);
  card.style.setProperty('--g2', def.gradient[1]);
  return card;
}

interface AccountCard {
  el: HTMLElement;
  refresh(): void;
}

/** The account panel. Built once per screen and updated in place as the sync state changes. */
function accountCard(app: App): AccountCard {
  const body = h('p', { class: 'muted small' });
  const button = h('button', {
    class: 'btn btn--ghost btn--sm',
    attrs: { type: 'button' },
    on: {
      click: () => {
        app.sfx('click');
        openAccountDialog(app);
      },
    },
  });
  const el = h(
    'div',
    { class: 'panel account-card' },
    h('div', { class: 'panel__head' }, h('h3', null, icon('user'), 'Account')),
    body,
    h('div', { class: 'panel__foot' }, button),
  );
  const refresh = () => {
    const s = app.cloud.current;
    switch (s.kind) {
      case 'checking':
        body.textContent = 'Checking your account…';
        button.textContent = 'Account';
        break;
      case 'unavailable':
        body.textContent = 'Your progress is saved on this device. Accounts are unavailable right now.';
        button.textContent = 'Accounts unavailable';
        break;
      case 'guest':
        body.textContent = 'Playing as a guest. Create an account to back up your progress across devices.';
        button.textContent = 'Sign in or create account';
        break;
      case 'account':
        body.textContent = `Signed in as ${s.user.username}. ${syncPhaseText(s.phase)}`;
        button.textContent = 'Manage account';
        break;
    }
  };
  return { el, refresh };
}

function sidePanels(app: App, rerender: () => void, accountEl: HTMLElement): HTMLElement {
  const p = app.arcade.profile;
  const info = levelInfo(p.xp);
  const next = levelUpReward(info.level + 1);
  const unlocked = unlockedCount(p);
  const progress = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel__head' },
      h('h3', null, icon('star'), 'Progress'),
      h('a', { class: 'link', text: 'Profile', attrs: { href: '#/profile' } }),
    ),
    h(
      'div',
      { class: 'level-block' },
      h('span', { class: 'level-badge', text: String(info.level) }),
      h(
        'div',
        { class: 'level-block__text' },
        h('strong', { text: `Level ${info.level}` }),
        h('span', {
          class: 'muted small',
          text: info.needed ? `${fmt(info.into)} / ${fmt(info.needed)} XP` : 'Max level',
        }),
      ),
    ),
    h('span', { class: 'xpbar xpbar--lg' }, withWidth(h('span', { class: 'xpbar__fill' }), info.progress)),
    h('p', {
      class: 'muted small',
      text: `Next level: +${fmt(next.coins)} coins, +${next.gems} gem${next.gems > 1 ? 's' : ''}`,
    }),
    h(
      'div',
      { class: 'mini-stats' },
      mini('Achievements', `${unlocked}/${ACHIEVEMENTS.length}`),
      mini('Coins earned', compact(p.totals['all.coinsEarned'] ?? 0)),
      mini('Games played', fmt(p.totals['all.plays'] ?? 0)),
    ),
  );
  const missions = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel__head' },
      h('h3', null, icon('target'), 'Daily missions'),
      h('a', { class: 'link', text: 'All', attrs: { href: '#/missions' } }),
    ),
    missionList(app, rerender),
  );
  return h('div', { class: 'home-panels' }, missions, progress, accountEl);
}

function withWidth(el: HTMLElement, t: number): HTMLElement {
  el.style.width = `${Math.round(Math.max(0, Math.min(1, t)) * 100)}%`;
  return el;
}

function mini(label: string, value: string): HTMLElement {
  return h('div', { class: 'mini-stat' }, h('strong', { text: value }), h('span', { text: label }));
}
