import type { GameDefinition } from '../games/types';
import type { RunSummary } from '../meta/arcade';
import type { App } from './app';
import { append, countUp, duration, fmt, h } from './dom';
import { icon } from './icons';
import { Modal } from './overlay';

export interface ResultActions {
  playAgain(): void;
  changeLoadout(): void;
  exit(): void;
}

export function showResults(app: App, def: GameDefinition, s: RunSummary, actions: ResultActions): void {
  let acted = false;
  const act = (fn: () => void) => () => {
    if (acted) return;
    acted = true;
    modal.close();
    fn();
  };
  const modal = new Modal(app.overlayHost, {
    title: 'Run complete',
    className: 'modal--results',
    onDismiss: act(actions.exit),
  });
  modal.el.style.setProperty('--accent', def.accent);
  const reduced = app.reducedMotion;
  const r = s.rewards;

  const scoreEl = h('span', { class: 'results__score', text: '0' });
  const badges = h('div', { class: 'results__badges' });
  if (s.isNewBest && s.result.score > 0)
    badges.appendChild(h('span', { class: 'badge badge--gold' }, icon('star'), 'New best!'));
  if (s.rank !== null)
    badges.appendChild(h('span', { class: 'badge' }, icon('trophy'), `#${s.rank} in Hall of Fame`));
  badges.appendChild(
    h('span', { class: 'badge badge--muted' }, icon('clock'), duration(s.result.durationSec)),
  );

  const statChips = h('div', { class: 'results__stats' });
  for (const [key, label] of Object.entries(def.statLabels)) {
    const v = s.result.stats[key];
    if (v === undefined || v === 0) continue;
    statChips.appendChild(
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat__value', text: fmt(v) }),
        h('span', { class: 'stat__label', text: label }),
      ),
    );
    if (statChips.children.length >= 4) break;
  }

  const row = (label: string, value: number, extra = '') =>
    h(
      'div',
      { class: 'reward-row' },
      h('span', { text: label }),
      h('span', { class: 'reward-row__value', text: `${value > 0 ? '+' : ''}${fmt(value)}${extra}` }),
    );
  const coinRows = h(
    'div',
    { class: 'reward-rows' },
    row('Coins collected', r.collected),
    row('Score bonus', r.scoreBonus),
  );
  if (r.upgradeBonus > 0) coinRows.appendChild(row('Lucky Charm', r.upgradeBonus));
  if (r.doublerBonus > 0) coinRows.appendChild(row('Coin Doubler', r.doublerBonus));
  const totalCoins = h('span', { class: 'reward-total__value', text: '0' });

  const xpFill = h('span', { class: 'xpbar__fill' });
  const xpLabel = h('span', { class: 'results__xp-label' });
  const levelLabel = h('strong', { text: `Level ${s.levelBefore.level}` });
  xpFill.style.width = `${Math.round(s.levelBefore.progress * 100)}%`;
  xpLabel.textContent = `+${fmt(r.xp)} XP${r.xpBonus > 0 ? ` (incl. +${fmt(r.xpBonus)} bonus)` : ''}`;

  const extras = h('div', { class: 'results__extras' });
  for (const lv of s.levelUps) {
    extras.appendChild(
      h(
        'div',
        { class: 'unlock unlock--level' },
        icon('star'),
        h(
          'div',
          null,
          h('strong', { text: `Level ${lv.level} reached!` }),
          h('span', { text: `+${fmt(lv.coins)} coins · +${lv.gems} gem${lv.gems > 1 ? 's' : ''}` }),
        ),
      ),
    );
  }
  for (const a of s.achievements) {
    extras.appendChild(
      h(
        'div',
        { class: `unlock unlock--${a.tier}` },
        icon('trophy'),
        h(
          'div',
          null,
          h('strong', { text: a.name }),
          h('span', {
            text: `${a.description} · +${fmt(a.reward.coins)} coins${a.reward.gems ? ` · +${a.reward.gems} gems` : ''}`,
          }),
        ),
      ),
    );
  }
  for (const m of s.missionsCompleted) {
    extras.appendChild(
      h(
        'div',
        { class: 'unlock unlock--mission' },
        icon('target'),
        h(
          'div',
          null,
          h('strong', { text: 'Mission complete' }),
          h('span', { text: `${m.label} — claim it in Missions` }),
        ),
      ),
    );
  }

  append(
    modal.body,
    h(
      'div',
      { class: 'results' },
      h(
        'div',
        { class: 'results__head' },
        h('span', { class: 'muted small', text: def.title.toUpperCase() }),
        scoreEl,
        badges,
      ),
      statChips,
    ),
    h(
      'div',
      { class: 'results__rewards' },
      h(
        'div',
        { class: 'panel' },
        h('h3', null, icon('coin', 'icon icon--coin'), 'Coins'),
        coinRows,
        h('div', { class: 'reward-total' }, h('span', { text: 'Total' }), totalCoins),
      ),
      h(
        'div',
        { class: 'panel' },
        h('h3', null, icon('star'), 'Experience'),
        h('div', { class: 'results__level' }, levelLabel, xpLabel),
        h('span', { class: 'xpbar xpbar--lg' }, xpFill),
      ),
    ),
    extras.children.length ? extras : null,
    h(
      'div',
      { class: 'modal__actions' },
      h(
        'button',
        { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: act(actions.exit) } },
        icon('home'),
        'Arcade',
      ),
      h(
        'button',
        { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: act(actions.changeLoadout) } },
        icon('bolt'),
        'Loadout',
      ),
      h(
        'button',
        { class: 'btn btn--primary', attrs: { type: 'button' }, on: { click: act(actions.playAgain) } },
        icon('restart'),
        'Play again',
      ),
    ),
  );

  // Animate score → coins → XP.
  void (async () => {
    await countUp(scoreEl, 0, s.result.score, 900, reduced);
    if (s.isNewBest && s.result.score > 0) app.sfx('win');
    await countUp(totalCoins, 0, r.coins, 600, reduced);
    if (r.coins > 0) app.sfx('coin');
    await animateXp(s, xpFill, levelLabel, reduced, app);
  })();
}

async function animateXp(
  s: RunSummary,
  fill: HTMLElement,
  label: HTMLElement,
  reduced: boolean,
  app: App,
): Promise<void> {
  const end = s.levelAfter;
  if (reduced || s.levelUps.length === 0) {
    fill.style.width = `${Math.round(end.progress * 100)}%`;
    label.textContent = `Level ${end.level}`;
    return;
  }
  for (const lv of s.levelUps) {
    fill.style.width = '100%';
    await wait(450);
    fill.classList.add('no-anim');
    fill.style.width = '0%';
    label.textContent = `Level ${lv.level}`;
    app.sfx('levelup');
    await wait(40);
    fill.classList.remove('no-anim');
  }
  fill.style.width = `${Math.round(end.progress * 100)}%`;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
