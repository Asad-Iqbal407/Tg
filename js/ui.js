'use strict';
// DOM menus: title, world map, shop, achievements, settings, pause, results, daily rewards.

const ICON = {
  coin: '<svg viewBox="0 0 24 24" class="ic"><ellipse cx="12" cy="12.6" rx="9" ry="10" fill="#c47a0a"/><ellipse cx="12" cy="12" rx="9" ry="10" fill="#ffd23f"/><ellipse cx="12" cy="12" rx="6" ry="7.2" fill="#ffb11a"/><rect x="10.8" y="7" width="2.4" height="10" rx="1" fill="#ffe680"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="#ffd23f" stroke="#c47a0a" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  starOff: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.3)" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  medal: '<svg viewBox="0 0 24 24" class="ic"><path d="M7 13l-3 9 4-2 2 3 2-8z" fill="#e04848"/><path d="M17 13l3 9-4-2-2 3-2-8z" fill="#3f7fe0"/><circle cx="12" cy="10" r="8" fill="#ffd23f" stroke="#b8780a" stroke-width="1.2"/><path d="M12 5.2l1.5 3.2 3.4.4-2.5 2.3.7 3.4L12 12.8l-3.1 1.7.7-3.4-2.5-2.3 3.4-.4z" fill="#fff"/></svg>',
  medalOff: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="8" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.3)" stroke-width="1.2"/></svg>',
  heart: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 21C3 14.5 2 9.5 4.5 6.5S11 4.6 12 7.5c1-2.9 5-4 7.5-1S21 14.5 12 21z" fill="#e8304a"/><ellipse cx="8" cy="8.5" rx="2" ry="1.3" fill="#ff8aa0" transform="rotate(-35 8 8.5)"/></svg>',
  berry: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="13.5" r="8" fill="#ff6a2a"/><circle cx="9.5" cy="11" r="2.5" fill="#ffb15a"/><ellipse cx="9" cy="5" rx="4" ry="1.8" fill="#3fae3a" transform="rotate(-25 9 5)"/><ellipse cx="15" cy="5" rx="4" ry="1.8" fill="#3fae3a" transform="rotate(25 15 5)"/></svg>',
  magnet: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 3h5v9a2 2 0 004 0V3h5v9a7 7 0 01-14 0z" fill="#e8304a"/><rect x="5" y="3" width="5" height="4" fill="#d8dce8"/><rect x="14" y="3" width="5" height="4" fill="#d8dce8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9.5" fill="rgba(160,230,255,.25)" stroke="#9fe8ff" stroke-width="2"/><circle cx="8.5" cy="8" r="2" fill="#fff"/></svg>',
  boots: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 4h6v9l7 3v4H5z" fill="#4a78d8"/><path d="M5 18h14v2H5z" fill="#2f4170"/><circle cx="18" cy="8" r="3" fill="#fff"/><circle cx="20.5" cy="10" r="2.2" fill="#fff"/></svg>',
  clock: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 2h12v3l-4.5 7L18 19v3H6v-3l4.5-7L6 5z" fill="#ffd23f" stroke="#a8682a" stroke-width="1.2"/><path d="M9 19l3-4 3 4z" fill="#e2a35c"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" class="ic"><path d="M7 3h10v6a5 5 0 01-10 0z" fill="#ffd23f"/><path d="M7 5H3c0 4 2 5 4 5M17 5h4c0 4-2 5-4 5" fill="none" stroke="#ffd23f" stroke-width="2"/><rect x="10.5" y="13" width="3" height="4" fill="#d9921a"/><rect x="7" y="17" width="10" height="4" rx="1" fill="#a8682a"/></svg>',
  lock: '<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="10" width="14" height="11" rx="2.5" fill="#ffd23f"/><path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke="#ffd23f" stroke-width="2.4"/><circle cx="12" cy="15" r="1.8" fill="#8a5a0a"/></svg>',
  gift: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="9" width="18" height="12" rx="2" fill="#e8304a"/><rect x="2" y="6" width="20" height="5" rx="1.5" fill="#ff5a6a"/><rect x="10.5" y="6" width="3" height="15" fill="#ffd23f"/><path d="M12 6C9 1 5 3 7 6M12 6c3-5 7-3 5 0" fill="none" stroke="#ffd23f" stroke-width="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="10" fill="#3fd06a"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const THEME_CARD = {
  meadow: 'linear-gradient(160deg,#6fd0ff 0%,#a9e8ff 45%,#66c94a 46%,#3f9e2c 100%)',
  cave: 'linear-gradient(160deg,#1b1638 0%,#3a2f78 50%,#3e3b70 51%,#1e1b3d 100%)',
  desert: 'linear-gradient(160deg,#ff9a5a 0%,#ffd08a 50%,#f2c27e 51%,#c18a42 100%)',
  ice: 'linear-gradient(160deg,#7fa8f0 0%,#d8e6ff 50%,#ffffff 51%,#86c4ec 100%)',
  sky: 'linear-gradient(160deg,#ff8fb0 0%,#ffd2b0 50%,#ffffff 51%,#e0b8f0 100%)',
  castle: 'linear-gradient(160deg,#2a0e1c 0%,#5a1a20 50%,#ff7a1a 51%,#c8301a 100%)',
  bonus: 'linear-gradient(160deg,#070a2a 0%,#43287a 50%,#66f0ff 51%,#4a2f8a 100%)',
};

