'use strict';
/* दृश्य — shot library. Each shot draws one frame: (ctx, localTime, shot). */

const HZ = 720, GY = 935;
const DUEL = { A: 330, K: 1590, s: 0.62 };
const RIM_A = [255, 236, 200], RIM_K = [255, 160, 70];
const FLAG_A = [236, 118, 28], FLAG_K = [232, 182, 62];
const ARROW_A = [200, 230, 255], ARROW_K = [255, 160, 60];
let FRAME_T = 0; // absolute film time of the frame being drawn (set by the player)

function cam(c, x, y, z, rot = 0) { c.translate(W / 2, H / 2); c.scale(z, z); c.rotate(rot); c.translate(-x, -y); }
function shake(lt, amp, seed = 0, f = 24) { return [vnoise(lt * f + seed) * amp, vnoise(lt * f + 50 + seed) * amp]; }
const lightOf = (p) => ({ light: p.sun, shadow: p.mid, haze: [p.haze, 0.1] });

// how far the speaker's mouth is open right now, from the recorded voice's loudness
function mouthOf(who) {
  if (typeof TL === 'undefined') return 0;
  for (const cue of TL.cues) {
    if (cue.t > FRAME_T) break;
    if (cue.who !== who || FRAME_T >= cue.t + cue.d) continue;
    const v = typeof VOICES !== 'undefined' && VOICES[cue.key];
    if (!v) return 0.35 + 0.35 * Math.sin(FRAME_T * 17);
    const i = Math.floor((FRAME_T - cue.t) / 0.04);
    return i >= 0 && i < v.e.length ? +v.e[i] / 9 : 0;
  }
  return 0;
}

// a standing figure: rim light toward the sun, then painted and shaded as one layer
function person(c, who, x, y, sc, flip, opts, p, rot = 0, rim) {
  c.save(); c.translate(x, y); c.scale(flip ? -sc : sc, sc); c.rotate(rot);
  c.save(); c.translate(-2.5, -1.5); figure(c, flat(rim || p.rim), opts); c.restore();
  withLayer(c, (lc) => {
    figure(lc, LOOK[who], opts);
    const g = lc.createLinearGradient(0, -260, 0, 0);
    g.addColorStop(0, rgba(p.sun, 0.06)); g.addColorStop(1, rgba(BLACK, 0.35));
    shadeAtop(lc, g, -200, -400, 400, 420);
    shadeAtop(lc, rgba(p.haze, 0.1), -200, -400, 400, 420);
  });
  c.restore();
}

// standard battlefield background
function field(c, p, lt, o = {}) {
  const hz = o.hz ?? HZ, sx = o.sx ?? 980, sy = o.sy ?? 540, sr = o.sr ?? 60, sa = o.sa ?? 1, scroll = o.scroll ?? 0;
  drawSky(c, p, hz);
  if (o.stars) drawStars(c, o.stars);
  if (o.sun !== false) { drawSun(c, sx, sy, sr, p, sa); drawRays(c, sx, sy, lt, p, (o.ra ?? 0.08) * sa); }
  drawClouds(c, lt, { n: o.cn ?? 7, y0: o.cy0 ?? 150, y1: o.cy1 ?? hz - 230, sp: o.csp ?? 9, a: o.ca ?? 0.5, col: o.ccol ?? mixc(p.glow, p.mid, 0.55), scroll });
  ridge(c, hz + 2, o.ridgeAmp ?? 60, 0.0016, 3, mixc(p.far, p.haze, 0.25), scroll * 0.05, 1);
  armies(c, hz, p, scroll, o.armyA ?? 1);
  hazeBand(c, hz, p, o.haze ?? 0.55);
  drawGround(c, hz, p);
  debris(c, hz, p, scroll, o.debris ?? 1);
}

// both chariots facing each other across the field
function duel(c, lt, p, o = {}) {
  const ax = DUEL.A + (o.aDx || 0), kx = DUEL.K + (o.kDx || 0), L = lightOf(p);
  chariot(c, Object.assign({
    x: ax, y: GY, s: DUEL.s, dir: 1, t: lt, ph: o.aPh ?? lt * 0.3, wheel: o.aWheel || 0, kneel: o.aKneel || 0, sink: o.aSink || 0,
    who: 'A', driverWho: 'KR', rim: mixc(p.rim, RIM_A, 0.5), rimOff: [3, -2],
    warrior: { crown: o.aCrown === false ? null : 'kirita', draw: o.aDraw ?? 0, lean: o.aLean || 0, bowDrop: o.aBowDrop || 0 },
    driver: { crown: 'mukut' }, flag: 'hanuman', flagCol: FLAG_A, flagWind: o.wind ?? 1,
  }, L));
  chariot(c, Object.assign({
    x: kx, y: GY, s: DUEL.s, dir: -1, t: lt + 3, ph: o.kPh ?? lt * 0.3 + 0.4, wheel: o.kWheel || 0, tilt: o.kTilt || 0, sink: o.kSink || 0,
    who: 'K', driverWho: 'S', rim: mixc(p.rim, RIM_K, 0.5), rimOff: [-3, -2], noWarrior: o.kGround,
    warrior: { crown: 'karna', draw: o.kDraw ?? 0, lean: o.kLean || 0 },
    driver: { crown: 'turban', beard: true }, flag: 'rope', flagCol: FLAG_K, flagFall: o.kFlagFall || 0, flagWind: o.wind ?? 1,
  }, L));
}
const BOW_A = (dx = 0) => [DUEL.A + dx + 35, 729];
const BOW_K = (dx = 0) => [DUEL.K + dx - 35, 729];

function arcPos(a, b, u, h) { return [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - Math.sin(Math.PI * u) * h]; }
// a volley of arrows with glowing trails; clash=true meets midway with sparks
function volley(c, lt, v) {
  const seed = v.seed || 0, n = v.n;
  for (let k = 0; k < n; k++) {
    const ts = lerp(v.t0, v.t1, (k + hash(k + seed) * 0.9) / n), age = lt - ts;
    if (age < 0) continue;
    const ft = v.ft * (0.85 + hash(k + seed + 2) * 0.3), stop = v.clash ? 0.46 + hash(k + seed + 3) * 0.08 : 1;
    const b = [v.b[0] + (hash(k + seed + 5) - 0.5) * (v.spread ?? 80), v.b[1] + (hash(k + seed + 6) - 0.5) * (v.spreadY ?? 50)];
    const h = v.arc * (0.5 + hash(k + seed + 7));
    if (age <= ft * stop) {
      const u = age / ft, p0 = arcPos(v.a, b, u, h), p1 = arcPos(v.a, b, Math.min(1, u + 0.02), h);
      const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      const g = c.createLinearGradient(p0[0], p0[1], p0[0] - Math.cos(ang) * 170, p0[1] - Math.sin(ang) * 170);
      g.addColorStop(0, rgba(v.glow, 0.85)); g.addColorStop(1, rgba(v.glow, 0));
      c.strokeStyle = g; c.lineWidth = 5; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0] - Math.cos(ang) * 170, p0[1] - Math.sin(ang) * 170); c.stroke();
      glowAt(c, p0[0], p0[1], 26, v.glow, 0.8);
      c.restore();
      arrowShape(c, p0[0], p0[1], ang, v.len ?? 62, rgba(v.col || [60, 40, 30]), v.w ?? 3.4);
    } else if (age < ft * stop + 0.6) {
      const p0 = arcPos(v.a, b, stop, h);
      sparks(c, p0[0], p0[1], age - ft * stop, 16, v.spark || v.glow, k + seed, 420, 0.55);
    }
  }
}

/* ---------- shots ---------- */
const SHOT = {};

SHOT.void = (c, lt, s) => {
  fill(c, BLACK, 1);
  const k = ss(0, s.dur, lt);
  glowAt(c, W / 2, H + 120, 1200, [170, 50, 18], 0.25 + k * 0.45);
  drawClouds(c, lt, { n: 6, y0: 300, y1: 760, sp: 7, a: 0.1 + k * 0.08, col: [90, 40, 30], seed: 9 });
  const p = PAL.ember;
  c.fillStyle = rgba(p.sil); c.fillRect(-10, 868, W + 20, H);
  debris(c, 862, p, -lt * 6, 1.1);
  embers(c, lt, 70, [255, 120, 40], { rise: 900, a: 0.5 + k * 0.5 });
  const ta = bump(0.4, 5.2, lt);
  if (ta > 0.01) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '72px "Tiro Devanagari Hindi", "Noto Serif Devanagari", serif';
    c.fillStyle = rgba([240, 210, 160], ta * 0.9); c.fillText('महाभारत', W / 2, 470);
    c.font = '30px "Mukta", sans-serif'; c.fillStyle = rgba([200, 160, 120], ta * 0.75); c.fillText('कर्ण पर्व', W / 2, 545);
    c.restore();
  }
};

function vulture(c, x, y, s, t, i) {
  const f = Math.sin(t * 5 + i * 2) * 0.5;
  c.save(); c.translate(x, y); c.scale(s, s); c.lineCap = 'round';
  c.beginPath(); c.moveTo(-34, -6 - f * 18); c.quadraticCurveTo(-16, -8 - f * 6, 0, 0); c.quadraticCurveTo(16, -8 - f * 6, 34, -6 - f * 18);
  c.quadraticCurveTo(16, -2, 0, 4); c.quadraticCurveTo(-16, -2, -34, -6 - f * 18); c.fill();
  c.restore();
}
SHOT.dawn = (c, lt, s) => {
  const u = lt / s.dur, p = palMix(PAL.night, PAL.dawn, 0.35 + ss(0, 0.75, u) * 0.65);
  c.save(); cam(c, 960, 560, 1 + u * 0.07);
  const sy = lerp(800, 600, easeOut(u));
  field(c, p, lt, { sx: 960, sy, sr: 70, sa: ss(0, 0.25, u), ra: 0.12, cn: 7, ca: 0.6, hz: 720 });
  c.fillStyle = rgba(p.sil);
  for (let i = 0; i < 7; i++) {
    const a = lt * (0.18 + hash(i) * 0.1) + i * 0.9, r = 160 + hash(i + 3) * 220;
    vulture(c, 960 + Math.cos(a) * r * 1.6, 300 + Math.sin(a) * r * 0.35, 0.6 + hash(i + 7) * 0.4, lt, i);
  }
  for (const [t0, x] of [[1.2, 330], [5.2, 520]]) glowAt(c, x, 700, 520, p.sun, bump(t0, t0 + 3.8, lt) * 0.35);
  c.restore();
  motes(c, lt, 60, mixc(p.sun, p.glow, 0.5), 0.35);
};

