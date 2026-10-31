import type { BoostId, GameDefinition } from '../games/types';
import { BOOSTS, getSkin, skinsFor, toSkinData } from '../meta/catalog';
import { CHALLENGE_COINS, CHALLENGE_XP } from '../meta/challenge';
import type { App } from './app';
import { duration, fmt, h } from './dom';
import { icon } from './icons';
import { Modal } from './overlay';
import { drawGamePreview, drawSkinPreview, schedulePreview } from './previews';

/** Pre-game screen: how to play, best scores, loadout (skin) and boost selection. */
export function openLobby(app: App, def: GameDefinition): void {
  const modal = new Modal(app.overlayHost, { title: def.title, className: 'modal--lobby' });
  const selected = new Set<BoostId>();
  const profile = () => app.arcade.profile;

  const art = h('canvas', { class: 'lobby__art', attrs: { width: 640, height: 300, 'aria-hidden': 'true' } });
  const renderArt = () => {
    const skin = getSkin(profile().equipped[def.id]);
    // The lobby's pill sits along the bottom edge, so whole-board art stays centred here.
    if (skin) schedulePreview(() => drawGamePreview(def, toSkinData(skin), art, 0));
  };
  renderArt();

  const rec = profile().games[def.id];

  const controls = h(
    'dl',
    { class: 'controls-list' },
    ...def.controls.flatMap(([k, v]) => [h('dt', null, h('kbd', { text: k })), h('dd', { text: v })]),
  );

  const skinRow = h('div', { class: 'skin-row', attrs: { role: 'radiogroup', 'aria-label': 'Choose skin' } });
  const renderSkins = () => {
    skinRow.replaceChildren();
    for (const s of skinsFor(def.id)) {
      const owned = profile().owned.includes(s.id);
      const equipped = profile().equipped[def.id] === s.id;
      const c = h('canvas', {
        class: 'skin-chip__art',
        attrs: { width: 96, height: 96, 'aria-hidden': 'true' },
      });
      drawSkinPreview(s, c);
      const btn = h(
        'button',
        {
          class: `skin-chip rarity--${s.rarity} ${equipped ? 'is-selected' : ''} ${owned ? '' : 'is-locked'}`,
          attrs: {
            type: 'button',
            role: 'radio',
            'aria-checked': equipped ? 'true' : 'false',
            'aria-label': `${s.name}${owned ? '' : ' (locked)'}`,
            title: owned ? s.name : `${s.name} — unlock in the shop`,
          },
          on: {
            click: () => {
              if (!owned) {
                modal.close();
                app.navigate('shop');
                return;
              }
              app.arcade.equip(s.id);
              app.sfx('select');
              renderSkins();
              renderArt();
            },
          },
        },
        c,
        owned ? null : h('span', { class: 'skin-chip__lock' }, icon('lock')),
      );
      skinRow.appendChild(btn);
    }
  };
  renderSkins();

  const boostList = h('div', { class: 'boost-list' });
  const renderBoosts = () => {
    boostList.replaceChildren();
    for (const b of BOOSTS) {
      const have = profile().consumables[b.id] ?? 0;
      const on = selected.has(b.id);
      const effect = def.boostEffects[b.id] ?? b.description;
      const btn = h(
        'button',
        {
          class: `boost-toggle ${on ? 'is-on' : ''}`,
          attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', disabled: have <= 0 },
          on: {
            click: () => {
              if (selected.has(b.id)) selected.delete(b.id);
              else selected.add(b.id);
              app.sfx('click');
              renderBoosts();
            },
          },
        },
        h('span', { class: 'boost-toggle__dot' }),
        h(
          'span',
          { class: 'boost-toggle__text' },
          h('strong', { text: b.name }),
          h('small', { text: effect }),
        ),
        h('span', { class: 'boost-toggle__count', text: `×${have}` }),
      );
      btn.style.setProperty('--boost', b.color);
      boostList.appendChild(btn);
    }
  };
  renderBoosts();

  const play = h(
    'button',
    {
      class: 'btn btn--primary btn--xl',
      attrs: { type: 'button' },
      on: {
        click: () => {
          app.sfx('select');
          modal.close();
          app.launch(def.id, [...selected]);
        },
      },
    },
    icon('play'),
    'Play',
  );

  const ch = app.arcade.challengeStatus(def.id);
  const daily = h(
    'section',
    { class: 'lobby__section challenge' },
    h(
      'div',
      { class: 'challenge__text' },
      h('h3', null, icon('star'), 'Daily Challenge'),
      h('p', {
        class: 'muted small',
        text: ch.bonusAvailable
          ? `Everyone gets the same run today. Score on it for +${CHALLENGE_COINS} coins and +${CHALLENGE_XP} XP.`
          : `Bonus claimed. Today's best: ${fmt(ch.best)} over ${ch.plays} ${ch.plays === 1 ? 'try' : 'tries'}. Beat it!`,
      }),
    ),
    h(
      'button',
      {
        class: 'btn btn--ghost',
        attrs: { type: 'button' },
        on: {
          click: () => {
            app.sfx('select');
            modal.close();
            app.launch(def.id, [...selected], true);
          },
        },
      },
      'Play today’s run',
    ),
  );

  modal.el.style.setProperty('--accent', def.accent);
  modal.body.append(
    h(
      'div',
      { class: 'lobby' },
      h(
        'div',
        { class: 'lobby__hero' },
        art,
        h('span', { class: 'pill', text: `Inspired by ${def.inspiredBy}` }),
      ),
      h('p', { class: 'lobby__desc', text: def.description }),
      h(
        'div',
        { class: 'lobby__stats' },
        stat('Best', fmt(rec.best)),
        stat('Plays', fmt(rec.plays)),
        stat('Time played', duration(rec.totalTime)),
      ),
      h(
        'section',
        { class: 'lobby__section' },
        h('h3', { text: 'Controls' }),
        controls,
        h('p', { class: 'muted small', text: `Touch: ${def.touchHint}` }),
      ),
      daily,
      h('section', { class: 'lobby__section' }, h('h3', { text: 'Loadout' }), skinRow),
      h(
        'section',
        { class: 'lobby__section' },
        h('h3', { text: 'Boosts for this run' }),
        boostList,
        h('p', {
          class: 'muted small',
          text: 'Selected boosts are used up when the run starts. Buy more in the shop.',
        }),
      ),
      h('div', { class: 'modal__actions modal__actions--sticky' }, play),
    ),
  );
}

function stat(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('span', { class: 'stat__value', text: value }),
    h('span', { class: 'stat__label', text: label }),
  );
}
