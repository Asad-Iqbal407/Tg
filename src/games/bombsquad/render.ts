import { formatNumber, TAU } from '../../core/math';
import { banner, fillRoundRect, hudPill, roundRectPath, shade, text } from '../draw';
import { type Arena, BORDER, CRATE, PILLAR } from './grid';
import {
  type Bomb,
  type Bot,
  EXPLOSION_TIME,
  type Explosion,
  type Item,
  type ItemKind,
  LIVES,
  PLAYER_RADIUS,
  type Player,
  WAVE_BANNER,
} from './types';

export interface Palette {
  suit: string;
  visor: string;
  skin: string;
  hair: string;
  bomb: string;
  fuse: string;
  crate: string;
  stone: string;
  floor1: string;
  floor2: string;
}

/** A rectangle in logical px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Logical px per tile and the screen position of tile (0, 0). `clip` is set when the arena runs past its room
 * (a zoomed phone view with the camera on the player): the arena is drawn inside it, under the HUD.
 */
export interface Layout {
  ts: number;
  ox: number;
  oy: number;
  clip?: Rect;
}

export interface SceneView {
  W: number;
  H: number;
  time: number;
  preview: boolean;
  arena: Arena;
  layout: Layout;
  palette: Palette;
  player: Player;
  bots: readonly Bot[];
  bombs: readonly Bomb[];
  explosions: readonly Explosion[];
  items: readonly Item[];
  lives: number;
  wave: number;
  waveAge: number;
  score: number;
  ammo: number;
  ammoMax: number;
  /** Touch controls are on: the game is drawn small on a phone, so the HUD text is set larger. */
  compact: boolean;
  /** HUD text size under touch controls (logical px), from hudTextPx. */
  hudPx: number;
}

const BG = '#0b1020';
/** HUD text size under touch controls (logical px): at a phone's scale it stays at least 12 CSS px. */
export const COMPACT_HUD_PX = 21;
/** The smallest on-screen text, in CSS px, that the HUD and the floating labels keep. */
export const MIN_TEXT_CSS = 12;
/** The controlled character, and a walker, are each drawn at least this share of a phone's short side. */
export const MIN_CHARACTER_SHARE = 0.08;
/** A walker's diameter in tile units at the normal size (its radius is 0.3 tile). */
const WALKER_TILES = 0.6;

/**
 * HUD text size (logical px) under touch controls. It is COMPACT_HUD_PX where the canvas is drawn at a phone's usual
 * scale, and larger where the canvas is scaled down (a portrait phone running the game anyway, a turned phone under
 * the controls), so the text stays at MIN_TEXT_CSS CSS px. `cssScale` is CSS px per logical px.
 */
export function hudTextPx(cssScale: number): number {
  if (!(cssScale > 0)) return COMPACT_HUD_PX;
  return Math.max(COMPACT_HUD_PX, Math.ceil(MIN_TEXT_CSS / cssScale));
}

/**
 * The smallest tile (logical px) at which the controlled character and a walker are each at least MIN_CHARACTER_SHARE
 * of the stage's short side. `stageShortCss` is that side in CSS px and `cssScale` is CSS px per logical px. Both sizes
 * scale with the tile, so the zoom that meets the share is the same on any canvas size at a given stage.
 */
export function tileForCharacters(stageShortCss: number, cssScale: number): number {
  if (!(stageShortCss > 0 && cssScale > 0)) return 0;
  const need = (tallTiles: number) => (MIN_CHARACTER_SHARE * stageShortCss) / (tallTiles * cssScale);
  return Math.ceil(
    Math.max(need(PLAYER_HEIGHT_TILES * COMPACT_PLAYER_SCALE), need(WALKER_TILES * COMPACT_BOT_SCALE)),
  );
}
/**
 * Bots are drawn this much larger under touch controls, so a walker is about 8% of a phone's short side (the bots'
 * collision size is unchanged).
 */
export const COMPACT_BOT_SCALE = 1.45;
/**
 * The player is drawn this much larger under touch controls, so the character is about 9% of a phone's short side
 * (the collision size is unchanged).
 */
export const COMPACT_PLAYER_SCALE = 1.3;
/** The player sprite from the top of its head to its shoes, in tile units at the normal size. */
export const PLAYER_HEIGHT_TILES = 0.76;
/** The sprite's feet sit this far below the player's tile centre, in tile units. */
const FEET_DROP = 0.16;
const WALKER_BODY = '#f87171';
const BOMBER_BODY = '#94a3b8';
const HEART = '#f43f5e';
const ITEM_COLOR: Record<ItemKind, string> = {
  blast: '#fb923c',
  bombs: '#e2e8f0',
  speed: '#38bdf8',
  shield: '#60a5fa',
};

