'use strict';
// Game objects. Coordinates are world pixels; (x, y) is the top-left of the hitbox.

const GRAV = 1500;
const MAX_FALL = 420;
const STOMP_CHAIN = [100, 200, 400, 800, 1000, 2000, 4000, 8000];

class Ent {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0; this.t = Math.random() * 10;
    this.onGround = false; this.hitWall = 0; this.hitCeil = false;
    this.remove = false; this.active = true; this.facing = 1;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  get bottom() { return this.y + this.h; }
  update() {}
  draw() {}
  touch() {}
}

// ======================================================================== Player
class Player extends Ent {
  constructor(x, y) {
    super(x, y, 12, 14);
    this.isPlayer = true;
    this.power = 0; this.invuln = 0; this.star = 0; this.shield = false;
    this.combo = 0; this.phase = 0; this.coyote = 0; this.jbuf = 0; this.airJumps = 0;
    this.jumping = false; this.pounding = false; this.poundT = 0; this.fireCd = 0;
    this.blinkT = 2; this.hidden = false; this.riding = null; this.sx = 1; this.sy = 1;
    this.prevBottom = this.bottom; this.dead = false; this.frozen = false; this.glide = false;
  }

  setPower(p) {
    const was = this.h;
    this.power = p;
    this.h = p > 0 ? 26 : 14;
    this.y += was - this.h;
  }

  canDouble(g) { return this.power === 3 || g.upg.boots > 0; }

  update(g, dt) {
    const I = g.input;
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.star > 0) {
      this.star -= dt;
      if (Math.random() < 0.5) g.spark(this.cx + U.rand(-8, 8), this.cy + U.rand(-10, 10), `hsl(${U.randi(0, 360)},100%,70%)`);
      if (this.star <= 0) g.resumeMusic();
    }
    if (this.fireCd > 0) this.fireCd -= dt;
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = U.rand(2, 4);
    this.sx = U.approach(this.sx, 1, dt * 4); this.sy = U.approach(this.sy, 1, dt * 4);

    // carried by platform
    if (this.riding) {
      const p = this.riding;
      g.moveX(this, p.dx);
      this.y = p.y - this.h;
      this.riding = null;
    }
    this.prevBottom = this.bottom;

    if (I.pressed.jump) this.jbuf = 0.13; else this.jbuf -= dt;

    const dir = (I.held.right ? 1 : 0) - (I.held.left ? 1 : 0);
    const slippery = g.theme.slippery;
    const running = I.held.run;
    const maxV = running ? 172 : 104;
    if (this.pounding) {
      this.vx = 0;
    } else if (dir) {
      let acc = this.onGround ? (slippery ? 260 : 640) : 460;
      if (this.onGround && Math.sign(this.vx) === -dir && Math.abs(this.vx) > 40) {
        acc = slippery ? 380 : 1300;
        if (Math.random() < 0.4) g.dust(this.cx, this.bottom, 1);
      }
      if (Math.abs(this.vx) > maxV && Math.sign(this.vx) === dir) acc = 200; // coast down from run speed
      this.vx = U.approach(this.vx, dir * maxV, acc * dt);
      this.facing = dir;
    } else {
      this.vx = U.approach(this.vx, 0, (this.onGround ? (slippery ? 110 : 720) : 220) * dt);
    }

    // jumping
    if (this.onGround) { this.coyote = 0.1; this.airJumps = this.canDouble(g) ? 1 : 0; this.glide = false; }
    else this.coyote -= dt;
    if (this.jbuf > 0 && this.coyote > 0 && !this.pounding) {
      this.vy = -(328 + Math.abs(this.vx) * 0.12);
      this.jumping = true; this.coyote = 0; this.jbuf = 0;
      this.sx = 0.8; this.sy = 1.2;
      g.sfx('jump'); Save.stat('jumps');
      g.dust(this.cx, this.bottom, 3);
    } else if (this.jbuf > 0 && this.airJumps > 0 && !this.onGround && !this.pounding) {
      this.vy = -300; this.airJumps--; this.jbuf = 0; this.jumping = true;
      g.sfx('djump');
      for (let i = 0; i < 8; i++) g.puff(this.cx, this.bottom, U.rand(-60, 60), U.rand(10, 60), '#ffffff');
    }

    let grav = GRAV, maxFall = MAX_FALL;
    if (this.vy < 0 && I.held.jump && this.jumping) grav = GRAV * 0.5;
    if (this.vy >= 0) this.jumping = false;
    this.glide = this.power === 3 && this.vy > 0 && I.held.jump && !this.onGround && !this.pounding;
    if (this.glide) maxFall = 70;

    // ground pound
    if (!this.onGround && I.pressed.down && !this.pounding && !this.dead) {
      this.pounding = true; this.poundT = 0.16; this.vx = 0; this.vy = -60;
    }
    if (this.pounding && this.poundT > 0) {
      this.poundT -= dt; this.vy = 0; grav = 0;
      if (this.poundT <= 0) this.vy = 520;
    } else if (this.pounding) { grav = GRAV * 1.5; maxFall = 560; }

