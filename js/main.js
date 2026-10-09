'use strict';
// Input handling (keyboard, touch, gamepad) and the fixed-timestep main loop.

const Input = {
  held: { left: false, right: false, down: false, jump: false, run: false },
  pressed: {},
  prev: {},
  keys: new Set(),
  taps: new Set(),
  touch: {},
  map: {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
    ShiftLeft: 'run', ShiftRight: 'run', KeyX: 'run', KeyJ: 'run',
  },

  init() {
    window.addEventListener('keydown', (e) => {
      const a = this.map[e.code];
      if (a && UI.current === null) e.preventDefault();
      if (a && !e.repeat) { this.keys.add(a); this.taps.add(a); }
      Sound.init();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
        if (UI.current === null || UI.current === 'pause') UI.togglePause();
        else if (['shop', 'ach', 'settings', 'map'].includes(UI.current)) UI.act(UI.current === 'map' ? 'home' : 'back', {});
      }
    });
    window.addEventListener('keyup', (e) => { const a = this.map[e.code]; if (a) this.keys.delete(a); });
    window.addEventListener('blur', () => { this.keys.clear(); if (UI.current === null) UI.togglePause(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && UI.current === null) UI.togglePause(true); });

    for (const b of document.querySelectorAll('#touch [data-key]')) {
      const k = b.dataset.key;
      const down = (e) => { e.preventDefault(); Sound.init(); this.touch[k] = true; this.taps.add(k); b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); this.touch[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  },

  pad() {
    const out = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      out.left = out.left || ax < -0.4 || b(14);
      out.right = out.right || ax > 0.4 || b(15);
      out.down = out.down || ay > 0.6 || b(13);
      out.jump = out.jump || b(0) || b(1);
      out.run = out.run || b(2) || b(3) || b(7);
      if (b(9) && !this.padStart) { UI.togglePause(); }
      this.padStart = b(9);
    }
    return out;
  },

  update() {
    const pad = this.pad();
    for (const k of Object.keys(this.held)) {
      const h = this.keys.has(k) || !!this.touch[k] || !!pad[k];
      this.pressed[k] = (h && !this.prev[k]) || this.taps.has(k);
      this.held[k] = h || this.taps.has(k);
      this.prev[k] = h;
    }
    this.taps.clear();
  },
};

(function boot() {
  Save.load();
  const canvas = document.getElementById('game');
  const game = new Game(canvas, Input);
  window.game = game; // handy for debugging
  UI.init(game);
  Input.init();
  window.addEventListener('resize', () => game.resize());
  // first interaction unlocks audio
  const unlock = () => { Sound.init(); if (!Sound.current) Sound.play('title'); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  const STEP = 1 / 60;
  let last = performance.now(), acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      Input.update();
      try { game.update(STEP); } catch (err) { console.error(err); }
      acc -= STEP; steps++;
    }
    if (steps >= 6) acc = 0;
    try { game.render(); } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