SHOT.title = (c, lt, s) => {
  const p = PAL.battle;
  c.save(); cam(c, 960, 560, 1.04 - lt * 0.004);
  field(c, p, lt, { sx: 960, sy: 700, sr: 120, ra: 0.18, ca: 0.55, debris: 0.7 });
  c.restore();
  embers(c, lt, 90, [255, 140, 50], { rise: 1000, a: 0.9 });
  const a = ss(0.3, 1.7, lt) * (1 - ss(s.dur - 0.9, s.dur, lt)), a2 = ss(1.6, 2.8, lt) * (1 - ss(s.dur - 0.9, s.dur, lt));
  c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.translate(960, 430); const sc = 1.1 - 0.1 * easeOut(ss(0, 3.5, lt)); c.scale(sc, sc);
  c.font = '30px "Mukta", sans-serif'; c.fillStyle = rgba([255, 214, 160], a2 * 0.85); c.fillText('महाभारत  ·  कर्ण पर्व', 0, -175);
  const g = c.createLinearGradient(0, -110, 0, 110);
  g.addColorStop(0, rgba([255, 247, 214], a)); g.addColorStop(0.45, rgba([244, 186, 82], a)); g.addColorStop(1, rgba([150, 72, 22], a));
  c.font = '196px "Rozha One", "Tiro Devanagari Hindi", serif';
  c.shadowColor = rgba([255, 120, 30], 0.85 * a); c.shadowBlur = 50 * VIEW.scale;
  c.fillStyle = g; c.fillText('कर्ण अर्जुन युद्ध', 0, 0);
  c.shadowBlur = 0; c.lineWidth = 2; c.strokeStyle = rgba([255, 236, 190], a * 0.5); c.strokeText('कर्ण अर्जुन युद्ध', 0, 0);
  c.font = '46px "Tiro Devanagari Hindi", serif'; c.shadowColor = rgba(BLACK, 0.9 * a2); c.shadowBlur = 14 * VIEW.scale;
  c.fillStyle = rgba([255, 234, 200], a2); c.fillText('सूर्यपुत्र और इन्द्रपुत्र का महासंग्राम', 0, 150);
  c.restore();
};

SHOT.run = (c, lt, s) => {
  const isA = s.who === 'A', dir = isA ? 1 : -1;
  const p = isA ? palMix(PAL.battle, PAL.day, 0.3) : palMix(PAL.battle, PAL.fire, 0.2);
  const scroll = lt * 950 * dir, bob = Math.sin(lt * 15) * 2.5;
  c.save(); c.translate(0, bob * 0.4);
  field(c, p, lt, { scroll, sx: isA ? 1500 : 420, sy: 430, sr: 62, ca: 0.5, debris: 1.2 });
  const cx = isA ? 690 : 1230, cy = 945 + bob;
  for (let j = 0; j < 30; j++) { // dust kicked up by the wheels
    const tb = Math.floor(lt / 0.07) - j, age = lt - tb * 0.07;
    const x = cx + (-30 - age * 520) * dir + (hash(tb) - 0.5) * 40, y = cy - 30 - age * 90 - hash(tb + 3) * 30, r = 40 + age * 160;
    glowAt(c, x, y, r, mixc(p.haze, p.glow, 0.2), 0.24 * (1 - age / 2.1));
  }
  chariot(c, Object.assign({
    x: cx, y: cy, s: 0.95, dir, t: lt, ph: lt * 2.4, wheel: lt * 7, who: s.who, driverWho: isA ? 'KR' : 'S', rim: isA ? RIM_A : RIM_K, rimOff: [isA ? 3 : -3, -2],
    warrior: { crown: isA ? 'kirita' : 'karna', draw: 0.15 }, driver: { crown: isA ? 'mukut' : 'turban', beard: !isA },
    flag: isA ? 'hanuman' : 'rope', flagCol: isA ? FLAG_A : FLAG_K, flagWind: 1.7,
  }, lightOf(p)));
  groundDust(c, lt, p, HZ, 0.3, scroll);
  c.restore();
  motes(c, lt, 40, p.glow, 0.3, 4);
};

// close-up portrait
const BUST = {
  K: { x: 1240, flip: true, rim: [255, 170, 80] },
  S: { x: 1240, flip: true, rim: [255, 214, 160] },
  A: { x: 680, flip: false, rim: [255, 240, 210] },
  KR: { x: 680, flip: false, rim: [150, 255, 232] },
};
function bustBackdrop(c, lt, p, sun, seed) {
  drawSky(c, p, H * 0.92);
  drawClouds(c, lt, { n: 6, y0: 120, y1: 640, sp: 10, a: 0.35, col: mixc(p.glow, p.mid, 0.6) });
  if (sun) { drawSun(c, sun[0], sun[1], sun[2], p, 1); drawRays(c, sun[0], sun[1], lt, p, 0.07); }
  armies(c, 900, p, lt * 8, 0.8, 0.9);
  hazeBand(c, 900, p, 0.65);
  c.fillStyle = rgba(p.g2); c.fillRect(-10, 900, W + 20, 300);
  bokeh(c, lt, 14, mixc(p.glow, p.sun, 0.3), 0.18, seed);
}
SHOT.bust = (c, lt, s) => {
  const who = s.who, mood = s.mood || '', b = BUST[who];
  let p, sun = null, rim = b.rim, tilt = 0, hy = 590, emberN = 20, ember = [255, 150, 60], sh = [0, 0];
  if (who === 'K') {
    p = PAL.battle; sun = [b.x - 70, hy - 160, 230];
    if (mood === 'angry') { p = palMix(PAL.battle, PAL.fire, 0.65); emberN = 70; sh = shake(lt, 3); }
    if (mood === 'resolve') { p = palMix(PAL.battle, PAL.venom, 0.35); sun = [b.x - 70, hy - 160, 200]; }
    if (mood === 'shame') { p = PAL.late; tilt = 0.06 + ss(0.5, 3, lt) * 0.14; sun = [b.x - 300, hy - 60, 170]; }
    if (mood === 'sun') { p = PAL.dusk; tilt = -0.2; sun = [430, 300, 190]; rim = [255, 200, 120]; emberN = 0; }
  } else if (who === 'S') { p = palMix(PAL.battle, PAL.sepia, 0.35); sun = [1700, 260, 70]; }
  else if (who === 'A') { p = palMix(PAL.day, PAL.battle, 0.25); sun = [1520, 300, 80]; emberN = 10; }
  else {
    p = PAL.peacock; sun = [1450, 360, 70]; ember = [120, 255, 220]; emberN = 14;
    if (mood === 'fierce') { p = palMix(PAL.peacock, PAL.dusk, 0.35 + ss(0, s.dur, lt) * 0.3); sh = shake(lt, 1.5); emberN = 40; ember = [255, 170, 80]; }
    if (mood === 'urgent') { p = palMix(PAL.peacock, PAL.battle, 0.55); emberN = 40; ember = [255, 150, 60]; }
    if (mood === 'smile') p = palMix(PAL.peacock, PAL.day, 0.25);
  }
  c.save(); c.translate(sh[0], sh[1]);
  bustBackdrop(c, lt, p, sun, who.length * 7);
  const z = 1 + lt * 0.006, breathe = Math.sin(lt * 1.6) * 4;
  bust(c, who, { x: b.x, y: hy + breathe, s: 330 * z, flip: b.flip, t: lt, tilt, mood, mouth: mouthOf(who), rim, glow: 30, light: p.sun, dark: mixc(p.mid, BLACK, 0.5), tint: [p.mid, 0.08] });
  if (emberN) embers(c, lt, emberN, ember, { rise: 900, a: 0.8, seed: who.length });
  c.restore();
  motes(c, lt, 35, mixc(p.sun, p.glow, 0.4), 0.3);
};

// close-up with the bow: drawn while the mantra builds, released at the end
SHOT.invoke = (c, lt, s) => {
  const ast = ASTRA[s.astra], col = ast.col, isK = s.who === 'K', fail = !!s.fail;
  const hx = isK ? 1270 : 650, hy = 590, sc = 285 * (1 + lt * 0.012), dirx = isK ? -1 : 1;
  const rel = fail ? 1e9 : s.dur - 0.75, r = lt - rel;
  const power = ss(0.1, Math.min(rel, 3), lt), broken = fail ? ss(2.4, 4.4, lt) : 0, life = 1 - broken * 0.85;
  const draw = fail ? easeOut(ss(0, 1, lt)) * (1 - broken * 0.6) : easeOut(ss(0.1, Math.min(rel - 0.2, 2.2), lt));
  const p = palMix(PAL.night, isK ? PAL.battle : PAL.day, 0.25);
  const kick = r > 0 ? shake(lt, 14 * Math.exp(-r * 7), 3) : [0, 0];
  c.save(); c.translate(kick[0], kick[1]);
  drawSky(c, p, H);
  glowAt(c, hx, hy, 1100, col, (0.18 + power * 0.32) * life);
  bokeh(c, lt, 18, col, 0.16 * life, 11);
  mandala(c, hx, hy, 370 + power * 40, lt, col, (0.15 + power * 0.55) * life * (fail ? 0.8 + 0.2 * Math.sin(lt * 40) : 1) * (r > 0 ? Math.max(0, 1 - r * 2) : 1), ast.mantra, broken);
  const handX = lerp(0.98, 0.33, draw), tipX = hx + dirx * (handX + 1.3) * sc, tipY = hy + 0.19 * sc;
  if (r < 0) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) { // energy converging on the arrowhead
      const ph = (lt * 0.7 + hash(i)) % 1, a = hash(i + 20) * TAU + lt * 0.8, rr = (1 - ph) * 420;
      glowAt(c, tipX + Math.cos(a) * rr, tipY + Math.sin(a) * rr * 0.6, 14, col, ph * power * life * 0.9);
    }
    c.restore();
  }
  bust(c, s.who, { x: hx, y: hy, s: sc, flip: isK, t: lt, mood: 'fierce', mouth: mouthOf(s.who), rim: mixc(col, WHITE, 0.35), glow: 34, light: mixc(col, WHITE, 0.5), dark: [10, 6, 8], bow: { len: 1.3, draw, rel: r >= 0 ? r : -1 } });
  c.save(); c.globalCompositeOperation = 'lighter';
  if (r < 0) {
    const flick = fail ? Math.max(0, 1 - broken * 1.4) * (0.6 + 0.4 * Math.sin(lt * 31)) : 1;
    glowAt(c, tipX, tipY, 220 * (0.5 + power), col, 0.85 * power * flick);
    glowAt(c, tipX, tipY, 60, WHITE, 0.9 * power * flick);
  } else { // released: the astra leaves the bow
    const x = hx + dirx * (1.63 * sc + r * 5200);
    astraBolt(c, x, tipY, isK ? Math.PI : 0, col, 2.2, 900);
    glowAt(c, hx + dirx * 1.05 * sc, hy + 0.26 * sc, 500, col, Math.max(0, 1 - r * 3));
    shockRing(c, hx + dirx * 1.6 * sc, tipY, 40 + r * 900, 40, col, Math.max(0, 0.8 - r * 1.6));
  }
  c.restore();
  if (s.astra === 'anjalika' && r < 0) {
    c.save(); c.translate(tipX, tipY); c.scale(dirx * 1.6, 1.6); c.fillStyle = rgba([255, 236, 170], power);
    c.beginPath(); c.moveTo(30, -26); c.quadraticCurveTo(-14, -18, -8, 0); c.quadraticCurveTo(-14, 18, 30, 26); c.quadraticCurveTo(4, 14, 4, 0); c.quadraticCurveTo(4, -14, 30, -26); c.fill();
    c.restore();
  }
  c.restore();
  if (fail) grade(c, [120, 20, 20], broken * 0.5, 'multiply');
  else fill(c, mixc(col, WHITE, 0.6), ss(s.dur - 0.25, s.dur, lt) * 0.7);
};

