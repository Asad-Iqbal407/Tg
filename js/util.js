'use strict';
// Shared helpers and constants.
const TS = 16; // tile size in world pixels

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  approach(v, target, d) { return v < target ? Math.min(v + d, target) : Math.max(v - d, target); },
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (a) => a[Math.floor(Math.random() * a.length)],
  sign: (v) => (v > 0 ? 1 : v < 0 ? -1 : 0),
  // Deterministic PRNG (mulberry32)
  rng(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  hash(x, y) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },
  overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  },
  roundRect(ctx, x, y, w, h, r) {
    const tl = Array.isArray(r) ? r[0] : r, tr = Array.isArray(r) ? r[1] : r;
    const br = Array.isArray(r) ? r[2] : r, bl = Array.isArray(r) ? r[3] : r;
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    tr ? ctx.arcTo(x + w, y, x + w, y + tr, tr) : ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - br);
    br ? ctx.arcTo(x + w, y + h, x + w - br, y + h, br) : ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + bl, y + h);
    bl ? ctx.arcTo(x, y + h, x, y + h - bl, bl) : ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + tl);
    tl ? ctx.arcTo(x, y, x + tl, y, tl) : ctx.lineTo(x, y);
    ctx.closePath();
  },
  star(ctx, cx, cy, spikes, outer, inner, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = rot + (i * Math.PI) / spikes;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  },
  today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  },
  fmt: (n) => Math.floor(n).toLocaleString('en-US'),
  fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
};
