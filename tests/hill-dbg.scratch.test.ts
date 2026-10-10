import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('dbg', () => {
  const out: string[] = [];
  runBot({ seed: 1, skinId: 'car-jeep', mode: 'flip', flips: 1, seconds: 14, trace: (p, step, want) => {
    if (step >= 575 && step <= 581) out.push(`${step} airT=${p.airT.toFixed(3)} ang=${p.angle.toFixed(3)} brk=${want.brake} gas=${want.gas} x=${p.x.toFixed(1)}`);
  } });
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/dbg.txt', out.join('\n') + '\n');
}, 60000);