    // fire
    if (this.power === 2 && I.pressed.run && this.fireCd <= 0 && g.countOf(Fireball) < 2) {
      g.add(new Fireball(this.facing > 0 ? this.x + this.w : this.x - 8, this.y + 6, this.facing));
      this.fireCd = 0.25; g.sfx('fire');
    }

    const wasGround = this.onGround;
    const fallSpeed = this.vy;
    g.physics(this, dt, grav, maxFall);

    if (this.hitCeil) this.jumping = false;
    if (this.onGround && !wasGround) {
      if (fallSpeed > 200) { this.sx = 1.25; this.sy = 0.78; g.dust(this.cx, this.bottom, 4); }
      if (this.pounding) this.poundLand(g);
    }
    if (this.onGround) this.combo = 0;

    // tiles: coins, hazards
    const x0 = Math.floor(this.x / TS), x1 = Math.floor((this.x + this.w - 0.01) / TS);
    const y0 = Math.floor(this.y / TS), y1 = Math.floor((this.y + this.h - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = g.tile(tx, ty);
        if (c === 'c') { g.setTile(tx, ty, '.'); g.collectCoin(tx * TS + 8, ty * TS + 8); }
        else if (c === '^' && this.bottom > ty * TS + 7 && this.x + this.w > tx * TS + 2 && this.x < tx * TS + 14) this.hurt(g);
        else if ((c === '~' || c === '%') && this.bottom > ty * TS + 6) { g.playerDie(false); return; }
      }
    }
    // magnet
    const mr = [0, 40, 64, 96][g.upg.magnet] || 0;
    if (mr) {
      const r = Math.ceil(mr / TS);
      const pcx = Math.floor(this.cx / TS), pcy = Math.floor(this.cy / TS);
      for (let ty = pcy - r; ty <= pcy + r; ty++) for (let tx = pcx - r; tx <= pcx + r; tx++) {
        if (g.tile(tx, ty) !== 'c') continue;
        const dx = tx * TS + 8 - this.cx, dy = ty * TS + 8 - this.cy;
        if (dx * dx + dy * dy < mr * mr) { g.setTile(tx, ty, '.'); g.add(new FlyCoin(tx * TS + 8, ty * TS + 8)); }
      }
    }

    if (this.y > g.level.h * TS + 20) { g.playerDie(true); return; }

    if (this.onGround && Math.abs(this.vx) > 10) this.phase += Math.abs(this.vx) * dt * 0.11;
    if (this.onGround && Math.abs(this.vx) > 150 && Math.random() < 0.15) g.dust(this.cx - this.facing * 4, this.bottom, 1);
  }

  poundLand(g) {
    this.pounding = false;
    g.sfx('pound'); g.shake(5);
    for (let i = 0; i < 12; i++) g.puff(this.cx, this.bottom, U.rand(-120, 120), U.rand(-60, 0), '#ffffff');
    const ty = Math.floor((this.bottom + 2) / TS);
    const x0 = Math.floor(this.x / TS), x1 = Math.floor((this.x + this.w - 0.01) / TS);
    for (let tx = x0; tx <= x1; tx++) g.hitBlock(tx, ty, this, true);
    for (const e of g.ents) {
      if (!e.isEnemy || e.dead || !e.active || e.isBoss) continue;
      if (e.onGround && Math.abs(e.cx - this.cx) < 48 && Math.abs(e.bottom - this.bottom) < 10 && !U.overlap(e, this)) {
        e.vy = -160; // shockwave hop
      }
    }
  }

  bounce(g, big) {
    const I = g.input;
    this.vy = big ? -420 : I.held.jump ? -370 : -240;
    this.jumping = true; this.pounding = false;
    this.airJumps = this.canDouble(g) ? 1 : 0;
    this.sx = 0.8; this.sy = 1.2;
  }

  hurt(g) {
    if (this.invuln > 0 || this.star > 0 || this.dead || g.state !== 'play') return;
    g.sess.hit = true;
    if (this.shield) {
      this.shield = false; g.shieldUsed = true; this.invuln = 1.5; g.sfx('shield');
      for (let i = 0; i < 16; i++) g.puff(this.cx, this.cy, U.rand(-120, 120), U.rand(-120, 120), '#9fe8ff');
      return;
    }
    if (this.power > 0) {
      this.setPower(this.power >= 2 ? 1 : 0);
      this.invuln = 2; g.sfx('hurt'); g.shake(3);
    } else {
      g.playerDie(false);
    }
  }

  draw(ctx, g) {
    if (this.hidden) return;
    if (this.invuln > 0 && !this.dead && Math.floor(this.invuln * 16) % 2 === 0) return;
    const t = g.t;
    let state = 'idle';
    if (this.dead) state = 'dead';
    else if (this.pounding) state = 'pound';
    else if (!this.onGround) state = this.glide ? 'glide' : this.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(this.vx) > 8) state = 'run';
    if (this.star > 0) {
      const gl = ctx.createRadialGradient(this.cx, this.cy, 2, this.cx, this.cy, 22);
      gl.addColorStop(0, `hsla(${(t * 600) % 360},100%,70%,0.7)`); gl.addColorStop(1, 'hsla(0,100%,70%,0)');
      ctx.fillStyle = gl; ctx.fillRect(this.cx - 22, this.cy - 22, 44, 44);
    }
    let rot = 0;
    if (state === 'pound' && this.poundT > 0) rot = (1 - this.poundT / 0.16) * Math.PI * 2 * this.facing;
    Art.hero(ctx, {
      x: this.cx, y: this.bottom, s: this.power > 0 ? 0.93 : 0.52, facing: this.facing, state, phase: this.phase,
      t, skin: g.skin, power: this.power, vx: this.vx, blink: this.blinkT < 0, sx: this.sx, sy: this.sy, rot,
    });
    if (this.star > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `hsla(${(t * 600) % 360},100%,60%,0.25)`;
      ctx.beginPath(); ctx.ellipse(this.cx, this.cy - 2, this.w, this.h * 0.75, 0, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.shield) {
      ctx.strokeStyle = 'rgba(160,230,255,0.85)'; ctx.lineWidth = 1.2;
      ctx.fillStyle = 'rgba(160,230,255,0.15)';
      ctx.beginPath(); ctx.arc(this.cx, this.cy - 1, Math.max(this.w, this.h) * 0.75 + Math.sin(t * 5), 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(this.cx - 5, this.cy - this.h * 0.4, 2, 0, 7); ctx.fill();
    }
  }
}

