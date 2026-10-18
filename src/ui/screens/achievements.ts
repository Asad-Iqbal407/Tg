import { GAMES, gameTitle } from '../../games/registry';
import type { GameId } from '../../games/types';
import { ACHIEVEMENTS, achievementProgress, unlockedCount } from '../../meta/achievements';
import type { App, Screen } from '../app';
import { fmt, h } from '../dom';
import { icon } from '../icons';

export function achievementsScreen(app: App): Screen {
  let filter: GameId | 'all' | 'arcade' = 'all';
  const el = h('section', { class: 'screen' });
  const render = () => {
    const p = app.arcade.profile;
    const unlocked = unlockedCount(p);
    const pct = Math.round((unlocked / ACHIEVEMENTS.length) * 100);
    const ring = h(
      'div',
      { class: 'ring', attrs: { role: 'img', 'aria-label': `${pct}% complete` } },
      h('span', { text: `${pct}%` }),
    );
    ring.style.setProperty('--p', String(unlocked / ACHIEVEMENTS.length));
    const chips = h('div', { class: 'tabs tabs--scroll', attrs: { role: 'tablist' } });
    const options: [typeof filter, string][] = [
      ['all', 'All'],
      ['arcade', 'Arcade'],
      ...GAMES.map((g) => [g.id, g.title] as [GameId, string]),
    ];
    for (const [id, label] of options) {
      chips.appendChild(
        h('button', {
          class: `tab ${filter === id ? 'is-active' : ''}`,
          text: label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': filter === id ? 'true' : 'false' },
          on: {
            click: () => {
              filter = id;
              render();
            },
          },
        }),
      );
    }
    const list = h('ul', { class: 'achievements' });
    const items = ACHIEVEMENTS.filter(
      (a) => filter === 'all' || (filter === 'arcade' ? a.gameId === null : a.gameId === filter),
    );
    // Unlocked first, then by closeness to completion.
    const sorted = [...items].sort((a, b) => {
      const ua = p.achievements[a.id] !== undefined ? 1 : 0;
      const ub = p.achievements[b.id] !== undefined ? 1 : 0;
      if (ua !== ub) return ub - ua;
      const pa = achievementProgress(a, p);
      const pb = achievementProgress(b, p);
      return pb.current / pb.target - pa.current / pa.target;
    });
    for (const a of sorted) {
      const done = p.achievements[a.id] !== undefined;
      const prog = achievementProgress(a, p);
      const fill = h('span', { class: 'xpbar__fill' });
      fill.style.width = `${Math.round((prog.current / prog.target) * 100)}%`;
      list.appendChild(
        h(
          'li',
          { class: `achievement tier--${a.tier} ${done ? 'is-done' : ''}` },
          h('span', { class: 'achievement__medal' }, icon(done ? 'trophy' : 'lock')),
          h(
            'div',
            { class: 'achievement__text' },
            h('strong', { text: a.name }),
            h('span', {
              class: 'muted small',
              text: `${a.description}${a.gameId ? ` · ${gameTitle(a.gameId)}` : ''}`,
            }),
            done
              ? h('span', {
                  class: 'small ok',
                  text: `Unlocked ${new Date(p.achievements[a.id] ?? 0).toLocaleDateString()}`,
                })
              : h(
                  'span',
                  { class: 'achievement__progress' },
                  h('span', { class: 'xpbar' }, fill),
                  h('span', { class: 'small muted', text: `${fmt(prog.current)} / ${fmt(prog.target)}` }),
                ),
          ),
          h(
            'span',
            { class: 'achievement__reward' },
            h('span', null, icon('coin', 'icon icon--coin'), fmt(a.reward.coins)),
            a.reward.gems ? h('span', null, icon('gem', 'icon icon--gem'), String(a.reward.gems)) : null,
          ),
        ),
      );
    }
    el.replaceChildren(
      h(
        'header',
        { class: 'screen__head screen__head--row' },
        h(
          'div',
          null,
          h('h1', { text: 'Achievements' }),
          h('p', {
            class: 'muted',
            text: `${unlocked} of ${ACHIEVEMENTS.length} unlocked. Each one pays out coins and gems.`,
          }),
        ),
        ring,
      ),
      chips,
      list,
    );
  };
  render();
  return { el };
}
