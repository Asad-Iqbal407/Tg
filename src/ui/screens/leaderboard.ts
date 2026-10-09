import { GAMES, getGame } from '../../games/registry';
import type { GameId } from '../../games/types';
import type { App, Screen } from '../app';
import { fmt, h, timeAgo } from '../dom';
import { icon } from '../icons';

export function leaderboardScreen(app: App, params: string[]): Screen {
  let current: GameId = (getGame(params[0] ?? '')?.id ?? GAMES[0]?.id ?? 'runner') as GameId;
  const el = h('section', { class: 'screen' });
  const render = () => {
    const p = app.arcade.profile;
    const def = getGame(current);
    const tabs = h('div', { class: 'tabs tabs--scroll', attrs: { role: 'tablist' } });
    for (const g of GAMES) {
      tabs.appendChild(
        h('button', {
          class: `tab ${current === g.id ? 'is-active' : ''}`,
          text: g.title,
          attrs: { type: 'button', role: 'tab', 'aria-selected': current === g.id ? 'true' : 'false' },
          on: {
            click: () => {
              current = g.id;
              render();
            },
          },
        }),
      );
    }
    const board = p.leaderboard[current];
    const body = h('tbody');
    board.forEach((e, i) => {
      body.appendChild(
        h(
          'tr',
          { class: i < 3 ? `podium podium--${i + 1}` : '' },
          h('td', { class: 'rank' }, i < 3 ? icon('trophy') : null, String(i + 1)),
          h('td', { text: e.name }),
          h('td', { class: 'num', text: fmt(e.score) }),
          h('td', { class: 'muted small', text: timeAgo(e.date) }),
        ),
      );
    });
    const table =
      board.length > 0
        ? h(
            'table',
            { class: 'board' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', { text: '#' }),
                h('th', { text: 'Player' }),
                h('th', { class: 'num', text: 'Score' }),
                h('th', { text: 'When' }),
              ),
            ),
            body,
          )
        : h(
            'div',
            { class: 'empty' },
            icon('chart'),
            h('p', { text: 'No runs yet — set the first record!' }),
            h('button', {
              class: 'btn btn--primary',
              text: `Play ${def?.title ?? ''}`,
              attrs: { type: 'button' },
              on: { click: () => app.openLobby(current) },
            }),
          );
    const panel = h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel__head' },
        h('h3', null, icon('trophy'), `${def?.title ?? ''} — top ${board.length || 10}`),
        h('span', { class: 'muted small', text: `${fmt(p.games[current].plays)} plays` }),
      ),
      table,
    );
    if (def) panel.style.setProperty('--accent', def.accent);
    el.replaceChildren(
      h(
        'header',
        { class: 'screen__head' },
        h('h1', { text: 'Hall of Fame' }),
        h('p', {
          class: 'muted',
          text: 'Your ten best runs per game on this device. Change your name on the Profile page.',
        }),
      ),
      tabs,
      panel,
    );
  };
  render();
  return { el };
}