// ======================================================================== Player fireball
class Fireball extends Ent {
  constructor(x, y, dir) { super(x, y, 8, 8); this.vx = dir * 240; this.vy = 80; this.life = 2.2; }
  update(g, dt) {
    this.t += dt; this.life -= dt;
    g.physics(this, dt, 1300, 330);
    if (this.onGround) this.vy = -210;
    if (Math.random() < 0.5) g.spark(this.cx, this.cy, U.pick(['#ffb02a', '#ff5a1a', '#fff3a0']));
    if (this.hitWall || this.hitCeil || this.life <= 0 || !g.onScreen(this, 40)) { this.die(g); return; }
    for (const e of g.ents) {
      if (!e.isEnemy || e.dead || !e.active || !U.overlap(this, e)) continue;
      if (e.isBoss) { e.damage(g, 0.25, 0.15); this.die(g); return; }
      if (e.fireproof) { this.die(g); return; }
      e.kill(g, 'flip', this.vx > 0 ? 1 : -1);
      g.addScore(200, e.cx, e.y); Save.stat('fireKills'); g.sfx('kick');
      this.die(g); return;
    }
  }
  die(g) { this.remove = true; g.sfx('poof'); for (let i = 0; i < 5; i++) g.puff(this.cx, this.cy, U.rand(-50, 50), U.rand(-50, 50), '#ffb02a'); }
  draw(ctx) {
    ctx.save(); ctx.translate(this.cx, this.cy); ctx.rotate(this.t * 20);
    const gl = ctx.createRadialGradient(0, 0, 1, 0, 0, 9);
    gl.addColorStop(0, 'rgba(255,220,120,0.8)'); gl.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = gl; ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = '#ff5a1a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(1, -1, 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-0.5, -2.5, 1.5, 1.5);
    ctx.restore();
  }
}

// ======================================================================== Enemies
class Enemy extends Ent {
  constructor(x, y, w, h) {
    super(x, y, w, h);
    this.isEnemy = true; this.active = false; this.dead = false; this.flip = false;
    this.stompable = true; this.fireproof = false; this.dir = -1; this.speed = 32;
  }
  kill(g, how, dir = 1) {
    if (this.dead) return;
    this.dead = true;
    if (how === 'squash') { this.squish = true; this.deadT = 0.45; this.vx = 0; }
    else { this.flip = true; this.vy = -230; this.vx = dir * 60; }
  }
  updateDead(g, dt) {
    if (this.squish) { this.deadT -= dt; if (this.deadT <= 0) this.remove = true; return; }
    this.vy += 1200 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.y > g.level.h * TS + 40) this.remove = true;
  }
  isStomp(p) { return p.vy > 0 && p.prevBottom <= this.y + Math.max(7, this.h * 0.5); }
  touch(g, p) {
    if (this.dead) return;
    if (p.star > 0) { this.kill(g, 'flip', p.vx >= 0 ? 1 : -1); g.addScore(200, this.cx, this.y); g.sfx('kick'); return; }
    if (this.stompable && this.isStomp(p)) { this.onStomp(g, p); return; }
    p.hurt(g);
  }
  onStomp(g, p) {
    this.kill(g, 'squash');
    g.stompScore(this, p);
    p.bounce(g);
  }
  walk(g, dt, edgeTurn) {
    if (edgeTurn && this.onGround) {
      const ax = this.dir > 0 ? this.x + this.w + 1 : this.x - 1;
      if (!g.solidAt(Math.floor(ax / TS), Math.floor((this.bottom + 2) / TS))) this.dir = -this.dir;
    }
    this.vx = this.dir * this.speed;
    g.physics(this, dt);
    if (this.hitWall) this.dir = -this.hitWall;
  }
}

