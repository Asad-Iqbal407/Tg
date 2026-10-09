import { NullAudio } from '../core/audio';
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
  runner: { seed: 4, seconds: 2.6, focus: 0.75 },
  platformer: { seed: 9, seconds: 2.6, focus: 0.5 },
  duck: { seed: 3, seconds: 2.4, focus: 0.5 },
  hill: { seed: 5, seconds: 2.8, focus: 0.5 },
  galaxy: { seed: 2, seconds: 7.5, focus: 0.3 },
};

const cache = new Map<string, HTMLCanvasElement>();

/** Render a real frame of the game (simulated headlessly for a few seconds) for card art. */
function renderFrame(def: GameDefinition, skin: SkinData): HTMLCanvasElement | null {
  const key = `${def.id}:${skin.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const scale = 0.5;
  const off = document.createElement('canvas');
  off.width = Math.round(def.width * scale);
  off.height = Math.round(def.height * scale);
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  const cfg = PREVIEW[def.id] ?? { seed: 1, seconds: 2.5, focus: 0.5 };
  const input = new Input();
  // Simple autopilot so action games show something happening.
  if (def.id === 'hill') input.setVirtual('right', true, 'preview');
  const game = def.create({
    ctx,
    width: def.width,
    height: def.height,
    input,
    audio: new NullAudio(),
    rng: new Rng(cfg.seed),
    loadout: { skin, boosts: new Set(), powerDuration: 1 },
    insets: NO_INSETS,
    reducedMotion: true,
    haptic: () => undefined,
  });
  try {
    const steps = Math.round(cfg.seconds * 60);
    for (let i = 0; i < steps; i++) {
      game.update(1 / 60);
      input.postUpdate();
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    game.render();
  } finally {
    game.destroy();
  }
  cache.set(key, off);
  return off;
}

/** Draw a game preview into `target` using object-fit: cover. */
export function drawGamePreview(def: GameDefinition, skin: SkinData, target: HTMLCanvasElement): void {
  const frame = renderFrame(def, skin);
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
  }
  ctx.restore();
}