// medium close-up of an archer drawing and loosing a single arrow
SHOT.shoot = (c, lt, s) => {
  const who = s.who, isK = who === 'K', col = s.col || (isK ? ARROW_K : ARROW_A);
  const rel = s.rel ?? s.dur - 0.9, r = lt - rel;
  const p = s.pal ? PAL[s.pal] : isK ? PAL.battle : palMix(PAL.day, PAL.battle, 0.3);
  const hx = isK ? 1330 : 590, hy = 610, sc = 275 * (1 + lt * 0.012), dirx = isK ? -1 : 1;
  const kick = r > 0 ? shake(lt, 12 * Math.exp(-r * 6), 3) : [0, 0];
  const draw = easeOut(ss(0.15, rel - 0.2, lt));
  c.save(); c.translate(kick[0], kick[1]);
  bustBackdrop(c, lt, p, [isK ? 520 : 1400, 330, 80], 5);
  bust(c, who, { x: hx, y: hy, s: sc, flip: isK, t: lt, mood: 'fierce', rim: isK ? RIM_K : RIM_A, glow: 26, light: p.sun, dark: mixc(p.mid, BLACK, 0.5), bow: { len: 1.3, draw, rel: r >= 0 ? r : -1 } });
  const handX = lerp(0.98, 0.33, draw), tipX = hx + dirx * (handX + 1.3) * sc, tipY = hy + 0.19 * sc;
  c.save(); c.globalCompositeOperation = 'lighter';
  if (r < 0) glowAt(c, tipX, tipY, 90, col, draw * 0.7);
  else {
    const x = hx + dirx * (1.63 * sc + r * 4600);
    astraBolt(c, x, tipY, isK ? Math.PI : 0, col, 1.5, 700);
    glowAt(c, hx + dirx * 1.05 * sc, hy + 0.26 * sc, 300, col, Math.max(0, 1 - r * 4));
    shockRing(c, hx + dirx * 1.5 * sc, tipY, 30 + r * 700, 30, col, Math.max(0, 0.7 - r * 1.8));
  }
  c.restore();
  if (r >= 0) arrowShape(c, hx + dirx * (1.63 * sc + r * 4600), tipY, isK ? Math.PI : 0, 260, '#3a2a1e', 7);
  c.restore();
  motes(c, lt, 30, mixc(p.sun, p.glow, 0.4), 0.3);
};

// the arrow arrives: sparks, splinters, and the target thrown back
function splinters(c, x, y, e, n, col, seed, dir = 1) {
  if (e < 0 || e > 1.4) return;
  c.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash(i + seed) - 0.5) * 2.4, v = 400 + hash(i + seed + 3) * 700;
    const px = x + Math.cos(a) * v * e * dir * 0.8, py = y + Math.sin(a) * v * e + 1100 * e * e;
    c.save(); c.translate(px, py); c.rotate(e * 14 * (hash(i) - 0.5)); c.fillRect(-9, -2.5, 18, 5); c.restore();
  }
}
SHOT.hit = (c, lt, s) => {
  const tgt = s.target, imp = s.at ?? 0.55, e = lt - imp;
  const p = s.pal ? PAL[s.pal] : PAL.battle;
  const sh = shake(lt, 16 * bump(imp - 0.02, imp + 0.6, lt));
  c.save(); c.translate(sh[0], sh[1]);
  if (tgt === 'K' || tgt === 'A') {
    const isK = tgt === 'K', dir = isK ? -1 : 1, col = isK ? ARROW_A : ARROW_K, push = (s.push ?? 120) * easeOut(ss(imp, imp + 1.1, lt)) * -dir;
    const sc = 1.3, cx = (isK ? 1180 : 740) + push, cy = 990;
    field(c, p, lt, { sx: isK ? 560 : 1400, sy: 420, sr: 70, hz: 690 });
    chariot(c, Object.assign({
      x: cx, y: cy, s: sc, dir, t: lt, ph: 0.2 + push * 0.004, wheel: push / (120 * sc) * dir, who: tgt, driverWho: isK ? 'S' : 'KR',
      rim: isK ? RIM_K : RIM_A, rimOff: [-3 * dir, -2], warrior: { crown: isK ? 'karna' : 'kirita', draw: 0.3, lean: -0.12 * bump(imp, imp + 1.2, lt) },
      driver: { crown: isK ? 'turban' : 'mukut', beard: isK }, flag: isK ? 'rope' : 'hanuman', flagCol: isK ? FLAG_K : FLAG_A,
    }, lightOf(p)));
    const ix = cx + dir * -20 * sc, iy = cy - 190 * sc;
    for (let i = 0; i < 8; i++) { const d2 = e - i * 0.08; if (d2 > 0 && d2 < 2.4) glowAt(c, cx - dir * (i * 40 - 60), cy - 30 - d2 * 40, 120 + d2 * 120, mixc(p.haze, p.glow, 0.25), (1 - d2 / 2.4) * 0.5); }
    if (e < 0) { // incoming
      const u = ss(imp - 0.4, imp, lt), x = lerp(isK ? -200 : W + 200, ix, u);
      astraBolt(c, x, iy, isK ? 0 : Math.PI, col, 1.3, 520);
      arrowShape(c, x, iy, isK ? 0 : Math.PI, 240, '#3a2a1e', 6);
    } else { // embedded, still quivering
      c.save(); c.translate(ix, iy); c.rotate((isK ? 0 : Math.PI) + Math.sin(e * 60) * 0.05 * Math.exp(-e * 4));
      arrowShape(c, 0, 0, 0, 170, '#3a2a1e', 6); c.restore();
      c.save(); c.globalCompositeOperation = 'lighter';
      glowAt(c, ix, iy, 700, col, Math.max(0, 1 - e * 2.5));
      sparks(c, ix, iy, e, 70, [255, 220, 150], 9, 1000, 0.9);
      c.restore();
      splinters(c, ix, iy, e, 22, '#6b2c1b', 4, -dir);
    }
    groundDust(c, lt, p, 690, 0.25);
  } else if (tgt === 'armorA') {
    const pp = palMix(PAL.late, PAL.day, 0.3), col = ARROW_K;
    bustBackdrop(c, lt, pp, [1500, 300, 80], 3);
    const recoil = bump(imp, imp + 1.6, lt);
    bust(c, 'A', { x: 640 - recoil * 40, y: 480, s: 330, t: lt, tilt: -0.16 * recoil, mood: 'angry', rim: RIM_A, glow: 26, light: pp.sun, dark: mixc(pp.mid, BLACK, 0.5) });
    const ix = 640 + 0.62 * 330 - recoil * 40, iy = 480 + 1.08 * 330;
    if (e < 0) { const x = lerp(W + 200, ix, ss(imp - 0.35, imp, lt)); astraBolt(c, x, iy - 20, Math.PI + 0.06, col, 1.3, 520); arrowShape(c, x, iy - 20, Math.PI + 0.06, 240, '#3a2a1e', 6); }
    else {
      c.save(); c.translate(ix + e * 500, iy - e * 700 + 900 * e * e); c.rotate(Math.PI + e * 9); arrowShape(c, 0, 0, 0, 200, '#3a2a1e', 6); c.restore(); // glances off the armour
      c.save(); c.globalCompositeOperation = 'lighter'; glowAt(c, ix, iy, 600, col, Math.max(0, 1 - e * 2.5)); sparks(c, ix, iy, e, 80, [255, 220, 150], 2, 1100, 0.9); c.restore();
    }
  } else if (tgt === 'flag') {
    const pp = PAL.late, col = ARROW_A, fall = easeIn(ss(imp, imp + 1.8, lt)), px = 1080, cutY = 600;
    field(c, pp, lt, { sx: 560, sy: 520, sr: 80, hz: 820 });
    c.strokeStyle = '#3d190f'; c.lineCap = 'round'; c.lineWidth = 26;
    c.beginPath(); c.moveTo(px, H + 40); c.lineTo(px, cutY); c.stroke();
    c.save(); c.translate(px, cutY); c.rotate(fall * 1.25); c.translate(fall * 120, fall * fall * 950);
    c.strokeStyle = '#3d190f'; c.lineWidth = 24; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -470); c.stroke();
    c.fillStyle = '#d9a441'; c.beginPath(); c.arc(0, -478, 18, 0, TAU); c.fill();
    flagCloth(c, 0, -460, 560, 330, lt, FLAG_K, 'rope', 1.4 - fall);
    c.restore();
    if (e < 0) { const x = lerp(-200, px, ss(imp - 0.35, imp, lt)); astraBolt(c, x, cutY, 0, col, 1.3, 520); arrowShape(c, x, cutY, 0, 240, '#3a2a1e', 6); }
    else { c.save(); c.globalCompositeOperation = 'lighter'; glowAt(c, px, cutY, 600, col, Math.max(0, 1 - e * 2.5)); sparks(c, px, cutY, e, 60, [255, 220, 150], 6, 900, 0.9); c.restore(); splinters(c, px, cutY, e, 26, '#5a2a14', 8, 1); }
  }
  c.restore();
};

