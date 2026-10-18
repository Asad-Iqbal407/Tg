import { it } from 'vitest';
import { runBot } from './hill.test';
import { writeFileSync } from 'fs';
it('flips', () => {
  const out: string[] = [];
  for (const skinId of ['car-jeep', 'car-monster', 'car-racer', 'car-rover']) for (let seed = 1; seed <= 6; seed++) {
    let lost = 0, awarded = 0, prevPending = 0, prevFlips = 0, overwritten = 0;
    const run = runBot({ seed, skinId, mode: 'spin', seconds: 200, trace: (_p, _s, _w, g) => {
      const gi = g as unknown as { pendingFlips: number; stats: Record<string, number>; landT: number };
      const flips = gi.stats['flips'] ?? 0;
      if (flips > prevFlips) awarded += flips - prevFlips;
      else if (prevPending > 0 && gi.pendingFlips === 0) lost += prevPending;
      else if (prevPending > 0 && gi.pendingFlips !== prevPending) overwritten++;
      prevPending = gi.pendingFlips; prevFlips = flips;
    } });
    out.push(`${skinId} s${seed} m=${run.meters.toFixed(0)} ${run.reason} awarded=${awarded} lost=${lost} overwritten=${overwritten}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/hill-snake/flips.txt', out.join('\n'));
}, 600000);
