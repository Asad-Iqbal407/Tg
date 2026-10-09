import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../src/games/types';
import { ACHIEVEMENTS, achievementProgress, newlyCompleted } from '../src/meta/achievements';
import { BOOSTS, SKINS, UPGRADES } from '../src/meta/catalog';
import { DAILY_REWARDS, dailyStatus, dayKey, shiftDay } from '../src/meta/daily';
import { applyRunToMissions, generateMissions, MISSION_TEMPLATES } from '../src/meta/missions';
import { cleanName, defaultProfile, sanitizeProfile } from '../src/meta/profile';
import { levelInfo, levelUpReward, MAX_LEVEL, xpForNext } from '../src/meta/progression';
import { computeRewards } from '../src/meta/rewards';

describe('progression', () => {
  it('maps XP to levels at exact boundaries', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, into: 0 });
    expect(levelInfo(xpForNext(1) - 1).level).toBe(1);
    expect(levelInfo(xpForNext(1)).level).toBe(2);
    expect(levelInfo(xpForNext(1) + xpForNext(2)).level).toBe(3);
  });

  it('is monotonic and capped', () => {
    let last = 1;
    for (let xp = 0; xp < 200_000; xp += 997) {
      const l = levelInfo(xp).level;
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
    expect(levelInfo(1e12)).toMatchObject({ level: MAX_LEVEL, progress: 1 });
  });

  it('gives bigger rewards for higher levels and gems every fifth level', () => {
    expect(levelUpReward(10).coins).toBeGreaterThan(levelUpReward(2).coins);
    expect(levelUpReward(5).gems).toBe(5);
    expect(levelUpReward(6).gems).toBe(1);
  });
});

describe('computeRewards', () => {
  const base = {
    scorePerCoin: 100,
    scorePerXp: 10,
    coinUpgradeLevel: 0,
    xpUpgradeLevel: 0,
    coinDoubler: false,
    xpBooster: false,
  };

  it('converts collected coins and score', () => {
    const r = computeRewards({ score: 1000, coins: 7, stats: {}, durationSec: 30 }, base);
    expect(r).toMatchObject({ collected: 7, scoreBonus: 10, coins: 17, xpBase: 110, xp: 110 });
  });

  it('applies upgrades and boosts', () => {
    const r = computeRewards(
      { score: 1000, coins: 10, stats: {}, durationSec: 30 },
      { ...base, coinUpgradeLevel: 5, coinDoubler: true, xpUpgradeLevel: 2, xpBooster: true },
    );
    expect(r.upgradeBonus).toBe(10); // 50% of 20
    expect(r.doublerBonus).toBe(30);
    expect(r.coins).toBe(60);
    expect(r.xp).toBe((110 + 22) * 2);
    expect(r.xpBonus).toBe(r.xp - r.xpBase);
  });

  it('withholds participation XP for very short runs and survives bad input', () => {
    expect(computeRewards({ score: 0, coins: 0, stats: {}, durationSec: 1 }, base).xp).toBe(0);
    const r = computeRewards(
      { score: Number.NaN, coins: Number.POSITIVE_INFINITY, stats: {}, durationSec: Number.NaN },
      base,
    );
    expect(Number.isFinite(r.coins)).toBe(true);
    expect(Number.isFinite(r.xp)).toBe(true);
    expect(r.coins).toBe(0);
  });
});

describe('daily rewards', () => {
  it('formats local days and steps across month/year boundaries', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('continues, resets and blocks double claims', () => {
    expect(dailyStatus({ lastClaim: null, streak: 0 }, '2026-10-09')).toEqual({
      canClaim: true,
      streak: 1,
      index: 0,
    });
    expect(dailyStatus({ lastClaim: '2026-10-08', streak: 3 }, '2026-10-09')).toEqual({
      canClaim: true,
      streak: 4,
      index: 3,
    });
    expect(dailyStatus({ lastClaim: '2026-10-06', streak: 3 }, '2026-10-09')).toEqual({
      canClaim: true,
      streak: 1,
      index: 0,
    });
    expect(dailyStatus({ lastClaim: '2026-10-09', streak: 4 }, '2026-10-09').canClaim).toBe(false);
  });

  it('cycles the reward table after a week', () => {
    expect(dailyStatus({ lastClaim: '2026-10-08', streak: DAILY_REWARDS.length }, '2026-10-09').index).toBe(
      0,
    );
  });
});

describe('missions', () => {
  it('generates the same distinct-game set for a given day', () => {
    const a = generateMissions('2026-10-09');
    const b = generateMissions('2026-10-09');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    const games = a.map((m) => m.gameId ?? 'any');
    expect(new Set(games).size).toBe(3);
    expect(a.map((m) => m.tier)).toEqual([0, 1, 2]);
  });

  it('varies across days', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      generateMissions(shiftDay('2026-10-01', i))
        .map((m) => m.templateId)
        .join(),
    );
    expect(new Set(days).size).toBeGreaterThan(3);
  });

  it('applies totals, bests and plays only for matching games', () => {
    const list = [
      {
        ...generateMissions('2026-01-01')[0]!,
        id: 'a',
        gameId: 'runner' as const,
        kind: 'total' as const,
        stat: 'distance',
        target: 1000,
        progress: 0,
      },
      {
        ...generateMissions('2026-01-01')[0]!,
        id: 'b',
        gameId: 'runner' as const,
        kind: 'best' as const,
        stat: 'distance',
        target: 500,
        progress: 0,
      },
      {
        ...generateMissions('2026-01-01')[0]!,
        id: 'c',
        gameId: null,
        kind: 'plays' as const,
        stat: '',
        target: 2,
        progress: 0,
      },
      {
        ...generateMissions('2026-01-01')[0]!,
        id: 'd',
        gameId: 'duck' as const,
        kind: 'total' as const,
        stat: 'ducks',
        target: 5,
        progress: 0,
      },
    ];
    let done = applyRunToMissions(list, 'runner', { distance: 600 });
    expect(done.map((m) => m.id)).toEqual(['b']);
    done = applyRunToMissions(list, 'runner', { distance: 450 });
    expect(done.map((m) => m.id)).toEqual(['a', 'c']);
    expect(list[0]!.progress).toBe(1000);
    expect(list[1]!.progress).toBe(500);
    expect(list[3]!.progress).toBe(0);
  });

  it('only references stats that games actually emit or coins/score', () => {
    for (const t of MISSION_TEMPLATES) {
      if (t.kind === 'plays') continue;
      expect(t.stat.length).toBeGreaterThan(0);
      expect(t.targets[0]).toBeLessThan(t.targets[2]);
    }
  });
});

