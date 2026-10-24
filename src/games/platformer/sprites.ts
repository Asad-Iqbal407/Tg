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

export type HeroPose = keyof typeof LEGS | 'dead';

// Front-facing "oops" pose, arms up, used for the death hop.
const SMALL_DEAD: SpriteDef = [
  '....HHHH....',
  '..HHHHHHHH..',
  '.HHHHHHHHHH.',
  'S.hSSSSSSh.S',
  'S.SEESSEES.S',
  'SSSSSSSSSSSS',
  '.S.SmmmmS.S.',
  '...CCCCCC...',
  '..CCOOOOCC..',
  '..COOBBOOC..',
  '...OOOOOO...',
  '...OOOOOO...',
  '...OO..OO...',
  '...OO..OO...',
  '..FFF..FFF..',
  '..FFF..FFF..',
];

// The powered-up hero is its own 14x22 design (broader head and shoulders), not a stretched
// small sprite. Head 9 rows, torso 7, legs 6.
const BIG_HEAD: SpriteDef = [
  '.....HHHH.....',
  '...HHHHHHHH...',
  '..HHHHHHHHHHVV',
  '..hhSSSSSShh..',
  '..hSSESSESSh..',
  '..SSSESSESSS..',
  '..SSSSSSSSSS..',
  '...SSSmmSSS...',
  '....SSSSSS....',
];
const BIG_TORSO: SpriteDef = [
  '....CCCCCC....',
  '..CCCOCCOCCC..',
  '.CCCCOCCOCCCC.',
  'CCCCCOOOOCCCCC',
  'SSCCOBOOBOCCSS',
  'SS.OOOOOOOO.SS',
  '...OOOOOOOO...',
];
const BIG_TORSO_JUMP: SpriteDef = [
  '.SS.CCCCCC....',
  '.SSCCOCCOCCC..',
  '..CCCOCCOCCCC.',
  '..CCCOOOOCCCCS',
  '..CCOBOOBOCCSS',
  '...OOOOOOOO...',
  '...OOOOOOOO...',
];
const BIG_LEGS = {
  stand: [
    '...OOO..OOO...',
    '...OOO..OOO...',
    '...OOO..OOO...',
    '...OOO..OOO...',
    '..FFFF..FFFF..',
    '.FFFFF..FFFFF.',
  ],
  walkA: [
    '...OOOOOOOO...',
    '..OOOO..OOOO..',
    '.OOOO....OOOO.',
    '.OOO......OOO.',
    'FFFF......FFFF',
    'FFF........FFF',
  ],
  walkB: [
    '...OOOOOOOO...',
    '....OOOOOO....',
    '....OOOOOO....',
    '.....OOOO.....',
    '....FFFFFF....',
    '...FFFFFFFF...',
  ],
  jump: [
    '..OOOO..OOOO..',
    '.OOOO....OOO..',
    '.OOO.....OOO..',
    'FFF......OOO..',
    'FF......FFFF..',
    '........FFFFF.',
  ],
} satisfies Record<keyof typeof LEGS, SpriteDef>;

function build(big: boolean, pose: HeroPose): SpriteDef {
  if (pose === 'dead') return SMALL_DEAD;
  if (big) return [...BIG_HEAD, ...(pose === 'jump' ? BIG_TORSO_JUMP : BIG_TORSO), ...BIG_LEGS[pose]];
  return [...HEAD, ...(pose === 'jump' ? TORSO_JUMP : TORSO), ...LEGS[pose]];
}

const POSES: readonly HeroPose[] = ['stand', 'walkA', 'walkB', 'jump', 'dead'];

function buildSet(big: boolean): Record<HeroPose, SpriteDef> {
  return Object.fromEntries(POSES.map((p) => [p, build(big, p)])) as Record<HeroPose, SpriteDef>;
}

/** Hero sprites, facing right. Small is 12x16, big is 14x22. */
export const HERO: Record<'small' | 'big', Record<HeroPose, SpriteDef>> = {
  small: buildSet(false),
  big: buildSet(true),
};

// Grumble: a grumpy walking mushroom. A cap, W eye white, K pupil/mouth, T stem, D feet.
// All enemy sprites face right; drawEnemies mirrors them when they walk left.
export const WALKER: readonly SpriteDef[] = [
  [
    '....AAAA....',
    '..AAAAAAAA..',
    '.AAAAAAAAAA.',
    '.AWWAAAAWWA.',
    'AAWKAAAAWKAA',
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
    'AAWKAAAAWKAA',
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