class Blob extends Enemy {
  constructor(x, y, edge) { super(x, y, 14, 12); this.edge = edge; }
  update(g, dt) { this.t += dt; this.walk(g, dt, this.edge); }
  draw(ctx, g) { Art.blob(ctx, this, this.t, g.theme.enemy); }
}

class Spiky extends Enemy {
  constructor(x, y) { super(x, y, 14, 13); this.stompable = false; this.speed = 26; }
  update(g, dt) { this.t += dt; this.walk(g, dt, false); }
  draw(ctx) { Art.spiky(ctx, this, this.t); }
}

class Shellbug extends Enemy {
  constructor(x, y) { super(x, y, 14, 16); this.mode = 'walk'; this.idle = 0; this.grace = 0; this.chain = 0; this.wiggle = false; }
  toShell() { if (this.mode === 'walk') { this.h = 12; this.y += 4; } this.mode = 'shell'; this.idle = 0; this.vx = 0; this.chain = 0; }
  update(g, dt) {
    this.t += dt;
    if (this.mode === 'walk') { this.walk(g, dt, false); return; }
    if (this.mode === 'shell') {
      this.vx = 0; g.physics(this, dt);
      this.idle += dt; this.wiggle = this.idle > 5;
      if (this.idle > 6.5) { this.mode = 'walk'; this.h = 16; this.y -= 4; this.wiggle = false; }
      return;
    }
    // kicked
    this.grace -= dt;
    this.vx = this.dir * 230;
    g.physics(this, dt);
    if (this.hitWall) {
      if (this.wallTile && g.onScreen(this, 0)) g.hitBlock(this.wallTile[0], this.wallTile[1], this, true);
      this.dir = -this.hitWall; g.sfx('bump');
    }
    for (const e of g.ents) {
      if (e === this || !e.isEnemy || e.dead || !e.active || e.isBoss || !U.overlap(this, e)) continue;
      e.kill(g, 'flip', this.dir);
      const pts = STOMP_CHAIN[Math.min(this.chain, STOMP_CHAIN.length - 1)];
      this.chain++;
      g.addScore(pts, e.cx, e.y); g.sfx('kick'); Save.stat('shellKills');
    }
  }
  touch(g, p) {
    if (this.dead) return;
    if (p.star > 0) { this.kill(g, 'flip', p.vx >= 0 ? 1 : -1); g.addScore(200, this.cx, this.y); g.sfx('kick'); return; }
    const stomp = this.isStomp(p);
    if (this.mode === 'walk') {
      if (stomp) { this.toShell(); g.stompScore(this, p); p.bounce(g); } else p.hurt(g);
    } else if (this.mode === 'shell') {
      this.dir = p.cx < this.cx ? 1 : -1;
      this.mode = 'kick'; this.grace = 0.25; this.chain = 0;
      g.sfx('kick'); g.addScore(400, this.cx, this.y);
      if (stomp) p.bounce(g);
      else this.x = this.dir > 0 ? Math.max(this.x, p.x + p.w) : Math.min(this.x, p.x - this.w);
    } else {
      if (stomp) { this.toShell(); g.stompScore(this, p); p.bounce(g); }
      else if (this.grace <= 0) p.hurt(g);
    }
  }
  draw(ctx) { Art.shellbug(ctx, this, this.t); }
}

class Hopper extends Enemy {
  constructor(x, y) { super(x, y, 14, 14); this.timer = U.rand(0.6, 1.4); }
  update(g, dt) {
    this.t += dt;
    if (this.onGround) {
      this.vx = 0; this.timer -= dt;
      this.facing = g.player.cx < this.cx ? -1 : 1;
      if (this.timer <= 0) { this.vy = -310; this.vx = this.facing * 75; this.timer = U.rand(1, 1.8); this.onGround = false; }
    }
    g.physics(this, dt);
    if (this.hitWall) this.vx = -this.vx;
  }
  draw(ctx) { Art.hopper(ctx, this, this.t); }
}

