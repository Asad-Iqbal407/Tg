'use strict';
// Level builder + stage definitions. Grid is 15 rows tall; ground surface is normally row 13.
//
// Tile legend
//   .  empty           G  ground          B  brick (breakable)    R  stone block
//   ?  lucky block (coin)                 P  lucky block (power)  F  lucky block (feather)
//   S  lucky block (star)                 U  secret 1UP brick     M  multi-coin brick
//   H  hidden 1UP block (invisible)       X  used block           C  seed cannon
//   [ ] tube top   { } tube body          =  one-way platform     ^  spikes
//   ~  lava surface  %  lava body         c  coin
class LB {
  constructor(w, h = 15) {
    this.w = w; this.h = h;
    this.g = [];
    for (let y = 0; y < h; y++) this.g.push(new Array(w).fill('.'));
    this.ents = [];
    this.startPos = { x: 2, y: 12 };
  }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c; return this; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.g[y][x] : '.'; }
  fill(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); return this; }
  ground(x0, x1, top = 13) { return this.fill(x0, top, x1, this.h - 1, 'G'); }
  row(x, y, s) { for (let i = 0; i < s.length; i++) if (s[i] !== ' ') this.set(x + i, y, s[i]); return this; }
  coins(x, y, n) { for (let i = 0; i < n; i++) this.set(x + i, y, 'c'); return this; }
  arc(x, y, n, hgt = 2) { // coin arc
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.set(x + i, Math.round(y - Math.sin(t * Math.PI) * hgt), 'c');
    }
    return this;
  }
  pipe(x, top, bottom = this.h - 1) {
    this.set(x, top, '[').set(x + 1, top, ']');
    for (let y = top + 1; y <= bottom; y++) this.set(x, y, '{').set(x + 1, y, '}');
    return this;
  }
  stairsUp(x, n, base = 12, c = 'R') { for (let i = 0; i < n; i++) this.fill(x + i, base - i, x + i, base, c); return this; }
  stairsDown(x, n, base = 12, c = 'R') { for (let i = 0; i < n; i++) this.fill(x + i, base - (n - 1 - i), x + i, base, c); return this; }
  lava(x0, x1, top = 13) { this.fill(x0, top, x1, top, '~'); this.fill(x0, top + 1, x1, this.h - 1, '%'); return this; }
  e(type, x, y, opt = {}) { this.ents.push({ type, x, y, opt }); return this; }
  start(x, y) { this.startPos = { x, y }; return this; }
  done(meta) { return { w: this.w, h: this.h, g: this.g, ents: this.ents, start: this.startPos, ...meta }; }
}

// ---------------------------------------------------------------- 1-1 Meadow
function buildMeadow() {
  const L = new LB(214);
  L.ground(0, 46); L.ground(50, 89); L.ground(93, 132); L.ground(137, 213);
  L.start(3, 12);

  L.row(13, 9, '?');
  L.row(18, 9, 'BPB?B');
  L.row(20, 5, '?');
  L.e('blob', 24, 12);
  L.pipe(28, 11);
  L.e('blob', 32, 12);
  L.pipe(36, 10); L.e('snapper', 36, 10);
  L.e('blob', 40, 12); L.e('blob', 42, 12);
  L.pipe(44, 10);
  L.e('medal', 44.5, 4, { id: 0 });
  L.arc(46, 10, 5, 2);

  L.row(55, 9, 'B?B');
  L.row(58, 5, 'BBBBBBBB');
  L.coins(59, 4, 3);
  L.e('blob', 64, 4);
  L.set(63, 9, 'H');
  L.row(68, 9, '?');
  L.e('shell', 72, 12);
  L.row(76, 9, 'BMB');
  L.e('blob', 79, 12); L.e('blob', 81, 12);
  L.stairsUp(86, 4);
  L.stairsDown(93, 4);
  L.e('checkpoint', 100, 12);

  L.e('blob', 104, 12); L.e('hopper', 108, 12);
  L.row(104, 9, '?P?');
  L.row(111, 9, 'BB');
  L.row(115, 6, 'BBBB');
  L.e('medal', 117, 4, { id: 1 });
  L.e('shell', 121, 12);
  L.row(124, 9, 'B?B?B');
  L.e('blob', 127, 12);
  L.arc(132, 10, 6, 3);

  L.e('shell', 141, 12); L.e('blob', 145, 12); L.e('hopper', 149, 12);
  L.row(150, 9, 'BBSBB');
  L.e('spring', 160, 12);
  L.row(157, 4, '======');
  L.e('medal', 161, 3, { id: 2 });
  L.coins(157, 3, 3);
  L.e('blob', 166, 12); L.e('blob', 168, 12);
  L.row(166, 9, '?B?');
  L.stairsUp(176, 8);
  L.e('goal', 189, 12);
  return L.done({});
}

