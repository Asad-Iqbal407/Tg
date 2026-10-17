'use strict';
/* कर्ण अर्जुन युद्ध — drawing engine.
   Every frame is a pure function of time: no state carries from one frame to the next,
   so seeking, live playback and the MP4 renderer all produce identical pictures. */

const W = 1920, H = 1080, TAU = Math.PI * 2, LB = 132; // logical frame, 2.35:1 letterbox bars
const VIEW = { scale: 1 };

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = (t) => Math.pow(clamp(t), 3);
const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const bump = (a, b, x) => ss(a, (a + b) / 2, x) * (1 - ss((a + b) / 2, b, x));
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }
const h2 = (a, b) => hash(a * 57.31 + b * 113.17);
function vnoise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }
const fbm = (x) => vnoise(x) * 0.55 + vnoise(x * 2.03 + 17) * 0.3 + vnoise(x * 4.1 + 31) * 0.15;

/* ---------- colour ---------- */
function hex(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a <= 0.001 ? 0 : a >= 1 ? 1 : a.toFixed(3)})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

// top/mid/low: sky; sun/glow: light; haze/far: distance; g1/g2: ground; sil: silhouettes; rim: back-light edge
const PAL_HEX = {
  ember:   { top: '#050304', mid: '#0d0606', low: '#2a0d06', sun: '#ffcf8a', glow: '#ff6a2a', haze: '#3a140a', far: '#120707', g1: '#100605', g2: '#030202', sil: '#030202', rim: '#ff8a40' },
  dawn:    { top: '#0b1433', mid: '#5b2a50', low: '#ff9248', sun: '#fff3d6', glow: '#ff8a3c', haze: '#b8644e', far: '#3a2034', g1: '#2a1612', g2: '#090404', sil: '#0a0505', rim: '#ffc27a' },
  battle:  { top: '#1c0a08', mid: '#6e2914', low: '#e88a3a', sun: '#fff3d6', glow: '#ff8c3a', haze: '#a9552f', far: '#4a2214', g1: '#33180d', g2: '#0b0504', sil: '#0b0504', rim: '#ffb46a' },
  day:     { top: '#18263f', mid: '#625f70', low: '#e3b07a', sun: '#fffaf0', glow: '#ffd9a0', haze: '#9a8576', far: '#3a3a48', g1: '#2c241e', g2: '#0b0807', sil: '#0a0809', rim: '#fff1d6' },
  peacock: { top: '#03121a', mid: '#0d3a45', low: '#3f8f86', sun: '#eafff6', glow: '#4fd1c0', haze: '#1e5a5a', far: '#082228', g1: '#081a1c', g2: '#020607', sil: '#020607', rim: '#8ff5e2' },
  fire:    { top: '#250403', mid: '#8f1a07', low: '#ff7418', sun: '#fff0b0', glow: '#ff5a14', haze: '#c4401a', far: '#4e1206', g1: '#360d05', g2: '#0d0302', sil: '#0c0302', rim: '#ffa040' },
  storm:   { top: '#03060b', mid: '#132130', low: '#3a5266', sun: '#d6ecff', glow: '#6aa6d6', haze: '#2c4456', far: '#0d1822', g1: '#121a20', g2: '#040709', sil: '#04070a', rim: '#a8d8ff' },
  indra:   { top: '#06041a', mid: '#291d5c', low: '#8c7cc4', sun: '#fffbe0', glow: '#ffe46a', haze: '#4a3e7c', far: '#140f30', g1: '#15102a', g2: '#05040c', sil: '#05040c', rim: '#fff0a0' },
  bhargava:{ top: '#13031a', mid: '#55104c', low: '#e05a36', sun: '#ffe8ff', glow: '#d66bff', haze: '#7a2a5a', far: '#2a0a28', g1: '#2a0c18', g2: '#0a0306', sil: '#0a0306', rim: '#ffb0f0' },
  venom:   { top: '#020806', mid: '#0b2418', low: '#3c5a2a', sun: '#eaffd6', glow: '#7dff6a', haze: '#1f3a22', far: '#06140c', g1: '#0a140c', g2: '#020504', sil: '#020504', rim: '#b6ff8a' },
  late:    { top: '#160b1e', mid: '#6a2430', low: '#f07a34', sun: '#ffe9c0', glow: '#ff7a30', haze: '#9a4a32', far: '#3a1820', g1: '#2a120c', g2: '#090403', sil: '#090403', rim: '#ffa860' },
  dusk:    { top: '#0d0822', mid: '#561a44', low: '#ff6428', sun: '#ffe6b0', glow: '#ff5a1e', haze: '#9a3c38', far: '#2a1230', g1: '#200b10', g2: '#070205', sil: '#070205', rim: '#ff9a50' },
  night:   { top: '#02030a', mid: '#0a0b1e', low: '#2a1430', sun: '#ffd9a0', glow: '#ff6a2a', haze: '#1a1024', far: '#08060f', g1: '#0a0608', g2: '#020103', sil: '#020103', rim: '#ff8a50' },
  sepia:   { top: '#2a1d10', mid: '#7a5a32', low: '#e0b878', sun: '#fff3d8', glow: '#ffd08a', haze: '#a8834e', far: '#4a3820', g1: '#3a2a18', g2: '#120c06', sil: '#140d07', rim: '#ffe2a8' },
};
const PAL = {};
for (const k in PAL_HEX) { PAL[k] = {}; for (const q in PAL_HEX[k]) PAL[k][q] = hex(PAL_HEX[k][q]); }
function palMix(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  const o = {}; for (const k in a) o[k] = mixc(a[k], b[k], t); return o;
}

/* ---------- pre-rendered assets ---------- */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const ASSET = {};
function initAssets() {
  const v = mkCanvas(960, 540), vc = v.getContext('2d');
  const vg = vc.createRadialGradient(480, 270, 140, 480, 270, 600);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.62, 'rgba(0,0,0,.2)'); vg.addColorStop(1, 'rgba(0,0,0,.8)');
  vc.fillStyle = vg; vc.fillRect(0, 0, 960, 540); ASSET.vig = v;

  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ASSET.grain = [];
  for (let k = 0; k < 4; k++) {
    const c = mkCanvas(960, 540), x = c.getContext('2d'), im = x.createImageData(960, 540);
    for (let i = 0; i < im.data.length; i += 4) { const n = 128 + (r() - 0.5) * 140; im.data[i] = im.data[i + 1] = im.data[i + 2] = n; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); ASSET.grain.push(c);
  }

  ASSET.cloud = [];
  for (let k = 0; k < 6; k++) {
    const c = mkCanvas(640, 280), x = c.getContext('2d');
    for (let i = 0; i < 48; i++) {
      const a = h2(k + 1, i), b = h2(k + 9, i), d = h2(k + 17, i);
      const gx = 320 + (a - 0.5) * 440 * (0.55 + b * 0.45);
      const edge = 1 - Math.abs(gx - 320) / 330;
      const gy = 168 + (b - 0.5) * 60 - edge * 46 * d;
      const rr = 34 + d * 92 * Math.max(0.25, edge);
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, rr);
      g.addColorStop(0, 'rgba(255,255,255,.4)'); g.addColorStop(0.55, 'rgba(255,255,255,.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(gx, gy, rr, 0, TAU); x.fill();
    }
    ASSET.cloud.push(c);
  }

  const gl = mkCanvas(128, 128), gx = gl.getContext('2d'), gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(0.18, 'rgba(255,255,255,.55)'); gg.addColorStop(0.5, 'rgba(255,255,255,.12)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128); ASSET.glow = gl;

  ASSET.army = [0, 1].map((k) => armyStrip(k * 31 + 5));
}

