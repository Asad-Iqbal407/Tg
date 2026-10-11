import { lerp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import type { GameResult, GameServices } from '../types';
import { type BotEnv, stepBot } from './bots';
import { type Cell, Arena, BORDER, CRATE, DIRECTIONS, manhattan, MIN_BOT_SPAWN_DIST, PILLAR } from './grid';
import { drawScene, type Layout, type Palette, type SceneView } from './render';
import {
  type Bomb,
  type Bot,
  type BotKind,
  BLAST_BASE,
  BOMBER_SPEED,
  BOT_FUSE,
  DROP_CHANCE,
  EXPLOSION_TIME,
  type Explosion,
  FUSE,
  type Item,
  type ItemKind,
  LIVES,
  MAX_BLAST_UPS,
  MAX_SPEED_UPS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PUNCH_COOLDOWN,
  type Player,
  REPATH_TIME,
  RESPAWN_DELAY,
  RESPAWN_INVULN,
  SHIELD_INVULN,
  SLIDE_TILES,
  SLIDE_TIME,
  SPAWN_STAGGER,
  SPEED_STEP,
  WALKER_SPEED,
  WAVE_CLEAR_DELAY,
} from './types';

/** Stick-like steering with a mouse or finger: no movement inside the dead zone, full speed at the far edge. */
/** How far off a tile centre the player may be and still be nudged through a gap (tile units). */
const CORNER_ASSIST = 0.45;
const DRAG_DEAD_ZONE = 14;
const DRAG_FULL_SPEED = 70;
const ITEM_DROPS: readonly { value: ItemKind; weight: number }[] = [
  { value: 'blast', weight: 3 },
  { value: 'bombs', weight: 3 },
  { value: 'speed', weight: 2 },
  { value: 'shield', weight: 1 },
];
const ITEM_LABEL: Record<ItemKind, string> = {
  blast: 'BLAST UP',
  bombs: 'BOMB UP',
  speed: 'SPEED UP',
  shield: 'SHIELD',
};
const FIRE_COLORS = ['#fff7ed', '#fde047', '#fb923c', '#ef4444', '#7c2d12'];
const WOOD_COLORS = ['#a16207', '#facc15', '#78350f'];
const NO_VECTOR = { x: 0, y: 0 };

/** Bomb Squad: a bomb-laying arena. Crates hide power-ups; bots chase you in waves. */
export class BombSquadGame extends BaseGame {
  private readonly arena: Arena;
  private readonly palette: Palette;
  private readonly player: Player;
  /** 1 on tiles that hold a live bomb; used for bot path finding. */
  private readonly occupied: Uint8Array;
  /** Stamp of the latest detonation that covered each tile; compared against `serial`. */
  private readonly blastMark: Uint32Array;
  private readonly botEnv: BotEnv;
  private bots: Bot[] = [];
  private bombs: Bomb[] = [];
  private explosions: Explosion[] = [];
  private items: Item[] = [];
  private lives = LIVES;
  private wave = 0;
  private waveAge = 0;
  private spawnQueue: BotKind[] = [];
  private spawnTimer = 0;
  private spawnCursor = 0;
  /** Countdown between clearing a wave and starting the next, or -1 while the wave is running. */
  private clearTimer = -1;
  private kills = 0;
  private blocks = 0;
  private serial = 0;
  private dragOrigin: { x: number; y: number } | null = null;
  private layoutKey = -1;
  private lay: Layout = { ts: 1, ox: 0, oy: 0 };

  constructor(services: GameServices) {
    super(services);
    this.arena = new Arena(this.W, this.H, this.rng);
    const cells = this.arena.cols * this.arena.rows;
    this.occupied = new Uint8Array(cells);
    this.blastMark = new Uint32Array(cells);
    this.palette = {
      suit: this.skinColor('suit', '#3b82f6'),
      visor: this.skinColor('visor', '#e0f2fe'),
      skin: this.skinColor('skin', '#f1c27d'),
      hair: this.skinColor('hair', '#4b2e1e'),
      bomb: this.skinColor('bomb', '#111827'),
      fuse: this.skinColor('fuse', '#f97316'),
      crate: this.skinColor('crate', '#a16207'),
      stone: this.skinColor('stone', '#64748b'),
      floor1: this.skinColor('floor1', '#1e3a2f'),
      floor2: this.skinColor('floor2', '#1f4a36'),
    };
    this.player = {
      x: this.arena.playerSpawn.x + 0.5,
      y: this.arena.playerSpawn.y + 0.5,
      facingX: 1,
      facingY: 0,
      ammo: 0,
      ammoMax: 1,
      speedUps: 0,
      blastUps: 0,
      bombUps: 0,
      shielded: this.hasBoost('shield'),
      invuln: 0,
      respawn: 0,
      punchCd: 0,
      walk: 0,
    };
    this.refreshAmmoMax();
    this.player.ammo = this.player.ammoMax;
    this.botEnv = {
      arena: this.arena,
      occupied: this.occupied,
      rng: this.rng,
      dropBomb: (tx, ty) => this.botDropBomb(tx, ty),
    };
    this.startWave(1);
  }

  override getResult(): GameResult {
    // Coins are the sum of kills, a quarter of the crates and the wave bonus (2 per wave reached).
    this.coins = this.kills + Math.floor(this.blocks / 4) + 2 * this.wave;
    return super.getResult();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    drawScene(ctx, this.view());
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
  }

  protected tick(dt: number): void {
    this.waveAge += dt;
    if (this.isEnding) {
      this.updateExplosions(dt);
      this.player.walk = 0;
      return;
    }
    this.updatePlayer(dt);
    this.updateBombs(dt);
    this.updateBots(dt);
    this.updateExplosions(dt);
    this.updateWaves(dt);
  }

  private view(): SceneView {
    return {
      W: this.W,
      H: this.H,
      time: this.time,
      preview: this.services.preview === true,
      arena: this.arena,
      layout: this.layout(),
      palette: this.palette,
      player: this.player,
      bots: this.bots,
      bombs: this.bombs,
      explosions: this.explosions,
      items: this.items,
      lives: this.lives,
      wave: this.wave,
      waveAge: this.waveAge,
      score: this.score,
      ammo: this.player.ammo,
      ammoMax: this.player.ammoMax,
    };
  }

  /** Where the arena sits on screen: the largest whole tile size that fits, centred. */
  private layout(): Layout {
    const key = this.insets.bottom;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      const rectW = this.W - 32;
      const rectH = this.H - 64 - key;
      const ts = Math.max(4, Math.floor(Math.min(rectW / this.arena.cols, rectH / this.arena.rows)));
      this.lay = {
        ts,
        ox: 16 + (rectW - this.arena.cols * ts) / 2,
        oy: 56 + (rectH - this.arena.rows * ts) / 2,
      };
    }
    return this.lay;
  }

  // ---- player -------------------------------------------------------------------------------

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (p.respawn > 0) {
      p.respawn -= dt;
      if (p.respawn <= 0) this.respawnPlayer();
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.punchCd = Math.max(0, p.punchCd - dt);
    this.steer(dt);
    if (this.input.wasPressed('primary')) this.layBomb();
    if (this.input.wasPressed('secondary')) this.punch();
    this.pickUpItems();
  }

  private steer(dt: number): void {
    const p = this.player;
    let ax = this.input.axisX();
    let ay = this.input.axisY();
    if (ax === 0 && ay === 0) {
      const drag = this.dragVector();
      ax = drag.x;
      ay = drag.y;
    }
    if (ax !== 0 || ay !== 0) {
      if (Math.abs(ax) >= Math.abs(ay)) {
        p.facingX = Math.sign(ax);
        p.facingY = 0;
      } else {
        p.facingX = 0;
        p.facingY = Math.sign(ay);
      }
    }
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    const speed = (PLAYER_SPEED + SPEED_STEP * p.speedUps) * (1 + this.skinParam('speedBonus', 0));
    if (len > 0) p.walk += dt * speed * 2;
    this.moveBody(ax * speed * dt, ay * speed * dt);
  }

  /** Walking vector from a press-and-drag: the offset from where the pointer went down. */
  private dragVector(): { x: number; y: number } {
    const pt = this.input.pointer;
    if (!pt.down) {
      this.dragOrigin = null;
      return NO_VECTOR;
    }
    if (pt.pressed || !this.dragOrigin) this.dragOrigin = { x: pt.x, y: pt.y };
    const dx = pt.x - this.dragOrigin.x;
    const dy = pt.y - this.dragOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len <= DRAG_DEAD_ZONE) return NO_VECTOR;
    const f = Math.min(1, (len - DRAG_DEAD_ZONE) / (DRAG_FULL_SPEED - DRAG_DEAD_ZONE));
    return { x: (dx / len) * f, y: (dy / len) * f };
  }

  /** Moves axis by axis so the player slides along walls. */
  private moveBody(dx: number, dy: number): void {
    const p = this.player;
    if (dx !== 0) {
      if (!this.blockedAt(p.x + dx, p.y)) p.x += dx;
      else if (dy === 0) this.centreOn('y', Math.abs(dx));
    }
    if (dy !== 0) {
      if (!this.blockedAt(p.x, p.y + dy)) p.y += dy;
      else if (dx === 0) this.centreOn('x', Math.abs(dy));
    }
  }

  /** Corner assist: a player blocked head-on drifts toward the nearby tile centre, so gaps are reachable. */
  private centreOn(axis: 'x' | 'y', amount: number): void {
    const p = this.player;
    const cur = axis === 'x' ? p.x : p.y;
    const off = Math.floor(cur) + 0.5 - cur;
    if (Math.abs(off) > CORNER_ASSIST) return;
    const next = cur + Math.sign(off) * Math.min(Math.abs(off), amount);
    const blocked = axis === 'x' ? this.blockedAt(next, p.y) : this.blockedAt(p.x, next);
    if (blocked) return;
    if (axis === 'x') p.x = next;
    else p.y = next;
  }

  /**
   * True when the body centred on (x, y) would overlap a wall, pillar, crate or bomb. A bomb the body
   * already overlaps (the one it was laid under) never blocks it, so the player can always step off.
   */
  private blockedAt(x: number, y: number): boolean {
    const r = PLAYER_RADIUS;
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r - 1e-9);
    const y0 = Math.floor(y - r);
    const y1 = Math.floor(y + r - 1e-9);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.arena.isSolid(tx, ty)) return true;
        if (this.bombAt(tx, ty) && !this.overlapsPlayer(tx, ty)) return true;
      }
    }
    return false;
  }

  /** Whether the player's body, as it is right now, overlaps tile (tx, ty). */
  private overlapsPlayer(tx: number, ty: number): boolean {
    const { x, y } = this.player;
    const r = PLAYER_RADIUS;
    return (
      tx >= Math.floor(x - r) &&
      tx <= Math.floor(x + r - 1e-9) &&
      ty >= Math.floor(y - r) &&
      ty <= Math.floor(y + r - 1e-9)
    );
  }

  private respawnPlayer(): void {
    const p = this.player;
    p.x = this.arena.playerSpawn.x + 0.5;
    p.y = this.arena.playerSpawn.y + 0.5;
    p.facingX = 1;
    p.facingY = 0;
    p.invuln = RESPAWN_INVULN;
    p.respawn = 0;
    const s = this.screenOf(p.x, p.y);
    this.particles.emit({
      x: s.x,
      y: s.y,
      count: 14,
      speed: 120,
      life: 0.5,
      size: 3,
      colors: [this.palette.visor],
    });
  }

  private hurtPlayer(): void {
    const p = this.player;
    if (this.isEnding || p.respawn > 0 || p.invuln > 0) return;
    const s = this.screenOf(p.x, p.y);
    if (p.shielded) {
      p.shielded = false;
      p.invuln = SHIELD_INVULN;
      this.audio.play('bump');
      this.shake.add(0.3);
      this.particles.emit({
        x: s.x,
        y: s.y,
        count: 18,
        speed: 200,
        life: 0.5,
        size: 4,
        colors: ['#60a5fa', '#bfdbfe'],
      });
      return;
    }
    this.lives--;
    this.audio.play('hit');
    this.shake.add(0.6);
    this.services.haptic(160);
    this.particles.emit({
      x: s.x,
      y: s.y,
      count: 26,
      speed: 260,
      speedVar: 0.8,
      life: 0.9,
      size: 4,
      gravity: 320,
      colors: [this.palette.suit, this.palette.visor, '#ffffff'],
    });
    if (this.lives <= 0) {
      p.respawn = Number.POSITIVE_INFINITY;
      this.endGame(1.6);
      return;
    }
    p.respawn = RESPAWN_DELAY;
  }

  private pickUpItems(): void {
    const p = this.player;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const idx = this.items.findIndex((it) => it.x === tx && it.y === ty);
    if (idx < 0) return;
    const [item] = this.items.splice(idx, 1);
    if (!item) return;
    switch (item.kind) {
      case 'blast':
        p.blastUps = Math.min(MAX_BLAST_UPS, p.blastUps + 1);
        break;
      case 'bombs':
        p.bombUps = Math.min(4, p.bombUps + 1);
        this.refreshAmmoMax();
        p.ammo = Math.min(p.ammoMax, p.ammo + 1);
        break;
      case 'speed':
        p.speedUps = Math.min(MAX_SPEED_UPS, p.speedUps + 1);
        break;
      case 'shield':
        p.shielded = true;
        break;
    }
    this.addStat('powerups');
    this.score += 50;
    this.audio.play('powerup');
    const s = this.screenOf(item.x + 0.5, item.y + 0.5);
    this.texts.add(s.x, s.y - 12, ITEM_LABEL[item.kind], '#fef08a', 16);
  }

  private refreshAmmoMax(): void {
    const p = this.player;
    p.ammoMax = 1 + p.bombUps + this.skinParam('startBombs', 0) + (this.hasBoost('head-start') ? 1 : 0);
  }

  // ---- laying and kicking bombs -------------------------------------------------------------

  /** Primary: lays a bomb on the player's tile, or on the tile they face when their own tile is taken. */
  private layBomb(): void {
    const p = this.player;
    const spot = this.layTile();
    if (p.ammo <= 0 || !spot) {
      this.audio.play('empty');
      return;
    }
    p.ammo--;
    this.addStat('bombs');
    this.addBomb('player', spot.x, spot.y, BLAST_BASE + p.blastUps, FUSE);
    const s = this.screenOf(spot.x + 0.5, spot.y + 0.5);
    this.particles.emit({
      x: s.x,
      y: s.y,
      count: 6,
      speed: 70,
      life: 0.3,
      size: 3,
      colors: [this.palette.stone],
    });
    this.audio.play('bomb');
  }

  /** The tile a new bomb goes on: the player's own tile when free, else the tile they face when free, else null. */
  private layTile(): Cell | null {
    const p = this.player;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (this.canLayOn(tx, ty)) return { x: tx, y: ty };
    const fx = tx + p.facingX;
    const fy = ty + p.facingY;
    // A bomb under the body is never blocking, so a bomb laid where the body already overlaps would let the
    // player walk through it. Only lay on the faced tile when the body is clear of it.
    return !this.overlapsPlayer(fx, fy) && this.canLayOn(fx, fy) ? { x: fx, y: fy } : null;
  }

  /** Open floor with no bomb on it and no bot standing on it or stepping onto it. */
  private canLayOn(tx: number, ty: number): boolean {
    if (this.arena.isSolid(tx, ty) || this.bombAt(tx, ty)) return false;
    return !this.botOn(tx, ty);
  }

  /** True when a bot stands on tile (tx, ty) or is walking onto it. */
  private botOn(tx: number, ty: number): boolean {
    const k = this.arena.index(tx, ty);
    return this.bots.some((b) => b.goal === k || (Math.floor(b.x) === tx && Math.floor(b.y) === ty));
  }

  /** Punch: kicks the bomb on the adjacent tile in the facing direction and hits the bots there. */
  private punch(): void {
    const p = this.player;
    if (p.punchCd > 0) return;
    p.punchCd = PUNCH_COOLDOWN;
    this.audio.play('whoosh');
    const tx = Math.floor(p.x) + p.facingX;
    const ty = Math.floor(p.y) + p.facingY;

    const bomb = this.bombAt(tx, ty);
    if (bomb) this.kickBomb(bomb, p.facingX, p.facingY);

    let hit = false;
    for (const bot of this.bots) {
      if (Math.floor(bot.x) !== tx || Math.floor(bot.y) !== ty) continue;
      hit = true;
      bot.hp -= 1;
      bot.flash = 0.15;
      const bx = tx + p.facingX;
      const by = ty + p.facingY;
      if (bot.hp > 0 && !this.arena.isSolid(bx, by) && !this.bombAt(bx, by)) {
        bot.x = bx + 0.5;
        bot.y = by + 0.5;
        bot.goal = -1;
        bot.path = [];
        bot.repath = 0;
      }
    }
    if (hit) this.reapBots();
  }

  // ---- bombs and blasts ---------------------------------------------------------------------

  /** Puts a bomb down on tile (tx, ty); its fuse starts now. */
  private addBomb(owner: Bomb['owner'], tx: number, ty: number, power: number, fuse: number): void {
    this.bombs.push({
      owner,
      power,
      fuse,
      maxFuse: fuse,
      tx,
      ty,
      x: tx + 0.5,
      y: ty + 0.5,
      slide: 0,
      fromX: tx + 0.5,
      fromY: ty + 0.5,
      dead: false,
    });
  }

  /** The live bomb lying on tile (x, y), if any. */
  private bombAt(x: number, y: number): Bomb | undefined {
    return this.bombs.find((b) => !b.dead && b.tx === x && b.ty === y);
  }

  /**
   * Slides a bomb up to SLIDE_TILES tiles along (dx, dy), stopping short of walls, crates, bombs and
   * bots. Its fuse keeps running while it slides.
   */
  private kickBomb(bomb: Bomb, dx: number, dy: number): void {
    let tx = bomb.tx;
    let ty = bomb.ty;
    for (let s = 0; s < SLIDE_TILES; s++) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (this.arena.isSolid(nx, ny) || this.bombAt(nx, ny) || this.botOn(nx, ny)) break;
      tx = nx;
      ty = ny;
    }
    if (tx === bomb.tx && ty === bomb.ty) return;
    bomb.fromX = bomb.x;
    bomb.fromY = bomb.y;
    bomb.tx = tx;
    bomb.ty = ty;
    bomb.slide = SLIDE_TIME;
    this.audio.play('bump');
  }

  private botDropBomb(tx: number, ty: number): boolean {
    if (this.arena.isSolid(tx, ty) || this.bombAt(tx, ty)) return false;
    this.addBomb('bot', tx, ty, BLAST_BASE, BOT_FUSE);
    return true;
  }

  private updateBombs(dt: number): void {
    const due: Bomb[] = [];
    for (const b of this.bombs) {
      if (b.dead) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) due.push(b);
      if (b.slide > 0) {
        b.slide = Math.max(0, b.slide - dt);
        const t = 1 - b.slide / SLIDE_TIME;
        b.x = lerp(b.fromX, b.tx + 0.5, t);
        b.y = lerp(b.fromY, b.ty + 0.5, t);
      }
    }
    for (const b of due) this.detonate(b);
    this.bombs = this.bombs.filter((b) => !b.dead);
  }

  /** Detonates `first` and every bomb its blast reaches, one explosion each (chain reaction). */
  private detonate(first: Bomb): void {
    const queue: Bomb[] = [first];
    for (let qi = 0; qi < queue.length; qi++) {
      const b = queue[qi];
      if (!b || b.dead) continue;
      b.dead = true;
      this.explode(b, queue);
    }
  }

  private explode(b: Bomb, chain: Bomb[]): void {
    const { arena } = this;
    const tiles: number[] = [arena.index(b.tx, b.ty)];
    for (const d of DIRECTIONS) {
      for (let s = 1; s <= b.power; s++) {
        const x = b.tx + d.x * s;
        const y = b.ty + d.y * s;
        const kind = arena.kindAt(x, y);
        if (kind === BORDER || kind === PILLAR) break;
        tiles.push(arena.index(x, y));
        if (kind === CRATE) {
          this.breakCrate(x, y);
          break;
        }
        const other = this.bombAt(x, y);
        if (other) chain.push(other);
      }
    }

    this.serial++;
    for (const t of tiles) this.blastMark[t] = this.serial;
    const big = tiles.length >= 5;
    this.explosions.push({ tiles, life: EXPLOSION_TIME, big });
    if (b.owner === 'player') this.player.ammo = Math.min(this.player.ammoMax, this.player.ammo + 1);

    this.blastFx(tiles, big);
    const kills = this.reapBots(this.serial);
    if (kills > 0) {
      this.maxStat('multikill', kills);
      if (kills > 1) this.score += (kills - 1) * 100;
    }
    const pi = arena.index(Math.floor(this.player.x), Math.floor(this.player.y));
    if (this.blastMark[pi] === this.serial) this.hurtPlayer();
  }

  private breakCrate(x: number, y: number): void {
    this.arena.breakCrate(x, y);
    this.blocks++;
    this.addStat('blocks');
    this.score += 10;
    const s = this.screenOf(x + 0.5, y + 0.5);
    this.particles.emit({
      x: s.x,
      y: s.y,
      count: 12,
      speed: 150,
      life: 0.6,
      size: 4,
      colors: WOOD_COLORS,
      shape: 'square',
    });
    if (!this.rng.chance(DROP_CHANCE)) return;
    this.items.push({ kind: this.rng.weighted(ITEM_DROPS), x, y });
  }

  private blastFx(tiles: number[], big: boolean): void {
    const cols = this.arena.cols;
    const lay = this.layout();
    for (const t of tiles) {
      const tx = t % cols;
      const ty = (t - tx) / cols;
      const s = this.screenOf(tx + 0.5, ty + 0.5);
      this.particles.emit({
        x: s.x,
        y: s.y,
        count: big ? 4 : 3,
        speed: 110,
        speedVar: 0.7,
        life: 0.45,
        size: lay.ts * 0.14,
        colors: FIRE_COLORS,
      });
    }
    this.audio.play('explode', { volume: big ? 1 : 0.7 });
    this.shake.add(big ? 0.5 : 0.2);
  }

  private updateExplosions(dt: number): void {
    for (const e of this.explosions) e.life -= dt;
    this.explosions = this.explosions.filter((e) => e.life > 0);
  }

  // ---- bots ---------------------------------------------------------------------------------

  private updateBots(dt: number): void {
    this.occupied.fill(0);
    for (const b of this.bombs) {
      if (!b.dead) this.occupied[this.arena.index(b.tx, b.ty)] = 1;
    }
    const p = this.player;
    // While the player cannot be hurt (respawning or invulnerable) no contact time builds up, so a walker
    // still has to hold range for the full grace once the window ends.
    const hurtable = !this.isEnding && p.respawn <= 0 && p.invuln <= 0;
    for (const bot of this.bots) {
      if (stepBot(bot, this.botEnv, p.x, p.y, dt) && hurtable) this.hurtPlayer();
      if (!hurtable) bot.contact = 0;
    }
  }

  /** Removes bots at zero HP (only those inside `serial`'s blast when given), scoring each kill. */
  private reapBots(serial?: number): number {
    if (serial !== undefined) {
      for (const bot of this.bots) {
        const k = this.arena.index(Math.floor(bot.x), Math.floor(bot.y));
        if (this.blastMark[k] === serial) {
          bot.hp -= 1;
          bot.flash = 0.12;
        }
      }
    }
    const dead = this.bots.filter((b) => b.hp <= 0);
    if (dead.length === 0) return 0;
    this.bots = this.bots.filter((b) => b.hp > 0);
    for (const bot of dead) {
      this.kills++;
      this.addStat('kills');
      const points = bot.kind === 'bomber' ? 250 : 100;
      this.score += points;
      const s = this.screenOf(bot.x, bot.y);
      this.texts.add(s.x, s.y - 14, `+${points}`, '#fde68a', 18);
      this.particles.emit({
        x: s.x,
        y: s.y,
        count: 14,
        speed: 190,
        life: 0.6,
        size: 4,
        gravity: 260,
        colors: bot.kind === 'bomber' ? ['#94a3b8', '#e2e8f0', '#fb923c'] : ['#ef4444', '#fef2f2', '#fca5a5'],
      });
    }
    this.audio.play('stomp');
    return dead.length;
  }

  /**
   * The spawn point for the next bot: the first free one, in rotation order, that is at least
   * MIN_BOT_SPAWN_DIST tiles from the player's current tile. Null while none qualifies.
   */
  private pickSpawn(): Cell | null {
    const spawns = this.arena.botSpawns;
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);
    for (let i = 0; i < spawns.length; i++) {
      const idx = (this.spawnCursor + i) % spawns.length;
      const s = spawns[idx];
      if (!s || manhattan(s.x, s.y, px, py) < MIN_BOT_SPAWN_DIST) continue;
      if (this.spawnBusy(s)) continue;
      this.spawnCursor = idx + 1;
      return s;
    }
    return null;
  }

  /** A spawn point is busy while a bot stands on it or a bomb lies on it. */
  private spawnBusy(s: Cell): boolean {
    if (this.bombAt(s.x, s.y)) return true;
    return this.bots.some((b) => Math.hypot(b.x - (s.x + 0.5), b.y - (s.y + 0.5)) < 0.9);
  }

  private spawnBot(kind: BotKind, s: Cell): void {
    const bomber = kind === 'bomber';
    this.bots.push({
      kind,
      x: s.x + 0.5,
      y: s.y + 0.5,
      hp: bomber ? 2 : 1,
      maxHp: bomber ? 2 : 1,
      speed: bomber ? BOMBER_SPEED : WALKER_SPEED,
      path: [],
      goal: -1,
      repath: this.rng.range(0, REPATH_TIME),
      bombCd: 2,
      touchCd: 0,
      contact: 0,
      wait: 0.5,
      flash: 0,
      facingX: -1,
      phase: this.rng.range(0, TAU),
    });
    const fx = this.screenOf(s.x + 0.5, s.y + 0.5);
    this.particles.emit({ x: fx.x, y: fx.y, count: 8, speed: 90, life: 0.4, size: 3, colors: ['#e2e8f0'] });
  }

  // ---- waves --------------------------------------------------------------------------------

  private startWave(n: number): void {
    this.wave = n;
    this.maxStat('wave', n);
    this.waveAge = 0;
    this.clearTimer = -1;
    const walkers = Math.min(9, 2 + n);
    const bombers = Math.min(5, Math.max(0, n - 2));
    this.spawnQueue = [];
    for (let i = 0; i < walkers; i++) this.spawnQueue.push('walker');
    for (let i = 0; i < bombers; i++) this.spawnQueue.push('bomber');
    this.rng.shuffle(this.spawnQueue);
    this.spawnTimer = SPAWN_STAGGER;
    this.audio.play('levelup');
  }

  private updateWaves(dt: number): void {
    if (this.spawnQueue.length > 0) {
      this.spawnTimer -= dt;
      // A due bot waits in the queue until a spawn point clear of the player is free.
      const at = this.spawnTimer <= 0 ? this.pickSpawn() : null;
      const kind = this.spawnQueue[0];
      if (at && kind) {
        this.spawnQueue.shift();
        this.spawnTimer = SPAWN_STAGGER;
        this.spawnBot(kind, at);
      }
      return;
    }
    if (this.bots.length > 0) return;
    if (this.clearTimer < 0) {
      this.clearTimer = WAVE_CLEAR_DELAY;
      return;
    }
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) {
      this.score += 200 * this.wave;
      this.audio.play('reward');
      this.startWave(this.wave + 1);
    }
  }

  // ---- helpers ------------------------------------------------------------------------------

  /** Logical screen position of a point given in tile units. */
  private screenOf(x: number, y: number): { x: number; y: number } {
    const lay = this.layout();
    return { x: lay.ox + x * lay.ts, y: lay.oy + y * lay.ts };
  }
}
