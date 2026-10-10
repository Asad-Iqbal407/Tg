import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('air', () => {
  const out: string[] = [];
  for (const seed of [1, 2, 3]) {
    let air = 0;
    let startX = 0;
    const flights: string[] = [];
    runBot({ seed, skinId: 'car-jeep', mode: 'hold', seconds: 240, trace: (p) => {
      if (p.airT > 0) {
        if (air === 0) startX = p.x;
        air = p.airT;
      } else if (air > 0) {
        flights.push(`${(startX / 25).toFixed(0)}m:${air.toFixed(2)}s`);
        air = 0;
      }
    } });
    out.push(`seed ${seed}: ${flights.join(' ')}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/air.txt', out.join('\n') + '\n');
}, 300000);

export function dropSpin(skinId: string, height: number, flips: number) {
  return runBot({ seed: 1, skinId, mode: 'spin', flips, seconds: 6, drop: height });
}
