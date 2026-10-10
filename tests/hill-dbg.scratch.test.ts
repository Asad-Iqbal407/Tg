import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('dbg', () => {
  const g = globalThis as unknown as { __dbg?: string[] };
  g.__dbg = [];
  runBot({ seed: 1, skinId: 'car-jeep', mode: 'flip', flips: 1, seconds: 14, trace: (p, step, want) => {
    if (step >= 577 && step <= 578) g.__dbg?.push(`TRACE ${step} airT=${p.airT} ang=${p.angle} want=${JSON.stringify(want)}`);
  } });
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/dbg.txt', g.__dbg.join('\n') + '\n');
}, 60000);
