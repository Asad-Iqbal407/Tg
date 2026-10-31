import type { PersistentStore } from '../core/storage';
import type { BoostId, GameDefinition, GameId, GameResult, Loadout } from '../games/types';
import { type AchievementDef, newlyCompleted } from './achievements';
import { defaultSkin, getBoost, getSkin, getUpgrade, isFree, toSkinData } from './catalog';
import { DAILY_REWARDS, dailyStatus, dayKey, type DailyReward } from './daily';
import { CHALLENGE_COINS, CHALLENGE_XP, type ChallengeOutcome, challengeOn } from './challenge';
import { applyRunToMissions, generateMissions } from './missions';
import { type LevelInfo, type LevelReward, levelInfo, levelUpReward } from './progression';
import {
  cleanName,
  LEADERBOARD_SIZE,
  type MissionState,
  type Profile,
  type Settings,
  upgradeLevel,
} from './profile';
import { computeRewards, type RewardBreakdown } from './rewards';

export interface RunTicket {
  id: number;
  gameId: GameId;
  boosts: BoostId[];
  loadout: Loadout;
  startedAt: number;
  /** The day (YYYY-MM-DD) of the Daily Challenge this run is, or null for an ordinary run. */
  challenge: string | null;
}

export interface RunSummary {
  gameId: GameId;
  result: GameResult;
  rewards: RewardBreakdown;
  levelBefore: LevelInfo;
  levelAfter: LevelInfo;
  levelUps: LevelReward[];
  isNewBest: boolean;
  previousBest: number;
  rank: number | null;
  achievements: AchievementDef[];
  missionsCompleted: MissionState[];
  boosts: BoostId[];
  /** Set for a Daily Challenge run. */
  challenge: ChallengeOutcome | null;
}

export type ArcadeEvent =
  | { type: 'achievement'; def: AchievementDef }
  | { type: 'level-up'; reward: LevelReward }
  | { type: 'mission-complete'; mission: MissionState }
  | { type: 'purchase'; itemId: string }
  | { type: 'daily-claimed'; reward: DailyReward; streak: number }
  /** Emitted once per settled run, after its rewards and stats have been stored. */
  | { type: 'run-finished'; summary: RunSummary; startedAt: number };

export type PurchaseResult = { ok: true } | { ok: false; reason: string };

/**
 * Domain service for the arcade's meta-game: runs, rewards, progression, achievements,
 * missions, daily rewards and the shop. All persistent state flows through the store so it
 * is validated, debounced and saved in one place.
 */
export class ArcadeService {
  private readonly listeners = new Set<(e: ArcadeEvent) => void>();
  private ticketSeq = 0;
  private activeTicket: RunTicket | null = null;