// ----- astra spectacles -----
const FIRES = Array.from({ length: 24 }, (_, i) => ({ x: 860 + i * 46 + (hash(i + 4) - 0.5) * 30, y: HZ + 30 + hash(i + 8) * 230, h: 60 + hash(i) * 120, w: 26 + hash(i + 2) * 30, t0: 1.1 + hash(i + 6) * 2.5 }));
function drawFires(c, lt, k, scaleH = 1) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < FIRES.length; i++) {
    const f = FIRES[i], grow = ss(f.t0, f.t0 + 0.8, lt) * k;
    if (grow <= 0.02) continue;
    const d = (f.y - HZ) / 300 + 0.4;
    flame(c, f.x, f.y, f.h * grow * d * scaleH, f.w * d, lt, i);
    flame(c, f.x + 14 * d, f.y, f.h * 0.6 * grow * d * scaleH, f.w * 0.7 * d, lt + 1.3, i + 40);
    glowAt(c, f.x, f.y - f.h * 0.3 * d, 140 * d, [255, 110, 30], 0.25 * grow);
  }
  c.restore();
}
function rain(c, lt, a, slant = 0.25) {
  if (a <= 0.01) return;
  c.save(); c.strokeStyle = rgba([190, 220, 255], 0.35 * a); c.lineWidth = 1.6; c.beginPath();
  for (let i = 0; i < 260; i++) {
    const sp = 1700 + hash(i) * 600, y = ((hash(i + 3) * (H + 200) + lt * sp) % (H + 200)) - 100, x = hash(i + 7) * (W + 400) - 200 + y * slant;
    c.moveTo(x, y); c.lineTo(x - 40 * slant, y - 46);
  }
  c.stroke(); c.restore();
}
function vajra(c, x, y, s, col, a) {
  if (a <= 0.01) return;
  c.save(); c.translate(x, y); c.scale(s, s); c.globalCompositeOperation = 'lighter';
  glowAt(c, 0, 0, 260, col, a * 0.6);
  c.strokeStyle = rgba(mixc(col, WHITE, 0.5), a); c.fillStyle = rgba(mixc(col, WHITE, 0.6), a); c.lineWidth = 9; c.lineCap = 'round';
  c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill();
  for (const e of [-1, 1]) {
    c.beginPath(); c.moveTo(0, e * 24); c.lineTo(0, e * 170); c.stroke();
    c.beginPath(); c.ellipse(0, e * 48, 26, 8, 0, 0, TAU); c.stroke();
    for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(0, e * 56); c.bezierCurveTo(sd * 70, e * 70, sd * 64, e * 140, 0, e * 168); c.stroke(); }
  }
  c.restore();
}
function parashu(c, x, y, s, rot, col, a) {
  if (a <= 0.01) return;
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s); c.globalCompositeOperation = 'lighter';
  glowAt(c, 30, -60, 330, col, a * 0.55);
  c.strokeStyle = rgba(mixc(col, WHITE, 0.5), a); c.lineWidth = 12; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, 190); c.lineTo(0, -150); c.stroke();
  const g = c.createLinearGradient(0, -230, 150, -60); g.addColorStop(0, rgba(WHITE, a)); g.addColorStop(1, rgba(col, a * 0.6));
  c.fillStyle = g; c.beginPath(); c.moveTo(-8, -160); c.quadraticCurveTo(80, -250, 160, -140); c.quadraticCurveTo(110, -110, 108, -40); c.quadraticCurveTo(60, -90, -8, -80); c.closePath(); c.fill();
  c.restore();
}

SHOT.astra = (c, lt, s) => {
  const kind = s.kind, col = ASTRA[kind].col;
  let p, sh = [0, 0], sa = 1, o = {};
  if (kind === 'agni') { const k = ss(0.7, 1.7, lt); p = palMix(PAL.battle, PAL.fire, k); sa = 1 - k * 0.5; sh = shake(lt, 5 * k * (0.5 + 0.5 * Math.sin(lt * 3))); }
  else if (kind === 'varuna') { const k = ss(0.6, 2, lt); p = palMix(PAL.fire, PAL.storm, k); sa = 1 - k; }
  else if (kind === 'vayu') { const k = ss(1, 5, lt); p = palMix(PAL.storm, PAL.battle, k); sa = k; o.wind = 1 + 2 * bump(0.6, 7, lt); sh = shake(lt, 3 * bump(0.6, 6, lt)); }
  else if (kind === 'indra') { const k = ss(0.6, 1.4, lt); p = palMix(PAL.battle, PAL.indra, k); sa = 1 - k * 0.7; sh = shake(lt, 4 * k); }
  else { const k = ss(0.8, 1.8, lt); p = palMix(PAL.indra, PAL.bhargava, k); sa = 0.4; sh = shake(lt, 7 * ss(1.4, 2, lt) * (1 - ss(6, 8, lt))); }
  c.save(); c.translate(sh[0], sh[1]);
  field(c, p, lt, { sx: 980, sy: 520, sr: 58, sa, ca: 0.5 });
  const A = BOW_A(), K = BOW_K();

  if (kind === 'varuna' || kind === 'vayu' || kind === 'indra') { // storm cover
    const dk = kind === 'varuna' ? ss(0.7, 2.2, lt) : kind === 'vayu' ? 1 - ss(1, 4.5, lt) : ss(0.6, 1.6, lt) * 0.8;
    const sc = kind === 'vayu' ? lt * lt * 160 : 0;
    drawClouds(c, lt, { n: 12, y0: -40, y1: 380, sp: 14, a: 0.95 * dk, col: kind === 'indra' ? [40, 30, 80] : [24, 34, 46], sc: 2, scroll: -sc, seed: 50 });
    drawClouds(c, lt, { n: 8, y0: 60, y1: 300, sp: 20, a: 0.6 * dk, col: kind === 'indra' ? [90, 70, 150] : [60, 80, 100], sc: 1.6, scroll: -sc * 1.3, seed: 80 });
  }
  if (kind === 'agni') drawFires(c, lt, 1, 0.7);
  if (kind === 'varuna') drawFires(c, lt + 4, 1 - ss(1.5, 4.5, lt), 0.8);

  duel(c, lt, p, { aDraw: kind === 'agni' || kind === 'vayu' || kind === 'indra' ? 1 - ss(0.1, 0.25, lt) : 0.2, kDraw: kind === 'varuna' || kind === 'bhargava' ? 1 - ss(0.1, 0.25, lt) : 0.2, wind: o.wind });

  const src = kind === 'varuna' || kind === 'bhargava' ? K : A;
  const sky = kind === 'vayu' ? [1300, 260] : kind === 'agni' ? [1150, 210] : kind === 'varuna' ? [820, 200] : kind === 'indra' ? [1000, 180] : [1180, 300];
  if (lt > 0.05 && lt < 0.9) {
    const u = easeIn(ss(0.05, 0.85, lt)), q = arcPos(src, sky, u, 120), q2 = arcPos(src, sky, Math.max(0, u - 0.04), 120);
    astraBolt(c, q[0], q[1], Math.atan2(q[1] - q2[1], q[0] - q2[0]), col, 1.9, 420);
  }
  const burst = bump(0.8, 1.6, lt);
  if (burst > 0) { shockRing(c, sky[0], sky[1], (lt - 0.8) * 1500, 90, col, burst); glowAt(c, sky[0], sky[1], 800, col, burst * 0.9); }

  if (kind === 'agni') {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const ts = 1 + hash(i + 3) * (s.dur - 2), age = lt - ts, ft = 0.9 + hash(i) * 0.4;
      const x0 = 500 + hash(i + 9) * 1500, x1 = x0 + 260 + hash(i + 1) * 120, y1 = HZ + 30 + hash(i + 5) * 220;
      if (age > 0 && age < ft) { const u = age / ft, x = lerp(x0, x1, u), y = lerp(-80, y1, u * u); astraBolt(c, x, y, Math.atan2(y1 + 80, x1 - x0), [255, 120, 30], 0.7, 240); }
      else if (age >= ft && age < ft + 0.6) { const k = (age - ft) / 0.6; glowAt(c, x1, y1, 180 + k * 140, [255, 140, 40], (1 - k) * 0.85); }
    }
    c.restore();
    drawFires(c, lt + 7, ss(1.4, 3, lt), 1.3);
    embers(c, lt, 90, [255, 140, 40], { rise: 1000, a: 1, drift: 60 });
    grade(c, [255, 90, 20], 0.22 * ss(1, 2, lt), 'overlay');
  }
  if (kind === 'varuna') {
    const rk = ss(1, 1.8, lt);
    for (const [t0, x] of [[0.95, 1300], [2.6, 700], [4.6, 1500], [6.3, 1000]]) {
      const a = bump(t0, t0 + 0.35, lt);
      if (a > 0) { lightning(c, x, -40, x + 80, 380 + hash(x) * 200, x + t0, 3, [170, 210, 255], a); fill(c, [200, 225, 255], a * 0.25); }
    }
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { // torrents pouring onto the fires
      const x = 980 + i * 150, a = bump(1.2 + i * 0.2, 6.5, lt) * 0.35;
      if (a <= 0) continue;
      const g = c.createLinearGradient(x - 40, 0, x + 40, 0);
      g.addColorStop(0, rgba([80, 170, 255], 0)); g.addColorStop(0.5, rgba([150, 210, 255], a)); g.addColorStop(1, rgba([80, 170, 255], 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(x - 30 + Math.sin(lt * 3 + i) * 10, 200);
      c.lineTo(x + 30 + Math.sin(lt * 3 + i) * 10, 200); c.lineTo(x + 60, HZ + 160); c.lineTo(x - 60, HZ + 160); c.fill();
    }
    c.restore();
    for (let i = 0; i < FIRES.length; i += 2) {
      const f = FIRES[i], a = bump(1.6 + hash(i) * 1.5, 7, lt) * 0.5;
      if (a > 0) glowAt(c, f.x, f.y - 60 - (lt - 1.6) * 40, 120 + (lt - 1.6) * 30, [210, 220, 230], a * 0.5);
    }
    rain(c, lt, rk, 0.18);
    grade(c, [60, 120, 200], 0.28 * rk, 'soft-light');
  }
  if (kind === 'vayu') {
    const wi = ss(0.5, 1.1, lt) * (1 - ss(6, 7.5, lt));
    rain(c, lt, 1 - ss(0.6, 2.4, lt), 0.25 + lt * 0.3);
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const sp = 1800 + hash(i) * 1600, len = 80 + hash(i + 4) * 260, x = ((hash(i + 1) * (W + 900) + lt * sp) % (W + 900)) - 450, y = hash(i + 2) * H;
      c.strokeStyle = rgba([220, 245, 255], wi * (0.12 + hash(i + 6) * 0.2)); c.lineWidth = 1 + hash(i + 8) * 2;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - len / 2, y - 6 * Math.sin(lt * 4 + i), x - len, y); c.stroke();
    }
    c.restore();
    c.fillStyle = rgba(p.sil);
    if (wi >= 0.2) for (let i = 0; i < 60; i++) {
      const sp = 1200 + hash(i) * 900, x = ((hash(i + 10) * (W + 600) + lt * sp) % (W + 600)) - 300, y = HZ - 200 + hash(i + 11) * 500 + Math.sin(lt * 3 + i) * 40;
      c.save(); c.translate(x, y); c.rotate(lt * 8 + i); c.fillRect(-6, -2, 12, 4); c.restore();
    }
    groundDust(c, lt * 3, p, HZ, 0.4 * wi, -lt * 900);
  }
  if (kind === 'indra') {
    vajra(c, 1020, 270, 0.9, [255, 230, 120], bump(0.8, 3.2, lt));
    for (const [t0, x] of [[0.9, 1200], [1.6, 1500], [2.3, 1350], [3.2, 1700], [4.1, 1250], [5.3, 1600], [6.4, 1420]]) {
      const a = bump(t0, t0 + 0.3, lt);
      if (a > 0) { lightning(c, 1020, 260, x, HZ + 60 + hash(t0) * 120, t0 * 9, 3.5, [255, 236, 150], a); fill(c, [255, 245, 220], a * 0.2); }
    }
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    c.strokeStyle = rgba([255, 230, 150], 0.85); c.lineWidth = 3; c.beginPath();
    const hits = [];
    for (let i = 0; i < 420; i++) {
      const ts = 1.2 + hash(i) * (s.dur - 1.6), age = lt - ts, ft = 0.55 + hash(i + 2) * 0.25;
      const x0 = 300 + hash(i + 3) * 1300, y1 = HZ + 10 + hash(i + 4) * 240, x1 = x0 + 520 + (y1 - HZ) * 0.6;
      if (age > 0 && age < ft) { const u = age / ft, x = lerp(x0, x1, u), y = lerp(-60, y1, u); c.moveTo(x, y); c.lineTo(x - 34, y - 60); }
      else if (age >= ft && age < ft + 0.25) hits.push([x1, y1, age - ft]);
    }
    c.stroke();
    for (const [x, y, a] of hits) glowAt(c, x, y, 34, [255, 210, 120], (1 - a / 0.25) * 0.85);
    c.restore();
    groundDust(c, lt, p, HZ, 0.3 * ss(1.5, 3, lt), 0);
  }
  if (kind === 'bhargava') {
    const sg = ss(0.8, 1.6, lt), sx = 1180, sy = 330;
    parashu(c, sx, sy, 0.9 + sg * 0.25, -0.35 + Math.sin(lt) * 0.05, col, sg * (1 - ss(7, 8.5, lt) * 0.6));
    const waveR = (lt - 1.5) * 1700;
    for (const d of [0, 180, 360]) shockRing(c, sx, sy, waveR - d, 70, col, (1 - ss(1.5, 3.2, lt)) * 0.8);
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.strokeStyle = rgba([255, 230, 150], 0.75); c.lineWidth = 2.6; c.beginPath();
    const pops = [];
    for (let i = 0; i < 160; i++) { // Indra's arrows still falling until the wave reaches them
      const ts = hash(i) * 2.2 - 0.6, age = lt - ts, ft = 0.8;
      const x0 = 300 + hash(i + 3) * 1300, y1 = HZ + hash(i + 4) * 200, x1 = x0 + 520;
      if (age < 0 || age > ft) continue;
      const u = age / ft, x = lerp(x0, x1, u), y = lerp(-60, y1, u);
      if (Math.hypot(x - sx, y - sy) < waveR) { pops.push([x, y]); continue; }
      c.moveTo(x, y); c.lineTo(x - 30, y - 52);
    }
    c.stroke();
    for (const [x, y] of pops) glowAt(c, x, y, 34, col, 0.65);
    c.restore();
    for (let i = 0; i < 8; i++) { // strikes into the Pandava ranks
      const t0 = 2 + i * 0.6, a = bump(t0, t0 + 0.45, lt), tx = 120 + hash(i + 30) * 700, ty = HZ + 20 + hash(i + 31) * 60;
      if (a > 0) { lightning(c, sx, sy, tx, ty, i * 13 + 5, 4, col, a); glowAt(c, tx, ty, 300, [255, 140, 220], a * 0.85); }
      const e = lt - t0 - 0.2;
      if (e > 0 && e < 2.5) { glowAt(c, tx, ty - e * 40, 140 + e * 120, [255, 120, 60], (1 - e / 2.5) * 0.5); sparks(c, tx, ty, e, 16, [255, 160, 220], i, 500, 1); }
    }
    embers(c, lt, 60, [255, 120, 220], { rise: 900, a: 0.7, x0: 0, w: 1000 });
    grade(c, [180, 40, 160], 0.2 * sg, 'overlay');
  }
  c.restore();
};

