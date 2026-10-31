import type { LeaderboardEntry } from '../../../shared/api';
import type { GameId } from '../../games/types';
import { type CloudApi, liveApi } from './api';

/** How long a fetched global board is reused before the server is asked again. */
export const GLOBAL_BOARD_TTL_MS = 60_000;

const cache = new Map<GameId, { at: number; entries: LeaderboardEntry[] }>();

/**
 * Top scores across all players. Resolves to null when the server cannot be reached, so the caller
 * can drop the section without showing an error. Successful replies are cached briefly.
 */
export async function loadGlobalBoard(
  gameId: GameId,
  api: CloudApi = liveApi,
  now: number = Date.now(),
): Promise<LeaderboardEntry[] | null> {
  const hit = cache.get(gameId);
  if (hit && now - hit.at < GLOBAL_BOARD_TTL_MS) return hit.entries;
  try {
    const { entries } = await api.leaderboard(gameId);
    cache.set(gameId, { at: now, entries });
    return entries;
  } catch {
    return null;
  }
}

/** Forgets cached boards. Used by tests. */
export function clearGlobalBoardCache(): void {
  cache.clear();
}
