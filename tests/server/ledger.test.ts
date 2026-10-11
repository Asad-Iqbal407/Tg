import { describe, expect, it } from 'vitest';
import { defaultProfile, type MissionState, type Profile } from '../../src/meta/profile';
import { diffProfiles } from '../../server/ledger';

const USER = 'user-42';
const NOW = 1_700_000_000_000;

function base(): Profile {
  return defaultProfile(1);
}

function mission(overrides: Partial<MissionState> = {}): MissionState {
  return {
    id: 'daily-coins-1',
    templateId: 'coins',
    tier: 0,
    gameId: null,
    kind: 'total',
    stat: 'coins',
    target: 50,
    progress: 50,
    claimed: false,
    label: 'Collect 50 coins',
    reward: { coins: 40, xp: 10, gems: 1 },
    ...overrides,
  };
}

describe('diffProfiles', () => {
  it('produces no rows when nothing changed', () => {
    expect(diffProfiles(base(), base(), USER, NOW)).toEqual([]);
  });

  it('records coin, gem and xp changes as signed amounts, with spending negative', () => {
    const before = base();
    const after = { ...base(), coins: before.coins - 75, gems: 5, xp: 30 };
    expect(diffProfiles(before, after, USER, NOW)).toEqual([
      { userId: USER, kind: 'coins', amount: -75, ref: null, createdAt: NOW },
      { userId: USER, kind: 'gems', amount: 5, ref: null, createdAt: NOW },
      { userId: USER, kind: 'xp', amount: 30, ref: null, createdAt: NOW },
    ]);
  });

  it('records an achievement only when it first appears', () => {
    const before = { ...base(), achievements: { 'first-run': 1 } };
    const after = { ...base(), achievements: { 'first-run': 1, explorer: 2 } };
    expect(diffProfiles(before, after, USER, NOW)).toEqual([
      { userId: USER, kind: 'achievement', ref: 'explorer', createdAt: NOW },
    ]);
    expect(diffProfiles(after, after, USER, NOW)).toEqual([]);
  });

  it('records an owned item only when it is newly added', () => {
    const before = base();
    const after = { ...base(), owned: [...before.owned, 'runner-ninja'] };
    expect(diffProfiles(before, after, USER, NOW)).toEqual([
      { userId: USER, kind: 'purchase', ref: 'runner-ninja', createdAt: NOW },
    ]);
    expect(diffProfiles(after, after, USER, NOW)).toEqual([]);
  });

  it('records a mission once, when it becomes claimed, with its reward', () => {
    const before = { ...base(), missions: { day: '2026-01-15', list: [mission()] } };
    const claimed = { ...base(), missions: { day: '2026-01-15', list: [mission({ claimed: true })] } };

    expect(diffProfiles(before, claimed, USER, NOW)).toEqual([
      {
        userId: USER,
        kind: 'mission',
        ref: 'daily-coins-1',
        reward: { coins: 40, xp: 10, gems: 1 },
        createdAt: NOW,
      },
    ]);
    expect(diffProfiles(claimed, claimed, USER, NOW)).toEqual([]);
  });

  it('records a daily claim when lastClaim changes, with the streak', () => {
    const before = base();
    const after = { ...base(), daily: { lastClaim: '2026-01-15', streak: 3, best: 3 } };
    expect(diffProfiles(before, after, USER, NOW)).toEqual([
      { userId: USER, kind: 'daily', ref: '2026-01-15', streak: 3, createdAt: NOW },
    ]);
  });

  it('does not record a daily claim when the day has not changed', () => {
    const before = { ...base(), daily: { lastClaim: '2026-01-15', streak: 3, best: 3 } };
    const after = { ...base(), daily: { lastClaim: '2026-01-15', streak: 3, best: 4 } };
    expect(diffProfiles(before, after, USER, NOW)).toEqual([]);
  });

  it('combines every kind in one save', () => {
    const before = base();
    const after = {
      ...base(),
      coins: before.coins + 10,
      achievements: { 'first-run': 1 },
      owned: [...before.owned, 'runner-ninja'],
      missions: { day: '2026-01-15', list: [mission({ claimed: true })] },
      daily: { lastClaim: '2026-01-15', streak: 1, best: 1 },
    };
    const kinds = diffProfiles(before, after, USER, NOW).map((row) => row.kind);
    expect(kinds).toEqual(['coins', 'achievement', 'purchase', 'mission', 'daily']);
  });
});