const _tint = new Map();
function tinted(src, id, col) {
  const q = (v) => Math.min(255, Math.round(v / 6) * 6);
  const cq = [q(col[0]), q(col[1]), q(col[2])];
  const key = id + '|' + cq.join(',');
  let t = _tint.get(key);
  if (!t) {
    t = mkCanvas(src.width, src.height); const x = t.getContext('2d');
    x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = rgba(cq); x.fillRect(0, 0, t.width, t.height);
    _tint.set(key, t);
    if (_tint.size > 600) _tint.delete(_tint.keys().next().value);
  }
  return t;
}
const glowOf = (col) => tinted(ASSET.glow, 'g', col);
function glowAt(c, x, y, r, col, a = 1) {
  if (a <= 0.003) return;
  c.globalAlpha = a; c.drawImage(glowOf(col), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1;
}

/* ---------- distant armies (one silhouette strip, drawn with parallax) ---------- */
function armyStrip(seed) {
  const c = mkCanvas(2400, 240), x = c.getContext('2d'), base = 236;
  x.fillStyle = x.strokeStyle = '#000'; x.lineCap = 'round';
  for (let row = 0; row < 3; row++) {
    const sc = 1 - row * 0.2, yb = base - row * 9;
    for (let px = 0; px < 2400; px += 5 + h2(seed + row, px) * 6) {
      const hgt = (15 + h2(px, seed + row) * 6) * sc;
      x.fillRect(px, yb - hgt, 3.6 * sc, hgt);
      x.beginPath(); x.arc(px + 1.8 * sc, yb - hgt - 2.6 * sc, 2.5 * sc, 0, TAU); x.fill();
      if (h2(px * 3, seed + row) < 0.5) {
        const lean = (h2(px, seed + 7) - 0.5) * 9;
        x.lineWidth = 1.2; x.beginPath(); x.moveTo(px + 2, yb - hgt * 0.6); x.lineTo(px + 2 + lean, yb - hgt - (20 + h2(px, seed + 9) * 28) * sc); x.stroke();
      }
    }
  }
  for (let i = 0; i < 30; i++) {
    const px = h2(i, seed + 3) * 2400, ph = 70 + h2(i, seed + 4) * 80;
    x.lineWidth = 2.2; x.beginPath(); x.moveTo(px, base - 8); x.lineTo(px, base - ph); x.stroke();
    x.beginPath(); x.moveTo(px, base - ph); x.lineTo(px + 28, base - ph + 5); x.lineTo(px + 22, base - ph + 12); x.lineTo(px + 27, base - ph + 19); x.lineTo(px, base - ph + 20); x.fill();
  }
  for (let i = 0; i < 6; i++) elephantSil(x, 160 + i * 400 + h2(i, seed) * 160, base, 0.95 + h2(i, seed + 1) * 0.3, h2(i, seed + 2) < 0.5 ? 1 : -1);
  for (let i = 0; i < 8; i++) tinyChariot(x, 90 + i * 300 + h2(i, seed + 8) * 120, base, h2(i, seed + 6) < 0.5 ? 1 : -1);
  return c;
}
function elephantSil(x, px, base, s, d) {
  x.save(); x.translate(px, base); x.scale(s * d, s);
  x.beginPath(); x.ellipse(0, -40, 30, 22, 0, 0, TAU); x.fill();
  x.beginPath(); x.ellipse(26, -48, 14, 15, 0, 0, TAU); x.fill();
  x.lineWidth = 6; x.beginPath(); x.moveTo(36, -46); x.quadraticCurveTo(46, -26, 40, -10); x.stroke();
  x.lineWidth = 3; x.beginPath(); x.moveTo(34, -38); x.lineTo(46, -36); x.stroke();
  for (const lx of [-20, -8, 10, 20]) x.fillRect(lx - 4, -26, 8, 26);
  x.fillRect(-18, -76, 34, 16);
  x.lineWidth = 2; x.beginPath(); x.moveTo(-1, -76); x.lineTo(-1, -98); x.stroke();
  x.beginPath(); x.ellipse(-1, -98, 18, 7, 0, Math.PI, 0); x.fill();
  x.restore();
}
function tinyChariot(x, px, base, d) {
  x.save(); x.translate(px, base); x.scale(d, 1);
  x.lineWidth = 2.4; x.beginPath(); x.arc(0, -12, 11, 0, TAU); x.stroke();
  x.fillRect(-14, -34, 26, 14); x.fillRect(-4, -54, 6, 22);
  x.beginPath(); x.arc(-1, -58, 4, 0, TAU); x.fill();
  x.lineWidth = 2; x.beginPath(); x.moveTo(12, -24); x.lineTo(30, -30); x.stroke();
  x.beginPath(); x.ellipse(40, -30, 13, 7, 0, 0, TAU); x.fill();
  x.beginPath(); x.moveTo(48, -34); x.lineTo(56, -46); x.lineTo(54, -34); x.fill();
  for (const lx of [32, 36, 46, 50]) x.fillRect(lx, -26, 2.4, 26);
  x.lineWidth = 1.5; x.beginPath(); x.moveTo(-12, -34); x.lineTo(-12, -80); x.stroke();
  x.beginPath(); x.moveTo(-12, -80); x.lineTo(-26, -76); x.lineTo(-12, -71); x.fill();
  x.restore();
}

/* ---------- environment ---------- */
function drawSky(c, p, hz) {
  const g = c.createLinearGradient(0, -200, 0, hz);
  g.addColorStop(0, rgba(p.top)); g.addColorStop(0.58, rgba(p.mid)); g.addColorStop(1, rgba(p.low));
  c.fillStyle = g; c.fillRect(-500, -500, W + 1000, hz + 520);
}
function drawSun(c, x, y, r, p, a = 1) {
  if (a <= 0.01) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  glowAt(c, x, y, r * 9, p.glow, 0.55 * a);
  glowAt(c, x, y, r * 3.2, p.sun, 0.5 * a);
  c.restore();
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(WHITE, a)); g.addColorStop(0.75, rgba(p.sun, a)); g.addColorStop(1, rgba(mixc(p.sun, p.glow, 0.5), a * 0.9));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}
function drawRays(c, x, y, t, p, a = 0.1, n = 18, len = 1900) {
  if (a <= 0.004) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, len);
  g.addColorStop(0, rgba(p.sun, 1)); g.addColorStop(0.35, rgba(p.glow, 0.35)); g.addColorStop(1, rgba(p.glow, 0));
  c.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + t * 0.025 + hash(i) * 0.5, w = 0.018 + hash(i + 7) * 0.045;
    c.globalAlpha = a * (0.35 + 0.65 * hash(i + 3)) * (0.75 + 0.25 * Math.sin(t * 0.9 + i));
    c.beginPath(); c.moveTo(x, y); c.arc(x, y, len, ang - w, ang + w); c.closePath(); c.fill();
  }
  c.restore();
}
function drawStars(c, a) {
  if (a <= 0.01) return;
  c.fillStyle = rgba([255, 240, 220], a);
  for (let i = 0; i < 140; i++) { const s = hash(i + 900) < 0.1 ? 2.6 : 1.4; c.fillRect(hash(i + 300) * W, hash(i + 600) * 560, s, s); }
}
// clouds: n sprites drifting; col = tint; op = composite
function drawClouds(c, t, o) {
  const n = o.n ?? 8, sp = o.sp ?? 10, scroll = o.scroll ?? 0;
  c.save(); c.globalCompositeOperation = o.op ?? 'source-over';
  for (let i = 0; i < n; i++) {
    const k = i % ASSET.cloud.length, sc = (o.sc ?? 1.4) * (0.7 + hash(i + 41 + (o.seed ?? 0)) * 0.8);
    const w = 640 * sc, span = W + w + 400;
    let x = hash(i + 11 + (o.seed ?? 0)) * span + t * sp * (0.6 + hash(i + 3) * 0.7) - scroll * (0.4 + hash(i + 5) * 0.3);
    x = ((x % span) + span) % span - w - 200;
    const y = lerp(o.y0 ?? 100, o.y1 ?? 520, hash(i + 21 + (o.seed ?? 0)));
    c.globalAlpha = (o.a ?? 0.5) * (0.6 + 0.4 * hash(i + 77));
    c.drawImage(tinted(ASSET.cloud[k], 'c' + k, o.col), x, y - 140 * sc, w, 280 * sc);
  }
  c.restore();
}
function ridge(c, base, amp, freq, seed, col, off, alpha = 1) {
  c.fillStyle = rgba(col, alpha); c.beginPath(); c.moveTo(-500, base + 40);
  for (let x = -500; x <= W + 500; x += 24) c.lineTo(x, base - amp * (fbm((x + off) * freq + seed) * 0.5 + 0.5));
  c.lineTo(W + 500, base + 40); c.closePath(); c.fill();
}
function armies(c, hz, p, scroll, alpha = 1, sc = 0.62) {
  if (alpha <= 0.01) return;
  const span = 2400 * sc;
  c.globalAlpha = alpha;
  for (let layer = 0; layer < 2; layer++) {
    const col = mixc(p.far, p.sil, layer * 0.5), s2 = sc * (1 + layer * 0.35), sp = span * (1 + layer * 0.35);
    const img = tinted(ASSET.army[layer], 'a' + layer, col);
    const off = ((-(scroll * (0.25 + layer * 0.2)) - layer * 700) % sp + sp) % sp;
    for (let x = off - sp; x < W + 500; x += sp) c.drawImage(img, x, hz - 236 * s2 + 4 + layer * 14, sp, 240 * s2);
  }
  c.globalAlpha = 1;
}
function hazeBand(c, hz, p, a) {
  const g = c.createLinearGradient(0, hz - 220, 0, hz + 60);
  g.addColorStop(0, rgba(p.haze, 0)); g.addColorStop(0.75, rgba(p.haze, a * 0.55)); g.addColorStop(1, rgba(p.haze, a * 0.15));
  c.fillStyle = g; c.fillRect(-500, hz - 220, W + 1000, 290);
}
function drawGround(c, hz, p) {
  const g = c.createLinearGradient(0, hz, 0, H + 200);
  g.addColorStop(0, rgba(mixc(p.g1, p.haze, 0.35))); g.addColorStop(0.25, rgba(p.g1)); g.addColorStop(1, rgba(p.g2));
  c.fillStyle = g; c.fillRect(-500, hz, W + 1000, H - hz + 500);
  c.strokeStyle = rgba(mixc(p.g1, p.glow, 0.25), 0.18); c.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const d = Math.pow(i / 14, 1.7), y = hz + 6 + d * (H - hz);
    c.beginPath(); c.moveTo(-500, y); c.lineTo(W + 500, y + (hash(i) - 0.5) * 10); c.stroke();
  }
}
// battlefield debris: stuck arrows, spears, shields, broken wheels
function debris(c, hz, p, scroll, amt = 1) {
  if (amt <= 0) return;
  c.fillStyle = c.strokeStyle = rgba(p.sil); c.lineCap = 'round';
  const n = Math.round(46 * amt);
  for (let i = 0; i < n; i++) {
    const d = Math.pow(hash(i + 5), 1.4), y = hz + 14 + d * (H - hz + 40);
    const s = 0.35 + d * 1.6, span = W + 800;
    let x = hash(i + 50) * span - scroll * (0.35 + d * 1.1);
    x = ((x % span) + span) % span - 400;
    const type = i % 6;
    c.save(); c.translate(x, y); c.scale(s, s);
    if (type < 3) { // arrow stuck in ground
      const a = -0.5 + hash(i + 9) * 0.6; c.rotate(a);
      c.lineWidth = 2.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -46); c.stroke();
      c.beginPath(); c.moveTo(0, -46); c.lineTo(-5, -56); c.lineTo(0, -52); c.lineTo(5, -56); c.closePath(); c.fill();
    } else if (type === 3) { // shield
      c.beginPath(); c.ellipse(0, -6, 18, 8, 0.15, 0, TAU); c.fill();
    } else if (type === 4) { // broken wheel
      c.rotate(0.2 + hash(i) * 0.4); c.lineWidth = 4; c.beginPath(); c.arc(0, -10, 26, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      c.lineWidth = 2.4; for (let k = 0; k < 4; k++) { const a = Math.PI * (1.15 + k * 0.22); c.beginPath(); c.moveTo(0, -10); c.lineTo(Math.cos(a) * 26, -10 + Math.sin(a) * 26); c.stroke(); }
    } else { // fallen spear
      c.rotate(-0.08 + hash(i + 3) * 0.16); c.lineWidth = 2.5; c.beginPath(); c.moveTo(-50, 0); c.lineTo(50, -4); c.stroke();
      c.beginPath(); c.moveTo(50, -4); c.lineTo(64, -6); c.lineTo(50, 2); c.fill();
    }
    c.restore();
  }
}
function groundDust(c, t, p, hz, a = 0.3, scroll = 0) {
  drawClouds(c, t, { n: 7, y0: hz + 30, y1: H - 60, sp: 18, a, col: mixc(p.haze, p.glow, 0.25), sc: 1.6, scroll: scroll * 1.2, seed: 300 });
}
function embers(c, t, n, col, o = {}) {
  c.save(); c.globalCompositeOperation = 'lighter';
  const x0 = o.x0 ?? 0, w = o.w ?? W, y1 = o.y1 ?? H + 40, rise = o.rise ?? H, seed = o.seed ?? 0;
  for (let i = 0; i < n; i++) {
    const L = 3 + hash(i + seed) * 4, ph = ((t + hash(i + 13 + seed) * L) % L) / L;
    const x = x0 + hash(i + 31 + seed) * w + Math.sin(t * 1.3 + i) * 24 + (o.drift ?? 30) * ph * L;
    const y = y1 - ph * rise * (0.6 + hash(i + 7) * 0.5);
    const a = Math.sin(Math.PI * ph) * (0.55 + 0.45 * Math.sin(t * 9 + i * 3)) * (o.a ?? 1);
    const r = (o.r ?? 3) * (0.5 + hash(i + 2 + seed));
    glowAt(c, x, y, r * 4, col, a * 0.5);
    c.fillStyle = rgba(mixc(col, WHITE, 0.5), a); c.fillRect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
  }
  c.restore();
}
function motes(c, t, n, col, a = 0.4, speed = 1) {
  c.fillStyle = rgba(col, a);
  for (let i = 0; i < n; i++) {
    const x = ((hash(i + 500) * W + t * (8 + hash(i) * 20) * speed) % (W + 40)) - 20;
    const y = hash(i + 700) * H + Math.sin(t * 0.7 + i) * 18;
    const s = 1 + hash(i + 900) * 2.4; c.fillRect(x, y, s, s);
  }
}
function bokeh(c, t, n, col, a = 0.25, seed = 0) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = hash(i + seed) * W + Math.sin(t * 0.25 + i) * 30, y = hash(i + seed + 40) * H * 0.9 + Math.cos(t * 0.2 + i) * 20;
    glowAt(c, x, y, 30 + hash(i + seed + 80) * 70, col, a * (0.4 + 0.6 * hash(i + seed + 9)) * (0.7 + 0.3 * Math.sin(t + i)));
  }
  c.restore();
}

