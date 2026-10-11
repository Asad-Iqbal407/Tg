import type { RunRequest } from '../../../shared/api';
import { type KVBackend, numberRecord } from '../../core/storage';
import { GAME_IDS } from '../../games/types';
import type { RunSummary } from '../arcade';
import { asRecord, isFiniteNumber } from './guards';
import { dropKey, readKey, writeKey } from './storage';

export const RUN_QUEUE_KEY = 'neon-arcade:cloud-runs';
/** Runs that could not be posted are kept for retry. Past this many, the oldest is dropped. */
export const RUN_QUEUE_CAP = 50;

export interface PendingRun {
  /** Runs are only ever posted while this account is signed in, so they cannot land on another one. */
  userId: string;
  queuedAt: number;
  run: RunRequest;
}

/** Builds the POST runs body for a settled run. Numbers are clamped the way ArcadeService clamps them. */
export function toRunRequest(
  summary: RunSummary,
  startedAt: number,
  clientRunId: string,
  now: number,
): RunRequest {
  const { result, rewards } = summary;
  return {
    clientRunId,
    gameId: summary.gameId,
    score: Math.max(0, Math.floor(isFiniteNumber(result.score) ? result.score : 0)),
    coins: Math.max(0, Math.floor(isFiniteNumber(rewards.coins) ? rewards.coins : 0)),
    xp: Math.max(0, Math.floor(isFiniteNumber(rewards.xp) ? rewards.xp : 0)),
    durationSec: Math.max(0, isFiniteNumber(result.durationSec) ? result.durationSec : 0),
    stats: numberRecord(result.stats),
    startedAt: isFiniteNumber(startedAt) ? Math.floor(startedAt) : now,
  };
}

/** A UUID for `clientRunId`. Uses crypto.randomUUID where the page is a secure context. */
export function newRunId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRunRequest(v: unknown): v is RunRequest {
  const o = asRecord(v);
  return (
    o !== null &&
    typeof o.clientRunId === 'string' &&
    o.clientRunId.length > 0 &&
    o.clientRunId.length <= 64 &&
    typeof o.gameId === 'string' &&
    (GAME_IDS as readonly string[]).includes(o.gameId) &&
    ['score', 'coins', 'xp', 'durationSec', 'startedAt'].every((k) => isFiniteNumber(o[k])) &&
    asRecord(o.stats) !== null
  );
}

function readQueue(backend: KVBackend | null): PendingRun[] {
  const raw = readKey(backend, RUN_QUEUE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: PendingRun[] = [];
  for (const item of parsed) {
    const o = asRecord(item);
    if (
      o !== null &&
      typeof o.userId === 'string' &&
      o.userId.length > 0 &&
      o.userId.length <= 64 &&
      isFiniteNumber(o.queuedAt) &&
      isRunRequest(o.run)
    ) {
      items.push({ userId: o.userId, queuedAt: o.queuedAt, run: o.run });
    }
  }
  return items.slice(-RUN_QUEUE_CAP);
}

/**
 * Runs waiting to be posted. Every change is written to storage, so a run survives a reload. All
 * storage access is guarded, and a broken store only means the queue lives in memory.
 */
export class RunQueue {
  private items: PendingRun[];

  constructor(private readonly backend: KVBackend | null) {
    this.items = readQueue(backend);
  }

  get size(): number {
    return this.items.length;
  }

  count(userId: string): number {
    return this.items.reduce((n, item) => (item.userId === userId ? n + 1 : n), 0);
  }

  /** This account's runs, oldest first. */
  forUser(userId: string): PendingRun[] {
    return this.items.filter((item) => item.userId === userId);
  }

  add(userId: string, run: RunRequest, queuedAt: number): void {
    this.items.push({ userId, queuedAt, run });
    const excess = this.items.length - RUN_QUEUE_CAP;
    if (excess > 0) this.items.splice(0, excess);
    this.write();
  }

  remove(clientRunId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.run.clientRunId !== clientRunId);
    if (this.items.length !== before) this.write();
  }

  removeForUser(userId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.userId !== userId);
    if (this.items.length !== before) this.write();
  }

  private write(): void {
    if (this.items.length === 0) dropKey(this.backend, RUN_QUEUE_KEY);
    else writeKey(this.backend, RUN_QUEUE_KEY, JSON.stringify(this.items));
  }
}
