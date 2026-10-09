import type { SpriteDef } from '../sprite';

// Original pixel art. H hat, V visor, h hair, S skin, E eye, m mouth, C shirt, O overalls,
// B buttons, F shoes.
const HEAD: SpriteDef = [
  '....HHHH....',
  '..HHHHHHHH..',
  '.HHHHHHHHHVV',
  '..hSSSSSSh..',
  '..SSESSESS..',
  '..SSSSSSSS..',
  '...SSmmSS...',
];
const TORSO: SpriteDef = ['....CCCC....', '..CCOOOOCC..', '.SCCOBBOCCS.', '.SCOOOOOOCS.', '...OOOOOO...'];
const TORSO_JUMP: SpriteDef = [
  '.S..CCCC..S.',
  '.SCCOOOOCCS.',
  '..CCOBBOCC..',
  '..COOOOOOC..',
  '...OOOOOO...',
];

const LEGS = {
  stand: ['...OO..OO...', '...OO..OO...', '..FFF..FFF..', '..FFF..FFF..'],
  walkA: ['..OO....OO..', '.OO......OO.', '.FF......FF.', 'FFF......FFF'],
  walkB: ['....OOOO....', '....OOOO....', '....FFFF....', '...FFFFFF...'],
  jump: ['..OO...OO...', '.OO.....OO..', '.FF......FF.', 'FF.......FF.'],
} satisfies Record<string, SpriteDef>;

export type HeroPose = keyof typeof LEGS;

function build(big: boolean, pose: HeroPose): SpriteDef {
  const torso = pose === 'jump' ? TORSO_JUMP : TORSO;
  const legs = LEGS[pose];
  if (!big) return [...HEAD, ...torso, ...legs];
  const t2: string[] = [];
  for (const r of torso) t2.push(r, r);
  const l2 = [legs[0], legs[0], legs[1], legs[1], legs[2], legs[3]] as string[];
  return [...HEAD, ...t2, ...l2];
}

export const HERO: Record<'small' | 'big', Record<HeroPose, SpriteDef>> = {
  small: {
    stand: build(false, 'stand'),
    walkA: build(false, 'walkA'),
    walkB: build(false, 'walkB'),
    jump: build(false, 'jump'),
  },
  big: {
    stand: build(true, 'stand'),
    walkA: build(true, 'walkA'),
    walkB: build(true, 'walkB'),
    jump: build(true, 'jump'),
  },
};

// Grumble: a grumpy walking mushroom. A cap, W eye white, K pupil/mouth, T stem, D feet.
export const WALKER: readonly SpriteDef[] = [
  [
    '....AAAA....',
    '..AAAAAAAA..',
    '.AAAAAAAAAA.',
    '.AWWAAAAWWA.',
    'AAWKAAAAKWAA',
    'AAAAAAAAAAAA',
    'AAAKKKKKKAAA',
    '.AAAAAAAAAA.',
    '...TTTTTT...',
    '..TTTTTTTT..',
    '.DD......DD.',
    'DDD......DDD',
  ],
  [
    '....AAAA....',
    '..AAAAAAAA..',
    '.AAAAAAAAAA.',
    '.AWWAAAAWWA.',
    'AAKWAAAAWKAA',
    'AAAAAAAAAAAA',
    'AAAKKKKKKAAA',
    '.AAAAAAAAAA.',
    '...TTTTTT...',
    '..TTTTTTTT..',
    '..DD....DD..',
    '..DDD..DDD..',
  ],
];

// Shellback beetle. H head/limbs, W eye, K pupil, G shell, g shell pattern, Y rim.
export const SHELLBACK: readonly SpriteDef[] = [
  [
    '........HH..',
    '.......HHHH.',
    '.......HWKH.',
    '.......HHHH.',
    '...GGGG.HH..',
    '..GgGGgG.H..',
    '.GGGgGGGgG..',
    '.GgGGGgGGG..',
    '.GGGgGGGgG..',
    '.YYYYYYYYYY.',
    '..HH....HH..',
    '.HHH...HHH..',
  ],
  [
    '........HH..',
    '.......HHHH.',
    '.......HWKH.',
    '.......HHHH.',
    '...GGGG.HH..',
    '..GgGGgG.H..',
    '.GGGgGGGgG..',
    '.GgGGGgGGG..',
    '.GGGgGGGgG..',
    '.YYYYYYYYYY.',
    '...HH..HH...',
    '...HHH.HHH..',
  ],
];

export const SHELL: SpriteDef = [
  '...GGGGGG...',
  '..GgGGGGgG..',
  '.GGGgGGgGGG.',
  '.GgGGGGGGgG.',
  '.GGGgGGgGGG.',
  '.YYYYYYYYYY.',
  '..YYYYYYYY..',
];

// Spiky: R shell, W spikes, K eye, H feet.
export const SPIKY: readonly SpriteDef[] = [
  [
    '..W...W...W.',
    '..WW..WW..WW',
    '.RRRRRRRRRR.',
    'WRRRRRRRRRRR',
    '.RRrRRRrRRRK',
    'WRRRRRRRRRRK',
    '.RRRRRRRRRRR',
    '..RRRRRRRRR.',
    '..HH....HH..',
    '.HHH...HHH..',
  ],
  [
    '..W...W...W.',
    '..WW..WW..WW',
    '.RRRRRRRRRR.',
    'WRRRRRRRRRRR',
    '.RRrRRRrRRRK',
    'WRRRRRRRRRRK',
    '.RRRRRRRRRRR',
    '..RRRRRRRRR.',
    '...HH..HH...',
    '...HHH.HHH..',
  ],
];

export const MUSHROOM: SpriteDef = [
  '....RRRR....',
  '..RRWWRRRR..',
  '.RRWWWWRRRR.',
  '.RRRWWRRWWR.',
  'RRRRRRRWWWWR',
  'RWWRRRRRWWRR',
  'RWWWRRRRRRRR',
  '.RRRRRRRRRR.',
  '...SSSSSS...',
  '..SSKSSKSS..',
  '..SSKSSKSS..',
  '...SSSSSS...',
];

export const FLOWER: SpriteDef = [
  '....OOOO....',
  '..OOYYYYOO..',
  '.OYYWWWWYYO.',
  '.OYYWWWWYYO.',
  '..OOYYYYOO..',
  '....OOOO....',
  '.....GG.....',
  '.GG..GG..GG.',
  '..GG.GG.GG..',
  '...GGGGGG...',
  '.....GG.....',
  '.....GG.....',
];

export const FIREBALL: SpriteDef = ['..YY..', '.YOOY.', 'YORROY', 'YORROY', '.YOOY.', '..YY..'];
