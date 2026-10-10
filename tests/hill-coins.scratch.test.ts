import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBot } from './hill.test';
import { GAMES } from '../src/games/registry';

it('coins', () => {
  const def = GAMES.find((g) => g.id === 'hill')!;
  const out: string[] = [];
  for (const [seed, secs] of [[1, 40], [1, 120], [2, 200], [3, 300]] as const) {
    const r = runBot({ seed, skinId: 'car-jeep', mode: 'hold', seconds: secs });
    const arcade = Math.floor(r.result.score / def.scorePerCoin) + r.result.coins;
    out.push(`seed ${seed} t=${secs}: m=${Math.round(r.meters)} score=${r.result.score} pickupCoins=${r.result.coins} scoreCoins=${Math.floor(r.result.score / def.scorePerCoin)} total~${arcade} reason=${r.reason || '-'}`);
  }
  writeFileSync('/tmp/claude-0/-home-user-Tg/1469e30c-e6d3-59df-b920-1336e6322472/scratchpad/coins.txt', out.join('\n') + '\n');
}, 120000);
