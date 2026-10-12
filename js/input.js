/* Knockout Arena — input: keyboard (rebindable), mouse, gamepad, touch. Every source maps to the same actions. */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  const EDGE_ACTIONS = new Set(['jab', 'cross', 'leadHook', 'rearHook', 'leadUpper', 'rearUpper', 'special', 'taunt', 'dodge', 'slipL', 'slipR']);
  const GLOBAL_KEYS = { Escape: 'pause', KeyP: 'pause', Tab: 'camera', KeyH: 'help', KeyO: 'mute' };

  const I = {
    mode: 'solo',
    bindings: null,
    keymap: new Map(), // code -> [{slot, action}]
    holds: [{}, {}],   // slot -> action -> Set(sourceId)
    queue: [[], []],   // slot -> pressed edge actions since last poll
    analog: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    capture: null,     // rebinding callback
    active: false,     // true while a fight is on screen (keys are swallowed)
    onGlobal: null,
    onAnyKey: null,
    padState: [{}, {}],
    lastDevice: 'keyboard',

    loadBindings() {
      const saved = BX.store.get('bindings', null);
      I.bindings = JSON.parse(JSON.stringify(BX.DEFAULT_BINDINGS));
      if (saved) {
        for (const set of Object.keys(I.bindings)) {
          if (saved[set]) for (const a of Object.keys(I.bindings[set])) if (Array.isArray(saved[set][a])) I.bindings[set][a] = saved[set][a].slice(0, 2);
        }
      }
      I.rebuild();
    },
    saveBindings() { BX.store.set('bindings', I.bindings); },
    resetBindings() {
      I.bindings = JSON.parse(JSON.stringify(BX.DEFAULT_BINDINGS));
      I.saveBindings();
      I.rebuild();
    },
    setBinding(set, action, index, code) {
      const b = I.bindings[set];
      // a key can only do one thing within a set
      for (const a of Object.keys(b)) b[a] = b[a].filter((c, i) => !(c === code && !(a === action && i === index)));
      const arr = b[action];
      while (arr.length < index) arr.push(null);
      if (code == null) arr.splice(index, 1); else arr[index] = code;
      b[action] = arr.filter((c) => c);
      I.saveBindings();
      I.rebuild();
    },

    configure(mode) {
      I.mode = mode;
      I.releaseAll();
      I.rebuild();
    },
    rebuild() {
      I.keymap.clear();
      const add = (set, slot) => {
        const b = I.bindings[set];
        for (const action of Object.keys(b)) for (const code of b[action]) {
          if (!code) continue;
          if (!I.keymap.has(code)) I.keymap.set(code, []);
          I.keymap.get(code).push({ slot, action });
        }
      };
      if (I.mode === 'versus') { add('p1', 0); add('p2', 1); } else add('solo', 0);
    },

    /* ------------ low level press / release (source aware so two devices don't fight) ------------ */
    press(slot, action, src) {
      const h = I.holds[slot];
      if (!h[action]) h[action] = new Set();
      if (h[action].has(src)) return;
      h[action].add(src);
      if (EDGE_ACTIONS.has(action)) {
        const q = I.queue[slot];
        q.push(action);
        if (q.length > 6) q.shift();
      }
    },
    release(slot, action, src) {
      const s = I.holds[slot][action];
      if (s) s.delete(src);
    },
    isDown(slot, action) {
      const s = I.holds[slot][action];
      return !!(s && s.size > 0);
    },
    releaseAll() {
      I.holds = [{}, {}];
      I.queue = [[], []];
      I.analog = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
      I.padState = [{}, {}];
    },

    /** Build the intent object a Fighter consumes this frame. */
    poll(slot) {
      const d = (a) => (I.isDown(slot, a) ? 1 : 0);
      const an = I.analog[slot];
      const intent = {
        moveF: BX.clamp(d('up') - d('down') + an.y, -1, 1),
        moveS: BX.clamp(d('right') - d('left') + an.x, -1, 1),
        block: !!d('block'),
        crouch: !!d('crouch'),
        actions: I.queue[slot].splice(0),
      };
      return intent;
    },
    /** Drop buffered presses (used when a fight starts, or the player is down and mashing instead). */
    flush(slot) { I.queue[slot].length = 0; },

    /* ------------ keyboard ------------ */
    _keydown(e) {
      if (I.capture) {
        e.preventDefault();
        const cb = I.capture;
        I.capture = null;
        e._captured = true;
        cb(e.code === 'Escape' ? null : e.code, e.code === 'Escape');
        return;
      }
      I.lastDevice = 'keyboard';
      if (I.onAnyKey && !e.repeat) I.onAnyKey(e);
      const g = GLOBAL_KEYS[e.code];
      if (g && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target && e.target.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          if (I.onGlobal && I.onGlobal(g, e) !== false) { e._handled = true; e.preventDefault(); return; }
        }
      }
      const targets = I.keymap.get(e.code);
      if (!targets) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (I.active) e.preventDefault();
      if (e.repeat) return;
      for (const t of targets) I.press(t.slot, t.action, 'k:' + e.code);
    },
    _keyup(e) {
      const targets = I.keymap.get(e.code);
      if (!targets) return;
      if (I.active) e.preventDefault();
      for (const t of targets) I.release(t.slot, t.action, 'k:' + e.code);
    },

    /* ------------ mouse (single player: left = jab, right = cross) ------------ */
    _mousedown(e) {
      if (!I.active || I.mode !== 'solo') return;
      if (e.target && e.target.closest && e.target.closest('.hud-btn, #touch, #overlay, .panel')) return;
      I.lastDevice = 'keyboard';
      if (e.button === 0) I.press(0, 'jab', 'm:0');
      else if (e.button === 2) I.press(0, 'cross', 'm:2');
    },
    _mouseup(e) {
      if (e.button === 0) I.release(0, 'jab', 'm:0');
      else if (e.button === 2) I.release(0, 'cross', 'm:2');
    },

    /* ------------ gamepad ------------ */
    pollPads() {
      if (!navigator.getGamepads) return;
      const pads = navigator.getGamepads();
      if (!pads) return;
      const connected = [];
      for (const p of pads) if (p && p.connected) connected.push(p);
      if (!connected.length) return;
      const BTN = { 0: 'cross', 2: 'jab', 3: 'leadHook', 1: 'rearHook', 4: 'leadUpper', 5: 'rearUpper', 6: 'block', 7: 'crouch', 8: 'special', 13: 'taunt' };
      const nSlots = I.mode === 'versus' ? 2 : 1;
      for (let i = 0; i < connected.length; i++) {
        const slot = I.mode === 'versus' ? Math.min(i, 1) : 0;
        if (i >= nSlots && I.mode === 'versus') break;
        const p = connected[i];
        const src = 'pad' + i;
        const ps = I.padState[slot];
        for (const bi of Object.keys(BTN)) {
          const b = p.buttons[bi];
          const down = !!(b && (b.pressed || b.value > 0.5));
          const key = 'b' + bi;
          if (down && !ps[key]) { I.press(slot, BTN[bi], src + ':' + bi); I.lastDevice = 'pad'; }
          if (!down && ps[key]) I.release(slot, BTN[bi], src + ':' + bi);
          ps[key] = down;
        }
        // d-pad also moves
        const dp = (n) => !!(p.buttons[n] && p.buttons[n].pressed);
        let ax = p.axes[0] || 0, ay = -(p.axes[1] || 0);
        if (Math.abs(ax) < 0.22) ax = 0;
        if (Math.abs(ay) < 0.22) ay = 0;
        if (dp(14)) ax = -1; if (dp(15)) ax = 1; if (dp(12)) ay = 1;
        if (Math.abs(ax) > 0 || Math.abs(ay) > 0) I.lastDevice = 'pad';
        I.analog[slot].x = ax; I.analog[slot].y = ay;
        // right stick flick = slip / dodge
        const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
        const flick = (k, cond, action) => {
          if (cond && !ps[k]) { I.press(slot, action, src + ':' + k); I.release(slot, action, src + ':' + k); }
          ps[k] = cond;
        };
        flick('rl', rx < -0.65, 'slipL');
        flick('rr', rx > 0.65, 'slipR');
        flick('rd', ry > 0.65, 'dodge');
      }
    },

    init(target) {
      I.loadBindings();
      window.addEventListener('keydown', I._keydown, { passive: false });
      window.addEventListener('keyup', I._keyup, { passive: false });
      window.addEventListener('blur', () => I.releaseAll());
      window.addEventListener('mousedown', I._mousedown);
      window.addEventListener('mouseup', I._mouseup);
      window.addEventListener('contextmenu', (e) => { if (I.active) e.preventDefault(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) I.releaseAll(); });
    },
  };

  BX.Input = I;
})();
