import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { type BotMode, runBot } from './hill.test';

const SKINS = ['car-jeep', 'car-monster', 'car-racer', 'car-rover'];
const SEEDS = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
const MODES = (process.env.MODES ?? 'hold,skilled').split(',') as BotMode[];
const SECS = Number(process.env.SECS ?? 240);

it('tune', () => {
  const lines: string[] = [];
  for (const skinId of SKINS) {
    for (const mode of MODES) {
      const row: string[] = [];
      for (const seed of SEEDS) {
        const r = runBot({ seed, skinId, mode, seconds: SECS, flips: Number(process.env.FLIPS ?? 1) });
        row.push(`${Math.round(r.meters)}m/${r.seconds.toFixed(0)}s/${r.reason || '-'}/f${r.result.stats.flips ?? 0}/a${(r.result.stats.airtime ?? 0).toFixed(2)}/c${r.result.stats.fuelCans ?? 0}`);
      }
      lines.push(`${skinId.padEnd(12)} ${mode.padEnd(8)} ${row.join('  |  ')}`);
    }
  }
  writeFileSync(process.env.OUT ?? '/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/tune.txt', lines.join('\n') + '\n');
}, 600000);
