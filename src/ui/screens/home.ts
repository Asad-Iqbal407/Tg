import { GAMES } from '../../games/registry';
import type { GameDefinition } from '../../games/types';
import { ACHIEVEMENTS } from '../../meta/achievements';
import { getSkin, toSkinData } from '../../meta/catalog';
import { DAILY_REWARDS } from '../../meta/daily';
import { levelInfo, levelUpReward } from '../../meta/progression';
import type { App, Screen } from '../app';
import { compact, fmt, h } from '../dom';
import { icon } from '../icons';
import { drawGamePreview, schedulePreview } from '../previews';
import { missionList } from './missions';

export function homeScreen(app: App): Screen {
  const el = h('section', { class: 'screen home' });
  const render = () => {
    el.replaceChildren(
      hero(app, render),
      h('h2', { class: 'section-title', text: 'Games' }),
      gameGrid(app),
      sidePanels(app, render),
    );
  };
  render();
  return { el };
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
        text: 'Five classic-inspired games. One shared reward system. Earn coins, level up, unlock skins and climb your Hall of Fame.',
      }),
    ),
    daily,
  );
}

function gameGrid(app: App): HTMLElement {
  const grid = h('div', { class: 'game-grid' });
  for (const def of GAMES) grid.appendChild(gameCard(app, def));
  return grid;
}

function gameCard(app: App, def: GameDefinition): HTMLElement {
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

function sidePanels(app: App, rerender: () => void): HTMLElement {
  const p = app.arcade.profile;
  const info = levelInfo(p.xp);
  const next = levelUpReward(info.level + 1);
  const unlocked = Object.keys(p.achievements).length;
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
  return h('div', { class: 'home-panels' }, missions, progress);
}

function withWidth(el: HTMLElement, t: number): HTMLElement {
  el.style.width = `${Math.round(Math.max(0, Math.min(1, t)) * 100)}%`;
  return el;
}

function mini(label: string, value: string): HTMLElement {
  return h('div', { class: 'mini-stat' }, h('strong', { text: value }), h('span', { text: label }));
}
