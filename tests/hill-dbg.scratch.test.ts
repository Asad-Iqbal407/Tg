import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('dbg', () => {
  const out: string[] = [];
  runBot({ seed: 1, skinId: 'car-jeep', mode: 'flip', flips: 1, seconds: 12, trace: (p, step, want) => {
    if (step >= 566 && step <= 590) {
      const k = p.kickers.find((k) => p.x >= k.start - 5 && p.x <= k.end + 5);
      out.push(`${step} x=${p.x.toFixed(0)} airT=${p.airT.toFixed(3)} ang=${p.angle.toFixed(3)} brk=${want.brake} gas=${want.gas} k=${k ? `${k.start.toFixed(0)}..${k.end.toFixed(0)}` : 'none'} n=${p.kickers.length}`);
    }
  } });
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/dbg.txt', out.join('\n') + '\n');
}, 60000);
