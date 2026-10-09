'use strict';
// Core game: level state, physics, camera, rendering, HUD and stage flow.

class Game {
  constructor(canvas, input) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.t = 0;
    this.mode = 'title'; // title | stage
    this.state = 'play'; // play | dying | goal | over
    this.paused = false;
    this.ents = []; this.parts = [];
    this.camX = 0; this.camY = 0; this.shakeT = 0; this.shakeMag = 0;
    this.titleX = 0;
    this.onClear = null; this.onGameOver = null;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cv.width = Math.floor(window.innerWidth * dpr);
    this.cv.height = Math.floor(window.innerHeight * dpr);
    this.S = Math.min(this.cv.height / 240, this.cv.width / 224);
    this.viewW = this.cv.width / this.S;
    this.viewH = this.cv.height / this.S;
    this.ctx.imageSmoothingEnabled = true;
  }

  sfx(n) { Sound.sfx(n); }

  // ---------------------------------------------------------------- stage setup
  startStage(index) {
    const def = STAGES[index];
    this.stageIndex = index;
    this.def = def;
    this.level = def.build();
    this.themeName = def.theme;
    this.theme = THEMES[def.theme];
    this.upg = { ...Save.data.upgrades };
    this.skin = Save.skin();
    this.ents = []; this.parts = [];
    this.bumps = new Map(); this.multi = new Map();
    this.arenaOn = false; this.boss = null; this.goal = null;
    const lv = this.level;
    this.masks = [];
    for (let y = 0; y < lv.h; y++) {
      const row = [];
      for (let x = 0; x < lv.w; x++) {
        const gnd = (xx, yy) => (xx < 0 || xx >= lv.w || yy < 0 || yy >= lv.h ? true : lv.g[yy][xx] === 'G');
        row.push((gnd(x, y - 1) ? 0 : 1) | (gnd(x + 1, y) ? 0 : 2) | (gnd(x, y + 1) ? 0 : 4) | (gnd(x - 1, y) ? 0 : 8));
      }
      this.masks.push(row);
    }
    for (const s of lv.ents) this.spawn(s);
    this.buildDecor();
    const stageSave = Save.stage(def.id);
    this.sess = {
      lives: 3 + this.upg.lives, score: 0, coins: 0,
      medals: [false, false, false], prevMedals: stageSave.medals.slice(),
      time: def.time + this.upg.timer * 60, elapsed: 0, hit: false, deaths: 0,
    };
    this.checkpoint = { x: lv.start.x * TS + 2, y: (lv.start.y + 1) * TS };
    this.mode = 'stage';
    this.bannerT = 3;
    this.spawnPlayer(true);
    this.camX = U.clamp(this.player.cx - this.viewW * 0.4, 0, Math.max(0, lv.w * TS - this.viewW));
    this.paused = false;
    Sound.play(def.music);
  }

  spawnPlayer(first) {
    const p = new Player(this.checkpoint.x, this.checkpoint.y - 14);
    if (this.upg.startBig) p.setPower(1);
    if (first) this.shieldUsed = false;
    p.shield = this.upg.shield > 0 && !this.shieldUsed;
    p.invuln = first ? 0 : 1.5;
    this.player = p;
    this.state = 'play';
    this.sess.time = this.def.time + this.upg.timer * 60;
    if (!first && this.arenaOn) this.closeArena(false);
  }

  spawn(s) {
    const lv = this.level;
    const px = s.x * TS, py = s.y * TS;
    const foot = (w, h) => [px + (TS - w) / 2, py + TS - h];
    let e = null;
    switch (s.type) {
      case 'blob': e = new Blob(...foot(14, 12), false); break;
      case 'blobEdge': e = new Blob(...foot(14, 12), true); break;
      case 'spiky': e = new Spiky(...foot(14, 13)); break;
      case 'shell': e = new Shellbug(...foot(14, 16)); break;
      case 'hopper': e = new Hopper(...foot(14, 14)); break;
      case 'bat': e = new Bat(px + 1, py + 2); break;
      case 'snapper': e = new Snapper(px + TS, py); break;
      case 'crusher': e = new Crusher(px + 2, py); break;
      case 'cannon': e = new Cannon(s.x, s.y); break;
      case 'lavabub': e = new LavaBub(px + 2, lv.h, s.opt.delay); break;
      case 'icicle': e = new Icicle(px + 2, py); break;
      case 'boss': e = new Boss(...foot(40, 40)); this.boss = e; break;
      case 'medal': e = new Medal(px, py, s.opt.id); break;
      case 'gem': e = new Gem(px + 1, py + 1); break;
      case 'spring': e = new Spring(px, py); break;
      case 'platH': e = new Platform('h', px, py, s.opt); break;
      case 'platV': e = new Platform('v', px, py, s.opt); break;
      case 'platFall': e = new Platform('fall', px, py, s.opt); break;
      case 'checkpoint': e = new Checkpoint(px, py + TS - 32); break;
      case 'goal': e = new Goal(s.x, (s.y + 1) * TS); this.goal = e; break;
    }
    if (e) this.add(e);
  }

  buildDecor() {
    const lv = this.level, th = this.themeName;
    const rnd = U.rng(this.stageIndex * 7919 + 11);
    this.decor = [];
    const goalX = this.goal ? this.goal.tx : lv.w;
    const blocked = new Set();
    for (const s of lv.ents) blocked.add(Math.floor(s.x) + ',' + Math.floor(s.y));
    for (let x = 1; x < lv.w - 1; x++) {
      if (x > goalX - 2 && x < goalX + 9) continue;
      for (let y = 2; y < lv.h; y++) {
        if (lv.g[y][x] !== 'G' || lv.g[y - 1][x] !== '.') continue;
        const gx = x * TS + 8, gy = y * TS;
        const r = rnd();
        const flat = lv.g[y][x + 1] === 'G' && lv.g[y - 1][x + 1] === '.' && lv.g[y][x - 1] === 'G' && lv.g[y - 1][x - 1] === '.';
        const add = (k, o = {}) => this.decor.push({ x: gx + (o.dx || 0), y: gy, k, ...o });
        if (th === 'meadow' || th === 'sky') {
          const fl = th === 'sky' ? ['#ff7ab0', '#ffffff', '#ffd23f', '#9a7aff'] : ['#ff6a8a', '#ffffff', '#ffd23f', '#7aa8ff'];
          if (r < 0.05 && flat) add('bush', { s: 0.8 + rnd() * 0.5, berries: rnd() < 0.4, c: th === 'sky' ? '#ff9ad0' : undefined, c2: th === 'sky' ? '#e070a8' : undefined });
          else if (r < 0.085 && flat && !blocked.has(x + ',' + (y - 1))) add('tree', { s: 0.8 + rnd() * 0.4, c: th === 'sky' ? '#ffb0d8' : undefined, c2: th === 'sky' ? '#e880b8' : undefined });
          else if (r < 0.1 && th === 'meadow') add('fence');
          else if (r < 0.28) add('flower', { c: U.pick(fl), dx: rnd() * 6 - 3 });
          else if (r < 0.6) add('tuft', { dx: rnd() * 6 - 3, c: th === 'sky' ? '#5fc04a' : '#3fae32' });
        } else if (th === 'cave') {
          if (r < 0.1) add('crystal', { c: U.pick(['#55e6ff', '#c27bff', '#5affb2']) });
          else if (r < 0.2) add('mushroom', { c: U.pick(['#55e6ff', '#ff7ad8', '#ffe45a']), dx: rnd() * 6 - 3 });
          else if (r < 0.26) add('rock');
        } else if (th === 'desert') {
          if (r < 0.06 && flat) add('cactus');
          else if (r < 0.12) add('rock');
          else if (r < 0.24) add('tuft', { c: '#c8a050', dx: rnd() * 6 - 3 });
        } else if (th === 'ice') {
          if (r < 0.06 && flat && !blocked.has(x + ',' + (y - 1))) add('pine', { s: 0.7 + rnd() * 0.4 });
          else if (r < 0.075 && flat) add('snowman');
          else if (r < 0.11) add('rock');
        } else if (th === 'castle') {
          if (x % 9 === 0) add('torch');
          else if (r < 0.06) add('rock');
        } else if (th === 'bonus') {
          if (r < 0.14) add('crystal', { c: U.pick(['#66f0ff', '#ff7ad8', '#ffe45a']) });
          else if (r < 0.2) add('mushroom', { c: U.pick(['#66f0ff', '#ff7ad8']), dx: rnd() * 6 - 3 });
        }
        break;
      }
    }
    if (th === 'meadow') this.decor.push({ x: lv.start.x * TS + 40, y: 13 * TS, k: 'sign' });
  }

  add(e) { this.ents.push(e); return e; }
  countOf(cls) { let n = 0; for (const e of this.ents) if (e instanceof cls && !e.remove) n++; return n; }

  // ---------------------------------------------------------------- tiles & physics
  tile(tx, ty) {
    const lv = this.level;
    if (ty < 0 || ty >= lv.h || tx < 0 || tx >= lv.w) return '.';
    return lv.g[ty][tx];
  }
  setTile(tx, ty, c) { if (ty >= 0 && ty < this.level.h && tx >= 0 && tx < this.level.w) this.level.g[ty][tx] = c; }
  solidAt(tx, ty) {
    if (tx < 0 || tx >= this.level.w) return true;
    return SOLID.has(this.tile(tx, ty));
  }

  physics(e, dt, grav = GRAV, maxFall = MAX_FALL) {
    e.vy = Math.min(e.vy + grav * dt, maxFall);
    e.onGround = false; e.hitWall = 0; e.hitCeil = false; e.wallTile = null;
    this.moveX(e, e.vx * dt);
    this.moveY(e, e.vy * dt);
    if (e.isPlayer && e.vy >= 0) this.landOnPlatforms(e);
  }

  moveX(e, dx) {
    if (!dx) return;
    e.x += dx;
    const y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - 0.01) / TS);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w - 0.01) / TS);
      for (let ty = y0; ty <= y1; ty++) if (this.solidAt(tx, ty)) {
        e.x = tx * TS - e.w; e.hitWall = 1; e.wallTile = [tx, ty]; if (e.isPlayer) e.vx = 0; break;
      }
    } else {
      const tx = Math.floor(e.x / TS);
      for (let ty = y0; ty <= y1; ty++) if (this.solidAt(tx, ty)) {
        e.x = (tx + 1) * TS; e.hitWall = -1; e.wallTile = [tx, ty]; if (e.isPlayer) e.vx = 0; break;
      }
    }
  }

  moveY(e, dy) {
    if (!dy) return;
    const prevBottom = e.y + e.h;
    e.y += dy;
    const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 0.01) / TS);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h - 0.01) / TS);
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.tile(tx, ty);
        if (SOLID.has(c) || (c === '=' && prevBottom <= ty * TS + 0.5)) {
          e.y = ty * TS - e.h; e.vy = 0; e.onGround = true; break;
        }
      }
    } else {
      const ty = Math.floor(e.y / TS);
      let hit = -1;
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.tile(tx, ty);
        if (SOLID.has(c) || (c === 'H' && e.isPlayer)) {
          if (hit < 0 || Math.abs(tx * TS + 8 - e.cx) < Math.abs(hit * TS + 8 - e.cx)) hit = tx;
        }
      }
      if (hit >= 0) {
        e.y = (ty + 1) * TS; e.vy = 0; e.hitCeil = true;
        if (e.isPlayer) this.hitBlock(hit, ty, e, false);
      }
    }
  }

  landOnPlatforms(e) {
    for (const p of this.ents) {
      if (!p.isPlatform || p.respawn > 0 || p.dead) continue;
      if (e.x + e.w <= p.x + 1 || e.x >= p.x + p.w - 1) continue;
      const prev = e.prevBottom;
      if (prev <= p.y + Math.max(1, p.dy || 0) + 1.5 && e.bottom >= p.y) {
        e.y = p.y - e.h; e.vy = 0; e.onGround = true; e.riding = p;
      }
    }
  }

  // ---------------------------------------------------------------- block interactions
  hitBlock(tx, ty, who, strong) {
    const c = this.tile(tx, ty);
    const isP = who && who.isPlayer;
    const key = ty * this.level.w + tx;
    const bump = () => { this.bumps.set(key, 0); this.bumpKill(tx, ty); };
    if (c === '?') {
      this.setTile(tx, ty, 'X'); bump();
      this.add(new BlockCoin(tx * TS + 8, ty * TS - 8)); this.collectCoin(tx * TS + 8, ty * TS - 8, true);
    } else if (c === 'M') {
      let m = this.multi.get(key);
      if (!m) { m = { n: 0, t: this.t }; this.multi.set(key, m); }
      m.n++; bump();
      this.add(new BlockCoin(tx * TS + 8, ty * TS - 8)); this.collectCoin(tx * TS + 8, ty * TS - 8, true);
      if (m.n >= 10 || this.t - m.t > 5) this.setTile(tx, ty, 'X');
    } else if (c === 'P' || c === 'F' || c === 'S' || c === 'U' || c === 'H') {
      this.setTile(tx, ty, 'X'); bump();
      const p = this.player;
      const kind = c === 'P' ? (p.power === 0 ? 'berry' : 'ember') : c === 'F' ? 'feather' : c === 'S' ? 'star' : 'life';
      this.add(new PowerUp(kind, tx * TS, ty * TS));
      this.sfx('sprout');
    } else if (c === 'B') {
      if ((isP && (who.power > 0 || strong)) || (!isP && strong)) {
        this.setTile(tx, ty, '.');
        this.bumpKill(tx, ty);
        for (let i = 0; i < 4; i++) this.debris(tx * TS + 4 + (i % 2) * 8, ty * TS + 4 + Math.floor(i / 2) * 8, this.theme.brick[0], (i % 2 ? 1 : -1) * U.rand(40, 90), i < 2 ? -320 : -220);
        this.sfx('brk'); this.addScore(50); Save.stat('bricks');
      } else { bump(); this.sfx('bump'); }
    } else if (isP && !strong && SOLID.has(c)) {
      this.sfx('bump');
    }
  }

  bumpKill(tx, ty) {
    const top = ty * TS;
    for (const e of this.ents) {
      const onTop = Math.abs(e.bottom - top) < 4 && e.x + e.w > tx * TS && e.x < tx * TS + TS;
      if (!onTop) continue;
      if (e instanceof PowerUp && e.emerge <= 0) { e.vy = -220; continue; }
      if (!e.isEnemy || e.dead || e.isBoss || e instanceof Crusher || e instanceof Snapper) continue;
      e.kill(this, 'flip', e.cx < tx * TS + 8 ? -1 : 1); this.addScore(100, e.cx, e.y); this.sfx('kick');
    }
    if (this.tile(tx, ty - 1) === 'c') { this.setTile(tx, ty - 1, '.'); this.add(new BlockCoin(tx * TS + 8, (ty - 1) * TS)); this.collectCoin(tx * TS + 8, (ty - 1) * TS, true); }
  }

  // ---------------------------------------------------------------- scoring & rewards
  addScore(n, x, y) {
    this.sess.score += n;
    if (x !== undefined) this.popText(x, y, String(n), '#ffffff');
  }
  stompScore(e, p) {
    const i = p.combo;
    p.combo++;
    Save.stat('stomps');
    this.sfx('stomp');
    if (i >= STOMP_CHAIN.length) { this.oneUp(e.cx, e.y); Save.stat('comboUps'); return; }
    this.addScore(STOMP_CHAIN[i], e.cx, e.y);
    for (let k = 0; k < 5; k++) this.puff(e.cx, e.y + 4, U.rand(-70, 70), U.rand(-60, 0), '#ffffff');
  }
  oneUp(x, y) { this.sess.lives++; this.sfx('oneup'); this.popText(x, y, '1UP', '#7aff8a'); }
  collectCoin(x, y, silentFx) {
    this.sess.coins++;
    Save.stat('coins');
    this.sess.score += 50;
    this.sfx('coin');
    if (!silentFx) this.spark(x, y, '#fff3a0', 5);
    if (this.sess.coins % 100 === 0) this.oneUp(x, y - 10);
  }
  collectPower(kind, item) {
    const p = this.player;
    const x = item.cx, y = item.y;
    if (kind === 'berry') { if (p.power === 0) { p.setPower(1); this.sfx('power'); } else this.sfx('power'); this.addScore(1000, x, y); }
    else if (kind === 'ember') { if (p.power === 0) p.setPower(2); else p.power = 2; this.sfx('power'); this.addScore(1000, x, y); }
    else if (kind === 'feather') { if (p.power === 0) p.setPower(3); else p.power = 3; this.sfx('power'); this.addScore(1000, x, y); }
    else if (kind === 'star') { p.star = 10; this.sfx('power'); Sound.play('star'); this.addScore(1000, x, y); }
    else if (kind === 'life') { this.oneUp(x, y); }
    p.sx = 1.3; p.sy = 0.8;
    for (let i = 0; i < 14; i++) this.spark(p.cx + U.rand(-10, 10), p.cy + U.rand(-12, 12), U.pick(['#fff3a0', '#ffffff', '#ffd23f']));
  }
  collectMedal(id, x, y) {
    this.sess.medals[id] = true;
    this.sfx('medal');
    this.addScore(2000, x, y - 8);
    for (let i = 0; i < 24; i++) this.spark(x, y, U.pick(['#ffd23f', '#ffffff', '#ff9f1a']), 1, 160);
  }
  savedMedal(id) { return this.sess.prevMedals[id]; }

  resumeMusic() { if (this.mode === 'stage') Sound.play(this.arenaOn ? 'boss' : this.def.music); }

  // ---------------------------------------------------------------- particles
  spark(x, y, color, n = 1, sp = 60) {
    for (let i = 0; i < n; i++) this.parts.push({ x, y, vx: U.rand(-sp, sp), vy: U.rand(-sp, sp * 0.4), life: U.rand(0.3, 0.6), max: 0.6, size: U.rand(1, 2.2), color, type: 'spark', g: 60 });
  }
  puff(x, y, vx, vy, color) {
    this.parts.push({ x, y, vx, vy, life: U.rand(0.3, 0.55), max: 0.55, size: U.rand(2, 4), color, type: 'puff', g: -20 });
  }
  dust(x, y, n) {
    for (let i = 0; i < n; i++) this.parts.push({ x: x + U.rand(-4, 4), y: y - 1, vx: U.rand(-30, 30), vy: U.rand(-30, -5), life: U.rand(0.25, 0.45), max: 0.45, size: U.rand(1.5, 3), color: this.mode === 'stage' && this.theme.style === 'snow' ? '#ffffff' : 'rgba(255,255,255,0.8)', type: 'puff', g: 0 });
  }
  debris(x, y, color, vx = U.rand(-100, 100), vy = U.rand(-300, -150)) {
    this.parts.push({ x, y, vx, vy, life: 1.2, max: 1.2, size: 4, color, type: 'debris', g: 1100, rot: 0, vr: U.rand(-12, 12) });
  }
  popText(x, y, text, color) {
    this.parts.push({ x, y, vx: 0, vy: -40, life: 0.9, max: 0.9, size: 7, color, type: 'text', text, g: 0 });
  }
  firework(x, y) {
    const hue = U.randi(0, 360);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, s = U.rand(80, 140);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2, max: 1.2, size: 2, color: `hsl(${hue + U.randi(-20, 20)},100%,65%)`, type: 'spark', g: 90 });
    }
    this.sfx('firework');
  }
  shake(m) { if (!Save.data.settings.shake) return; this.shakeMag = Math.max(this.shakeMag, m); this.shakeT = 0.3; }

  onScreen(e, margin = 0) {
    return e.x + e.w > this.camX - margin && e.x < this.camX + this.viewW + margin;
  }

  // ---------------------------------------------------------------- flow
  setCheckpoint(cp) { this.checkpoint = { x: cp.x, y: cp.y + cp.h }; }

  playerDie(fell) {
    if (this.state !== 'play') return;
    const p = this.player;
    this.state = 'dying';
    this.dieT = fell ? 1.6 : 2.6;
    p.dead = true; p.vx = 0; p.vy = fell ? 0 : -380; p.star = 0;
    this.sess.deaths++; Save.stat('deaths');
    Sound.stop();
    this.sfx('die');
  }

  startGoal(goal, p) {
    this.state = 'goal';
    this.goalSeq = { phase: 'slide', t: 0, goal };
    const h = goal.y + goal.h - p.bottom;
    const ratio = U.clamp(h / goal.h, 0, 1);
    const bonus = [100, 400, 800, 2000, 5000][Math.min(4, Math.floor(ratio * 5))];
    this.addScore(bonus, p.cx, p.y - 8);
    p.x = goal.x - p.w + 3; p.vx = 0; p.vy = 0; p.facing = 1; p.pounding = false;
    Sound.stop(); this.sfx('flag');
  }

  startCrownClear(p) {
    this.state = 'goal';
    this.goalSeq = { phase: 'crown', t: 0 };
    p.vx = 0;
    Sound.stop(); this.sfx('clear');
    this.addScore(10000, p.cx, p.y - 10);
  }

  bossDefeated() {
    Save.stat('bossWins');
    Sound.stop();
    this.addScore(5000, this.boss.cx, this.boss.y);
    const ar = this.level.arena;
    setTimeout(() => {
      if (this.mode !== 'stage') return;
      this.add(new Crown(((ar.x0 + ar.x1) / 2) * TS, 3 * TS));
      this.sfx('sprout');
      Sound.play('bonus');
    }, 1400);
  }

  closeArena(close) {
    const ar = this.level.arena;
    for (let y = 8; y <= 12; y++) this.setTile(ar.x0 - 1, y, close ? 'R' : '.');
    this.arenaOn = close;
    if (!close && this.boss && !this.boss.dead) this.boss.reset();
    for (const e of this.ents) if (e instanceof BossFire) e.remove = true;
  }

  finishStage() {
    const def = this.def, s = this.sess, st = Save.stage(def.id);
    const elapsed = s.elapsed;
    const newStars = [true, false, false];
    const medalsAll = [0, 1, 2].map((i) => st.medals[i] || s.medals[i]);
    newStars[1] = medalsAll.every(Boolean);
    newStars[2] = elapsed <= def.par;
    let bonusCoins = 0;
    const firstClear = !st.cleared;
    if (firstClear) bonusCoins += 50;
    const gained = [];
    for (let i = 0; i < 3; i++) if (newStars[i] && !st.stars[i]) { gained.push(i); bonusCoins += 25; }
    const newBest = s.score > st.best;
    st.cleared = true;
    st.stars = st.stars.map((v, i) => v || newStars[i]);
    st.medals = medalsAll;
    st.best = Math.max(st.best, s.score);
    st.bestTime = st.bestTime ? Math.min(st.bestTime, elapsed) : elapsed;
    Save.data.coins += s.coins + bonusCoins;
    Save.stat('cleared');
    if (!s.hit) Save.stat('flawless');
    if (newStars[2]) Save.stat('parClears');
    const xp = Math.floor(s.score / 20) + 60 * newStars.filter(Boolean).length;
    const levelUps = Save.addXP(xp);
    Save.save();
    const fresh = Save.checkAchievements();
    Save.save();
    this.mode = 'result';
    Sound.stop();
    this.onClear && this.onClear({
      def, score: s.score, coins: s.coins, medals: s.medals, savedMedals: medalsAll, time: elapsed, par: def.par,
      stars: newStars, allStars: st.stars, gained, bonusCoins, firstClear, newBest, xp, levelUps, flawless: !s.hit, achievements: fresh,
    });
  }

  gameOver() {
    const s = this.sess;
    Save.data.coins += s.coins;
    const st = Save.stage(this.def.id);
    st.medals = st.medals.map((v, i) => v || s.medals[i]);
    Save.save();
    const fresh = Save.checkAchievements();
    this.mode = 'result';
    Sound.stop(); this.sfx('gameover');
    this.onGameOver && this.onGameOver({ def: this.def, coins: s.coins, score: s.score, achievements: fresh });
  }

  quitStage() {
    // keep coins & medals collected when leaving
    if (this.mode !== 'stage') return;
    const s = this.sess;
    Save.data.coins += s.coins;
    const st = Save.stage(this.def.id);
    st.medals = st.medals.map((v, i) => v || s.medals[i]);
    Save.save();
    this.mode = 'title';
    Sound.play('title');
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    if (this.mode === 'title' || this.mode === 'result') { this.titleX += dt * 45; this.updateParts(dt); return; }
    if (this.paused) return;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeMag = 0; }
    for (const [k, v] of this.bumps) { const nv = v + dt; if (nv > 0.2) this.bumps.delete(k); else this.bumps.set(k, nv); }
    const p = this.player;

    if (this.state === 'play') {
      this.sess.time -= dt; this.sess.elapsed += dt;
      Save.data.stats.playTime += dt;
      if (this.sess.time <= 0) { this.sess.time = 0; this.playerDie(false); }
      // arena trigger
      const ar = this.level.arena;
      if (ar && !this.arenaOn && this.boss && !this.boss.dead && p.x > (ar.x0 + 1) * TS) {
        this.closeArena(true); this.boss.active = true; Sound.play('boss'); this.bannerT = 0;
      }
    }

    // platforms first so riders can follow
    for (const e of this.ents) if (e.isPlatform && !e.remove) e.update(this, dt);

    if (this.state === 'play') {
      p.update(this, dt);
    } else if (this.state === 'dying') {
      this.dieT -= dt;
      p.t += dt;
      if (this.dieT < 2.2) { p.vy += 1100 * dt; p.y += p.vy * dt; }
      if (this.dieT <= 0) {
        this.sess.lives--;
        if (this.sess.lives <= 0) { this.state = 'over'; this.gameOver(); return; }
        this.spawnPlayer(false);
        Sound.play(this.def.music);
      }
    } else if (this.state === 'goal') {
      this.updateGoal(dt);
    }

    const vw = this.viewW;
    for (const e of this.ents) {
      if (e.remove || e.isPlatform) continue;
      if (!e.active && e.x < this.camX + vw + 32 && e.x + e.w > this.camX - 32 && !e.isBoss) e.active = true;
      if (!e.active) continue;
      if (e.dead && e.updateDead) { e.updateDead(this, dt); continue; }
      if (this.state === 'dying' && e.isEnemy) continue;
      e.update(this, dt);
      if (e.isEnemy && !e.dead && !e.isBoss && e.y > this.level.h * TS + 32) e.remove = true;
    }

    if (this.state === 'play' && !p.dead) {
      for (const e of this.ents) {
        if (e.remove || !e.active || e === p) continue;
        if (e.touch && U.overlap(p, e)) e.touch(this, p);
        if (this.state !== 'play') break;
      }
      // walkers turn around when they meet
      const walkers = this.ents.filter((e) => e.isEnemy && e.active && !e.dead && e.dir !== undefined && (e instanceof Blob || e instanceof Spiky || (e instanceof Shellbug && e.mode === 'walk')));
      for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        if (U.overlap(a, b)) { if (a.cx < b.cx) { a.dir = -1; b.dir = 1; } else { a.dir = 1; b.dir = -1; } }
      }
    }

    this.ents = this.ents.filter((e) => !e.remove);
    this.updateParts(dt);
    this.ambient(dt);
    this.updateCamera(dt);
  }

  updateGoal(dt) {
    const p = this.player, q = this.goalSeq;
    q.t += dt;
    if (q.phase === 'slide') {
      const goal = q.goal;
      const ground = goal.y + goal.h;
      if (p.bottom < ground) p.y = Math.min(ground - p.h, p.y + 150 * dt);
      goal.flagY = Math.min(ground - 16, goal.flagY + 150 * dt);
      if (p.bottom >= ground - 0.1 && goal.flagY >= ground - 16.1 && q.t > 0.6) {
        q.phase = 'walk'; q.t = 0; p.x = goal.x + goal.w + 1; this.sfx('clear');
      }
    } else if (q.phase === 'walk') {
      p.vx = 75; p.facing = 1;
      p.prevBottom = p.bottom;
      this.physics(p, dt);
      p.phase += 75 * dt * 0.11;
      const door = (q.goal.tx + 6) * TS;
      if (p.cx >= door) { p.hidden = true; q.phase = 'tally'; q.t = 0; }
      if (q.t > 6) { p.hidden = true; q.phase = 'tally'; q.t = 0; }
    } else if (q.phase === 'crown') {
      p.vx = 0;
      if (q.t < 0.1) { p.vy = -300; }
      p.prevBottom = p.bottom;
      this.physics(p, dt);
      if (Math.random() < dt * 4) this.firework(this.camX + U.rand(40, this.viewW - 40), U.rand(30, 120));
      if (q.t > 2.5) { q.phase = 'tally'; q.t = 0; }
    } else if (q.phase === 'tally') {
      if (this.sess.time > 0) {
        const d = Math.min(this.sess.time, dt * 120);
        this.sess.time -= d; this.sess.score += Math.round(d * 10);
        if (Math.floor(this.t * 30) % 2 === 0) this.sfx('tick');
      } else { q.phase = 'fw'; q.t = 0; q.fw = 0; }
    } else if (q.phase === 'fw') {
      if (q.t > q.fw * 0.35 && q.fw < 4) { q.fw++; this.firework(this.camX + U.rand(60, this.viewW - 60), U.rand(30, 110)); }
      if (q.t > 2) { q.phase = 'done'; this.finishStage(); }
    }
  }

  updateParts(dt) {
    for (const p of this.parts) {
      p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'puff') { p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; }
      if (p.rot !== undefined) p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }

  ambient(dt) {
    const a = this.theme.amb, vw = this.viewW, x0 = this.camX;
    const rate = { petal: 1.5, firefly: 3, sand: 6, snow: 18, sparkle: 3, ember: 8, twinkle: 5 }[a] || 0;
    if (Math.random() > rate * dt) return;
    const P = { life: 4, max: 4, g: 0, size: 1.5 };
    if (a === 'snow') Object.assign(P, { x: x0 + U.rand(0, vw + 100), y: -5, vx: U.rand(-20, -5), vy: U.rand(20, 45), color: '#ffffff', type: 'snow', size: U.rand(1, 2.4), life: 7, max: 7 });
    else if (a === 'petal') Object.assign(P, { x: x0 + vw + 10, y: U.rand(0, 150), vx: U.rand(-50, -25), vy: U.rand(5, 20), color: U.pick(['#ffb0c8', '#ffffff', '#ffe08a']), type: 'petal', life: 9, max: 9, size: 2 });
    else if (a === 'firefly') Object.assign(P, { x: x0 + U.rand(0, vw), y: U.rand(40, 220), vx: U.rand(-8, 8), vy: U.rand(-8, 8), color: U.pick(['#9affd8', '#d4a8ff', '#ffe45a']), type: 'glow', size: 1.5 });
    else if (a === 'sand') Object.assign(P, { x: x0 + vw + 10, y: U.rand(100, 230), vx: U.rand(-120, -70), vy: U.rand(-5, 5), color: 'rgba(255,230,180,0.6)', type: 'streak', life: 4, max: 4 });
    else if (a === 'sparkle' || a === 'twinkle') Object.assign(P, { x: x0 + U.rand(0, vw), y: U.rand(0, 220), vx: 0, vy: -4, color: a === 'twinkle' ? U.pick(['#9af0ff', '#ffb0f0', '#ffffff']) : '#ffffff', type: 'twinkle', life: 1.6, max: 1.6, size: 2 });
    else if (a === 'ember') Object.assign(P, { x: x0 + U.rand(0, vw), y: 245, vx: U.rand(-10, 10), vy: U.rand(-40, -20), color: U.pick(['#ff8a2a', '#ffd23f', '#ff5a2a']), type: 'glow', size: 1.4, life: 5, max: 5 });
    else return;
    this.parts.push(P);
  }

  updateCamera(dt) {
    const p = this.player, lv = this.level;
    let minX = 0, maxX = lv.w * TS - this.viewW;
    if (this.arenaOn) {
      const ar = lv.arena;
      const aw = (ar.x1 - ar.x0 + 3) * TS;
      if (aw >= this.viewW) { minX = (ar.x0 - 1) * TS; maxX = (ar.x1 + 2) * TS - this.viewW; }
      else { minX = maxX = (ar.x0 - 1) * TS - (this.viewW - aw) / 2; }
    }
    this.lookX = U.lerp(this.lookX || 0, p.facing * 28 + p.vx * 0.12, 1 - Math.exp(-2 * dt));
    let target = p.cx - this.viewW * 0.45 + this.lookX;
    target = U.clamp(target, minX, Math.max(minX, maxX));
    this.camX = U.lerp(this.camX, target, 1 - Math.exp(-9 * dt));
    this.camX = U.clamp(this.camX, minX, Math.max(minX, maxX));
    const pad = this.touchOn ? U.clamp(this.viewH - 250, 0, 130) : 0;
    this.camY = lv.h * TS - this.viewH + pad;
  }

  // ---------------------------------------------------------------- render
  render() {
    const ctx = this.ctx, S = this.S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.mode !== 'stage') { this.renderTitle(); return; }
    const vw = this.viewW, vh = this.viewH;
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { sx = U.rand(-1, 1) * this.shakeMag; sy = U.rand(-1, 1) * this.shakeMag; }
    const camX = this.camX + sx, camY = this.camY + sy;

    ctx.setTransform(S, 0, 0, S, 0, 0);
    Art.drawSky(ctx, this.themeName, vw, vh, camX, this.t);
    Art.drawLayers(ctx, this.themeName, camX, camY, vw);

    // world space
    ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S);
    const x0 = Math.max(0, Math.floor(camX / TS) - 1), x1 = Math.min(this.level.w - 1, Math.ceil((camX + vw) / TS) + 1);
    for (const d of this.decor) if (d.x > camX - 40 && d.x < camX + vw + 40) Art.decor(ctx, d, this.t, this.themeName);
    if (this.goal) Art.hut(ctx, (this.goal.tx + 6) * TS, this.goal.y + this.goal.h, this.themeName);
    for (const e of this.ents) if (e.behind && this.onScreen(e, 40)) e.draw(ctx, this);

    this.drawTiles(x0, x1, camX, camY);

    ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S);
    for (let y = 0; y < this.level.h; y++) for (let x = x0; x <= x1; x++) {
      const c = this.level.g[y][x];
      if (c === 'c') Art.coin(ctx, x * TS + 8, y * TS + 8, this.t + x * 0.3);
    }
    for (const e of this.ents) if (!e.behind && !e.isPlayer && this.onScreen(e, 40)) e.draw(ctx, this);
    if (this.player) this.player.draw(ctx, this);
    this.drawLava(x0, x1);
    this.drawParts(ctx);

    // lighting
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const below = this.level.h * TS - camY;
    if (below < vh) {
      const gr = ctx.createLinearGradient(0, below, 0, vh);
      gr.addColorStop(0, this.theme.ground.deep); gr.addColorStop(1, '#0c0a1c');
      ctx.fillStyle = gr; ctx.fillRect(0, below, vw, vh - below);
    }
    if (this.theme.dark) this.drawDarkness(ctx, camX, camY);
    this.drawHUD(ctx);
  }

  drawTiles(x0, x1, camX, camY) {
    const ctx = this.ctx, S = this.S, lv = this.level, th = this.theme, tn = this.themeName;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fr = Math.floor(this.t * 7) % 6;
    const X = (wx) => Math.round((wx - camX) * S), Y = (wy) => Math.round((wy - camY) * S);
    for (let y = 0; y < lv.h; y++) {
      const row = lv.g[y];
      for (let x = x0; x <= x1; x++) {
        const c = row[x];
        let img = null;
        switch (c) {
          case 'G': img = Art.ground(tn, th, this.masks[y][x], (x * 7 + y * 3) % 2); break;
          case 'B': case 'U': case 'M': img = Art.brick(tn, th); break;
          case '?': case 'P': case 'F': case 'S': img = Art.lucky(th, fr); break;
          case 'X': img = Art.used(th); break;
          case 'R': img = Art.stone(tn, th); break;
          case '[': case ']': case '{': case '}': img = Art.pipe(tn, th, c); break;
          case '=': img = Art.oneway(tn, th, row[x - 1] !== '=' ? 1 : 0, row[x + 1] !== '=' ? 1 : 0); break;
          case '^': img = Art.spikes(tn); break;
          case 'C': img = Art.cannon(this.tile(x, y - 1) !== 'C'); break;
          default: continue;
        }
        let off = 0;
        const b = this.bumps.get(y * lv.w + x);
        if (b !== undefined) off = -Math.sin((b / 0.2) * Math.PI) * 5;
        const dx = X(x * TS), dy = Y(y * TS + off);
        ctx.drawImage(img, dx, dy, X((x + 1) * TS) - dx, Y((y + 1) * TS + off) - dy);
      }
    }
  }

  drawLava(x0, x1) {
    const ctx = this.ctx, lv = this.level;
    let any = false;
    for (let y = 0; y < lv.h; y++) for (let x = x0; x <= x1; x++) {
      const c = lv.g[y][x];
      if (c !== '~' && c !== '%') continue;
      any = true;
      const px = x * TS, py = y * TS;
      if (c === '%') { ctx.fillStyle = '#c8301a'; ctx.fillRect(px - 0.2, py - 0.2, TS + 0.4, TS + 0.4); ctx.fillStyle = 'rgba(255,140,40,0.35)'; ctx.fillRect(px + ((x * 5 + Math.floor(this.t * 2)) % 12), py + ((x * 3 + y) % 10), 3, 2); continue; }
      const gr = ctx.createLinearGradient(0, py, 0, py + TS);
      gr.addColorStop(0, '#ffd23f'); gr.addColorStop(0.3, '#ff7a1a'); gr.addColorStop(1, '#c8301a');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(px - 0.2, py + TS + 0.2);
      for (let i = 0; i <= 4; i++) { const wx = px + i * 4; ctx.lineTo(wx, py + 4 + Math.sin(this.t * 3 + wx * 0.25) * 1.6); }
      ctx.lineTo(px + TS + 0.2, py + TS + 0.2); ctx.fill();
      if (Math.random() < 0.01) this.spark(px + U.rand(0, 16), py + 4, '#ffd23f');
    }
    if (any) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gy = 13 * TS;
      const gr = ctx.createLinearGradient(0, gy - 40, 0, gy + 8);
      gr.addColorStop(0, 'rgba(255,90,20,0)'); gr.addColorStop(1, 'rgba(255,90,20,0.22)');
      for (let x = x0; x <= x1; x++) if (lv.g[13] && lv.g[13][x] === '~') { ctx.fillStyle = gr; ctx.fillRect(x * TS, gy - 40, TS, 48); }
      ctx.restore();
    }
  }

  drawParts(ctx) {
    for (const p of this.parts) {
      const a = U.clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      if (p.type === 'text') {
        ctx.font = `700 ${p.size}px Fredoka, sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      } else if (p.type === 'debris') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-p.size / 2, p.size / 4, p.size, p.size / 4); ctx.restore();
      } else if (p.type === 'puff') {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - a * 0.5), 0, 7); ctx.fill();
      } else if (p.type === 'glow') {
        ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(this.t * 4 + p.x));
        ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        p.vx += U.rand(-20, 20) * 0.016;
      } else if (p.type === 'petal') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(this.t * 2 + p.x * 0.1);
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, 7); ctx.fill(); ctx.restore();
        p.vy = Math.sin(this.t * 2 + p.x * 0.05) * 15;
      } else if (p.type === 'streak') {
        ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 8, 0.8);
      } else if (p.type === 'twinkle') {
        const s = Math.sin((1 - a) * Math.PI) * p.size;
        ctx.fillStyle = p.color; Art.sparkle(ctx, p.x, p.y, s * 1.6);
      } else if (p.type === 'snow') {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x + Math.sin(this.t * 1.5 + p.y * 0.05) * 4, p.y, p.size, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawDarkness(ctx, camX, camY) {
    const p = this.player, vw = this.viewW, vh = this.viewH;
    const px = p.cx - camX, py = p.cy - camY;
    const d = this.theme.dark;
    const r = p.power === 2 || p.star > 0 ? 190 : 140;
    const gr = ctx.createRadialGradient(px, py, 20, px, py, r);
    gr.addColorStop(0, 'rgba(4,2,16,0)'); gr.addColorStop(1, `rgba(4,2,16,${d})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh);
    // light sources
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, rad, col) => {
      const sx = x - camX, sy = y - camY;
      if (sx < -rad || sx > vw + rad) return;
      const g2 = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad);
      g2.addColorStop(0, col); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    };
    for (const dc of this.decor) {
      if (dc.k === 'crystal' || dc.k === 'mushroom') glow(dc.x, dc.y - 6, 28, dc.c + '40');
      else if (dc.k === 'torch') glow(dc.x, dc.y - 18, 46, 'rgba(255,150,60,0.28)');
    }
    for (const e of this.ents) {
      if (e instanceof Fireball || e instanceof LavaBub || e instanceof BossFire) glow(e.cx, e.cy, 40, 'rgba(255,140,40,0.35)');
      else if (e instanceof Medal) glow(e.cx, e.cy, 30, 'rgba(255,230,120,0.3)');
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  drawHUD(ctx) {
    const s = this.sess, vw = this.viewW;
    const pill = (x, y, w, h) => { ctx.fillStyle = 'rgba(10,12,40,0.45)'; U.roundRect(ctx, x, y, w, h, h / 2); ctx.fill(); };
    const txt = (t, x, y, size = 9, color = '#fff', align = 'left') => {
      ctx.font = `700 ${size}px Fredoka, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(t, x, y);
      ctx.fillStyle = color; ctx.fillText(t, x, y);
    };
    // left: lives + coins
    pill(5, 5, 98, 17);
    ctx.save(); ctx.translate(14, 13.5); ctx.fillStyle = '#e8304a';
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.bezierCurveTo(-7, 0, -5, -6, 0, -2.5); ctx.bezierCurveTo(5, -6, 7, 0, 0, 5); ctx.fill(); ctx.restore();
    txt('×' + s.lives, 21, 14, 9);
    Art.coin(ctx, 49, 13.5, this.t, 0.8);
    txt('×' + String(s.coins).padStart(2, '0'), 55, 14, 9);
    // medals
    pill(5, 25, 50, 15);
    for (let i = 0; i < 3; i++) {
      const got = s.medals[i], prev = s.prevMedals[i];
      ctx.save(); ctx.translate(15 + i * 15, 32.5);
      ctx.globalAlpha = got ? 1 : prev ? 0.45 : 0.25;
      ctx.fillStyle = got || prev ? '#ffd23f' : '#ffffff'; U.star(ctx, 0, 0, 5, 5.2, 2.3); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // power status
    let px = 60;
    const p = this.player;
    if (p && p.shield) { pill(px, 25, 15, 15); ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px + 7.5, 32.5, 4.5, 0, 7); ctx.stroke(); px += 18; }
    if (p && p.star > 0) { pill(px, 25, 34, 15); Art.power(ctx, 'star', px + 8, 32.5, this.t); ctx.fillStyle = '#ffd23f'; ctx.fillRect(px + 15, 31, 15 * (p.star / 10), 3); px += 37; }
    if (p && p.power >= 2) { pill(px, 25, 15, 15); Art.power(ctx, p.power === 2 ? 'ember' : 'feather', px + 7.5, 33, this.t); }
    // right: score + time
    const rx = vw - (48 * this.dpr) / this.S;
    pill(rx - 92, 5, 90, 17);
    txt(String(s.score).padStart(7, '0'), rx - 86, 14, 9);
    ctx.save(); ctx.translate(rx - 28, 13.5);
    ctx.strokeStyle = s.time < 60 ? '#ff6a6a' : '#ffffff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -2.6); ctx.moveTo(0, 0); ctx.lineTo(2, 0.8); ctx.stroke(); ctx.restore();
    txt(String(Math.ceil(s.time)), rx - 21, 14, 9, s.time < 60 && Math.floor(this.t * 4) % 2 ? '#ff6a6a' : '#ffffff');
    // stage banner
    if (this.bannerT > 0) {
      const a = U.clamp(this.bannerT, 0, 1);
      ctx.globalAlpha = a;
      const cy = 70 + (1 - U.clamp(3 - this.bannerT, 0, 0.4) / 0.4) * -20;
      pill(vw / 2 - 90, cy - 18, 180, 36);
      txt('STAGE ' + this.def.id, vw / 2, cy - 7, 8, '#ffd23f', 'center');
      txt(this.def.name, vw / 2, cy + 6, 13, '#ffffff', 'center');
      ctx.globalAlpha = 1;
    }
    // boss bar
    if (this.arenaOn && this.boss && !this.boss.dead) {
      const bw = 120, bx = vw / 2 - bw / 2;
      pill(bx - 6, 26, bw + 12, 16);
      txt('MAGMAW', vw / 2, 30.5, 6, '#ffb06a', 'center');
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; U.roundRect(ctx, bx, 34.5, bw, 4.5, 2); ctx.fill();
      ctx.fillStyle = '#ff5a2a'; U.roundRect(ctx, bx, 34.5, bw * Math.max(0, this.boss.hp / this.boss.maxHp), 4.5, 2); ctx.fill();
    }
    if (this.state === 'goal' && this.goalSeq && (this.goalSeq.phase === 'tally' || this.goalSeq.phase === 'fw' || this.goalSeq.phase === 'crown')) {
      txt('STAGE CLEAR!', vw / 2, 80, 20, '#ffd23f', 'center');
    }
  }

  // ---------------------------------------------------------------- title scene
  renderTitle() {
    const ctx = this.ctx, S = this.S;
    const theme = 'meadow', th = THEMES[theme];
    const vw = this.viewW, vh = this.viewH;
    const camX = this.titleX;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    Art.drawSky(ctx, theme, vw, vh, camX, this.t);
    Art.drawLayers(ctx, theme, camX, 240 - vh, vw);
    const baseY = vh - 2 * TS;
    const x0 = Math.floor(camX / TS) - 1;
    for (let i = 0; i < Math.ceil(vw / TS) + 3; i++) {
      const tx = x0 + i;
      for (let r = 0; r < 2; r++) {
        const img = Art.ground(theme, th, r === 0 ? 1 : 0, (tx * 7 + r * 3) % 2 === 0 ? 0 : 1);
        ctx.drawImage(img, tx * TS - camX, baseY + r * TS, TS + 0.3, TS + 0.3);
      }
      const h = U.hash(tx, 3);
      ctx.save(); ctx.translate(-camX, 0);
      if (h < 0.08) Art.decor(ctx, { x: tx * TS + 8, y: baseY, k: 'bush', s: 0.9, berries: h < 0.04 }, this.t, theme);
      else if (h < 0.12) Art.decor(ctx, { x: tx * TS + 8, y: baseY, k: 'tree', s: 1 }, this.t, theme);
      else if (h < 0.35) Art.decor(ctx, { x: tx * TS + 8, y: baseY, k: 'flower', c: ['#ff6a8a', '#ffd23f', '#ffffff'][Math.floor(h * 100) % 3] }, this.t, theme);
      else if (h < 0.7) Art.decor(ctx, { x: tx * TS + 8, y: baseY, k: 'tuft' }, this.t, theme);
      ctx.restore();
    }
    const hop = Math.max(0, Math.sin(this.t * 2.2)) ** 6 * 26;
    Art.hero(ctx, { x: vw * 0.2, y: baseY - hop, s: 1.1, facing: 1, state: hop > 2 ? 'jump' : 'run', phase: this.t * 14, t: this.t, skin: Save.skin(), power: 0, vx: 150, blink: false });
    Art.blob(ctx, { x: vw * 0.2 + 70 - ((this.t * 20) % 40), y: baseY - 12, w: 14, h: 12, vx: -1 }, this.t, th.enemy);
    ctx.fillStyle = 'rgba(10,12,40,0.25)'; ctx.fillRect(0, 0, vw, vh);
    this.drawParts(ctx);
  }
}