describe('profile sanitizing', () => {
  it('repairs hostile or corrupted saves', () => {
    const p = sanitizeProfile({
      name: '<script>alert(1)</script>Bobby Tables The Third',
      coins: -50,
      gems: 'lots',
      xp: Number.NaN,
      owned: ['runner-gold', 'not-a-skin', 42],
      equipped: { runner: 'runner-gold', platformer: 'runner-gold', duck: 'crosshair-gold' },
      consumables: { shield: 1e9, bogus: 3 },
      upgrades: { 'coin-value': 99 },
      totals: JSON.parse('{"__proto__": {"polluted": true}, "runner.distance": 10}'),
      daily: { lastClaim: 'yesterday', streak: -3 },
      leaderboard: { runner: [{ name: 'x', score: 5 }, { name: 'y', score: 9 }, 'junk'] },
      settings: { masterVolume: 9, touchControls: 'sideways' },
    });
    expect(p.name).not.toMatch(/[<>]/);
    expect(p.name.length).toBeLessThanOrEqual(16);
    expect(p.coins).toBe(0);
    expect(p.gems).toBe(0);
    expect(p.xp).toBe(0);
    expect(p.owned).toContain('runner-gold');
    expect(p.owned).not.toContain('not-a-skin');
    expect(p.equipped.runner).toBe('runner-gold');
    expect(p.equipped.platformer).toBe('hero-classic');
    expect(p.equipped.duck).toBe('crosshair-classic');
    expect(p.consumables.shield).toBe(999);
    expect(p.consumables).not.toHaveProperty('bogus');
    expect(p.upgrades['coin-value']).toBe(5);
    expect(p.totals['runner.distance']).toBe(10);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(p.daily).toEqual({ lastClaim: null, streak: 0, best: 0 });
    expect(p.leaderboard.runner.map((e) => e.score)).toEqual([9, 5, 0]);
    expect(p.settings.masterVolume).toBe(1);
    expect(p.settings.touchControls).toBe('auto');
  });

  it('accepts its own defaults unchanged', () => {
    const d = defaultProfile(123);
    expect(sanitizeProfile(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('cleans names', () => {
    expect(cleanName('   ')).toBe('Player');
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('a\u0000b')).toBe('ab');
  });
});

describe('catalog and achievements', () => {
  it('has unique ids and one free default skin per game', () => {
    const ids = [...SKINS.map((s) => s.id), ...BOOSTS.map((b) => b.id), ...UPGRADES.map((u) => u.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GAME_IDS) {
      expect(SKINS.filter((s) => s.gameId === g && !s.price.coins && !s.price.gems)).toHaveLength(1);
    }
    for (const u of UPGRADES)
      for (let i = 1; i < u.costs.length; i++) expect(u.costs[i]).toBeGreaterThan(u.costs[i - 1] as number);
  });

  it('reports progress and completion', () => {
    const p = defaultProfile(0);
    expect(newlyCompleted(p)).toEqual([]);
    p.games.runner.plays = 1;
    p.bests['runner.distance'] = 1200;
    const ids = newlyCompleted(p).map((a) => a.id);
    expect(ids).toContain('first-run');
    expect(ids).toContain('runner-1k');
    const ultra = ACHIEVEMENTS.find((a) => a.id === 'runner-3k')!;
    expect(achievementProgress(ultra, p)).toEqual({ current: 1200, target: 3000 });
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