// ---------------------------------------------------------------- 1-2 Caverns
function buildCave() {
  const L = new LB(206);
  L.fill(0, 0, 205, 1, 'G');
  L.ground(0, 34); L.ground(39, 70); L.ground(84, 120); L.ground(125, 205);
  L.start(3, 12);

  L.fill(10, 2, 30, 5, 'G'); // low ceiling
  L.row(14, 9, '?B?B?');
  L.e('blob', 18, 12); L.e('blob', 20, 12);
  L.row(24, 9, 'BPB');
  L.e('spiky', 28, 12);
  L.arc(34, 10, 6, 2);

  L.e('bat', 44, 3); L.e('blob', 47, 12);
  L.row(45, 8, 'BBBBBB');
  L.row(46, 4, 'BMBB');
  L.e('spiky', 55, 12);
  // brick vault with medal
  L.fill(60, 9, 66, 9, 'B'); L.fill(60, 10, 60, 12, 'B'); L.fill(66, 10, 66, 12, 'B');
  L.e('medal', 63, 11, { id: 0 });
  L.coins(61, 12, 2); L.coins(64, 12, 2);
  L.row(62, 5, '?');
  L.e('bat', 68, 3);

  // pit with moving platforms
  L.e('platH', 72, 10, { range: 48, speed: 40 });
  L.e('platV', 79, 9, { range: 48, speed: 35 });
  L.coins(73, 8, 2); L.coins(79, 6, 2);
  L.e('checkpoint', 88, 12);

  L.pipe(92, 10); L.e('snapper', 92, 10);
  L.e('blob', 96, 12); L.e('shell', 99, 12);
  L.fill(98, 2, 112, 6, 'G');
  L.row(101, 9, 'B?BUB');
  L.e('spiky', 106, 12); L.e('bat', 110, 7);
  L.pipe(114, 9);
  L.e('medal', 120, 6, { id: 1 });
  L.row(119, 7, 'BBB');

  L.e('platFall', 122, 11);
  L.e('blob', 130, 12); L.e('blob', 132, 12); L.e('spiky', 136, 12);
  L.row(130, 9, '??');
  L.row(140, 9, 'BBBBBBBB');
  L.e('bat', 144, 3); L.e('bat', 150, 3);
  L.fill(150, 8, 151, 12, 'R');
  L.coins(146, 12, 4);
  L.e('hopper', 157, 12);
  L.row(160, 6, '=====');
  L.e('medal', 162, 2, { id: 2 });
  L.row(158, 9, 'B');
  L.e('blob', 168, 12); L.e('spiky', 172, 12);
  L.stairsUp(176, 6);
  L.e('goal', 188, 12);
  return L.done({});
}

