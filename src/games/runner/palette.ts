import { clamp } from '../../core/math';
import { MILESTONE_M } from './config';

/** Zone palettes: the city changes mood every milestone (sunset → dusk → neon night → dawn). */
interface ZoneDef {
  name: string;
  skyTop: string;
  skyMid: string;
  skyLow: string;
  sun: string;
  moon: boolean;
  stars: number;
  skylineFar: string;
  skylineNear: string;
  haze: string;
  ground: string;
  ballast: string;
  bed: string;
  sleeper: string;
  rail: string;
  wall: string;
  sidewalk: string;
  buildings: readonly [string, string, string, string];
  windowLit: string;
  windowDark: string;
  lit: number;
  neon: readonly [string, string, string];
  tunnel: string;
  water: string;
}

export const ZONES: readonly ZoneDef[] = [
  {
    name: 'SUNSET LINE',
    skyTop: '#1a1446',
    skyMid: '#7a2f7d',
    skyLow: '#ff8a5b',
    sun: '#ffd9a0',
    moon: false,
    stars: 0.15,
    skylineFar: '#4a2b6e',
    skylineNear: '#2e1c52',
    haze: '#d9768a',
    ground: '#2e2436',
    ballast: '#544656',
    bed: '#41374a',
    sleeper: '#6e5243',
    rail: '#e9e6f2',
    wall: '#5b4b8a',
    sidewalk: '#4e4462',
    buildings: ['#4a3770', '#69406f', '#36457a', '#7a4560'],
    windowLit: '#ffcf7a',
    windowDark: '#2a2042',
    lit: 0.42,
    neon: ['#ff4fd8', '#3df5ff', '#ffd23f'],
    tunnel: '#2c2440',
    water: '#5a3a72',
  },
  {
    name: 'HARBOR DUSK',
    skyTop: '#0b1433',
    skyMid: '#2f3f86',
    skyLow: '#e88a6a',
    sun: '#ffb48c',
    moon: false,
    stars: 0.35,
    skylineFar: '#33437e',
    skylineNear: '#1f2a58',
    haze: '#9a7ab0',
    ground: '#1f2433',
    ballast: '#454c5e',
    bed: '#363c4e',
    sleeper: '#5f4a3e',
    rail: '#e3e8f2',
    wall: '#405184',
    sidewalk: '#3d4560',
    buildings: ['#2f416e', '#41548a', '#4d3d6b', '#2b3a5c'],
    windowLit: '#ffd98f',
    windowDark: '#1c2440',
    lit: 0.5,
    neon: ['#ff6b6b', '#4dd9ff', '#ffe066'],
    tunnel: '#232a40',
    water: '#2c4a7a',
  },
  {
    name: 'NEON DISTRICT',
    skyTop: '#05030f',
    skyMid: '#170c38',
    skyLow: '#4a1670',
    sun: '#dfe8ff',
    moon: true,
    stars: 1,
    skylineFar: '#22164a',
    skylineNear: '#140c2e',
    haze: '#5a2384',
    ground: '#14111e',
    ballast: '#302a3c',
    bed: '#231f2e',
    sleeper: '#4a3a3a',
    rail: '#d6e2ff',
    wall: '#2e2452',
    sidewalk: '#2a2440',
    buildings: ['#221b40', '#2e1f4a', '#192848', '#341a3c'],
    windowLit: '#8ff3ff',
    windowDark: '#120e22',
    lit: 0.55,
    neon: ['#ff2fd0', '#22f5ff', '#b6ff3d'],
    tunnel: '#1a1530',
    water: '#1c1640',
  },
  {
    name: 'DAWN YARDS',
    skyTop: '#33508f',
    skyMid: '#9cb6dc',
    skyLow: '#ffd7a6',
    sun: '#fff4cf',
    moon: false,
    stars: 0,
    skylineFar: '#8090b8',
    skylineNear: '#5f6f9c',
    haze: '#ead2c8',
    ground: '#4a4652',
    ballast: '#6f6a75',
    bed: '#5a5562',
    sleeper: '#7a604c',
    rail: '#ffffff',
    wall: '#7f86a6',
    sidewalk: '#77748a',
    buildings: ['#6f7699', '#8d7f99', '#5f7394', '#9a847e'],
    windowLit: '#fff1c2',
    windowDark: '#4b5576',
    lit: 0.16,
    neon: ['#ff7aa8', '#5ac8ff', '#ffc94d'],
    tunnel: '#3e3d52',
    water: '#6d8fc0',
  },
];

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const PARSED = ZONES.map((z) => ({
  skyLow: rgbOf(z.skyLow),
  haze: rgbOf(z.haze),
  ground: rgbOf(z.ground),
  ballast: rgbOf(z.ballast),
  bed: rgbOf(z.bed),
  sleeper: rgbOf(z.sleeper),
  rail: rgbOf(z.rail),
  wall: rgbOf(z.wall),
  sidewalk: rgbOf(z.sidewalk),
  buildings: z.buildings.map(rgbOf),
  windowLit: rgbOf(z.windowLit),
  windowDark: rgbOf(z.windowDark),
  neon: z.neon.map(rgbOf),
  tunnel: rgbOf(z.tunnel),
  water: rgbOf(z.water),
}));

