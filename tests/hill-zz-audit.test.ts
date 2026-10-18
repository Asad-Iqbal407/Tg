import { it } from 'vitest';
import { HillGame } from '../src/games/hill/hill';
import { GAMES } from '../src/games/registry';
import { SKINS, toSkinData } from '../src/meta/catalog';
import { createGame } from './helpers';
import { Rng } from '../src/core/rng';
import { appendFileSync, writeFileSync } from 'fs';
const LOG = '/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/hill-snake/hill-audit.log';
const hillDef = GAMES.find((g) => g.id === 'hill')!;
const VEH = ['car-jeep', 'car-monster', 'car-racer', 'car-rover'];
it('audit', () => {
  writeFileSync(LOG, '');
  for (const v of VEH) for (let seed = 1; seed <= 8; seed++) {
    const T0 = Date.now();
    const r = new Rng(seed * 99);
    const boosts = seed % 3 === 0 ? ['shield' as const] : seed % 3 === 1 ? ['head-start' as const] : [];
    const { game: g, input } = createGame(hillDef, { seed, skin: toSkinData(SKINS.find((s) => s.id === v)!), boosts });
    const game = g as HillGame;
    let gas = false, brk = false, steps = 0, bad = '';
    const mode = seed % 2;
    let flipsSeen = 0;
    while (!game.isOver() && steps < 60 * 400) {
      if (steps % 20 === 0) {
        if (mode === 0) { gas = r.chance(0.6); brk = !gas && r.chance(0.4); }
        else { gas = r.chance(0.9); brk = !gas; }
      }
      input.setVirtual('right', gas, 'b'); input.setVirtual('left', brk, 'b');
      game.update(1 / 60); input.postUpdate();
      if (steps % 60 === 0) game.render();
      const p = game.probe();
      if (![p.x, p.y, p.vx, p.vy, p.angle, p.fuel].every(Number.isFinite)) { bad = 'NaN@' + steps; break; }
      if (p.speed > 3000) { bad = 'speed ' + p.speed.toFixed(0) + '@' + steps; break; }
      steps++;
    }
    const p = game.probe();
    const res = game.getResult();
    appendFileSync(LOG, `${v} s${seed} m${mode} ${boosts.join()} t=${(steps / 60).toFixed(0)}s over=${game.isOver()} ${p.crashReason} m=${p.meters.toFixed(0)} fuel=${p.fuel.toFixed(0)} score=${res.score} coins=${res.coins} ${JSON.stringify(res.stats)} ${bad} wall=${((Date.now() - T0) / 1000).toFixed(1)}\n`);
  }
}, 900000);