// ---------------------------------------------------------------- 2-1 Dunes
function buildDesert() {
  const L = new LB(214);
  L.ground(0, 38); L.ground(42, 80); L.ground(85, 128); L.ground(133, 213);
  L.start(3, 12);

  L.row(11, 9, '?P?');
  L.e('hopper', 16, 12);
  L.fill(20, 11, 20, 12, 'C'); L.e('cannon', 20, 11);
  L.row(24, 12, '^^');
  L.e('blob', 28, 12);
  L.stairsUp(31, 4); // pyramid
  L.stairsDown(35, 4);
  L.e('medal', 34.5, 4, { id: 0 });
  L.arc(38, 9, 5, 2);

  L.e('shell', 46, 12); L.e('blob', 50, 12);
  L.row(48, 9, 'BMBB?B');
  L.fill(56, 10, 56, 12, 'C'); L.e('cannon', 56, 10);
  L.row(60, 12, '^^^');
  L.row(59, 8, '===');
  L.e('hopper', 66, 12);
  L.pipe(70, 10); L.e('snapper', 70, 10);
  L.e('blob', 74, 12); L.e('blob', 76, 12);
  L.e('platFall', 81, 10);
  L.coins(81, 8, 3);
  L.e('checkpoint', 89, 12);

  L.stairsUp(94, 5); L.stairsDown(99, 5);
  L.row(96, 4, 'BFB');
  L.fill(106, 11, 106, 12, 'C'); L.e('cannon', 106, 11);
  L.e('shell', 110, 12); L.e('hopper', 114, 12);
  L.row(112, 9, '?B?B');
  L.row(118, 12, '^^^^');
  L.row(117, 9, '======');
  L.e('medal', 120, 7, { id: 1 });
  L.e('spiky', 125, 12);
  L.e('platH', 129, 11, { range: 40, speed: 45 });

  L.e('blob', 138, 12); L.e('blob', 140, 12);
  L.fill(144, 10, 144, 12, 'C'); L.e('cannon', 144, 10);
  L.row(148, 9, 'BBUBB');
  L.e('hopper', 152, 12);
  L.pipe(156, 9);
  L.e('medal', 164, 3, { id: 2 });
  L.e('spring', 160, 12);
  L.row(162, 5, '=====');
  L.e('shell', 168, 12); L.e('spiky', 171, 12);
  L.stairsUp(178, 7);
  L.e('goal', 191, 12);
  return L.done({});
}

// ---------------------------------------------------------------- 2-2 Frost
function buildIce() {
  const L = new LB(210);
  L.ground(0, 36); L.ground(40, 66); L.ground(71, 101); L.ground(110, 140); L.ground(144, 209);
  L.start(3, 12);

  L.row(10, 9, '?P?B');
  L.e('blob', 16, 12);
  L.e('icicle', 20, 5);
  L.row(18, 4, 'RRRRR');
  L.e('spiky', 24, 12);
  L.e('icicle', 28, 6); L.row(27, 5, 'RRR');
  L.e('shell', 32, 12);
  L.arc(36, 10, 5, 2);

  L.e('bat', 46, 4); L.e('blob', 50, 12);
  L.row(44, 9, 'BB?BB');
  L.row(52, 6, 'BBB');
  L.e('medal', 53, 4, { id: 0 });
  L.e('icicle', 58, 4); L.set(58, 3, 'R');
  L.e('spiky', 60, 12); L.e('blob', 63, 12);
  L.e('platV', 68, 10, { range: 40, speed: 30 });

  L.e('checkpoint', 74, 12);
  L.pipe(78, 10); L.e('snapper', 78, 10);
  L.e('shell', 83, 12); L.e('blob', 86, 12);
  L.row(84, 9, '?M?');
  L.e('bat', 90, 3); L.e('bat', 96, 5);
  L.row(88, 6, '====');
  L.e('medal', 89, 4, { id: 1 });
  L.e('platH', 103, 11, { range: 40, speed: 40 });

  L.e('hopper', 114, 12);
  L.e('icicle', 118, 3); L.e('icicle', 120, 3); L.e('icicle', 122, 3);
  L.row(117, 2, 'RRRRRR');
  L.row(124, 9, 'BBSBB');
  L.e('spiky', 128, 12); L.e('blob', 131, 12); L.e('blob', 133, 12);
  L.e('platFall', 141, 11);

  L.e('shell', 148, 12);
  L.row(150, 9, 'B?B?B');
  L.row(152, 5, 'U');
  L.e('bat', 156, 3);
  L.e('spring', 162, 12);
  L.row(164, 3, '=====');
  L.e('medal', 166, 1, { id: 2 });
  L.e('spiky', 168, 12); L.e('blob', 172, 12);
  L.stairsUp(178, 6);
  L.e('goal', 190, 12);
  return L.done({});
}

