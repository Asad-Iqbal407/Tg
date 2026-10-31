import { bool, int, num, numberRecord, obj, safeKey, str } from '../core/storage';
import { GAME_IDS, type GameId } from '../games/types';
import { BOOSTS, getSkin, getUpgrade, SKINS, UPGRADES } from './catalog';
import { type ChallengeRecord, emptyChallenge } from './challenge';

export const PROFILE_VERSION = 1;
export const LEADERBOARD_SIZE = 10;
export const NAME_MAX = 16;

export interface GameRecord {
  plays: number;
  best: number;
  totalScore: number;
  totalTime: number;
  lastPlayed: number;
}

export interface ScoreEntry {
  name: string;
  score: number;
  date: number;
}

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  showFps: boolean;
  haptics: boolean;
  touchControls: 'auto' | 'on' | 'off';
}

export type MissionKind = 'total' | 'best' | 'plays';

export interface MissionState {
  id: string;
  templateId: string;
  tier: number;
  gameId: GameId | null;
  kind: MissionKind;
  stat: string;
  target: number;
  progress: number;
  claimed: boolean;
  label: string;
  reward: { coins: number; xp: number; gems: number };
}

export interface Profile {
  name: string;
  createdAt: number;
  coins: number;
  gems: number;
  xp: number;
  games: Record<GameId, GameRecord>;
  /** Lifetime sums of per-run stats, keyed `gameId.stat` (plus `all.*`). */
  totals: Record<string, number>;
  /** Best single-run values of per-run stats, keyed `gameId.stat`. */
  bests: Record<string, number>;
  /** Achievement id → unlock timestamp. */
  achievements: Record<string, number>;
  owned: string[];
  equipped: Record<GameId, string>;
  consumables: Record<string, number>;
  upgrades: Record<string, number>;
  daily: { lastClaim: string | null; streak: number; best: number };
  missions: { day: string; list: MissionState[] };
  leaderboard: Record<GameId, ScoreEntry[]>;
  /** Games the player has starred, in the order they were starred. */
  favorites: GameId[];
  /** Each game's Daily Challenge figures for the day they were last played. */
  challenge: Record<GameId, ChallengeRecord>;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  muted: false,
  reducedMotion: false,
  showFps: false,
  haptics: true,
  touchControls: 'auto',
};

function emptyRecord(): GameRecord {
  return { plays: 0, best: 0, totalScore: 0, totalTime: 0, lastPlayed: 0 };
}

function perGame<T>(make: (id: GameId) => T): Record<GameId, T> {
  const out = {} as Record<GameId, T>;
  for (const id of GAME_IDS) out[id] = make(id);
  return out;
}

/** A couple of free boosts so new players can try the system. */
const STARTER_BOOSTS: Readonly<Record<string, number>> = { 'coin-doubler': 1, shield: 1 };

const defaultSkinIds = SKINS.filter((s) => !s.price.coins && !s.price.gems).map((s) => s.id);

function defaultEquipped(): Record<GameId, string> {
  return perGame((id) => SKINS.find((s) => s.gameId === id && defaultSkinIds.includes(s.id))?.id ?? '');
}

