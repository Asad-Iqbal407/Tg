import { describe, expect, it } from 'vitest';
import type { ArcadeEvent } from '../src/meta/arcade';
import { makeArcade } from './helpers';

const result = (score: number, coins: number, stats: Record<string, number> = {}, durationSec = 60) => ({
  score,
  coins,
  stats,
  durationSec,
});

describe('ArcadeService runs', () => {
  it('consumes only owned boosts and applies the loadout', () => {
    const { arcade } = makeArcade();
    expect(arcade.profile.consumables['coin-doubler']).toBe(1);
    const ticket = arcade.startRun('runner', ['coin-doubler', 'xp-booster', 'coin-doubler']);
    expect(ticket.boosts).toEqual(['coin-doubler']);
    expect(arcade.profile.consumables['coin-doubler']).toBe(0);
    expect(ticket.loadout.skin.id).toBe('runner-rookie');
    expect(ticket.loadout.boosts.has('coin-doubler')).toBe(true);
  });

  it('records a finished run end-to-end', () => {
    const { arcade } = makeArcade();
    const events: ArcadeEvent[] = [];
    arcade.on((e) => events.push(e));
    const coinsBefore = arcade.profile.coins;
    const ticket = arcade.startRun('runner', ['coin-doubler']);
    const s = arcade.finishRun(ticket, result(2400, 15, { distance: 1100, jumps: 30 }));
    const p = arcade.profile;
    expect(s.rewards.collected).toBe(15);
    expect(s.rewards.scoreBonus).toBe(20);
    expect(s.rewards.doublerBonus).toBe(35);
    expect(s.isNewBest).toBe(true);
    expect(s.rank).toBe(1);
    expect(p.games.runner).toMatchObject({ plays: 1, best: 2400 });
    expect(p.totals['runner.distance']).toBe(1100);
    expect(p.bests['runner.jumps']).toBe(30);
    expect(p.totals['runner.coins']).toBe(15);
    expect(p.leaderboard.runner[0]).toMatchObject({ name: 'Player', score: 2400 });
    const ach = s.achievements.map((a) => a.id);
    expect(ach).toEqual(expect.arrayContaining(['first-run', 'runner-1k']));
    const achCoins = s.achievements.reduce((n, a) => n + a.reward.coins, 0);
    const levelCoins = s.levelUps.reduce((n, l) => n + l.coins, 0);
    expect(p.coins).toBe(coinsBefore + s.rewards.coins + achCoins + levelCoins);
    expect(events.some((e) => e.type === 'achievement')).toBe(true);
  });

  it('rejects finishing the same ticket twice', () => {
    const { arcade } = makeArcade();
    const t = arcade.startRun('duck');
    arcade.finishRun(t, result(100, 1));
    expect(() => arcade.finishRun(t, result(100, 1))).toThrow();
  });

  it('keeps the leaderboard sorted and bounded', () => {
    const { arcade } = makeArcade();
    for (let i = 1; i <= 14; i++) arcade.finishRun(arcade.startRun('galaxy'), result(i * 100, 0));
    const board = arcade.profile.leaderboard.galaxy;
    expect(board).toHaveLength(10);
    expect(board[0]!.score).toBe(1400);
    expect(board[9]!.score).toBe(500);
    const s = arcade.finishRun(arcade.startRun('galaxy'), result(50, 0));
    expect(s.rank).toBeNull();
  });

  it('levels up and pays level rewards', () => {
    const { arcade } = makeArcade();
    const s = arcade.finishRun(arcade.startRun('runner'), result(25 * 1000, 0));
    expect(s.levelAfter.level).toBeGreaterThan(1);
    expect(s.levelUps.length).toBe(s.levelAfter.level - s.levelBefore.level);
    expect(arcade.profile.gems).toBeGreaterThan(0);
  });
});

describe('ArcadeService daily & missions', () => {
  it('claims the daily reward once per day and grows the streak', () => {
    let now = new Date(2026, 9, 9, 10);
    const { arcade } = makeArcade(() => now);
    const first = arcade.claimDaily();
    expect(first?.streak).toBe(1);
    expect(arcade.claimDaily()).toBeNull();
    now = new Date(2026, 9, 10, 9);
    expect(arcade.claimDaily()?.streak).toBe(2);
    now = new Date(2026, 9, 13, 9);
    expect(arcade.claimDaily()?.streak).toBe(1);
    expect(arcade.profile.daily.best).toBe(2);
  });

  it('refreshes missions on a new day and pays out claims', () => {
    let now = new Date(2026, 9, 9, 10);
    const { arcade, store } = makeArcade(() => now);
    const day1 = arcade.profile.missions.list.map((m) => m.id);
    const m = arcade.profile.missions.list[0]!;
    expect(arcade.claimMission(m.id)).toBeNull();
    store.update((p) => {
      p.missions.list[0]!.progress = p.missions.list[0]!.target;
    });
    const coins = arcade.profile.coins;
    expect(arcade.claimMission(m.id)).not.toBeNull();
    expect(arcade.profile.coins).toBeGreaterThanOrEqual(coins + m.reward.coins);
    expect(arcade.claimMission(m.id)).toBeNull();
    now = new Date(2026, 9, 10, 10);
    arcade.ensureMissions();
    expect(arcade.profile.missions.list.map((x) => x.id)).not.toEqual(day1);
  });
});

describe('ArcadeService shop', () => {
  it('buys, equips and validates purchases', () => {
    const { arcade, store } = makeArcade();
    expect(arcade.buy('runner-ninja')).toEqual({ ok: false, reason: 'Not enough coins' });
    expect(arcade.buy('runner-rookie')).toEqual({ ok: false, reason: 'Already owned' });
    expect(arcade.buy('nope')).toEqual({ ok: false, reason: 'Unknown item' });
    store.update((p) => {
      p.coins = 10_000;
      p.gems = 5;
    });
    expect(arcade.buy('runner-ninja')).toEqual({ ok: true });
    expect(arcade.profile.equipped.runner).toBe('runner-ninja');
    expect(arcade.profile.coins).toBe(8_500);
    expect(arcade.buy('runner-gold')).toEqual({ ok: false, reason: 'Not enough gems' });
    expect(arcade.equip('runner-rookie')).toBe(true);
    expect(arcade.equip('runner-gold')).toBe(false);
    expect(arcade.buy('shield')).toEqual({ ok: true });
    expect(arcade.profile.consumables.shield).toBe(2);
  });

  it('caps upgrades at max level', () => {
    const { arcade, store } = makeArcade();
    store.update((p) => (p.coins = 1_000_000));
    for (let i = 0; i < 3; i++) expect(arcade.buy('daily-bonus').ok).toBe(true);
    expect(arcade.buy('daily-bonus')).toEqual({ ok: false, reason: 'Max level' });
    expect(arcade.dailyReward(0).coins).toBe(160);
  });

  it('reset wipes progress but keeps settings', () => {
    const { arcade } = makeArcade();
    arcade.updateSettings({ musicVolume: 0.1 });
    arcade.finishRun(arcade.startRun('hill'), result(5000, 10));
    arcade.setName('  Zed  ');
    expect(arcade.profile.name).toBe('Zed');
    arcade.resetProgress();
    expect(arcade.profile.games.hill.plays).toBe(0);
    expect(arcade.profile.name).toBe('Player');
    expect(arcade.profile.settings.musicVolume).toBe(0.1);
    expect(arcade.profile.missions.list.length).toBe(3);
  });
});
