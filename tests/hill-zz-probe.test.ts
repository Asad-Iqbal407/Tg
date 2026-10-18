import { it } from 'vitest';
import { HillGame } from '../src/games/hill/hill';
import { GAMES } from '../src/games/registry';
import { SKINS, toSkinData } from '../src/meta/catalog';
import { createGame } from './helpers';
import { Rng } from '../src/core/rng';
import { appendFileSync, writeFileSync } from 'fs';
const LOG = '/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/hill-snake/hill-probe.log';
const hillDef = GAMES.find((g) => g.id === 'hill')!;
it('probe', () => {
  writeFileSync(LOG, '');
  const seed = Number(process.env.SEED ?? 4);
  const v = process.env.VEH ?? 'car-jeep';
  const r = new Rng(seed * 99);
  const boosts = seed % 3 === 0 ? ['shield' as const] : seed % 3 === 1 ? ['head-start' as const] : [];
  const { game: g, input } = createGame(hillDef, { seed, skin: toSkinData(SKINS.find((s) => s.id === v)!), boosts });
  const game = g as HillGame;
  let gas = false, brk = false, steps = 0;
  const mode = seed % 2;
  const T0 = Date.now();
  while (!game.isOver() && steps < 60 * 400 && Date.now() - T0 < 20000) {
    if (steps % 20 === 0) {
      if (mode === 0) { gas = r.chance(0.6); brk = !gas && r.chance(0.4); }
      else { gas = r.chance(0.9); brk = !gas; }
    }
    input.setVirtual('right', gas, 'b'); input.setVirtual('left', brk, 'b');
    if (steps > 5095) { const q = game.probe(); appendFileSync(LOG, `pre ${steps} x=${q.x} y=${q.y} vx=${q.vx} gas=${gas} brk=${brk} spawnedTo=${(game as unknown as {spawnedTo:number}).spawnedTo} maxX=${(game as unknown as {maxX:number}).maxX}\n`); }
    const t1 = Date.now();
    game.update(1 / 60); input.postUpdate();
    if (steps % 60 === 0) game.render();
    const p = game.probe();
    const dtw = Date.now() - t1;
    if (steps % 60 === 0 || dtw > 50) appendFileSync(LOG, `${steps} x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} vx=${p.vx.toFixed(0)} a=${p.angle.toFixed(2)} air=${p.airT.toFixed(2)} fuel=${p.fuel.toFixed(0)} cr=${p.crashed} ${p.crashReason} ms=${dtw}\n`);
    steps++;
  }
  appendFileSync(LOG, `end steps=${steps} over=${game.isOver()} wall=${Date.now() - T0}\n`);
}, 60000);
