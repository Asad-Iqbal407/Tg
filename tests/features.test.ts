/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke loose JSON into the profile on purpose */
import { describe, expect, it } from 'vitest';
import { CHALLENGE_COINS, CHALLENGE_XP, challengeSeed } from '../src/meta/challenge';
import { defaultProfile, sanitizeProfile } from '../src/meta/profile';
import { GAME_IDS } from '../src/games/types';
import { makeArcade } from './helpers';

const result = (score: number, coins = 0, durationSec = 60) => ({ score, coins, stats: {}, durationSec });

describe('Daily Challenge', () => {
  it('gives everyone the same seed for a game on a day, and different ones across days and games', () => {
    expect(challengeSeed('2026-10-09', 'golf')).toBe(challengeSeed('2026-10-09', 'golf'));
    expect(challengeSeed('2026-10-09', 'golf')).not.toBe(challengeSeed('2026-10-10', 'golf'));
    expect(challengeSeed('2026-10-09', 'golf')).not.toBe(challengeSeed('2026-10-09', 'mole'));
  });

  it('pays the bonus once a day, on the first run that scores', () => {
    const { arcade } = makeArcade();
    const coins0 = arcade.profile.coins;
    const xp0 = arcade.profile.xp;
    // A run that scores nothing does not take the bonus.
    const dud = arcade.finishRun(arcade.startRun('mole', [], true), result(0));
    expect(dud.challenge).toMatchObject({ attempt: 1, bonusCoins: 0, bonusXp: 0 });
    expect(arcade.challengeStatus('mole').bonusAvailable).toBe(true);
    const first = arcade.finishRun(arcade.startRun('mole', [], true), result(500));
    expect(first.challenge).toMatchObject({
      attempt: 2,
      bestToday: 500,
      bonusCoins: CHALLENGE_COINS,
      bonusXp: CHALLENGE_XP,
      beatBest: false,
    });
    const again = arcade.finishRun(arcade.startRun('mole', [], true), result(900));
    expect(again.challenge).toMatchObject({ attempt: 3, bestToday: 900, bonusCoins: 0, beatBest: true });
    expect(arcade.challengeStatus('mole')).toMatchObject({ plays: 3, best: 900, bonusAvailable: false });
    // The bonus is added on top of the runs' own rewards (level-ups and achievements pay on top of that again).
    const earned = first.rewards.coins + again.rewards.coins + dud.rewards.coins + CHALLENGE_COINS;
    expect(arcade.profile.coins - coins0).toBeGreaterThanOrEqual(earned);
    expect(arcade.profile.xp).toBeGreaterThanOrEqual(xp0 + CHALLENGE_XP);
  });

  it('is a fresh challenge the next day, and other games keep their own', () => {
    let day = 9;
    const { arcade } = makeArcade(() => new Date(2026, 9, day, 12));
    arcade.finishRun(arcade.startRun('mole', [], true), result(400));
    expect(arcade.challengeStatus('golf')).toMatchObject({ plays: 0, bonusAvailable: true });
    day = 10;
    expect(arcade.challengeStatus('mole')).toMatchObject({ plays: 0, best: 0, bonusAvailable: true });
    const next = arcade.finishRun(arcade.startRun('mole', [], true), result(100));
    expect(next.challenge).toMatchObject({ attempt: 1, bestToday: 100, bonusCoins: CHALLENGE_COINS });
  });

  it('an ordinary run is not a challenge run and leaves the figures alone', () => {
    const { arcade } = makeArcade();
    const s = arcade.finishRun(arcade.startRun('mole', []), result(300));
    expect(s.challenge).toBeNull();
    expect(arcade.challengeStatus('mole').plays).toBe(0);
  });

  it('a run abandoned before it starts does not count', () => {
    const { arcade } = makeArcade();
    arcade.abandonRun(arcade.startRun('mole', [], true));
    expect(arcade.challengeStatus('mole')).toMatchObject({ plays: 0, bonusAvailable: true });
  });

  it('counts the day a run started, even if it ends after midnight', () => {
    let day = 9;
    const { arcade } = makeArcade(() => new Date(2026, 9, day, 23, 59));
    const ticket = arcade.startRun('mole', [], true);
    day = 10;
    const s = arcade.finishRun(ticket, result(200));
    expect(s.challenge?.day).toBe('2026-10-09');
    expect(arcade.profile.challenge.mole.day).toBe('2026-10-09');
  });
});