/** Metres over which one zone palette blends into the next after a milestone. */
const BLEND_M = 150;

export function zoneIndexAt(d: number): number {
  return Math.max(0, Math.floor(d / MILESTONE_M));
}

export function zoneDef(zone: number): ZoneDef {
  return ZONES[zone % ZONES.length] as ZoneDef;
}

function mix(a: Rgb, b: Rgb, t: number, light = 0): string {
  let r = a[0] + (b[0] - a[0]) * t;
  let g = a[1] + (b[1] - a[1]) * t;
  let bl = a[2] + (b[2] - a[2]) * t;
  if (light > 0) {
    r += (255 - r) * light;
    g += (255 - g) * light;
    bl += (255 - bl) * light;
  } else if (light < 0) {
    r *= 1 + light;
    g *= 1 + light;
    bl *= 1 + light;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(bl)})`;
}

/**
 * Resolved colours for the current position, blended between two zone palettes. Strings are
 * rebuilt only when the blend step changes (a few dozen times per transition), never per frame.
 */
export class Look {
  /** Palette indices and blend weight of the sky caches to cross-fade. */
  from = 0;
  to = 0;
  t = 0;
  hazeRgb: Rgb = [0, 0, 0];
  skyLow = '';
  haze = '';
  ground = '';
  groundFar = '';
  ballast = '';
  bed = '';
  sleeper = '';
  rail = '';
  railHi = '';
  railSide = '';
  wall = '';
  wallDark = '';
  wallTop = '';
  sidewalk = '';
  buildingFace: string[] = ['', '', '', ''];
  buildingEnd: string[] = ['', '', '', ''];
  buildingTrim: string[] = ['', '', '', ''];
  windowLit = '';
  windowDark = '';
  lit = 0.4;
  neon: string[] = ['', '', ''];
  tunnel = '';
  tunnelDark = '';
  water = '';
  waterHi = '';
  /** Increments whenever the colours change (for caches keyed on the palette). */
  version = 0;
  private key = -1;

  /** Update for the runner's distance; returns true when the colours changed. */
  update(d: number): boolean {
    const zone = zoneIndexAt(d);
    const into = d - zone * MILESTONE_M;
    const t = zone === 0 ? 1 : clamp(into / BLEND_M, 0, 1);
    const step = Math.round(t * 24);
    const key = zone * 100 + step;
    if (key === this.key) return false;
    this.key = key;
    this.from = (zone + ZONES.length - 1) % ZONES.length;
    this.to = zone % ZONES.length;
    this.t = step / 24;
    this.build();
    return true;
  }

  private build(): void {
    this.version++;
    const a = PARSED[this.from]!;
    const b = PARSED[this.to]!;
    const t = this.t;
    const lerp = (x: Rgb, y: Rgb): Rgb => [
      x[0] + (y[0] - x[0]) * t,
      x[1] + (y[1] - x[1]) * t,
      x[2] + (y[2] - x[2]) * t,
    ];
    this.hazeRgb = lerp(a.haze, b.haze);
    this.skyLow = mix(a.skyLow, b.skyLow, t);
    this.haze = mix(a.haze, b.haze, t);
    this.ground = mix(a.ground, b.ground, t);
    this.groundFar = mix(lerp(a.ground, b.ground), this.hazeRgb, 0.45);
    this.ballast = mix(a.ballast, b.ballast, t);
    this.bed = mix(a.bed, b.bed, t);
    this.sleeper = mix(a.sleeper, b.sleeper, t);
    this.rail = mix(a.rail, b.rail, t, -0.3);
    this.railHi = mix(a.rail, b.rail, t, 0.4);
    this.railSide = mix(a.ballast, b.ballast, t, -0.45);
    this.wall = mix(a.wall, b.wall, t);
    this.wallDark = mix(a.wall, b.wall, t, -0.22);
    this.wallTop = mix(a.wall, b.wall, t, 0.3);
    this.sidewalk = mix(a.sidewalk, b.sidewalk, t);
    for (let i = 0; i < 4; i++) {
      const ca = a.buildings[i]!;
      const cb = b.buildings[i]!;
      this.buildingFace[i] = mix(ca, cb, t);
      this.buildingEnd[i] = mix(ca, cb, t, -0.3);
      this.buildingTrim[i] = mix(ca, cb, t, 0.22);
    }
    this.windowLit = mix(a.windowLit, b.windowLit, t);
    this.windowDark = mix(a.windowDark, b.windowDark, t);
    this.lit = ZONES[this.from]!.lit + (ZONES[this.to]!.lit - ZONES[this.from]!.lit) * t;
    for (let i = 0; i < 3; i++) this.neon[i] = mix(a.neon[i]!, b.neon[i]!, t);
    this.tunnel = mix(a.tunnel, b.tunnel, t);
    this.tunnelDark = mix(a.tunnel, b.tunnel, t, -0.45);
    this.water = mix(a.water, b.water, t);
    this.waterHi = mix(a.water, b.water, t, 0.35);
  }
}