  constructor(
    readonly store: PersistentStore<Profile>,
    private readonly games: readonly GameDefinition[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.ensureMissions();
  }

  get profile(): Profile {
    return this.store.get();
  }

  today(): string {
    return dayKey(this.now());
  }

  on(fn: (e: ArcadeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ArcadeEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private def(gameId: GameId): GameDefinition {
    const d = this.games.find((g) => g.id === gameId);
    if (!d) throw new Error(`Unknown game ${gameId}`);
    return d;
  }

  // ---------------------------------------------------------------- currency helpers

  private addCoins(p: Profile, n: number): void {
    if (n <= 0) return;
    p.coins += n;
    p.totals['all.coinsEarned'] = (p.totals['all.coinsEarned'] ?? 0) + n;
  }

  /** Add XP and pay out level-up rewards; returns the levels gained. */
  private addXp(p: Profile, n: number): LevelReward[] {
    const before = levelInfo(p.xp).level;
    p.xp += Math.max(0, Math.floor(n));
    const after = levelInfo(p.xp).level;
    const ups: LevelReward[] = [];
    for (let l = before + 1; l <= after; l++) {
      const r = levelUpReward(l);
      this.addCoins(p, r.coins);
      p.gems += r.gems;
      ups.push(r);
    }
    return ups;
  }

  /** Unlock any achievements whose goals are met, paying out rewards (which may chain). */
  private checkAchievements(p: Profile): AchievementDef[] {
    const unlocked: AchievementDef[] = [];
    for (let guard = 0; guard < 5; guard++) {
      const fresh = newlyCompleted(p);
      if (fresh.length === 0) break;
      for (const a of fresh) {
        p.achievements[a.id] = this.now().getTime();
        this.addCoins(p, a.reward.coins);
        p.gems += a.reward.gems;
        unlocked.push(a);
      }
    }
    return unlocked;
  }

  // ---------------------------------------------------------------- missions & daily

  ensureMissions(): void {
    const day = this.today();
    if (this.profile.missions.day === day && this.profile.missions.list.length > 0) return;
    this.store.update((p) => {
      p.missions = { day, list: generateMissions(day) };
    });
  }

  claimMission(id: string): MissionState | null {
    this.ensureMissions();
    let claimed: MissionState | null = null;
    const events: ArcadeEvent[] = [];
    this.store.update((p) => {
      const m = p.missions.list.find((x) => x.id === id);
      if (!m || m.claimed || m.progress < m.target) return;
      m.claimed = true;
      this.addCoins(p, m.reward.coins);
      p.gems += m.reward.gems;
      for (const r of this.addXp(p, m.reward.xp)) events.push({ type: 'level-up', reward: r });
      for (const a of this.checkAchievements(p)) events.push({ type: 'achievement', def: a });
      claimed = m;
    });
    events.forEach((e) => this.emit(e));
    return claimed;
  }

  dailyStatus() {
    return dailyStatus(this.profile.daily, this.today());
  }

  dailyReward(index: number): DailyReward {
    const base = DAILY_REWARDS[index % DAILY_REWARDS.length] as DailyReward;
    const bonus = 1 + 0.2 * upgradeLevel(this.profile, 'daily-bonus');
    return { ...base, coins: Math.round(base.coins * bonus) };
  }

  claimDaily(): { reward: DailyReward; streak: number } | null {
    const status = this.dailyStatus();
    if (!status.canClaim) return null;
    const reward = this.dailyReward(status.index);
    const events: ArcadeEvent[] = [];
    this.store.update((p) => {
      p.daily.lastClaim = this.today();
      p.daily.streak = status.streak;
      p.daily.best = Math.max(p.daily.best, status.streak);
      this.addCoins(p, reward.coins);
      p.gems += reward.gems ?? 0;
      if (reward.boost) p.consumables[reward.boost] = (p.consumables[reward.boost] ?? 0) + 1;
      for (const a of this.checkAchievements(p)) events.push({ type: 'achievement', def: a });
    });
    this.emit({ type: 'daily-claimed', reward, streak: status.streak });
    events.forEach((e) => this.emit(e));
    return { reward, streak: status.streak };
  }

  // ---------------------------------------------------------------- runs

  loadoutFor(gameId: GameId, boosts: readonly BoostId[] = []): Loadout {
    const p = this.profile;
    const skin = getSkin(p.equipped[gameId]) ?? defaultSkin(gameId);
    return {
      skin: toSkinData(skin),
      boosts: new Set(boosts),
      powerDuration: 1 + 0.12 * upgradeLevel(p, 'power-duration'),
    };
  }

  /** Validate and consume the selected boosts, returning a ticket for `finishRun`. */
  startRun(gameId: GameId, requested: readonly BoostId[] = [], challenge = false): RunTicket {
    this.def(gameId);
    const boosts: BoostId[] = [];
    this.store.update((p) => {
      for (const id of new Set(requested)) {
        if (!getBoost(id)) continue;
        const have = p.consumables[id] ?? 0;
        if (have <= 0) continue;
        p.consumables[id] = have - 1;
        boosts.push(id);
      }
    });
    const ticket: RunTicket = {
      id: ++this.ticketSeq,
      gameId,
      boosts,
      loadout: this.loadoutFor(gameId, boosts),
      startedAt: this.now().getTime(),
      challenge: challenge ? dayKey(this.now()) : null,
    };
    this.activeTicket = ticket;
    return ticket;
  }

  /**
   * Abandon a run that never really started (quit at once, or left from behind the rotate prompt): it earns
   * nothing and records nothing, and the boosts it consumed go back to the inventory. Returns the refunded
   * boosts. A ticket that is no longer active refunds nothing, so a run can never be refunded twice.
   */
  abandonRun(ticket: RunTicket): BoostId[] {
    if (this.activeTicket?.id !== ticket.id) return [];
    this.activeTicket = null;
    if (ticket.boosts.length === 0) return [];
    this.store.update((p) => {
      for (const id of ticket.boosts) p.consumables[id] = (p.consumables[id] ?? 0) + 1;
    });
    return [...ticket.boosts];
  }

  finishRun(ticket: RunTicket, result: GameResult): RunSummary {
    if (this.activeTicket?.id !== ticket.id) throw new Error('Run ticket is not active');
    this.activeTicket = null;
    this.ensureMissions();
    const def = this.def(ticket.gameId);
    const gameId = ticket.gameId;
    const p0 = this.profile;
    const rewards = computeRewards(result, {
      scorePerCoin: def.scorePerCoin,
      scorePerXp: def.scorePerXp,
      coinUpgradeLevel: upgradeLevel(p0, 'coin-value'),
      xpUpgradeLevel: upgradeLevel(p0, 'xp-gain'),
      coinDoubler: ticket.boosts.includes('coin-doubler'),
      xpBooster: ticket.boosts.includes('xp-booster'),
    });
    const levelBefore = levelInfo(p0.xp);
    const previousBest = p0.games[gameId].best;
    const score = Math.max(0, Math.floor(Number.isFinite(result.score) ? result.score : 0));
    const duration = Number.isFinite(result.durationSec) ? Math.max(0, result.durationSec) : 0;
    // Only finite, non-negative stats count, so one bad value from a game can never poison saved totals,
    // bests or mission progress with NaN or Infinity.
    const runStats: Record<string, number> = {};
    for (const [k, v] of Object.entries({ ...result.stats, coins: result.coins, score })) {
      if (Number.isFinite(v) && v >= 0) runStats[k] = v;
    }

    let levelUps: LevelReward[] = [];
    let achievements: AchievementDef[] = [];
    let missionsCompleted: MissionState[] = [];
    let rank: number | null = null;
    let challenge: ChallengeOutcome | null = null;

    this.store.update((p) => {
      const rec = p.games[gameId];
      rec.plays += 1;
      rec.best = Math.max(rec.best, score);
      rec.totalScore += score;
      rec.totalTime += duration;
      rec.lastPlayed = this.now().getTime();

      for (const [k, v] of Object.entries(runStats)) {
        const key = `${gameId}.${k}`;
        p.totals[key] = (p.totals[key] ?? 0) + v;
        p.bests[key] = Math.max(p.bests[key] ?? 0, v);
      }
      p.totals['all.plays'] = (p.totals['all.plays'] ?? 0) + 1;

      if (score > 0) {
        const board = p.leaderboard[gameId];
        const entry = { name: p.name, score, date: this.now().getTime() };
        board.push(entry);
        board.sort((a, b) => b.score - a.score || a.date - b.date);
        if (board.length > LEADERBOARD_SIZE) board.length = LEADERBOARD_SIZE;
        const idx = board.indexOf(entry);
        rank = idx >= 0 ? idx + 1 : null;
      }

      missionsCompleted = applyRunToMissions(p.missions.list, gameId, runStats);
      if (ticket.challenge) challenge = this.recordChallenge(p, gameId, ticket.challenge, score);
      this.addCoins(p, rewards.coins + (challenge?.bonusCoins ?? 0));
      levelUps = this.addXp(p, rewards.xp + (challenge?.bonusXp ?? 0));
      achievements = this.checkAchievements(p);
    });
    this.store.save();

    for (const r of levelUps) this.emit({ type: 'level-up', reward: r });
    for (const m of missionsCompleted) this.emit({ type: 'mission-complete', mission: m });
    for (const a of achievements) this.emit({ type: 'achievement', def: a });

    const summary: RunSummary = {
      gameId,
      result,
      rewards,
      levelBefore,
      levelAfter: levelInfo(this.profile.xp),
      levelUps,
      isNewBest: score > previousBest,
      previousBest,
      rank,
      achievements,
      missionsCompleted,
      boosts: ticket.boosts,
      challenge,
    };
    this.emit({ type: 'run-finished', summary, startedAt: ticket.startedAt });
    return summary;
  }

  // ---------------------------------------------------------------- favourites and the daily challenge

  isFavorite(gameId: GameId): boolean {
    return this.profile.favorites.includes(gameId);
  }

  /** Stars or unstars a game. Returns whether it is starred now. */
  toggleFavorite(gameId: GameId): boolean {
    this.def(gameId);
    let now = false;
    this.store.update((p) => {
      const at = p.favorites.indexOf(gameId);
      if (at >= 0) p.favorites.splice(at, 1);
      else p.favorites.push(gameId);
      now = at < 0;
    });
    this.store.save();
    return now;
  }

  /** Today's Daily Challenge figures for a game: attempts, best score and whether the bonus is still to be had. */
  challengeStatus(gameId: GameId): { day: string; plays: number; best: number; bonusAvailable: boolean } {
    const day = dayKey(this.now());
    const rec = challengeOn(this.profile.challenge[gameId], day);
    return { day, plays: rec.plays, best: rec.best, bonusAvailable: !rec.claimed };
  }

  /**
   * Books a finished Daily Challenge run on the day it started. The first run of the day that scores something pays
   * the bonus; a day's figures start again from nothing when the day changes.
   */
  private recordChallenge(p: Profile, gameId: GameId, day: string, score: number): ChallengeOutcome {
    const rec = challengeOn(p.challenge[gameId], day);
    p.challenge[gameId] = rec;
    const beatBest = rec.best > 0 && score > rec.best;
    rec.plays += 1;
    rec.best = Math.max(rec.best, score);
    const pays = !rec.claimed && score > 0;
    if (pays) rec.claimed = true;
    return {
      day,
      attempt: rec.plays,
      bestToday: rec.best,
      beatBest,
      bonusCoins: pays ? CHALLENGE_COINS : 0,
      bonusXp: pays ? CHALLENGE_XP : 0,
    };
  }

  // ---------------------------------------------------------------- shop

  buy(itemId: string): PurchaseResult {
    const skin = getSkin(itemId);
    const boost = getBoost(itemId);
    const upgrade = getUpgrade(itemId);
    const p = this.profile;
    let coins = 0;
    let gems = 0;
    if (skin) {
      if (p.owned.includes(skin.id)) return { ok: false, reason: 'Already owned' };
      if (isFree(skin)) return { ok: false, reason: 'Already owned' };
      coins = skin.price.coins ?? 0;
      gems = skin.price.gems ?? 0;
    } else if (boost) {
      if ((p.consumables[boost.id] ?? 0) >= 99) return { ok: false, reason: 'Inventory full' };
      coins = boost.price.coins ?? 0;
      gems = boost.price.gems ?? 0;
    } else if (upgrade) {
      const level = upgradeLevel(p, upgrade.id);
      if (level >= upgrade.costs.length) return { ok: false, reason: 'Max level' };
      coins = upgrade.costs[level] ?? Infinity;
    } else {
      return { ok: false, reason: 'Unknown item' };
    }
    if (p.coins < coins) return { ok: false, reason: 'Not enough coins' };
    if (p.gems < gems) return { ok: false, reason: 'Not enough gems' };
    const events: ArcadeEvent[] = [];
    this.store.update((d) => {
      d.coins -= coins;
      d.gems -= gems;
      if (skin) {
        d.owned.push(skin.id);
        d.equipped[skin.gameId] = skin.id;
      } else if (boost) {
        d.consumables[boost.id] = (d.consumables[boost.id] ?? 0) + 1;
      } else if (upgrade) {
        d.upgrades[upgrade.id] = upgradeLevel(d, upgrade.id) + 1;
      }
      for (const a of this.checkAchievements(d)) events.push({ type: 'achievement', def: a });
    });
    this.emit({ type: 'purchase', itemId });
    events.forEach((e) => this.emit(e));
    return { ok: true };
  }

  equip(skinId: string): boolean {
    const skin = getSkin(skinId);
    if (!skin || !this.profile.owned.includes(skinId)) return false;
    this.store.update((p) => {
      p.equipped[skin.gameId] = skinId;
    });
    return true;
  }

  // ---------------------------------------------------------------- profile & settings

  setName(name: string): string {
    const clean = cleanName(name);
    this.store.update((p) => {
      p.name = clean;
    });
    return clean;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.store.update((p) => {
      p.settings = { ...p.settings, ...patch };
    });
  }

  resetProgress(): void {
    const settings = this.profile.settings;
    this.store.reset();
    this.store.update((p) => {
      p.settings = settings;
    });
    this.ensureMissions();
  }

  /** Counts for UI badges. */
  pendingCounts(): { daily: number; missions: number } {
    return {
      daily: this.dailyStatus().canClaim ? 1 : 0,
      missions: this.profile.missions.list.filter((m) => !m.claimed && m.progress >= m.target).length,
    };
  }
}
