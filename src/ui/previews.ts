import { NullAudio } from '../core/audio';
import { chooseLogicalSize } from '../core/engine';
import { Input } from '../core/input';
import { TAU } from '../core/math';
import { Rng } from '../core/rng';
import { fillRoundRect } from '../games/draw';
import { HERO } from '../games/platformer/sprites';
import { drawSprite } from '../games/sprite';
import { type GameDefinition, NO_INSETS, type SkinData } from '../games/types';
import type { SkinItem } from '../meta/catalog';

/** Seed, simulated seconds and vertical crop focus (0 = top, 1 = bottom) for card art. */
const PREVIEW: Record<string, { seed: number; seconds: number; focus: number }> = {
  snake: { seed: 4, seconds: 1.6, focus: 0.5 },
  bombsquad: { seed: 6, seconds: 1.5, focus: 0.5 },
  tetris: { seed: 8, seconds: 2.0, focus: 0.5 },
  runner: { seed: 4, seconds: 2.6, focus: 0.75 },
  platformer: { seed: 9, seconds: 2.6, focus: 0.5 },
  duck: { seed: 3, seconds: 2.4, focus: 0.5 },
  hill: { seed: 5, seconds: 2.8, focus: 0.5 },
  galaxy: { seed: 2, seconds: 7.5, focus: 0.3 },
  bubble: { seed: 5, seconds: 1.2, focus: 0.5 },
  pong: { seed: 7, seconds: 3.2, focus: 0.5 },
};

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Render a real frame of the game (simulated headlessly for a few seconds) for card art. The
 * logical size is chosen for the card's aspect, exactly as the play screen would for a stage of
 * that shape, and the frame is rendered at the resolution the card will show it at.
 */