/** Draws the arena, its contents and (outside preview) the HUD and wave banner. */
export function drawScene(ctx: CanvasRenderingContext2D, v: SceneView): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, v.W, v.H);
  const { arena, layout: lay } = v;
  const { ts, ox, oy } = lay;
  const cols = arena.cols;
  const rows = arena.rows;

  // A zoomed arena runs past its room: it is drawn inside the room, so it never shows under the HUD or the controls.
  if (lay.clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(lay.clip.x, lay.clip.y, lay.clip.w, lay.clip.h);
    ctx.clip();
  }
  fillRoundRect(ctx, ox - 6, oy - 6, cols * ts + 12, rows * ts + 12, 10, shade(v.palette.stone, -0.5));
  // Ground layer: floor, blast scorch and flames, pick-ups and shadows.
  drawFloor(ctx, v);
  drawExplosionsOnFloor(ctx, v);
  drawExplosionFlames(ctx, v);
  drawItems(ctx, v);
  drawShadows(ctx, v);

  // Standing layer, row by row: blocks in the row, then the entities on it, so nearer rows overlap.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const kind = arena.kindAt(col, row);
      if (kind === BORDER || kind === PILLAR)
        drawStone(ctx, ox + col * ts, oy + row * ts, ts, v.palette.stone);
      else if (kind === CRATE) drawCrate(ctx, ox + col * ts, oy + row * ts, ts, v.palette.crate);
    }
    drawRowEntities(ctx, v, row);
  }
  if (lay.clip) ctx.restore();

  if (!v.preview) {
    drawHud(ctx, v);
    if (v.waveAge < WAVE_BANNER) {
      banner(ctx, v.W, v.H, `WAVE ${v.wave}`, '', v.waveAge / WAVE_BANNER, '#fde68a');
    }
  }
}

function drawFloor(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const { arena, layout: lay, palette } = v;
  for (let row = 0; row < arena.rows; row++) {
    for (let col = 0; col < arena.cols; col++) {
      if (arena.isSolid(col, row)) continue;
      const x = lay.ox + col * lay.ts;
      const y = lay.oy + row * lay.ts;
      ctx.fillStyle = (col + row) % 2 === 0 ? palette.floor1 : palette.floor2;
      ctx.fillRect(x, y, lay.ts + 0.5, lay.ts + 0.5);
    }
  }
}

function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, stone: string): void {
  const inset = ts * 0.08;
  ctx.fillStyle = shade(stone, -0.45);
  ctx.fillRect(x, y, ts, ts);
  ctx.fillStyle = shade(stone, 0.22);
  ctx.fillRect(x + inset, y + inset, ts - inset * 2, ts - inset * 2);
  ctx.fillStyle = stone;
  ctx.fillRect(x + inset * 2, y + inset * 2, ts - inset * 4, ts - inset * 4);
  ctx.fillStyle = shade(stone, -0.2);
  ctx.fillRect(x + inset * 2, y + ts - inset * 3.2, ts - inset * 4, inset * 1.2);
  ctx.fillRect(x + ts - inset * 3.2, y + inset * 2, inset * 1.2, ts - inset * 4);
  ctx.fillStyle = shade(stone, 0.4);
  ctx.fillRect(x + inset * 2, y + inset * 2, ts - inset * 4, Math.max(1, inset * 0.6));
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number, crate: string): void {
  const pad = ts * 0.07;
  const dark = shade(crate, -0.4);
  fillRoundRect(ctx, x + pad, y + pad, ts - pad * 2, ts - pad * 2, ts * 0.06, crate);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, ts * 0.06);
  roundRectPath(ctx, x + pad, y + pad, ts - pad * 2, ts - pad * 2, ts * 0.06);
  ctx.stroke();
  ctx.fillStyle = shade(crate, -0.2);
  for (const f of [0.33, 0.66]) ctx.fillRect(x + pad, y + ts * f - ts * 0.02, ts - pad * 2, ts * 0.04);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, ts * 0.07);
  const m = ts * 0.2;
  ctx.beginPath();
  ctx.moveTo(x + m, y + m);
  ctx.lineTo(x + ts - m, y + ts - m);
  ctx.moveTo(x + ts - m, y + m);
  ctx.lineTo(x + m, y + ts - m);
  ctx.stroke();
}

