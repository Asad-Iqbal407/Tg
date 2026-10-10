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
    mode: (process.env.MODE ?? 'flip') as 'flip',
    flips: 1,
    seconds: Number(process.env.SECS ?? 60),
    trace: (p, step, want) => {
      if (p.airT > 0 && prevAir === 0) {
        startAngle = p.angle;
        airRotMax = 0;
        out.push(`--- jump at step ${step} x=${p.x.toFixed(0)} speed=${p.speed.toFixed(0)} angle0=${p.angle.toFixed(2)} slope=${p.groundAngle(p.x).toFixed(2)}`);
      }
      if (p.airT > 0) {
        const rot = p.angle - startAngle;
        out.push(`  t=${p.airT.toFixed(2)} ang=${p.angle.toFixed(2)} rot=${rot.toFixed(2)} w=${p.angularVelocity.toFixed(2)} y=${p.y.toFixed(0)} gas=${want.gas ? 1 : 0} brk=${want.brake ? 1 : 0} vx=${p.vx.toFixed(0)}`);
      } else if (prevAir > 0) {
        out.push(`  LAND ang=${p.angle.toFixed(2)} slope=${p.groundAngle(p.x).toFixed(2)} stats=${JSON.stringify(r0(p))}`);
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