class Bat extends Enemy {
  constructor(x, y) { super(x, y, 14, 12); this.state = 'hang'; this.baseY = y; }
  update(g, dt) {
    this.t += dt;
    const p = g.player;
    if (this.state === 'hang') {
      if (Math.abs(p.cx - this.cx) < 110) { this.state = 'fly'; this.dir = p.cx < this.cx ? -1 : 1; this.ft = 0; }
      return;
    }
    this.ft += dt;
    this.baseY = U.lerp(this.baseY, U.clamp(p.cy - 6, 24, g.level.h * TS - 40), dt * 0.9);
    this.vx = this.dir * 62;
    this.x += this.vx * dt;
    this.y = this.baseY + Math.sin(this.ft * 3.4) * 18;
    if (!g.onScreen(this, 300)) this.remove = true;
  }
  draw(ctx) { Art.bat(ctx, this, this.t); }
}

class Snapper extends Enemy {
  constructor(px, top) {
    super(px - 6, top + 4, 12, 26);
    this.stompable = false; this.home = top + 4; this.up = top - 22; this.phaseT = U.rand(0, 2); this.st = 'hide'; this.behind = true;
  }
  update(g, dt) {
    this.t += dt; this.phaseT -= dt;
    const near = Math.abs(g.player.cx - this.cx) < 26;
    if (this.st === 'hide' && this.phaseT <= 0) { if (!near) { this.st = 'rise'; } else this.phaseT = 0.5; }
    if (this.st === 'rise') { this.y -= 40 * dt; if (this.y <= this.up) { this.y = this.up; this.st = 'show'; this.phaseT = 1.4; } }
    if (this.st === 'show' && this.phaseT <= 0) this.st = 'sink';
    if (this.st === 'sink') { this.y += 40 * dt; if (this.y >= this.home) { this.y = this.home; this.st = 'hide'; this.phaseT = 1.8; } }
  }
  touch(g, p) { if (this.y < this.home - 6) super.touch(g, p); }
  kill(g, how, dir) { super.kill(g, 'squash', dir); this.deadT = 0.2; }
  draw(ctx) { if (!this.dead) Art.snapper(ctx, this, this.t); }
}

class Crusher extends Enemy {
  constructor(x, y) {
    super(x, y, 28, 28);
    this.home = y; this.state = 'idle'; this.timer = 0; this.stompable = false; this.fireproof = true;
    this.isPlatform = true; this.dx = 0; this.dy = 0; this.active = true;
  }
  update(g, dt) {
    this.t += dt;
    const ox = this.x, oy = this.y;
    const p = g.player;
    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0 && Math.abs(p.cx - this.cx) < this.w / 2 + 22 && p.y > this.bottom && g.onScreen(this, 0)) { this.state = 'warn'; this.timer = 0.28; }
    } else if (this.state === 'warn') {
      this.timer -= dt; if (this.timer <= 0) { this.state = 'fall'; this.vy = 0; }
    } else if (this.state === 'fall') {
      this.vy = Math.min(this.vy + 1600 * dt, 520);
      this.onGround = false; g.moveY(this, this.vy * dt);
      if (this.onGround) {
        this.state = 'land'; this.timer = 1; g.sfx('pound'); g.shake(4);
        for (let i = 0; i < 10; i++) g.puff(this.cx, this.bottom, U.rand(-100, 100), U.rand(-50, 0), '#c8c0d8');
      }
    } else if (this.state === 'land') {
      this.timer -= dt; if (this.timer <= 0) this.state = 'rise';
    } else if (this.state === 'rise') {
      this.y -= 45 * dt;
      if (this.y <= this.home) { this.y = this.home; this.state = 'idle'; this.timer = 0.6; }
    }
    this.dx = this.x - ox; this.dy = this.y - oy;
  }
  touch(g, p) {
    if (p.riding === this || p.prevBottom <= this.y + 3) return;
    if (p.star > 0) return;
    p.hurt(g);
  }
  kill() {}
  draw(ctx) { Art.crusher(ctx, this, this.t); }
}

class Seed extends Enemy {
  constructor(x, y, dir) { super(x, y, 14, 10); this.vx = dir * 88; this.active = true; }
  update(g, dt) { this.t += dt; this.x += this.vx * dt; if (!g.onScreen(this, 260)) this.remove = true; }
  draw(ctx) { Art.seed(ctx, this, this.t); }
}

class LavaBub extends Enemy {
  constructor(x, levelH, delay) {
    super(x, levelH * TS + 10, 12, 14);
    this.floor = levelH * TS + 10; this.wait = delay || U.rand(0.2, 1.2);
    this.stompable = false; this.fireproof = true; this.active = true;
  }
  update(g, dt) {
    this.t += dt;
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.vy = -470; return; }
    this.vy += 700 * dt; this.y += this.vy * dt;
    if (this.y >= this.floor) { this.y = this.floor; this.wait = U.rand(1.2, 2.2); }
    if (Math.random() < 0.3) g.spark(this.cx, this.bottom, '#ff8a2a');
  }
  kill() {}
  draw(ctx) { if (this.wait <= 0) Art.lavabub(ctx, this, this.t); }
}

