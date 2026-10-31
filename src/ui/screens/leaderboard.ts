import type { LeaderboardEntry } from '../../../shared/api';
import { GAMES, getGame } from '../../games/registry';
import type { GameId } from '../../games/types';
import { loadGlobalBoard } from '../../meta/cloud/leaderboard';
import type { App, Screen } from '../app';
import { fmt, h, timeAgo } from '../dom';
import { icon } from '../icons';

export function leaderboardScreen(app: App, params: string[]): Screen {
  let current: GameId = (getGame(params[0] ?? '')?.id ?? GAMES[0]?.id ?? 'runner') as GameId;
  let renderSeq = 0;
  const el = h('section', { class: 'screen' });
  const render = () => {
    const seq = ++renderSeq;
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
    const remote = globalPanel(app, current, () => seq === renderSeq);
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
      ...(remote ? [remote] : []),
    );
  };
  render();
  return { el };
}

/**
 * Top scores from every player, shown under the local table. Filled in once the server replies. If the
 * server cannot be reached, the section is removed without an error.
 */
function globalPanel(app: App, gameId: GameId, isCurrent: () => boolean): HTMLElement | null {
  if (app.cloud.current.kind === 'unavailable') return null;
  const def = getGame(gameId);
  const body = h('p', { class: 'muted small', text: 'Loading global scores…' });
  const panel = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel__head' },
      h('h3', null, icon('chart'), `Global top 10 — ${def?.title ?? ''}`),
      h('span', { class: 'muted small', text: 'All players' }),
    ),
    body,
  );
  if (def) panel.style.setProperty('--accent', def.accent);
  void loadGlobalBoard(gameId).then((entries) => {
    if (!isCurrent()) return;
    if (entries === null) {
      panel.remove();
      return;
    }
    if (entries.length === 0) {
      body.textContent = 'No global runs yet. Be the first on the board.';
      return;
    }
    body.replaceWith(globalTable(entries));
  });
  return panel;
}

function globalTable(entries: readonly LeaderboardEntry[]): HTMLElement {
  return h(
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
    h(
      'tbody',
      null,
      ...entries.map((e, i) =>
        h(
          'tr',
          { class: i < 3 ? `podium podium--${i + 1}` : '' },
          h('td', { class: 'rank' }, i < 3 ? icon('trophy') : null, String(i + 1)),
          h('td', { text: e.username }),
          h('td', { class: 'num', text: fmt(e.score) }),
          h('td', { class: 'muted small', text: timeAgo(e.createdAt) }),
        ),
      ),
    ),
  );
}
