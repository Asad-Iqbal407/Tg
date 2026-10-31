import { GAMES } from '../../games/registry';
import { BOOSTS, isFree, type Price, SKINS, UPGRADES } from '../../meta/catalog';
import { upgradeLevel } from '../../meta/profile';
import type { App, Screen } from '../app';
import { fmt, h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../overlay';
import { drawSkinPreview } from '../previews';

type Tab = 'skins' | 'boosts' | 'upgrades';

export function shopScreen(app: App, params: string[]): Screen {
  let tab: Tab = params[0] === 'boosts' || params[0] === 'upgrades' ? params[0] : 'skins';
  const el = h('section', { class: 'screen' });

  const priceEl = (p: Price) =>
    h(
      'span',
      { class: 'price' },
      p.coins ? h('span', { class: 'price__coins' }, icon('coin', 'icon icon--coin'), fmt(p.coins)) : null,
      p.gems ? h('span', { class: 'price__gems' }, icon('gem', 'icon icon--gem'), fmt(p.gems)) : null,
    );

  const affordable = (p: Price) =>
    app.arcade.profile.coins >= (p.coins ?? 0) && app.arcade.profile.gems >= (p.gems ?? 0);

  const buy = async (id: string, name: string, price: Price, confirm: boolean) => {
    if (confirm) {
      const cost = [
        price.coins ? `${fmt(price.coins)} coins` : '',
        price.gems ? `${fmt(price.gems)} gems` : '',
      ]
        .filter(Boolean)
        .join(' and ');
      const ok = await confirmDialog(
        app.overlayHost,
        `Unlock ${name}?`,
        `This will spend ${cost}.`,
        'Unlock',
      );
      if (!ok) return;
    }
    const res = app.arcade.buy(id);
    if (res.ok) {
      app.sfx('reward');
      app.toaster.show({ title: 'Purchased!', body: name, icon: 'cart', tone: 'success', ms: 2000 });
    } else {
      app.sfx('error');
      app.toaster.show({
        title: 'Cannot purchase',
        body: res.reason,
        icon: 'close',
        tone: 'error',
        ms: 2200,
      });
    }
    render();
  };

  const skinsView = () => {
    const wrap = h('div', { class: 'shop-sections' });
    const p = app.arcade.profile;
    for (const g of GAMES) {
      const grid = h('div', { class: 'shop-grid' });
      for (const s of SKINS.filter((k) => k.gameId === g.id)) {
        const owned = p.owned.includes(s.id);
        const equipped = p.equipped[g.id] === s.id;
        const canvas = h('canvas', {
          class: 'shop-item__art',
          attrs: { width: 160, height: 120, 'aria-hidden': 'true' },
        });
        drawSkinPreview(s, canvas);
        const statsEl = s.stats
          ? h(
              'div',
              { class: 'stat-bars' },
              ...Object.entries(s.stats).map(([k, v]) => {
                const fill = h('span', { class: 'stat-bar__fill' });
                fill.style.width = `${(v / 5) * 100}%`;
                return h(
                  'div',
                  { class: 'stat-bar' },
                  h('span', { class: 'stat-bar__label', text: k }),
                  h('span', { class: 'stat-bar__track' }, fill),
                );
              }),
            )
          : null;
        let action: HTMLElement;
        if (equipped) action = h('span', { class: 'pill pill--ok' }, icon('check'), 'Equipped');
        else if (owned)
          action = h('button', {
            class: 'btn btn--ghost btn--sm',
            text: 'Equip',
            attrs: { type: 'button' },
            on: {
              click: () => {
                app.arcade.equip(s.id);
                app.sfx('select');
                render();
              },
            },
          });
        else
          action = h(
            'button',
            {
              class: 'btn btn--primary btn--sm',
              attrs: { type: 'button', disabled: !affordable(s.price) },
              on: { click: () => void buy(s.id, s.name, s.price, true) },
            },
            priceEl(s.price),
          );
        const card = h(
          'article',
          { class: `shop-item rarity--${s.rarity} ${equipped ? 'is-equipped' : ''}` },
          h(
            'div',
            { class: 'shop-item__stage' },
            canvas,
            h('span', { class: `rarity-tag rarity-tag--${s.rarity}`, text: s.rarity }),
          ),
          h('h4', { text: s.name }),
          h('p', { class: 'muted small', text: s.description }),
          statsEl,
          h(
            'div',
            { class: 'shop-item__foot' },
            isFree(s) && !equipped ? h('span', { class: 'muted small', text: 'Free' }) : null,
            action,
          ),
        );
        grid.appendChild(card);
      }
      const section = h(
        'section',
        { class: 'shop-section' },
        h(
          'h3',
          { class: 'section-title' },
          g.title,
          h('span', {
            class: 'muted small',
            text: ` · ${g.id === 'hill' ? 'vehicles change handling' : g.id === 'galaxy' ? 'ships change stats' : 'cosmetic'}`,
          }),
        ),
        grid,
      );
      section.style.setProperty('--accent', g.accent);
      wrap.appendChild(section);
    }
    return wrap;
  };

  const boostsView = () => {
    const grid = h('div', { class: 'shop-grid shop-grid--wide' });
    const p = app.arcade.profile;
    for (const b of BOOSTS) {
      const have = p.consumables[b.id] ?? 0;
      const card = h(
        'article',
        { class: 'shop-item shop-item--boost' },
        h(
          'div',
          { class: 'boost-icon' },
          icon(
            b.id === 'coin-doubler'
              ? 'coin'
              : b.id === 'xp-booster'
                ? 'star'
                : b.id === 'shield'
                  ? 'shield'
                  : 'rocket',
          ),
        ),
        h('h4', { text: b.name }),
        h('p', { class: 'muted small', text: b.description }),
        h(
          'ul',
          { class: 'effects' },
          ...GAMES.filter((g) => g.boostEffects[b.id]).map((g) =>
            h('li', null, h('strong', { text: `${g.title}: ` }), g.boostEffects[b.id] ?? ''),
          ),
        ),
        h(
          'div',
          { class: 'shop-item__foot' },
          h('span', { class: 'pill', text: `Owned ×${have}` }),
          h(
            'button',
            {
              class: 'btn btn--primary btn--sm',
              attrs: { type: 'button', disabled: !affordable(b.price) },
              on: { click: () => void buy(b.id, b.name, b.price, false) },
            },
            priceEl(b.price),
          ),
        ),
      );
      card.style.setProperty('--boost', b.color);
      grid.appendChild(card);
    }
    return grid;
  };

  const upgradesView = () => {
    const grid = h('div', { class: 'shop-grid shop-grid--wide' });
    const p = app.arcade.profile;
    for (const u of UPGRADES) {
      const level = upgradeLevel(p, u.id);
      const max = u.costs.length;
      const pips = h('div', { class: 'pips', attrs: { 'aria-label': `Level ${level} of ${max}` } });
      for (let i = 0; i < max; i++) pips.appendChild(h('span', { class: `pip ${i < level ? 'is-on' : ''}` }));
      const nextCost = u.costs[level];
      grid.appendChild(
        h(
          'article',
          { class: 'shop-item shop-item--upgrade' },
          h(
            'div',
            { class: 'boost-icon' },
            icon(
              u.id === 'coin-value'
                ? 'coin'
                : u.id === 'xp-gain'
                  ? 'star'
                  : u.id === 'power-duration'
                    ? 'bolt'
                    : 'gift',
            ),
          ),
          h('h4', { text: u.name }),
          h('p', { class: 'muted small', text: u.description }),
          pips,
          h(
            'p',
            { class: 'small' },
            h('strong', { text: level > 0 ? u.effectLabel(level) : 'Not owned' }),
            level < max ? h('span', { class: 'muted', text: ` → ${u.effectLabel(level + 1)}` }) : null,
          ),
          h(
            'div',
            { class: 'shop-item__foot' },
            nextCost === undefined
              ? h('span', { class: 'pill pill--ok' }, icon('check'), 'Maxed')
              : h(
                  'button',
                  {
                    class: 'btn btn--primary btn--sm',
                    attrs: { type: 'button', disabled: !affordable({ coins: nextCost }) },
                    on: {
                      click: () =>
                        void buy(u.id, `${u.name} level ${level + 1}`, { coins: nextCost }, nextCost >= 2000),
                    },
                  },
                  priceEl({ coins: nextCost }),
                ),
          ),
        ),
      );
    }
    return grid;
  };

  const render = () => {
    const p = app.arcade.profile;
    const tabs = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
    for (const [id, label] of [
      ['skins', 'Skins & vehicles'],
      ['boosts', 'Boosts'],
      ['upgrades', 'Upgrades'],
    ] as const) {
      tabs.appendChild(
        h('button', {
          class: `tab ${tab === id ? 'is-active' : ''}`,
          text: label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false' },
          on: {
            click: () => {
              tab = id;
              app.sfx('click');
              render();
            },
          },
        }),
      );
    }
    el.replaceChildren(
      h(
        'header',
        { class: 'screen__head' },
        h('h1', { text: 'Shop' }),
        h(
          'div',
          { class: 'wallet' },
          h('span', { class: 'currency' }, icon('coin', 'icon icon--coin'), fmt(p.coins)),
          h('span', { class: 'currency' }, icon('gem', 'icon icon--gem'), fmt(p.gems)),
        ),
      ),
      tabs,
      tab === 'skins' ? skinsView() : tab === 'boosts' ? boostsView() : upgradesView(),
    );
  };
  render();
  return { el };
}