class Icicle extends Enemy {
  constructor(x, y) { super(x, y, 12, 16); this.state = 'hang'; this.stompable = false; this.active = true; }
  update(g, dt) {
    this.t += dt;
    const p = g.player;
    if (this.state === 'hang') { if (Math.abs(p.cx - this.cx) < 28 && p.y > this.y) { this.state = 'shake'; this.timer = 0.35; g.sfx('crack'); } return; }
    if (this.state === 'shake') { this.timer -= dt; if (this.timer <= 0) this.state = 'fall'; return; }
    g.physics(this, dt, 1200, 460);
    if (this.onGround) this.shatter(g);
  }
  shatter(g) {
    this.remove = true; this.dead = true; g.sfx('crack');
    for (let i = 0; i < 10; i++) g.debris(this.cx, this.cy, '#bfe6ff');
  }
  kill(g) { this.shatter(g); }
  touch(g, p) { if (p.star > 0) { this.shatter(g); return; } p.hurt(g); }
  draw(ctx) { Art.icicle(ctx, this, this.t); }
}

class BossFire extends Enemy {
  constructor(x, y, vx, vy) { super(x, y, 10, 10); this.vx = vx; this.vy = vy; this.stompable = false; this.fireproof = true; this.active = true; }
  update(g, dt) {
    this.t += dt; this.vy += 500 * dt; this.x += this.vx * dt; this.y += this.vy * dt;
    if (Math.random() < 0.5) g.spark(this.cx, this.cy, '#ff8a2a');
    const tx = Math.floor(this.cx / TS), ty = Math.floor(this.bottom / TS);
    if (g.solidAt(tx, ty) || this.y > g.level.h * TS) { this.remove = true; for (let i = 0; i < 6; i++) g.puff(this.cx, this.cy, U.rand(-60, 60), U.rand(-80, 0), '#ff8a2a'); }
  }
  kill() {}
  draw(ctx) { Art.lavabub(ctx, this, this.t); }
}

class Boss extends Enemy {
  constructor(x, y) {
    super(x, y, 40, 40);
    this.isBoss = true; this.hp = 3; this.maxHp = 3; this.inv = 0; this.state = 'idle'; this.timer = 1.4;
    this.home = { x, y }; this.facing = -1; this.mouth = 0; this.stompable = true;
  }
  reset() {
    this.x = this.home.x; this.y = this.home.y; this.hp = 3; this.inv = 0; this.state = 'idle';
    this.timer = 1.4; this.active = false; this.vx = 0; this.vy = 0; this.dead = false; this.flip = false;
  }
  update(g, dt) {
    this.t += dt;
    if (!g.arenaOn) return;
    if (this.inv > 0) this.inv -= dt;
    const p = g.player;
    const rage = 3 - Math.ceil(this.hp) + 1;
    this.timer -= dt;
    this.mouth = U.approach(this.mouth, this.state === 'spit' ? 1 : 0, dt * 4);
    if (this.state === 'idle') {
      this.vx = 0;
      if (this.timer <= 0) { this.state = 'walk'; this.timer = 1.6; g.sfx('roar'); g.shake(4); }
    } else if (this.state === 'walk') {
      this.facing = p.cx < this.cx ? -1 : 1;
      this.vx = this.facing * (40 + rage * 14);
      if (this.timer <= 0) {
        const r = Math.random();
        if (r < 0.45) { this.state = 'jump'; this.vy = -440; this.vx = this.facing * (70 + rage * 10); this.onGround = false; }
        else { this.state = 'spit'; this.timer = 0.7; this.vx = 0; this.shots = 0; }
      }
    } else if (this.state === 'jump') {
      if (this.onGround) { this.state = 'walk'; this.timer = 1.2 + Math.random(); g.shake(6); g.sfx('pound'); for (let i = 0; i < 12; i++) g.puff(this.cx, this.bottom, U.rand(-140, 140), U.rand(-60, 0), '#ffb06a'); }
    } else if (this.state === 'spit') {
      this.vx = 0;
      if (this.timer <= 0.4 && this.shots < 1 + rage) {
        this.shots++; this.timer = 0.4 + 0.15;
        const sx = this.cx + this.facing * 16, sy = this.y + 18;
        const dist = Math.abs(p.cx - sx);
        g.add(new BossFire(sx - 5, sy, this.facing * U.clamp(dist * 0.9, 60, 220) * U.rand(0.7, 1.2), -260 - Math.random() * 80));
        g.sfx('shoot');
      }
      if (this.shots >= 1 + rage && this.timer <= 0) { this.state = 'walk'; this.timer = 1.4 + Math.random(); }
    } else if (this.state === 'hurt') {
      if (this.timer <= 0) { this.state = 'walk'; this.timer = 0.8; }
    }
    g.physics(this, dt, 1200, 500);
    if (this.hitWall && this.state === 'walk') this.timer = 0;
  }
  damage(g, n, inv = 1.2) {
    if (this.inv > 0 || this.dead) return;
    this.hp -= n; this.inv = inv;
    g.sfx('bossHit'); g.shake(n >= 1 ? 7 : 2);
    for (let i = 0; i < (n >= 1 ? 16 : 4); i++) g.puff(this.cx, this.cy, U.rand(-150, 150), U.rand(-150, 50), '#ff8a2a');
    if (n >= 1) { this.state = 'hurt'; this.timer = 0.6; this.vx = 0; }
    if (this.hp <= 0.001) {
      this.dead = true; this.flip = true; this.vy = -320; this.vx = 0;
      g.sfx('boom'); g.shake(12);
      for (let i = 0; i < 40; i++) g.puff(this.cx, this.cy, U.rand(-260, 260), U.rand(-260, 100), U.pick(['#ff8a2a', '#ffd23f', '#5a4a52']));
      g.bossDefeated(this);
    }
  }
  touch(g, p) {
    if (this.dead || !g.arenaOn) return;
    if (p.star > 0 || (p.vy > 0 && p.prevBottom <= this.y + 14)) {
      if (this.inv <= 0) { this.damage(g, 1); g.addScore(2000, this.cx, this.y); }
      p.bounce(g, true); p.vx = (p.cx < this.cx ? -1 : 1) * 160;
      return;
    }
    if (this.inv <= 0.9) p.hurt(g);
  }
  draw(ctx) { Art.boss(ctx, this, this.t); }
}