/* ---------- silhouette helper: rim-lit double draw ---------- */
function sil(c, fn, dark, rim, dx, dy, glow) {
  if (rim) {
    c.save(); c.translate(dx, dy);
    if (glow) { c.shadowColor = rgba(rim, 0.85); c.shadowBlur = glow * VIEW.scale; }
    fn(c, rgba(rim)); c.restore();
  }
  fn(c, rgba(dark));
}

/* ---------- horse (unit scale, faces right, ground at y=0) ---------- */
function horse(c, col, ph, kneel) {
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
  const k = kneel || 0, P = ph * TAU;
  c.save();
  c.translate(0, Math.sin(P * 2) * 0.014 * (1 - k) + k * 0.2);
  c.rotate(k * 0.16);
  const leg = (ax, ay, a1, a2, l1, l2, w1, w2) => {
    const kx = ax + Math.sin(a1) * l1, ky = ay + Math.cos(a1) * l1;
    const hx = kx + Math.sin(a2) * l2, hy = ky + Math.cos(a2) * l2;
    c.lineWidth = w1; c.beginPath(); c.moveTo(ax, ay); c.lineTo(kx, ky); c.stroke();
    c.lineWidth = w2; c.beginPath(); c.moveTo(kx, ky); c.lineTo(hx, hy); c.stroke();
    c.beginPath(); c.ellipse(hx + 0.01, hy, 0.028, 0.02, 0, 0, TAU); c.fill();
  };
  for (const off of [0.13, 0]) {
    const q = P + off * TAU;
    let f1 = 0.25 + 0.62 * Math.sin(q), f2 = f1 - (0.12 + 1.15 * Math.max(0, Math.sin(q + 1.6)));
    let r1 = -0.25 + 0.5 * Math.sin(q + Math.PI), r2 = r1 + 0.45 - 0.85 * Math.max(0, Math.sin(q + Math.PI + 1.4));
    f1 = lerp(f1, 0.15, k); f2 = lerp(f2, -1.5, k); r1 = lerp(r1, -0.55, k); r2 = lerp(r2, 0.55, k);
    leg(0.3, -0.52, f1, f2, 0.27, 0.27, 0.085, 0.05);
    leg(-0.4, -0.56, r1, r2, 0.3, 0.26, 0.11, 0.05);
  }
  c.beginPath();
  c.moveTo(0.3, -0.8);
  c.bezierCurveTo(0.1, -0.74, -0.15, -0.74, -0.36, -0.78);
  c.bezierCurveTo(-0.5, -0.8, -0.59, -0.7, -0.57, -0.58);
  c.bezierCurveTo(-0.56, -0.48, -0.48, -0.42, -0.4, -0.42);
  c.bezierCurveTo(-0.2, -0.39, 0.1, -0.39, 0.28, -0.45);
  c.bezierCurveTo(0.38, -0.48, 0.46, -0.55, 0.47, -0.65);
  c.bezierCurveTo(0.52, -0.8, 0.6, -0.92, 0.68, -0.98);
  c.bezierCurveTo(0.74, -0.98, 0.84, -0.94, 0.9, -0.95);
  c.bezierCurveTo(0.95, -0.97, 0.95, -1.03, 0.9, -1.05);
  c.bezierCurveTo(0.84, -1.1, 0.76, -1.16, 0.7, -1.2);
  c.lineTo(0.7, -1.3); c.lineTo(0.65, -1.21);
  c.bezierCurveTo(0.58, -1.18, 0.5, -1.08, 0.42, -0.98);
  c.bezierCurveTo(0.38, -0.92, 0.34, -0.85, 0.3, -0.8);
  c.closePath(); c.fill();
  const tw = Math.sin(P + 1) * 0.06;
  c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.52, -0.72); c.bezierCurveTo(-0.7, -0.74 + tw, -0.82, -0.6 + tw, -0.86, -0.46 + tw * 1.5); c.stroke();
  c.lineWidth = 0.022;
  for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-0.55, -0.71); c.bezierCurveTo(-0.72, -0.72 + tw + i * 0.02, -0.86 - i * 0.02, -0.58 + tw, -0.92 - i * 0.02, -0.44 + tw * 1.6 + i * 0.03); c.stroke(); }
  c.lineWidth = 0.018;
  for (let i = 0; i < 7; i++) {
    const u = i / 6, mx = lerp(0.63, 0.31, u), my = lerp(-1.17, -0.82, u);
    c.beginPath(); c.moveTo(mx, my); c.quadraticCurveTo(mx - 0.06, my - 0.02 + Math.sin(P + i) * 0.02, mx - 0.13, my + 0.04 + Math.sin(P * 1.3 + i) * 0.03); c.stroke();
  }
  c.lineWidth = 0.022; c.beginPath(); c.moveTo(0.64, -1.22); c.quadraticCurveTo(0.62, -1.3, 0.56, -1.32 + Math.sin(P) * 0.015); c.stroke();
  c.restore();
}

