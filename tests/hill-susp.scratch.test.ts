import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('susp', () => {
  const out: string[] = [];
  for (const skinId of ['car-jeep', 'car-monster', 'car-racer', 'car-rover']) {
    let lo = [Infinity, Infinity];
    let hi = [-Infinity, -Infinity];
    runBot({ seed: 2, skinId, mode: 'hold', seconds: 120, trace: (p, _s, _w, g) => {
      const car = (g as unknown as { car: { compression(w: number): number; airT: number } }).car;
      if (car.airT > 0) return;
      for (let w = 0; w < 2; w++) {
        const c = car.compression(w);
        lo[w] = Math.min(lo[w]!, c);
        hi[w] = Math.max(hi[w]!, c);
      }
      void p;
    } });
    out.push(`${skinId}: rear ${lo[0]!.toFixed(1)}..${hi[0]!.toFixed(1)}px front ${lo[1]!.toFixed(1)}..${hi[1]!.toFixed(1)}px`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/susp.txt', out.join('\n') + '\n');
}, 120000);