// ======================================================================== Items & props
class BlockCoin extends Ent {
  constructor(x, y) { super(x - 6, y, 12, 12); this.vy = -300; this.life = 0.5; }
  update(g, dt) { this.t += dt; this.vy += 900 * dt; this.y += this.vy * dt; this.life -= dt; if (this.life <= 0) { this.remove = true; g.spark(this.cx, this.cy, '#fff6b0', 6); } }
  draw(ctx) { Art.coin(ctx, this.cx, this.cy, this.t * 3); }
}

class FlyCoin extends Ent {
  constructor(x, y) { super(x - 5, y - 6, 10, 12); this.sp = 60; }
  update(g, dt) {
    this.t += dt; this.sp += 600 * dt;
    const p = g.player, dx = p.cx - this.cx, dy = p.cy - this.cy, d = Math.hypot(dx, dy) || 1;
    this.x += (dx / d) * this.sp * dt; this.y += (dy / d) * this.sp * dt;
    if (d < 8 || this.t > 2) { this.remove = true; g.collectCoin(this.cx, this.cy); }
  }
  draw(ctx, g) { Art.coin(ctx, this.cx, this.cy, g.t + this.x); }
}

class PowerUp extends Ent {
  constructor(kind, x, y) {
    super(x + 1, y, 14, 14);
    this.kind = kind; this.emerge = 0.55; this.startY = y; this.behind = true; this.dir = 1;
  }
  update(g, dt) {
    this.t += dt;
    if (this.emerge > 0) {
      this.emerge -= dt;
      this.y = this.startY - (1 - Math.max(0, this.emerge) / 0.55) * 16;
      if (this.emerge <= 0) { this.behind = false; if (this.kind === 'feather') this.vy = -120; }
      return;
    }
    if (this.kind === 'berry' || this.kind === 'life') {
      this.vx = this.dir * 62; g.physics(this, dt); if (this.hitWall) this.dir = -this.hitWall;
    } else if (this.kind === 'star') {
      this.vx = this.dir * 85; g.physics(this, dt, 900, 400);
      if (this.onGround) this.vy = -300; if (this.hitWall) this.dir = -this.hitWall;
    } else if (this.kind === 'feather') {
      this.vy = Math.min(this.vy + 200 * dt, 28);
      this.vx = Math.sin(this.t * 2.2) * 42;
      g.physics(this, dt, 0, 28);
    } else {
      this.vx = 0; g.physics(this, dt);
    }
    if (this.y > g.level.h * TS + 20) this.remove = true;
  }
  touch(g, p) {
    if (this.emerge > 0.2) return;
    this.remove = true;
    g.collectPower(this.kind, this);
  }
  draw(ctx, g) { Art.power(ctx, this.kind, this.cx, this.cy, g.t); }
}

class Medal extends Ent {
  constructor(x, y, id) { super(x, y, 16, 16); this.id = id; }
  touch(g) { this.remove = true; g.collectMedal(this.id, this.cx, this.cy); }
  draw(ctx, g) { Art.medal(ctx, this.cx, this.cy, g.t + this.id, g.savedMedal(this.id)); }
}