SHOT.wide = (c, lt, s) => {
  const mode = s.mode;
  if (mode === 'exchange') {
    const p = PAL.battle, dr = (lt * 1.4) % 1;
    c.save(); cam(c, 960, 600, 1.02 + lt * 0.004);
    field(c, p, lt, { sx: 980, sy: 520, sr: 58 });
    duel(c, lt, p, { aDraw: dr, kDraw: (dr + 0.5) % 1 });
    volley(c, lt, { a: BOW_A(), b: BOW_K(), n: 16, t0: 0.2, t1: s.dur - 0.3, ft: 0.75, arc: 80, glow: ARROW_A, clash: true, seed: 1 });
    volley(c, lt, { a: BOW_K(), b: BOW_A(), n: 16, t0: 0.3, t1: s.dur - 0.2, ft: 0.75, arc: 80, glow: ARROW_K, clash: true, seed: 2 });
    groundDust(c, lt, p, HZ, 0.3);
    c.restore();
    return;
  }
  if (mode === 'storm') {
    const k = ss(0, s.dur * 0.8, lt), p = palMix(PAL.battle, PAL.night, k * 0.55);
    c.save(); const sh = shake(lt, 2); c.translate(sh[0], sh[1]);
    field(c, p, lt, { sx: 980, sy: 520, sr: 58, sa: 1 - k * 0.8 });
    const dr = (lt * 2.2) % 1;
    duel(c, lt, p, { aDraw: dr, kDraw: (dr + 0.5) % 1 });
    for (let w = 0; w < 3; w++) {
      volley(c, lt, { a: BOW_A(), b: BOW_K(), n: 30, t0: w * 0.4, t1: s.dur, ft: 0.8, arc: 120 + w * 140, glow: ARROW_A, clash: w > 0, seed: 10 + w, spread: 160, spreadY: 80 });
      volley(c, lt, { a: BOW_K(), b: BOW_A(), n: 30, t0: w * 0.4 + 0.2, t1: s.dur, ft: 0.8, arc: 120 + w * 140, glow: ARROW_K, clash: w > 0, seed: 20 + w, spread: 160, spreadY: 80 });
    }
    c.restore();
    return;
  }
  if (mode === 'serpentDeath') {
    const p = palMix(PAL.battle, PAL.venom, 0.35);
    c.save(); const sh = shake(lt, 6 * bump(2.9, 3.8, lt)); c.translate(sh[0], sh[1]);
    field(c, p, lt, { sx: 980, sy: 520, sr: 58, sa: 0.7 });
    duel(c, lt, p, { aCrown: false, aDraw: lt > 1.5 && lt < 3 ? (lt * 4) % 1 : 0.2, kDraw: 0 });
    const u = ss(0, 2.9, lt), fall = ss(3, 5.5, lt);
    const sx = lerp(1600, 760, easeIn(u)) - fall * 60, sy = lerp(180, 540, u) + fall * fall * 500;
    if (fall < 1) {
      c.save(); c.globalAlpha = 1 - ss(4.5, 5.5, lt);
      serpent(c, lt * 2, { x: sx, y: sy, s: 210, flip: true, rot: 0.5 + fall * 2, dark: [20, 70, 30], rim: [160, 255, 120], glow: 24, wig: 2,
        ctrl: [[0, 0], [-0.3, -0.05], [-0.7, 0.05], [-1.1, -0.1], [-1.5, 0.05], [-1.9, -0.05]] });
      c.restore();
      if (lt > 3) { c.save(); c.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) flame(c, sx + (i - 3) * 30, sy + 20, 110 * (1 - fall), 46, lt, i); c.restore(); }
    }
    for (let i = 0; i < 6; i++) {
      const t0 = 1.55 + i * 0.24, e = lt - t0, from = BOW_A(), tu = clamp((t0 + 0.28) / 2.9), to = [lerp(1600, 760, easeIn(tu)), lerp(180, 540, tu)];
      if (e > 0 && e < 0.28) { const q = arcPos(from, to, e / 0.28, 30); astraBolt(c, q[0], q[1], Math.atan2(to[1] - from[1], to[0] - from[0]), [230, 240, 255], 0.9, 220); }
      if (e >= 0.28 && e < 0.9) sparks(c, to[0], to[1], e - 0.28, 24, [150, 255, 120], i * 7, 480, 0.62);
    }
    if (lt > 2.9 && lt < 3.6) glowAt(c, sx, sy, 560, [150, 255, 120], bump(2.9, 3.6, lt));
    c.restore();
    return;
  }
  // dharma / flagCut: Karna stands on the ground beside his sunken chariot
  const p = PAL.late;
  c.save();
  if (mode === 'dharma') cam(c, 960, 600, 1 + lt * 0.004);
  field(c, p, lt, { sx: 940, sy: 590, sr: 64, ra: 0.1 });
  duel(c, lt, p, { kGround: true, kTilt: 0.13, kSink: 34, aDraw: mode === 'flagCut' ? 0 : 1, kFlagFall: mode === 'flagCut' ? 0.55 + ss(0, 1.4, lt) * 0.45 : 0, kPh: 0.4, aPh: 0.1 });
  const kOpts = mode === 'dharma' ? { crown: 'karna', bow: false, armUp: ss(0.8, 2.2, lt), heldBow: true, t: lt } : { crown: 'karna', bow: false, reach: true, heldBow: true, lean: 0.35, t: lt };
  person(c, 'K', 1300, GY + 80, DUEL.s * 1.6, true, kOpts, p, 0, mixc(p.rim, RIM_K, 0.6));
  if (mode === 'flagCut') { const e = lt; if (e < 2.5) glowAt(c, DUEL.K + 330, GY - 10, 140 + e * 140, mixc(p.haze, p.glow, 0.3), (1 - e / 2.5) * 0.55); }
  groundDust(c, lt, p, HZ, 0.25);
  c.restore();
};