/* ---------- warriors ---------- */
function crownSmall(c, kind) {
  if (kind === 'kirita' || kind === 'karna') {
    c.beginPath(); c.moveTo(-13, -218); c.lineTo(15, -218); c.lineTo(11, -234); c.lineTo(6, -236); c.lineTo(2, -254); c.lineTo(-3, -236); c.lineTo(-8, -234); c.closePath(); c.fill();
    if (kind === 'karna') { c.beginPath(); c.arc(9, -232, 6, 0, TAU); c.fill(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.beginPath(); c.moveTo(9 + Math.cos(a) * 5, -232 + Math.sin(a) * 5); c.lineTo(9 + Math.cos(a) * 10, -232 + Math.sin(a) * 10); c.stroke(); } }
  } else if (kind === 'mukut') {
    c.beginPath(); c.moveTo(-12, -218); c.lineTo(13, -218); c.lineTo(8, -232); c.lineTo(1, -240); c.lineTo(-7, -232); c.closePath(); c.fill();
    c.lineWidth = 2; c.beginPath(); c.moveTo(-3, -236); c.quadraticCurveTo(-10, -256, -24, -266); c.stroke();
    c.beginPath(); c.ellipse(-20, -262, 9, 4, -0.7, 0, TAU); c.fill();
  } else if (kind === 'turban') {
    c.beginPath(); c.ellipse(0, -222, 17, 12, 0, 0, TAU); c.fill();
    c.lineWidth = 2; c.beginPath(); c.moveTo(6, -232); c.quadraticCurveTo(12, -246, 4, -252); c.stroke();
  }
}
// full-body warrior, faces right, feet at origin, ~255 units tall
function figure(c, col, o) {
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
  const t = o.t || 0;
  c.save(); c.rotate(o.lean || 0);
  if (o.legs !== false) {
    c.lineWidth = 15;
    c.beginPath(); c.moveTo(-14, 0); c.lineTo(-9, -50); c.lineTo(-6, -100); c.stroke();
    c.beginPath(); c.moveTo(18, 0); c.lineTo(11, -52); c.lineTo(6, -100); c.stroke();
    c.beginPath(); c.moveTo(-21, -104); c.lineTo(21, -104); c.lineTo(28, -56); c.quadraticCurveTo(0, -46, -28, -56); c.closePath(); c.fill();
  }
  c.beginPath(); c.moveTo(-18, -100); c.lineTo(18, -100);
  c.quadraticCurveTo(31, -140, 26, -178); c.lineTo(-24, -180); c.quadraticCurveTo(-27, -140, -18, -100); c.closePath(); c.fill();
  c.save(); c.translate(-24, -150); c.rotate(-0.35); c.fillRect(-7, -60, 14, 66);
  c.lineWidth = 2; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-4 + i * 3, -60); c.lineTo(-6 + i * 4, -82); c.stroke(); }
  c.restore();
  c.fillRect(-6, -194, 12, 16);
  c.beginPath(); c.ellipse(2, -208, 14, 16, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(14, -212); c.lineTo(21, -203); c.lineTo(14, -200); c.fill();
  if (o.hair !== false) {
    const w = Math.sin(t * 3) * 3 * (o.hairWind ?? 1);
    c.beginPath(); c.moveTo(-10, -220); c.quadraticCurveTo(-32 + w, -200, -27 + w, -170); c.lineTo(-14, -176); c.quadraticCurveTo(-16, -196, -2, -216); c.fill();
  }
  if (o.crown) crownSmall(c, o.crown);
  { // uttariya (scarf) streaming behind
    c.beginPath(); c.moveTo(-20, -176);
    for (let i = 0; i <= 6; i++) { const u = i / 6; c.lineTo(-20 - u * 70, -176 + u * 30 + Math.sin(u * 5 - t * 6) * 8 * u); }
    for (let i = 6; i >= 0; i--) { const u = i / 6; c.lineTo(-20 - u * 70, -168 + u * 36 + Math.sin(u * 5 - t * 6 + 0.4) * 8 * u); }
    c.fill();
  }
  const sh = [22, -172], bsh = [-16, -172];
  if (o.bow !== false) {
    const d = o.draw || 0, bh = [96, -182 + (o.bowDrop || 0)];
    c.lineWidth = 11; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(bh[0], bh[1]); c.stroke();
    const dh = [lerp(78, 6, d), lerp(-184, -197, d)], el = [lerp(40, -42, d), lerp(-170, -188, d)];
    c.lineWidth = 10; c.beginPath(); c.moveTo(bsh[0], bsh[1]); c.lineTo(el[0], el[1]); c.lineTo(dh[0], dh[1]); c.stroke();
    const top = [bh[0] - 26 - d * 10, bh[1] - 122], bot = [bh[0] - 26 - d * 10, bh[1] + 122];
    c.lineWidth = 6; c.beginPath(); c.moveTo(top[0], top[1]); c.quadraticCurveTo(bh[0] + 40 + d * 10, bh[1], bot[0], bot[1]); c.stroke();
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(top[0], top[1]); c.quadraticCurveTo(top[0] - 5, top[1] - 8, top[0] + 6, top[1] - 15); c.stroke();
    c.beginPath(); c.moveTo(bot[0], bot[1]); c.quadraticCurveTo(bot[0] - 5, bot[1] + 8, bot[0] + 6, bot[1] + 15); c.stroke();
    c.lineWidth = 1.6; c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(dh[0], dh[1]); c.lineTo(bot[0], bot[1]); c.stroke();
    if (o.arrow !== false && d > 0.05) {
      c.lineWidth = 3; c.beginPath(); c.moveTo(dh[0], dh[1]); c.lineTo(dh[0] + 150, dh[1]); c.stroke();
      c.beginPath(); c.moveTo(dh[0] + 162, dh[1]); c.lineTo(dh[0] + 146, dh[1] - 6); c.lineTo(dh[0] + 146, dh[1] + 6); c.fill();
    }
  } else {
    const up = o.armUp || 0;
    c.lineWidth = 11;
    c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(sh[0] + lerp(16, 60, up), sh[1] + lerp(74, -52, up)); c.stroke();
    c.beginPath(); c.moveTo(bsh[0], bsh[1]); c.lineTo(bsh[0] + (o.reach ? 40 : -8), bsh[1] + 76); c.stroke();
    if (o.heldBow) { c.lineWidth = 5; c.beginPath(); c.moveTo(bsh[0] - 30, bsh[1] + 40); c.quadraticCurveTo(bsh[0] - 4, bsh[1] + 90, bsh[0] + 30, bsh[1] + 160); c.stroke(); }
  }
  c.restore();
}
// charioteer, seated forward on the chariot front; origin at seat
function driverFig(c, col, o) {
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round';
  c.save(); c.rotate(o.lean || 0);
  c.beginPath(); c.moveTo(-16, 0); c.lineTo(16, 0); c.quadraticCurveTo(28, -40, 22, -78); c.lineTo(-18, -80); c.quadraticCurveTo(-22, -40, -16, 0); c.closePath(); c.fill();
  c.fillRect(-4, -94, 10, 16);
  c.beginPath(); c.ellipse(5, -106, 12, 14, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(15, -110); c.lineTo(21, -102); c.lineTo(15, -99); c.fill();
  c.lineWidth = 9; c.beginPath(); c.moveTo(18, -72); c.lineTo(44, -44); c.lineTo(62, -52); c.stroke();
  c.save(); c.translate(3, 112); crownSmall(c, o.crown); c.restore();
  c.restore();
}
function wheel(c, x, y, R, rot, spokes = 12) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.lineWidth = R * 0.11; c.beginPath(); c.arc(0, 0, R * 0.94, 0, TAU); c.stroke();
  c.lineWidth = R * 0.04; c.beginPath(); c.arc(0, 0, R * 0.79, 0, TAU); c.stroke();
  c.lineWidth = R * 0.05;
  for (let i = 0; i < spokes; i++) { const a = (i / spokes) * TAU; c.beginPath(); c.moveTo(Math.cos(a) * R * 0.16, Math.sin(a) * R * 0.16); c.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86); c.stroke(); }
  c.beginPath(); c.arc(0, 0, R * 0.19, 0, TAU); c.fill();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; c.beginPath(); c.arc(Math.cos(a) * R, Math.sin(a) * R, R * 0.035, 0, TAU); c.fill(); }
  c.restore();
}

