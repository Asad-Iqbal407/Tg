import { it } from 'vitest';
import { createGame, gameById } from './helpers';
const DT = 1 / 60;
it('calib', () => {
  const out: string[] = [];
  for (const seed of [1, 2, 3]) {
    const { game, input } = createGame(gameById('galaxy'), { seed });
    const g = game as any;
    let s = 0;
    while (s < 400 && !game.isOver()) {
      g.invuln = 1e9;
      const target = g.boss ?? g.enemies.filter((e: any) => e.alive && e.y > 0).sort((a: any, b: any) => b.y - a.y)[0];
      input.pointer.active = true; input.pointer.inside = true;
      input.pointer.x = target ? target.x : 270; input.pointer.y = 880;
      game.update(DT); input.postUpdate(); s += DT;
    }
    const r = game.getResult();
    out.push(`seed${seed} t=${s.toFixed(0)} score=${r.score} coins=${r.coins} wave=${r.stats.wave} enemies=${r.stats.enemies} bosses=${r.stats.bosses} powerups=${r.stats.powerups} bombs=${r.stats.bombs}`);
  }
  throw new Error('CALIB\n' + out.join('\n'));
});
