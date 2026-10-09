import { gameTitle } from '../../games/registry';
import { DAILY_REWARDS } from '../../meta/daily';
import type { App, Screen } from '../app';
import { fmt, h } from '../dom';
import { icon } from '../icons';

export function missionsScreen(app: App): Screen {
  const el = h('section', { class: 'screen' });
  const countdown = h('span', { class: 'countdown' });
  const tickCountdown = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = midnight.getTime() - now.getTime();
    const hh = Math.floor(ms / 3_600_000);
    const mm = Math.floor((ms % 3_600_000) / 60_000);
    const ss = Math.floor((ms % 60_000) / 1000);
    countdown.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const timer = setInterval(() => {
    tickCountdown();
    if (app.arcade.profile.missions.day !== app.arcade.today()) {
      app.arcade.ensureMissions();
      render();
    }
  }, 1000);
  const render = () => {
    tickCountdown();
    el.replaceChildren(
      h(
        'header',
        { class: 'screen__head' },
        h('h1', { text: 'Missions & rewards' }),
        h('p', {
          class: 'muted',
          text: 'Log in daily to grow your streak, and complete missions for coins, XP and gems.',
        }),
      ),
      dailyCalendar(app, render),
      h(
        'div',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel__head' },
          h('h3', null, icon('target'), "Today's missions"),
          h('span', { class: 'muted small' }, icon('clock'), ' New missions in ', countdown),
        ),
        missionList(app, render, true),
      ),
    );
  };
  render();
  return { el, destroy: () => clearInterval(timer) };
}

function dailyCalendar(app: App, rerender: () => void): HTMLElement {
  const status = app.arcade.dailyStatus();
  const grid = h('div', { class: 'calendar' });
  const doneUpTo = status.canClaim ? status.index - 1 : status.index;
  DAILY_REWARDS.forEach((_, i) => {
    const r = app.arcade.dailyReward(i);
    const isToday = i === status.index;
    const done = i <= doneUpTo;
    grid.appendChild(
      h(
        'div',
        { class: `calendar__day ${done ? 'is-done' : ''} ${isToday && status.canClaim ? 'is-today' : ''}` },
        h('span', { class: 'calendar__label', text: `Day ${i + 1}` }),
        h(
          'span',
          { class: 'calendar__icon' },
          icon(r.gems ? 'gem' : 'coin', `icon ${r.gems ? 'icon--gem' : 'icon--coin'}`),
        ),
        h('strong', { text: fmt(r.coins) }),
        r.gems ? h('span', { class: 'small', text: `+${r.gems} gems` }) : null,
        r.boost ? h('span', { class: 'small', text: '+ boost' }) : null,
        done ? h('span', { class: 'calendar__check' }, icon('check')) : null,
      ),
    );
  });
  const claim = h(
    'button',
    {
      class: 'btn btn--gold',
      attrs: { type: 'button', disabled: !status.canClaim },
      on: {
        click: () => {
          const res = app.arcade.claimDaily();
          if (res) {
            app.sfx('reward');
            app.toaster.show({
              title: `Day ${res.streak} reward claimed!`,
              body: `+${fmt(res.reward.coins)} coins${res.reward.gems ? ` · +${res.reward.gems} gems` : ''}`,
              icon: 'gift',
              tone: 'gold',
            });
          }
          rerender();
        },
      },
    },
    icon('gift'),
    status.canClaim ? `Claim day ${status.streak}` : 'Claimed today',
  );
  return h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel__head' },
      h('h3', null, icon('calendar'), 'Daily login'),
      h('span', {
        class: 'pill',
        text: `Streak ${status.canClaim ? Math.max(0, status.streak - 1) : status.streak} · best ${app.arcade.profile.daily.best}`,
      }),
    ),
    grid,
    h(
      'div',
      { class: 'panel__foot' },
      h('p', { class: 'muted small', text: 'Miss a day and your streak resets to day 1.' }),
      claim,
    ),
  );
}

/** Mission rows with progress and claim buttons (also used on the home screen). */
export function missionList(app: App, rerender: () => void, detailed = false): HTMLElement {
  const list = h('ul', { class: 'missions' });
  for (const m of app.arcade.profile.missions.list) {
    const done = m.progress >= m.target;
    const pct = Math.round((Math.min(m.progress, m.target) / m.target) * 100);
    const fill = h('span', { class: 'xpbar__fill' });
    fill.style.width = `${pct}%`;
    const reward = `${fmt(m.reward.coins)} coins · ${fmt(m.reward.xp)} XP${m.reward.gems ? ` · ${m.reward.gems} gem` : ''}`;
    list.appendChild(
      h(
        'li',
        { class: `mission tier-${m.tier} ${m.claimed ? 'is-claimed' : ''}` },
        h(
          'div',
          { class: 'mission__text' },
          h('strong', { text: m.label }),
          h('span', {
            class: 'muted small',
            text: `${m.gameId ? gameTitle(m.gameId) : 'Any game'} · ${reward}`,
          }),
          h('span', { class: 'xpbar' }, fill),
          detailed
            ? h('span', {
                class: 'small muted',
                text: `${fmt(Math.min(m.progress, m.target))} / ${fmt(m.target)}`,
              })
            : null,
        ),
        m.claimed
          ? h('span', { class: 'mission__state' }, icon('check'), 'Done')
          : h(
              'button',
              {
                class: `btn btn--sm ${done ? 'btn--gold' : 'btn--ghost'}`,
                attrs: { type: 'button', disabled: !done },
                on: {
                  click: () => {
                    const claimed = app.arcade.claimMission(m.id);
                    if (claimed) {
                      app.sfx('reward');
                      app.toaster.show({
                        title: 'Mission reward claimed',
                        body: reward,
                        icon: 'target',
                        tone: 'gold',
                      });
                    }
                    rerender();
                  },
                },
              },
              done ? 'Claim' : `${pct}%`,
            ),
      ),
    );
  }
  if (list.children.length === 0) list.appendChild(h('li', { class: 'muted', text: 'No missions today.' }));
  return list;
}