/* ---------- flags & emblems ---------- */
function hanumanGlyph(c) {
  c.lineCap = 'round';
  c.beginPath(); c.ellipse(0, 0, 9, 14, -0.3, 0, TAU); c.fill();
  c.beginPath(); c.arc(5, -18, 7, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(11, -16, 4, 3, 0, 0, TAU); c.fill();
  c.lineWidth = 4;
  c.beginPath(); c.moveTo(-2, 10); c.lineTo(-12, 20); c.lineTo(-6, 30); c.stroke();
  c.beginPath(); c.moveTo(4, 10); c.lineTo(14, 18); c.lineTo(20, 28); c.stroke();
  c.beginPath(); c.moveTo(6, -6); c.lineTo(14, -22); c.lineTo(16, -34); c.stroke();
  c.lineWidth = 3; c.beginPath(); c.moveTo(16, -34); c.lineTo(8, -46); c.stroke();
  c.beginPath(); c.arc(6, -50, 6.5, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(-8, 8); c.bezierCurveTo(-26, 8, -30, -20, -18, -30); c.bezierCurveTo(-10, -36, -6, -28, -12, -24); c.stroke();
}
function ropeGlyph(c) {
  c.lineWidth = 3.6;
  for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(0, -2, 22 - i * 6, 14 - i * 4, 0.2, 0, TAU); c.stroke(); }
  c.beginPath(); c.moveTo(18, 6); c.quadraticCurveTo(30, 20, 22, 32); c.stroke();
  c.beginPath(); c.moveTo(-18, 4); c.quadraticCurveTo(-28, 18, -20, 30); c.stroke();
}
// cloth hangs from (px,py) and streams toward -x
function flagCloth(c, px, py, w, h, t, col, emblem, strength = 1) {
  const N = 14, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, wv = (Math.sin(u * 6 - t * 9) * 0.16 + Math.sin(u * 13 - t * 15) * 0.04) * h * u * strength;
    top.push([px - u * w, py + wv]); bot.push([px - u * w * 0.95, py + h + wv * 1.15 - u * h * 0.14]);
  }
  c.beginPath(); c.moveTo(top[0][0], top[0][1]);
  for (const p of top) c.lineTo(p[0], p[1]);
  for (let i = N; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
  c.closePath();
  const g = c.createLinearGradient(px - w, py, px, py + h);
  g.addColorStop(0, rgba(mixc(col, BLACK, 0.45))); g.addColorStop(0.5, rgba(col)); g.addColorStop(1, rgba(mixc(col, BLACK, 0.3)));
  c.fillStyle = g; c.fill();
  c.fillStyle = rgba(BLACK, 0.22);
  for (let i = 0; i < N; i++) {
    const sl = (top[i + 1][1] - top[i][1]); if (sl <= 0) continue;
    c.globalAlpha = clamp(sl / (h * 0.08)); c.beginPath(); c.moveTo(top[i][0], top[i][1]); c.lineTo(top[i + 1][0], top[i + 1][1]); c.lineTo(bot[i + 1][0], bot[i + 1][1]); c.lineTo(bot[i][0], bot[i][1]); c.fill();
  }
  c.globalAlpha = 1;
  if (emblem) {
    const m = N >> 1, ex = (top[m][0] + bot[m][0]) / 2, ey = (top[m][1] + bot[m][1]) / 2;
    c.save(); c.translate(ex, ey); c.scale(h / 110, h / 110); c.fillStyle = c.strokeStyle = 'rgba(40,6,4,.88)';
    emblem === 'hanuman' ? hanumanGlyph(c) : ropeGlyph(c);
    c.restore();
  }
}

/* ---------- chariot (faces right in local space; dir=-1 mirrors) ---------- */
function chariot(c, o) {
  const s = o.s, dir = o.dir || 1, t = o.t || 0;
  c.save(); c.translate(o.x, o.y + (o.sink || 0)); c.scale(s * dir, s);
  const flagTop = -700, cutY = -430, fall = o.flagFall || 0;
  const parts = (cc, col, isRim) => {
    cc.fillStyle = col; cc.strokeStyle = col; cc.lineCap = 'round'; cc.lineJoin = 'round';
    cc.save(); cc.translate(-20, -120); cc.rotate(o.tilt || 0); cc.translate(20, 120);
    cc.lineWidth = 9; cc.beginPath(); cc.moveTo(-150, -150); cc.lineTo(-150, fall > 0 ? cutY : flagTop); cc.stroke();
    if (fall > 0) {
      cc.save(); cc.translate(-150, cutY); cc.rotate(-fall * 1.9); cc.translate(fall * -60, fall * 260);
      cc.beginPath(); cc.moveTo(0, 0); cc.lineTo(0, flagTop - cutY); cc.stroke(); cc.restore();
    }
    if (!o.noWarrior) { cc.save(); cc.translate(-40, -150); figure(cc, col, Object.assign({ t, legs: false }, o.warrior)); cc.restore(); }
    if (o.driver) { cc.save(); cc.translate(96, -170); driverFig(cc, col, o.driver); cc.restore(); }
    cc.beginPath(); cc.moveTo(-162, -150); cc.lineTo(128, -150); cc.quadraticCurveTo(150, -175, 156, -224); cc.lineTo(-162, -224); cc.closePath(); cc.fill();
    cc.lineWidth = 7; cc.beginPath(); cc.moveTo(-164, -262); cc.lineTo(120, -262); cc.quadraticCurveTo(150, -262, 166, -292); cc.stroke();
    cc.lineWidth = 5; for (let x = -152; x <= 112; x += 37.7) { cc.beginPath(); cc.moveTo(x, -224); cc.lineTo(x, -262); cc.stroke(); }
    cc.lineWidth = 3; for (let x = -152; x < 112; x += 37.7) { cc.beginPath(); cc.arc(x + 18.8, -224, 15, Math.PI, 0); cc.stroke(); }
    cc.lineWidth = 6; cc.beginPath(); cc.moveTo(166, -292); cc.quadraticCurveTo(192, -322, 174, -336); cc.quadraticCurveTo(158, -340, 160, -324); cc.stroke();
    cc.fillRect(-172, -152, 304, 12);
    wheel(cc, -20, -120, 120, o.wheel || 0);
    cc.restore();
    if (o.horses !== false) {
      cc.lineWidth = 12; cc.beginPath(); cc.moveTo(120, -160); cc.quadraticCurveTo(320, -200, 520, -246); cc.stroke();
      for (let k = 3; k >= 0; k--) {
        cc.save(); const hs = 300 * (1 - k * 0.05); cc.translate(420 + k * 40, -k * 17); cc.scale(hs, hs);
        horse(cc, isRim || !o.far ? col : rgba(mixc(o.col, o.far, k * 0.16)), (o.ph || 0) + k * 0.23, o.kneel || 0); cc.restore();
      }
      if (o.driver) { cc.lineWidth = 2.2; for (const dy of [0, 8]) { cc.beginPath(); cc.moveTo(160, -222 + dy); cc.quadraticCurveTo(420, -250 + dy, 680 - (o.kneel || 0) * 30, -292 + dy + (o.kneel || 0) * 70); cc.stroke(); } }
    }
  };
  if (o.rim) { c.save(); c.translate((o.rimOff ? o.rimOff[0] : 3) / s * dir, (o.rimOff ? o.rimOff[1] : -1) / s); parts(c, rgba(o.rim), true); c.restore(); }
  parts(c, rgba(o.col), false);
  if (o.flag) {
    c.save(); c.translate(-20, -120); c.rotate(o.tilt || 0); c.translate(20, 120);
    if (fall > 0) { c.translate(-150, cutY); c.rotate(-fall * 1.9); c.translate(fall * -60, fall * 260); c.translate(150, -cutY); }
    flagCloth(c, -150, flagTop + 6, 190, 120, t, o.flagCol, o.flag, o.flagWind ?? 1);
    c.restore();
  }
  c.restore();
}

/* ---------- busts (close-up profiles, unit scale; face right) ---------- */
function profilePath(c) {
  c.beginPath();
  c.moveTo(-0.32, 0.58);
  c.bezierCurveTo(-0.42, 0.4, -0.56, 0.18, -0.54, -0.12);
  c.bezierCurveTo(-0.52, -0.48, -0.24, -0.68, 0.04, -0.67);
  c.bezierCurveTo(0.28, -0.64, 0.4, -0.48, 0.41, -0.3);
  c.bezierCurveTo(0.42, -0.22, 0.43, -0.19, 0.42, -0.15);
  c.bezierCurveTo(0.4, -0.12, 0.4, -0.09, 0.43, -0.05);
  c.lineTo(0.55, 0.08);
  c.bezierCurveTo(0.57, 0.11, 0.53, 0.13, 0.47, 0.13);
  c.lineTo(0.465, 0.165);
  c.bezierCurveTo(0.49, 0.175, 0.495, 0.195, 0.475, 0.21);
  c.lineTo(0.455, 0.215);
  c.bezierCurveTo(0.48, 0.23, 0.48, 0.255, 0.46, 0.265);
  c.bezierCurveTo(0.44, 0.285, 0.44, 0.3, 0.455, 0.33);
  c.bezierCurveTo(0.47, 0.4, 0.42, 0.45, 0.32, 0.46);
  c.bezierCurveTo(0.22, 0.47, 0.17, 0.52, 0.17, 0.62);
  c.bezierCurveTo(0.17, 0.72, 0.2, 0.8, 0.26, 0.86);
  c.bezierCurveTo(0.5, 0.92, 0.8, 1.0, 0.92, 1.25);
  c.lineTo(1.0, 2.4); c.lineTo(-1.2, 2.4); c.lineTo(-1.05, 1.25);
  c.bezierCurveTo(-0.95, 0.98, -0.62, 0.86, -0.4, 0.8);
  c.bezierCurveTo(-0.34, 0.74, -0.32, 0.66, -0.32, 0.58);
  c.closePath();
}
function longHair(c, t, amt = 1) {
  const w = Math.sin(t * 1.7) * 0.035 * amt, w2 = Math.sin(t * 2.3 + 1) * 0.04 * amt;
  c.beginPath(); c.moveTo(-0.28, -0.5);
  c.bezierCurveTo(-0.72, -0.34 + w, -0.82 - w2, 0.3 + w, -0.7 + w2, 0.92);
  c.bezierCurveTo(-0.6, 1.0, -0.46, 0.88, -0.4, 0.7);
  c.bezierCurveTo(-0.46, 0.3, -0.36, 0.0, -0.18, -0.3);
  c.closePath(); c.fill();
  c.lineWidth = 0.03;
  for (let i = 0; i < 5; i++) { const y = -0.1 + i * 0.2; c.beginPath(); c.moveTo(-0.6, y); c.quadraticCurveTo(-0.82 - w2 * (1 + i * 0.4), y + 0.12, -0.78 + w * 2, y + 0.3); c.stroke(); }
}
function tieredCrown(c, peak = -1.32, sunDisc = false) {
  c.beginPath(); c.moveTo(0.41, -0.4);
  c.lineTo(0.37, -0.62); c.lineTo(0.3, -0.66); c.lineTo(0.27, -0.86); c.lineTo(0.2, -0.88); c.lineTo(0.15, -1.08); c.lineTo(0.08, -1.1);
  c.lineTo(0.02, peak);
  c.lineTo(-0.04, -1.1); c.lineTo(-0.11, -1.08); c.lineTo(-0.16, -0.88); c.lineTo(-0.23, -0.86); c.lineTo(-0.28, -0.66); c.lineTo(-0.4, -0.62); c.lineTo(-0.52, -0.42);
  c.bezierCurveTo(-0.3, -0.53, 0.2, -0.53, 0.41, -0.4);
  c.closePath(); c.fill();
  c.beginPath(); c.moveTo(-0.5, -0.42); c.lineTo(-0.66, -0.2); c.lineTo(-0.44, -0.3); c.fill();
  for (const [x, y] of [[0.3, -0.66], [0.2, -0.88], [0.08, -1.1], [-0.11, -1.08], [-0.23, -0.86], [-0.4, -0.62]]) { c.beginPath(); c.arc(x, y, 0.035, 0, TAU); c.fill(); }
  if (sunDisc) {
    c.beginPath(); c.arc(0.16, -0.78, 0.14, 0, TAU); c.fill();
    c.lineWidth = 0.035; for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; c.beginPath(); c.moveTo(0.16 + Math.cos(a) * 0.15, -0.78 + Math.sin(a) * 0.15); c.lineTo(0.16 + Math.cos(a) * 0.27, -0.78 + Math.sin(a) * 0.27); c.stroke(); }
  }
}
function peacockFeather(c, t) {
  const sw = Math.sin(t * 1.4) * 0.03;
  c.lineWidth = 0.03; c.beginPath(); c.moveTo(-0.1, -0.86); c.quadraticCurveTo(-0.2, -1.2, -0.52 + sw, -1.5); c.stroke();
  c.save(); c.translate(-0.42 + sw, -1.38); c.rotate(-0.85);
  c.beginPath(); c.ellipse(0, 0, 0.3, 0.12, 0, 0, TAU); c.fill();
  c.lineWidth = 0.012; for (let i = -10; i <= 10; i++) { const x = i * 0.026; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 0.04, (i % 2 ? 1 : -1) * 0.19); c.stroke(); }
  c.restore();
}
function bustShape(c, who, col, o) {
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
  const t = o.t || 0;
  if (who === 'A' || who === 'K' || who === 'KR') longHair(c, t, o.hairAmt ?? 1);
  if (who === 'P') { // parashurama: matted hair flowing, axe over shoulder
    longHair(c, t, 0.6);
    c.lineWidth = 0.08; c.beginPath(); c.moveTo(-1.0, 1.8); c.lineTo(-0.36, -1.15); c.stroke();
    c.beginPath(); c.moveTo(-0.42, -0.95); c.quadraticCurveTo(-0.95, -1.05, -0.92, -1.55); c.quadraticCurveTo(-0.62, -1.2, -0.3, -1.3); c.closePath(); c.fill();
  }
  profilePath(c); c.fill();
  c.beginPath(); c.ellipse(0.7, 1.12, 0.26, 0.17, -0.5, 0, TAU); c.fill(); // shoulder guard
  c.beginPath(); c.ellipse(-0.82, 1.1, 0.24, 0.15, 0.5, 0, TAU); c.fill();
  if (who === 'A') { if (!o.noCrown) tieredCrown(c, -1.32); }
  else if (who === 'K') tieredCrown(c, -1.24, true);
  else if (who === 'KR') { tieredCrown(c, -1.05); peacockFeather(c, t); }
  else if (who === 'S' || who === 'P') {
    c.beginPath(); c.moveTo(0.45, 0.16); c.bezierCurveTo(0.5, 0.3, 0.5, 0.52, 0.36, 0.78); c.lineTo(0.22, 1.02 + (who === 'P' ? 0.25 : 0)); c.bezierCurveTo(0.08, 0.8, -0.04, 0.58, -0.12, 0.36); c.lineTo(-0.16, 0.02); c.bezierCurveTo(0.1, 0.1, 0.3, 0.1, 0.45, 0.16); c.fill();
    if (who === 'S') {
      c.beginPath(); c.moveTo(0.44, -0.34); c.bezierCurveTo(0.52, -0.72, 0.2, -1.0, -0.12, -0.98); c.bezierCurveTo(-0.48, -0.96, -0.7, -0.7, -0.6, -0.32); c.bezierCurveTo(-0.3, -0.44, 0.12, -0.44, 0.44, -0.34); c.fill();
      c.lineWidth = 0.03; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-0.55 + i * 0.05, -0.36 - i * 0.12); c.quadraticCurveTo(-0.1, -0.5 - i * 0.14, 0.4, -0.42 - i * 0.12); c.stroke(); }
      c.lineWidth = 0.035; c.beginPath(); c.moveTo(0.18, -0.9); c.quadraticCurveTo(0.34, -1.2, 0.12, -1.36 + Math.sin(t * 2) * 0.03); c.stroke();
    } else {
      c.beginPath(); c.ellipse(-0.06, -0.86, 0.2, 0.3, -0.15, 0, TAU); c.fill();
      c.lineWidth = 0.035; c.beginPath(); c.moveTo(-0.26, -0.78); c.lineTo(0.12, -0.84); c.stroke();
    }
  }
  if (o.bow) bustBow(c, col, o);
}
function bustBow(c, col, o) {
  const b = o.bow;
  c.lineWidth = 0.17; c.beginPath(); c.moveTo(0.62, 1.05); c.lineTo(1.04, 0.28); c.stroke();
  c.lineWidth = 0.065; c.beginPath(); c.moveTo(0.88, -1.4); c.quadraticCurveTo(1.32, 0.22, 0.88, 1.84); c.stroke();
  c.lineWidth = 0.008 * 3; c.beginPath(); c.moveTo(0.88, -1.4); c.lineTo(b.vertical ? 0.88 : 0.3, b.vertical ? 0.2 : 0.2); c.lineTo(0.88, 1.84); c.stroke();
  c.beginPath(); c.arc(1.05, 0.26, 0.1, 0, TAU); c.fill();
  if (!b.vertical) {
    c.lineWidth = 0.14; c.beginPath(); c.moveTo(-0.3, 0.75); c.lineTo(0.0, 0.36); c.lineTo(0.3, 0.22); c.stroke();
    c.beginPath(); c.arc(0.33, 0.2, 0.085, 0, TAU); c.fill();
    c.lineWidth = 0.028; c.beginPath(); c.moveTo(0.18, 0.19); c.lineTo(b.len ?? 1.62, 0.19); c.stroke();
  }
}
// draws the rim-lit bust; o: x,y,s, flip, t, tilt, dark, rim, glow, bow, noCrown, eye
function bust(c, who, o) {
  c.save(); c.translate(o.x, o.y); if (o.flip) c.scale(-1, 1); c.rotate(o.tilt || 0); c.scale(o.s, o.s);
  sil(c, (cc, col) => bustShape(cc, who, col, o), o.dark, o.rim, 0.022, -0.012, o.glow ?? 26);
  if (who === 'KR') { // feather eye keeps its colour against the silhouette
    const sw = Math.sin((o.t || 0) * 1.4) * 0.03;
    c.save(); c.translate(-0.42 + sw, -1.38); c.rotate(-0.85);
    c.fillStyle = rgba([24, 160, 150], 0.95); c.beginPath(); c.ellipse(0.12, 0, 0.1, 0.07, 0, 0, TAU); c.fill();
    c.fillStyle = rgba([20, 40, 120], 1); c.beginPath(); c.ellipse(0.13, 0, 0.055, 0.04, 0, 0, TAU); c.fill();
    c.fillStyle = rgba([255, 210, 90], 0.9); c.beginPath(); c.ellipse(0.06, 0, 0.022, 0.03, 0, 0, TAU); c.fill();
    c.restore();
  }
  if (who === 'K') { c.save(); c.globalCompositeOperation = 'lighter'; glowAt(c, 0.16, -0.78, 0.5, [255, 170, 60], 0.45); c.restore(); }
  if (o.eye !== false) { c.save(); c.globalCompositeOperation = 'lighter'; glowAt(c, 0.33, -0.09, 0.05, o.eyeCol || o.rim, 0.75); c.restore(); }
  c.restore();
}