class Gem extends Ent {
  constructor(x, y) { super(x, y, 14, 14); }
  touch(g) {
    this.remove = true; g.sess.coins += 5; Save.stat('coins', 5);
    g.addScore(1000, this.cx, this.y); g.sfx('medal'); g.spark(this.cx, this.cy, '#5ae6ff', 12);
  }
  draw(ctx, g) { Art.gem(ctx, this.cx, this.cy, g.t + this.x); }
}

class Spring extends Ent {
  constructor(x, y) { super(x, y, 16, 16); this.compress = 0; }
  update(g, dt) { this.compress = U.approach(this.compress, 0, dt * 4); }
  touch(g, p) {
    if (p.vy > 0 && p.prevBottom <= this.y + 9) {
      p.y = this.y + 4 - p.h;
      p.vy = g.input.held.jump ? -545 : -440;
      p.jumping = true; p.pounding = false; p.airJumps = p.canDouble(g) ? 1 : 0;
      this.compress = 1; g.sfx('spring');
      p.sx = 0.7; p.sy = 1.35;
    }
  }
  draw(ctx, g) { Art.spring(ctx, this, g.t); }
}

class Platform extends Ent {
  constructor(kind, x, y, opt) {
    super(x, y, 48, 8);
    this.kind = kind; this.ox = x; this.oy = y; this.range = opt.range || 48; this.speed = opt.speed || 40;
    this.ph = (opt.phase || 0) * Math.PI; this.isPlatform = true; this.dx = 0; this.dy = 0;
    this.standT = 0; this.fallV = 0; this.respawn = 0; this.shake = false;
  }
  update(g, dt) {
    this.t += dt;
    const ox = this.x, oy = this.y;
    if (this.kind === 'h' || this.kind === 'v') {
      this.ph += (dt * this.speed * Math.PI) / this.range;
      const off = ((1 - Math.cos(this.ph)) / 2) * this.range;
      if (this.kind === 'h') this.x = this.ox + off; else this.y = this.oy + off;
    } else {
      if (this.respawn > 0) {
        this.respawn -= dt;
        if (this.respawn <= 0) { this.x = this.ox; this.y = this.oy; this.fallV = 0; this.standT = 0; this.shake = false; }
      } else if (this.standT > 0.45) {
        this.fallV = Math.min(this.fallV + 900 * dt, 400); this.y += this.fallV * dt; this.shake = false;
        if (this.y > g.level.h * TS + 40) this.respawn = 3;
      } else if (g.player.riding === this || this.standT > 0) {
        this.standT += dt; this.shake = true;
      }
    }
    this.dx = this.x - ox; this.dy = this.y - oy;
  }
  draw(ctx, g) { if (!(this.respawn > 0)) Art.platform(ctx, this, g.themeName); }
}

class Cannon extends Ent {
  constructor(tx, ty) { super(tx * TS, ty * TS, 16, 16); this.timer = U.rand(1, 2.5); }
  update(g, dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = U.rand(2.6, 3.6);
    const p = g.player;
    if (!g.onScreen(this, -8) || Math.abs(p.cx - this.cx) < 36) return;
    const dir = p.cx < this.cx ? -1 : 1;
    g.add(new Seed(this.cx - 7 + dir * 8, this.y + 3, dir));
    g.sfx('shoot');
    for (let i = 0; i < 6; i++) g.puff(this.cx + dir * 9, this.y + 8, dir * U.rand(20, 80), U.rand(-30, 30), '#d8d0e0');
  }
}

class Checkpoint extends Ent {
  constructor(x, y) { super(x, y, 16, 32); this.on = false; this.raise = 0; }
  update(g, dt) { if (this.on) this.raise = Math.min(1, this.raise + dt * 2.5); }
  touch(g) {
    if (this.on) return;
    this.on = true; g.setCheckpoint(this);
    g.sfx('check'); g.addScore(500, this.cx, this.y);
    g.spark(this.cx, this.y + 4, '#3fd06a', 14);
  }
  draw(ctx, g) { Art.checkpoint(ctx, this, g.t); }
}

class Goal extends Ent {
  constructor(tx, groundY) {
    super(tx * TS + 5, 3 * TS, 6, groundY - 3 * TS);
    this.top = 3 * TS; this.flagY = this.top + 2; this.tx = tx;
  }
  touch(g, p) { if (g.state === 'play') g.startGoal(this, p); }
  draw(ctx, g) { Art.goal(ctx, { x: this.tx * TS, y: this.y, h: this.h, top: this.top, flagY: this.flagY }, g.t); }
}

class Crown extends Ent {
  constructor(x, y) { super(x - 10, y, 20, 18); }
  update(g, dt) { this.t += dt; g.physics(this, dt, 500, 120); if (Math.random() < 0.3) g.spark(this.cx + U.rand(-10, 10), this.cy + U.rand(-8, 8), '#fff3a0'); }
  touch(g, p) { if (g.state === 'play') { this.remove = true; g.startCrownClear(p); } }
  draw(ctx, g) { Art.crown(ctx, this.cx, this.cy, g.t); }
}
