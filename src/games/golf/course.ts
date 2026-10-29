/** Points are in course units: x from 0 to 1 across, y from 0 (far end) to 1.4 (near end). */
export type Pt = readonly [number, number];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Hole {
  name: string;
  par: number;
  /** The playing area's outline. */
  outline: readonly Pt[];
  /** Solid blocks inside the area. */
  blocks: readonly (readonly Pt[])[];
  sand: readonly Rect[];
  water: readonly Rect[];
  bumpers: readonly { x: number; y: number; r: number }[];
  windmill: { x: number; y: number; len: number; speed: number } | null;
  tee: Pt;
  cup: Pt;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const base = { blocks: [], sand: [], water: [], bumpers: [], windmill: null };

export const HOLES: readonly Hole[] = [
  {
    ...base,
    name: 'Straight Shot',
    par: 2,
    outline: rect(0.2, 0.1, 0.8, 1.3),
    tee: [0.5, 1.18],
    cup: [0.5, 0.25],
  },
  {
    ...base,
    name: 'Dogleg',
    par: 3,
    outline: [
      [0.1, 1.3],
      [0.48, 1.3],
      [0.48, 0.55],
      [0.9, 0.55],
      [0.9, 0.1],
      [0.1, 0.1],
    ],
    tee: [0.29, 1.18],
    cup: [0.75, 0.28],
  },
  {
    ...base,
    name: 'The Block',
    par: 3,
    outline: rect(0.12, 0.1, 0.88, 1.3),
    blocks: [rect(0.3, 0.62, 0.7, 0.76)],
    tee: [0.5, 1.18],
    cup: [0.5, 0.24],
  },
  {
    ...base,
    name: 'Bunkers',
    par: 3,
    outline: rect(0.15, 0.1, 0.85, 1.3),
    sand: [
      { x0: 0.15, y0: 0.55, x1: 0.6, y1: 0.8 },
      { x0: 0.4, y0: 0.3, x1: 0.85, y1: 0.45 },
    ],
    tee: [0.5, 1.18],
    cup: [0.3, 0.22],
  },
  {
    ...base,
    name: 'Bridge',
    par: 3,
    outline: rect(0.1, 0.1, 0.9, 1.3),
    water: [
      { x0: 0.1, y0: 0.6, x1: 0.42, y1: 0.8 },
      { x0: 0.58, y0: 0.6, x1: 0.9, y1: 0.8 },
    ],
    tee: [0.5, 1.18],
    cup: [0.5, 0.22],
  },
  {
    ...base,
    name: 'Windmill',
    par: 3,
    outline: rect(0.15, 0.1, 0.85, 1.3),
    windmill: { x: 0.5, y: 0.7, len: 0.24, speed: 1.6 },
    tee: [0.5, 1.18],
    cup: [0.5, 0.24],
  },
  {
    ...base,
    name: 'Zigzag',
    par: 4,
    outline: rect(0.1, 0.1, 0.9, 1.3),
    blocks: [rect(0.1, 0.85, 0.62, 0.92), rect(0.38, 0.48, 0.9, 0.55)],
    tee: [0.25, 1.18],
    cup: [0.72, 0.22],
  },
  {
    ...base,
    name: 'Pinball',
    par: 3,
    outline: rect(0.12, 0.1, 0.88, 1.3),
    bumpers: [
      { x: 0.35, y: 0.62, r: 0.06 },
      { x: 0.65, y: 0.62, r: 0.06 },
      { x: 0.5, y: 0.42, r: 0.06 },
      { x: 0.5, y: 0.86, r: 0.05 },
    ],
    tee: [0.5, 1.2],
    cup: [0.5, 0.2],
  },
  {
    ...base,
    name: 'Grand Finale',
    par: 4,
    outline: [
      [0.1, 1.3],
      [0.9, 1.3],
      [0.9, 0.78],
      [0.55, 0.78],
      [0.55, 0.1],
      [0.1, 0.1],
    ],
    sand: [{ x0: 0.1, y0: 0.82, x1: 0.38, y1: 1.02 }],
    water: [{ x0: 0.1, y0: 0.3, x1: 0.24, y1: 0.42 }],
    windmill: { x: 0.33, y: 0.55, len: 0.18, speed: -2 },
    tee: [0.75, 1.15],
    cup: [0.33, 0.2],
  },
];

/** Every wall of a hole as segments: its outline and each block, all closed. */
export function wallsOf(h: Hole): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const poly of [h.outline, ...h.blocks]) {
    for (let i = 0; i < poly.length; i++) out.push([poly[i] as Pt, poly[(i + 1) % poly.length] as Pt]);
  }
  return out;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** The two crossed blades of a windmill turned to `angle`, as segments. */
export function bladesOf(w: NonNullable<Hole['windmill']>, angle: number): [Pt, Pt][] {
  return [0, Math.PI / 2].map((k) => {
    const dx = Math.cos(angle + k) * w.len;
    const dy = Math.sin(angle + k) * w.len;
    return [
      [w.x - dx, w.y - dy],
      [w.x + dx, w.y + dy],
    ] as [Pt, Pt];
  });
}

/**
 * Bounces a ball of radius r at (x, y) moving (vx, vy) off a segment it overlaps. Returns the new position and
 * velocity, or null when it does not touch the segment or is already moving away.
 */
export function bounceOff(
  x: number,
  y: number,
  vx: number,
  vy: number,
  r: number,
  a: Pt,
  b: Pt,
  restitution: number,
): { x: number; y: number; vx: number; vy: number } | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / len2));
  const cx = a[0] + ex * t;
  const cy = a[1] + ey * t;
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r || d === 0) return null;
  const nx = dx / d;
  const ny = dy / d;
  const vn = vx * nx + vy * ny;
  if (vn >= 0) return { x: cx + nx * r, y: cy + ny * r, vx, vy };
  return {
    x: cx + nx * r,
    y: cy + ny * r,
    vx: vx - (1 + restitution) * vn * nx,
    vy: vy - (1 + restitution) * vn * ny,
  };
}