const UI = {
  game: null,
  current: null,
  back: 'title',

  init(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      Sound.init();
      Sound.sfx('click');
      this.act(b.dataset.act, b.dataset);
    });
    document.getElementById('pauseBtn').addEventListener('click', () => { Sound.init(); this.togglePause(); });
    this.setupSettings();
    game.onClear = (r) => this.showResults(r);
    game.onGameOver = (r) => this.showGameOver(r);
    this.show('title');
  },

  show(name) {
    for (const s of this.root.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
    this.current = name;
    const inGame = name === null;
    document.getElementById('pauseBtn').style.display = inGame ? '' : 'none';
    this.updateTouch();
    if (name === 'title') this.renderTitle();
    if (name === 'map') this.renderMap();
    if (name === 'shop') this.renderShop();
    if (name === 'ach') this.renderAch();
    if (name === 'settings') this.syncSettings();
    if (name && name !== 'pause' && name !== 'results' && name !== 'over') {
      if (Sound.current !== 'title') Sound.play('title');
    }
    const first = this.root.querySelector('.screen.active [data-focus]');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  },

  updateTouch() {
    const set = Save.data.settings.touch;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const on = this.current === null && (set === 'on' || (set === 'auto' && coarse));
    document.getElementById('touch').style.display = on ? '' : 'none';
    this.game.touchOn = on;
  },

  act(a, d) {
    const g = this.game;
    switch (a) {
      case 'play': this.show('map'); break;
      case 'shop': this.back = this.current; this.show('shop'); break;
      case 'ach': this.back = this.current; this.show('ach'); break;
      case 'settings': this.back = this.current; this.show('settings'); break;
      case 'back': this.show(this.back === 'map' ? 'map' : 'title'); this.back = 'title'; break;
      case 'home': this.show('title'); break;
      case 'stage': this.startStage(+d.i); break;
      case 'buy':
        if (Save.buyUpgrade(d.id)) { Sound.sfx('buy'); this.toast('Upgrade purchased!'); this.afterPurchase(); }
        else Sound.sfx('deny');
        this.renderShop(); break;
      case 'skin': {
        const owned = Save.data.skins.includes(d.id);
        if (owned) { Save.data.skin = d.id; Save.save(); Sound.sfx('buy'); }
        else if (Save.buySkin(d.id)) { Sound.sfx('buy'); this.toast('New look unlocked!'); this.afterPurchase(); }
        else Sound.sfx('deny');
        this.renderShop(); break;
      }
      case 'claim': {
        const n = Save.claimAchievement(d.id);
        if (n) { Sound.sfx('chest'); this.toast(`+${n} coins claimed!`); }
        this.renderAch(); break;
      }
      case 'daily': this.openDaily(); break;
      case 'claimDaily': {
        const n = Save.claimDaily();
        if (n) { Sound.sfx('chest'); this.toast(`Daily reward: +${n} coins!`); this.notifyAch(Save.checkAchievements()); }
        this.closeModal(); this.refreshCurrent(); break;
      }
      case 'closeModal': this.closeModal(); break;
      case 'resume': this.togglePause(false); break;
      case 'restart': g.paused = false; g.quitStage(); this.startStage(g.stageIndex); break;
      case 'quit': g.paused = false; g.quitStage(); this.show('map'); break;
      case 'retry': this.startStage(g.stageIndex); break;
      case 'next': this.startStage(+d.i); break;
      case 'map': this.show('map'); break;
      case 'reset':
        if (confirm('Reset ALL progress? Coins, stages, upgrades and achievements will be lost.')) { Save.reset(); this.toast('Progress reset'); this.show('title'); }
        break;
    }
  },

  afterPurchase() { this.notifyAch(Save.checkAchievements()); },
  refreshCurrent() { if (this.current) this.show(this.current); },

  startStage(i) {
    if (!Save.isUnlocked(i)) { Sound.sfx('deny'); return; }
    this.show(null);
    this.game.startStage(i);
  },

  togglePause(force) {
    const g = this.game;
    if (g.mode !== 'stage' || g.state === 'goal') return;
    const p = force === undefined ? !g.paused : force;
    g.paused = p;
    if (p) { this.show('pause'); document.getElementById('pause-info').innerHTML = `${g.def.id} · ${g.def.name}`; }
    else this.show(null);
  },

  // ---------------------------------------------------------------- title
  renderTitle() {
    const badge = document.getElementById('dailyBadge');
    badge.style.display = Save.dailyAvailable() ? '' : 'none';
    const ab = document.getElementById('achBadge');
    const n = Save.unclaimedCount();
    ab.textContent = n; ab.style.display = n ? '' : 'none';
    document.getElementById('title-wallet').innerHTML = `${ICON.coin}<b>${U.fmt(Save.data.coins)}</b>`;
  },

  walletHTML() {
    const d = Save.data;
    return `<div class="chip">${ICON.coin}<b>${U.fmt(d.coins)}</b></div>
      <div class="chip">${ICON.star}<b>${Save.starCount()}</b><span>/${STAGES.length * 3}</span></div>
      <div class="chip">${ICON.medal}<b>${Save.medalCount()}</b><span>/${STAGES.length * 3}</span></div>`;
  },

  // ---------------------------------------------------------------- map
  renderMap() {
    const d = Save.data;
    document.getElementById('map-wallet').innerHTML = this.walletHTML();
    const need = Save.xpFor(d.level);
    document.getElementById('map-rank').innerHTML = `
      <div class="rank-badge">${d.level}</div>
      <div class="rank-info"><div class="rank-name">${Save.rankName()} <span>· Adventurer Rank</span></div>
      <div class="bar"><i style="width:${(d.xp / need) * 100}%"></i></div><div class="rank-xp">${U.fmt(d.xp)} / ${U.fmt(need)} XP · next rank +${50 * (d.level + 1)} coins</div></div>
      <button class="btn small gold daily-btn" data-act="daily">${ICON.gift}<span>Daily</span>${Save.dailyAvailable() ? '<i class="dot"></i>' : ''}</button>`;
    const list = document.getElementById('stage-list');
    list.innerHTML = STAGES.map((st, i) => {
      const s = Save.stage(st.id);
      const open = Save.isUnlocked(i);
      const stars = s.stars.map((v) => (v ? ICON.star : ICON.starOff)).join('');
      const medals = s.medals.map((v) => (v ? ICON.medal : ICON.medalOff)).join('');
      const req = st.requireMedals ? `Find ${st.requireMedals} medals to unlock (${Save.medalCount()}/${st.requireMedals})` : 'Clear the previous stage to unlock';
      return `<button class="stage-card ${open ? '' : 'locked'} ${s.cleared ? 'cleared' : ''}" data-act="stage" data-i="${i}" ${open ? '' : 'disabled'} ${i === 0 ? 'data-focus' : ''}>
        <div class="thumb" style="background:${THEME_CARD[st.theme]}"><span class="sid">${st.id}</span>${st.boss ? '<span class="tag boss">BOSS</span>' : ''}${st.requireMedals ? '<span class="tag secret">SECRET</span>' : ''}${open ? '' : `<div class="lockov">${ICON.lock}</div>`}</div>
        <div class="info"><div class="sname">${st.name}</div><div class="blurb">${open ? st.blurb : req}</div>
        <div class="srow"><span class="stars">${stars}</span><span class="medals">${medals}</span></div>
        <div class="best">${s.cleared ? `Best ${U.fmt(s.best)} · ${U.fmtTime(s.bestTime)}` : open ? `Par time ${U.fmtTime(st.par)}` : ''}</div></div>
      </button>`;
    }).join('');
  },

  // ---------------------------------------------------------------- shop
  renderShop() {
    const d = Save.data;
    document.getElementById('shop-wallet').innerHTML = this.walletHTML();
    document.getElementById('shop-upgrades').innerHTML = SHOP.map((it) => {
      const lvl = d.upgrades[it.id] || 0;
      const cost = Save.upgradeCost(it);
      const pips = Array.from({ length: it.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const btn = cost == null ? '<button class="btn small" disabled>MAXED</button>'
        : `<button class="btn small ${d.coins >= cost ? 'gold' : ''}" data-act="buy" data-id="${it.id}" ${d.coins >= cost ? '' : 'disabled'}>${ICON.coin}${U.fmt(cost)}</button>`;
      return `<div class="item"><div class="item-ic">${ICON[it.icon]}</div><div class="item-body"><div class="item-name">${it.name}</div><div class="item-desc">${it.desc}</div><div class="pips">${pips}</div></div>${btn}</div>`;
    }).join('');
    const sk = document.getElementById('shop-skins');
    sk.innerHTML = SKINS.map((s) => {
      const owned = d.skins.includes(s.id), eq = d.skin === s.id;
      const btn = eq ? '<button class="btn small" disabled>EQUIPPED</button>' : owned ? `<button class="btn small" data-act="skin" data-id="${s.id}">EQUIP</button>`
        : `<button class="btn small ${d.coins >= s.cost ? 'gold' : ''}" data-act="skin" data-id="${s.id}" ${d.coins >= s.cost ? '' : 'disabled'}>${ICON.coin}${U.fmt(s.cost)}</button>`;
      return `<div class="skin ${eq ? 'eq' : ''}"><canvas width="120" height="120" data-skin="${s.id}"></canvas><div class="item-name">${s.name}</div>${btn}</div>`;
    }).join('');
    for (const c of sk.querySelectorAll('canvas')) {
      const ctx = c.getContext('2d');
      ctx.setTransform(2.4, 0, 0, 2.4, 0, 0);
      const skin = SKINS.find((k) => k.id === c.dataset.skin);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.ellipse(25, 45, 14, 3, 0, 0, 7); ctx.fill();
      Art.hero(ctx, { x: 25, y: 45, s: 1, facing: 1, state: 'idle', phase: 0, t: 1, skin, power: 0, vx: 0, blink: false });
    }
  },

  // ---------------------------------------------------------------- achievements
  renderAch() {
    const d = Save.data;
    Save.checkAchievements();
    document.getElementById('ach-wallet').innerHTML = this.walletHTML();
    const done = ACHIEVEMENTS.filter((a) => d.ach[a.id]).length;
    document.getElementById('ach-summary').textContent = `${done} / ${ACHIEVEMENTS.length} unlocked`;
    document.getElementById('ach-list').innerHTML = ACHIEVEMENTS.map((a) => {
      const st = Save.achState(a);
      const [v, goal] = a.prog(d);
      const pct = Math.min(100, (v / goal) * 100);
      const right = st === 'claimed' ? `<div class="claimed">${ICON.check}</div>`
        : st === 'ready' ? `<button class="btn small gold pulse" data-act="claim" data-id="${a.id}">Claim ${ICON.coin}${a.reward}</button>`
        : `<div class="reward">${ICON.coin}${a.reward}</div>`;
      return `<div class="item ach ${st}"><div class="item-ic">${ICON.trophy}</div><div class="item-body"><div class="item-name">${a.name}</div><div class="item-desc">${a.desc}</div>
        <div class="bar small"><i style="width:${pct}%"></i></div><div class="prog">${U.fmt(Math.min(v, goal))} / ${U.fmt(goal)}</div></div>${right}</div>`;
    }).join('');
  },

  // ---------------------------------------------------------------- settings
  setupSettings() {
    const s = Save.data.settings;
    const music = document.getElementById('set-music'), sfx = document.getElementById('set-sfx');
    const apply = () => { s.music = +music.value / 100; s.sfx = +sfx.value / 100; Sound.setVolume(s.music, s.sfx); Save.save(); };
    music.addEventListener('input', apply); sfx.addEventListener('input', apply);
    document.getElementById('set-shake').addEventListener('change', (e) => { s.shake = e.target.checked; Save.save(); });
    document.getElementById('set-touch').addEventListener('change', (e) => { s.touch = e.target.value; Save.save(); this.updateTouch(); });
    Sound.setVolume(s.music, s.sfx);
  },
  syncSettings() {
    const s = Save.data.settings;
    document.getElementById('set-music').value = Math.round(s.music * 100);
    document.getElementById('set-sfx').value = Math.round(s.sfx * 100);
    document.getElementById('set-shake').checked = s.shake;
    document.getElementById('set-touch').value = s.touch;
  },

  // ---------------------------------------------------------------- daily
  openDaily() {
    const avail = Save.dailyAvailable();
    const next = Save.dailyNextDay();
    const days = DAILY_REWARDS.map((r, i) => {
      const day = i + 1;
      const cls = avail ? (day < next ? 'got' : day === next ? 'today' : '') : (day <= next ? 'got' : '');
      return `<div class="day ${cls}"><div class="dn">Day ${day}</div>${day === 7 ? ICON.gift : ICON.coin}<b>${r}</b></div>`;
    }).join('');
    this.modal(`<h2>Daily Reward</h2><p class="muted">Come back every day to grow your streak. Day 7 is the jackpot!</p>
      <div class="days">${days}</div>
      ${avail ? `<button class="btn big gold" data-act="claimDaily" data-focus>Claim ${ICON.coin}${DAILY_REWARDS[next - 1]}</button>` : '<p class="muted">Already claimed today — see you tomorrow!</p>'}
      <button class="btn small ghost" data-act="closeModal">Close</button>`);
  },

  modal(html) {
    const m = document.getElementById('modal');
    m.querySelector('.panel').innerHTML = html;
    m.classList.add('active');
  },
  closeModal() { document.getElementById('modal').classList.remove('active'); },

  // ---------------------------------------------------------------- results
  showResults(r) {
    const nextI = this.game.stageIndex + 1;
    const hasNext = nextI < STAGES.length && Save.isUnlocked(nextI);
    const labels = ['Stage clear', 'All 3 medals', `Under ${U.fmtTime(r.par)}`];
    const stars = [0, 1, 2].map((i) => `<div class="rstar ${r.allStars[i] ? 'on' : ''} ${r.gained.includes(i) ? 'new' : ''}" style="animation-delay:${0.25 + i * 0.25}s">${r.allStars[i] ? ICON.star : ICON.starOff}<span>${labels[i]}</span></div>`).join('');
    const medals = r.savedMedals.map((v, i) => (r.medals[i] ? ICON.medal : v ? `<span class="faded">${ICON.medal}</span>` : ICON.medalOff)).join('');
    const d = Save.data, need = Save.xpFor(d.level);
    const ups = r.levelUps.map((u) => `<div class="levelup">${ICON.trophy} Rank up! Level ${u.level} · ${Save.rankName(u.level)} <b>+${u.reward}</b>${ICON.coin}</div>`).join('');
    const achs = r.achievements.map((a) => `<div class="levelup ach">${ICON.trophy} Achievement: <b>${a.name}</b> — claim it in Achievements</div>`).join('');
    document.getElementById('result-body').innerHTML = `
      <h1 class="rtitle">Stage Clear!</h1>
      <div class="sub">${r.def.id} · ${r.def.name}</div>
      <div class="rstars">${stars}</div>
      <div class="rows">
        <div><span>Score</span><b>${U.fmt(r.score)}${r.newBest ? ' <em>NEW BEST</em>' : ''}</b></div>
        <div><span>Time</span><b>${U.fmtTime(r.time)}${r.flawless ? ' <em class="g">NO HIT</em>' : ''}</b></div>
        <div><span>Medals</span><b class="mrow">${medals}</b></div>
        <div><span>Coins collected</span><b>${ICON.coin}+${r.coins}</b></div>
        ${r.bonusCoins ? `<div><span>${r.firstClear ? 'First clear & star bonus' : 'New star bonus'}</span><b>${ICON.coin}+${r.bonusCoins}</b></div>` : ''}
        <div><span>Experience</span><b>+${U.fmt(r.xp)} XP</b></div>
      </div>
      <div class="xpline"><span>Lv ${d.level} ${Save.rankName()}</span><div class="bar"><i style="width:${(d.xp / need) * 100}%"></i></div></div>
      ${ups}${achs}
      <div class="btnrow">
        <button class="btn" data-act="retry">↻ Retry</button>
        <button class="btn" data-act="map">Map</button>
        ${hasNext ? `<button class="btn primary" data-act="next" data-i="${nextI}" data-focus>Next ▶</button>` : ''}
      </div>`;
    this.show('results');
    Sound.sfx('chest');
  },

  showGameOver(r) {
    document.getElementById('over-body').innerHTML = `
      <h1 class="rtitle bad">Game Over</h1>
      <div class="sub">${r.def.id} · ${r.def.name}</div>
      <p class="muted">You keep the <b>${r.coins}</b> coins you collected. Upgrades in the shop can help!</p>
      <div class="btnrow">
        <button class="btn primary" data-act="retry" data-focus>↻ Try Again</button>
        <button class="btn" data-act="shop">Shop</button>
        <button class="btn" data-act="map">Map</button>
      </div>`;
    this.back = 'map';
    this.show('over');
    this.notifyAch(r.achievements);
  },

  notifyAch(list) { for (const a of list || []) this.toast(`${ICON.trophy} Achievement unlocked: <b>${a.name}</b>`); },

  toast(html) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  },
};
