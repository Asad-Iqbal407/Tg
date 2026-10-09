'use strict';
// All visuals are drawn procedurally (vector shapes on canvas) — no external image assets.

const THEMES = {
  meadow: {
    sky: ['#58b9f5', '#a9e0ff', '#e9f8ff'], style: 'grass', plat: 'wood', amb: 'petal', sun: '#fff3b0',
    ground: { base: '#c7844b', dark: '#9d6236', deep: '#7a4826', speck: '#e4a46b', top: '#5fd03f', topHi: '#a3ee6a', topDk: '#3b9e2c' },
    brick: ['#dc7b3e', '#a5512a', '#f6a46b'], stone: ['#b3a89b', '#857a6e', '#d9d0c4'],
    block: ['#ffc93c', '#d9901a', '#fff2a8'], pipe: ['#2fb8c8', '#1a7f96', '#a8f2ff'],
    enemy: '#9a5cf0',
  },
  cave: {
    sky: ['#0d0b1f', '#1b1638', '#2a2152'], style: 'stone', plat: 'stone', amb: 'firefly', dark: 0.62,
    ground: { base: '#3e3b70', dark: '#2c2954', deep: '#1e1b3d', speck: '#6c6fc0', top: '#45c7a5', topHi: '#8ff0d2', topDk: '#2b8c78' },
    brick: ['#5965b8', '#38408a', '#8b96e6'], stone: ['#6e6a96', '#4c4870', '#9a96c4'],
    block: ['#ffcf4a', '#d9911a', '#fff3b0'], pipe: ['#c05ad8', '#8a3aa0', '#f0a6ff'],
    enemy: '#ff7a59',
  },
  desert: {
    sky: ['#ff9a5a', '#ffcf8a', '#fff1cf'], style: 'sand', plat: 'wood', amb: 'sand', sun: '#fff8e0',
    ground: { base: '#e2ae62', dark: '#c18a42', deep: '#9c6a30', speck: '#f7d99c', top: '#f8dc93', topHi: '#fff1c4', topDk: '#d9b468' },
    brick: ['#d68a4a', '#a8602c', '#f5b57a'], stone: ['#d9b37a', '#b08650', '#f2d4a2'],
    block: ['#ffd23c', '#d9921a', '#fff3a8'], pipe: ['#3fb3b5', '#227a80', '#9cf0f0'],
    enemy: '#e8493a',
  },
  ice: {
    sky: ['#7fa8f0', '#bcd3ff', '#eef3ff'], style: 'snow', plat: 'ice', amb: 'snow', slippery: true, aurora: true,
    ground: { base: '#86c4ec', dark: '#5f9fd0', deep: '#4479b0', speck: '#d6f1ff', top: '#ffffff', topHi: '#ffffff', topDk: '#cfe4f7' },
    brick: ['#7fb3e0', '#4f7fb8', '#c4e4ff'], stone: ['#a9c8e6', '#7898c0', '#e0f0ff'],
    block: ['#ffd23c', '#d9921a', '#fff3a8'], pipe: ['#5b7fe0', '#3550a8', '#b8ccff'],
    enemy: '#3fb7a0',
  },
  sky: {
    sky: ['#ff8fb0', '#ffc2a8', '#fff2c8'], style: 'grass', plat: 'cloud', amb: 'sparkle', sun: '#fff7e0',
    ground: { base: '#d39ac0', dark: '#a8749a', deep: '#86557a', speck: '#f3c4e0', top: '#7fe06a', topHi: '#c8ff9a', topDk: '#4fb04a' },
    brick: ['#e889a8', '#b45f7c', '#ffc0d4'], stone: ['#dcc4e6', '#ae94bc', '#f6eaff'],
    block: ['#ffd23c', '#d9921a', '#fff3a8'], pipe: ['#ff9a4a', '#d06a24', '#ffd0a0'],
    enemy: '#5a7bff',
  },
  castle: {
    sky: ['#12060e', '#2a0e1c', '#5a1a20'], style: 'brick', plat: 'stone', amb: 'ember', dark: 0.3, lava: true,
    ground: { base: '#5a5262', dark: '#423b4a', deep: '#2c2634', speck: '#857c8e', top: '#8b8294', topHi: '#b1a8ba', topDk: '#5e5568' },
    brick: ['#8a5a62', '#5e3a42', '#b88a90'], stone: ['#7d7488', '#57506a', '#a9a0b4'],
    block: ['#ffc23c', '#d9851a', '#fff0a0'], pipe: ['#7d7488', '#57506a', '#b0a8bc'],
    enemy: '#ff9f3a',
  },
  bonus: {
    sky: ['#070a2a', '#1a1d5e', '#43287a'], style: 'crystal', plat: 'crystal', amb: 'twinkle', stars: true,
    ground: { base: '#4a2f8a', dark: '#36206a', deep: '#24134a', speck: '#a68cff', top: '#66f0ff', topHi: '#d4fbff', topDk: '#2fa8d8' },
    brick: ['#b06ae6', '#7c3fb0', '#e0b0ff'], stone: ['#8c78d8', '#5e4ca8', '#c0b0ff'],
    block: ['#ffd23c', '#d9921a', '#fff3a8'], pipe: ['#ff6ab0', '#c03a7c', '#ffc0e0'],
    enemy: '#ff6ab0',
  },
};

const SOLID = new Set(['G', 'B', '?', 'P', 'F', 'S', 'U', 'M', 'X', 'R', '[', ']', '{', '}', 'C']);
const LUCKY = new Set(['?', 'P', 'F', 'S']);