// ---------------------------------------------------------------- 3-1 Sky
function buildSky() {
  const L = new LB(218);
  L.ground(0, 18); L.ground(24, 30); L.ground(40, 46, 11); L.ground(58, 70); L.ground(84, 92, 12);
  L.ground(104, 118); L.ground(132, 140, 11); L.ground(152, 160); L.ground(176, 217);
  L.start(3, 12);

  L.row(8, 9, 'F?P');
  L.e('blob', 14, 12);
  L.row(19, 10, '====');
  L.e('hopper', 27, 12);
  L.row(32, 10, '====');
  L.row(36, 8, '===');
  L.coins(32, 9, 4);
  L.e('blob', 43, 10);
  L.e('platH', 48, 10, { range: 64, speed: 45 });
  L.coins(50, 7, 5);
  L.e('medal', 52, 4, { id: 0 });
  L.row(50, 6, '===');

  L.e('bat', 62, 6); L.e('blob', 64, 12); L.e('shell', 67, 12);
  L.row(61, 9, '?B?');
  L.e('platV', 73, 9, { range: 56, speed: 35 });
  L.e('platV', 78, 8, { range: 56, speed: 35, phase: 1 });
  L.e('checkpoint', 86, 11);
  L.e('platFall', 95, 11); L.e('platFall', 99, 10);
  L.e('bat', 98, 4);

  L.e('blob', 108, 12); L.e('hopper', 112, 12);
  L.row(106, 9, 'BMB');
  L.row(110, 5, 'S');
  L.e('spring', 116, 12);
  L.row(118, 3, '=====');
  L.e('medal', 121, 1, { id: 1 });
  L.e('platH', 121, 11, { range: 64, speed: 50 });
  L.e('bat', 128, 6);
  L.e('spiky', 136, 10);
  L.e('platFall', 143, 10); L.e('platFall', 147, 11);

  L.e('blob', 155, 12); L.e('shell', 157, 12);
  L.row(154, 9, '?U?');
  L.e('platH', 163, 10, { range: 128, speed: 55 });
  L.e('bat', 168, 4); L.e('bat', 172, 7);
  L.coins(165, 7, 6);
  L.row(170, 6, '===');
  L.e('medal', 171, 4, { id: 2 });
  L.e('hopper', 182, 12);
  L.stairsUp(186, 6);
  L.e('goal', 198, 12);
  return L.done({});
}

// ---------------------------------------------------------------- 3-2 Castle (boss)
function buildCastle() {
  const L = new LB(232);
  L.fill(0, 0, 231, 1, 'G');
  L.ground(0, 231);
  L.start(3, 12);

  L.fill(0, 2, 8, 4, 'G');
  L.row(10, 9, '?P?');
  L.lava(16, 19); L.e('lavabub', 17, 14); L.e('lavabub', 18.5, 14, { delay: 1.2 });
  L.e('crusher', 24, 2);
  L.e('blob', 28, 12);
  L.lava(32, 36); L.row(33, 9, '==='); L.e('lavabub', 34, 14, { delay: 0.6 });
  L.e('crusher', 41, 2);
  L.e('spiky', 45, 12);
  L.row(42, 10, 'R');
  L.row(44, 9, 'RRRR');
  L.e('medal', 45.5, 7, { id: 0 });
  L.lava(50, 56); L.e('platH', 51, 10, { range: 64, speed: 45 }); L.e('lavabub', 53, 14);

  L.row(60, 9, 'BPB');
  L.e('shell', 62, 12); L.e('blob', 66, 12);
  L.row(70, 12, '^^^');
  L.e('crusher', 75, 2); L.e('crusher', 80, 2);
  L.e('checkpoint', 86, 12);

  L.fill(90, 2, 110, 6, 'G');
  L.e('spiky', 94, 12); L.e('spiky', 100, 12);
  L.row(96, 9, 'B?B?B');
  L.lava(112, 120);
  L.row(113, 10, '==');
  L.row(117, 9, '==');
  L.e('lavabub', 115, 14); L.e('lavabub', 119, 14, { delay: 0.9 });
  L.e('medal', 117, 5, { id: 1 });
  L.e('blob', 124, 12); L.e('hopper', 128, 12);
  L.e('crusher', 132, 2);
  L.row(136, 12, '^^^^');
  L.row(135, 9, '======');
  L.lava(144, 152); L.e('platFall', 145, 11); L.e('platFall', 149, 10); L.e('lavabub', 147, 14);
  L.e('shell', 156, 12);
  L.row(158, 9, 'BMBUB');
  L.fill(165, 6, 169, 6, 'R');
  L.e('medal', 167, 4, { id: 2 });
  L.e('crusher', 177, 2);
  L.e('bat', 174, 4);
  L.e('checkpoint', 182, 12);
  L.row(184, 9, '?P?');

  // Boss arena: x 196..231
  L.fill(195, 2, 196, 7, 'R');
  L.fill(230, 2, 231, 12, 'R');
  L.row(203, 9, '===');
  L.row(219, 9, '===');
  L.e('boss', 220, 12);
  return L.done({ arena: { x0: 197, x1: 229 } });
}