describe('favourites', () => {
  it('stars and unstars games, in the order starred', () => {
    const { arcade } = makeArcade();
    expect(arcade.toggleFavorite('golf')).toBe(true);
    expect(arcade.toggleFavorite('mole')).toBe(true);
    expect(arcade.profile.favorites).toEqual(['golf', 'mole']);
    expect(arcade.isFavorite('golf')).toBe(true);
    expect(arcade.toggleFavorite('golf')).toBe(false);
    expect(arcade.profile.favorites).toEqual(['mole']);
  });

  it('refuses a game that does not exist', () => {
    const { arcade } = makeArcade();
    expect(() => arcade.toggleFavorite('nope' as never)).toThrow();
  });
});

describe('saved profile data', () => {
  it('keeps real favourites once each and drops everything else', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(defaultProfile(0)));
    raw.favorites = ['golf', 'golf', 'nope', 7, null, 'mole'];
    expect(sanitizeProfile(raw).favorites).toEqual(['golf', 'mole']);
    raw.favorites = 'golf';
    expect(sanitizeProfile(raw).favorites).toEqual([]);
  });

  it('keeps valid challenge figures and resets broken ones', () => {
    const raw = JSON.parse(JSON.stringify(defaultProfile(0))) as Record<string, any>;
    raw.challenge.golf = { day: '2026-10-09', best: 700, plays: 3, claimed: true };
    raw.challenge.mole = { day: 'yesterday', best: -5, plays: 'x', claimed: 1 };
    raw.challenge.hoops = { day: '2026-10-09', best: 1e30, plays: -4 };
    const p = sanitizeProfile(raw);
    expect(p.challenge.golf).toEqual({ day: '2026-10-09', best: 700, plays: 3, claimed: true });
    expect(p.challenge.mole).toEqual({ day: '', best: 0, plays: 0, claimed: false });
    expect(Number.isFinite(p.challenge.hoops.best)).toBe(true);
    expect(p.challenge.hoops.plays).toBeGreaterThanOrEqual(0);
  });

  it('gives a profile saved before these features empty ones for every game', () => {
    const raw = JSON.parse(JSON.stringify(defaultProfile(0))) as Record<string, any>;
    delete raw.favorites;
    delete raw.challenge;
    const p = sanitizeProfile(raw);
    expect(p.favorites).toEqual([]);
    for (const id of GAME_IDS)
      expect(p.challenge[id]).toEqual({ day: '', best: 0, plays: 0, claimed: false });
  });
});

describe('game discovery', () => {
  it('puts every game in exactly one category', async () => {
    const { GAMES } = await import('../src/games/registry');
    const { CATEGORIES, CATEGORY_OF } = await import('../src/games/categories');
    for (const g of GAMES) expect(CATEGORIES, g.id).toContain(CATEGORY_OF[g.id]);
  });

  it('searches by every typed word, in any order and case', async () => {
    const { GAMES } = await import('../src/games/registry');
    const { matchesQuery } = await import('../src/games/categories');
    const g = GAMES[0]!;
    expect(matchesQuery(g, '')).toBe(true);
    expect(matchesQuery(g, `  ${g.title.toUpperCase()} `)).toBe(true);
    expect(matchesQuery(g, `${g.title} zzzzqqq`)).toBe(false);
  });

  it('lists recently played games newest first and skips unplayed ones', async () => {
    const { GAMES } = await import('../src/games/registry');
    const { recentGames } = await import('../src/games/categories');
    const { defaultProfile } = await import('../src/meta/profile');
    const p = defaultProfile();
    const ids = GAMES.map((g) => g.id);
    p.games[ids[0]!].lastPlayed = 100;
    p.games[ids[1]!].lastPlayed = 300;
    p.games[ids[2]!].lastPlayed = 200;
    expect(recentGames(p.games, ids, 2)).toEqual([ids[1], ids[2]]);
    expect(recentGames(p.games, ids, 9)).toHaveLength(3);
  });
});
