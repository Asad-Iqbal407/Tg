/* Knockout Arena — game core: scene, fight flow, combat resolution, knockdowns, scoring, camera direction */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const T = THREE;
  const A = BX.Audio, FX = BX.FX;

  const DAMAGE_SCALE = 0.62;   // global tuning knob: lower = longer fights
  const START = [{ x: 0, z: -1.05 }, { x: 0, z: 1.05 }];
  const CORNERS = [[-2.45, -2.45], [2.45, -2.45], [-2.45, 2.45], [2.45, 2.45]];
  const REF_LOOK = { name: 'REF', skin: '#d39b6a', hair: 'short', hairColor: '#aaaaaa', trunks: '#111', trim: '#fff', gloves: '#fff', boots: '#111', build: 'avg', stance: 'orthodox' };

  const TRAINING_TASKS = [
    { id: 'move',   text: 'Move: step in/out and circle the sparring partner ({up} {left} {down} {right})' },
    { id: 'jab',    text: 'Land a JAB ({jab})' },
    { id: 'cross',  text: 'Land a CROSS ({cross})' },
    { id: 'hook',   text: 'Land a HOOK ({leadHook} / {rearHook})' },
    { id: 'upper',  text: 'Land an UPPERCUT ({leadUpper} / {rearUpper})' },
    { id: 'body',   text: 'Hold CROUCH ({crouch}) and land a BODY SHOT' },
    { id: 'block',  text: 'BLOCK a punch — hold {block} as your partner throws' },
    { id: 'slip',   text: 'SLIP a punch ({slipL} / {slipR}) just before it lands' },
    { id: 'dash',   text: 'DASH away ({dodge} + direction)' },
    { id: 'combo',  text: 'Land a 3-hit COMBO' },
    { id: 'fury',   text: 'Charge FURY and unleash it ({special})' },
  ];

  const Game = {
    BX,
    mode: 'menu',           // 'menu' | 'fight'
    phase: 'menu',          // intro | ready | fight | knockdown | roundEnd | rest | ended
    phaseT: 0,
    paused: false,
    cfg: null,
    fighters: [], ref: null,
    stats: [], combo: [],
    round: 1, timeLeft: 60,
    roundPts: [], roundKds: [], roundCards: [], judgeBias: [0, 0, 0],
    kd: null,
    timeScale: 1, slow: { t: 0, scale: 1 }, hitstop: 0,
    excite: 0.25,
    realT: 0,
    settings: null,
    result: null,
    listeners: {},
    training: null,
    trainerAttacks: false,
    lastScreenT: 0,
    userAngle: 0,
    menuCam: { angle: 0, radius: 5.2, height: 1.9, spin: true },
    _v: new T.Vector3(), _v2: new T.Vector3(), _v3: new T.Vector3(),

    /* =================================================================== setup */
    init(canvas) {
      Game.canvas = canvas;
      const saved = BX.store.get('settings', null);
      Game.settings = BX.deepMerge(BX.DEFAULT_SETTINGS, saved || {});
      const Perf = BX.Perf;
      const dpr = window.devicePixelRatio || 1;
      // MSAA is fixed at context creation: skip it on dense screens where it is redundant (and expensive)
      const r = new T.WebGLRenderer({ canvas, antialias: dpr < 1.5, alpha: false, stencil: false, powerPreference: 'high-performance' });
      r.debug.checkShaderErrors = /[?&]debug/.test(location.search);   // linking stays async-friendly in production
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      Game.renderer = r;
      Perf.softwareGL = Perf.isSoftwareGL(r.getContext());
      Game.scene = new T.Scene();
      Game.camera = new T.PerspectiveCamera(54, 1, 0.1, 120);
      Game.rig = new BX.CameraRig(Game.camera);

      // performance state (restored per device so the governor does not have to re-converge every launch)
      Game.perf = { level: 0, scale: 1, cap30: false, gov: null, refreshHz: 60, pendingLow: false, lastSave: 0, info: '' };
      Game.contentLow = false;
      const savedPerf = BX.store.get('perf', null);
      if (savedPerf && savedPerf.key === Perf.deviceKey()) { Game.perf.level = savedPerf.level | 0; Game.contentLow = !!savedPerf.contentLow; }
      else if (Perf.softwareGL) { Game.perf.level = 6; Game.contentLow = true; }

      FX.init(Game.scene);
      Game.applySettings();
      Game.ref = new BX.Fighter(REF_LOOK, { role: 'ref' });
      Game.scene.add(Game.ref.root);
      Game.ref.reset(2.2, 2.2, 0);
      Game.ref.snapFeet();

      // resize: layout-driven (iframes, safe areas, rotation) and debounced to one rAF
      window.addEventListener('resize', Game.scheduleResize);
      window.addEventListener('orientationchange', Game.scheduleResize);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', Game.scheduleResize);
      if (window.ResizeObserver) new ResizeObserver(Game.scheduleResize).observe(canvas);
      Game.resize(true);

      // WebGL context loss (mobile browsers drop contexts when backgrounded): keep the game paused and restore cleanly
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        Game.contextLost = true;
        if (Game.mode === 'fight' && !Game.paused) Game.pause();
        BX.UI.toast('Graphics interrupted — restoring…');
        setTimeout(() => { if (Game.contextLost) BX.UI.toast('Graphics could not be restored. Please reload the page.'); }, 5000);
      }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        Game.contextLost = false;
        Game.resize(true);
        if (Game.perf.gov) Game.perf.gov.reset(0);
        Game.precompile();
        BX.UI.toast(Game.mode === 'fight' ? 'Graphics restored — tap Resume' : 'Graphics restored');
      }, false);

      Game.initTrainingEvents();
      Game.showMenuScene();
      Game.precompile();

      let lastRender = performance.now(), fpsT = 0, fpsN = 0, hzFrames = [], hzLast = 0;
      const loop = (now) => {
        Game._raf = requestAnimationFrame(loop);
        // refresh-rate detection (median of the first rAF deltas): 120 Hz screens get half the work via the cap
        if (hzFrames.length < 40) {
          if (hzLast) hzFrames.push(now - hzLast);
          hzLast = now;
          if (hzFrames.length === 40) {
            const m = hzFrames.slice().sort((a, b) => a - b)[20];
            Game.perf.refreshHz = m < 10.5 ? 120 : m < 13.5 ? 90 : 60;
            if (Game.perf.gov) Game.perf.gov.setRefresh(Game.perf.refreshHz);
          }
        }
        const cap = Game.fpsCap();
        if (cap && now - lastRender < 1000 / cap - 1.5) return;
        const dtMs = now - lastRender;
        lastRender = now;
        // a stalled frame (tab restore, shader compile, GC) must not burn through hit-stop and ready timers
        const dt = dtMs > 250 ? 0 : Math.min(0.05, dtMs / 1000);
        // each stage has its own guard so one throwing stage can neither freeze the loop nor starve the others
        try { BX.Input.pollPads(); } catch (e) { Game._err(e); }
        try { BX.UI.update && BX.UI.update(dt); } catch (e) { Game._err(e); }
        if (!Game.contextLost) {
          try { Game.tick(dt); } catch (e) { Game._err(e); }
          try { Game.render(); } catch (e) { Game._err(e); }
          try { Game.governorFrame(now); } catch (e) { Game._err(e); }
        }
        if (Game.settings.fps) {
          fpsT += dt; fpsN++;
          if (fpsT > 0.5) {
            BX.UI.setFps(Math.round(fpsN / fpsT) + ' fps · ' + Game.tier.id + (Game.tier.auto ? ' auto L' + Game.perf.level : '') + ' · ' + (Game._pr || 1).toFixed(2) + 'x');
            fpsT = 0; fpsN = 0;
          }
        }
      };
      Game._raf = requestAnimationFrame(loop);
    },

    _err(e) {
      Game._errN = (Game._errN || 0) + 1;
      if (Game._errN <= 3 || Game._errN % 300 === 0) console.error(e);
      if (Game._errN === 120 && Game.mode === 'fight') { try { BX.UI.toast('Something went wrong - back to the menu'); Game.quitToMenu(); BX.UI.show('menu'); } catch (_) {} }
    },

    saveSettings() { BX.store.set('settings', Game.settings); },

    /** Frame-rate cap: 60 on touch devices (120 Hz phones get half the work), 30 in menus/pause or with battery saver / governor L6. */
    fpsCap() {
      const s = Game.settings, touch = BX.Perf.isTouch;
      if (s.batterySaver || Game.perf.cap30) return 30;
      if (Game.mode === 'menu' || Game.paused || Game.phase === 'rest' || Game.phase === 'ended') return touch ? 30 : 0;
      return touch ? 60 : 0;
    },

    /** Safe points: nothing is happening that a shader recompile hitch could ruin. */
    isSafePoint() {
      return Game.mode === 'menu' || Game.paused || Game.phase === 'intro' || Game.phase === 'ready' || Game.phase === 'rest' || Game.phase === 'ended';
    },

    /** Feed the adaptive governor (AUTO quality only, and only while a fight is actually being played). */
    governorFrame(now) {
      const gov = Game.perf.gov;
      if (!gov) return;
      const live = Game.mode === 'fight' && !Game.paused && !document.hidden && (Game.phase === 'fight' || Game.phase === 'knockdown' || Game.phase === 'ready' || Game.phase === 'roundEnd');
      if (!live) { gov.state.last = 0; return; }   // stop the clock; do not judge menu/pause frames
      gov.frame(now);
    },

    setupGovernor() {
      const p = Game.perf;
      p.gov = null;
      if (!Game.tier.auto) { p.level = 0; return; }
      const level = Math.max(0, Math.min(BX.Perf.LADDER.length - 1, p.level | 0));
      p.level = level;
      p.gov = BX.Perf.makeGovernor({
        targetFps: BX.Perf.LADDER[level].cap30 ? 30 : 60, refreshHz: p.refreshHz, levels: BX.Perf.LADDER.length, startLevel: level,
        isFeatureStep: (a, b) => Math.max(a, b) >= 3,
        cb: (lvl, reason) => {
          p.level = lvl;
          Game.applyLevel();
          if (lvl >= 5 && !Game.contentLow && Game.tier.id !== 'low') p.pendingLow = true;   // cheapest content at the next safe point
          Game.savePerf();
          if (/[?&]debug/.test(location.search)) console.log('[perf] level', lvl, reason);
        },
      });
    },

    savePerf() {
      const now = performance.now();
      if (now - Game.perf.lastSave < 2000) return;
      Game.perf.lastSave = now;
      BX.store.set('perf', { key: BX.Perf.deviceKey(), level: Game.perf.level, contentLow: Game.contentLow });
    },

    /** Reset adaptive state (user changed the quality setting). */
    resetPerf() {
      Game.contentLow = false;
      Game.perf.level = 0;
      Game.perf.pendingLow = false;
      BX.store.remove('perf');
    },

    /** Apply a governor level — free operations only. */
    applyLevel() {
      const lv = BX.Perf.LADDER[Game.perf.level] || BX.Perf.LADDER[0];
      Game.perf.scale = lv.res;
      Game.perf.cap30 = !!lv.cap30;
      Game.shadowsOn = lv.shadows !== false && Game.tier.shadowMap > 0;
      if (Game.arena) Game.arena.setFeatures({ beams: lv.beams, flashes: lv.flashes !== false, shadows: Game.shadowsOn, crowd: lv.crowd || 1 });
      FX.setMax(lv.fxMax || Game.tier.fxPool);
      if (Game.perf.gov) Game.perf.gov.setTarget(lv.cap30 ? 30 : 60);
      Game.resize();
    },

    /** One-off switch to the cheapest content (shader/material changes) — only called at a safe point. */
    switchToLowContent() {
      Game.perf.pendingLow = false;
      Game.contentLow = true;
      Game.perf.level = 3;
      Game.applySettings();
      if (Game.perf.gov) Game.perf.gov.force(3, performance.now());
      Game.savePerf();
    },

    /** Compile every visible material up front so the first fight frame does not stall (referee and 2nd boxer included). */
    precompile() {
      try {
        const f1 = Game.fighters && Game.fighters[1], ref = Game.ref;
        const v = [ref ? ref.root.visible : true, f1 ? f1.root.visible : true];
        if (ref) ref.root.visible = true;
        if (f1) f1.root.visible = true;
        Game.renderer.compile(Game.scene, Game.camera);
        if (ref) ref.root.visible = v[0];
        if (f1) f1.root.visible = v[1];
      } catch (e) { /* optional */ }
    },

    applySettings(rebuild) {
      const s = Game.settings, Perf = BX.Perf;
      const tier = Perf.resolve(s.quality, Game.contentLow);
      const prev = Game.tier;
      Game.tier = tier;
      Perf.current = tier;
      const archChanged = !Game.arena || rebuild || !prev || prev.key !== tier.key;
      if (archChanged) {
        if (Game.arena) Game.arena.dispose();
        Game.arena = BX.Arena.build(Game.scene, tier);
        if (Game.fighters) Game.arena.setBlobTargets([Game.fighters[0], Game.fighters[1], Game.ref]);
      }
      // boxer models depend on the tier (material class, face detail): rebuild in place when it changed
      if (prev && prev.modelKey !== tier.modelKey) {
        for (const f of (Game.fighters || []).concat(Game.ref ? [Game.ref] : [])) if (f && f.rig) f.setLook(f.look);
      }
      FX.configure(tier.fxPool);
      Game.rig.shakeEnabled = !!s.shake;
      A.setVolume(s.volume); A.setSfx(s.sfx); A.setMusic(s.music); A.setSpeech(s.speech);
      if (Game.mode === 'fight') Game.rig.mode = Game.cameraMode();
      Game.setupGovernor();
      Game.applyLevel();
      if (archChanged && Game.fighters && Game.fighters.length) Game.precompile();
    },

    cameraMode() {
      if (Game.cfg && Game.cfg.mode === 'versus' && Game.settings.camera === 'behind') return 'side';
      return Game.settings.camera;
    },

    cycleCamera() {
      const touch = document.body.classList.contains('touchui');
      const order = touch ? (Game.camera.aspect < 1 ? ['behind', 'high'] : ['behind', 'side']) : ['behind', 'side', 'high', 'broadcast'];
      const cur = Game.settings.camera;
      const nxt = order[(order.indexOf(cur) + 1) % order.length];   // an unlisted current mode (e.g. broadcast set on desktop) falls back to the first
      Game.settings.camera = nxt;
      Game.saveSettings();
      Game.rig.mode = Game.cameraMode();
      BX.UI.toast('Camera: ' + { behind: 'Over the shoulder', side: 'Side view', high: 'High angle', broadcast: 'Broadcast' }[nxt]);
    },

    scheduleResize() {
      if (Game._rs) return;
      Game._rs = requestAnimationFrame(() => { Game._rs = 0; Game.resize(); });
    },

    resize(force) {
      const c = Game.canvas;
      if (!c || !Game.tier) return;
      const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
      const pr = BX.Perf.pixelRatio(Game.tier, w, h, Game.perf.scale);
      if (force || w !== Game._w || h !== Game._h || Math.abs(pr - (Game._pr || 0)) > 0.004) {
        Game._w = w; Game._h = h; Game._pr = pr;
        Game.renderer.setPixelRatio(pr);
        Game.renderer.setSize(w, h, false);
      }
      Game.camera.aspect = w / h;
      Game.rig.aspect = w / h;
      Game.applyView();
    },

    /** Shift the rendered scene sideways (used by the avatar creator so the boxer sits beside the panel). */
    setViewShift(f, fy) { Game.viewShift = f; Game.viewShiftY = fy || 0; Game.applyView(); },
    /** Pixel offset that moves the middle of the screen to the middle of the area not covered by the touch controls. */
    touchShift(w, h) {
      const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? r : null; };
      const left = ['#tdef', '#joy'].map(rect).filter(Boolean), right = ['#tmove', '#tpunch'].map(rect).filter(Boolean);
      if (!left.length || !right.length) return { x: 0, y: 0 };
      if (w > h) {
        const x0 = Math.max.apply(null, left.map((r) => r.right)), x1 = Math.min.apply(null, right.map((r) => r.left));
        return { x: x1 > x0 ? BX.clamp(w / 2 - (x0 + x1) / 2, 0, 0.12 * w) : 0, y: 0 };
      }
      const top = Math.min.apply(null, left.concat(right).map((r) => r.top));
      return { x: 0, y: BX.clamp(h / 2 - (110 + top) / 2, 0, 0.12 * h) };
    },
    applyView() {
      const c = Game.canvas, cam = Game.camera;
      const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
      Game.rig.compact = document.body.classList.contains('touchui');
      Game.rig.camScale = 1 + BX.clamp((1.1 - w / h) * 0.45, 0, 0.3);
      const sc = document.querySelector('#overlay.clear .screen.avatar');
      if (Game.viewShift && sc && h > w * 1.05 && w < 760) {
        // portrait phone: boxer lives in the top preview window above the form panel
        const ph = Math.max(0.3, 1 - sc.offsetHeight / h), s = Math.min(0.62, ph * 0.9), cy = ph * 0.52;
        cam.setViewOffset(w * s, h * s, -(1 - s) * w / 2, (s / 2 - cy) * h, w, h);
      } else if (Game.viewShift && (w >= 760 || sc)) {
        const f = sc ? sc.offsetWidth / (2 * w) : Game.viewShift;
        cam.setViewOffset(w, h, -f * w, (Game.viewShiftY || 0) * h, w, h);
      } else if (Game.rig.compact) {
        // keep the action centred in the free area between the thumb controls
        const s = Game.touchShift(w, h);
        if (s.x || s.y) cam.setViewOffset(w, h, s.x, s.y, w, h); else cam.clearViewOffset();
      } else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    },

    on(name, fn) { (Game.listeners[name] = Game.listeners[name] || []).push(fn); },
    emit(name, a, b) { const l = Game.listeners[name]; if (l) for (const fn of l) fn(a, b); },

    /* =================================================================== menu / showcase scenes */
    ensureFighters(look0, stats0, look1, stats1, hide1) {
      const old = Game.fighters;
      for (const f of old) { Game.scene.remove(f.root); BX.disposeRig(f.rig); }
      const f0 = new BX.Fighter(look0, { slot: 0, stats: stats0 });
      const f1 = new BX.Fighter(look1, { slot: 1, stats: stats1 });
      Game.scene.add(f0.root); Game.scene.add(f1.root);
      Game.fighters = [f0, f1];
      f1.root.visible = !hide1;
      if (Game.arena) Game.arena.setBlobTargets([f0, f1, Game.ref]);
      return Game.fighters;
    },

    showMenuScene(opts) {
      opts = opts || {};
      Game.mode = 'menu';
      Game.phase = 'menu';
      Game.paused = false;
      BX.Input.active = false;
      Game.rig.clearOverride();
      FX.clear();
      Game.ref.root.visible = false;
      const prof = BX.Profile.get();
      const foe = BX.ROSTER[Math.floor(Math.random() * BX.ROSTER.length)];
      const fs = Game.ensureFighters(prof.look, prof.stats, foe.look, foe.stats, !!opts.solo);
      Game.stage = opts.solo ? 'solo' : 'menu';
      if (opts.solo) {
        fs[0].reset(0, 0, 0); fs[1].reset(0, 3.2, Math.PI);
        Game.menuCam = { angle: 2.9, radius: 3.9, height: 1.5, spin: !opts.still, lookY: 1.0, fov: 40, userCtl: true };
      } else {
        fs[0].reset(START[0].x, START[0].z, 0); fs[1].reset(START[1].x, START[1].z, Math.PI);
        Game.menuCam = { angle: 0.0, radius: 5.4, height: 1.9, spin: true, lookY: 1.25, fov: 46 };
      }
      for (const f of fs) { f.locked = true; f.snapFeet(); }
      fs[0].forcedPose = opts.solo ? 'intro' : null;
      Game.arena.setExcitement(0.2);
      A.crowd(0.2);
      Game.rig.setOverride((t, dt, P, L) => {
        const m = Game.menuCam;
        if (m.spin && !Game._dragging) m.angle += dt * 0.22;
        // the avatar creator orbits freely; the menu backdrop sweeps gently so the camera never passes a corner post
        const a = m.userCtl ? m.angle + Game.userAngle : Math.PI + Math.sin(m.angle * 0.9) * 0.55 + Game.userAngle;
        const rr = m.radius;
        P.set(Math.sin(a) * rr, m.height, Math.cos(a) * rr);
        L.set(0, m.lookY, 0);
        return m.fov;
      }, Infinity, 5);
      Game.rig.snap(new T.Vector3(0, 1.9, -5.4), new T.Vector3(0, 1.25, 0));
    },

    /** Re-skin the showcased fighter (avatar creator). */
    refreshShowcase(look) {
      const f = Game.fighters[0];
      if (!f) return;
      f.setLook(look);
      f.forcedPose = 'intro';
    },

    /* =================================================================== starting a fight */
    startFight(cfg) {
      Game.cfg = cfg;
      Game.mode = 'fight';
      Game.paused = false;
      Game.result = null;
      const looks = cfg.looks, stats = cfg.stats;
      const fs = Game.ensureFighters(looks[0], stats[0], looks[1], stats[1], false);
      Game.ref.root.visible = true;
      Game.ref.reset(2.0, 0, 0); Game.ref.snapFeet();
      FX.clear();
      Game.trainerAttacks = false;
      if (cfg.ai) {
        fs[1].isAI = true;
        fs[1].ai = new BX.AI(fs[1], cfg.ai);
        if (cfg.ai.style === 'dummy') fs[1].punchTimeMul = 2.3;
      }
      BX.Input.configure(cfg.mode === 'versus' ? 'versus' : 'solo');
      BX.Input.releaseAll();
      BX.Input.active = true;
      Game.rig.mode = Game.cameraMode();
      Game.rig.clearOverride();
      Game.round = 1;
      Game.totalRounds = cfg.mode === 'training' ? 1 : cfg.rounds;
      Game.roundTime = cfg.roundTime;
      Game.stats = [Game.newStats(), Game.newStats()];
      Game.combo = [{ n: 0, t: 0 }, { n: 0, t: 0 }];
      Game.roundPts = [];
      Game.roundKds = [];
      Game.roundCards = [];
      Game.judgeBias = [BX.rand(-0.07, 0.07), BX.rand(-0.07, 0.07), BX.rand(-0.07, 0.07)];
      Game.kd = null;
      Game.timeScale = 1; Game.slow.t = 0; Game.hitstop = 0;
      Game.excite = 0.3;
      Game.training = null;
      if (cfg.mode === 'training') Game.training = { tasks: TRAINING_TASKS.map((t) => ({ id: t.id, text: t.text, done: false })), moved: 0, announced: false };
      Game.placeFighters(true);
      for (const f of fs) { f.locked = true; f.forcedPose = 'intro'; }
      Game.beginPhase('intro');
      BX.UI.hud.show(Game);
      A.musicStart('fight');
      A.crowd(0.3);
      Game.startRoundRecords();
    },

    newStats() { return { thrown: 0, landed: 0, power: 0, blocked: 0, dodged: 0, dmg: 0, kds: 0, bestCombo: 0, counters: 0, pts: 0 }; },

    startRoundRecords() {
      Game.roundPts[Game.round - 1] = [0, 0];
      Game.roundKds[Game.round - 1] = [0, 0];
    },

    placeFighters(full) {
      const [a, b] = Game.fighters;
      if (full) { a.reset(START[0].x, START[0].z, 0); b.reset(START[1].x, START[1].z, Math.PI); }
      else { a.place(START[0].x, START[0].z, 0); b.place(START[1].x, START[1].z, Math.PI); }
      if (a.ai) a.ai.reset();
      if (b.ai) b.ai.reset();
      Game.refPosition(true);
    },

    beginPhase(p) {
      Game.phase = p;
      Game.phaseT = 0;
      const [a, b] = Game.fighters;
      const rig = Game.rig;
      switch (p) {
        case 'intro': {
          rig.setOverride((t, dt, P, L) => {
            const ang = 2.6 + t * 0.7, r0 = 5.2 - t * 0.5;
            const r = Math.min(6.2, r0 / Math.max(Math.abs(Math.sin(ang)), Math.abs(Math.cos(ang)), 0.72));
            P.set(Math.sin(ang) * r, 1.55 + 0.25 * Math.sin(t * 0.9), Math.cos(ang) * r);
            L.set(0, 1.25, 0);
            return 46;
          }, Infinity, 4);
          Game.refGreet = true;
          BX.UI.intro(Game);
          break;
        }
        case 'ready': {
          BX.UI.hideIntro();
          Game.placeFighters(false);
          Game.timeLeft = Game.roundTime;
          for (const f of Game.fighters) { f.locked = true; f.forcedPose = null; }
          rig.clearOverride();
          rig.setOverride((t, dt, P, L) => {
            // short push-in on the fighters before the bell
            const ang = BX.lerp(0.35, 0, BX.ease.outCubic(Math.min(1, t / 1.6)));
            P.set(Math.sin(ang) * 4.6, 1.8, -Math.cos(ang) * 4.6);
            L.set(0, 1.25, 0);
            return 50;
          }, 1.5, 5);
          BX.UI.banner('ROUND ' + Game.round, Game.totalRounds > 1 || Game.cfg.mode !== 'training' ? 'of ' + Game.totalRounds : 'Practice', 1500, 'round');
          A.speak('Round ' + Game.round);
          break;
        }
        case 'fight': {
          for (const f of Game.fighters) { f.locked = false; f.forcedPose = null; }
          BX.Input.flush(0); BX.Input.flush(1);
          rig.clearOverride();
          A.bell(1);
          BX.UI.banner('FIGHT!', '', 900, 'fight');
          Game.excitePulse(0.4);
          break;
        }
        case 'roundEnd': {
          for (const f of Game.fighters) f.locked = true;
          A.bell(3);
          A.cheer(0.7);
          BX.UI.banner('END OF ROUND ' + Game.round, '', 2000, 'round');
          Game.scoreCurrentRound();
          break;
        }
        default: break;
      }
    },

    /* =================================================================== main tick */
    tick(dt) {
      Game.realT += dt;
      // slow motion / hit stop
      if (Game.slow.t > 0) { Game.slow.t -= dt; Game.timeScale = BX.damp(Game.timeScale, Game.slow.scale, 14, dt); }
      else Game.timeScale = BX.damp(Game.timeScale, 1, 6, dt);
      let sdt = dt * Game.timeScale;
      if (Game.hitstop > 0) { Game.hitstop -= dt; sdt = 0; }
      if (Game.paused) sdt = 0;

      if (Game.perf.pendingLow && Game.isSafePoint()) Game.switchToLowContent();
      if (Game.mode === 'menu') Game.tickMenu(sdt, dt);
      else Game.tickFight(sdt, dt);

      FX.update(sdt);
      const focus = Game.fighters.length ? { x: (Game.fighters[0].pos.x + Game.fighters[1].pos.x) / 2, z: (Game.fighters[0].pos.z + Game.fighters[1].pos.z) / 2 } : null;
      Game.excite = BX.damp(Game.excite, Game.mode === 'fight' ? Game.baseExcite() : 0.2, 0.7, dt);
      Game.arena.setExcitement(Game.excite);
      Game.arena.update(Game.paused ? 0 : dt, focus, Game.realT);
      A.crowd(Game.excite);
      A.update(dt);
      const fs = Game.fighters;
      Game.rig.update(sdt, fs[0], fs[1], dt);
      Game.arena.cullRopes && Game.arena.cullRopes(Game.camera.position);
      if (Game.mode === 'fight' && Game.realT - Game.lastScreenT > 0.25) { Game.lastScreenT = Game.realT; Game.updateScreen(); }
      if (Game.mode === 'fight') BX.UI.hud.update(Game);
    },

    baseExcite() {
      const [a, b] = Game.fighters;
      const low = Math.min(a.healthFrac, b.healthFrac);
      return 0.3 + (1 - low) * 0.3 + Math.max(Game.combo[0].n, Game.combo[1].n) * 0.05;
    },

    excitePulse(v) { Game.excite = Math.min(1, Game.excite + v); },

    tickMenu(sdt, dt) {
      const [a, b] = Game.fighters;
      if (!a) return;
      for (const f of Game.fighters) f.update(sdt, null, f === a ? b : a, Game.nullGame);
      for (const f of Game.fighters) f.animate(sdt, f === a ? b : a, Game.nullGame);
    },

    tickFight(sdt, dt) {
      const fs = Game.fighters;
      const [a, b] = fs;
      if (!Game.paused) Game.phaseT += dt;
      const phase = Game.phase;

      // ----- phase machine
      if (phase === 'intro') {
        if (Game.phaseT > 3.6 || Game.skipIntro) { Game.skipIntro = false; Game.beginPhase('ready'); }
      } else if (phase === 'ready') {
        if (Game.phaseT > 1.7) Game.beginPhase('fight');
      } else if (phase === 'fight') {
        if (!Game.paused && Game.cfg.mode !== 'training') {
          Game.timeLeft -= sdt;
          if (Game.timeLeft <= 0) { Game.timeLeft = 0; Game.beginPhase('roundEnd'); }
          else if (Game.timeLeft < 10.1 && Math.ceil(Game.timeLeft) !== Game._lastTick) { Game._lastTick = Math.ceil(Game.timeLeft); A.tick(); }
        }
      } else if (phase === 'roundEnd') {
        if (Game.phaseT > 2.4) Game.afterRound();
      } else if (phase === 'ended') {
        if (Game.phaseT > 3.2 && !Game.resultShown) { Game.resultShown = true; BX.UI.showResult(Game.result); }
      }

      // ----- combos decay
      for (let i = 0; i < 2; i++) { const c = Game.combo[i]; if (c.n > 0) { c.t += sdt; if (c.t > 1.5) c.n = 0; } }

      // ----- referee / knockdown handling
      if (phase === 'knockdown') Game.tickKnockdown(sdt);

      // ----- fighters
      const order = Math.random() < 0.5 ? [0, 1] : [1, 0];
      const active = phase === 'fight' || phase === 'knockdown';
      for (const i of order) {
        const f = fs[i], o = fs[1 - i];
        let intent = null;
        if (active || phase === 'ready' || phase === 'roundEnd') intent = Game.getIntent(f, o, sdt);
        else BX.Input.flush(f.slot);
        f.update(sdt, intent, o, Game);
      }
      Game.separate();
      for (const f of fs) f.animate(sdt, f === a ? b : a, Game);
      Game.updateRef(sdt);
      if (Game.training) Game.tickTraining(sdt);

      // fury ready cue
      for (const f of fs) {
        if (f.fury >= 99.9 && !f.furyReadyShown) { f.furyReadyShown = true; if (!f.isAI) { A.furyReady(); BX.UI.float('FURY READY!', Game.project(f, 2.0), 'fury'); } }
        if (f.fury < 90) f.furyReadyShown = false;
      }
    },

    nullGame: { onGassed() {}, onPunchStart() {}, onDodgeStart() {}, onTaunt() {}, onFuryUsed() {}, onFuryDenied() {}, onFighterDown() {}, onFighterUp() {}, resolvePunch() {} },

    getIntent(f, o, dt) {
      if (f.isAI) return f.ai.update(dt, o, Game);
      const it = BX.Input.poll(f.slot);
      if (f.isDown) {
        // down: every press is a "get up" mash
        if (Game.kd && Game.kd.f === f) for (const a of it.actions) if (a !== 'taunt') Game.kd.mash += 15;
        BX.Input.flush(f.slot);
        return null;
      }
      return it;
    },

    separate() {
      const [a, b] = Game.fighters;
      if (a.isDown || b.isDown) return;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = 0.7;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        const lim = BX.RING_HALF - 0.05;
        for (const f of [a, b]) { f.pos.x = BX.clamp(f.pos.x, -lim, lim); f.pos.z = BX.clamp(f.pos.z, -lim, lim); }
      } else if (d <= 1e-4) { b.pos.z += 0.1; }
    },

    get fightActive() { return Game.phase === 'fight'; },

    /* =================================================================== referee */
    refPosition(snap) {
      const r = Game.ref;
      r.reset(2.3, 0.2, 0);
      r.refMode = 'idle';
      r.snapFeet();
    },

    updateRef(dt) {
      const r = Game.ref, [a, b] = Game.fighters;
      if (!r || !a) return;
      const cam = Game.camera.position;
      const mid = Game._v.set((a.pos.x + b.pos.x) / 2, 0, (a.pos.z + b.pos.z) / 2);
      if (Game.phase === 'knockdown' && Game.kd) {
        const f = Game.kd.f;
        // stand beside the fallen fighter's torso
        const fwd = Game._v2.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        const sx = -fwd.z, sz = fwd.x;
        const side = (sx * (cam.x - f.pos.x) + sz * (cam.z - f.pos.z)) > 0 ? -1 : 1;
        const tx = f.pos.x - fwd.x * 0.9 + sx * side * 0.95, tz = f.pos.z - fwd.z * 0.9 + sz * side * 0.95;
        r.refGoto(BX.clamp(tx, -2.6, 2.6), BX.clamp(tz, -2.6, 2.6), f.pos.x - fwd.x * 0.9, f.pos.z - fwd.z * 0.9);
        r.refMode = Game.kd.rising ? 'wave' : (Game.kd.landed ? 'count' : 'idle');
      } else if (Game.phase === 'ended' && Game.result) {
        const w = Game.result.winner;
        if (w >= 0) {
          const wf = Game.fighters[w];
          r.refGoto(wf.pos.x + 0.55, wf.pos.z + (wf.pos.z > 0 ? -0.5 : 0.5), wf.pos.x, wf.pos.z);
          r.refMode = 'raise';
        } else { r.refGoto(0, 0.1, 0, 3); r.refMode = 'wave'; }
      } else {
        // stay on the far side of the action from the camera
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const px = -dz / l, pz = dx / l;
        const s = (px * (cam.x - mid.x) + pz * (cam.z - mid.z)) > 0 ? -1 : 1;
        let tx = mid.x + px * s * 1.9, tz = mid.z + pz * s * 1.9;
        tx = BX.clamp(tx, -2.5, 2.5); tz = BX.clamp(tz, -2.5, 2.5);
        r.refGoto(tx, tz, mid.x, mid.z);
        r.refMode = 'idle';
      }
      r.animate(dt, Game);
    },

    /* =================================================================== callbacks from fighters */
    onGassed(f) {
      if (f.isAI) return;
      if (Game.realT - (f._gassedT || 0) > 1.2) { f._gassedT = Game.realT; BX.UI.float('OUT OF GAS!', Game.project(f, 2.0), 'warn'); }
    },
    onPunchStart(f, act) {
      Game.stats[f.slot].thrown++;
      const kind = act.def.kind;
      if (kind === 'special') {
        A.furyCharge();
        BX.UI.banner('FURY!', '', 900, 'fury');
        Game.rig.kickFov(-4);
        Game.arena.strobe = 0.8;
        Game.excitePulse(0.5);
        Game.slowmo(0.55, 0.5);
      } else {
        const t = (act.def.wind * act.tm) * 0.6;
        A.whoosh(kind === 'straight' ? 0.4 : 0.7, t);
      }
      if (!f.isAI) Game.emit('punch', f, act.def.id);
    },
    onDodgeStart(f, kind) {
      A.dodge();
      if (!f.isAI) Game.emit(kind, f);
    },
    initTrainingEvents() {
      const done = (id) => { if (Game.training) Game.completeTask(id); };
      Game.on('land', (f, i) => {
        if (!Game.training) return;
        if (i.id === 'jab') done('jab');
        if (i.id === 'cross') done('cross');
        if (i.kind === 'hook') done('hook');
        if (i.kind === 'upper') done('upper');
        if (i.body) done('body');
        if (i.combo >= 3) done('combo');
      });
      Game.on('blocked', () => done('block'));
      Game.on('dodged', (f, how) => { if (how === 'slip') done('slip'); });
      Game.on('dash', () => done('dash'));
      Game.on('special', () => done('fury'));
    },
    onTaunt(f) {
      f.fury = Math.min(100, f.fury + 12);
      A.cheer(0.5);
      Game.excitePulse(0.3);
      BX.UI.float('TAUNT!', Game.project(f, 2.0), 'warn');
    },
    onFuryUsed(f) { Game.emit('special', f); },
    onFuryDenied(f) { if (!f.isAI) { A.ui('back'); BX.UI.shakeFury(f.slot); } },

    onFighterDown(f) {
      A.knockdown();
      FX.dust(Game._v.set(f.pos.x - Math.sin(f.yaw) * 0.8, 0.05, f.pos.z - Math.cos(f.yaw) * 0.8));
      Game.rig.addShake(0.9);
      if (Game.kd && Game.kd.f === f) { Game.kd.landed = true; Game.kd.timer = -0.5; }
      else if (Game.phase === 'ended' && Game.result) { /* KO landed: nothing more */ }
    },
    onFighterUp(f) {
      if (Game.kd && Game.kd.f === f) Game.kd.upDone = true;
    },

    /* =================================================================== slow motion helpers */
    slowmo(scale, dur) { Game.slow.scale = scale; Game.slow.t = dur; },

    project(f, h, target) {
      const v = (target || Game._v3).set(f.pos.x, h, f.pos.z);
      v.project(Game.camera);
      const w = Game.canvas.clientWidth, hh = Game.canvas.clientHeight;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * hh, behind: v.z > 1 };
    },
    projectPoint(p) {
      const v = Game._v3.copy(p).project(Game.camera);
      const w = Game.canvas.clientWidth, hh = Game.canvas.clientHeight;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * hh, behind: v.z > 1 };
    },

    /* =================================================================== combat resolution */
    resolvePunch(att, def, act) {
      const d = act.def, ast = Game.stats[att.slot];
      if (Game.phase !== 'fight' && Game.phase !== 'ready') { act.whiff = true; return; }
      const dx = def.pos.x - att.pos.x, dz = def.pos.z - att.pos.z;
      const dist = Math.hypot(dx, dz);
      const dir = Game._v2.set(dx, 0, dz);
      if (dist > 1e-4) dir.multiplyScalar(1 / dist);
      const dirv = new T.Vector3(dir.x, 0, dir.z);
      const reach = d.range * Math.max(att.size, 0.95);
      const gp = att.getGloveWorld(d.hand, new T.Vector3());
      let result = 'hit';

      const da = def.act;
      if (def.isDown || Game.phase !== 'fight') result = 'miss';
      else if (dist > reach) result = 'miss';
      else if (def.invuln > 0 && d.kind !== 'special') result = 'dodged';
      else if (da && da.type === 'dash' && da.t < da.inv && d.kind !== 'special') result = 'dodged';
      else if (da && da.type === 'slip' && da.t > 0.03 && da.t < da.inv && (d.kind === 'straight' || d.kind === 'upper')) result = 'dodged';
      else if (def.isDucking && !act.low && (d.kind === 'straight' || d.kind === 'hook')) result = 'ducked';
      else if (def.isBlocking) result = 'blocked';

      // ----- whiffs and dodges
      if (result === 'miss' || result === 'dodged' || result === 'ducked') {
        act.whiff = true;
        const extra = d.rec * act.tm * 0.28;
        act.dur += extra; act.cancelT += extra;
        if (result !== 'miss') {
          const dstat = Game.stats[def.slot];
          dstat.dodged++;
          def.fury = Math.min(100, def.fury + 7);
          def.counterT = 1.1;
          A.dodge();
          BX.UI.float(result === 'ducked' ? 'DUCKED!' : 'DODGED!', Game.project(def, 2.05), 'dodge');
          if (def.isAI) def.ai.onDefended('dodge'); else Game.emit('dodged', def, da ? da.type : 'duck');
          Game.rig.addShake(0.08);
        }
        return;
      }

      const stFrac = att.stamina / att.maxStamina;
      let base = d.dmg * DAMAGE_SCALE * att.powerMul * (0.64 + 0.36 * Math.min(1, stFrac * 1.6));
      if (att.isAI) base *= att.ai.d.dmg;
      const cmb = Game.combo[att.slot];
      base *= Math.max(0.6, 1 - 0.08 * Math.max(0, cmb.n - 2));
      base *= def.dmgTaken;

      // ----- blocked
      if (result === 'blocked') {
        const guardDmg = base * (d.kind === 'upper' ? 1.45 : d.kind === 'special' ? 2.2 : 1.0) * 1.35;
        def.stamina -= guardDmg;
        const chip = base * 0.1;
        def.health = Math.max(1, def.health - chip);
        def.fury = Math.min(100, def.fury + 2);
        const broke = def.stamina <= 0 || d.guardBreak;
        if (def.stamina < 0) def.stamina = 0;
        def.staminaDelay = 0.9;
        def.takeHit({ att, def: d, dir: dirv, power: base / 10, blocked: true, guardBreak: broke });
        ast.blocked++;
        A.block(base / 14);
        FX.block(gp, dirv);
        Game.rig.addShake(broke ? 0.5 : 0.12);
        Game.hitstop = Math.max(Game.hitstop, 0.025);
        if (broke) {
          BX.UI.float('GUARD BREAK!', Game.project(def, 2.05), 'counter');
          A.stagger();
          Game.hitstop = 0.07;
        } else BX.UI.float('BLOCKED', Game.project(def, 2.05), 'block');
        act.connected = false;
        if (def.isAI) def.ai.onDefended('block'); else Game.emit('blocked', def);
        return;
      }

      // ----- clean hit
      let counter = false, punish = false;
      if (da && da.type === 'punch') {
        if (da.t < da.impactT) counter = true;
        else punish = true;
      }
      if (att.counterT > 0) { counter = true; att.counterT = 0; }
      if (counter) base *= 1.35; else if (punish) base *= 1.18;
      const body = act.low;
      const healthDmg = base * (body ? 0.72 : 1);
      const staminaDrain = base * (body ? 1.7 : 0.3);
      const power = BX.clamp(base / 10, 0.2, 1.6);
      def.health = Math.max(0, def.health - healthDmg);
      def.stamina = Math.max(0, def.stamina - staminaDrain);
      def.staminaDelay = 1.0;
      att.fury = Math.min(100, att.fury + 3 + healthDmg * 0.85);
      def.fury = Math.min(100, def.fury + 2 + healthDmg * 0.55);

      cmb.n++; cmb.t = 0;
      Game.combo[def.slot].n = 0;
      ast.landed++; ast.dmg += healthDmg;
      ast.bestCombo = Math.max(ast.bestCombo, cmb.n);
      if (d.dmg >= 9) ast.power++;
      if (counter) ast.counters++;
      const pts = healthDmg * (counter ? 1.25 : 1) + (d.dmg >= 9 ? 2 : 0.6);
      ast.pts += pts;
      Game.roundPts[Game.round - 1][att.slot] += pts;

      const stunMul = Math.max(0.55, 1 - 0.09 * (cmb.n - 1));
      const stun = d.stun * (counter ? 1.25 : 1) * stunMul;
      def.takeHit({ att, def: d, dir: dirv, power, stun, kb: d.kb * (0.85 + power * 0.25), low: body, blocked: false, counter });
      // knock the attacker's own cancel window open: landing a punch lets you chain faster
      act.connected = true; act.cancelT = Math.min(act.cancelT, act.t + (act.dur - act.t) * 0.55);

      // ----- feedback
      const hitPos = gp;
      const special = d.kind === 'special';
      FX.impact(hitPos, dirv, power * (special ? 1.5 : 1), d.kind);
      if (special) { A.furyHit(); Game.rig.addShake(1.1); Game.rig.kickFov(9); Game.arena.strobe = 1; Game.slowmo(0.3, 0.9); Game.hitstop = 0.16; }
      else { A.hit(power, body); Game.rig.addShake(0.12 + power * 0.28); Game.hitstop = Math.max(Game.hitstop, 0.035 + power * 0.045); }
      Game.excitePulse(0.06 + power * 0.12);
      if (power > 0.8) A.cheer(0.35);
      const sp = Game.project(def, body ? 1.3 : 1.85);
      BX.UI.float((counter ? 'COUNTER ' : punish ? 'PUNISH ' : '') + (body ? 'BODY ' : '') + '-' + Math.round(healthDmg), sp, counter || punish ? 'counter' : (power > 0.85 ? 'big' : 'dmg'));
      if (!def.isAI) BX.UI.hitFlash(Math.min(1, power));
      if (def.isAI) def.ai.onHit();
      if (!att.isAI) Game.emit('land', att, { id: d.id, kind: d.kind, body, combo: cmb.n });
      // pressed against the ropes
      if (Math.abs(def.pos.x) > 2.55 || Math.abs(def.pos.z) > 2.55) {
        const side = Math.abs(def.pos.z) > Math.abs(def.pos.x) ? (def.pos.z < 0 ? 0 : 1) : (def.pos.x < 0 ? 2 : 3);
        Game.arena.kickRope(side, 1);
      }
      if (cmb.n >= 3) BX.UI.combo(att.slot, cmb.n);

      // ----- knockdown?
      const low = def.health < def.maxHealth * 0.22;
      const flash = low && (d.kind === 'hook' || d.kind === 'upper' || special) && BX.chance(special ? 1 : 0.3);
      if (Game.cfg.mode === 'training') {
        if (def.health < def.maxHealth * 0.3) def.health = def.maxHealth;
      } else if (def.health <= 0 || flash) {
        def.health = 0;
        Game.startKnockdown(def, att, act);
      }
    },

    /* =================================================================== knockdowns */
    startKnockdown(f, att, act) {
      const slot = f.slot;
      Game.stats[att.slot].kds++;
      Game.roundKds[Game.round - 1][slot]++;
      const kdThisRound = Game.roundKds[Game.round - 1][slot];
      f.startFall(Game, { forward: act && act.def.kind === 'hook' && BX.chance(0.35) });
      att.locked = true;
      Game.phase = 'knockdown';
      Game.phaseT = 0;
      Game.kd = { f, att, count: 0, timer: -1.2, landed: false, mash: 0, rising: false, upDone: false, number: kdThisRound, resumeT: 0, tko: kdThisRound >= 3, ending: false };
      Game.combo[0].n = 0; Game.combo[1].n = 0;
      const rig = Game.rig;
      BX.UI.banner('KNOCKDOWN!', '', 950, 'kd');
      A.gasp(); A.cheer(0.9);
      Game.arena.strobe = 1;
      Game.excitePulse(0.6);
      Game.slowmo(0.28, 1.0);
      // cinematic camera on the fallen fighter
      const ref = f.pos.clone();
      const toCam = Game.camera.position.clone().sub(ref); toCam.y = 0; toCam.normalize();
      const side = new T.Vector3(-toCam.z, 0, toCam.x);
      rig.setOverride((t, dt, P, L) => {
        const k = BX.ease.outCubic(Math.min(1, t / 1.4));
        const base = f.pos;
        const cs = rig.camScale;
        P.set(base.x + toCam.x * (3.4 - k * 0.5) * cs + side.x * (1.6 - 1.6 * k), 0.9 + k * 0.9, base.z + toCam.z * (3.4 - k * 0.5) * cs + side.z * (1.6 - 1.6 * k));
        L.set(base.x - Math.sin(f.yaw) * 0.5, 0.35, base.z - Math.cos(f.yaw) * 0.5);
        return 50;
      }, Infinity, 3.5);
      // attacker walks to a neutral corner
      let best = CORNERS[0], bd = -1;
      for (const c of CORNERS) { const dd = Math.hypot(c[0] - f.pos.x, c[1] - f.pos.z); if (dd > bd) { bd = dd; best = c; } }
      Game.kd.corner = best;
      if (Game.kd.tko) Game.kd.count = 10;
    },

    tickKnockdown(dt) {
      const kd = Game.kd;
      if (!kd) return;
      const f = kd.f, att = kd.att;
      // attacker walks to the corner
      if (kd.corner) {
        const dx = kd.corner[0] - att.pos.x, dz = kd.corner[1] - att.pos.z, dd = Math.hypot(dx, dz);
        if (dd > 0.05) { const s = Math.min(dd, 2.6 * dt); att.pos.x += (dx / dd) * s; att.pos.z += (dz / dd) * s; att.lastIntent = { moveF: 0.5, moveS: 0 }; }
        else att.lastIntent = { moveF: 0, moveS: 0 };
      }
      if (kd.ending) return;
      if (!kd.landed) return;
      if (kd.tko) { Game.endFight('TKO', att.slot); kd.ending = true; return; }

      if (!kd.rising) {
        kd.timer += dt;
        // AI mashes automatically
        if (f.isAI) kd.mash += (14 + (1 - f.healthFrac) * 0 + f.ai.d.skill * 22) * dt * (0.5 + 0.5 * (1 - Math.min(1, kd.number * 0.25)));
        else kd.mash = Math.max(0, kd.mash - 9 * dt);
        if (kd.timer >= 1.0) {
          kd.timer -= 1.0;
          kd.count++;
          BX.UI.count(kd.count);
          A.countBeep(kd.count);
          A.speak(String(kd.count));
        }
        if (kd.count >= 3 && kd.mash >= 100 && kd.count < 10) {
          kd.rising = true;
          f.getUp();
          BX.UI.count(null);
        } else if (kd.count >= 10) {
          Game.endFight('KO', att.slot);
          kd.ending = true;
        }
        if (!kd.ending) BX.UI.mash(f, kd.mash / 100, kd.count >= 3);   // endFight('KO') above already hid the prompt
      } else {
        BX.UI.mash(null);
        if (kd.upDone) {
          kd.resumeT += dt;
          if (kd.resumeT > 0.35 && !kd.resumed) {
            kd.resumed = true;
            const frac = [0.4, 0.3, 0.25][Math.min(2, kd.number - 1)];
            f.health = f.maxHealth * frac;
            f.stamina = Math.max(f.stamina, f.maxStamina * 0.55);
            f.fury = Math.max(f.fury, 10);
            Game.rig.clearOverride();
            BX.UI.banner('BOX!', '', 800, 'fight');
            A.speak('Box!');
            att.locked = false; f.locked = false;
            if (att.ai) att.ai.reset();
            if (f.ai) f.ai.reset();
            Game.phase = 'fight';
            Game.kd = null;
            if (Game.timeLeft <= 0) Game.beginPhase('roundEnd');
          }
        }
      }
    },

    /* =================================================================== rounds & scoring */
    scoreCurrentRound() {
      const r = Game.round - 1;
      const pts = Game.roundPts[r] || [0, 0];
      const kds = Game.roundKds[r] || [0, 0];
      const card = [];
      for (let j = 0; j < 3; j++) {
        const b = Game.judgeBias[j];
        let s0 = pts[0] * (1 + b + BX.rand(-0.05, 0.05)) + 22 * kds[1];
        let s1 = pts[1] * (1 - b + BX.rand(-0.05, 0.05)) + 22 * kds[0];
        const tot = s0 + s1;
        let a = 10, c = 10;
        if (tot > 0) {
          const diff = (s0 - s1) / tot;
          if (Math.abs(diff) < 0.04) { a = 10; c = 10; }
          else {
            const winner = diff > 0 ? 0 : 1;
            const kdLoser = kds[winner === 0 ? 1 : 0];
            let loser = 9 - Math.min(2, kdLoser);
            if (Math.abs(diff) > 0.7) loser = Math.min(loser, 8);
            if (winner === 0) { a = 10; c = loser; } else { c = 10; a = loser; }
          }
        }
        card.push([a, c]);
      }
      Game.roundCards[r] = card;
    },

    afterRound() {
      if (Game.cfg.mode === 'training') { Game.beginPhase('ready'); return; }
      if (Game.round >= Game.totalRounds) { Game.decision(); return; }
      Game.paused = false;
      Game.phase = 'rest';
      Game.phaseT = 0;
      for (const f of Game.fighters) { f.locked = true; f.forcedPose = 'corner'; }
      Game.rig.setOverride((t, dt, P, L) => {
        const ang = 0.7 + t * 0.2;
        const r = Math.min(6.2, 5.0 / Math.max(Math.abs(Math.sin(ang)), Math.abs(Math.cos(ang)), 0.72));
        P.set(Math.sin(ang) * r, 2.0, Math.cos(ang) * r); L.set(0, 1.2, 0);
        return 46;
      }, Infinity, 3);
      BX.UI.showRest(Game);
    },

    continueFromRest() {
      if (Game.phase !== 'rest') return;
      Game.paused = false;
      Game.round++;
      Game.startRoundRecords();
      const [a, b] = Game.fighters;
      a.refresh(0.3, 0.9); b.refresh(0.3, 0.9);
      Game.beginPhase('ready');
    },

    decision() {
      const totals = [0, 1, 2].map((j) => {
        let a = 0, c = 0;
        Game.roundCards.forEach((rc) => { a += rc[j][0]; c += rc[j][1]; });
        return [a, c];
      });
      let w0 = 0, w1 = 0;
      totals.forEach((t) => { if (t[0] > t[1]) w0++; else if (t[1] > t[0]) w1++; });
      let winner = -1, method;
      if (w0 > w1) { winner = 0; method = w0 === 3 ? 'UD' : (w1 === 1 ? 'SD' : 'MD'); }
      else if (w1 > w0) { winner = 1; method = w1 === 3 ? 'UD' : (w0 === 1 ? 'SD' : 'MD'); }
      else method = 'DRAW';
      Game.endFight(method, winner, totals);
    },

    endFight(method, winner, totals) {
      if (Game.phase === 'ended') return;
      const [a, b] = Game.fighters;
      const ko = method === 'KO' || method === 'TKO';
      Game.phase = 'ended';
      Game.phaseT = 0;
      Game.resultShown = false;
      BX.Input.active = false;
      BX.UI.count(null); BX.UI.mash(null);
      if (!totals) {
        // include the current (unfinished) round on the cards for the record
        if (Game.cfg.mode !== 'training' && !Game.roundCards[Game.round - 1]) Game.scoreCurrentRound();
        totals = [0, 1, 2].map((j) => {
          let x = 0, y = 0;
          Game.roundCards.forEach((rc) => { x += rc[j][0]; y += rc[j][1]; });
          return [x, y];
        });
      }
      Game.result = {
        mode: Game.cfg.mode, method, winner, totals, round: Game.round, rounds: Game.totalRounds,
        timeLeft: Game.timeLeft, cards: Game.roundCards.slice(), stats: Game.stats.map((s) => Object.assign({}, s)),
        names: [a.look.name, b.look.name], cfg: Game.cfg,
      };
      for (const f of Game.fighters) f.locked = true;
      Game.kd && (Game.kd.ending = true);
      const win = winner >= 0 ? Game.fighters[winner] : null;
      const lose = winner >= 0 ? Game.fighters[1 - winner] : null;
      A.bell(ko ? 3 : 1);
      if (win) {
        win.forcedPose = 'win';
        if (lose && !lose.isDown) lose.forcedPose = 'lose';
      } else { a.forcedPose = 'corner'; b.forcedPose = 'corner'; }
      Game.arena.strobe = 1;
      Game.excitePulse(0.9);
      FX.confetti(new T.Vector3(0, 0, 0), win && !win.isAI ? 90 : 20);
      A.cheer(1);
      if (win) A.ui(win.isAI ? 'lose' : 'win');
      BX.UI.banner(ko ? method === 'KO' ? 'K.O.!' : 'T.K.O.!' : (winner >= 0 ? 'DECISION' : 'DRAW'), win ? win.look.name + ' WINS' : 'No winner', 3000, 'kd');
      A.speak(win ? win.look.name + ' wins' : 'It is a draw');
      Game.rig.setOverride((t, dt, P, L) => {
        const tgt = win || a;
        if (ko && lose) {
          const ang = 0.6 + t * 0.35;
          const cx = lose.pos.x, cz = lose.pos.z;
          const cs = Game.rig.camScale;
          P.set(cx + Math.sin(ang) * 3.4 * cs, 1.4, cz + Math.cos(ang) * 3.4 * cs);
          L.set(cx, 0.5, cz);
          return 48;
        }
        const f = tgt;
        const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
        const cs = Game.rig.camScale;
        P.set(f.pos.x + fx * 2.5 * cs + -fz * 0.4, 1.55, f.pos.z + fz * 2.5 * cs + fx * 0.4);
        L.set(f.pos.x, 1.45, f.pos.z);
        return 46;
      }, Infinity, 3);
      if (ko) Game.slowmo(0.45, 1.4);
    },

    /* =================================================================== training */
    tickTraining(dt) {
      const tr = Game.training;
      const [a, b] = Game.fighters;
      const it = a.lastIntent;
      if (it && (Math.abs(it.moveF) > 0.2 || Math.abs(it.moveS) > 0.2)) tr.moved += dt;
      if (tr.moved > 4) Game.completeTask('move');
      // the partner never gets tired
      b.stamina = Math.max(b.stamina, b.maxStamina * 0.5);
      if (Game.tasksDone('jab', 'cross')) Game.trainerAttacks = true;
      if (Game.taskDone('combo') && !Game._furyGiven) { Game._furyGiven = true; a.fury = 100; }
      if (!tr.announced && tr.tasks.every((t) => t.done)) { tr.announced = true; BX.UI.banner('TRAINING COMPLETE', 'Keep sparring or head to the ring!', 2800, 'round'); A.ui('win'); }
    },
    taskDone(id) { return Game.training.tasks.find((t) => t.id === id).done; },
    tasksDone() { for (const id of arguments) if (!Game.taskDone(id)) return false; return true; },
    completeTask(id) {
      const t = Game.training && Game.training.tasks.find((x) => x.id === id);
      if (t && !t.done) { t.done = true; A.ui('select'); BX.UI.toast('✔ ' + t.text.split('(')[0].split('—')[0].replace(/\{.*?\}/g, '').trim()); }
    },

    /* =================================================================== pause / quit */
    pause() {
      if (Game.mode !== 'fight' || Game.phase === 'ended' || Game.phase === 'rest' || Game.phase === 'roundEnd') return;
      Game.paused = true;
      BX.Input.releaseAll();
      BX.UI.showPause(true);
    },
    resume() {
      Game.paused = false;
      BX.UI.showPause(false);
      BX.Input.releaseAll();
    },
    togglePause() {
      if (Game.mode !== 'fight') return;
      if (Game.phase === 'rest' || Game.phase === 'ended' || Game.phase === 'roundEnd') return;
      Game.paused ? Game.resume() : Game.pause();
    },
    quitToMenu() {
      Game.paused = false;
      BX.UI.hud.hide();
      BX.UI.showPause(false);
      BX.UI.count(null); BX.UI.mash(null);
      A.musicStart('menu');
      Game.cfg = null;
      Game.showMenuScene();
    },
    restartFight() {
      Game.paused = false;
      BX.UI.showPause(false);
      Game.startFight(Game.cfg);
    },

    /* =================================================================== arena screen & render */
    updateScreen() {
      const [a, b] = Game.fighters;
      if (!a) return;
      const phase = Game.phase;
      Game.arena.drawScreen({
        title: Game.cfg && Game.cfg.mode === 'training' ? 'TRAINING' : 'ROUND ' + Game.round + ' / ' + Game.totalRounds,
        timer: Game.cfg && Game.cfg.mode === 'training' ? '∞' : BX.fmtTime(Game.timeLeft),
        sub: phase === 'knockdown' ? 'KNOCKDOWN' : phase === 'ended' ? (Game.result ? Game.result.method : '') : '',
        p1: { name: a.look.name.toUpperCase(), frac: BX.clamp(a.healthFrac, 0, 1), color: '#ff5a5a' },
        p2: { name: b.look.name.toUpperCase(), frac: BX.clamp(b.healthFrac, 0, 1), color: '#5aa8ff' },
      });
    },

    render() {
      if (Game.contextLost) return;
      const r = Game.renderer, sm = r.shadowMap;
      // the shadow pass is skipped when the governor turned shadows off, and re-used every Nth frame on touch / mid tiers
      if (!Game.shadowsOn) { sm.autoUpdate = false; }
      else if (Game.tier.shadowEvery > 1) { sm.autoUpdate = false; if ((Game._frame = (Game._frame || 0) + 1) % Game.tier.shadowEvery === 0 || Game._frame < 3) sm.needsUpdate = true; }
      else sm.autoUpdate = true;
      r.render(Game.scene, Game.camera);
      BX.flushDispose();
    },
  };

  BX.Game = Game;
})();