export function defaultProfile(now = Date.now()): Profile {
  return {
    name: 'Player',
    createdAt: now,
    coins: 250,
    gems: 0,
    xp: 0,
    games: perGame(emptyRecord),
    totals: {},
    bests: {},
    achievements: {},
    owned: [...defaultSkinIds],
    equipped: defaultEquipped(),
    consumables: Object.fromEntries(BOOSTS.map((b) => [b.id, STARTER_BOOSTS[b.id] ?? 0])),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    daily: { lastClaim: null, streak: 0, best: 0 },
    missions: { day: '', list: [] },
    leaderboard: perGame(() => []),
    favorites: [],
    challenge: perGame(emptyChallenge),
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Strip control characters and collapse whitespace; never empty. */
export function cleanName(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned || 'Player';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeMission(raw: unknown): MissionState | null {
  const m = obj(raw);
  const kind = m.kind;
  if (kind !== 'total' && kind !== 'best' && kind !== 'plays') return null;
  const gameId =
    typeof m.gameId === 'string' && (GAME_IDS as readonly string[]).includes(m.gameId)
      ? (m.gameId as GameId)
      : null;
  const reward = obj(m.reward);
  return {
    id: str(m.id, '', 64),
    templateId: str(m.templateId, '', 64),
    tier: int(m.tier, 0, 0, 2),
    gameId,
    kind,
    stat: str(m.stat, '', 32),
    target: int(m.target, 1, 1),
    progress: num(m.progress, 0, 0),
    claimed: bool(m.claimed, false),
    label: str(m.label, '', 120),
    reward: {
      coins: int(reward.coins, 0, 0, 100000),
      xp: int(reward.xp, 0, 0, 100000),
      gems: int(reward.gems, 0, 0, 100),
    },
  };
}

/** The starred games from saved data: real game ids only, each once, in order. */
function favoritesFrom(raw: unknown): GameId[] {
  const out: GameId[] = [];
  if (!Array.isArray(raw)) return out;
  for (const id of raw) {
    if (typeof id === 'string' && (GAME_IDS as readonly string[]).includes(id) && !out.includes(id as GameId))
      out.push(id as GameId);
  }
  return out;
}

/** Coerce anything (corrupted storage, hand-edited imports) into a valid Profile. */
export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  const r = obj(raw);
  const games = obj(r.games);
  const lb = obj(r.leaderboard);
  const equippedRaw = obj(r.equipped);
  const settingsRaw = obj(r.settings);
  const dailyRaw = obj(r.daily);
  const missionsRaw = obj(r.missions);
  const challengeRaw = obj(r.challenge);

  const owned = new Set<string>(d.owned);
  if (Array.isArray(r.owned))
    for (const id of r.owned) if (typeof id === 'string' && getSkin(id)) owned.add(id);

  const equipped = d.equipped;
  for (const id of GAME_IDS) {
    const v = equippedRaw[id];
    if (typeof v === 'string' && owned.has(v) && getSkin(v)?.gameId === id) equipped[id] = v;
  }

  const consumables: Record<string, number> = {};
  const consSource = r.consumables === undefined ? d.consumables : numberRecord(r.consumables);
  for (const b of BOOSTS) consumables[b.id] = Math.floor(Math.min(999, consSource[b.id] ?? 0));

  const upgrades: Record<string, number> = {};
  const upRaw = numberRecord(r.upgrades);
  for (const u of UPGRADES) upgrades[u.id] = Math.floor(Math.min(u.costs.length, upRaw[u.id] ?? 0));

  const achievements: Record<string, number> = {};
  for (const [k, v] of Object.entries(numberRecord(r.achievements))) if (safeKey(k)) achievements[k] = v;

  const touch = settingsRaw.touchControls;
  const lastClaim =
    typeof dailyRaw.lastClaim === 'string' && DAY_RE.test(dailyRaw.lastClaim) ? dailyRaw.lastClaim : null;
  const missionDay =
    typeof missionsRaw.day === 'string' && DAY_RE.test(missionsRaw.day) ? missionsRaw.day : '';
  const missionList = Array.isArray(missionsRaw.list)
    ? missionsRaw.list
        .slice(0, 5)
        .map(sanitizeMission)
        .filter((m): m is MissionState => m !== null)
    : [];

  return {
    name: cleanName(str(r.name, d.name, 64)),
    createdAt: num(r.createdAt, d.createdAt, 0),
    coins: int(r.coins, d.coins, 0, 1e12),
    gems: int(r.gems, d.gems, 0, 1e9),
    xp: int(r.xp, 0, 0, 1e12),
    games: perGame((id) => {
      const g = obj(games[id]);
      return {
        plays: int(g.plays, 0),
        best: int(g.best, 0),
        totalScore: int(g.totalScore, 0),
        totalTime: num(g.totalTime, 0, 0),
        lastPlayed: num(g.lastPlayed, 0, 0),
      };
    }),
    totals: numberRecord(r.totals),
    bests: numberRecord(r.bests),
    achievements,
    owned: [...owned],
    equipped,
    consumables,
    upgrades,
    daily: {
      lastClaim,
      streak: int(dailyRaw.streak, 0, 0, 100000),
      best: int(dailyRaw.best, 0, 0, 100000),
    },
    missions: { day: missionDay, list: missionList },
    leaderboard: perGame((id) => {
      const list = Array.isArray(lb[id]) ? (lb[id] as unknown[]) : [];
      return list
        .map((e) => {
          const o = obj(e);
          return {
            name: cleanName(str(o.name, 'Player', 64)),
            score: int(o.score, 0),
            date: num(o.date, 0, 0),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, LEADERBOARD_SIZE);
    }),
    favorites: favoritesFrom(r.favorites),
    challenge: perGame((id) => {
      const c = obj(challengeRaw[id]);
      const day = typeof c.day === 'string' && DAY_RE.test(c.day) ? c.day : '';
      return day
        ? { day, best: int(c.best, 0), plays: int(c.plays, 0, 0, 1e6), claimed: bool(c.claimed, false) }
        : emptyChallenge();
    }),
    settings: {
      masterVolume: num(settingsRaw.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
      sfxVolume: num(settingsRaw.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
      musicVolume: num(settingsRaw.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      muted: bool(settingsRaw.muted, DEFAULT_SETTINGS.muted),
      reducedMotion: bool(settingsRaw.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
      showFps: bool(settingsRaw.showFps, DEFAULT_SETTINGS.showFps),
      haptics: bool(settingsRaw.haptics, DEFAULT_SETTINGS.haptics),
      touchControls:
        touch === 'on' || touch === 'off' || touch === 'auto' ? touch : DEFAULT_SETTINGS.touchControls,
    },
  };
}

export function upgradeLevel(p: Profile, id: string): number {
  const u = getUpgrade(id);
  return u ? Math.min(u.costs.length, p.upgrades[id] ?? 0) : 0;
}