/* ---------- arrows, astras, effects ---------- */
function arrowShape(c, x, y, ang, len, col, w = 3) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.strokeStyle = c.fillStyle = col; c.lineWidth = w; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-len, 0); c.lineTo(0, 0); c.stroke();
  c.beginPath(); c.moveTo(w * 4, 0); c.lineTo(-w * 2, -w * 2); c.lineTo(-w * 2, w * 2); c.fill();
  c.lineWidth = w * 0.7; c.beginPath(); c.moveTo(-len, 0); c.lineTo(-len - w * 3, -w * 2.4); c.moveTo(-len, 0); c.lineTo(-len - w * 3, w * 2.4); c.stroke();
  c.restore();
}
// glowing projectile with trail; pts: function(u)->[x,y]
function astraBolt(c, x, y, ang, col, size = 1, trail = 260, a = 1) {
  c.save(); c.globalCompositeOperation = 'lighter';
  const tx = Math.cos(ang), ty = Math.sin(ang);
  const g = c.createLinearGradient(x, y, x - tx * trail, y - ty * trail);
  g.addColorStop(0, rgba(mixc(col, WHITE, 0.6), a)); g.addColorStop(0.3, rgba(col, a * 0.55)); g.addColorStop(1, rgba(col, 0));
  c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = 10 * size; c.beginPath(); c.moveTo(x, y); c.lineTo(x - tx * trail, y - ty * trail); c.stroke();
  c.lineWidth = 3 * size; c.stroke();
  glowAt(c, x, y, 60 * size, col, a); glowAt(c, x, y, 20 * size, WHITE, a);
  c.restore();
}
function sparks(c, x, y, age, n, col, seed = 0, spd = 420, life = 0.7) {
  if (age < 0 || age > life) return;
  const k = age / life;
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  c.strokeStyle = rgba(mixc(col, WHITE, 0.4), 1 - k); c.lineWidth = 2.4;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = hash(i + seed) * TAU, v = spd * (0.3 + hash(i + seed + 9) * 0.7);
    const px = x + Math.cos(a) * v * age, py = y + Math.sin(a) * v * age + 300 * age * age;
    c.moveTo(px, py); c.lineTo(px - Math.cos(a) * v * 0.03, py - Math.sin(a) * v * 0.03);
  }
  c.stroke();
  glowAt(c, x, y, 70 * (1 - k) + 10, col, (1 - k) * 0.8);
  c.restore();
}
function flame(c, x, y, h, w, t, seed) {
  if (h < 2) return;
  const hh = h * (0.75 + 0.25 * vnoise(t * 6 + seed * 13)), sw = vnoise(t * 3 + seed) * w * 0.45;
  const g = c.createLinearGradient(x, y, x, y - hh);
  g.addColorStop(0, 'rgba(255,240,190,.95)'); g.addColorStop(0.25, 'rgba(255,170,50,.85)'); g.addColorStop(0.6, 'rgba(230,70,20,.5)'); g.addColorStop(1, 'rgba(120,20,10,0)');
  c.fillStyle = g; c.beginPath(); c.moveTo(x - w / 2, y);
  c.bezierCurveTo(x - w / 2, y - hh * 0.4, x - w * 0.15 + sw, y - hh * 0.7, x + sw * 1.6, y - hh);
  c.bezierCurveTo(x + w * 0.2 + sw, y - hh * 0.6, x + w / 2, y - hh * 0.35, x + w / 2, y);
  c.closePath(); c.fill();
}
function lightning(c, x0, y0, x1, y1, seed, w, col, a = 1) {
  if (a <= 0.01) return;
  const pts = [[x0, y0], [x1, y1]];
  let segs = pts, disp = Math.hypot(x1 - x0, y1 - y0) * 0.22;
  for (let k = 0; k < 6; k++) {
    const nx = [];
    for (let i = 0; i < segs.length - 1; i++) {
      const [ax, ay] = segs[i], [bx, by] = segs[i + 1];
      nx.push([ax, ay], [(ax + bx) / 2 + (h2(seed + k, i) - 0.5) * disp, (ay + by) / 2 + (h2(seed + k + 50, i) - 0.5) * disp * 0.3]);
    }
    nx.push(segs[segs.length - 1]); segs = nx; disp *= 0.55;
  }
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [lw, al] of [[w * 7, 0.12], [w * 3, 0.3], [w, 1]]) {
    c.strokeStyle = rgba(lw === w ? mixc(col, WHITE, 0.7) : col, al * a); c.lineWidth = lw;
    c.beginPath(); c.moveTo(segs[0][0], segs[0][1]); for (const p of segs) c.lineTo(p[0], p[1]); c.stroke();
  }
  for (let b = 0; b < 3; b++) { // branches
    const i = Math.floor(h2(seed, b + 70) * (segs.length - 10)) + 4, p = segs[i];
    const ex = p[0] + (h2(seed, b + 80) - 0.5) * 300, ey = p[1] + 80 + h2(seed, b + 90) * 200;
    c.strokeStyle = rgba(col, 0.5 * a); c.lineWidth = w * 0.8; c.beginPath(); c.moveTo(p[0], p[1]);
    for (let k = 1; k <= 8; k++) { const u = k / 8; c.lineTo(lerp(p[0], ex, u) + (h2(seed + b, k) - 0.5) * 40, lerp(p[1], ey, u)); }
    c.stroke();
  }
  c.restore();
}
function shockRing(c, x, y, r, w, col, a) {
  if (a <= 0.01 || r <= w) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, Math.max(0, r - w), x, y, r + w);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(mixc(col, WHITE, 0.4), a)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r + w, 0, TAU); c.fill();
  c.restore();
}
function mandala(c, x, y, r, t, col, a, text, broken = 0) {
  if (a <= 0.01) return;
  c.save(); c.translate(x, y); c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba(col, a); c.fillStyle = rgba(col, a);
  c.save(); c.rotate(t * 0.25);
  c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
  c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, r * 0.84, 0, TAU); c.stroke();
  c.setLineDash([6, 14]); c.beginPath(); c.arc(0, 0, r * 1.12, 0, TAU); c.stroke(); c.setLineDash([]);
  c.lineWidth = 2;
  for (let i = 0; i < 72; i++) { const an = (i / 72) * TAU; c.beginPath(); c.moveTo(Math.cos(an) * r * 0.86, Math.sin(an) * r * 0.86); c.lineTo(Math.cos(an) * r * (i % 6 ? 0.9 : 0.95), Math.sin(an) * r * (i % 6 ? 0.9 : 0.95)); c.stroke(); }
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * TAU; c.save(); c.rotate(an);
    c.beginPath(); c.moveTo(r * 0.3, 0); c.quadraticCurveTo(r * 0.55, -r * 0.13, r * 0.78, 0); c.quadraticCurveTo(r * 0.55, r * 0.13, r * 0.3, 0); c.stroke();
    c.restore();
  }
  c.restore();
  if (text) {
    c.save(); c.rotate(-t * 0.18);
    c.font = `${Math.round(r * 0.105)}px "Tiro Devanagari Hindi", "Noto Serif Devanagari", serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const words = (text + ' ').repeat(3).trim().split(' ');
    for (let i = 0; i < words.length; i++) {
      const an = (i / words.length) * TAU, br = broken * h2(i, 3);
      c.save(); c.rotate(an); c.translate(0, -r * 0.97 - br * r * 0.8); c.rotate(br * (h2(i, 5) - 0.5) * 3);
      c.globalAlpha = 1 - broken * h2(i, 7) * 1.2 < 0 ? 0 : 1 - broken * h2(i, 7) * 1.2;
      c.fillText(words[i], 0, 0); c.restore();
    }
    c.restore();
  }
  c.restore();
}

/* ---------- serpent (Ashvasena): head at origin facing right, unit scale ---------- */
function spline(pts, n) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]); return out;
}
function serpentShape(c, col, t, ctrl) {
  c.fillStyle = col; c.strokeStyle = col;
  const P = spline(ctrl, 10), n = P.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
    const hood = u < 0.22 ? Math.sin((u / 0.22) * Math.PI) * 0.14 : 0;
    const w = (0.075 + hood) * (u < 0.22 ? 1 : 1 - (u - 0.22) / 0.78 * 0.9);
    L.push([P[i][0] + nx * w, P[i][1] + ny * w]); R.push([P[i][0] - nx * w, P[i][1] - ny * w]);
  }
  c.beginPath(); c.moveTo(L[0][0], L[0][1]);
  for (const p of L) c.lineTo(p[0], p[1]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
  c.closePath(); c.fill();
  c.beginPath(); c.moveTo(-0.1, -0.07); c.bezierCurveTo(0.06, -0.1, 0.18, -0.06, 0.24, 0.0); c.bezierCurveTo(0.18, 0.05, 0.06, 0.07, -0.1, 0.08); c.closePath(); c.fill();
  if (Math.sin(t * 7) > 0.2) { c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.22, 0.01); c.lineTo(0.34, 0.01); c.lineTo(0.38, -0.02); c.moveTo(0.34, 0.01); c.lineTo(0.38, 0.04); c.stroke(); }
}
function serpent(c, t, o) {
  c.save(); c.translate(o.x, o.y); if (o.flip) c.scale(-1, 1); c.rotate(o.rot || 0); c.scale(o.s, o.s);
  const ctrl = o.ctrl || [[0, 0], [-0.06, 0.32], [-0.02, 0.72], [-0.38, 1.0], [-0.9, 0.86], [-1.3, 1.06], [-1.75, 0.96]];
  const pts = ctrl.map((p, i) => [p[0] + Math.sin(t * 1.7 + i) * 0.04 * i * (o.wig ?? 1), p[1] + Math.cos(t * 1.3 + i * 1.7) * 0.03 * i * (o.wig ?? 1)]);
  pts[0] = [0, 0];
  sil(c, (cc, col) => serpentShape(cc, col, t, pts), o.dark, o.rim, 0.012, -0.01, o.glow ?? 30);
  c.save(); c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba(o.rim, 0.22); c.lineWidth = 0.008;
  const P = spline(pts, 10);
  for (let i = 8; i < P.length - 6; i += 2) { const p = P[i]; c.beginPath(); c.arc(p[0], p[1], 0.05, -0.3, Math.PI + 0.3); c.stroke(); }
  glowAt(c, 0.08, -0.03, 0.06, [150, 255, 110], 1); glowAt(c, 0.08, -0.03, 0.02, WHITE, 1);
  c.restore();
  c.restore();
}

/* ---------- finishing ---------- */
function vignette(c, a = 1) { c.globalAlpha = a; c.drawImage(ASSET.vig, 0, 0, W, H); c.globalAlpha = 1; }
function grain(c, T, a = 0.07) {
  c.save(); c.globalAlpha = a; c.globalCompositeOperation = 'overlay';
  c.drawImage(ASSET.grain[Math.floor(T * 24) % 4], 0, 0, W, H); c.restore();
}
function letterbox(c) { c.fillStyle = '#000'; c.fillRect(0, 0, W, LB); c.fillRect(0, H - LB, W, LB); }
function fill(c, col, a) { if (a <= 0.003) return; c.fillStyle = rgba(col, a); c.fillRect(-10, -10, W + 20, H + 20); }
function grade(c, col, a, op = 'soft-light') {
  if (a <= 0.003) return;
  c.save(); c.globalCompositeOperation = op; c.fillStyle = rgba(col, a); c.fillRect(0, 0, W, H); c.restore();
}
