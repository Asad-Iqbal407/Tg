import type { BoostId, GameId, SkinData } from '../games/types';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Price {
  coins?: number;
  gems?: number;
}

export interface SkinItem {
  kind: 'skin';
  id: string;
  gameId: GameId;
  name: string;
  description: string;
  rarity: Rarity;
  price: Price;
  palette: Record<string, string>;
  params: Record<string, number>;
  /** Display-only stat chips, e.g. vehicle handling. */
  stats?: Record<string, number>;
}

export interface BoostItem {
  kind: 'boost';
  id: BoostId;
  name: string;
  description: string;
  price: Price;
  color: string;
}

export type UpgradeId = 'coin-value' | 'xp-gain' | 'power-duration' | 'daily-bonus';

export interface UpgradeItem {
  kind: 'upgrade';
  id: UpgradeId;
  name: string;
  description: string;
  /** Coin cost of each successive level. */
  costs: readonly number[];
  effectPerLevel: number;
  effectLabel: (level: number) => string;
}

export const SKINS: readonly SkinItem[] = [
  // Metro Dash runners
  {
    kind: 'skin',
    id: 'runner-rookie',
    gameId: 'runner',
    name: 'Rookie',
    description: 'Red hoodie, fresh kicks.',
    rarity: 'common',
    price: {},
    palette: { body: '#e63946', accent: '#1d3557', skin: '#f1c27d', hair: '#2b2118', shoes: '#f8f9fa' },
    params: {},
  },
  {
    kind: 'skin',
    id: 'runner-ninja',
    gameId: 'runner',
    name: 'Night Ninja',
    description: 'Silent on the rails.',
    rarity: 'rare',
    price: { coins: 1500 },
    palette: { body: '#2b2d42', accent: '#8d0801', skin: '#e0ac69', hair: '#111111', shoes: '#4a4e69' },
    params: {},
  },
  {
    kind: 'skin',
    id: 'runner-neon',
    gameId: 'runner',
    name: 'Neon Rush',
    description: 'Glows brighter than the signals.',
    rarity: 'epic',
    price: { coins: 3000 },
    palette: { body: '#ff00e6', accent: '#00f5d4', skin: '#c68642', hair: '#00bbf9', shoes: '#fee440' },
    params: {},
  },
  {
    kind: 'skin',
    id: 'runner-gold',
    gameId: 'runner',
    name: 'Golden Streak',
    description: 'Pure 24-karat speed.',
    rarity: 'legendary',
    price: { gems: 25 },
    palette: { body: '#ffd23f', accent: '#b8860b', skin: '#f1c27d', hair: '#5a3e1b', shoes: '#ffffff' },
    params: {},
  },
  // Pixel Quest heroes
  {
    kind: 'skin',
    id: 'hero-classic',
    gameId: 'platformer',
    name: 'Classic Hero',
    description: 'Red cap, blue overalls.',
    rarity: 'common',
    price: {},
    palette: {
      hat: '#e63946',
      shirt: '#e63946',
      overalls: '#1d4ed8',
      skin: '#f6c18f',
      hair: '#5a3214',
      fire: '#e63946',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'hero-forest',
    gameId: 'platformer',
    name: 'Forest Ranger',
    description: 'Born in the green hills.',
    rarity: 'rare',
    price: { coins: 1500 },
    palette: {
      hat: '#2a9d4b',
      shirt: '#2a9d4b',
      overalls: '#264653',
      skin: '#f6c18f',
      hair: '#3b2314',
      fire: '#2a9d4b',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'hero-shadow',
    gameId: 'platformer',
    name: 'Shadow Jumper',
    description: 'Dark arts, high jumps.',
    rarity: 'epic',
    price: { coins: 3000 },
    palette: {
      hat: '#3a0ca3',
      shirt: '#7209b7',
      overalls: '#1b1b2f',
      skin: '#d4a373',
      hair: '#111111',
      fire: '#7209b7',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'hero-royal',
    gameId: 'platformer',
    name: 'Royal Champion',
    description: 'Fit for the castle throne.',
    rarity: 'legendary',
    price: { gems: 25 },
    palette: {
      hat: '#ffd23f',
      shirt: '#ffffff',
      overalls: '#7b2cbf',
      skin: '#f6c18f',
      hair: '#8b5a2b',
      fire: '#ffd23f',
    },
    params: {},
  },
  // Duck Season crosshairs
  {
    kind: 'skin',
    id: 'crosshair-classic',
    gameId: 'duck',
    name: 'Classic Sight',
    description: 'Trusty red reticle.',
    rarity: 'common',
    price: {},
    palette: { main: '#ff3b3b', accent: '#ffffff' },
    params: { style: 0 },
  },
  {
    kind: 'skin',
    id: 'crosshair-laser',
    gameId: 'duck',
    name: 'Laser Dot',
    description: 'Glowing green precision.',
    rarity: 'rare',
    price: { coins: 1500 },
    palette: { main: '#39ff14', accent: '#ffffff' },
    params: { style: 1 },
  },
  {
    kind: 'skin',
    id: 'crosshair-sniper',
    gameId: 'duck',
    name: 'Sniper Scope',
    description: 'Long-range ice-blue reticle.',
    rarity: 'epic',
    price: { coins: 3000 },
    palette: { main: '#4dd9ff', accent: '#ffffff' },
    params: { style: 2 },
  },
  {
    kind: 'skin',
    id: 'crosshair-gold',
    gameId: 'duck',
    name: 'Golden Eye',
    description: 'Never misses in style.',
    rarity: 'legendary',
    price: { gems: 25 },
    palette: { main: '#ffd23f', accent: '#fff8dc' },
    params: { style: 2 },
  },
  // Hill Rider vehicles — params change handling.
  {
    kind: 'skin',
    id: 'car-jeep',
    gameId: 'hill',
    name: 'Trail Jeep',
    description: 'Balanced all-rounder.',
    rarity: 'common',
    price: {},
    palette: { body: '#e63946', trim: '#1d3557', helmet: '#ffd23f' },
    params: {
      power: 1,
      maxSpeed: 540,
      grip: 0.32,
      wheelRadius: 20,
      suspension: 0.35,
      airControl: 1,
      fuel: 100,
      style: 0,
    },
    stats: { Power: 3, Speed: 3, Grip: 3, Fuel: 3 },
  },
  {
    kind: 'skin',
    id: 'car-monster',
    gameId: 'hill',
    name: 'Monster Truck',
    description: 'Huge tyres, huge grip.',
    rarity: 'rare',
    price: { coins: 2500 },
    palette: { body: '#2a9d4b', trim: '#ffd23f', helmet: '#ff6b6b' },
    params: {
      power: 1.15,
      maxSpeed: 500,
      grip: 0.4,
      wheelRadius: 27,
      suspension: 0.25,
      airControl: 0.85,
      fuel: 95,
      style: 1,
    },
    stats: { Power: 4, Speed: 2, Grip: 5, Fuel: 3 },
  },
  {
    kind: 'skin',
    id: 'car-racer',
    gameId: 'hill',
    name: 'Rally Racer',
    description: 'Blistering top speed.',
    rarity: 'epic',
    price: { coins: 4000 },
    palette: { body: '#ffb703', trim: '#023047', helmet: '#ffffff' },
    params: {
      power: 1.35,
      maxSpeed: 700,
      grip: 0.27,
      wheelRadius: 17,
      suspension: 0.45,
      airControl: 1.1,
      fuel: 85,
      style: 0,
    },
    stats: { Power: 5, Speed: 5, Grip: 2, Fuel: 2 },
  },
  {
    kind: 'skin',
    id: 'car-rover',
    gameId: 'hill',
    name: 'Lunar Rover',
    description: 'Big tank, superb air control.',
    rarity: 'legendary',
    price: { gems: 30 },
    palette: { body: '#e5e5e5', trim: '#3a86ff', helmet: '#ffffff' },
    params: {
      power: 1.05,
      maxSpeed: 560,
      grip: 0.34,
      wheelRadius: 22,
      suspension: 0.3,
      airControl: 1.7,
      fuel: 135,
      style: 0,
    },
    stats: { Power: 3, Speed: 3, Grip: 4, Fuel: 5 },
  },
  // Galaxy War ships
  {
    kind: 'skin',
    id: 'ship-falcon',
    gameId: 'galaxy',
    name: 'Falcon',
    description: 'Reliable interceptor.',
    rarity: 'common',
    price: {},
    palette: { body: '#4dd9ff', accent: '#ffffff', engine: '#ffb703' },
    params: { speed: 1, lives: 3, weapon: 1, style: 0 },
    stats: { Speed: 3, Armor: 3, Firepower: 1 },
  },
  {
    kind: 'skin',
    id: 'ship-viper',
    gameId: 'galaxy',
    name: 'Viper',
    description: 'Fastest hull in the fleet.',
    rarity: 'rare',
    price: { coins: 2000 },
    palette: { body: '#ff4d6d', accent: '#ffe5ec', engine: '#4dd9ff' },
    params: { speed: 1.25, lives: 3, weapon: 1, style: 1 },
    stats: { Speed: 5, Armor: 3, Firepower: 1 },
  },
  {
    kind: 'skin',
    id: 'ship-titan',
    gameId: 'galaxy',
    name: 'Titan',
    description: 'Heavy armour, extra life.',
    rarity: 'epic',
    price: { coins: 3500 },
    palette: { body: '#8d99ae', accent: '#ffd23f', engine: '#ff6b35' },
    params: { speed: 0.85, lives: 4, weapon: 1, style: 2 },
    stats: { Speed: 2, Armor: 5, Firepower: 1 },
  },
  {
    kind: 'skin',
    id: 'ship-phantom',
    gameId: 'galaxy',
    name: 'Phantom',
    description: 'Stealth wing with upgraded cannons.',
    rarity: 'legendary',
    price: { gems: 30 },
    palette: { body: '#b06bff', accent: '#f0d9ff', engine: '#ff4dd2' },
    params: { speed: 1.1, lives: 3, weapon: 2, style: 3 },
    stats: { Speed: 4, Armor: 3, Firepower: 2 },
  },
  // Snake Classic
  {
    kind: 'skin',
    id: 'snake-classic',
    gameId: 'snake',
    name: 'Classic Green',
    description: 'The original phosphor-green serpent.',
    rarity: 'common',
    price: {},
    palette: {
      body: '#4ade80',
      head: '#bbf7d0',
      food: '#ef4444',
      gold: '#fde047',
      board1: '#0f2a1a',
      board2: '#123421',
      wall: '#64748b',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'snake-neon',
    gameId: 'snake',
    name: 'Neon Coil',
    description: 'Glowing cyan on a midnight grid.',
    rarity: 'rare',
    price: { coins: 1500 },
    palette: {
      body: '#22d3ee',
      head: '#a5f3fc',
      food: '#f472b6',
      gold: '#fef08a',
      board1: '#0b1020',
      board2: '#101a33',
      wall: '#7c3aed',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'snake-retro',
    gameId: 'snake',
    name: 'Retro Handheld',
    description: 'Grey pixels from a pocket LCD.',
    rarity: 'epic',
    price: { coins: 3000 },
    palette: {
      body: '#334155',
      head: '#0f172a',
      food: '#9f1239',
      gold: '#78716c',
      board1: '#a3b18a',
      board2: '#94a37b',
      wall: '#5b6b58',
    },
    params: { thick: 1 },
  },
  {
    kind: 'skin',
    id: 'snake-royal',
    gameId: 'snake',
    name: 'Royal Gold',
    description: 'A golden serpent for champions.',
    rarity: 'legendary',
    price: { gems: 25 },
    palette: {
      body: '#facc15',
      head: '#fef08a',
      food: '#f97316',
      gold: '#fff7ae',
      board1: '#1c1404',
      board2: '#241a05',
      wall: '#a16207',
    },
    params: {},
  },
  // Bomb Squad operatives
  {
    kind: 'skin',
    id: 'bomb-rookie',
    gameId: 'bombsquad',
    name: 'Rookie',
    description: 'Blue overalls and a sturdy helmet.',
    rarity: 'common',
    price: {},
    palette: {
      suit: '#3b82f6',
      visor: '#e0f2fe',
      skin: '#f1c27d',
      hair: '#4b2e1e',
      bomb: '#111827',
      fuse: '#f97316',
      crate: '#a16207',
      stone: '#64748b',
      floor1: '#1e3a2f',
      floor2: '#1f4a36',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'bomb-ninja',
    gameId: 'bombsquad',
    name: 'Shadow Ninja',
    description: 'Quiet feet, loud bombs.',
    rarity: 'rare',
    price: { coins: 1500 },
    palette: {
      suit: '#111827',
      visor: '#f43f5e',
      skin: '#e0ac69',
      hair: '#0f0f0f',
      bomb: '#1f2937',
      fuse: '#f43f5e',
      crate: '#7c2d12',
      stone: '#475569',
      floor1: '#1b2430',
      floor2: '#202c3a',
    },
    params: {},
  },
  {
    kind: 'skin',
    id: 'bomb-pirate',
    gameId: 'bombsquad',
    name: 'Sky Pirate',
    description: 'Faster on foot, always ready for trouble.',
    rarity: 'epic',
    price: { coins: 3000 },
    palette: {
      suit: '#7c2d12',
      visor: '#fde68a',
      skin: '#c68642',
      hair: '#1f1f1f',
      bomb: '#292524',
      fuse: '#facc15',
      crate: '#92400e',
      stone: '#78716c',
      floor1: '#3a2a1a',
      floor2: '#452f1d',
    },
    params: { speedBonus: 0.15 },
  },
  {
    kind: 'skin',
    id: 'bomb-gold',
    gameId: 'bombsquad',
    name: 'Golden Demolition',
    description: 'Starts every round with an extra bomb.',
    rarity: 'legendary',
    price: { gems: 25 },
    palette: {
      suit: '#eab308',
      visor: '#fef9c3',
      skin: '#f6c18f',
      hair: '#5a3e1b',
      bomb: '#422006',
      fuse: '#fde047',
      crate: '#ca8a04',
      stone: '#a8a29e',
      floor1: '#2a2410',
      floor2: '#332c12',
    },
    params: { startBombs: 1 },
  },
];

export const BOOSTS: readonly BoostItem[] = [
  {
    kind: 'boost',
    id: 'coin-doubler',
    name: 'Coin Doubler',
    description: 'Double all coins earned in your next run.',
    price: { coins: 250 },
    color: '#ffd23f',
  },
  {
    kind: 'boost',
    id: 'xp-booster',
    name: 'XP Booster',
    description: 'Double all XP earned in your next run.',
    price: { coins: 200 },
    color: '#4dd9ff',
  },
  {
    kind: 'boost',
    id: 'shield',
    name: 'Guardian',
    description: 'A one-time save — effect depends on the game.',
    price: { coins: 300 },
    color: '#7cf',
  },
  {
    kind: 'boost',
    id: 'head-start',
    name: 'Power Start',
    description: 'Begin your run powered up — effect depends on the game.',
    price: { coins: 350 },
    color: '#ff6b6b',
  },
];

export const UPGRADES: readonly UpgradeItem[] = [
  {
    kind: 'upgrade',
    id: 'coin-value',
    name: 'Lucky Charm',
    description: 'Earn more coins from every run.',
    costs: [500, 1200, 2500, 5000, 9000],
    effectPerLevel: 0.1,
    effectLabel: (l) => `+${l * 10}% coins`,
  },
  {
    kind: 'upgrade',
    id: 'xp-gain',
    name: 'Scholar',
    description: 'Earn more XP from every run.',
    costs: [400, 1000, 2200, 4500, 8000],
    effectPerLevel: 0.1,
    effectLabel: (l) => `+${l * 10}% XP`,
  },
  {
    kind: 'upgrade',
    id: 'power-duration',
    name: 'Overclock',
    description: 'In-game power-ups last longer.',
    costs: [600, 1400, 3000, 6000, 10000],
    effectPerLevel: 0.12,
    effectLabel: (l) => `+${l * 12}% duration`,
  },
  {
    kind: 'upgrade',
    id: 'daily-bonus',
    name: 'Loyalty Card',
    description: 'Bigger daily login rewards.',
    costs: [800, 2500, 6000],
    effectPerLevel: 0.2,
    effectLabel: (l) => `+${l * 20}% daily coins`,
  },
];

const SKIN_BY_ID = new Map(SKINS.map((s) => [s.id, s]));
const BOOST_BY_ID = new Map(BOOSTS.map((b) => [b.id, b]));
const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export function getSkin(id: string): SkinItem | undefined {
  return SKIN_BY_ID.get(id);
}

export function getBoost(id: string): BoostItem | undefined {
  return BOOST_BY_ID.get(id as BoostId);
}

export function getUpgrade(id: string): UpgradeItem | undefined {
  return UPGRADE_BY_ID.get(id as UpgradeId);
}

export function skinsFor(gameId: GameId): SkinItem[] {
  return SKINS.filter((s) => s.gameId === gameId);
}

export function defaultSkin(gameId: GameId): SkinItem {
  const s = SKINS.find((k) => k.gameId === gameId && !k.price.coins && !k.price.gems);
  if (!s) throw new Error(`No default skin for ${gameId}`);
  return s;
}

export function isFree(item: { price: Price }): boolean {
  return !item.price.coins && !item.price.gems;
}

export function toSkinData(item: SkinItem): SkinData {
  return { id: item.id, palette: item.palette, params: item.params };
}
