/* Knockout Arena — UI: HUD, menus, avatar creator, controls/rebinding, settings, results, touch controls */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const A = BX.Audio, I = BX.Input, P = BX.Profile;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const G = () => BX.Game;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kn = (set, action, idx) => BX.keyName((I.bindings[set][action] || [])[idx || 0]);
  const DIFF_IDS = BX.DIFFICULTY.map((d) => d.id);

  const els = {};
  let bannerTimer = 0, introTimer = 0, toastTimer = 0;

  /* ------------------------------------------------------------------ option state for the setup screens */
  const opts = {
    quick: { opp: 0, diff: 'auto', rounds: 3, time: 60, upgrades: true },
    versus: { rounds: 3, time: 60, p2: { name: 'PLAYER 2', skin: '#8d5a36', hair: 'buzz', hairColor: '#15110e', trunks: '#1e5fd6', trim: '#f4f4f4', gloves: '#1e5fd6', boots: '#171717', build: 'avg', stance: 'orthodox' } },
    ctlTab: 'basics',
    from: 'menu',
  };

  const UI = {
    current: null,
    params: {},
    hud: {},
    cache: {},
  };
  BX.UI = UI;

  /* ================================================================== screens */
  const swatches = (list, cur, key) => list.map((c) => `<span class="sw${c === cur ? ' on' : ''}" tabindex="0" role="button" style="background:${c}" data-act="look" data-k="${key}" data-v="${c}"></span>`).join('');
  const chips = (list, cur, act, key) => list.map((c) => {
    const v = Array.isArray(c) ? c[0] : c, l = Array.isArray(c) ? c[1] : c;
    return `<span class="chip${String(v) === String(cur) ? ' on' : ''}" tabindex="0" role="button" data-act="${act}" data-k="${key}" data-v="${esc(v)}">${esc(l)}</span>`;
  }).join('');
  const toggle = (label, key, on, sub) => `<div class="toggle"><label>${label}${sub ? `<div class="tiny muted">${sub}</div>` : ''}</label><div class="switch${on ? ' on' : ''}" tabindex="0" role="switch" data-act="toggle" data-k="${key}"></div></div>`;
  const statRows = (stats, editable) => BX.STAT_DEFS.map(([k, label, desc]) => {
    const v = stats[k];
    let pips = '';
    for (let i = 0; i < BX.MAX_STAT; i++) pips += `<div class="pip${i < v ? ' on' : ''}"></div>`;
    const pts = P.get().points;
    return `<div class="stat-row" title="${esc(desc)}"><span>${label}</span><div style="display:grid;grid-template-columns:repeat(${BX.MAX_STAT},1fr);gap:3px">${pips}</div>${editable ? `<span class="btns"><button class="mini" data-act="stat" data-v="${k}" data-d="-1" ${v <= 0 ? 'disabled' : ''}>−</button><button class="mini" data-act="stat" data-v="${k}" data-d="1" ${pts <= 0 || v >= BX.MAX_STAT ? 'disabled' : ''}>+</button></span>` : '<span></span>'}</div>`;
  }).join('');
  const faceCircle = (look) => `<div class="face" style="background:${look.trunks};border-color:${look.skin};color:${BX.hexToInt(look.trunks) > 0xaaaaaa ? '#111' : '#fff'}">${esc((look.name || '?')[0])}</div>`;
  const back = (to) => `<button class="btn" data-act="back" data-v="${to || 'menu'}">← Back</button>`;

  const hintLine = (set) => ['up', 'left', 'down', 'right'].map((a) => kn(set, a)).join(' ');

  const screens = {
    /* ---------------- main menu ---------------- */
    menu() {
      const p = P.get();
      return `<div class="screen menu">
        <div class="logo"><span class="l1">KNOCKOUT</span><span class="l2">ARENA</span><small>3D BOXING</small></div>
        <nav class="mainnav">
          <button class="btn primary big wide" data-act="go" data-v="career">Career<span class="sub">Stage ${Math.min(p.career.stage + 1, BX.ROSTER.length)} of ${BX.ROSTER.length}${p.career.champion ? ' · CHAMPION' : ''}${p.points ? ' · ' + p.points + ' upgrade pts' : ''}</span></button>
          <button class="btn big" data-act="go" data-v="quick">Quick Fight</button>
          <button class="btn big" data-act="go" data-v="versus">2-Player</button>
          <button class="btn big" data-act="startTraining">Training</button>
          <button class="btn big" data-act="go" data-v="avatar">My Boxer</button>
          <button class="btn" data-act="go" data-v="controls">Controls</button>
          <button class="btn" data-act="go" data-v="settings">Settings</button>
        </nav>
        <div class="card">
          <h3>${esc(p.look.name)} <span class="muted tiny">· Record ${p.record.wins}W – ${p.record.losses}L – ${p.record.draws}D · ${p.record.kos} KOs</span></h3>
          <p><b class="gold">Move</b> <span class="kbd">${kn('solo', 'up')}</span><span class="kbd">${kn('solo', 'left')}</span><span class="kbd">${kn('solo', 'down')}</span><span class="kbd">${kn('solo', 'right')}</span>
          &nbsp;<b class="gold">Punch</b> <span class="kbd">${kn('solo', 'jab')}</span><span class="kbd">${kn('solo', 'cross')}</span><span class="kbd">${kn('solo', 'leadHook')}</span><span class="kbd">${kn('solo', 'rearHook')}</span><span class="kbd">${kn('solo', 'leadUpper')}</span><span class="kbd">${kn('solo', 'rearUpper')}</span></p>
          <p><b class="gold">Block</b> <span class="kbd">${kn('solo', 'block')}</span> &nbsp;<b class="gold">Duck</b> <span class="kbd">${kn('solo', 'crouch')}</span> &nbsp;<b class="gold">Slip</b> <span class="kbd">${kn('solo', 'slipL')}</span><span class="kbd">${kn('solo', 'slipR')}</span> &nbsp;<b class="gold">Dash</b> <span class="kbd">${kn('solo', 'dodge')}</span> &nbsp;<b class="gold">FURY</b> <span class="kbd">${kn('solo', 'special')}</span></p>
          <p class="tiny">Gamepad and touch controls are supported too — open <b>Controls</b> for the full list and key rebinding. New here? Try <b>Training</b> first.</p>
        </div>
      </div>`;
    },

    /* ---------------- career ---------------- */
    career() {
      const p = P.get();
      const ladder = BX.ROSTER.map((o, i) => {
        const beaten = i < p.career.stage, next = i === p.career.stage, locked = i > p.career.stage;
        const d = BX.DIFFICULTY[o.diff];
        return `<div class="opp${locked ? ' locked' : ''}" tabindex="${locked ? -1 : 0}" role="button" data-act="startCareer" data-v="${i}">
          ${faceCircle(o.look)}
          <div><div class="nm">${esc(o.name)}</div><div class="nk">${esc(o.nick)} · ${esc(o.style)}</div><div class="ds">${esc(o.desc)}</div></div>
          <div class="stack" style="align-items:flex-end"><span class="badge ${d.id}">${d.name}</span><span class="badge ${beaten ? 'beaten' : next ? 'next' : 'lock'}">${beaten ? 'Beaten' : next ? 'Next fight' : 'Locked'}</span></div>
        </div>`;
      }).join('');
      return `<div class="screen">
        <div class="topbar"><h1 class="title">CAREER<small>${p.career.champion ? 'YOU ARE THE CHAMPION — fight any rival again' : 'Beat all five rivals to take the belt'}</small></h1>${back('menu')}</div>
        <div class="split">
          <div class="card stack">
            <h3>YOUR BOXER — ${esc(p.look.name)}</h3>
            ${statRows(p.stats, true)}
            <div class="row-wrap"><span class="gold" style="font-family:var(--head);font-size:22px;letter-spacing:2px">${p.points} UPGRADE POINT${p.points === 1 ? '' : 'S'}</span><span class="tiny muted">Win fights to earn more (+1 for a KO)</span></div>
            <div class="row-wrap"><button class="btn small" data-act="go" data-v="avatar">Edit boxer</button><button class="btn small ghost" data-act="resetCareer">Reset career</button></div>
          </div>
          <div class="stack">${ladder}</div>
        </div>
      </div>`;
    },

    /* ---------------- quick fight ---------------- */
    quick() {
      const q = opts.quick;
      const list = BX.ROSTER.map((o, i) => `<div class="opp${q.opp === i ? ' sel' : ''}" tabindex="0" role="button" data-act="setOpt" data-g="quick" data-k="opp" data-v="${i}">
        ${faceCircle(o.look)}<div><div class="nm">${esc(o.name)}</div><div class="nk">${esc(o.nick)} · ${esc(o.style)}</div><div class="ds">${esc(o.desc)}</div></div>
        <span class="badge ${BX.DIFFICULTY[o.diff].id}">${BX.DIFFICULTY[o.diff].name}</span></div>`).join('');
      return `<div class="screen">
        <div class="topbar"><h1 class="title">QUICK FIGHT<small>Pick an opponent and the rules</small></h1>${back('menu')}</div>
        <div class="split" style="grid-template-columns:1fr minmax(260px,360px)">
          <div class="stack">${list}</div>
          <div class="card stack">
            <h3>RULES</h3>
            <span class="lbl">DIFFICULTY</span><div class="row-wrap">${chips([['auto', 'Rival default'], ...BX.DIFFICULTY.map((d) => [d.id, d.name])], q.diff, 'setOpt', 'diff').replace(/data-act="setOpt"/g, 'data-act="setOpt" data-g="quick"')}</div>
            <span class="lbl">ROUNDS</span><div class="row-wrap">${chips([1, 3, 5, 12], q.rounds, 'setOpt', 'rounds').replace(/data-act="setOpt"/g, 'data-act="setOpt" data-g="quick"')}</div>
            <span class="lbl">ROUND LENGTH</span><div class="row-wrap">${chips([[30, '0:30'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']], q.time, 'setOpt', 'time').replace(/data-act="setOpt"/g, 'data-act="setOpt" data-g="quick"')}</div>
            ${toggle('Use my career upgrades', 'quick.upgrades', q.upgrades, 'Off = both boxers have base stats')}
            <button class="btn primary big" data-act="startQuick">FIGHT!</button>
          </div>
        </div>
      </div>`;
    },

    /* ---------------- versus ---------------- */
    versus() {
      const v = opts.versus, p2 = v.p2;
      const s = (set) => `<div class="pad-map"><b class="gold">Move</b><span>${hintLine(set)}</span><b class="gold">Punches</b><span>${['jab', 'cross', 'leadHook', 'rearHook', 'leadUpper', 'rearUpper'].map((a) => kn(set, a)).join(' ')}</span><b class="gold">Block / Duck</b><span>${kn(set, 'block')} / ${kn(set, 'crouch')}</span><b class="gold">Slip / Dash</b><span>${kn(set, 'slipL')} ${kn(set, 'slipR')} / ${kn(set, 'dodge')}</span><b class="gold">FURY</b><span>${kn(set, 'special')}</span></div>`;
      return `<div class="screen">
        <div class="topbar"><h1 class="title">2-PLAYER VERSUS<small>Two boxers, one keyboard (or two gamepads)</small></h1>${back('menu')}</div>
        <div class="grid2">
          <div class="card stack"><h3>PLAYER 1 — ${esc(P.get().look.name)}</h3><p>Uses your boxer from <b>My Boxer</b> (base stats).</p>${s('p1')}</div>
          <div class="card stack"><h3>PLAYER 2</h3>
            <input type="text" maxlength="10" value="${esc(p2.name)}" data-input="p2name" aria-label="Player 2 name">
            <span class="lbl">SKIN</span><div class="row-wrap">${swatches(BX.SKINS, p2.skin, 'p2.skin')}</div>
            <span class="lbl">TRUNKS</span><div class="row-wrap">${swatches(BX.COLORS, p2.trunks, 'p2.trunks')}</div>
            <span class="lbl">GLOVES</span><div class="row-wrap">${swatches(BX.COLORS, p2.gloves, 'p2.gloves')}</div>
            <span class="lbl">BUILD / STANCE</span><div class="row-wrap">${chips(BX.BUILDS, p2.build, 'look', 'p2.build')}${chips([['orthodox', 'Orthodox'], ['southpaw', 'Southpaw']], p2.stance, 'look', 'p2.stance')}</div>
            ${s('p2')}
          </div>
        </div>
        <div class="card"><div class="row-wrap">
          <span class="lbl" style="margin:0">ROUNDS</span>${chips([1, 3, 5], v.rounds, 'setOpt', 'rounds').replace(/data-act="setOpt"/g, 'data-act="setOpt" data-g="versus"')}
          <span class="lbl" style="margin:0 0 0 14px">TIME</span>${chips([[30, '0:30'], [60, '1:00'], [90, '1:30'], [120, '2:00']], v.time, 'setOpt', 'time').replace(/data-act="setOpt"/g, 'data-act="setOpt" data-g="versus"')}
          <span class="sp"></span><button class="btn primary big" data-act="startVersus">FIGHT!</button></div>
          <p class="tiny muted">Tip: rebind either player's keys in <b>Controls</b>. With a controller connected, pad 1 drives Player 1 and pad 2 drives Player 2.</p></div>
      </div>`;
    },

    /* ---------------- avatar creator ---------------- */
    avatar() {
      const l = P.get().look;
      return `<div class="screen" style="max-width:430px;margin:0">
        <div class="topbar"><h1 class="title">MY BOXER<small>Drag the boxer to rotate</small></h1></div>
        <div class="card stack">
          <span class="lbl">NAME</span><input type="text" maxlength="10" value="${esc(l.name)}" data-input="name" aria-label="Boxer name">
          <span class="lbl">SKIN</span><div class="row-wrap">${swatches(BX.SKINS, l.skin, 'skin')}</div>
          <span class="lbl">HAIR STYLE</span><div class="row-wrap">${chips(BX.HAIR_STYLES, l.hair, 'look', 'hair')}</div>
          <span class="lbl">HAIR COLOUR</span><div class="row-wrap">${swatches(BX.HAIR_COLORS, l.hairColor, 'hairColor')}</div>
          <span class="lbl">BUILD</span><div class="row-wrap">${chips(BX.BUILDS, l.build, 'look', 'build')}</div>
          <span class="lbl">STANCE</span><div class="row-wrap">${chips([['orthodox', 'Orthodox (left lead)'], ['southpaw', 'Southpaw (right lead)']], l.stance, 'look', 'stance')}</div>
          <span class="lbl">TRUNKS</span><div class="row-wrap">${swatches(BX.COLORS, l.trunks, 'trunks')}</div>
          <span class="lbl">TRIM</span><div class="row-wrap">${swatches(BX.COLORS, l.trim, 'trim')}</div>
          <span class="lbl">GLOVES</span><div class="row-wrap">${swatches(BX.COLORS, l.gloves, 'gloves')}</div>
          <span class="lbl">BOOTS</span><div class="row-wrap">${swatches(BX.COLORS, l.boots, 'boots')}</div>
        </div>
        <div class="row-wrap"><button class="btn" data-act="randomLook">🎲 Randomise</button><span class="sp"></span><button class="btn primary" data-act="back" data-v="menu">Done</button></div>
      </div>`;
    },

    /* ---------------- controls ---------------- */
    controls() {
      const tab = opts.ctlTab;
      const tabs = [['basics', 'How to play'], ['solo', 'Keyboard'], ['p1', 'Versus P1'], ['p2', 'Versus P2'], ['pad', 'Gamepad'], ['touch', 'Mouse & touch']];
      let body = '';
      if (tab === 'basics') {
        body = `<div class="help-grid">
          <div class="card"><h3>Goal</h3><p>Drain your opponent's <b>health</b>. At zero they hit the canvas — the referee counts to ten. Three knockdowns in a round is a TKO. If nobody is stopped, three judges score every round.</p></div>
          <div class="card"><h3>Footwork</h3><p>You always face your opponent. <b>Forward / back</b> close or open the gap, <b>left / right</b> circle around them. Punches only connect inside their range — whiffing leaves you open.</p></div>
          <div class="card"><h3>Punches</h3><p><b>Jab</b> fast &amp; light. <b>Cross</b> strong straight. <b>Hooks</b> wide, heavy, slower. <b>Uppercuts</b> short range, hit through a guard-less chin. Your <b>lead</b> hand is the left one for Orthodox, right for Southpaw.</p></div>
          <div class="card"><h3>Head &amp; body</h3><p>Standing punches go to the <b>head</b>. Hold <b>Crouch</b> to throw <b>body shots</b> — less damage, but they drain stamina fast. Crouching also ducks head-high straights and hooks.</p></div>
          <div class="card"><h3>Defence</h3><p><b>Block</b> soaks most damage but drains stamina; at zero your guard breaks. <b>Slip</b> dodges straights &amp; uppercuts. <b>Duck</b> beats hooks &amp; jabs. <b>Dash</b> dodges everything except FURY punches.</p></div>
          <div class="card"><h3>Counters &amp; FURY</h3><p>Hit an opponent mid-punch (or after a dodge) for <b>COUNTER</b> bonus damage. Landing and taking hits fills the <b>FURY</b> meter — when it glows, the FURY punch is a huge unblockable-guard-breaker.</p></div>
          <div class="card"><h3>Stamina</h3><p>Every punch, dash and slip costs stamina. Empty stamina means weaker, slower punches. Back off to recover — or stay covered up.</p></div>
          <div class="card"><h3>Getting up</h3><p>When you're down, <b>mash any punch button</b> to fill the meter. You can't rise before a count of 3, and you must beat 10.</p></div>
        </div>
        <p class="tiny muted">Global keys: <span class="kbd">Esc</span>/<span class="kbd">P</span> pause · <span class="kbd">Tab</span> camera · <span class="kbd">H</span> controls · <span class="kbd">O</span> sound on/off · Mouse: left click = jab, right click = cross (single player).</p>`;
      } else if (tab === 'pad') {
        body = `<div class="card"><h3>Gamepad (standard layout)</h3><div class="pad-map">
          <b class="gold">Left stick / D-pad</b><span>Step forward &amp; back, circle left &amp; right</span>
          <b class="gold">X / ■</b><span>Jab</span><b class="gold">A / ✕</b><span>Cross</span>
          <b class="gold">Y / △</b><span>Lead hook</span><b class="gold">B / ○</b><span>Rear hook</span>
          <b class="gold">LB / L1</b><span>Lead uppercut</span><b class="gold">RB / R1</b><span>Rear uppercut</span>
          <b class="gold">LT / L2</b><span>Block (hold)</span><b class="gold">RT / R2</b><span>Crouch — body shots (hold)</span>
          <b class="gold">Right stick ← →</b><span>Slip left / right</span><b class="gold">Right stick ↓</b><span>Dash back (hold a direction with the left stick to dash that way)</span>
          <b class="gold">Back / Select</b><span>FURY punch</span><b class="gold">D-pad ↓</b><span>Taunt</span>
          <b class="gold">Start</b><span>Pause</span></div>
          <p class="tiny muted">In 2-player mode the first controller is Player 1 and the second is Player 2. Menus can be navigated with the D-pad, A to select, B to go back.</p></div>`;
      } else if (tab === 'touch') {
        body = `<div class="card"><h3>Mouse</h3><p>In single player the <b>left mouse button</b> throws a jab and the <b>right button</b> throws a cross. The HUD buttons (top right) pause, switch camera and toggle sound.</p></div>
          <div class="card"><h3>Touch screens</h3><p>On phones and tablets an on-screen joystick (left) moves you; the buttons on the right throw punches; <b>BLOCK</b> and <b>DUCK</b> are hold buttons; <b>SLIP</b> and <b>DASH</b> dodge; <b>FURY</b> lights up when your meter is full. Enable or disable them in Settings.</p></div>`;
      } else {
        const set = tab;
        const rows = BX.ACTIONS.map(([a, label]) => {
          const keys = I.bindings[set][a] || [];
          const cap = (i) => `<span class="keycap${keys[i] ? '' : ' empty'}" tabindex="0" role="button" data-act="bind" data-s="${set}" data-a="${a}" data-i="${i}">${keys[i] ? esc(BX.keyName(keys[i])) : '—'}</span>`;
          return `<span class="a">${esc(label)}</span>${cap(0)}${cap(1)}`;
        }).join('');
        body = `<div class="card"><h3>${BX.BINDING_SETS.find((s) => s[0] === set)[1]}</h3>
          <p class="tiny">Click a key, then press the new key (Esc cancels). Each action has two slots. ${set === 'solo' ? 'Mouse buttons also jab and cross.' : ''}</p>
          <div class="keytable">${rows}</div>
          <div class="row-wrap" style="margin-top:10px"><button class="btn small" data-act="resetBinds">Reset all keys to default</button></div></div>`;
      }
      return `<div class="screen">
        <div class="topbar"><h1 class="title">CONTROLS<small>Keyboard · mouse · gamepad · touch</small></h1>${back(opts.from === 'pause' ? 'pause' : 'menu')}</div>
        <div class="tabs">${tabs.map((t) => `<span class="tab${t[0] === tab ? ' on' : ''}" tabindex="0" role="button" data-act="tab" data-v="${t[0]}">${t[1]}</span>`).join('')}</div>
        <div class="stack">${body}</div>
      </div>`;
    },

    /* ---------------- settings ---------------- */
    settings() {
      const s = G().settings;
      return `<div class="screen" style="max-width:760px">
        <div class="topbar"><h1 class="title">SETTINGS</h1>${back(opts.from === 'pause' ? 'pause' : 'menu')}</div>
        <div class="grid2">
          <div class="card"><h3>Audio</h3>
            <span class="lbl">MASTER VOLUME ${Math.round(s.volume * 100)}%</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-slider="volume">
            ${toggle('Sound effects & crowd', 'sfx', s.sfx)}${toggle('Music', 'music', s.music)}${toggle('Referee voice (speech)', 'speech', s.speech)}
          </div>
          <div class="card"><h3>Graphics</h3>
            <span class="lbl">QUALITY</span><div class="row-wrap">${chips([['low', 'Low'], ['med', 'Medium'], ['high', 'High']], s.quality, 'setting', 'quality')}</div>
            <p class="tiny">Low: no shadows, small crowd. Pick Low on slow phones.</p>
            ${toggle('Camera shake', 'shake', s.shake)}${toggle('Show FPS', 'fps', s.fps)}
          </div>
          <div class="card"><h3>Gameplay</h3>
            <span class="lbl">CAMERA (TAB TO CYCLE)</span><div class="row-wrap">${chips([['behind', 'Over shoulder'], ['side', 'Side'], ['high', 'High'], ['broadcast', 'Broadcast']], s.camera, 'setting', 'camera')}</div>
            ${toggle('Show key hints in fights', 'hints', s.hints)}
            <span class="lbl">TOUCH CONTROLS</span><div class="row-wrap">${chips([['auto', 'Auto'], ['on', 'Always on'], ['off', 'Off']], s.touch, 'setting', 'touch')}</div>
          </div>
          <div class="card"><h3>Data</h3>
            <p class="tiny">Your boxer, upgrades, career and key bindings are saved in this browser.</p>
            <div class="row-wrap"><button class="btn small" data-act="resetAll">Erase all saved data</button></div>
          </div>
        </div>
      </div>`;
    },

    /* ---------------- pause ---------------- */
    pause() {
      return `<div class="screen center" style="gap:12px;max-width:420px">
        <h1 class="title">PAUSED</h1>
        <button class="btn primary big" style="width:100%" data-act="resume">Resume</button>
        <button class="btn big" style="width:100%" data-act="restart">Restart fight</button>
        <button class="btn" style="width:100%" data-act="pauseTo" data-v="controls">Controls</button>
        <button class="btn" style="width:100%" data-act="pauseTo" data-v="settings">Settings</button>
        <button class="btn ghost" style="width:100%" data-act="quit">Quit to menu</button>
      </div>`;
    },

    /* ---------------- between rounds ---------------- */
    rest() {
      const g = G();
      const rows = g.roundCards.map((rc, i) => `<tr><td class="l">Round ${i + 1}</td>${rc.map((c) => `<td>${c[0]}–${c[1]}</td>`).join('')}</tr>`).join('');
      const a = g.stats[0], b = g.stats[1];
      const tips = ['Circle away from their power hand and jab to keep the range.', 'Crouch and go to the body — a tired opponent drops their guard.', 'Slip a jab and counter with a cross for bonus damage.', 'Don\'t hold block forever: stamina drains and your guard will break.', 'Save FURY for when they are tired or on the ropes.', 'Throw combos, not single shots — and move after you punch.'];
      const nm = g.fighters.map((f) => esc(f.look.name));
      return `<div class="screen center" style="max-width:640px;gap:14px">
        <h1 class="title">END OF ROUND ${g.round}<small>${nm[0]} vs ${nm[1]}</small></h1>
        <div class="card" style="width:100%"><table class="scorecard"><tr><th class="l"></th><th>Judge 1</th><th>Judge 2</th><th>Judge 3</th></tr>${rows}</table>
        <p class="tiny muted">Scores read ${nm[0]}–${nm[1]}</p></div>
        <div class="card" style="width:100%"><table class="statcmp">
          <tr><td>${a.landed}/${a.thrown}</td><td class="k">Punches landed</td><td>${b.landed}/${b.thrown}</td></tr>
          <tr><td>${a.kds}</td><td class="k">Knockdowns</td><td>${b.kds}</td></tr></table></div>
        <p class="muted">💡 ${esc(BX.pick(tips))}</p>
        <p class="tiny muted">Your corner patches you up: some health and most stamina are restored.</p>
        <button class="btn primary big" data-act="nextRound">Ring the bell — Round ${g.round + 1}</button>
      </div>`;
    },

    /* ---------------- result ---------------- */
    result() {
      const r = UI.params.res;
      const reward = UI.params.reward;
      const names = r.names.map(esc);
      const you = r.winner === 0, versus = r.mode === 'versus';
      let title, tcls;
      if (r.winner < 0) { title = 'DRAW'; tcls = 'win'; }
      else if (versus) { title = names[r.winner] + ' WINS'; tcls = 'win'; }
      else if (you) { title = 'YOU WIN!'; tcls = 'win'; }
      else { title = 'YOU LOSE'; tcls = 'lose'; }
      const methodText = { KO: 'Knockout', TKO: 'Technical knockout (3 knockdowns)', UD: 'Unanimous decision', SD: 'Split decision', MD: 'Majority decision', DRAW: 'Draw' }[r.method];
      const when = (r.method === 'KO' || r.method === 'TKO') ? ` — Round ${r.round}, ${BX.fmtTime(r.timeLeft)} remaining` : '';
      const cards = r.method === 'KO' || r.method === 'TKO' || r.mode === 'training' ? '' : `<p class="muted">Scorecards: ${r.totals.map((t) => t[0] + '–' + t[1]).join(' · ')}</p>`;
      const sa = r.stats[0], sb = r.stats[1];
      const acc = (s) => (s.thrown ? Math.round((s.landed / s.thrown) * 100) + '%' : '–');
      const row = (k, x, y, hi) => {
        const nx = parseFloat(x), ny = parseFloat(y);
        const cx = hi && nx > ny ? 'w' : '', cy = hi && ny > nx ? 'w' : '';
        return `<tr><td class="${cx}">${x}</td><td class="k">${k}</td><td class="${cy}">${y}</td></tr>`;
      };
      let rewardHtml = '';
      if (reward && r.cfg.career != null) {
        if (r.winner === 0) {
          rewardHtml = `<div class="card" style="border-color:var(--gold)"><h3>CAREER</h3><p>+${reward.points} upgrade point${reward.points === 1 ? '' : 's'}${reward.stageUp ? ' · next rival unlocked!' : ''}${reward.champion ? ' · <b class="gold">YOU ARE THE CHAMPION OF THE WORLD!</b>' : ''}</p></div>`;
        } else if (r.winner === 1) rewardHtml = `<div class="card"><h3>CAREER</h3><p>You lost this one — hit the gym, spend your upgrade points and come back stronger.</p></div>`;
      }
      let btns = '';
      if (r.mode === 'career') {
        const p = P.get();
        const nextOk = r.winner === 0 && r.cfg.career + 1 < BX.ROSTER.length;
        btns = `${nextOk ? `<button class="btn primary big" data-act="startCareer" data-v="${r.cfg.career + 1}">Next rival</button>` : ''}
          <button class="btn ${nextOk ? '' : 'primary'} big" data-act="rematch">${r.winner === 0 ? 'Rematch' : 'Try again'}</button>
          <button class="btn" data-act="go" data-v="career">Career &amp; upgrades</button>`;
      } else btns = `<button class="btn primary big" data-act="rematch">Rematch</button>`;
      btns += `<button class="btn" data-act="quit2">Main menu</button>`;
      return `<div class="screen center" style="max-width:720px;gap:12px">
        <h1 class="result-title ${tcls}">${title}</h1>
        <div class="title" style="font-size:clamp(24px,4vw,40px);color:var(--gold)">${esc(r.method)}<small style="color:var(--text)">${methodText}${when}</small></div>
        ${cards}
        <div class="card" style="width:100%"><table class="statcmp">
          <tr><td class="k">${names[0]}</td><td class="k"></td><td class="k">${names[1]}</td></tr>
          ${row('Punches landed', sa.landed + '/' + sa.thrown, sb.landed + '/' + sb.thrown, false)}
          ${row('Accuracy', acc(sa), acc(sb), true)}
          ${row('Power punches', sa.power, sb.power, true)}
          ${row('Damage dealt', Math.round(sa.dmg), Math.round(sb.dmg), true)}
          ${row('Knockdowns', sa.kds, sb.kds, true)}
          ${row('Counter punches', sa.counters, sb.counters, true)}
          ${row('Blocked / dodged', sa.blocked + ' / ' + sa.dodged, sb.blocked + ' / ' + sb.dodged, false)}
          ${row('Best combo', sa.bestCombo, sb.bestCombo, true)}
        </table></div>
        ${rewardHtml}
        <div class="row-wrap" style="justify-content:center">${btns}</div>
      </div>`;
    },
  };

  /* ================================================================== show / navigation */
  UI.show = function (name, params) {
    const ov = els.overlay;
    UI.current = name;
    UI.params = params || {};
    const first = UI._lastRendered !== name;
    const keepScroll = !first ? ($('.screen', ov) || {}).scrollTop : 0;
    ov.innerHTML = screens[name]();
    ov.classList.remove('hidden', 'clear', 'dim');
    if (name === 'avatar') ov.classList.add('clear');
    if (name === 'pause' || name === 'rest' || name === 'result') ov.classList.add('dim');
    const sc = $('.screen', ov);
    if (sc && keepScroll) sc.scrollTop = keepScroll;
    UI._lastRendered = name;
    if (name === 'avatar') { if (first) G().showMenuScene({ solo: true }); G().setViewShift(0.2); }
    else if (G().mode === 'menu') { G().setViewShift(0); if (G().stage === 'solo') G().showMenuScene(); }
    // focus the first interactive element for keyboard / gamepad users
    if (!UI._noFocus) { const f = $('.btn.primary, .btn, .opp, .chip', ov); f && f !== document.activeElement && !['avatar'].includes(name) && f.focus({ preventScroll: true }); }
    UI._noFocus = false;
  };
  UI.refresh = function () {
    const ov = els.overlay;
    const idx = $$('[tabindex], .btn, .mini', ov).indexOf(document.activeElement);
    UI._noFocus = true;
    UI.show(UI.current, UI.params);
    if (idx >= 0) { const l = $$('[tabindex], .btn, .mini', ov); l[idx] && l[idx].focus({ preventScroll: true }); }
  };
  UI.hideOverlay = function () { els.overlay.classList.add('hidden'); els.overlay.innerHTML = ''; UI.current = null; };
  UI.back = function (to) {
    A.ui('back');
    if (UI.current === 'avatar') G().setViewShift(0);
    opts.from = 'menu';
    const t = to || 'menu';
    if (t === 'pause') { UI.show('pause'); return; }
    UI.show(t);
  };

  /* ================================================================== actions */
  const careerCfg = (i) => {
    const p = P.get(), o = BX.ROSTER[i], s = G().settings;
    return {
      mode: 'career', career: i, looks: [p.look, o.look], stats: [p.stats, o.stats],
      ai: { diff: o.diff, style: o.style }, rounds: s.rounds, roundTime: s.roundTime,
      meta: [{ corner: 'RED CORNER', nick: 'The Challenger' }, { corner: 'BLUE CORNER', nick: o.nick }],
    };
  };
  const launch = (cfg) => { UI.hideOverlay(); G().setViewShift(0); G().startFight(cfg); };

  const ACTIONS = {
    go(el) { A.ui('select'); if (el.dataset.v === 'controls' || el.dataset.v === 'settings') opts.from = 'menu'; UI.show(el.dataset.v); },
    back(el) { UI.back(el.dataset.v); },
    startCareer(el) { A.ui('select'); launch(careerCfg(+el.dataset.v)); },
    startQuick() {
      const q = opts.quick, o = BX.ROSTER[q.opp], p = P.get();
      launch({
        mode: 'solo', looks: [p.look, o.look], stats: [q.upgrades ? p.stats : { power: 0, speed: 0, stamina: 0, chin: 0 }, q.upgrades ? o.stats : { power: 0, speed: 0, stamina: 0, chin: 0 }],
        ai: { diff: q.diff === 'auto' ? o.diff : DIFF_IDS.indexOf(q.diff), style: o.style }, rounds: q.rounds, roundTime: q.time,
        meta: [{ corner: 'RED CORNER', nick: 'The Challenger' }, { corner: 'BLUE CORNER', nick: o.nick }],
      });
    },
    startVersus() {
      const v = opts.versus, p = P.get();
      const l1 = Object.assign({}, p.look), l2 = Object.assign({}, v.p2);
      if (l1.name === l2.name) l2.name = l2.name + '2';
      launch({
        mode: 'versus', looks: [l1, l2], stats: [{ power: 0, speed: 0, stamina: 0, chin: 0 }, { power: 0, speed: 0, stamina: 0, chin: 0 }],
        ai: null, rounds: v.rounds, roundTime: v.time,
        meta: [{ corner: 'RED CORNER', nick: 'Player 1' }, { corner: 'BLUE CORNER', nick: 'Player 2' }],
      });
    },
    startTraining() {
      const p = P.get();
      const dummy = Object.assign({}, BX.ROSTER[0].look, { name: 'COACH', trunks: '#f4f4f4', trim: '#171717', gloves: '#f2b705', hair: 'bald' });
      launch({
        mode: 'training', looks: [p.look, dummy], stats: [p.stats, { power: 0, speed: 0, stamina: 4, chin: 8 }],
        ai: { diff: 0, style: 'dummy' }, rounds: 1, roundTime: 600,
        meta: [{ corner: 'YOU', nick: 'Training' }, { corner: 'SPARRING', nick: 'Practice partner' }],
      });
    },
    setOpt(el) {
      const g = el.dataset.g, k = el.dataset.k;
      let v = el.dataset.v;
      if (/^\d+$/.test(v)) v = +v;
      opts[g][k] = v;
      if (g === 'quick' && k === 'diff' && v !== 'auto') opts.quick.diff = String(v);
      A.ui('tick');
      UI.refresh();
    },
    look(el) {
      const k = el.dataset.k, v = el.dataset.v;
      A.ui('tick');
      if (k.indexOf('p2.') === 0) { opts.versus.p2[k.slice(3)] = v; UI.refresh(); return; }
      const look = Object.assign({}, P.get().look);
      look[k] = v;
      P.setLook(look);
      G().refreshShowcase(look);
      UI.refresh();
    },
    randomLook() {
      const look = Object.assign({}, P.get().look, {
        skin: BX.pick(BX.SKINS), hair: BX.pick(BX.HAIR_STYLES)[0], hairColor: BX.pick(BX.HAIR_COLORS), build: BX.pick(BX.BUILDS)[0],
        stance: BX.chance(0.25) ? 'southpaw' : 'orthodox', trunks: BX.pick(BX.COLORS), trim: BX.pick(BX.COLORS), gloves: BX.pick(BX.COLORS), boots: BX.pick(BX.COLORS),
      });
      P.setLook(look);
      G().refreshShowcase(look);
      A.ui('select');
      UI.refresh();
    },
    stat(el) {
      const ok = +el.dataset.d > 0 ? P.spend(el.dataset.v) : P.refund(el.dataset.v);
      if (ok) A.ui('tick');
      UI.refresh();
    },
    tab(el) { opts.ctlTab = el.dataset.v; UI.refresh(); },
    bind(el) {
      const { s, a, i } = el.dataset;
      el.classList.add('wait'); el.textContent = 'press key…';
      I.capture = (code, cancelled) => {
        if (!cancelled && code) I.setBinding(s, a, +i, code);
        UI.refresh();
      };
    },
    resetBinds() { I.resetBindings(); A.ui('select'); UI.refresh(); },
    toggle(el) {
      const k = el.dataset.k;
      if (k.indexOf('quick.') === 0) { opts.quick[k.slice(6)] = !opts.quick[k.slice(6)]; UI.refresh(); return; }
      const s = G().settings;
      s[k] = !s[k];
      G().saveSettings();
      G().applySettings();
      UI.refresh();
      if (k === 'fps') els.fps.classList.toggle('hidden', !s.fps);
    },
    setting(el) {
      const s = G().settings;
      s[el.dataset.k] = el.dataset.v;
      G().saveSettings();
      G().applySettings();
      if (el.dataset.k === 'touch') UI.updateTouchVisibility();
      A.ui('tick');
      UI.refresh();
    },
    resetCareer() { if (confirm('Reset your career progress? (Your boxer and upgrades are kept.)')) { P.resetCareer(); UI.refresh(); } },
    resetAll() { if (confirm('Erase your boxer, career, settings and key bindings?')) { BX.store.remove('profile'); BX.store.remove('settings'); BX.store.remove('bindings'); location.reload(); } },
    resume() { G().resume(); },
    restart() { UI.hideOverlay(); G().restartFight(); },
    pauseTo(el) { opts.from = 'pause'; UI.show(el.dataset.v); },
    quit() { UI.hideOverlay(); G().quitToMenu(); UI.show('menu'); },
    quit2() { UI.hideOverlay(); G().quitToMenu(); UI.show('menu'); },
    nextRound() { UI.hideOverlay(); G().continueFromRest(); },
    rematch() { UI.hideOverlay(); G().startFight(G().cfg); },
  };

  /* ================================================================== HUD */
  UI.hud.show = function (g) {
    els.hud.classList.remove('hidden');
    UI.cache = {};
    const cfg = g.cfg;
    els.hud0.querySelector('.n').textContent = g.fighters[0].look.name;
    els.hud1.querySelector('.n').textContent = g.fighters[1].look.name;
    UI.buildHints();
    els.train.classList.toggle('hidden', cfg.mode !== 'training');
    UI.updateTouchVisibility();
    A.musicStart('fight');
  };
  UI.hud.hide = function () {
    els.hud.classList.add('hidden');
    els.touch.classList.add('hidden');
    els.banner.classList.add('hidden');
    els.intro.classList.add('hidden');
    els.floats.innerHTML = '';
  };
  const setW = (el, v) => { const k = (v * 100).toFixed(1); if (UI.cache[el._id] !== k) { UI.cache[el._id] = k; el.style.width = k + '%'; } };
  let idc = 0;
  const hudParts = {};
  UI.hud.update = function (g) {
    for (let i = 0; i < 2; i++) {
      const f = g.fighters[i];
      if (!f) continue;
      const box = i === 0 ? els.hud0 : els.hud1;
      const parts = hudParts[i] || (hudParts[i] = {
        fill: box.querySelector('.hp .fill'), ghost: box.querySelector('.hp .ghost'), hp: box.querySelector('.hp'),
        st: box.querySelector('.st .fill'), stBar: box.querySelector('.st'), fy: box.querySelector('.fy .fill'), fyBar: box.querySelector('.fy'), kds: box.querySelector('.kds'),
      });
      for (const k of ['fill', 'ghost', 'st', 'fy']) if (!parts[k]._id) parts[k]._id = 'w' + (++idc);
      const hf = BX.clamp(f.healthFrac, 0, 1);
      setW(parts.fill, hf); setW(parts.ghost, hf);
      parts.hp.classList.toggle('low', hf < 0.25);
      parts.hp.classList.toggle('mid', hf >= 0.25 && hf < 0.5);
      const sf = BX.clamp(f.stamina / f.maxStamina, 0, 1);
      setW(parts.st, sf);
      parts.stBar.classList.toggle('empty', sf < 0.08);
      setW(parts.fy, f.fury / 100);
      parts.fyBar.classList.toggle('ready', f.fury >= 99.9);
      const kd = (g.roundKds[g.round - 1] || [0, 0])[i];
      const key = 'kd' + i;
      if (UI.cache[key] !== kd) { UI.cache[key] = kd; parts.kds.innerHTML = '<i class="kd-pip"></i>'.repeat(kd); }
      const cb = i === 0 ? els.combo0 : els.combo1;
      const n = g.combo[i].n;
      if (n >= 3) { const t = n + '|'; if (UI.cache['c' + i] !== t) { UI.cache['c' + i] = t; cb.innerHTML = n + ' HITS<small>COMBO</small>'; } cb.classList.add('on'); }
      else { cb.classList.remove('on'); UI.cache['c' + i] = ''; }
    }
    const tr = g.cfg.mode === 'training';
    const round = tr ? 'TRAINING' : 'ROUND ' + g.round + ' / ' + g.totalRounds;
    if (UI.cache.round !== round) { UI.cache.round = round; els.round.textContent = round; }
    const timer = tr ? '∞' : BX.fmtTime(g.timeLeft);
    if (UI.cache.timer !== timer) { UI.cache.timer = timer; els.timer.textContent = timer; els.timer.classList.toggle('warn', !tr && g.timeLeft < 10.5 && g.phase === 'fight'); }
    if (g.training) {
      const key = g.training.tasks.map((t) => (t.done ? 1 : 0)).join('');
      if (UI.cache.train !== key) {
        UI.cache.train = key;
        let cur = true;
        els.train.querySelector('ul').innerHTML = g.training.tasks.map((t) => {
          const cls = t.done ? 'done' : cur ? 'cur' : '';
          if (!t.done) cur = false;
          return `<li class="${cls}">${taskText(t.text)}</li>`;
        }).join('');
      }
    }
    els.fury0.classList.toggle('ready', g.fighters[0].fury >= 99.9);
  };
  const taskText = (txt) => txt.replace(/\{(\w+)\}/g, (m, a) => `<kbd>${esc(kn('solo', a))}</kbd>`);

  UI.buildHints = function () {
    const g = G(), versus = g.cfg && g.cfg.mode === 'versus';
    if (!g.settings.hints) { els.hints.classList.add('hidden'); return; }
    els.hints.classList.remove('hidden');
    const one = (set, p) => {
      const k = (a) => `<kbd>${esc(kn(set, a))}</kbd>`;
      return `${p ? `<span><b>${p}</b></span>` : ''}<span>${k('up')}${k('left')}${k('down')}${k('right')} <b>move</b></span><span>${k('jab')} <b>jab</b></span><span>${k('cross')} <b>cross</b></span><span>${k('leadHook')}${k('rearHook')} <b>hooks</b></span><span>${k('leadUpper')}${k('rearUpper')} <b>uppercuts</b></span><span>${k('block')} <b>block</b></span><span>${k('crouch')} <b>duck / body</b></span><span>${k('slipL')}${k('slipR')} <b>slip</b></span><span>${k('dodge')} <b>dash</b></span><span>${k('special')} <b>FURY</b></span>`;
    };
    els.hints.innerHTML = versus ? one('p1', 'P1') + '<span style="flex-basis:100%"></span>' + one('p2', 'P2') : one('solo');
  };

  /* ================================================================== banner / float / count / mash / misc */
  UI.banner = function (title, sub, ms, cls) {
    clearTimeout(bannerTimer);
    const b = els.banner;
    if (!title) { b.classList.add('hidden'); return; }
    b.className = cls || '';
    b.innerHTML = `<div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`;
    if (ms) bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
  };
  UI.intro = function (g) {
    const cfg = g.cfg, [a, b] = g.fighters;
    const m = cfg.meta || [{}, {}];
    const el = els.intro;
    el.innerHTML = `<div class="ic"><div class="corner">${esc(m[0].corner || 'RED CORNER')}</div><div class="nm">${esc(a.look.name)}</div><div class="nk">${esc(m[0].nick || '')}</div></div><div class="vs">VS</div><div class="ic b"><div class="corner">${esc(m[1].corner || 'BLUE CORNER')}</div><div class="nm">${esc(b.look.name)}</div><div class="nk">${esc(m[1].nick || '')}</div></div><div class="skip">PRESS ANY KEY TO SKIP</div>`;
    el.classList.remove('hidden');
    clearTimeout(introTimer);
    introTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  };
  UI.hideIntro = function () { clearTimeout(introTimer); els.intro.classList.add('hidden'); };
  UI.float = function (text, pos, cls) {
    if (!pos || pos.behind) return;
    const f = els.floats;
    if (pos.x < -50 || pos.y < -50 || pos.x > window.innerWidth + 50 || pos.y > window.innerHeight + 50) return;
    while (f.children.length > 12) f.removeChild(f.firstChild);
    const d = document.createElement('div');
    d.className = 'fl ' + (cls || '');
    d.textContent = text;
    d.style.left = pos.x + BX.rand(-24, 24) + 'px';
    d.style.top = pos.y + BX.rand(-12, 12) + 'px';
    f.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  };
  UI.count = function (n) {
    const c = els.count;
    if (n == null) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden', 'pop');
    c.textContent = n;
    c.classList.toggle('late', n >= 8);
    void c.offsetWidth;
    c.classList.add('pop');
  };
  UI.mash = function (f, frac, canRise) {
    const m = els.mash;
    if (!f || f.isAI) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.classList.toggle('locked', !canRise);
    m.querySelector('.mt').textContent = canRise ? 'GET UP! MASH THE PUNCH KEYS' : 'STAY DOWN… RECOVER';
    m.querySelector('.mb i').style.width = Math.min(100, frac * 100) + '%';
  };
  UI.combo = function () { /* handled in hud.update */ };
  UI.hitFlash = function (power) {
    const h = els.hitflash;
    h.style.transition = 'none';
    h.style.opacity = String(0.25 + power * 0.55);
    requestAnimationFrame(() => requestAnimationFrame(() => { h.style.transition = 'opacity 0.4s ease-out'; h.style.opacity = '0'; }));
  };
  UI.toast = function (msg) {
    const t = els.toast;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  };
  UI.setFps = function (n) { els.fps.textContent = n + ' fps'; };
  UI.shakeFury = function (slot) {
    const b = (slot === 0 ? els.hud0 : els.hud1).querySelector('.fy');
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
  };
  UI.showPause = function (on) {
    if (on) UI.show('pause');
    else UI.hideOverlay();
  };
  UI.showRest = function () { UI.show('rest'); };
  UI.showResult = function (res) {
    const reward = P.record(res);
    UI.show('result', { res, reward });
    G().setViewShift(0);
  };

  /* ================================================================== keyboard / gamepad menu navigation */
  function focusables() {
    return $$('.btn, .opp, .chip, .sw, .tab, .keycap, .mini, .switch, input', els.overlay).filter((e) => !e.disabled && e.offsetParent !== null && !e.classList.contains('locked'));
  }
  function navigate(dir) {
    const list = focusables();
    if (!list.length) return;
    const cur = document.activeElement;
    if (!list.includes(cur)) { list[0].focus(); return; }
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best = null, bs = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let along, across;
      if (dir === 'up') { along = -dy; across = Math.abs(dx); }
      else if (dir === 'down') { along = dy; across = Math.abs(dx); }
      else if (dir === 'left') { along = -dx; across = Math.abs(dy); }
      else { along = dx; across = Math.abs(dy); }
      if (along <= 4) continue;
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) { best.focus({ preventScroll: false }); best.scrollIntoView({ block: 'nearest' }); A.ui('tick'); }
  }
  function overlayVisible() { return !els.overlay.classList.contains('hidden'); }

  UI.onKey = function (e) {
    if (I.capture || e._captured) return;
    if (G().mode === 'fight' && G().phase === 'intro' && !overlayVisible()) { G().skipIntro = true; }
    if (!overlayVisible()) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT') { if (e.code === 'Enter' || e.code === 'Escape') e.target.blur(); return; }
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    if (dirs[e.code]) { e.preventDefault(); navigate(dirs[e.code]); return; }
    if (e.code === 'Enter' || e.code === 'Space') {
      const a = document.activeElement;
      if (a && els.overlay.contains(a) && a.tagName !== 'BUTTON') { e.preventDefault(); a.click(); }
    }
    if (e.code === 'Escape') {
      if (UI.current === 'pause') G().resume();
      else if (['controls', 'settings'].includes(UI.current)) UI.back(opts.from === 'pause' ? 'pause' : 'menu');
      else if (['quick', 'versus', 'career', 'avatar'].includes(UI.current)) UI.back('menu');
    }
  };

  const padPrev = {};
  UI.update = function (dt) {
    if (!overlayVisible() || I.active) return;
    if (!navigator.getGamepads) return;
    const p = Array.from(navigator.getGamepads() || []).find((x) => x && x.connected);
    if (!p) return;
    const edge = (k, c, fn) => { if (c && !padPrev[k]) fn(); padPrev[k] = c; };
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0, b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    edge('u', b(12) || ay < -0.6, () => navigate('up'));
    edge('d', b(13) || ay > 0.6, () => navigate('down'));
    edge('l', b(14) || ax < -0.6, () => navigate('left'));
    edge('r', b(15) || ax > 0.6, () => navigate('right'));
    edge('a', b(0), () => { const a = document.activeElement; if (a && els.overlay.contains(a)) a.click(); });
    edge('b', b(1), () => UI.onKey({ code: 'Escape', target: document.body, preventDefault() {} }));
    edge('s', b(9), () => { if (UI.current === 'pause') G().resume(); });
  };

  /* ================================================================== touch controls */
  UI.updateTouchVisibility = function () {
    const g = G();
    const pref = g.settings.touch;
    const touchy = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const show = g.mode === 'fight' && g.cfg && g.cfg.mode !== 'versus' && (pref === 'on' || (pref === 'auto' && touchy));
    els.touch.classList.toggle('hidden', !show);
    els.hints.classList.toggle('hidden', !g.settings.hints || (show && touchy));
  };

  function setupTouch() {
    $$('.tb', els.touch).forEach((b) => {
      const a = b.dataset.a;
      const down = (e) => { e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); I.press(0, a, 'touch:' + e.pointerId); b.classList.add('on'); I.lastDevice = 'touch'; };
      const up = (e) => { I.release(0, a, 'touch:' + e.pointerId); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    });
    const joy = $('#joy'), knob = $('#joyKnob');
    let pid = null;
    const R = 52;
    const move = (e) => {
      const r = joy.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      let x = dx / R, y = -dy / R;
      if (Math.hypot(x, y) < 0.22) { x = 0; y = 0; }
      I.analog[0].x = x; I.analog[0].y = y;
    };
    joy.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; joy.setPointerCapture(pid); move(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; I.analog[0].x = 0; I.analog[0].y = 0; };
    joy.addEventListener('pointerup', end);
    joy.addEventListener('pointercancel', end);
  }

  /* ================================================================== init */
  UI.init = function () {
    els.overlay = $('#overlay'); els.hud = $('#hud'); els.hud0 = $('#hud0'); els.hud1 = $('#hud1');
    els.round = $('#hudRound'); els.timer = $('#hudTimer'); els.combo0 = $('#combo0'); els.combo1 = $('#combo1');
    els.mash = $('#mash'); els.train = $('#train'); els.hints = $('#hints'); els.banner = $('#banner'); els.count = $('#count');
    els.intro = $('#intro'); els.floats = $('#floats'); els.toast = $('#toast'); els.fps = $('#fps'); els.hitflash = $('#hitflash'); els.touch = $('#touch');
    els.fury0 = $('#touch .tb.fury');

    els.overlay.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      A.unlock();
      const fn = ACTIONS[t.dataset.act];
      if (fn) fn(t, e);
    });
    els.overlay.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.slider) {
        const s = G().settings;
        s[t.dataset.slider] = +t.value;
        G().saveSettings(); G().applySettings();
        const lbl = t.previousElementSibling; if (lbl) lbl.textContent = 'MASTER VOLUME ' + Math.round(t.value * 100) + '%';
      } else if (t.dataset.input === 'name') {
        const look = Object.assign({}, P.get().look, { name: (t.value.toUpperCase().trim() || 'YOU').slice(0, 10) });
        P.setLook(look); G().refreshShowcase(look);
      } else if (t.dataset.input === 'p2name') {
        opts.versus.p2.name = (t.value.toUpperCase().trim() || 'PLAYER 2').slice(0, 10);
      }
    });
    // drag to rotate the avatar preview
    const canvas = $('#game');
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { if (UI.current === 'avatar') { drag = { x: e.clientX, a: G().userAngle }; G()._dragging = true; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', (e) => { if (drag) G().userAngle = drag.a - (e.clientX - drag.x) * 0.012; });
    const endDrag = () => { drag = null; G()._dragging = false; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

    window.addEventListener('keydown', UI.onKey);
    $('#bPause').addEventListener('click', () => G().togglePause());
    $('#bCam').addEventListener('click', () => G().cycleCamera());
    $('#bMute').addEventListener('click', () => UI.toggleMute());
    $('#bHelp').addEventListener('click', () => UI.openHelp());
    setupTouch();
    els.fps.classList.toggle('hidden', !G().settings.fps);

    I.onGlobal = (name) => {
      const g = G();
      A.unlock();
      if (name === 'pause') {
        if (g.mode === 'fight') { if (g.phase === 'rest' || g.phase === 'ended') return false; g.togglePause(); return true; }
        return false;
      }
      if (name === 'camera') { if (g.mode === 'fight') { g.cycleCamera(); return true; } return false; }
      if (name === 'help') { if (g.mode === 'fight') { UI.openHelp(); return true; } return false; }
      if (name === 'mute') { UI.toggleMute(); return true; }
      return false;
    };
    // first user gesture unlocks audio
    const unlock = () => { A.unlock(); if (G().mode === 'menu') A.musicStart('menu'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  };

  UI.openHelp = function () {
    const g = G();
    if (g.mode !== 'fight' || g.phase === 'ended') return;
    if (!g.paused) g.pause();
    opts.from = 'pause';
    opts.ctlTab = g.cfg.mode === 'versus' ? 'p1' : 'solo';
    UI.show('controls');
  };
  UI.toggleMute = function () {
    const s = G().settings;
    const on = !(s.sfx || s.music);
    s.sfx = on; s.music = on;
    G().saveSettings(); G().applySettings();
    $('#bMute').textContent = on ? '🔊' : '🔇';
    UI.toast(on ? 'Sound on' : 'Sound off');
  };
})();