SHOT.quiver = (c, lt, s) => {
  const p = palMix(PAL.night, PAL.venom, 0.55), hx = 1250, hy = 590, sc = 318 * (1 + lt * 0.006);
  drawSky(c, p, H);
  glowAt(c, 1000, 480, 900, [90, 200, 80], 0.22);
  drawClouds(c, lt, { n: 8, y0: 100, y1: 900, sp: 6, a: 0.25, col: [70, 100, 70], seed: 30 });
  bokeh(c, lt, 12, [120, 255, 110], 0.12, 3);
  bust(c, 'K', { x: hx, y: hy + Math.sin(lt * 1.4) * 3, s: sc, flip: true, t: lt, mood: 'resolve', rim: [200, 255, 150], glow: 30, light: [200, 255, 170], dark: [10, 30, 15], tint: [[60, 140, 60], 0.12] });
  const ax = hx - 0.98 * sc, top = hy - 0.95 * sc, bot = hy + 1.45 * sc;
  c.save(); c.lineCap = 'round';
  c.strokeStyle = LOOK.K.skin; c.lineWidth = 16; c.beginPath(); c.moveTo(hx - 0.45 * sc, hy + 1.0 * sc); c.lineTo(ax + 6, hy + 0.55 * sc); c.stroke();
  c.strokeStyle = '#4a2c14'; c.lineWidth = 9; c.beginPath(); c.moveTo(ax, bot); c.lineTo(ax, top); c.stroke();
  c.fillStyle = LOOK.K.skin; c.beginPath(); c.arc(ax + 4, hy + 0.55 * sc, 34, 0, TAU); c.fill();
  c.fillStyle = LOOK.K.gold; c.fillRect(ax - 30, hy + 0.55 * sc + 26, 60, 10);
  c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba([150, 255, 120], 0.35 + 0.15 * Math.sin(lt * 5)); c.lineWidth = 3; c.beginPath(); c.moveTo(ax + 5, bot); c.lineTo(ax + 5, top); c.stroke();
  for (let i = 0; i < 14; i++) { const y = lerp(top, bot, i / 14) + Math.sin(lt * 2 + i) * 10; glowAt(c, ax + Math.sin(lt * 1.5 + i * 0.8) * 20, y, 40, [130, 255, 100], 0.25); }
  c.restore();
  serpent(c, lt, { x: ax, y: top - 6, s: 150, rot: -Math.PI / 2, dark: [20, 70, 30], rim: [190, 255, 140], glow: 20, wig: 0.5, ctrl: [[0, 0], [-0.25, 0.02], [-0.55, -0.02], [-0.85, 0.01]] });
  drawClouds(c, lt, { n: 5, y0: top + 100, y1: hy + 200, sp: -14, a: 0.18, col: [180, 200, 170], sc: 0.6, seed: 61 });
  embers(c, lt, 26, [140, 255, 110], { rise: 700, a: 0.5 });
};

SHOT.nagaFlight = (c, lt, s) => {
  const p = palMix(PAL.battle, PAL.venom, 0.45), sl = lt * 0.6;
  c.save(); const sh = shake(lt, 3); c.translate(sh[0], sh[1]);
  field(c, p, lt, { scroll: -lt * 2200, sx: 1500, sy: 380, sr: 50, sa: 0.6, hz: 790, ca: 0.6, csp: 0 });
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const sp = 2400 + hash(i) * 2000, len = 120 + hash(i + 3) * 340, x = ((hash(i + 1) * (W + 900) + lt * sp) % (W + 900)) - 450, y = hash(i + 2) * H;
    c.strokeStyle = rgba([210, 255, 200], 0.08 + hash(i + 5) * 0.12); c.lineWidth = 1 + hash(i + 7) * 2.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
  }
  c.restore();
  const exit = easeIn(ss(s.dur - 0.9, s.dur, lt)) * 1500;
  const ax = 960 + Math.sin(sl * 2.2) * 30 - exit, ay = 470 + Math.sin(sl * 3.4) * 14, L = 560;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const ph = (lt * 1.4 + hash(i)) % 1, x = ax + L * 0.5 + ph * 900, y = ay + (hash(i + 4) - 0.5) * 80 * ph + Math.sin(lt * 3 + i) * 10;
    glowAt(c, x, y, 40 + ph * 80, [120, 255, 90], (1 - ph) * 0.45);
  }
  glowAt(c, ax, ay, 600, [120, 255, 100], 0.25);
  c.restore();
  const helix = (front) => {
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const u = i / 90, ph = u * 15 - lt * 9, depth = Math.cos(ph);
      if ((depth > 0) !== front) continue;
      const x = ax - L * 0.45 + u * L, y = ay + Math.sin(ph) * 46 * (1 - u * 0.45);
      c.strokeStyle = rgba([140, 255, 110], (0.25 + 0.5 * (depth * 0.5 + 0.5)) * (1 - u * 0.6)); c.lineWidth = 16 * (1 - u * 0.75);
      const ph2 = (u + 1 / 90) * 15 - lt * 9;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + L / 90, ay + Math.sin(ph2) * 46 * (1 - u * 0.45)); c.stroke();
    }
    c.restore();
  };
  helix(false);
  arrowShape(c, ax - L * 0.5, ay, Math.PI, L, '#2a3a20', 9);
  helix(true);
  serpent(c, lt * 2, { x: ax - L * 0.5 - 10, y: ay, s: 230, flip: true, dark: [20, 70, 30], rim: [190, 255, 140], glow: 26, wig: 0.3, ctrl: [[0, 0], [-0.25, 0.02], [-0.5, -0.02], [-0.7, 0]] });
  c.restore();
  motes(c, lt, 50, [200, 255, 180], 0.35, 30);
};

SHOT.press = (c, lt, s) => {
  const p = PAL.battle, cx = 600, gy = 960, sc = 1.1;
  const sink = easeOut(ss(0.82, 1.12, lt)) * 72, kneel = ss(0.82, 1.3, lt), hit = 1.14;
  const sh = shake(lt, 9 * bump(0.9, 1.6, lt));
  c.save(); c.translate(sh[0], sh[1]);
  field(c, p, lt, { sx: 1500, sy: 400, sr: 70, hz: 700, debris: 0.8 });
  chariot(c, Object.assign({
    x: cx, y: gy, s: sc, dir: 1, t: lt, ph: 0.15, sink, kneel, who: 'A', driverWho: 'KR', rim: RIM_A, rimOff: [3, -2],
    warrior: { crown: lt < hit ? 'kirita' : null, draw: 0.1, hairWind: lt > hit ? 3 : 1 }, driver: { crown: 'mukut', lean: 0.25 * ss(0.7, 0.95, lt) },
    flag: 'hanuman', flagCol: FLAG_A,
  }, lightOf(p)));
  const g = c.createLinearGradient(0, gy, 0, H);
  g.addColorStop(0, rgba(mixc(p.g1, p.haze, 0.3))); g.addColorStop(1, rgba(p.g2));
  c.fillStyle = g; c.fillRect(-50, gy - 2, W + 100, H);
  for (let i = 0; i < 9; i++) { // dust thrown up as the earth gives
    const e = lt - 0.9 - hash(i) * 0.2;
    if (e > 0 && e < 3) glowAt(c, cx - 200 + i * 110, gy - 20 - e * 50, 120 + e * 140, mixc(p.haze, p.glow, 0.25), (1 - e / 3) * 0.55);
  }
  const ay = 590, axp = 2100 - (lt - 0.45) * 2300;
  if (lt > 0.45 && axp > -300) {
    const q = [axp, ay - Math.max(0, lt - hit) * 140];
    astraBolt(c, q[0], q[1], Math.PI + (lt > hit ? 0.12 : 0), [130, 255, 100], 1.3, 420);
    serpent(c, lt * 3, { x: q[0] - 10, y: q[1], s: 120, flip: true, dark: [20, 70, 30], rim: [190, 255, 140], glow: 16, wig: 0.4, ctrl: [[0, 0], [-0.3, 0], [-0.6, 0]] });
  }
  const e = lt - hit;
  if (e > 0) {
    const cxr = cx - 42 * sc + -560 * e, cyr = gy + sink - 380 * sc - 520 * e + 700 * e * e;
    c.save(); c.translate(cxr, cyr); c.rotate(-e * 7); c.scale(sc * 1.6, sc * 1.6); c.translate(0, 236);
    crownSmall(c, 'kirita', LOOK.A);
    c.restore();
    sparks(c, cx - 30, gy + sink - 395, e, 50, [255, 230, 150], 77, 800, 0.9);
    glowAt(c, cx - 30, gy + sink - 395, 520, [200, 255, 160], (1 - ss(0, 0.5, e)) * 0.9);
  }
  c.restore();
};

SHOT.crown = (c, lt, s) => {
  const p = palMix(PAL.day, PAL.battle, 0.35), hx = 700, hy = 600, sc = 318, hit = 0.38;
  bustBackdrop(c, lt, p, [1500, 300, 80], 9);
  const e = Math.max(0, lt - hit) * 0.55;
  bust(c, 'A', { x: hx, y: hy, s: sc, t: lt * (lt > hit ? 2 : 1), noCrown: lt > hit, mood: lt > hit ? 'angry' : '', rim: [255, 240, 210], hairAmt: lt > hit ? 2.4 : 1, light: p.sun, dark: mixc(p.mid, BLACK, 0.5) });
  const ax = lerp(2000, -200, ss(0.05, 0.7, lt));
  if (lt < 0.72) astraBolt(c, ax, hy - 0.86 * sc, Math.PI, [130, 255, 100], 1.4, 500);
  c.save(); c.translate(hx + 40 - 760 * e, hy - 420 * e + 150 * e * e); c.rotate(-e * 2.6); c.scale(sc, sc);
  c.fillStyle = LOOK.A.crown; tieredCrown(c, -1.32, false, LOOK.A);
  c.restore();
  if (lt > hit) {
    sparks(c, hx + 0.3 * sc, hy - 0.8 * sc, (lt - hit) * 0.5, 60, [255, 230, 160], 5, 900, 1.2);
    glowAt(c, hx + 0.3 * sc, hy - 0.8 * sc, 600, [210, 255, 170], (1 - ss(0, 1.2, lt - hit)) * 0.9);
  }
  motes(c, lt, 40, [255, 230, 190], 0.3, 0.3);
};