const Art = {
  RES: 4,
  cache: new Map(),

  tile(key, fn) {
    let c = this.cache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = TS * this.RES;
      const x = c.getContext('2d');
      x.scale(this.RES, this.RES);
      fn(x);
      this.cache.set(key, c);
    }
    return c;
  },

  // ---------------------------------------------------------------- tiles
  ground(themeName, th, m, alt) {
    return this.tile(`g:${themeName}:${m}:${alt}`, (x) => {
      const g = th.ground, st = th.style;
      const Up = m & 1, Rt = m & 2, Dn = m & 4, Lf = m & 8;
      const r = 4;
      U.roundRect(x, 0, 0, 16, 16, [Up && Lf ? r : 0, Up && Rt ? r : 0, Dn && Rt ? r : 0, Dn && Lf ? r : 0]);
      x.save();
      x.clip();
      x.fillStyle = g.base; x.fillRect(0, 0, 16, 16);
      const rnd = U.rng(m * 97 + alt * 13 + themeName.length * 7);
      if (st === 'brick') {
        x.fillStyle = g.dark;
        for (let row = 0; row < 2; row++) {
          x.fillRect(0, row * 8 + 7.2, 16, 0.8);
          const off = row % 2 ? 4 : 0;
          for (let bx = off; bx <= 16; bx += 8) x.fillRect(bx - 0.4, row * 8, 0.8, 8);
        }
        x.fillStyle = 'rgba(255,255,255,0.08)';
        for (let row = 0; row < 2; row++) x.fillRect(0, row * 8, 16, 1);
      } else if (st === 'sand') {
        x.fillStyle = g.dark;
        for (let i = 0; i < 3; i++) { x.globalAlpha = 0.35; x.fillRect(0, 5 + i * 4 + rnd() * 2, 16, 1.2); }
        x.globalAlpha = 1;
      } else if (st === 'snow') {
        x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(2 + rnd() * 4, 16); x.lineTo(12 + rnd() * 4, 4); x.stroke();
        x.lineWidth = 0.6; x.beginPath(); x.moveTo(8 + rnd() * 4, 16); x.lineTo(16, 9); x.stroke();
      } else if (st === 'crystal') {
        x.fillStyle = g.dark;
        x.beginPath(); x.moveTo(0, 16); x.lineTo(5 + rnd() * 3, 6); x.lineTo(9, 16); x.fill();
        x.fillStyle = 'rgba(180,140,255,0.35)';
        x.beginPath(); x.moveTo(8, 16); x.lineTo(12 + rnd() * 2, 8); x.lineTo(16, 16); x.fill();
      }
      // pebbles / specks
      if (st !== 'brick' && st !== 'crystal') {
        for (let i = 0; i < 3; i++) {
          x.fillStyle = g.dark;
          x.beginPath(); x.ellipse(2 + rnd() * 12, 6 + rnd() * 9, 1.4 + rnd(), 1 + rnd() * 0.6, 0, 0, 7); x.fill();
        }
        x.fillStyle = g.speck;
        for (let i = 0; i < 3; i++) x.fillRect(1 + rnd() * 14, 5 + rnd() * 10, 0.9, 0.9);
      }
      if (Dn) { const gr = x.createLinearGradient(0, 9, 0, 16); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); x.fillStyle = gr; x.fillRect(0, 0, 16, 16); }
      x.fillStyle = 'rgba(0,0,0,0.18)';
      if (Rt) x.fillRect(15, 0, 1, 16);
      x.fillStyle = 'rgba(255,255,255,0.12)';
      if (Lf) x.fillRect(0, 0, 1, 16);
      if (Up) {
        const scallop = (y, amp, color) => {
          x.fillStyle = color;
          x.beginPath(); x.moveTo(0, -1); x.lineTo(16, -1); x.lineTo(16, y);
          for (let i = 4; i > 0; i--) { const x0 = i * 4, x1 = (i - 1) * 4; x.quadraticCurveTo((x0 + x1) / 2, y + amp, x1, y); }
          x.closePath(); x.fill();
        };
        if (st === 'stone') {
          scallop(4.5, 2.5, g.topDk); scallop(3.2, 2, g.top);
          x.fillStyle = g.topHi; x.fillRect(0, 0, 16, 0.9);
        } else if (st === 'brick') {
          x.fillStyle = g.top; x.fillRect(0, 0, 16, 3);
          x.fillStyle = g.topHi; x.fillRect(0, 0, 16, 1);
          x.fillStyle = g.topDk; x.fillRect(0, 3, 16, 0.8);
        } else if (st === 'sand') {
          scallop(5, 1.8, g.topDk); scallop(4, 1.5, g.top);
          x.fillStyle = g.topHi; x.fillRect(0, 0, 16, 1.1);
        } else if (st === 'snow') {
          scallop(6, 2.8, g.topDk); scallop(4.8, 2.4, g.top);
          x.fillStyle = 'rgba(160,210,255,0.5)'; x.fillRect(0, 0, 16, 0.6);
        } else if (st === 'crystal') {
          scallop(4.5, 2, g.topDk); scallop(3.4, 1.6, g.top);
          x.fillStyle = g.topHi; x.fillRect(0, 0, 16, 1);
        } else {
          scallop(6.2, 2.6, g.topDk); scallop(5, 2.4, g.top);
          x.fillStyle = g.topHi; x.fillRect(0, 0, 16, 1.4);
          x.fillStyle = g.topHi;
          for (let i = 0; i < 3; i++) x.fillRect(2 + rnd() * 12, 1.8 + rnd() * 1.5, 1.2, 0.8);
        }
        if (Lf) { x.fillStyle = g.topDk; x.fillRect(0, 0, 1.2, 6); }
        if (Rt) { x.fillStyle = g.topDk; x.fillRect(14.8, 0, 1.2, 6); }
      }
      x.restore();
    });
  },

  brick(themeName, th) {
    return this.tile('b:' + themeName, (x) => {
      const c = th.brick;
      x.fillStyle = c[1]; x.fillRect(0, 0, 16, 16);
      const bricks = [[0.5, 0.5, 7, 7], [8.5, 0.5, 7, 7], [0, 8.5, 3.5, 7], [4.5, 8.5, 7, 7], [12.5, 8.5, 3.5, 7]];
      for (const [bx, by, bw, bh] of bricks) {
        x.fillStyle = c[0]; U.roundRect(x, bx, by, bw, bh, 1); x.fill();
        x.fillStyle = c[2]; x.fillRect(bx + 0.8, by + 0.6, bw - 1.6, 1);
        x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(bx + 0.6, by + bh - 1.2, bw - 1.2, 1);
      }
    });
  },

  lucky(th, f, kind) {
    return this.tile(`q:${th.block[0]}:${f}`, (x) => {
      const c = th.block;
      x.fillStyle = c[1]; U.roundRect(x, 0.2, 0.2, 15.6, 15.6, 2.5); x.fill();
      const gr = x.createLinearGradient(0, 0, 0, 16);
      gr.addColorStop(0, c[2]); gr.addColorStop(0.35, c[0]); gr.addColorStop(1, c[1]);
      x.fillStyle = gr; U.roundRect(x, 1, 1, 14, 13.4, 2); x.fill();
      x.fillStyle = 'rgba(120,60,0,0.5)';
      for (const [rx, ry] of [[2.6, 2.6], [13.4, 2.6], [2.6, 12.6], [13.4, 12.6]]) { x.beginPath(); x.arc(rx, ry, 0.9, 0, 7); x.fill(); }
      // sparkle emblem
      const p = 1 + Math.sin((f / 6) * Math.PI * 2) * 0.12;
      x.save(); x.translate(8, 7.8); x.scale(p, p);
      x.fillStyle = 'rgba(140,70,0,0.55)';
      this.sparkle(x, 0.6, 0.8, 5.2);
      x.fillStyle = '#ffffff';
      this.sparkle(x, 0, 0, 5.2);
      x.fillStyle = c[0]; x.beginPath(); x.arc(0, 0, 1.1, 0, 7); x.fill();
      x.restore();
      x.fillStyle = 'rgba(255,255,255,' + (0.25 + 0.2 * Math.sin((f / 6) * Math.PI * 2)) + ')';
      x.fillRect(2, 1.6, 12, 1);
    });
  },

  sparkle(x, cx, cy, r) {
    x.beginPath();
    x.moveTo(cx, cy - r);
    x.quadraticCurveTo(cx + r * 0.18, cy - r * 0.18, cx + r, cy);
    x.quadraticCurveTo(cx + r * 0.18, cy + r * 0.18, cx, cy + r);
    x.quadraticCurveTo(cx - r * 0.18, cy + r * 0.18, cx - r, cy);
    x.quadraticCurveTo(cx - r * 0.18, cy - r * 0.18, cx, cy - r);
    x.fill();
  },

  used(th) {
    return this.tile('x:' + th.block[0], (x) => {
      x.fillStyle = '#5b3a24'; U.roundRect(x, 0.2, 0.2, 15.6, 15.6, 2.5); x.fill();
      x.fillStyle = '#8a5a36'; U.roundRect(x, 1, 1, 14, 13.4, 2); x.fill();
      x.fillStyle = '#a8724a'; x.fillRect(2, 1.6, 12, 1);
      x.fillStyle = '#4a2e1c';
      for (const [rx, ry] of [[2.6, 2.6], [13.4, 2.6], [2.6, 12.6], [13.4, 12.6]]) { x.beginPath(); x.arc(rx, ry, 0.9, 0, 7); x.fill(); }
    });
  },

  stone(themeName, th) {
    return this.tile('r:' + themeName, (x) => {
      const c = th.stone;
      x.fillStyle = c[1]; U.roundRect(x, 0, 0, 16, 16, 1.5); x.fill();
      x.fillStyle = c[0]; U.roundRect(x, 1.2, 1.2, 13.6, 13.6, 1); x.fill();
      x.fillStyle = c[2];
      x.beginPath(); x.moveTo(1.2, 1.2); x.lineTo(14.8, 1.2); x.lineTo(12.5, 3.5); x.lineTo(3.5, 3.5); x.lineTo(3.5, 12.5); x.lineTo(1.2, 14.8); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.2)';
      x.beginPath(); x.moveTo(14.8, 14.8); x.lineTo(1.2, 14.8); x.lineTo(3.5, 12.5); x.lineTo(12.5, 12.5); x.lineTo(12.5, 3.5); x.lineTo(14.8, 1.2); x.fill();
    });
  },

  pipe(themeName, th, part) {
    return this.tile(`p:${themeName}:${part}`, (x) => {
      const c = th.pipe;
      const right = part === ']' || part === '}';
      const top = part === '[' || part === ']';
      x.translate(right ? -16 : 0, 0);
      const gr = x.createLinearGradient(0, 0, 32, 0);
      gr.addColorStop(0, c[1]); gr.addColorStop(0.18, c[0]); gr.addColorStop(0.32, c[2]);
      gr.addColorStop(0.45, c[0]); gr.addColorStop(0.85, c[1]); gr.addColorStop(1, '#0a3a1c');
      x.fillStyle = gr;
      if (top) {
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(2, 8, 28, 8);
        x.fillStyle = gr; U.roundRect(x, 0.3, 0.3, 31.4, 8, 1.5); x.fill();
        x.fillStyle = gr; x.fillRect(2, 8.3, 28, 7.7);
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(1.5, 1, 29, 0.9);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(2, 8.3, 28, 1.2);
      } else {
        x.fillRect(2, 0, 28, 16);
        x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(2, 10, 28, 1.2);
        x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(2, 11.2, 28, 1.2);
      }
      x.fillStyle = 'rgba(0,0,0,0.3)';
      if (top) { x.fillRect(0.3, 7.5, 31.4, 0.8); } else { x.fillRect(2, 0, 0.7, 16); x.fillRect(29.3, 0, 0.7, 16); }
    });
  },

  oneway(themeName, th, l, r) {
    return this.tile(`o:${themeName}:${l}:${r}`, (x) => {
      const t = th.plat;
      if (t === 'cloud') {
        x.fillStyle = 'rgba(200,170,220,0.6)';
        x.beginPath(); x.ellipse(8, 6.5, 9, 3.5, 0, 0, 7); x.fill();
        x.fillStyle = '#ffffff';
        for (const [cx, cy, rr] of [[3, 4, 3.6], [8, 3, 4.2], [13, 4, 3.6]]) {
          if ((cx < 5 && l) || (cx > 11 && r)) { x.beginPath(); x.arc(cx + (cx < 5 ? 1 : -1), cy + 0.5, rr - 0.8, 0, 7); x.fill(); continue; }
          x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill();
        }
        if (!l) x.fillRect(0, 1.5, 4, 5); if (!r) x.fillRect(12, 1.5, 4, 5);
        x.fillStyle = 'rgba(255,220,240,0.9)'; x.fillRect(l ? 2 : 0, 6, 16 - (l ? 2 : 0) - (r ? 2 : 0), 1.2);
        return;
      }
      const col = t === 'ice' ? ['#d8f0ff', '#8ec5ef', '#ffffff'] : t === 'stone' ? ['#8d8498', '#5c5468', '#b9b0c4']
        : t === 'crystal' ? ['#9c7cff', '#5e3cc8', '#e2d4ff'] : ['#c98a4b', '#8a5a2b', '#efb57a'];
      x.fillStyle = col[1]; U.roundRect(x, l ? 0.5 : -1, 0, 16 + (l ? -0.5 : 1) + (r ? -0.5 : 1), 6, [l ? 2 : 0, r ? 2 : 0, r ? 2 : 0, l ? 2 : 0]); x.fill();
      x.fillStyle = col[0]; x.fillRect(l ? 1.2 : 0, 0.8, 16 - (l ? 1.2 : 0) - (r ? 1.2 : 0), 3.6);
      x.fillStyle = col[2]; x.fillRect(l ? 1.2 : 0, 0.8, 16 - (l ? 1.2 : 0) - (r ? 1.2 : 0), 0.9);
      if (t === 'wood') {
        x.fillStyle = col[1];
        x.fillRect(7.6, 0.8, 0.8, 3.6);
        x.beginPath(); x.arc(3.5, 2.7, 0.6, 0, 7); x.arc(12.5, 2.7, 0.6, 0, 7); x.fill();
        if (l) { x.fillRect(2, 6, 2, 3); } if (r) { x.fillRect(12, 6, 2, 3); }
      }
      if (t === 'ice') {
        x.fillStyle = '#ffffff';
        x.beginPath(); x.moveTo(4, 6); x.lineTo(5, 9); x.lineTo(6, 6); x.fill();
        x.beginPath(); x.moveTo(10, 6); x.lineTo(11, 8); x.lineTo(12, 6); x.fill();
      }
    });
  },

  spikes(themeName) {
    return this.tile('s:' + themeName, (x) => {
      x.fillStyle = '#5a5a6e'; x.fillRect(0, 13, 16, 3);
      for (let i = 0; i < 3; i++) {
        const bx = i * 5.33;
        const gr = x.createLinearGradient(bx, 0, bx + 5.33, 0);
        gr.addColorStop(0, '#f2f4ff'); gr.addColorStop(0.5, '#b8bccc'); gr.addColorStop(1, '#6e7286');
        x.fillStyle = gr;
        x.beginPath(); x.moveTo(bx, 13.5); x.lineTo(bx + 2.66, 4); x.lineTo(bx + 5.33, 13.5); x.fill();
      }
      x.fillStyle = '#8a8ea2'; x.fillRect(0, 13, 16, 1);
    });
  },

  cannon(top) {
    return this.tile('c:' + top, (x) => {
      if (top) {
        x.fillStyle = '#2b2a3a'; U.roundRect(x, 0.5, 1, 15, 15, 4); x.fill();
        x.fillStyle = '#44425a'; U.roundRect(x, 1.5, 2, 13, 6, 3); x.fill();
        x.fillStyle = '#0d0c14'; x.beginPath(); x.ellipse(1.5, 9, 1.5, 3.5, 0, 0, 7); x.ellipse(14.5, 9, 1.5, 3.5, 0, 0, 7); x.fill();
        x.fillStyle = '#ffcf3a'; x.fillRect(0.5, 12.5, 15, 2);
        x.fillStyle = '#ff6a3d'; x.beginPath(); x.arc(8, 8, 2.2, 0, 7); x.fill();
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(7.3, 7.3, 0.7, 0, 7); x.fill();
      } else {
        x.fillStyle = '#3a3850'; x.fillRect(2, 0, 12, 16);
        x.fillStyle = '#55526e'; x.fillRect(3, 0, 3, 16);
        x.fillStyle = '#ffcf3a'; x.fillRect(2, 6, 12, 1.5);
        x.fillStyle = '#22212e'; x.fillRect(12.5, 0, 1.5, 16);
      }
    });
  },

  // ---------------------------------------------------------------- background
  layerCache: new Map(),
  LW: 1024,
  layers(themeName) {
    if (this.layerCache.has(themeName)) return this.layerCache.get(themeName);
    const th = THEMES[themeName];
    const W = this.LW, H = 240, R = 2;
    const make = (factor, fn) => {
      const c = document.createElement('canvas');
      c.width = W * R; c.height = H * R;
      const x = c.getContext('2d');
      x.scale(R, R);
      fn(x, W, H);
      return { c, factor };
    };
    const rnd = U.rng(themeName.length * 1337 + 7);
    // tileable ridge function
    const ridge = (x, ks, amps, phases) => { let v = 0; for (let i = 0; i < ks.length; i++) v += amps[i] * Math.sin((x / W) * Math.PI * 2 * ks[i] + phases[i]); return v; };
    const peaks = (x, k, ph) => 1 - Math.abs(Math.sin((x / W) * Math.PI * k + ph));
    const fillShape = (x, f, color, gradTo) => {
      x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 4) x.lineTo(px, f(px));
      x.lineTo(W, H); x.closePath();
      if (gradTo) { const gr = x.createLinearGradient(0, 60, 0, H); gr.addColorStop(0, color); gr.addColorStop(1, gradTo); x.fillStyle = gr; } else x.fillStyle = color;
      x.fill();
    };
    const tree = (x, tx, ty, s, c1, c2) => {
      x.fillStyle = '#6b4a32'; x.fillRect(tx - 1.5 * s, ty - 6 * s, 3 * s, 8 * s);
      x.fillStyle = c2; x.beginPath(); x.arc(tx, ty - 12 * s, 8 * s, 0, 7); x.fill();
      x.fillStyle = c1; x.beginPath(); x.arc(tx - 2 * s, ty - 14 * s, 6 * s, 0, 7); x.fill();
    };
    const pine = (x, tx, ty, s, c) => {
      x.fillStyle = c;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(tx - (9 - i * 2) * s, ty - i * 7 * s); x.lineTo(tx, ty - (14 + i * 7) * s); x.lineTo(tx + (9 - i * 2) * s, ty - i * 7 * s); x.fill(); }
    };
    const wrap = (x, fn, px) => { fn(px); if (px < 60) fn(px + W); if (px > W - 60) fn(px - W); };
    let L = [];
    if (themeName === 'meadow' || themeName === 'sky') {
      const isSky = themeName === 'sky';
      L.push(make(0.12, (x) => {
        const f = (px) => 120 + ridge(px, [1, 3, 7], [10, 14, 5], [0.3, 1.2, 2]) - peaks(px, 5, 0.4) * 50;
        fillShape(x, f, isSky ? '#f5c8e0' : '#a9d3f0', isSky ? '#ffe2d2' : '#d6ecfa');
        // snow caps
        x.save(); x.beginPath(); x.moveTo(0, H); for (let px = 0; px <= W; px += 4) x.lineTo(px, f(px)); x.lineTo(W, H); x.clip();
        x.fillStyle = 'rgba(255,255,255,0.85)';
        x.beginPath(); x.moveTo(0, 0); for (let px = 0; px <= W; px += 4) x.lineTo(px, Math.min(f(px) + 10, 98)); x.lineTo(W, 0); x.fill(); x.restore();
      }));
      if (isSky) {
        L.push(make(0.3, (x) => {
          for (let i = 0; i < 5; i++) {
            const ix = i * (W / 5) + rnd() * 60, iy = 80 + rnd() * 60, iw = 50 + rnd() * 40;
            wrap(x, (px) => {
              x.fillStyle = '#c99ad8'; x.beginPath(); x.moveTo(px - iw / 2, iy); x.quadraticCurveTo(px, iy + iw * 0.9, px + iw / 2, iy); x.fill();
              x.fillStyle = '#8ad870'; U.roundRect(x, px - iw / 2 - 2, iy - 5, iw + 4, 8, 4); x.fill();
              x.fillStyle = 'rgba(160,220,255,0.7)'; x.fillRect(px + iw * 0.2, iy + 2, 3, 120);
              tree(x, px - iw * 0.2, iy - 3, 0.8, '#a6f08a', '#5fbf55');
            }, ix);
          }
        }));
      } else {
        L.push(make(0.3, (x) => {
          const f = (px) => 160 + ridge(px, [2, 5, 9], [12, 8, 4], [1, 2, 0.5]);
          fillShape(x, f, '#86d36c', '#5fb055');
          for (let i = 0; i < 26; i++) { const px = rnd() * W; wrap(x, (q) => tree(x, q, f(q) + 4, 0.7 + rnd() * 0.4, '#7fd86a', '#4a9e48'), px); }
        }));
      }
      L.push(make(0.55, (x) => {
        if (isSky) {
          for (let i = 0; i < 14; i++) {
            const px = rnd() * W, py = 170 + rnd() * 50, s = 12 + rnd() * 16;
            wrap(x, (q) => { x.fillStyle = 'rgba(255,255,255,0.85)'; for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(q + (j - 1.5) * s * 0.8, py - Math.sin(j) * s * 0.3, s * 0.7, 0, 7); x.fill(); } }, px);
          }
          x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(0, 214, W, 30);
        } else {
          const f = (px) => 196 + ridge(px, [3, 7, 13], [8, 5, 2], [0.2, 1.4, 2.2]);
          fillShape(x, f, '#59b847', '#3f9638');
          for (let i = 0; i < 40; i++) { const px = rnd() * W; wrap(x, (q) => { x.fillStyle = U.pick(['#ffffff', '#ffd23f', '#ff8fb0']); x.beginPath(); x.arc(q, f(q) + 6 + rnd() * 20, 1.4, 0, 7); x.fill(); }, px); }
        }
      }));
    } else if (themeName === 'cave') {
      L.push(make(0.15, (x) => {
        for (let i = 0; i < 14; i++) {
          const px = rnd() * W, w = 20 + rnd() * 40;
          wrap(x, (q) => { const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1b1840'); gr.addColorStop(1, '#2a2458'); x.fillStyle = gr; x.fillRect(q - w / 2, 0, w, H); }, px);
        }
      }));
      L.push(make(0.35, (x) => {
        x.fillStyle = '#16132f';
        x.beginPath(); x.moveTo(0, 0);
        for (let px = 0; px <= W; px += 8) x.lineTo(px, 30 + Math.abs(ridge(px, [4, 11, 23], [14, 10, 6], [0, 1, 2])) + peaks(px, 31, 0.2) * 30);
        x.lineTo(W, 0); x.fill();
        fillShape(x, (px) => 190 + ridge(px, [3, 8, 17], [10, 8, 5], [1, 0, 2]), '#1d1a40');
      }));
      L.push(make(0.6, (x) => {
        for (let i = 0; i < 18; i++) {
          const px = rnd() * W, py = 190 + rnd() * 40, s = 0.6 + rnd() * 0.8, col = U.pick(['#55e6ff', '#c27bff', '#5affb2']);
          wrap(x, (q) => {
            x.shadowColor = col; x.shadowBlur = 10; x.fillStyle = col; x.globalAlpha = 0.7;
            for (let j = -1; j <= 1; j++) { x.beginPath(); x.moveTo(q + j * 5 * s - 3 * s, py); x.lineTo(q + j * 5 * s, py - (14 - Math.abs(j) * 5) * s); x.lineTo(q + j * 5 * s + 3 * s, py); x.fill(); }
            x.globalAlpha = 1; x.shadowBlur = 0;
          }, px);
        }
      }));
    } else if (themeName === 'desert') {
      L.push(make(0.12, (x) => fillShape(x, (px) => 150 + ridge(px, [1, 3, 5], [14, 10, 6], [0, 1, 2]), '#f7c98e', '#f0b878')));
      L.push(make(0.3, (x) => {
        for (let i = 0; i < 4; i++) {
          const px = (i + 0.5) * (W / 4) + rnd() * 80, s = 60 + rnd() * 50, by = 200;
          wrap(x, (q) => {
            x.fillStyle = '#e09a58'; x.beginPath(); x.moveTo(q - s, by); x.lineTo(q, by - s * 0.9); x.lineTo(q + s, by); x.fill();
            x.fillStyle = '#c47e44'; x.beginPath(); x.moveTo(q, by - s * 0.9); x.lineTo(q + s, by); x.lineTo(q + s * 0.15, by); x.fill();
          }, px);
        }
        fillShape(x, (px) => 196 + ridge(px, [2, 5], [8, 4], [2, 1]), '#eab274');
      }));
      L.push(make(0.55, (x) => {
        const f = (px) => 212 + ridge(px, [3, 7], [7, 3], [0.5, 2]);
        fillShape(x, f, '#f2c27e', '#e0a862');
        for (let i = 0; i < 10; i++) {
          const px = rnd() * W, s = 0.8 + rnd() * 0.6;
          wrap(x, (q) => {
            const by = f(q) + 2; x.fillStyle = '#4fa858';
            U.roundRect(x, q - 3 * s, by - 26 * s, 6 * s, 26 * s, 3 * s); x.fill();
            U.roundRect(x, q - 11 * s, by - 18 * s, 4 * s, 10 * s, 2 * s); x.fill(); x.fillRect(q - 11 * s, by - 10 * s, 9 * s, 3 * s);
            U.roundRect(x, q + 7 * s, by - 22 * s, 4 * s, 10 * s, 2 * s); x.fill(); x.fillRect(q + 2 * s, by - 14 * s, 9 * s, 3 * s);
          }, px);
        }
      }));
    } else if (themeName === 'ice') {
      L.push(make(0.1, (x) => {
        const f = (px) => 110 + ridge(px, [2, 5], [12, 6], [0, 2]) - peaks(px, 4, 1.1) * 60;
        fillShape(x, f, '#c9d8f7', '#a6bde8');
        x.save(); x.beginPath(); x.moveTo(0, H); for (let px = 0; px <= W; px += 4) x.lineTo(px, f(px)); x.lineTo(W, H); x.clip();
        x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(0, 0); for (let px = 0; px <= W; px += 4) x.lineTo(px, f(px) + 18 + Math.sin(px * 0.2) * 3); x.lineTo(W, 0); x.fill(); x.restore();
      }));
      L.push(make(0.3, (x) => {
        const f = (px) => 175 + ridge(px, [3, 7], [10, 5], [1, 0]);
        fillShape(x, f, '#e4effc', '#c3d6ef');
        for (let i = 0; i < 40; i++) { const px = rnd() * W; wrap(x, (q) => pine(x, q, f(q) + 6, 0.8 + rnd() * 0.6, '#4f78ad'), px); }
      }));
      L.push(make(0.55, (x) => {
        const f = (px) => 208 + ridge(px, [4, 9], [6, 3], [0, 1]);
        fillShape(x, f, '#ffffff', '#d6e7fb');
        for (let i = 0; i < 16; i++) { const px = rnd() * W; wrap(x, (q) => { pine(x, q, f(q) + 4, 1 + rnd() * 0.4, '#3a6a9c'); x.fillStyle = '#ffffff'; x.beginPath(); x.arc(q, f(q) - 20, 3, 0, 7); x.fill(); }, px); }
      }));
    } else if (themeName === 'castle') {
      L.push(make(0.12, (x) => {
        x.fillStyle = '#2a0f20';
        for (let i = 0; i < 8; i++) {
          const px = rnd() * W, w = 24 + rnd() * 24, h = 80 + rnd() * 70;
          wrap(x, (q) => {
            x.fillStyle = '#2a0f20'; x.fillRect(q - w / 2, H - h, w, h);
            for (let k = 0; k < 3; k++) x.fillRect(q - w / 2 + k * (w / 3) + 1, H - h - 6, w / 3 - 4, 6);
            x.beginPath(); x.moveTo(q - w / 2 - 4, H - h - 6); x.lineTo(q, H - h - 40); x.lineTo(q + w / 2 + 4, H - h - 6); x.fill();
            x.fillStyle = '#ffb04a'; x.globalAlpha = 0.8;
            for (let k = 0; k < 3; k++) { U.roundRect(x, q - 3, H - h + 14 + k * 22, 6, 9, [3, 3, 0, 0]); x.fill(); }
            x.globalAlpha = 1;
          }, px);
        }
      }));
      L.push(make(0.35, (x) => {
        for (let i = 0; i < 6; i++) {
          const px = i * (W / 6);
          x.fillStyle = '#1e0a16'; x.fillRect(px, 0, 22, H);
          x.fillStyle = '#2b1020'; x.fillRect(px + 3, 0, 4, H);
          x.strokeStyle = '#1e0a16'; x.lineWidth = 10;
          x.beginPath(); x.arc(px + 11 + W / 12, 40, W / 12 - 11, Math.PI, 0); x.stroke();
          x.strokeStyle = '#4a4458'; x.lineWidth = 2; x.beginPath();
          for (let k = 0; k < 8; k++) { x.moveTo(px + W / 12 + 11 + Math.sin(k) * 2, 30 + k * 8); x.arc(px + W / 12 + 11, 30 + k * 8, 3, 0, 7); }
          x.stroke();
        }
      }));
    } else if (themeName === 'bonus') {
      L.push(make(0.08, (x) => {
        for (let i = 0; i < 6; i++) {
          const px = rnd() * W, py = 40 + rnd() * 120, r = 60 + rnd() * 80, col = U.pick(['rgba(255,90,200,0.18)', 'rgba(90,160,255,0.18)', 'rgba(160,90,255,0.2)']);
          wrap(x, (q) => { const gr = x.createRadialGradient(q, py, 0, q, py, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(q - r, py - r, r * 2, r * 2); }, px);
        }
      }));
      L.push(make(0.35, (x) => {
        for (let i = 0; i < 16; i++) {
          const px = rnd() * W, h = 40 + rnd() * 90, w = 8 + rnd() * 12;
          wrap(x, (q) => {
            const gr = x.createLinearGradient(0, H - h, 0, H); gr.addColorStop(0, '#7a5ce0'); gr.addColorStop(1, '#2a1660');
            x.fillStyle = gr; x.beginPath(); x.moveTo(q - w, H); x.lineTo(q - w * 0.6, H - h * 0.8); x.lineTo(q, H - h); x.lineTo(q + w * 0.6, H - h * 0.8); x.lineTo(q + w, H); x.fill();
            x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.moveTo(q, H - h); x.lineTo(q + w * 0.6, H - h * 0.8); x.lineTo(q + 2, H); x.fill();
          }, px);
        }
      }));
    }
    this.layerCache.set(themeName, L);
    return L;
  },

  drawSky(ctx, themeName, vw, vh, camX, t) {
    const th = THEMES[themeName];
    const gr = ctx.createLinearGradient(0, 0, 0, vh);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.6, th.sky[1]); gr.addColorStop(1, th.sky[2]);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh);
    if (th.stars) {
      const rnd = U.rng(99);
      for (let i = 0; i < 90; i++) {
        const sx = ((rnd() * 1200 - camX * 0.03) % 1200 + 1200) % 1200, sy = rnd() * vh * 0.8;
        if (sx > vw) continue;
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.5 + rnd() * 2) + i));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    }
    if (th.sun) {
      const sx = vw * 0.78 - camX * 0.02, sy = vh * 0.18;
      const g2 = ctx.createRadialGradient(sx, sy, 4, sx, sy, 70);
      g2.addColorStop(0, 'rgba(255,255,220,0.9)'); g2.addColorStop(0.3, 'rgba(255,240,180,0.35)'); g2.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = g2; ctx.fillRect(sx - 70, sy - 70, 140, 140);
      ctx.fillStyle = th.sun; ctx.beginPath(); ctx.arc(sx, sy, 16, 0, 7); ctx.fill();
    }
    if (themeName === 'castle') {
      const sx = vw * 0.2 - camX * 0.02, sy = vh * 0.2;
      ctx.fillStyle = 'rgba(255,90,60,0.25)'; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff7a5a'; ctx.beginPath(); ctx.arc(sx, sy, 20, 0, 7); ctx.fill();
      ctx.fillStyle = '#d9533c'; ctx.beginPath(); ctx.arc(sx + 5, sy - 4, 4, 0, 7); ctx.arc(sx - 6, sy + 6, 3, 0, 7); ctx.fill();
    }
    if (th.aurora) {
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let px = 0; px <= vw; px += 8) {
          const py = 30 + k * 14 + Math.sin(px * 0.01 + t * 0.4 + k) * 12 + Math.sin(px * 0.023 - t * 0.3) * 6;
          px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.strokeStyle = ['rgba(120,255,200,0.25)', 'rgba(140,180,255,0.22)', 'rgba(220,140,255,0.18)'][k];
        ctx.lineWidth = 10; ctx.stroke();
      }
    }
    if (['meadow', 'sky', 'desert', 'ice'].includes(themeName)) {
      const rnd = U.rng(5);
      for (let i = 0; i < 7; i++) {
        const span = 1400, s = 0.6 + rnd() * 0.8;
        const cx = ((rnd() * span - camX * 0.06 - t * (3 + rnd() * 4)) % span + span) % span - 100;
        const cy = 20 + rnd() * vh * 0.35;
        if (cx > vw + 80) continue;
        this.cloud(ctx, cx, cy, s, themeName === 'desert' ? 'rgba(255,250,240,0.8)' : 'rgba(255,255,255,0.92)');
      }
    }
  },

  cloud(ctx, x, y, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 10 * s, 0, 7); ctx.arc(x + 12 * s, y - 6 * s, 13 * s, 0, 7);
    ctx.arc(x + 26 * s, y, 10 * s, 0, 7); ctx.arc(x + 13 * s, y + 4 * s, 10 * s, 0, 7);
    ctx.fill();
  },

  drawLayers(ctx, themeName, camX, camY, vw) {
    const W = this.LW;
    for (const l of this.layers(themeName)) {
      let off = -((camX * l.factor) % W);
      if (off > 0) off -= W;
      for (let x = off; x < vw; x += W) ctx.drawImage(l.c, x, -camY, W, 240);
    }
  },

  // ---------------------------------------------------------------- items
  coin(ctx, x, y, t, s = 1) {
    const w = Math.max(0.15, Math.abs(Math.cos(t * 3.2)));
    ctx.save(); ctx.translate(x, y); ctx.scale(w * s, s);
    ctx.fillStyle = '#c47a0a'; ctx.beginPath(); ctx.ellipse(0, 0.5, 5.2, 6.2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffb11a'; ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 4.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe680'; ctx.fillRect(-0.8, -3, 1.6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.ellipse(-2, -3, 1, 1.6, 0.4, 0, 7); ctx.fill();
    ctx.restore();
  },

  medal(ctx, x, y, t, ghost) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 3) * 1.5);
    if (ghost) ctx.globalAlpha = 0.45;
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 16);
    gl.addColorStop(0, 'rgba(255,240,150,0.6)'); gl.addColorStop(1, 'rgba(255,240,150,0)');
    ctx.fillStyle = gl; ctx.fillRect(-16, -16, 32, 32);
    ctx.fillStyle = '#e04848'; ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(-8, 12); ctx.lineTo(-4, 10); ctx.lineTo(-2, 13); ctx.lineTo(0, 4); ctx.fill();
    ctx.fillStyle = '#3f7fe0'; ctx.beginPath(); ctx.moveTo(5, 3); ctx.lineTo(8, 12); ctx.lineTo(4, 10); ctx.lineTo(2, 13); ctx.lineTo(0, 4); ctx.fill();
    const w = 0.7 + 0.3 * Math.abs(Math.cos(t * 1.6));
    ctx.scale(w, 1);
    ctx.fillStyle = '#b8780a'; ctx.beginPath(); ctx.arc(0, 0.6, 7.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, 0, 7.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffeb8a'; ctx.beginPath(); ctx.arc(0, 0, 5.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff9f1a'; U.star(ctx, 0, 0.3, 5, 4.6, 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; U.star(ctx, -0.3, -0.2, 5, 4, 1.7); ctx.fill();
    ctx.fillStyle = '#ffcf3a'; U.star(ctx, 0, 0, 5, 2.6, 1.1); ctx.fill();
    ctx.restore();
  },

  gem(ctx, x, y, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 2.5) * 1.5);
    const w = 0.6 + 0.4 * Math.abs(Math.cos(t * 2));
    ctx.scale(w, 1);
    ctx.fillStyle = '#1a8ab0';
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-3, -6); ctx.lineTo(3, -6); ctx.lineTo(6, -2); ctx.lineTo(0, 7); ctx.fill();
    ctx.fillStyle = '#5ae6ff'; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(6, -2); ctx.lineTo(0, 7); ctx.fill();
    ctx.fillStyle = '#b8f6ff'; ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(3, -6); ctx.lineTo(1.5, -2); ctx.lineTo(-1.5, -2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-3.5, -1, 1.2, 3);
    ctx.restore();
  },

  power(ctx, kind, x, y, t) {
    ctx.save(); ctx.translate(x, y);
    if (kind === 'berry') {
      ctx.fillStyle = '#c0281e'; ctx.beginPath(); ctx.arc(0, 1.5, 7, 0, 7); ctx.fill();
      const gr = ctx.createRadialGradient(-2, -1, 1, 0, 1, 7);
      gr.addColorStop(0, '#ffb15a'); gr.addColorStop(0.5, '#ff6a2a'); gr.addColorStop(1, '#d8331f');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 1, 6.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe7a0';
      for (const [sx, sy] of [[-3, 0], [2, -1], [0, 4], [3.5, 3], [-3, 4]]) { ctx.beginPath(); ctx.arc(sx, sy, 0.6, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#3fae3a'; ctx.beginPath(); ctx.ellipse(-2.5, -6, 3.5, 1.6, -0.5, 0, 7); ctx.ellipse(2.5, -6, 3.5, 1.6, 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a1a10'; ctx.beginPath(); ctx.arc(-2, 1.5, 0.9, 0, 7); ctx.arc(2, 1.5, 0.9, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-3.5, -2, 1.2, 2, 0.5, 0, 7); ctx.fill();
    } else if (kind === 'ember') {
      ctx.fillStyle = '#2f9a3a'; ctx.fillRect(-0.8, 0, 1.6, 8);
      ctx.beginPath(); ctx.ellipse(-3, 5, 3, 1.3, 0.5, 0, 7); ctx.ellipse(3, 6, 3, 1.3, -0.5, 0, 7); ctx.fill();
      const fl = Math.sin(t * 12) * 0.6;
      ctx.fillStyle = '#ff4a1a'; ctx.beginPath(); ctx.moveTo(-6, -1); ctx.quadraticCurveTo(-7, -7, -3, -9 + fl); ctx.quadraticCurveTo(-1.5, -5, 0, -10 - fl); ctx.quadraticCurveTo(1.5, -5, 3, -9 + fl); ctx.quadraticCurveTo(7, -7, 6, -1); ctx.quadraticCurveTo(0, 3, -6, -1); ctx.fill();
      ctx.fillStyle = '#ffb02a'; ctx.beginPath(); ctx.moveTo(-3.5, -1.5); ctx.quadraticCurveTo(-4, -6, 0, -7.5 - fl); ctx.quadraticCurveTo(4, -6, 3.5, -1.5); ctx.quadraticCurveTo(0, 1, -3.5, -1.5); ctx.fill();
      ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.ellipse(0, -3, 1.6, 2.4, 0, 0, 7); ctx.fill();
    } else if (kind === 'feather') {
      ctx.rotate(Math.sin(t * 3) * 0.3 - 0.5);
      ctx.fillStyle = '#9fe8ff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.quadraticCurveTo(7, -3, 0, 9); ctx.quadraticCurveTo(-7, -3, 0, -9); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(4, -3, 0, 6); ctx.quadraticCurveTo(-3, -3, 0, -8); ctx.fill();
      ctx.strokeStyle = '#4ab0e0'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 10); ctx.stroke();
    } else if (kind === 'star') {
      const hue = (t * 360) % 360;
      ctx.rotate(Math.sin(t * 6) * 0.2);
      ctx.fillStyle = `hsl(${hue},100%,45%)`; U.star(ctx, 0, 0.6, 5, 8.4, 4); ctx.fill();
      ctx.fillStyle = `hsl(${(hue + 40) % 360},100%,65%)`; U.star(ctx, 0, 0, 5, 7.8, 3.6); ctx.fill();
      ctx.fillStyle = '#fff'; U.star(ctx, 0, 0, 5, 4, 1.8); ctx.fill();
      ctx.fillStyle = '#2a1a10'; ctx.fillRect(-2.2, -1.5, 1.2, 2.4); ctx.fillRect(1, -1.5, 1.2, 2.4);
    } else if (kind === 'life') {
      ctx.scale(1 + Math.sin(t * 6) * 0.05, 1 + Math.sin(t * 6) * 0.05);
      ctx.fillStyle = '#e8304a';
      ctx.beginPath(); ctx.moveTo(0, 7); ctx.bezierCurveTo(-9, 0, -7, -8, 0, -3.5); ctx.bezierCurveTo(7, -8, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff7088'; ctx.beginPath(); ctx.ellipse(-3, -2.5, 1.8, 1.2, -0.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 5px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('1UP', 0, 2.8);
    }
    ctx.restore();
  },

  // ---------------------------------------------------------------- hero
  hero(ctx, o) {
    const sk = o.skin;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.facing * o.s * (o.sx || 1), o.s * (o.sy || 1));
    const st = o.state, t = o.t;
    const run = st === 'run' ? Math.sin(o.phase) : 0;
    const air = st === 'jump' || st === 'fall' || st === 'glide' || st === 'pound';
    const hood = o.power === 2 ? '#e8452c' : sk.hood, hood2 = o.power === 2 ? '#a82a18' : sk.hood2;
    const scarf = o.power === 2 ? (Math.sin(t * 20) > 0 ? '#ffcf3a' : '#ff8a2a') : sk.scarf;
    const bob = st === 'run' ? Math.abs(Math.cos(o.phase)) * -1.2 : st === 'idle' ? Math.sin(t * 3) * 0.4 : 0;

    // wings (feather power)
    if (o.power === 3) {
      const flap = st === 'glide' ? Math.sin(t * 25) * 0.6 : air ? Math.sin(t * 12) * 0.3 : 0.15;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(-4, -14 + bob); ctx.rotate(-0.8 - flap * side * 0.4 + (side < 0 ? 0.35 : 0));
        ctx.fillStyle = side < 0 ? '#bfefff' : '#ffffff';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-4, -12, -12, -10); ctx.quadraticCurveTo(-9, -6, -11, -5); ctx.quadraticCurveTo(-7, -2, -9, 0); ctx.quadraticCurveTo(-4, 1, 0, 0); ctx.fill();
        ctx.restore();
      }
    }
    // tail
    const tw = Math.sin(t * 6 + (st === 'run' ? o.phase : 0)) * 1.5;
    ctx.fillStyle = sk.fur2;
    ctx.beginPath(); ctx.moveTo(-4, -8 + bob); ctx.quadraticCurveTo(-14, -6 + tw, -15, -15 + tw); ctx.quadraticCurveTo(-9, -12, -4, -12 + bob); ctx.fill();
    ctx.fillStyle = sk.fur;
    ctx.beginPath(); ctx.moveTo(-4, -8.5 + bob); ctx.quadraticCurveTo(-12, -7 + tw, -13.5, -14 + tw); ctx.quadraticCurveTo(-8.5, -11.5, -4, -11.5 + bob); ctx.fill();
    ctx.fillStyle = sk.belly;
    ctx.beginPath(); ctx.arc(-14.2, -14.6 + tw, 2.2, 0, 7); ctx.fill();

    // legs
    const leg = (dx, sw, col) => {
      ctx.fillStyle = col;
      const ly = air ? -3.5 : -3;
      ctx.save(); ctx.translate(dx + sw * 3, ly + (air ? (dx > 0 ? -1 : 0.5) : 0));
      U.roundRect(ctx, -2.5, -2, 5.5, 4.6, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-1.5, -1.6, 3.5, 0.9);
      ctx.restore();
    };
    leg(-2, -run, sk.boot);
    // body
    ctx.fillStyle = hood2; U.roundRect(ctx, -6.5, -16 + bob, 13, 12.5, 4.5); ctx.fill();
    ctx.fillStyle = hood; U.roundRect(ctx, -6, -16 + bob, 12, 11.5, 4.5); ctx.fill();
    ctx.fillStyle = sk.belly; ctx.beginPath(); ctx.ellipse(0, -9.5 + bob, 3.4, 3.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-4.5, -15 + bob, 6, 1);
    leg(2, run, sk.boot);
    // arm
    const armA = st === 'run' ? run * 0.9 : air ? -1.2 : st === 'pound' ? -2.4 : 0.2;
    ctx.save(); ctx.translate(4.6, -12.5 + bob); ctx.rotate(armA);
    ctx.fillStyle = hood2; U.roundRect(ctx, -1.6, -0.5, 3.2, 6, 1.6); ctx.fill();
    ctx.fillStyle = sk.fur; ctx.beginPath(); ctx.arc(0, 5.6, 1.9, 0, 7); ctx.fill();
    ctx.restore();
    // scarf
    const sw = Math.sin(t * 14) * 1.5;
    const stream = Math.min(1, Math.abs(o.vx || 0) / 160) + (air ? 0.4 : 0);
    ctx.fillStyle = scarf;
    ctx.beginPath(); ctx.moveTo(-4, -16.5 + bob); ctx.quadraticCurveTo(-9 - stream * 4, -16 + sw, -12 - stream * 6, -13 + sw * 1.5 + (1 - stream) * 5); ctx.lineTo(-11 - stream * 5, -11 + sw + (1 - stream) * 5); ctx.quadraticCurveTo(-8, -13.5, -4, -14 + bob); ctx.fill();
    U.roundRect(ctx, -6.2, -18 + bob, 12.4, 3.4, 1.6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-6, -15.4 + bob, 12, 0.8);

    // head
    ctx.save(); ctx.translate(1, -23.5 + bob);
    // ears
    ctx.fillStyle = sk.fur2;
    ctx.beginPath(); ctx.moveTo(-6.5, -3); ctx.lineTo(-7.5, -11.5); ctx.lineTo(-1.5, -6); ctx.fill();
    ctx.fillStyle = sk.fur;
    ctx.beginPath(); ctx.moveTo(-1, -5.5); ctx.lineTo(2, -12.5); ctx.lineTo(5, -4.5); ctx.fill();
    ctx.fillStyle = '#ffb3c0';
    ctx.beginPath(); ctx.moveTo(0.3, -5.8); ctx.lineTo(2.1, -10.3); ctx.lineTo(3.8, -5.2); ctx.fill();
    // skull
    ctx.fillStyle = sk.fur; ctx.beginPath(); ctx.ellipse(0, 0, 7.6, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = sk.fur2; ctx.beginPath(); ctx.ellipse(-3.5, 1, 3.5, 4.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = sk.fur; ctx.beginPath(); ctx.ellipse(0.5, -0.5, 6.8, 6.4, 0, 0, 7); ctx.fill();
    // muzzle
    ctx.fillStyle = sk.belly; ctx.beginPath(); ctx.ellipse(5, 2.5, 4.4, 3.2, 0.1, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(1.5, 4.3, 3, 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a1a22'; ctx.beginPath(); ctx.ellipse(8.8, 1.3, 1.5, 1.2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(8.4, 0.9, 0.45, 0, 7); ctx.fill();
    // mouth
    ctx.strokeStyle = '#5a2a2a'; ctx.lineWidth = 0.6; ctx.beginPath();
    if (st === 'dead' || st === 'hurt') { ctx.arc(5.6, 4.6, 1, Math.PI, 0); }
    else { ctx.moveTo(4.2, 3.9); ctx.quadraticCurveTo(5.4, 5, 6.8, 3.9); }
    ctx.stroke();
    // eye
    if (st === 'dead') {
      ctx.strokeStyle = '#2a1a22'; ctx.lineWidth = 0.9; ctx.beginPath();
      ctx.moveTo(2.3, -3.6); ctx.lineTo(5, -0.8); ctx.moveTo(5, -3.6); ctx.lineTo(2.3, -0.8); ctx.stroke();
    } else if (o.blink) {
      ctx.strokeStyle = '#2a1a22'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(2.2, -1.8); ctx.quadraticCurveTo(3.7, -1, 5.2, -1.8); ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(3.8, -2, 2, 2.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a1a22'; ctx.beginPath(); ctx.ellipse(4.4, -1.8, 1.25, 1.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(4.8, -2.6, 0.55, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = sk.fur2; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(2, -5.3); ctx.lineTo(5.3, -5); ctx.stroke();
    ctx.fillStyle = 'rgba(255,110,140,0.45)'; ctx.beginPath(); ctx.ellipse(2.4, 2.4, 1.5, 1, 0, 0, 7); ctx.fill();
    // explorer cap
    ctx.fillStyle = hood2; ctx.beginPath(); ctx.ellipse(-0.5, -5.2, 6.2, 2.6, -0.1, Math.PI, 0); ctx.fill();
    ctx.fillStyle = hood; ctx.beginPath(); ctx.ellipse(-0.5, -5.6, 5.6, 2.6, -0.1, Math.PI, 0); ctx.fill();
    ctx.fillStyle = hood2; U.roundRect(ctx, 2, -6, 7, 1.6, 0.8); ctx.fill();
    ctx.fillStyle = sk.scarf; ctx.beginPath(); ctx.arc(-1, -7.6, 1.1, 0, 7); ctx.fill();
    ctx.restore();
    ctx.restore();
  },

  // ---------------------------------------------------------------- enemies
  blob(ctx, e, t, col) {
    const sq = e.squish ? 0.35 : 1 + Math.sin(t * 9 + e.x) * 0.07;
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (e.flip) ctx.scale(1, -1), ctx.translate(0, e.h);
    ctx.scale(1 / Math.sqrt(sq), sq);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 2, 0, 0, 7); ctx.fill();
    const gr = ctx.createLinearGradient(0, -13, 0, 0);
    gr.addColorStop(0, this.tint(col, 40)); gr.addColorStop(1, this.tint(col, -30));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(-8.5, -13, 0, -13); ctx.quadraticCurveTo(8.5, -13, 8, 0); ctx.quadraticCurveTo(0, 1.5, -8, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-3.5, -9.5, 2.2, 1.3, -0.5, 0, 7); ctx.fill();
    const d = e.vx < 0 ? -1 : 1;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-2.5 + d, -6, 1.9, 2.4, 0, 0, 7); ctx.ellipse(2.5 + d, -6, 1.9, 2.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#1e1430'; ctx.beginPath(); ctx.arc(-2.2 + d * 1.6, -5.6, 1.1, 0, 7); ctx.arc(2.8 + d * 1.6, -5.6, 1.1, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1e1430'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-4.5 + d, -9.2); ctx.lineTo(-1 + d, -8); ctx.moveTo(4.5 + d, -9.2); ctx.lineTo(1 + d, -8); ctx.stroke();
    ctx.restore();
  },

  shellbug(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (e.flip) ctx.scale(1, -1), ctx.translate(0, e.h);
    const d = e.vx < 0 ? -1 : 1;
    const inShell = e.mode !== 'walk';
    if (!inShell) {
      ctx.scale(d, 1);
      const lg = Math.sin(t * 16) * 1.5;
      ctx.strokeStyle = '#1e1a22'; ctx.lineWidth = 1.2;
      ctx.beginPath(); for (const lx of [-4, 0, 4]) { ctx.moveTo(lx, -3); ctx.lineTo(lx + (lx === 0 ? -lg : lg), 0); } ctx.stroke();
      ctx.fillStyle = '#26222e'; ctx.beginPath(); ctx.arc(6, -6, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(7.2, -7, 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(7.8, -7, 0.8, 0, 7); ctx.fill();
      ctx.strokeStyle = '#26222e'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(7, -9.5); ctx.quadraticCurveTo(9, -13, 11, -12); ctx.stroke();
    }
    const spin = e.mode === 'kick' ? t * 30 : 0;
    const wig = e.wiggle ? Math.sin(t * 40) * 1 : 0;
    ctx.translate(wig, 0);
    ctx.fillStyle = '#8a1a1a'; ctx.beginPath(); ctx.ellipse(-0.5, -6, 8, 6.5, 0, Math.PI, 0); ctx.lineTo(7.5, -2); ctx.lineTo(-8.5, -2); ctx.fill();
    ctx.fillStyle = '#e83a30'; ctx.beginPath(); ctx.ellipse(-0.5, -6.5, 7.4, 6, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f2e6c8'; ctx.fillRect(-8.5, -3.5, 16, 2);
    ctx.fillStyle = '#2a1414';
    for (let i = 0; i < 3; i++) { const a = Math.PI + 0.5 + i * 1 + spin; const px = Math.cos(a) * 4.5 - 0.5, py = -6.5 + Math.sin(a) * 4; if (py < -4) { ctx.beginPath(); ctx.arc(px, py, 1.3, 0, 7); ctx.fill(); } }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-3.5, -10, 2, 1, -0.4, 0, 7); ctx.fill();
    ctx.restore();
  },

  spiky(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h - 6.5);
    if (e.flip) ctx.scale(1, -1);
    const roll = e.x * 0.15;
    ctx.save(); ctx.rotate(roll);
    ctx.fillStyle = '#d8d0e8';
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.25) * 5.5, Math.sin(a - 0.25) * 5.5); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.lineTo(Math.cos(a + 0.25) * 5.5, Math.sin(a + 0.25) * 5.5); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#4a2f6a'; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#6e4a9a'; ctx.beginPath(); ctx.arc(-1.5, -1.5, 4.5, 0, 7); ctx.fill();
    const d = e.vx < 0 ? -1 : 1;
    ctx.fillStyle = '#ffde5a'; ctx.beginPath(); ctx.arc(d * 1.5 - 1.8, -0.5, 1.4, 0, 7); ctx.arc(d * 1.5 + 1.8, -0.5, 1.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(d * 1.5 - 2.1, -1.4, 0.7, 1.8); ctx.fillRect(d * 1.5 + 1.5, -1.4, 0.7, 1.8);
    ctx.restore();
  },

  hopper(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (e.flip) ctx.scale(1, -1), ctx.translate(0, e.h);
    ctx.scale(e.facing, 1);
    const crouch = e.onGround ? (e.timer < 0.25 ? 0.8 : 1) : 1.15;
    ctx.scale(1 / crouch, crouch);
    ctx.fillStyle = '#2f8a3a';
    ctx.beginPath(); ctx.ellipse(-4, -2, 4, 2.5, 0, 0, 7); ctx.ellipse(4, -2, 4, 2.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4fc05a'; ctx.beginPath(); ctx.ellipse(0, -6, 7.5, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8f5a8'; ctx.beginPath(); ctx.ellipse(1.5, -4, 4.5, 3.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4fc05a'; ctx.beginPath(); ctx.arc(-2.5, -11, 3, 0, 7); ctx.arc(3, -11, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2.5, -11.4, 2.1, 0, 7); ctx.arc(3, -11.4, 2.1, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(-1.8, -11.2, 1.1, 0, 7); ctx.arc(3.7, -11.2, 1.1, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1e5a26'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-2, -6); ctx.quadraticCurveTo(2, -4, 6, -6.5); ctx.stroke();
    ctx.fillStyle = '#ff7aa0'; ctx.beginPath(); ctx.arc(-4.5, -6, 1, 0, 7); ctx.fill();
    ctx.restore();
  },

  bat(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (e.flip) ctx.scale(1, -1);
    const flap = e.state === 'hang' ? 0.2 : Math.sin(t * 18);
    ctx.fillStyle = '#4a2a6a';
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s, 1); ctx.rotate(flap * 0.6);
      ctx.beginPath(); ctx.moveTo(3, -1); ctx.quadraticCurveTo(8, -9, 13, -4); ctx.quadraticCurveTo(11, -2, 12, 1); ctx.quadraticCurveTo(9, 0, 8, 3); ctx.quadraticCurveTo(6, 1, 3, 3); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#6a3a9a'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 5.5, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-3.5, -8); ctx.lineTo(-1, -4); ctx.moveTo(4, -3); ctx.lineTo(3.5, -8); ctx.lineTo(1, -4); ctx.fill();
    ctx.fillStyle = '#ffde5a'; ctx.beginPath(); ctx.arc(-1.8, -1, 1.3, 0, 7); ctx.arc(1.8, -1, 1.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-1.5, 2); ctx.lineTo(-1, 3.6); ctx.lineTo(-0.5, 2); ctx.moveTo(1.5, 2); ctx.lineTo(1, 3.6); ctx.lineTo(0.5, 2); ctx.fill();
    ctx.restore();
  },

  snapper(ctx, e, t) {
    const open = (Math.sin(t * 8) + 1) / 2;
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y);
    ctx.fillStyle = '#3a9a3a'; ctx.fillRect(-1.5, 10, 3, 20);
    ctx.fillStyle = '#4fc04a'; ctx.beginPath(); ctx.ellipse(-4, 18, 4, 1.8, 0.5, 0, 7); ctx.ellipse(4, 22, 4, 1.8, -0.5, 0, 7); ctx.fill();
    ctx.translate(0, 8);
    for (const s of [-1, 1]) {
      ctx.save(); ctx.rotate(s * (0.15 + open * 0.5));
      ctx.fillStyle = '#7a3ab8'; ctx.beginPath(); ctx.ellipse(s * 4, -1, 4.5, 7.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff6a8a'; ctx.beginPath(); ctx.ellipse(s * 3, -1, 2.2, 5.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(s * 0.8, -6 + i * 3); ctx.lineTo(-s * 1.8, -5 + i * 3); ctx.lineTo(s * 0.8, -4 + i * 3); ctx.fill(); }
      ctx.fillStyle = '#c69aff'; ctx.beginPath(); ctx.arc(s * 6, -4, 0.8, 0, 7); ctx.arc(s * 6.5, 0, 0.8, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  crusher(ctx, e, t) {
    ctx.save(); ctx.translate(e.x, e.y);
    const sh = e.state === 'warn' ? Math.sin(t * 60) * 0.8 : 0;
    ctx.translate(sh, 0);
    ctx.fillStyle = '#3a3448'; U.roundRect(ctx, 0, 0, e.w, e.h, 4); ctx.fill();
    ctx.fillStyle = '#6a6280'; U.roundRect(ctx, 1.5, 1.5, e.w - 3, e.h - 3, 3); ctx.fill();
    ctx.fillStyle = '#8a82a0'; ctx.fillRect(3, 3, e.w - 6, 2);
    ctx.fillStyle = '#4fae5a'; ctx.beginPath(); ctx.ellipse(6, 2.5, 5, 2.5, 0, 0, 7); ctx.ellipse(22, 2, 4, 2, 0, 0, 7); ctx.fill();
    // carved face
    const angry = e.state === 'fall' || e.state === 'warn';
    ctx.fillStyle = '#2a2436';
    ctx.beginPath(); ctx.moveTo(5, 10); ctx.lineTo(12, angry ? 13 : 11); ctx.lineTo(12, 15); ctx.lineTo(5, 15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(23, 10); ctx.lineTo(16, angry ? 13 : 11); ctx.lineTo(16, 15); ctx.lineTo(23, 15); ctx.fill();
    ctx.fillStyle = angry ? '#ff5a3a' : '#ffd23f';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(9, 13.3, 1.4, 0, 7); ctx.arc(19, 13.3, 1.4, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2a2436'; U.roundRect(ctx, 8, 19, 12, 4, 1.5); ctx.fill();
    ctx.fillStyle = '#d8d0e8'; for (let i = 0; i < 4; i++) ctx.fillRect(9 + i * 3, 19, 1.6, 1.8);
    ctx.restore();
  },

  seed(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (e.flip) ctx.scale(1, -1);
    ctx.scale(e.vx < 0 ? -1 : 1, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 3; i++) ctx.fillRect(-14 - i * 3, -3 + i * 2.5, 6, 0.8);
    ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.ellipse(-0.5, -0.8, 6.5, 3.6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4fae3a'; ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(-10, -5); ctx.lineTo(-8, 0); ctx.lineTo(-10, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(3.5, -1, 1.8, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(4.2, -1, 1, 0, 7); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1.5, -3.8); ctx.lineTo(5, -2.6); ctx.stroke();
    ctx.restore();
  },

  lavabub(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (e.vy > 0) ctx.scale(1, -1);
    const gl = ctx.createRadialGradient(0, 0, 1, 0, 0, 12);
    gl.addColorStop(0, 'rgba(255,200,80,0.7)'); gl.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = gl; ctx.fillRect(-12, -12, 24, 24);
    const f = Math.sin(t * 20);
    ctx.fillStyle = '#ff4a1a'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(-6, 10 + f, 0, 11 - f); ctx.quadraticCurveTo(6, 10 + f, 6, 0); ctx.arc(0, 0, 6, 0, Math.PI, true); ctx.fill();
    ctx.fillStyle = '#ffb02a'; ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(-1, -1, 2, 0, 7); ctx.fill();
    ctx.fillStyle = '#5a1a0a'; ctx.beginPath(); ctx.arc(-2, -1, 0.9, 0, 7); ctx.arc(2, -1, 0.9, 0, 7); ctx.fill();
    ctx.restore();
  },

  icicle(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2 + (e.state === 'shake' ? Math.sin(t * 70) * 0.8 : 0), e.y);
    const gr = ctx.createLinearGradient(-5, 0, 5, 0);
    gr.addColorStop(0, '#e8f8ff'); gr.addColorStop(0.5, '#9ad8ff'); gr.addColorStop(1, '#5aa8e0');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(0, 16); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(-4, 1); ctx.lineTo(-2, 1); ctx.lineTo(-0.5, 11); ctx.fill();
    ctx.restore();
  },

  boss(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (e.flip) ctx.scale(1, -1), ctx.translate(0, e.h);
    ctx.scale(e.facing, 1);
    if (e.inv > 0 && Math.floor(t * 20) % 2) ctx.globalAlpha = 0.5;
    const breathe = Math.sin(t * 4) * 0.8;
    const glow = 0.6 + Math.sin(t * 6) * 0.3;
    // legs
    ctx.fillStyle = '#2a2026';
    const step = e.onGround ? Math.sin(t * 10) * 3 : 0;
    U.roundRect(ctx, -14 + step, -9, 10, 9, 3); ctx.fill();
    U.roundRect(ctx, 4 - step, -9, 10, 9, 3); ctx.fill();
    // body
    const gr = ctx.createLinearGradient(0, -44, 0, -4);
    gr.addColorStop(0, '#4a3a44'); gr.addColorStop(1, '#251a22');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, -24 + breathe, 22, 20, 0, 0, 7); ctx.fill();
    // lava cracks
    ctx.strokeStyle = `rgba(255,${120 + glow * 80},40,${glow})`; ctx.lineWidth = 1.6;
    ctx.shadowColor = '#ff7a2a'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(-16, -32); ctx.lineTo(-10, -26); ctx.lineTo(-14, -18); ctx.moveTo(-4, -40); ctx.lineTo(0, -34); ctx.lineTo(-3, -28);
    ctx.moveTo(10, -14); ctx.lineTo(16, -20); ctx.lineTo(14, -28); ctx.stroke();
    ctx.shadowBlur = 0;
    // horns
    ctx.fillStyle = '#e8dcc8';
    ctx.beginPath(); ctx.moveTo(-12, -38); ctx.quadraticCurveTo(-20, -50, -14, -56); ctx.quadraticCurveTo(-14, -46, -6, -42); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -40); ctx.quadraticCurveTo(14, -54, 22, -54); ctx.quadraticCurveTo(14, -48, 14, -38); ctx.fill();
    // face
    ctx.fillStyle = '#ffde5a'; ctx.shadowColor = '#ffb02a'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(6, -30 + breathe, 4, e.state === 'hurt' ? 1 : 3.4, 0, 0, 7); ctx.ellipse(16, -29 + breathe, 3, e.state === 'hurt' ? 0.8 : 2.8, 0, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0a0a'; ctx.beginPath(); ctx.arc(7, -29.5 + breathe, 1.6, 0, 7); ctx.arc(16.5, -28.8 + breathe, 1.3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1a0a0a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(1, -36); ctx.lineTo(10, -33); ctx.moveTo(20, -33); ctx.lineTo(13, -32); ctx.stroke();
    // mouth
    const mo = e.mouth || 0;
    ctx.fillStyle = '#3a0a0a'; ctx.beginPath(); ctx.ellipse(11, -18, 8, 2 + mo * 5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff7a2a'; ctx.beginPath(); ctx.ellipse(11, -17 + mo, 5, 1 + mo * 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(5 + i * 4, -20 - mo * 4); ctx.lineTo(6.5 + i * 4, -17 - mo * 4); ctx.lineTo(8 + i * 4, -20 - mo * 4); ctx.fill(); }
    // arm
    ctx.fillStyle = '#3a2e36'; ctx.beginPath(); ctx.ellipse(-18, -18 + Math.sin(t * 5) * 2, 6, 8, 0.4, 0, 7); ctx.fill();
    ctx.restore();
  },

  tint(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp((n >> 16) + amt, 0, 255), g = U.clamp(((n >> 8) & 255) + amt, 0, 255), b = U.clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  // ---------------------------------------------------------------- props
  platform(ctx, p, themeName) {
    const th = THEMES[themeName];
    ctx.save(); ctx.translate(p.x, p.y + (p.shake ? Math.sin(p.t * 60) * 0.7 : 0));
    if (th.plat === 'cloud') {
      ctx.fillStyle = 'rgba(200,170,220,0.6)'; ctx.beginPath(); ctx.ellipse(p.w / 2, 7, p.w / 2 + 2, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(6 + i * (p.w - 12) / 3, 4 - (i % 2) * 1.5, 6, 0, 7); ctx.fill(); }
    } else {
      const fall = p.kind === 'fall';
      const c = fall ? ['#e8a84a', '#a8682a', '#ffd08a'] : th.plat === 'ice' ? ['#c8eaff', '#6aaee0', '#ffffff'] : th.plat === 'crystal' ? ['#9c7cff', '#5e3cc8', '#e2d4ff'] : th.plat === 'stone' ? ['#8d8498', '#4c4458', '#b9b0c4'] : ['#c98a4b', '#7a4a20', '#efb57a'];
      ctx.fillStyle = c[1]; U.roundRect(ctx, 0, 0, p.w, 8, 3); ctx.fill();
      ctx.fillStyle = c[0]; U.roundRect(ctx, 0.8, 0.8, p.w - 1.6, 5, 2.5); ctx.fill();
      ctx.fillStyle = c[2]; ctx.fillRect(2, 1, p.w - 4, 1);
      ctx.fillStyle = c[1];
      for (let i = 1; i < 3; i++) ctx.fillRect((i * p.w) / 3 - 0.4, 1, 0.8, 5);
      if (fall) { ctx.fillStyle = '#7a3a1a'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(8 + i * 16, 3.5, 1, 0, 7); ctx.fill(); } }
      if (!fall) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(4, 3.5, 1, 0, 7); ctx.arc(p.w - 4, 3.5, 1, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  },

  spring(ctx, e, t) {
    const c = e.compress || 0;
    ctx.save(); ctx.translate(e.x, e.y + e.h);
    ctx.fillStyle = '#3a3a4a'; U.roundRect(ctx, 1, -3, 14, 3, 1); ctx.fill();
    const h = 10 - c * 6;
    ctx.strokeStyle = '#c8ccd8'; ctx.lineWidth = 1.6;
    ctx.beginPath(); for (let i = 0; i <= 4; i++) { const y = -3 - (h * i) / 4; ctx.lineTo(i % 2 ? 12 : 4, y); } ctx.stroke();
    ctx.fillStyle = '#e83a4a'; U.roundRect(ctx, 0, -3 - h - 4, 16, 4.5, 2); ctx.fill();
    ctx.fillStyle = '#ff8a90'; ctx.fillRect(2, -3 - h - 3.4, 12, 1);
    ctx.restore();
  },

  checkpoint(ctx, e, t) {
    ctx.save(); ctx.translate(e.x + 8, e.y + e.h);
    ctx.fillStyle = '#6a6a7a'; U.roundRect(ctx, -4, -3, 8, 3, 1); ctx.fill();
    ctx.fillStyle = '#d8d8e0'; ctx.fillRect(-0.8, -30, 1.6, 28);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, -31, 1.8, 0, 7); ctx.fill();
    const fy = e.on ? -29 : -8 - (1 - (e.raise || 0)) * 0;
    const ry = e.on ? -29 + (1 - e.raise) * 21 : -8;
    const wave = Math.sin(t * 6) * 1.2;
    ctx.fillStyle = e.on ? '#3fd06a' : '#9a9aaa';
    ctx.beginPath(); ctx.moveTo(1, ry); ctx.quadraticCurveTo(6, ry + wave, 11, ry + 3 + wave); ctx.lineTo(1, ry + 7); ctx.fill();
    if (e.on) { ctx.fillStyle = '#fff'; U.star(ctx, 4.5, ry + 3.4, 5, 1.8, 0.8); ctx.fill(); }
    void fy;
    ctx.restore();
  },

  goal(ctx, e, t) {
    const x = e.x + 8, top = e.top, bottom = e.y + e.h;
    ctx.fillStyle = '#4a4a5a'; U.roundRect(ctx, x - 7, bottom - 6, 14, 6, 2); ctx.fill();
    ctx.fillStyle = '#7a7a8e'; ctx.fillRect(x - 6, bottom - 6, 12, 1.5);
    const gr = ctx.createLinearGradient(x - 1.2, 0, x + 1.2, 0);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#9aa0b8');
    ctx.fillStyle = gr; ctx.fillRect(x - 1.2, top, 2.4, bottom - top - 6);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, top - 2, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(x - 1, top - 3, 1.2, 0, 7); ctx.fill();
    // banner
    const fy = e.flagY;
    const w = Math.sin(t * 5);
    ctx.fillStyle = '#e8304a';
    ctx.beginPath(); ctx.moveTo(x - 1, fy); ctx.quadraticCurveTo(x - 8, fy + 2 + w, x - 16, fy + 1 + w * 1.5); ctx.lineTo(x - 12, fy + 6 + w); ctx.lineTo(x - 16, fy + 11 + w * 1.5); ctx.quadraticCurveTo(x - 8, fy + 12 + w, x - 1, fy + 12); ctx.fill();
    ctx.fillStyle = '#fff'; U.star(ctx, x - 7, fy + 6 + w * 0.6, 5, 3, 1.3); ctx.fill();
  },

  hut(ctx, x, by, themeName) {
    const th = THEMES[themeName];
    ctx.save(); ctx.translate(x, by);
    const wall = themeName === 'castle' ? '#6a6070' : themeName === 'ice' ? '#e8f2ff' : themeName === 'cave' ? '#7a6a9a' : '#f2dcb0';
    const roof = themeName === 'castle' ? '#4a2a3a' : themeName === 'ice' ? '#4a78d8' : themeName === 'bonus' ? '#b06ae6' : '#d8483a';
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-26, -2, 52, 2);
    ctx.fillStyle = wall; ctx.fillRect(-22, -34, 44, 34);
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 5; i++) ctx.fillRect(-22, -30 + i * 7, 44, 1);
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(-28, -32); ctx.lineTo(0, -54); ctx.lineTo(28, -32); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(-28, -32); ctx.lineTo(0, -54); ctx.lineTo(0, -50); ctx.lineTo(-23, -32); ctx.fill();
    ctx.fillStyle = '#6a3a1e'; ctx.fillRect(10, -50, 6, 10);
    ctx.fillStyle = '#5a3418'; U.roundRect(ctx, -7, -22, 14, 22, [7, 7, 0, 0]); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(4, -10, 1.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#9ad8ff'; U.roundRect(ctx, -18, -26, 8, 8, 1.5); ctx.fill(); U.roundRect(ctx, 10, -26, 8, 8, 1.5); ctx.fill();
    ctx.fillStyle = wall; ctx.fillRect(-14.5, -26, 1, 8); ctx.fillRect(13.5, -26, 1, 8);
    ctx.fillStyle = '#ffd23f'; U.star(ctx, 0, -38, 5, 4, 1.8); ctx.fill();
    void th;
    ctx.restore();
  },

  crown(ctx, x, y, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t * 3) * 2);
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    gl.addColorStop(0, 'rgba(255,240,150,0.8)'); gl.addColorStop(1, 'rgba(255,240,150,0)');
    ctx.fillStyle = gl; ctx.fillRect(-22, -22, 44, 44);
    ctx.fillStyle = '#ffcf3a';
    ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(-11, -6); ctx.lineTo(-5, 0); ctx.lineTo(0, -9); ctx.lineTo(5, 0); ctx.lineTo(11, -6); ctx.lineTo(10, 6); ctx.fill();
    ctx.fillStyle = '#e8304a'; ctx.beginPath(); ctx.arc(0, 2, 2, 0, 7); ctx.fill();
    ctx.fillStyle = '#5ae6ff'; ctx.beginPath(); ctx.arc(-6, 3, 1.4, 0, 7); ctx.arc(6, 3, 1.4, 0, 7); ctx.fill();
    ctx.restore();
  },

  // ---------------------------------------------------------------- decor
  decor(ctx, d, t, themeName) {
    const x = d.x, y = d.y; // y = ground surface
    ctx.save(); ctx.translate(x, y);
    const sway = Math.sin(t * 2 + x * 0.05) * 0.8;
    switch (d.k) {
      case 'tuft':
        ctx.fillStyle = d.c || '#4fb83a';
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 1.6 - 1, 0); ctx.lineTo(i * 2.2 + sway, -4 - (2 - Math.abs(i)) * 1.5); ctx.lineTo(i * 1.6 + 1, 0); ctx.fill(); }
        break;
      case 'flower':
        ctx.strokeStyle = '#3f9a3a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sway, -4, sway, -7); ctx.stroke();
        ctx.fillStyle = d.c;
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(sway + Math.cos(a) * 1.8, -7 + Math.sin(a) * 1.8, 1.3, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#ffde5a'; ctx.beginPath(); ctx.arc(sway, -7, 1, 0, 7); ctx.fill();
        break;
      case 'bush': {
        const s = d.s || 1;
        ctx.fillStyle = d.c2 || '#3a9a36';
        ctx.beginPath(); ctx.arc(-8 * s, -4 * s, 6 * s, 0, 7); ctx.arc(0, -8 * s, 8 * s, 0, 7); ctx.arc(8 * s, -4 * s, 6 * s, 0, 7); ctx.rect(-14 * s, -4 * s, 28 * s, 4 * s); ctx.fill();
        ctx.fillStyle = d.c || '#5fc84a';
        ctx.beginPath(); ctx.arc(-8 * s, -5 * s, 4.6 * s, 0, 7); ctx.arc(-1 * s, -9 * s, 6.2 * s, 0, 7); ctx.arc(7 * s, -5.5 * s, 4.4 * s, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(-3 * s, -12 * s, 2 * s, 0, 7); ctx.fill();
        if (d.berries) { ctx.fillStyle = '#ff4a6a'; for (const [bx, by] of [[-6, -6], [3, -10], [8, -4]]) { ctx.beginPath(); ctx.arc(bx * s, by * s, 1.2, 0, 7); ctx.fill(); } }
        break;
      }
      case 'tree': {
        const s = d.s || 1;
        ctx.fillStyle = '#7a4a2a'; ctx.fillRect(-2.5 * s, -18 * s, 5 * s, 18 * s);
        ctx.fillStyle = '#5a3418'; ctx.fillRect(0.5 * s, -18 * s, 2 * s, 18 * s);
        ctx.fillStyle = d.c2 || '#3a9a36';
        ctx.beginPath(); ctx.arc(0, -26 * s, 13 * s, 0, 7); ctx.arc(-9 * s, -20 * s, 8 * s, 0, 7); ctx.arc(9 * s, -20 * s, 8 * s, 0, 7); ctx.fill();
        ctx.fillStyle = d.c || '#5fc84a';
        ctx.beginPath(); ctx.arc(-2 * s, -28 * s, 10 * s, 0, 7); ctx.arc(-9 * s, -21 * s, 6 * s, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-5 * s, -32 * s, 3.5 * s, 0, 7); ctx.fill();
        break;
      }
      case 'pine': {
        const s = d.s || 1;
        ctx.fillStyle = '#6a4a2a'; ctx.fillRect(-2 * s, -8 * s, 4 * s, 8 * s);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = '#2f6a8a'; ctx.beginPath(); ctx.moveTo(-(12 - i * 3) * s, -(6 + i * 9) * s); ctx.lineTo(0, -(22 + i * 9) * s); ctx.lineTo((12 - i * 3) * s, -(6 + i * 9) * s); ctx.fill();
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-(6 - i * 1.5) * s, -(15 + i * 9) * s); ctx.lineTo(0, -(22 + i * 9) * s); ctx.lineTo((6 - i * 1.5) * s, -(15 + i * 9) * s); ctx.quadraticCurveTo(0, -(13 + i * 9) * s, -(6 - i * 1.5) * s, -(15 + i * 9) * s); ctx.fill();
        }
        break;
      }
      case 'snowman':
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, -5, 5.5, 0, 7); ctx.arc(0, -13, 4, 0, 7); ctx.fill();
        ctx.fillStyle = '#d6e7fb'; ctx.beginPath(); ctx.arc(1.5, -4, 3.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(-1.2, -14, 0.6, 0, 7); ctx.arc(1.4, -14, 0.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(4, -12.4); ctx.lineTo(0, -12); ctx.fill();
        ctx.fillStyle = '#e8304a'; ctx.fillRect(-4, -10.5, 8, 1.6);
        break;
      case 'cactus':
        ctx.fillStyle = '#3f9a4a';
        U.roundRect(ctx, -2.5, -16, 5, 16, 2.5); ctx.fill();
        U.roundRect(ctx, -7, -12, 3, 7, 1.5); ctx.fill(); ctx.fillRect(-7, -7, 6, 2);
        U.roundRect(ctx, 4, -14, 3, 7, 1.5); ctx.fill(); ctx.fillRect(1, -9, 6, 2);
        ctx.fillStyle = '#6ac86a'; ctx.fillRect(-1.2, -15, 1, 14);
        ctx.fillStyle = '#ff6a8a'; ctx.beginPath(); ctx.arc(0, -16.5, 1.4, 0, 7); ctx.fill();
        break;
      case 'rock':
        ctx.fillStyle = '#8a7a6a'; ctx.beginPath(); ctx.ellipse(0, -2.5, 5, 3.5, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#b0a090'; ctx.beginPath(); ctx.ellipse(-1, -3.5, 2.5, 1.5, 0, 0, 7); ctx.fill();
        break;
      case 'crystal': {
        ctx.shadowColor = d.c; ctx.shadowBlur = 8;
        ctx.fillStyle = d.c;
        for (const [ox, h, w] of [[-3, 8, 2.4], [0, 13, 3], [3.5, 7, 2.2]]) { ctx.beginPath(); ctx.moveTo(ox - w, 0); ctx.lineTo(ox - w * 0.6, -h + 2); ctx.lineTo(ox, -h); ctx.lineTo(ox + w * 0.6, -h + 2); ctx.lineTo(ox + w, 0); ctx.fill(); }
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(1.4, -10); ctx.lineTo(0.5, -2); ctx.fill();
        break;
      }
      case 'mushroom':
        ctx.fillStyle = '#e8dcc8'; ctx.fillRect(-1, -5, 2, 5);
        ctx.fillStyle = d.c; ctx.shadowColor = d.c; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.ellipse(0, -5, 4, 3, 0, Math.PI, 0); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(-1.5, -6.5, 0.7, 0, 7); ctx.arc(1.5, -7, 0.6, 0, 7); ctx.fill();
        break;
      case 'torch': {
        ctx.fillStyle = '#4a3a2a'; ctx.fillRect(-1.2, -14, 2.4, 8);
        ctx.fillStyle = '#7a6a5a'; ctx.fillRect(-2.5, -15, 5, 2);
        const fl = Math.sin(t * 15 + x) * 0.8;
        const gl = ctx.createRadialGradient(0, -18, 1, 0, -18, 18);
        gl.addColorStop(0, 'rgba(255,180,60,0.45)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = gl; ctx.fillRect(-18, -36, 36, 36);
        ctx.fillStyle = '#ff6a1a'; ctx.beginPath(); ctx.moveTo(-2.5, -15); ctx.quadraticCurveTo(-2, -20, fl, -23); ctx.quadraticCurveTo(2.5, -19, 2.5, -15); ctx.fill();
        ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-1.2, -15); ctx.quadraticCurveTo(-1, -18, fl * 0.5, -20); ctx.quadraticCurveTo(1.2, -18, 1.2, -15); ctx.fill();
        break;
      }
      case 'fence':
        ctx.fillStyle = '#d8b07a';
        ctx.fillRect(-8, -7, 16, 1.5); ctx.fillRect(-8, -3.5, 16, 1.5);
        for (const fx of [-7, 0, 7]) { U.roundRect(ctx, fx - 1, -9, 2, 9, [1, 1, 0, 0]); ctx.fill(); }
        break;
      case 'sign':
        ctx.fillStyle = '#7a4a2a'; ctx.fillRect(-1, -12, 2, 12);
        ctx.fillStyle = '#d8a060'; U.roundRect(ctx, -8, -16, 16, 8, 1.5); ctx.fill();
        ctx.fillStyle = '#5a3418'; ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(3, -12); ctx.lineTo(3, -14); ctx.lineTo(6, -12); ctx.lineTo(3, -10); ctx.lineTo(3, -12); ctx.fill(); ctx.fillRect(-4, -12.6, 7, 1.2);
        break;
    }
    ctx.restore();
    void themeName;
  },
};
