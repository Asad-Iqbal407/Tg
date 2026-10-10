import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';

it('trace', () => {
  const out: string[] = [];
  let prevAir = 0;
  let airRotMax = 0;
  let startAngle = 0;
  const r = runBot({
    seed: Number(process.env.SEED ?? 1),
    skinId: process.env.SKIN ?? 'car-jeep',
    mode: (process.env.BOT_MODE ?? 'flip') as 'flip',
    flips: 1,
    seconds: Number(process.env.SECS ?? 60),
    trace: (p, step, want) => {
      if (p.airT > 0 && prevAir === 0) {
        startAngle = p.angle;
        airRotMax = 0;
        out.push(`--- jump at step ${step} x=${p.x.toFixed(0)} speed=${p.speed.toFixed(0)} angle0=${p.angle.toFixed(2)}`);
      }
      if (p.airT > 0) {
        const rot = p.angle - startAngle;
        out.push(`  s=${step} t=${p.airT.toFixed(2)} ang=${p.angle.toFixed(2)} rot=${rot.toFixed(2)} w=${p.angularVelocity.toFixed(2)} y=${p.y.toFixed(0)} gas=${JSON.stringify(want)} airT=${p.airT} vx=${p.vx.toFixed(0)} x=${p.x} nk=${p.kickers.length} k0=${p.kickers[0]?.start}-${p.kickers[0]?.end} rot=${(globalThis as unknown as {__r?: number}).__r}`);
      } else if (prevAir > 0) {
        out.push(`  LAND ang=${p.angle.toFixed(2)} stats=${JSON.stringify(r0(p))}`);
      }
      prevAir = p.airT;
    },
  });
  out.push(`final ${JSON.stringify(r.result.stats)} reason=${r.reason} meters=${r.meters.toFixed(0)}`);
  writeFileSync(process.env.OUT ?? '/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/trace.txt', out.join('\n') + '\n');
  void airRotMax;
}, 120000);

function r0(p: { meters: number }) {
  return { m: Math.round(p.meters) };
}