SHOT.serpent = (c, lt, s) => {
  const p = palMix(PAL.night, PAL.venom, 0.7);
  drawSky(c, p, H);
  glowAt(c, 900, 500, 1000, [80, 200, 70], 0.22);
  drawClouds(c, lt, { n: 10, y0: 100, y1: 1000, sp: 12, a: 0.35, col: [40, 70, 45], sc: 2, seed: 70 });
  for (const t0 of [1.4, 4.2]) { const a = bump(t0, t0 + 0.3, lt); if (a > 0) { lightning(c, 1500, -40, 1650, 600, t0 * 5, 3, [170, 255, 140], a); fill(c, [200, 255, 190], a * 0.12); } }
  const m = mouthOf('AS');
  serpent(c, lt * (m > 0.1 ? 2.5 : 1), { x: 880, y: 360 + Math.sin(lt * 1.2) * 14 - m * 8, s: 380, dark: [24, 80, 36], rim: [150, 255, 120], glow: 40, wig: 1.2,
    ctrl: [[0, 0], [-0.12, 0.32], [-0.14, 0.66], [-0.4, 0.95], [-0.85, 1.0], [-1.15, 0.85], [-1.0, 0.6], [-0.7, 0.68]] });
  drawClouds(c, lt, { n: 6, y0: 800, y1: 1000, sp: 18, a: 0.45, col: [30, 50, 34], sc: 2.2, seed: 90 });
  embers(c, lt, 30, [140, 255, 110], { rise: 900, a: 0.6 });
};

SHOT.wheel = (c, lt, s) => {
  const p = PAL.late, hz = 600, sink = easeOut(ss(0.3, 2.4, lt)) * 160, tilt = ss(0.3, 2.4, lt) * 0.1;
  const sh = shake(lt, 5 * bump(0.2, 2.8, lt));
  c.save(); c.translate(sh[0], sh[1]);
  drawSky(c, p, hz); drawSun(c, 520, 420, 80, p, 1); drawRays(c, 520, 420, lt, p, 0.1);
  drawClouds(c, lt, { n: 6, y0: 140, y1: 400, sp: 6, a: 0.5, col: mixc(p.glow, p.mid, 0.5) });
  ridge(c, hz + 2, 40, 0.002, 3, p.far, 0, 1); armies(c, hz, p, 0, 0.9, 0.5); hazeBand(c, hz, p, 0.5); drawGround(c, hz, p);
  chariot(c, Object.assign({ x: 932, y: 800, s: 2.4, dir: -1, t: lt, sink, tilt, who: 'K', rim: RIM_K, rimOff: [-4, -3], horses: false, noWarrior: true, wheel: Math.sin(lt * 3) * 0.04 * (1 - ss(2, 3, lt)) }, lightOf(p)));
  const mudY = 800;
  c.fillStyle = rgba([24, 12, 8]);
  c.beginPath(); c.moveTo(-50, mudY + 20);
  for (let x = -50; x <= W + 50; x += 30) c.lineTo(x, mudY + Math.sin(x * 0.02 + lt * 2) * 6 - Math.max(0, 140 - Math.abs(x - 980)) * 0.25 * ss(0.3, 1.5, lt));
  c.lineTo(W + 50, H + 50); c.lineTo(-50, H + 50); c.fill();
  c.strokeStyle = rgba(p.glow, 0.25); c.lineWidth = 2; c.stroke();
  c.fillStyle = rgba([40, 20, 12]);
  for (let i = 0; i < 40; i++) { // mud flung by the turning wheel
    const t0 = 0.4 + hash(i) * 1.8, e = lt - t0;
    if (e < 0 || e > 1.2) continue;
    const vx = (hash(i + 1) - 0.5) * 700, vy = -300 - hash(i + 2) * 500;
    const x = 980 + vx * e, y = mudY - 20 + vy * e + 900 * e * e;
    if (y < mudY + 10) { c.beginPath(); c.arc(x, y, 4 + hash(i + 3) * 8, 0, TAU); c.fill(); }
  }
  for (let i = 0; i < 6; i++) { const e = lt - 0.3 - i * 0.3; if (e > 0 && e < 3) glowAt(c, 700 + i * 110, mudY - 40 - e * 30, 140 + e * 90, mixc(p.haze, p.glow, 0.2), (1 - e / 3) * 0.4); }
  c.restore();
};

