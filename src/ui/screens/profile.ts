import { GAMES } from '../../games/registry';
import { ACHIEVEMENTS } from '../../meta/achievements';
import { getSkin } from '../../meta/catalog';
import { levelInfo } from '../../meta/progression';
import { NAME_MAX } from '../../meta/profile';
import type { App, Screen } from '../app';
import { compact, duration, fmt, h } from '../dom';
import { icon } from '../icons';

export function profileScreen(app: App): Screen {
  const el = h('section', { class: 'screen' });
  const render = () => {
    const p = app.arcade.profile;
    const info = levelInfo(p.xp);
    const input = h('input', {
      class: 'input',
      attrs: {
        type: 'text',
        value: p.name,
        maxlength: NAME_MAX,
        'aria-label': 'Player name',
        autocomplete: 'nickname',
        spellcheck: 'false',
      },
    });
    const save = () => {
      const clean = app.arcade.setName(input.value);
      input.value = clean;
      app.toaster.show({ title: 'Name saved', body: clean, icon: 'edit', tone: 'success', ms: 1600 });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    const totalTime = GAMES.reduce((s, g) => s + p.games[g.id].totalTime, 0);
    const xpFill = h('span', { class: 'xpbar__fill' });
    xpFill.style.width = `${Math.round(info.progress * 100)}%`;
    const header = h(
      'div',
      { class: 'panel profile-card' },
      h('span', { class: 'level-badge level-badge--xl', text: String(info.level) }),
      h(
        'div',
        { class: 'profile-card__main' },
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Player name' }),
          h(
            'span',
            { class: 'field__row' },
            input,
            h('button', {
              class: 'btn btn--primary btn--sm',
              text: 'Save',
              attrs: { type: 'button' },
              on: { click: save },
            }),
          ),
        ),
        h('span', { class: 'xpbar xpbar--lg' }, xpFill),
        h('span', {
          class: 'muted small',
          text: info.needed
            ? `Level ${info.level} · ${fmt(info.into)} / ${fmt(info.needed)} XP · ${fmt(p.xp)} XP total`
            : `Max level · ${fmt(p.xp)} XP total`,
        }),
      ),
    );
    const overview = h(
      'div',
      { class: 'mini-stats mini-stats--grid' },
      tile('Games played', fmt(p.totals['all.plays'] ?? 0)),
      tile('Time played', duration(totalTime)),
      tile('Coins earned', compact(p.totals['all.coinsEarned'] ?? 0)),
      tile('Achievements', `${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length}`),
      tile('Best streak', `${p.daily.best} days`),
      tile('Skins owned', String(p.owned.length)),
    );
    const games = h('div', { class: 'profile-games' });
    for (const g of GAMES) {
      const rec = p.games[g.id];
      const rows = Object.entries(g.statLabels).map(([k, label]) => {
        const total = p.totals[`${g.id}.${k}`] ?? 0;
        const best = p.bests[`${g.id}.${k}`] ?? 0;
        return h(
          'tr',
          null,
          h('td', { text: label }),
          h('td', { class: 'num', text: fmt(total) }),
          h('td', { class: 'num', text: fmt(best) }),
        );
      });
      const card = h(
        'article',
        { class: 'panel game-stats' },
        h(
          'div',
          { class: 'panel__head' },
          h('h3', { text: g.title }),
          h('span', { class: 'muted small', text: getSkin(p.equipped[g.id])?.name ?? '' }),
        ),
        h(
          'div',
          { class: 'mini-stats' },
          tile('Best', compact(rec.best)),
          tile('Plays', fmt(rec.plays)),
          tile('Time', duration(rec.totalTime)),
        ),
        h(
          'table',
          { class: 'stats-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { text: 'Stat' }),
              h('th', { class: 'num', text: 'Total' }),
              h('th', { class: 'num', text: 'Best run' }),
            ),
          ),
          h('tbody', null, ...rows),
        ),
      );
      card.style.setProperty('--accent', g.accent);
      games.appendChild(card);
    }
    el.replaceChildren(
      h(
        'header',
        { class: 'screen__head' },
        h('h1', { text: 'Profile' }),
        h('p', { class: 'muted', text: `Playing since ${new Date(p.createdAt).toLocaleDateString()}` }),
      ),
      header,
      overview,
      h('h2', { class: 'section-title' }, icon('chart'), 'Game stats'),
      games,
    );
  };
  render();
  return { el };
}

function tile(label: string, value: string): HTMLElement {
  return h('div', { class: 'mini-stat' }, h('strong', { text: value }), h('span', { text: label }));
}
