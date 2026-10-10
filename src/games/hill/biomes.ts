import { clamp, lerp } from '../../core/math';

export interface Biome {
  name: string;
  sky: readonly [string, string];
  far: string;
  near: string;
  ground: readonly [string, string];
  grass: string;
  /** Night sky: stars and a planet instead of the sun. */
  night: boolean;
  gravity: number;
  grip: number;
  /** Scales the terrain slope cap (ice gets gentler hills). */
  slope: number;
  /** Banner hint shown on arrival. */
  hint: string;
}

export const BIOMES: readonly Biome[] = [
  {
    name: 'Countryside',
    sky: ['#5fb6f5', '#cdeeff'],
    far: '#9cc7a0',
    near: '#5fa55f',
    ground: ['#8a5a2b', '#5b3a1e'],
    grass: '#57c84d',
    night: false,
    gravity: 1,
    grip: 1,
    slope: 1,
    hint: 'Rolling hills',
  },
  {
    name: 'Desert Dunes',
    sky: ['#f6a356', '#ffe3a8'],
    far: '#e9b97a',
    near: '#d39a55',
    ground: ['#d9a75c', '#a8742f'],
    grass: '#f2cf7a',
    night: false,
    gravity: 1,
    grip: 0.9,
    slope: 1,
    hint: 'Loose sand: less grip',
  },
  {
    name: 'Frozen Peaks',
    sky: ['#6f9fd6', '#e8f3ff'],
    far: '#c9d9ec',
    near: '#a9bfd8',
    ground: ['#8fa9c6', '#5a7394'],
    grass: '#f4fbff',
    night: false,
    gravity: 1,
    grip: 0.72,
    slope: 0.85,
    hint: 'Slippery ice!',
  },
  {
    name: 'Lunar Base',
    sky: ['#05060f', '#1a1d3a'],
    far: '#2a2d48',
    near: '#3c3f5c',
    ground: ['#8b8d99', '#55576a'],
    grass: '#c9cbd6',
    night: true,
    gravity: 0.45,
    grip: 0.95,
    slope: 1.08,
    hint: 'Low gravity!',
  },
  {
    name: 'Volcano Ridge',
    sky: ['#2b0f1e', '#a8432a'],
    far: '#4a1f24',
    near: '#5e2a22',
    ground: ['#4b3a3a', '#241b1f'],
    grass: '#ff7a2f',
    night: true,
    gravity: 1,
    grip: 0.95,
    slope: 1.05,
    hint: 'Steeper climbs ahead',
  },
];

/** Length of one biome in metres; after the last one the cycle repeats, tougher each lap. */
export const BIOME_M = 800;
/** Metres over which gravity and grip blend into the next biome. */
const PHYSICS_BLEND_M = 30;

/** Index into BIOMES for a distance in metres (biomes cycle every BIOMES.length * BIOME_M). */
export function biomeIndexAt(m: number): number {
  return Math.floor(Math.max(0, m) / BIOME_M) % BIOMES.length;
}

export function biomeAt(m: number): Biome {
  return BIOMES[biomeIndexAt(m)] as Biome;
}

/** Sequential biome number (0, 1, 2, ...): changes exactly when a new biome starts. */
export function biomeSerial(m: number): number {
  return Math.floor(Math.max(0, m) / BIOME_M);
}

/** 1-based lap through the biome cycle. */
export function lapAt(m: number): number {
  return Math.floor(Math.max(0, m) / (BIOME_M * BIOMES.length)) + 1;
}

/** Gravity and grip at a distance, blended over the last metres before each biome boundary. */
export function physicsAt(m: number, out: { gravity: number; grip: number }): void {
  const cur = biomeAt(m);
  const nextFrom = (Math.floor(Math.max(0, m) / BIOME_M) + 1) * BIOME_M;
  const next = biomeAt(nextFrom);
  const t = clamp((m - (nextFrom - PHYSICS_BLEND_M)) / PHYSICS_BLEND_M, 0, 1);
  out.gravity = lerp(cur.gravity, next.gravity, t);
  out.grip = lerp(cur.grip, next.grip, t);
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