/* ----- flashback: Parashurama's ashram ----- */
function banyan(c) {
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(250, 900); c.bezierCurveTo(280, 700, 230, 560, 300, 420); c.lineTo(370, 420); c.bezierCurveTo(330, 560, 380, 700, 380, 900); c.fill();
  for (let i = 0; i < 26; i++) { const x = 60 + hash(i + 5) * 600, y = 230 + hash(i + 6) * 230, r = 70 + hash(i + 7) * 90; c.beginPath(); c.ellipse(x, y, r * 1.3, r * 0.7, 0, 0, TAU); c.fill(); }
  c.lineWidth = 3; for (let i = 0; i < 18; i++) { const x = 80 + hash(i + 20) * 560; c.beginPath(); c.moveTo(x, 380); c.lineTo(x + (hash(i) - 0.5) * 20, 520 + hash(i + 3) * 300); c.stroke(); }
}
function hut(c) {
  c.beginPath(); c.moveTo(1450, 860); c.lineTo(1450, 760); c.lineTo(1560, 690); c.lineTo(1690, 760); c.lineTo(1690, 860); c.fill();
  c.beginPath(); c.moveTo(1420, 770); c.lineTo(1560, 670); c.lineTo(1720, 770); c.lineTo(1700, 778); c.lineTo(1560, 690); c.lineTo(1440, 778); c.fill();
}
function seatedKarna(c, P, o) { // young Karna seated facing right, origin at hips on ground
  if (typeof P === 'string') P = flat(P);
  c.lineCap = 'round';
  c.fillStyle = P.skin; c.beginPath(); c.moveTo(-26, 0); c.lineTo(22, 0); c.quadraticCurveTo(30, -50, 20, -98); c.lineTo(-24, -100); c.quadraticCurveTo(-30, -50, -26, 0); c.fill();
  c.strokeStyle = P.white; c.lineWidth = 3; c.beginPath(); c.moveTo(-20, -96); c.lineTo(18, -10); c.stroke(); // sacred thread of his brahmin disguise
  c.strokeStyle = P.white; c.lineWidth = 26; c.beginPath(); c.moveTo(-10, -6); c.lineTo(86, -2); c.stroke();
  c.lineWidth = 18; c.beginPath(); c.moveTo(80, 2); c.lineTo(10, 12); c.stroke();
  c.fillStyle = P.skin; c.fillRect(-5, -116, 12, 18); c.beginPath(); c.ellipse(4, -130, 15, 17, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(17, -134); c.lineTo(24, -124); c.lineTo(17, -121); c.fill();
  if (!P.flat) { c.fillStyle = P.eye; c.beginPath(); c.ellipse(12, -133, 2.6, 1.8, 0, 0, TAU); c.fill(); }
  c.fillStyle = P.hair; c.beginPath(); c.ellipse(-6, -148, 10, 8, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(0, -140, 15, 8, 0, Math.PI, TAU); c.fill();
  c.strokeStyle = P.skin; c.lineWidth = 11; c.beginPath(); c.moveTo(14, -88); c.lineTo(50, -50); c.lineTo(82, -36); c.stroke();
  if (o.join) { c.beginPath(); c.moveTo(-14, -88); c.lineTo(30, -70); c.lineTo(44, -96); c.stroke(); }
  else { c.beginPath(); c.moveTo(-14, -88); c.lineTo(-40, -40); c.lineTo(-46, -4); c.stroke(); }
}
function sage(c, P, rise) { // Parashurama: lying with head on Karna's lap (rise 0) to sitting up (rise 1); origin at hips
  if (typeof P === 'string') P = flat(P);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = P.cloth; c.lineWidth = 24; c.beginPath(); c.moveTo(0, 0); c.lineTo(120, 4); c.stroke();
  c.strokeStyle = P.skin; c.beginPath(); c.moveTo(120, 4); c.lineTo(160, 0); c.stroke();
  c.fillStyle = P.skin; c.beginPath(); c.ellipse(168, -8, 10, 15, 0, 0, TAU); c.fill();
  c.save(); c.rotate(lerp(0, Math.PI / 2, easeInOut(rise)));
  c.fillStyle = P.skin; c.beginPath(); c.moveTo(6, -18); c.quadraticCurveTo(-70, -26, -140, -24); c.quadraticCurveTo(-160, -2, -140, 28); c.quadraticCurveTo(-70, 32, 6, 20); c.closePath(); c.fill();
  c.fillStyle = P.cloth; c.beginPath(); c.moveTo(6, -18); c.lineTo(-60, -22); c.lineTo(-30, 26); c.lineTo(6, 20); c.fill();
  c.fillStyle = P.skin; c.fillRect(-170, -9, 32, 18);
  c.beginPath(); c.ellipse(-190, -2, 19, 17, 0, 0, TAU); c.fill();
  c.fillStyle = P.hair; c.beginPath(); c.ellipse(-215, -4, 14, 11, 0, 0, TAU); c.fill();
  c.fillStyle = P.skin; c.beginPath(); c.moveTo(-197, 12); c.lineTo(-189, 25); c.lineTo(-182, 14); c.fill();
  c.fillStyle = P.beard; c.beginPath(); c.moveTo(-182, 12); c.quadraticCurveTo(-160, 42, -126, 36); c.lineTo(-170, 6); c.fill();
  const pt = ss(0.6, 1, rise);
  c.strokeStyle = P.skin; c.lineWidth = 12; c.beginPath(); c.moveTo(-128, 16); c.lineTo(lerp(-80, -150, pt), lerp(26, 72, pt)); c.lineTo(lerp(-40, -176, pt), lerp(14, 126, pt)); c.stroke();
  c.restore();
}
function flashFig(c, x, y, sc, draw, p, rim) { // rim light, then paint + sepia shading on a layer
  c.save(); c.translate(x, y); c.scale(sc, sc);
  c.save(); c.translate(1.2, -0.8); draw(c, flat(rim)); c.restore();
  withLayer(c, (lc) => { draw(lc, null); shadeAtop(lc, rgba(p.mid, 0.28), -400, -500, 900, 700); });
  c.restore();
}
SHOT.flashback = (c, lt, s) => {
  const p = PAL.sepia, hz = 760, fl = 0.92 + 0.08 * vnoise(lt * 18);
  drawSky(c, p, hz); drawSun(c, 1420, 380, 80, p, 0.9); drawRays(c, 1420, 380, lt, p, 0.06);
  drawClouds(c, lt, { n: 5, y0: 160, y1: 420, sp: 4, a: 0.4, col: [255, 236, 200] });
  ridge(c, hz, 300, 0.0011, 9, mixc(p.far, p.haze, 0.3), 0, 1);
  ridge(c, hz + 4, 120, 0.002, 2, p.far, 0, 1);
  drawGround(c, hz, p);
  c.fillStyle = rgba(p.sil); banyan(c); hut(c);
  const rim = [255, 226, 170];
  if (s.phase === 0) {
    const rise = ss(4.6, 5.8, lt);
    flashFig(c, 860, 880, 1.45, (cc, F) => seatedKarna(cc, F || LOOK.K, { join: rise > 0.5 }), p, rim);
    flashFig(c, 860 + 90 * 1.45 + 190 * 1.45, 880 - 22 * 1.45, 1.45, (cc, F) => sage(cc, F || LOOK.P, rise), p, rim);
    const bx = 860 + 60 * 1.45, by = 880 + 6;
    c.save(); c.globalCompositeOperation = 'lighter'; glowAt(c, bx, by, 26, [255, 60, 40], 0.9 * (0.6 + 0.4 * Math.sin(lt * 10))); c.restore();
    c.strokeStyle = rgba([150, 10, 10], 0.95); c.lineWidth = 4; c.beginPath(); c.moveTo(bx, by + 4); c.lineTo(bx + 2, by + 4 + ss(0.5, 4, lt) * 70); c.stroke();
  } else {
    flashFig(c, 760, 890, 1.45, (cc, F) => seatedKarna(cc, F || LOOK.K, { join: true }), p, rim);
    person(c, 'P', 1180, 900, 1.5, true, { bow: false, armUp: 1, axe: true, crown: 'jata', beard: true, t: lt }, p, 0, [255, 150, 110]);
    for (const t0 of [0.2, 3.4]) { const a = bump(t0, t0 + 0.5, lt); fill(c, [255, 120, 80], a * 0.35); }
    grade(c, [200, 60, 30], 0.25 * ss(0, 1, lt), 'overlay');
  }
  fill(c, BLACK, (1 - fl) * 1.5); // old-film flicker, scratches and dust
  c.strokeStyle = 'rgba(255,240,210,.18)'; c.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) { const x = hash(Math.floor(lt * 12) + i * 7) * W; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 6, H); c.stroke(); }
  c.fillStyle = 'rgba(30,20,10,.5)';
  for (let i = 0; i < 12; i++) { const k = Math.floor(lt * 12) * 31 + i; c.beginPath(); c.arc(hash(k) * W, hash(k + 1) * H, 1 + hash(k + 2) * 3, 0, TAU); c.fill(); }
  const g = c.createRadialGradient(W / 2, H / 2, 400, W / 2, H / 2, 1100);
  g.addColorStop(0, 'rgba(90,50,10,0)'); g.addColorStop(1, 'rgba(90,40,5,.75)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
};

/* ----- the final arrow ----- */
function sunsetStage(c, lt, p, sunY, o = {}) {
  field(c, p, lt, { hz: 760, sx: 1240, sy: sunY, sr: 300, ra: 0.14, sa: o.sa ?? 1, armyA: 0.6, debris: 0.8, ca: 0.4, stars: o.stars });
  chariot(c, Object.assign({ x: 1640, y: GY + 10, s: 0.68, dir: -1, t: lt, tilt: 0.13, sink: 40, who: 'K', rim: RIM_K, rimOff: [-3, -1], horses: false, noWarrior: true, flag: null }, lightOf(p)));
}
SHOT.anjalikaFlight = (c, lt, s) => {
  const p = PAL.dusk, u = lt / s.dur;
  c.save(); cam(c, 960, 560, 1 + u * 0.05);
  sunsetStage(c, lt, p, 640);
  person(c, 'K', 1240, 905, 1.45, true, { crown: 'karna', bow: false, heldBow: true, armUp: 0.15, t: lt * 0.3 }, p, 0, [255, 200, 120]);
  const x = lerp(-250, 1150, Math.pow(u, 1.25)), y = 625 + Math.sin(u * 3) * 6;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) { const ph = (lt * 0.25 + hash(i)) % 1; glowAt(c, x - ph * 700, y + (hash(i + 3) - 0.5) * 50 * ph, 30 + ph * 50, [255, 200, 80], (1 - ph) * 0.35); }
  c.restore();
  astraBolt(c, x, y, 0, [255, 210, 90], 1.6, 700);
  c.save(); c.translate(x, y); c.scale(1.9, 1.9); c.fillStyle = rgba([255, 240, 190]);
  c.beginPath(); c.moveTo(30, -26); c.quadraticCurveTo(-14, -18, -8, 0); c.quadraticCurveTo(-14, 18, 30, 26); c.quadraticCurveTo(4, 14, 4, 0); c.quadraticCurveTo(4, -14, 30, -26); c.fill();
  c.restore();
  c.restore();
  motes(c, lt, 70, [255, 220, 170], 0.45, 0.15);
};
SHOT.impact = (c, lt, s) => {
  const p = palMix(PAL.dusk, PAL.night, ss(0, s.dur, lt) * 0.35);
  sunsetStage(c, lt, p, lerp(640, 690, ss(0, s.dur, lt)));
  const fall = easeIn(ss(0.5, 2.7, lt)) * 1.5;
  person(c, 'K', 1240, 905, 1.45, true, { crown: lt < 0.6 ? 'karna' : null, bow: false, heldBow: lt < 1, armUp: 0.6 * bump(0.3, 2.5, lt), t: lt * 0.3 }, p, -fall, [255, 200, 120]);
  const e = lt - 0.6;
  if (e > 0) {
    const cx = 1230 + e * 260, cy = 905 - 360 + 380 * Math.min(1, e * e * 1.1);
    c.save(); c.translate(cx, Math.min(cy, 900)); c.rotate(e * 3); c.scale(1.45, 1.45); c.translate(0, 236);
    crownSmall(c, 'karna', LOOK.K); c.restore();
  }
  const d = lt - 2.7;
  if (d > 0 && d < 3.5) for (let i = 0; i < 6; i++) glowAt(c, 1300 + i * 70, 880 - d * 30, 120 + d * 120, mixc(p.haze, p.glow, 0.3), (1 - d / 3.5) * 0.45);
};

SHOT.ascension = (c, lt, s) => {
  const k = ss(0, s.dur, lt), p = palMix(PAL.dusk, PAL.night, k * 0.7);
  const sy = lerp(620, 790, ss(6, s.dur, lt)), sx = 700, beam = bump(2.2, 14, lt), arrive = ss(5, 7, lt);
  c.save(); cam(c, 960, 560, 1.05 - k * 0.05);
  field(c, p, lt, { hz: 770, sx, sy, sr: 150 + arrive * 30, sa: 1 - ss(s.dur - 4, s.dur, lt) * 0.7, ra: 0.1 + arrive * 0.12, stars: ss(s.dur * 0.45, s.dur, lt), armyA: 0.5, debris: 0.9, ca: 0.35 });
  chariot(c, Object.assign({ x: 1640, y: GY + 10, s: 0.68, dir: -1, t: lt, tilt: 0.13, sink: 40, who: 'K', rim: RIM_K, rimOff: [-3, -1], horses: false, noWarrior: true, flag: null }, lightOf(p)));
  const bx = 1250, by = 895;
  person(c, 'K', bx + 120, by + 8, 1, false, { crown: null, bow: false, t: 0, hair: true }, p, -Math.PI / 2 * 0.98, [255, 190, 110]);
  c.save(); c.globalCompositeOperation = 'lighter';
  glowAt(c, bx, by - 20, 260, [255, 210, 120], ss(0.6, 2.4, lt) * (1 - ss(10, 14, lt)) * 0.8);
  const P = (u) => { const a = 1 - u; return [a * a * bx + 2 * a * u * 1150 + u * u * sx, a * a * (by - 30) + 2 * a * u * 160 + u * u * sy]; };
  if (beam > 0) {
    c.lineCap = 'round';
    for (const [lw, al] of [[60, 0.08], [24, 0.2], [7, 0.6]]) {
      c.strokeStyle = rgba([255, 220, 150], al * beam); c.lineWidth = lw; c.beginPath();
      const reach = ss(2.2, 5, lt);
      for (let i = 0; i <= 40; i++) { const q = P((i / 40) * reach); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
      c.stroke();
    }
    for (let i = 0; i < 90; i++) { const ph = (lt * 0.22 + hash(i)) % 1, q = P(ph * ss(2.2, 5, lt)); glowAt(c, q[0] + (hash(i + 2) - 0.5) * 40, q[1] + (hash(i + 3) - 0.5) * 40, 18, [255, 230, 170], beam * 0.8 * Math.sin(Math.PI * ph)); }
  }
  glowAt(c, sx, sy, 900, [255, 200, 110], arrive * (1 - ss(12, 20, lt)) * 0.5);
  c.restore();
  c.fillStyle = rgba(p.sil);
  for (let i = 0; i < 9; i++) { const t0 = 9 + hash(i) * 6, e = lt - t0; if (e > 0 && e < 9) vulture(c, -100 + e * 260 + hash(i + 1) * 200, 300 + hash(i + 2) * 200 - e * 12, 0.35 + hash(i + 3) * 0.2, lt, i); }
  c.restore();
};

SHOT.end = (c, lt, s) => {
  fill(c, BLACK, 1);
  embers(c, lt, 30, [255, 150, 60], { rise: 900, a: 0.4 });
  const a = ss(0.4, 2.4, lt) * (1 - ss(s.dur - 1.2, s.dur, lt)), a2 = ss(2, 3.5, lt) * (1 - ss(s.dur - 1.2, s.dur, lt));
  c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
  const g = c.createLinearGradient(0, 360, 0, 560);
  g.addColorStop(0, rgba([255, 244, 210], a)); g.addColorStop(1, rgba([200, 120, 40], a));
  c.font = '170px "Rozha One", "Tiro Devanagari Hindi", serif'; c.shadowColor = rgba([255, 130, 40], 0.7 * a); c.shadowBlur = 40 * VIEW.scale;
  c.fillStyle = g; c.fillText('समाप्त', W / 2, 470);
  c.shadowBlur = 0;
  c.font = '44px "Tiro Devanagari Hindi", serif'; c.fillStyle = rgba([240, 220, 190], a2); c.fillText('कर्ण अर्जुन युद्ध', W / 2, 620);
  c.restore();
};
