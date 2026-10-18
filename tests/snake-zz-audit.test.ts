import { it } from 'vitest';
import { snakeGame } from '../src/games/snake';
import { createGame } from './helpers';
import { Rng } from '../src/core/rng';
import { writeFileSync } from 'fs';
type C = { x: number; y: number };
it('audit', () => {
  const out: string[] = [];
  const dirs = ['up', 'down', 'left', 'right'] as const;
  for (let seed = 1; seed <= 300; seed++) {
    const r = new Rng(seed * 7);
    const boosts = seed % 3 === 0 ? ['shield' as const] : seed % 3 === 1 ? ['head-start' as const] : [];
    const sizes = [[600, 800], [380, 640], [900, 470], [392, 800], [1200, 628]];
    const [w, h] = sizes[seed % sizes.length]!;
    const { game, input } = createGame(snakeGame, { seed, boosts, width: w, height: h });
    const s = game as unknown as { body: C[]; apple: (C & { golden: boolean }) | null; grid: { cols: number; rows: number; solid(c: C): boolean; walls: Uint8Array; index(c: C): number }; invulnT: number; level: number; applesEaten: number };
    let steps = 0, bad = '';
    let lastScore = 0;
    while (!game.isOver() && steps < 60 * 600) {
      // simple greedy: head toward apple with random noise
      if (steps % 3 === 0) {
        const hd = s.body[0]!;
        const a = s.apple;
        let d: (typeof dirs)[number] = dirs[r.int(0, 3)]!;
        if (a && r.chance(0.8)) d = a.x > hd.x ? 'right' : a.x < hd.x ? 'left' : a.y > hd.y ? 'down' : 'up';
        // avoid obvious death
        const step: Record<string, C> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
        const n = { x: hd.x + step[d]!.x, y: hd.y + step[d]!.y };
        if (!s.grid.solid(n) && !s.body.some((b) => b.x === n.x && b.y === n.y)) { input.setVirtual(d, true, 'a'); input.setVirtual(d, false, 'a'); }
      }
      game.update(1 / 60); input.postUpdate();
      if (steps % 10 === 0) game.render();
      // invariants
      for (const c of s.body) if (c.x < 0 || c.y < 0 || c.x >= s.grid.cols || c.y >= s.grid.rows) bad = 'oob';
      for (let i = 1; i < s.body.length; i++) { const a = s.body[i - 1]!, b = s.body[i]!; if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1) bad = 'gap@' + steps; }
      if (s.apple && (s.grid.walls[s.grid.index(s.apple)] )) bad = 'apple on wall';
      const sc = game.getResult().score; if (sc < lastScore) bad = 'score down'; lastScore = sc;
      if (bad) break;
      steps++;
    }
    const res = game.getResult();
    out.push(`s${seed} ${w}x${h} ${boosts.join()} t=${(steps / 60).toFixed(0)} over=${game.isOver()} lvl=${s.level} apples=${s.applesEaten} len=${s.body.length} score=${res.score} coins=${res.coins} dur=${res.durationSec.toFixed(1)} ${JSON.stringify(res.stats)} ${bad}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/hill-snake/snake-audit.txt', out.join('\n'));
}, 600000);