function renderFrame(
  def: GameDefinition,
  skin: SkinData,
  targetW: number,
  targetH: number,
): HTMLCanvasElement | null {
  const size = chooseLogicalSize(def, targetW, targetH);
  const key = `${def.id}:${skin.id}:${size.width}x${size.height}@${targetW}x${targetH}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const scale = Math.min(1, Math.max(targetW / size.width, targetH / size.height));
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(size.width * scale));
  off.height = Math.max(1, Math.round(size.height * scale));
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  const cfg = PREVIEW[def.id] ?? { seed: 1, seconds: 2.5, focus: 0.5 };
  const input = new Input();
  // Simple autopilot so action games show something happening.
  if (def.id === 'hill') input.setVirtual('right', true, 'preview');
  const game = def.create({
    ctx,
    width: size.width,
    height: size.height,
    input,
    audio: new NullAudio(),
    rng: new Rng(cfg.seed),
    loadout: { skin, boosts: new Set(), powerDuration: 1 },
    insets: NO_INSETS,
    reducedMotion: true,
    haptic: () => undefined,
    preview: true,
  });
  try {
    const steps = Math.round(cfg.seconds * 60);
    for (let i = 0; i < steps; i++) {
      game.update(1 / 60);
      input.postUpdate();
    }
    ctx.setTransform(off.width / size.width, 0, 0, off.height / size.height, 0, 0);
    game.render();
  } finally {
    game.destroy();
  }
  cache.set(key, off);
  return off;
}

/** Draw a game preview into `target` using object-fit: cover. */
export function drawGamePreview(def: GameDefinition, skin: SkinData, target: HTMLCanvasElement): void {
  const frame = renderFrame(def, skin, target.width, target.height);
  const ctx = target.getContext('2d');
  if (!frame || !ctx) return;
  const tw = target.width;
  const th = target.height;
  const s = Math.max(tw / frame.width, th / frame.height);
  const w = frame.width * s;
  const hgt = frame.height * s;
  const oy = (th - hgt) * (PREVIEW[def.id]?.focus ?? 0.5);
  ctx.drawImage(frame, (tw - w) / 2, oy, w, hgt);
}

/** Queue preview rendering during idle time so the arcade paints instantly. */
export function schedulePreview(fn: () => void): void {
  const ric = (
    window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  ).requestIdleCallback;
  if (ric) ric(fn, { timeout: 600 });
  else setTimeout(fn, 30);
}

/** Small standalone drawings of each skin for the shop. */
export function drawSkinPreview(item: SkinItem, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const hgt = canvas.height;
  const p = item.palette;
  ctx.clearRect(0, 0, w, hgt);
  ctx.save();
  ctx.translate(w / 2, hgt / 2);
  const k = Math.min(w, hgt) / 100;
  ctx.scale(k, k);
  switch (item.gameId) {
    case 'runner': {
      fillRoundRect(ctx, -12, 4, 9, 30, 4, p.accent ?? '#333');
      fillRoundRect(ctx, 3, 4, 9, 30, 4, p.accent ?? '#333');
      fillRoundRect(ctx, -14, 30, 12, 6, 3, p.shoes ?? '#fff');
      fillRoundRect(ctx, 2, 30, 12, 6, 3, p.shoes ?? '#fff');
      fillRoundRect(ctx, -16, -26, 32, 34, 8, p.body ?? '#e63946');
      fillRoundRect(ctx, -24, -22, 9, 26, 4, p.body ?? '#e63946');
      fillRoundRect(ctx, 15, -22, 9, 26, 4, p.body ?? '#e63946');
      ctx.fillStyle = p.skin ?? '#f1c27d';
      ctx.beginPath();
      ctx.arc(0, -36, 12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.accent ?? '#333';
      ctx.beginPath();
      ctx.arc(0, -40, 12.5, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'platformer': {
      const def = HERO.big.stand;
      const px = 3.4;
      const pal = {
        H: p.hat ?? '#e63946',
        V: p.hat ?? '#e63946',
        h: p.hair ?? '#5a3214',
        S: p.skin ?? '#f6c18f',
        E: '#1b1b2f',
        m: '#7a2e2e',
        C: p.shirt ?? '#e63946',
        O: p.overalls ?? '#1d4ed8',
        B: '#ffd23f',
        F: '#6b3a1e',
      };
      drawSprite(ctx, def, pal, (-12 * px) / 2, (-def.length * px) / 2, px);
      break;
    }
    case 'duck': {
      const r = 28;
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.main ?? '#f33';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
      const style = item.params.style ?? 0;
      if (style === 1) {
        ctx.fillStyle = p.main ?? '#f33';
        ctx.shadowColor = p.main ?? '#f33';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = p.accent ?? '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          ctx.moveTo(dx * 8, dy * 8);
          ctx.lineTo(dx * (r + 10), dy * (r + 10));
        }
        ctx.stroke();
        if (style === 2) {
          ctx.strokeStyle = p.main ?? '#f33';
          ctx.beginPath();
          ctx.arc(0, 0, r / 2, 0, TAU);
          ctx.stroke();
        }
      }
      break;
    }
    case 'hill': {
      const wr = (item.params.wheelRadius ?? 20) * 0.9;
      ctx.fillStyle = p.body ?? '#e63946';
      ctx.beginPath();
      ctx.moveTo(-40, 8);
      ctx.lineTo(40, 8);
      ctx.lineTo(32, -12);
      ctx.lineTo(-38, -14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.trim ?? '#1d3557';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-38, -2);
      ctx.lineTo(36, -2);
      ctx.stroke();
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-34, -14);
      ctx.lineTo(-28, -40);
      ctx.lineTo(18, -34);
      ctx.lineTo(28, -12);
      ctx.stroke();
      ctx.fillStyle = p.helmet ?? '#ffd23f';
      ctx.beginPath();
      ctx.arc(-6, -30, 9, 0, TAU);
      ctx.fill();
      for (const x of [-26, 28]) {
        ctx.fillStyle = '#1b1b1f';
        ctx.beginPath();
        ctx.arc(x, 14, wr, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#9aa0ad';
        ctx.beginPath();
        ctx.arc(x, 14, wr * 0.5, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'snake': {
      // A curled serpent with a golden apple and a red apple.
      const body = p.body ?? '#4ade80';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = body;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(-34, 22);
      ctx.bezierCurveTo(-34, -16, 4, -30, 4, -2);
      ctx.bezierCurveTo(4, 20, 30, 18, 26, -10);
      ctx.stroke();
      ctx.fillStyle = p.head ?? '#bbf7d0';
      ctx.beginPath();
      ctx.arc(26, -10, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.food ?? '#ef4444';
      ctx.beginPath();
      ctx.arc(-30, -26, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.gold ?? '#fde047';
      ctx.beginPath();
      ctx.arc(20, 26, 6, 0, TAU);
      ctx.fill();
      break;
    }
    case 'bombsquad': {
      // A round bomb with a lit fuse.
      ctx.fillStyle = p.bomb ?? '#111827';
      ctx.beginPath();
      ctx.arc(0, 6, 26, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = p.fuse ?? '#f97316';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(10, -18);
      ctx.quadraticCurveTo(20, -36, 34, -30);
      ctx.stroke();
      ctx.fillStyle = p.fuse ?? '#f97316';
      ctx.beginPath();
      ctx.arc(34, -30, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.suit ?? '#3b82f6';
      fillRoundRect(ctx, -20, 26, 40, 14, 6, p.suit ?? '#3b82f6');
      ctx.fillStyle = p.visor ?? '#e0f2fe';
      ctx.beginPath();
      ctx.arc(-6, 2, 3, 0, TAU);
      ctx.arc(8, 2, 3, 0, TAU);
      ctx.fill();
      break;
    }
    case 'tetris': {
      // A T piece in its own colour, with a faint well behind it.
      const cell = 22;
      const x0 = -cell * 1.5;
      const y0 = -cell * 1.5;
      ctx.fillStyle = p.grid ?? '#16203a';
      fillRoundRect(ctx, x0 - 6, y0 - 6, cell * 3 + 12, cell * 2 + 12, 6, p.grid ?? '#16203a');
      const tColour = p.T ?? '#a855f7';
      const cells: [number, number][] = [
        [0, 0],
        [1, 0],
        [2, 0],
        [1, 1],
      ];
      for (const [cx, cy] of cells) {
        fillRoundRect(ctx, x0 + cx * cell + 1, y0 + cy * cell + 1, cell - 2, cell - 2, 4, tColour);
      }
      ctx.fillStyle = p.frame ?? '#334155';
      ctx.fillRect(x0 + cell * 3 + 6, y0, 3, cell * 2);
      fillRoundRect(ctx, x0 + cell * 3 + 12, y0 + cell * 0.2, cell * 0.8, cell * 0.8, 3, p.O ?? '#facc15');
      fillRoundRect(ctx, x0 + cell * 3 + 12, y0 + cell * 1.2, cell * 0.8, cell * 0.8, 3, p.I ?? '#22d3ee');
      break;
    }
    case 'galaxy': {
      const style = item.params.style ?? 0;
      const glow = ctx.createRadialGradient(0, 30, 2, 0, 30, 24);
      glow.addColorStop(0, p.engine ?? '#ffb703');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-30, 10, 60, 50);
      ctx.fillStyle = p.body ?? '#4dd9ff';
      ctx.beginPath();
      const shapes: Record<number, number[]> = {
        0: [0, -30, 10, -8, 26, 14, 10, 18, 0, 24, -10, 18, -26, 14, -10, -8],
        1: [0, -34, 8, -6, 28, 18, 8, 14, 0, 24, -8, 14, -28, 18, -8, -6],
        2: [0, -28, 16, -14, 32, 8, 30, 22, 10, 18, 0, 26, -10, 18, -30, 22, -32, 8, -16, -14],
        3: [0, -32, 10, -2, 30, -12, 22, 20, 0, 12, -22, 20, -30, -12, -10, -2],
      };
      const pts = shapes[style] ?? shapes[0]!;
      for (let i = 0; i < pts.length; i += 2) {
        const x = (pts[i] as number) * 1.2;
        const y = (pts[i + 1] as number) * 1.2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.accent ?? '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#0b1d3a';
      ctx.beginPath();
      ctx.ellipse(0, -6, 6, 12, 0, 0, TAU);
      ctx.fill();
      break;
    }
    case 'bubble': {
      // Coloured bubbles hanging over a loaded shooter, with a dashed aim line. Drawn a little smaller and
      // down and right, so the rarity tag in the corner of the card does not cover the top row.
      ctx.save();
      ctx.translate(8, 6);
      ctx.scale(0.8, 0.8);
      const board = ctx.createLinearGradient(0, -46, 0, 46);
      board.addColorStop(0, p.top ?? '#1e3a8a');
      board.addColorStop(1, p.bottom ?? '#0b1530');
      fillRoundRect(ctx, -50, -46, 100, 92, 10, board);
      ctx.strokeStyle = p.rail ?? '#67e8f9';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-16, -14);
      ctx.stroke();
      ctx.setLineDash([]);
      const colours = [
        p.c1 ?? '#38bdf8',
        p.c2 ?? '#f472b6',
        p.c3 ?? '#facc15',
        p.c4 ?? '#4ade80',
        p.c5 ?? '#a78bfa',
        p.c6 ?? '#fb923c',
      ];
      // [x, y, colour index] for each hanging bubble.
      const cells: [number, number, number][] = [
        [-36, -34, 0],
        [-18, -34, 1],
        [0, -34, 2],
        [18, -34, 3],
        [36, -34, 4],
        [-27, -17, 5],
        [-9, -17, 0],
        [9, -17, 1],
        [27, -17, 2],
        [-36, 0, 3],
        [-18, 0, 4],
        [0, 0, 5],
        [18, 0, 0],
        [36, 0, 1],
      ];
      for (const [x, y, i] of cells) {
        ctx.fillStyle = colours[i] ?? '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 8.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(x - 3, y - 3, 2.2, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = colours[2] ?? '#facc15';
      ctx.beginPath();
      ctx.arc(0, 24, 8.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.gun ?? '#e0f2fe';
      ctx.beginPath();
      ctx.arc(0, 44, 12, Math.PI, 0);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'pong': {
      // A table from above, with the centre line, both paddles and the ball in play. Offset and a little
      // smaller, like the bubble card, so the rarity tag stays clear.
      ctx.save();
      ctx.translate(8, 8);
      ctx.scale(0.85, 0.85);
      const table = ctx.createLinearGradient(0, -36, 0, 36);
      table.addColorStop(0, p.table1 ?? '#0f3d2e');
      table.addColorStop(1, p.table2 ?? '#0b2456');
      fillRoundRect(ctx, -56, -38, 112, 76, 8, table);
      ctx.fillStyle = p.rail ?? '#e2e8f0';
      ctx.fillRect(-56, -38, 112, 2.5);
      ctx.fillRect(-56, 35.5, 112, 2.5);
      ctx.strokeStyle = p.line ?? 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, -36);
      ctx.lineTo(0, 36);
      ctx.stroke();
      ctx.setLineDash([]);
      fillRoundRect(ctx, -50, -12, 5, 24, 2.5, p.player ?? '#fb923c');
      fillRoundRect(ctx, 45, -18, 5, 24, 2.5, p.rival ?? '#60a5fa');
      ctx.fillStyle = p.ball ?? '#fef9c3';
      ctx.beginPath();
      ctx.arc(14, -8, 4, 0, TAU);
      ctx.fill();
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}