function drawShadows(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const { ts, ox, oy } = v.layout;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(ox + x * ts, oy + y * ts, rx, ry, 0, 0, TAU);
    ctx.fill();
  };
  for (const b of v.bombs) ellipse(b.x, b.y + 0.12, ts * 0.22, ts * 0.1);
  for (const bot of v.bots) ellipse(bot.x, bot.y + 0.3, ts * 0.26, ts * 0.1);
  if (v.player.respawn <= 0) {
    const k = v.compact ? COMPACT_PLAYER_SCALE : 1;
    ellipse(v.player.x, v.player.y + 0.3, ts * 0.24 * k, ts * 0.1 * k);
  }
}

function drawExplosionsOnFloor(ctx: CanvasRenderingContext2D, v: SceneView): void {
  // Scorch marks under the flames, so a blast still reads after its flames fade.
  const { ts, ox, oy } = v.layout;
  const cols = v.arena.cols;
  ctx.fillStyle = 'rgba(30,10,0,0.22)';
  for (const e of v.explosions) {
    for (const t of e.tiles) {
      const tx = t % cols;
      const ty = (t - tx) / cols;
      ctx.fillRect(ox + tx * ts, oy + ty * ts, ts, ts);
    }
  }
}

function drawExplosionFlames(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const { ts, ox, oy } = v.layout;
  const cols = v.arena.cols;
  for (const e of v.explosions) {
    const f = Math.max(0, e.life / EXPLOSION_TIME);
    const flicker = 0.85 + 0.15 * Math.sin(v.time * 40 + e.tiles.length);
    ctx.globalAlpha = Math.min(1, f * 1.6);
    for (const t of e.tiles) {
      const tx = t % cols;
      const ty = (t - tx) / cols;
      const x = ox + tx * ts;
      const y = oy + ty * ts;
      // Flames fill their whole tile: red edge, orange body, yellow heart, white core while fresh.
      ctx.fillStyle = f > 0.5 ? '#f97316' : '#dc2626';
      ctx.fillRect(x, y, ts + 0.5, ts + 0.5);
      const inset = ts * (0.16 + 0.12 * (1 - f)) * flicker;
      ctx.fillStyle = f > 0.45 ? '#fde047' : '#fb923c';
      ctx.fillRect(x + inset, y + inset, ts - inset * 2, ts - inset * 2);
      if (f > 0.55) {
        ctx.fillStyle = '#fff7ed';
        const core = ts * 0.24;
        ctx.fillRect(x + (ts - core) / 2, y + (ts - core) / 2, core, core);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawItems(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const { ts, ox, oy } = v.layout;
  for (let i = 0; i < v.items.length; i++) {
    const it = v.items[i];
    if (!it) continue;
    const cx = ox + (it.x + 0.5) * ts;
    const cy = oy + (it.y + 0.5) * ts;
    const pulse = 1 + 0.08 * Math.sin(v.time * 5 + i * 1.7);
    const r = ts * 0.3 * pulse;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + ts * 0.08, 0, TAU);
    ctx.fill();
    drawItemIcon(ctx, it.kind, cx, cy, r);
  }
}

/** Icons: flame for BLAST, bomb for BOMBS, boot for SPEED, shield for SHIELD. */
function drawItemIcon(ctx: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  const color = ITEM_COLOR[kind];
  if (kind === 'blast') {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.9, -r * 0.1, r * 0.55, r * 0.6);
    ctx.quadraticCurveTo(0, r * 1.05, -r * 0.55, r * 0.6);
    ctx.quadraticCurveTo(-r * 0.9, -r * 0.1, 0, -r);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.3, r * 0.42, 0, 0, TAU);
    ctx.fill();
  } else if (kind === 'bombs') {
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r * 0.62, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.4);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.9, r * 0.8, -r * 0.8);
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(r * 0.8, -r * 0.8, r * 0.16, 0, TAU);
    ctx.fill();
  } else if (kind === 'speed') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, -r * 0.8);
    ctx.lineTo(r * 0.1, -r * 0.8);
    ctx.lineTo(r * 0.2, r * 0.1);
    ctx.lineTo(r * 0.8, r * 0.3);
    ctx.lineTo(r * 0.8, r * 0.7);
    ctx.lineTo(-r * 0.45, r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-r * 0.45, r * 0.45, r * 1.25, r * 0.25);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.6);
    ctx.lineTo(0, -r * 0.85);
    ctx.lineTo(r * 0.7, -r * 0.6);
    ctx.lineTo(r * 0.7, r * 0.1);
    ctx.quadraticCurveTo(r * 0.6, r * 0.7, 0, r * 0.9);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.7, -r * 0.7, r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#eff6ff';
    ctx.beginPath();
    ctx.arc(0, -r * 0.05, r * 0.22, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Draws the entities standing on tile row `row` (bots, bombs, player), in painter order. */
function drawRowEntities(ctx: CanvasRenderingContext2D, v: SceneView, row: number): void {
  for (const b of v.bombs) if (Math.floor(b.y) === row && !underPlayer(v, b)) drawBomb(ctx, v, b, 0);
  for (const bot of v.bots) if (Math.floor(bot.y) === row) drawBot(ctx, v, bot);
  if (v.player.respawn > 0 || Math.floor(v.player.y) !== row) return;
  // A bomb under the player lies beneath the sprite, sunk to the feet so its lower half shows.
  // Its fuse is drawn over the sprite so the spark stays visible.
  for (const b of v.bombs) if (underPlayer(v, b)) drawBombBody(ctx, v, b, FEET_DROP);
  drawPlayer(ctx, v);
  for (const b of v.bombs) if (underPlayer(v, b)) drawBombFuse(ctx, v, b, FEET_DROP);
}

/** True when the player's body overlaps the bomb's tile, as it does for a bomb laid under them. */
function underPlayer(v: SceneView, b: Bomb): boolean {
  const p = v.player;
  if (p.respawn > 0) return false;
  const r = PLAYER_RADIUS;
  return (
    b.tx >= Math.floor(p.x - r) &&
    b.tx <= Math.floor(p.x + r - 1e-9) &&
    b.ty >= Math.floor(p.y - r) &&
    b.ty <= Math.floor(p.y + r - 1e-9)
  );
}

/** A bomb lies on its tile (a punched one slides along the floor). `sink` lowers it, in tile units. */
function drawBomb(ctx: CanvasRenderingContext2D, v: SceneView, b: Bomb, sink: number): void {
  drawBombBody(ctx, v, b, sink);
  drawBombFuse(ctx, v, b, sink);
}

/** The bomb's round body with its glint. */
function drawBombBody(ctx: CanvasRenderingContext2D, v: SceneView, b: Bomb, sink: number): void {
  const { ts, ox, oy } = v.layout;
  const cx = ox + b.x * ts;
  const cy = oy + (b.y + sink) * ts;
  const r = ts * 0.26;
  const owner = b.owner === 'bot' ? 0.85 : 1;
  ctx.fillStyle = v.palette.bomb;
  ctx.globalAlpha = owner;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  // A faint light rim keeps the dark body readable on the dark floor.
  ctx.strokeStyle = 'rgba(226,232,240,0.35)';
  ctx.lineWidth = Math.max(1, ts * 0.03);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.28, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The fuse: a stem curling up from the body, and a spark that flickers faster as the fuse runs down. */
function drawBombFuse(ctx: CanvasRenderingContext2D, v: SceneView, b: Bomb, sink: number): void {
  const { ts, ox, oy } = v.layout;
  const cx = ox + b.x * ts;
  const cy = oy + (b.y + sink) * ts;
  const r = ts * 0.26;
  const body = v.palette.bomb;
  const stemX = cx + r * 0.55;
  const stemY = cy - r * 0.85;
  ctx.strokeStyle = shade(body, 0.35);
  ctx.lineWidth = Math.max(1.5, ts * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.3, cy - r * 0.7);
  ctx.quadraticCurveTo(stemX, stemY - r * 0.1, stemX + r * 0.3, stemY - r * 0.35);
  ctx.stroke();

  const pace = 6 + 22 * (1 - Math.max(0, b.fuse) / Math.max(0.01, b.maxFuse));
  const pulse = 0.5 + 0.5 * Math.sin(v.time * pace * 2.2);
  const sr = ts * (0.07 + 0.04 * pulse);
  ctx.fillStyle = v.palette.fuse;
  ctx.beginPath();
  ctx.arc(stemX + r * 0.3, stemY - r * 0.35, sr * 1.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fef9c3';
  ctx.beginPath();
  ctx.arc(stemX + r * 0.3, stemY - r * 0.35, sr * 0.7, 0, TAU);
  ctx.fill();
}

function drawBot(ctx: CanvasRenderingContext2D, v: SceneView, bot: Bot): void {
  const { ts, ox, oy } = v.layout;
  const cx = ox + bot.x * ts;
  const moving = bot.goal >= 0;
  const bob = (moving ? Math.abs(Math.sin(v.time * 12 + bot.phase)) : 0) * ts * 0.06;
  const spawn = bot.wait > 0 ? Math.max(0, 1 - bot.wait / 0.5) : 1;
  const bomber = bot.kind === 'bomber';
  const size = v.compact ? COMPACT_BOT_SCALE : 1;
  const r = ts * (bomber ? 0.36 : 0.3) * size * (0.4 + 0.6 * spawn);
  const cy = oy + bot.y * ts - bob - r * 0.2;
  const flashing = bot.flash > 0;
  const base = bomber ? BOMBER_BODY : WALKER_BODY;
  const body = flashing ? '#ffffff' : bot.hp < bot.maxHp ? shade(base, -0.25) : base;

  ctx.save();
  ctx.globalAlpha = spawn;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = shade(base, -0.5);
  ctx.lineWidth = Math.max(1.5, ts * 0.04);
  ctx.stroke();

  const dir = bot.facingX < 0 ? -1 : 1;
  const ex = r * 0.38;
  const ey = cy - r * 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - ex + dir * r * 0.08, ey, r * 0.22, 0, TAU);
  ctx.arc(cx + ex + dir * r * 0.08, ey, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(cx - ex + dir * r * 0.14, ey + r * 0.04, r * 0.1, 0, TAU);
  ctx.arc(cx + ex + dir * r * 0.14, ey + r * 0.04, r * 0.1, 0, TAU);
  ctx.fill();
  // Angry brows slope down toward the middle.
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - ex - r * 0.28, ey - r * 0.32);
  ctx.lineTo(cx - ex + r * 0.22, ey - r * 0.12);
  ctx.moveTo(cx + ex + r * 0.28, ey - r * 0.32);
  ctx.lineTo(cx + ex - r * 0.22, ey - r * 0.12);
  ctx.stroke();

  if (bomber) {
    // Helmet: a dark dome over the top of the head with a rim.
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 0.92, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.fillRect(cx - r * 0.55, cy - r * 0.2, r * 1.1, r * 0.12);
  }
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const p = v.player;
  const { ts, ox, oy } = v.layout;
  const pal = v.palette;
  if (p.invuln > 0 && Math.floor(v.time * 12) % 2 === 0) return;
  const cx = ox + p.x * ts;
  const feet = oy + p.y * ts + ts * FEET_DROP;
  const r = ts * 0.3 * (v.compact ? COMPACT_PLAYER_SCALE : 1);
  const swing = Math.sin(p.walk) * r * 0.25;
  const flip = p.facingX < 0 ? -1 : 1;

  ctx.save();
  ctx.translate(cx, feet);
  ctx.scale(flip, 1);
  // Legs
  ctx.fillStyle = shade(pal.suit, -0.35);
  ctx.fillRect(-r * 0.5, -r * 0.5, r * 0.4, r * 0.55 + swing);
  ctx.fillRect(r * 0.1, -r * 0.5, r * 0.4, r * 0.55 - swing);
  // Body
  fillRoundRect(ctx, -r * 0.7, -r * 1.55, r * 1.4, r * 1.2, r * 0.4, pal.suit);
  // Head, hair and visor
  ctx.fillStyle = pal.skin;
  ctx.beginPath();
  ctx.arc(0, -r * 1.85, r * 0.62, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pal.hair;
  ctx.beginPath();
  ctx.arc(0, -r * 1.85, r * 0.64, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(r * 0.5, -r * 2.15);
  ctx.lineTo(-r * 0.5, -r * 2.15);
  ctx.closePath();
  ctx.fill();
  fillRoundRect(ctx, -r * 0.2, -r * 2.0, r * 0.7, r * 0.4, r * 0.15, pal.visor);
  ctx.fillStyle = shade(pal.visor, -0.5);
  ctx.beginPath();
  ctx.arc(r * 0.2, -r * 1.8, r * 0.07, 0, TAU);
  ctx.fill();
  ctx.restore();

  if (p.shielded) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(v.time * 6);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = Math.max(2, ts * 0.05);
    ctx.beginPath();
    ctx.arc(cx, feet - r * 1.1, r * 1.9, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud(ctx: CanvasRenderingContext2D, v: SceneView): void {
  const p = v.player;
  const big = v.compact;
  // Under touch controls the text is hudPx (see hudTextPx), and the pills grow with it. At the usual size they are the
  // pills they always were.
  const px = big ? v.hudPx : COMPACT_HUD_PX;
  const waveW = big ? Math.round((124 * px) / COMPACT_HUD_PX) : 124;
  // The hearts and the ammo bombs are drawn larger under touch controls, where the canvas is small on screen, as far as
  // the room left of the wave pill allows.
  const k = big ? lifePillScale(v.W, waveW) : 1;
  ctx.save();
  ctx.translate(8, 6);
  ctx.scale(k, k);
  ctx.translate(-8, -6);
  hudPill(ctx, 8, 6, 176, 44);
  for (let i = 0; i < LIVES; i++) drawHeart(ctx, 26 + i * 26, 22, 18, i < v.lives);
  // Ammo: small bombs (up to ten shown, then a count).
  const shown = Math.min(v.ammoMax, 10);
  for (let i = 0; i < shown; i++) {
    const filled = i < v.ammo;
    const bx = 24 + i * 15;
    // Dark bombs need a light rim to read on the dark HUD pill.
    ctx.beginPath();
    ctx.arc(bx, 40, 6.5, 0, TAU);
    if (filled) {
      ctx.fillStyle = v.palette.bomb;
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = v.palette.fuse;
      ctx.beginPath();
      ctx.arc(bx + 3, 33.5, 2, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  if (v.ammoMax > shown)
    text(ctx, `+${v.ammoMax - shown}`, 24 + shown * 15, 41, {
      size: big ? px : 11,
      color: '#e2e8f0',
    });
  ctx.restore();

  hudPill(ctx, v.W / 2 - waveW / 2, 6, waveW, 36);
  text(ctx, `WAVE ${v.wave}`, v.W / 2, 24, {
    size: big ? px : 18,
    align: 'center',
    color: '#fde68a',
  });

  // Under touch controls the score pill has two lines (score, then power-ups), each at the larger text size, set in
  // from the right so the rounded end of the pill keeps clear of them.
  const pillW = big ? Math.round((224 * px) / COMPACT_HUD_PX) : 188;
  const right = v.W - (big ? 20 : 14);
  hudPill(ctx, v.W - pillW - 8, 6, pillW, big ? 2 * px + 8 : 44);
  text(ctx, formatNumber(v.score), right, big ? px - 1 : 22, {
    size: big ? px : 20,
    align: 'right',
    color: '#ffffff',
  });
  const chips: string[] = [];
  if (p.blastUps > 0) chips.push(`F${p.blastUps}`);
  if (p.bombUps > 0) chips.push(`B${p.bombUps}`);
  if (p.speedUps > 0) chips.push(`S${p.speedUps}`);
  if (p.shielded) chips.push('SH');
  text(ctx, chips.length > 0 ? chips.join('  ') : 'no power-ups', right, big ? 2 * px : 41, {
    size: big ? px : 12,
    align: 'right',
    weight: 700,
    color: chips.length > 0 ? '#bae6fd' : 'rgba(255,255,255,0.45)',
  });
}

/** Width of the lives-and-ammo pill at the usual size, in logical px. */
const LIFE_PILL_W = 176;
/** How much larger the lives-and-ammo pill is drawn under touch controls. */
const LIFE_PILL_TOUCH = 1.25;

/**
 * Scale of the lives-and-ammo pill under touch controls: LIFE_PILL_TOUCH, or less where it would come within 12 logical px
 * of the wave pill (`waveW` wide, centred on a `W` wide canvas). Never below the usual size.
 */
export function lifePillScale(W: number, waveW: number): number {
  const room = W / 2 - waveW / 2 - 12 - 8;
  return Math.max(1, Math.min(LIFE_PILL_TOUCH, room / LIFE_PILL_W));
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, filled: boolean): void {
  ctx.fillStyle = filled ? HEART : 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(x - s * 0.25, y - s * 0.1, s * 0.27, 0, TAU);
  ctx.arc(x + s * 0.25, y - s * 0.1, s * 0.27, 0, TAU);
  ctx.moveTo(x - s * 0.5, y - s * 0.02);
  ctx.lineTo(x + s * 0.5, y - s * 0.02);
  ctx.lineTo(x, y + s * 0.45);
  ctx.closePath();
  ctx.fill();
}