// ---------------------------------------------------------------- Bonus vault
function buildBonus() {
  const L = new LB(150);
  L.ground(0, 30); L.ground(36, 70); L.ground(76, 110); L.ground(116, 149);
  L.start(3, 12);
  L.row(6, 9, 'MMM');
  for (let i = 0; i < 4; i++) L.arc(10 + i * 5, 10, 4, 3);
  L.e('spring', 30, 12);
  L.coins(31, 3, 6);
  L.row(32, 6, '====');
  L.e('medal', 33, 4, { id: 0 });
  L.row(40, 9, 'S');
  L.fill(44, 6, 60, 6, 'c'); L.fill(44, 8, 60, 8, 'c');
  L.e('gem', 52, 11); L.e('gem', 58, 11);
  L.e('blob', 50, 12); L.e('blob', 56, 12); L.e('blob', 62, 12);
  L.e('platH', 71, 10, { range: 48, speed: 50 });
  L.coins(71, 7, 5);
  L.row(80, 9, 'MMBMM');
  L.row(80, 5, '=====');
  L.e('medal', 82, 3, { id: 1 });
  L.e('hopper', 90, 12);
  L.e('gem', 95, 9);
  for (let i = 0; i < 3; i++) L.arc(96 + i * 4, 10, 4, 3);
  L.e('platV', 112, 5, { range: 112, speed: 40 });
  L.e('medal', 112.5, 1, { id: 2 });
  L.fill(118, 10, 130, 11, 'c');
  L.e('gem', 139, 11);
  L.stairsUp(132, 5);
  L.e('goal', 142, 12);
  return L.done({});
}

const STAGES = [
  { id: '1-1', name: 'Meadow Hills', theme: 'meadow', music: 'meadow', time: 300, par: 95, build: buildMeadow, blurb: 'Rolling green hills and a gentle breeze.' },
  { id: '1-2', name: 'Burrow Caverns', theme: 'cave', music: 'cave', time: 300, par: 110, build: buildCave, blurb: 'Glowing crystals light the dark tunnels.' },
  { id: '2-1', name: 'Sunscorch Dunes', theme: 'desert', music: 'desert', time: 300, par: 110, build: buildDesert, blurb: 'Seed cannons guard the shifting sands.' },
  { id: '2-2', name: 'Frostbite Peaks', theme: 'ice', music: 'ice', time: 300, par: 110, build: buildIce, blurb: 'Slippery slopes and falling icicles.' },
  { id: '3-1', name: 'Skyward Gardens', theme: 'sky', music: 'sky', time: 300, par: 115, build: buildSky, blurb: 'Floating islands high above the clouds.' },
  { id: '3-2', name: 'Magmaw Keep', theme: 'castle', music: 'castle', time: 400, par: 170, build: buildCastle, boss: true, blurb: 'Lava, crushers and the fearsome Magmaw.' },
  { id: '★', name: 'Starlight Vault', theme: 'bonus', music: 'bonus', time: 150, par: 70, build: buildBonus, requireMedals: 12, blurb: 'A secret treasure vault. Find 12 medals to open it.' },
];
