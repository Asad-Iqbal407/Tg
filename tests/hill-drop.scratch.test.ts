import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('drop', () => {
  const out: string[] = [];
  for (const skinId of ['car-jeep', 'car-monster', 'car-racer', 'car-rover']) {
    for (const h of [500, 800]) {
      const r = runBot({ seed: 1, skinId, mode: 'spin', flips: 1, seconds: 4, drop: h });
      out.push(`${skinId} drop=${h}: flips=${r.result.stats.flips ?? 0} air=${(r.result.stats.airtime ?? 0).toFixed(2)} reason=${r.reason || '-'} m=${r.meters.toFixed(1)}`);
    }
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/drop.txt', out.join('\n') + '\n');
}, 120000);
