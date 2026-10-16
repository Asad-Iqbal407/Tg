/* Knockout Arena — static game data: punches, roster, difficulty, palettes, default bindings */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  /**
   * Punch table. Times are in seconds.
   *  wind   – wind-up before the strike
   *  strike – glove travels to the target; impact is resolved at the end of this phase
   *  hold   – glove stays extended
   *  rec    – recovery back to guard (cancel window opens at `cancel` * rec)
   *  range  – max centre-to-centre distance at which the punch can connect (metres)
   */
  BX.PUNCHES = {
    jab:       { id: 'jab',       label: 'Jab',         hand: 'lead', kind: 'straight', dmg: 4,  stam: 4,  range: 1.12, wind: 0.07, strike: 0.07, hold: 0.03, rec: 0.16, stun: 0.15, kb: 0.45, cancel: 0.45, back: 0.10 },
    cross:     { id: 'cross',     label: 'Cross',       hand: 'rear', kind: 'straight', dmg: 7,  stam: 7,  range: 1.16, wind: 0.11, strike: 0.08, hold: 0.04, rec: 0.22, stun: 0.24, kb: 0.90, cancel: 0.50, back: 0.12 },
    leadHook:  { id: 'leadHook',  label: 'Lead Hook',   hand: 'lead', kind: 'hook',     dmg: 9,  stam: 9,  range: 1.00, wind: 0.14, strike: 0.10, hold: 0.04, rec: 0.24, stun: 0.32, kb: 1.20, cancel: 0.55, back: 0.12 },
    rearHook:  { id: 'rearHook',  label: 'Rear Hook',   hand: 'rear', kind: 'hook',     dmg: 10, stam: 10, range: 1.02, wind: 0.16, strike: 0.10, hold: 0.04, rec: 0.26, stun: 0.34, kb: 1.40, cancel: 0.55, back: 0.12 },
    leadUpper: { id: 'leadUpper', label: 'Lead Uppercut', hand: 'lead', kind: 'upper',   dmg: 9,  stam: 9,  range: 0.90, wind: 0.14, strike: 0.09, hold: 0.04, rec: 0.26, stun: 0.34, kb: 0.90, cancel: 0.55, back: 0.10 },
    rearUpper: { id: 'rearUpper', label: 'Rear Uppercut', hand: 'rear', kind: 'upper',   dmg: 11, stam: 11, range: 0.92, wind: 0.16, strike: 0.10, hold: 0.04, rec: 0.28, stun: 0.38, kb: 1.10, cancel: 0.55, back: 0.10 },
    special:   { id: 'special',   label: 'FURY Punch',  hand: 'rear', kind: 'special',  dmg: 30, stam: 0,  range: 1.28, wind: 0.70, strike: 0.12, hold: 0.18, rec: 0.50, stun: 1.00, kb: 3.20, cancel: 1.00, back: 0.30, guardBreak: true },
  };
  BX.PUNCH_IDS = ['jab', 'cross', 'leadHook', 'rearHook', 'leadUpper', 'rearUpper'];

  BX.DIFFICULTY = [
    { id: 'rookie',   name: 'Rookie',   react: 0.55, aggression: 0.32, defense: 0.18, skill: 0.25, think: 0.34, dmg: 0.80 },
    { id: 'amateur',  name: 'Amateur',  react: 0.38, aggression: 0.48, defense: 0.38, skill: 0.45, think: 0.26, dmg: 0.95 },
    { id: 'pro',      name: 'Pro',      react: 0.28, aggression: 0.60, defense: 0.55, skill: 0.66, think: 0.19, dmg: 1.00 },
    { id: 'champion', name: 'Champion', react: 0.21, aggression: 0.72, defense: 0.74, skill: 0.88, think: 0.14, dmg: 1.08 },
  ];

  BX.SKINS = ['#f6d5b8', '#e8b98d', '#d39b6a', '#b57a4a', '#8d5a36', '#5e3a22', '#3b2418'];
  BX.HAIR_STYLES = [
    ['bald', 'Bald'], ['buzz', 'Buzz'], ['short', 'Short'], ['spiky', 'Spiky'], ['afro', 'Afro'],
    ['mohawk', 'Mohawk'], ['long', 'Long'], ['ponytail', 'Ponytail'], ['bun', 'Bun'],
  ];
  BX.HAIR_COLORS = ['#15110e', '#3a2616', '#6b4423', '#b8862b', '#e8d27a', '#a3261f', '#d8d8d8', '#3b5fd6', '#2fa36b', '#d84fb0'];
  BX.COLORS = ['#c1121f', '#1e5fd6', '#16a34a', '#f2b705', '#171717', '#f4f4f4', '#7c3aed', '#ff7a00', '#ec4899', '#0ea5a4'];
  BX.BUILDS = [['slim', 'Slim'], ['avg', 'Average'], ['heavy', 'Heavy']];

  BX.DEFAULT_LOOK = {
    name: 'YOU', skin: '#d39b6a', hair: 'short', hairColor: '#15110e',
    trunks: '#c1121f', trim: '#f4f4f4', gloves: '#c1121f', boots: '#171717',
    build: 'avg', stance: 'orthodox',
  };

  BX.STAT_DEFS = [
    ['power',   'Power',   'More damage per punch (+4% per level).'],
    ['speed',   'Speed',   'Faster punches and footwork (+3% per level).'],
    ['stamina', 'Stamina', 'Bigger stamina pool, quicker recovery (+5% per level).'],
    ['chin',    'Chin',    'Take less damage (-3.5% per level) and more health.'],
  ];
  BX.MAX_STAT = 10;

  BX.ROSTER = [
    {
      id: 'rick', name: 'Rookie Rick', nick: 'The Newcomer', diff: 0, style: 'brawler',
      desc: 'Fresh out of the gym. Swings a lot, defends little.',
      look: { name: 'RICK', skin: '#e8b98d', hair: 'buzz', hairColor: '#3a2616', trunks: '#1e5fd6', trim: '#f4f4f4', gloves: '#1e5fd6', boots: '#171717', build: 'avg', stance: 'orthodox' },
      stats: { power: 0, speed: 0, stamina: 0, chin: 0 },
    },
    {
      id: 'sofia', name: 'Slick Sofia', nick: 'The Ghost', diff: 1, style: 'outboxer',
      desc: 'Long jabs, clever footwork. Hard to pin down.',
      look: { name: 'SOFIA', skin: '#b57a4a', hair: 'ponytail', hairColor: '#15110e', trunks: '#7c3aed', trim: '#f2b705', gloves: '#7c3aed', boots: '#f4f4f4', build: 'slim', stance: 'orthodox' },
      stats: { power: 1, speed: 4, stamina: 3, chin: 1 },
    },
    {
      id: 'tomas', name: 'Tank Tomas', nick: 'The Wall', diff: 2, style: 'slugger',
      desc: 'Slow, heavy and nearly unmovable. One hook can end it.',
      look: { name: 'TOMAS', skin: '#d39b6a', hair: 'bald', hairColor: '#15110e', trunks: '#16a34a', trim: '#171717', gloves: '#171717', boots: '#171717', build: 'heavy', stance: 'orthodox' },
      stats: { power: 6, speed: 0, stamina: 2, chin: 6 },
    },
    {
      id: 'dee', name: 'Dancing Dee', nick: 'Lightning Feet', diff: 2, style: 'counter',
      desc: 'Slips everything, then punishes you for missing.',
      look: { name: 'DEE', skin: '#5e3a22', hair: 'afro', hairColor: '#15110e', trunks: '#ff7a00', trim: '#171717', gloves: '#ff7a00', boots: '#171717', build: 'slim', stance: 'southpaw' },
      stats: { power: 2, speed: 6, stamina: 5, chin: 2 },
    },
    {
      id: 'crusher', name: 'The Crusher', nick: 'Undisputed', diff: 3, style: 'pressure',
      desc: 'The champion. Relentless pressure, every punch type, no mercy.',
      look: { name: 'CRUSHER', skin: '#8d5a36', hair: 'mohawk', hairColor: '#a3261f', trunks: '#f2b705', trim: '#171717', gloves: '#f2b705', boots: '#171717', build: 'heavy', stance: 'southpaw' },
      stats: { power: 7, speed: 5, stamina: 6, chin: 6 },
    },
  ];

  BX.DEFAULT_SETTINGS = {
    volume: 0.8, sfx: true, music: true, shake: true, hints: true,
    camera: 'behind', quality: 'auto', batterySaver: false, rounds: 3, roundTime: 60, difficulty: 1,
    touch: 'auto', touchHand: 'right', haptics: true, fps: false, speech: true,
  };

  /** Rebindable actions (label shown in the controls screen). */
  BX.ACTIONS = [
    ['up', 'Step forward'], ['down', 'Step back'], ['left', 'Circle left'], ['right', 'Circle right'],
    ['jab', 'Jab (lead hand)'], ['cross', 'Cross (rear hand)'],
    ['leadHook', 'Lead hook'], ['rearHook', 'Rear hook'],
    ['leadUpper', 'Lead uppercut'], ['rearUpper', 'Rear uppercut'],
    ['block', 'Block (hold)'], ['crouch', 'Crouch / body shots (hold)'],
    ['dodge', 'Dodge dash (+direction)'], ['slipL', 'Slip left'], ['slipR', 'Slip right'],
    ['special', 'FURY punch'], ['taunt', 'Taunt'],
  ];

  BX.DEFAULT_BINDINGS = {
    solo: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      jab: ['KeyJ'], cross: ['KeyK'], leadHook: ['KeyU'], rearHook: ['KeyI'], leadUpper: ['KeyN'], rearUpper: ['KeyM'],
      block: ['Space', 'KeyL'], crouch: ['KeyC'], dodge: ['ShiftLeft', 'ShiftRight'],
      slipL: ['KeyQ'], slipR: ['KeyE'], special: ['KeyF'], taunt: ['KeyT'],
    },
    p1: {
      up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      jab: ['KeyF'], cross: ['KeyG'], leadHook: ['KeyR'], rearHook: ['KeyT'], leadUpper: ['KeyV'], rearUpper: ['KeyB'],
      block: ['Space'], crouch: ['KeyC'], dodge: ['ShiftLeft'],
      slipL: ['KeyQ'], slipR: ['KeyE'], special: ['KeyX'], taunt: [],
    },
    p2: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      jab: ['Comma', 'Numpad1'], cross: ['Period', 'Numpad2'], leadHook: ['Semicolon', 'Numpad4'], rearHook: ['Quote', 'Numpad5'],
      leadUpper: ['BracketLeft', 'Numpad7'], rearUpper: ['BracketRight', 'Numpad8'],
      block: ['Slash', 'Numpad0'], crouch: ['Backslash', 'Numpad3'], dodge: ['ShiftRight', 'NumpadEnter'],
      slipL: [], slipR: [], special: ['Enter', 'NumpadAdd'], taunt: [],
    },
  };

  BX.BINDING_SETS = [['solo', 'Single player'], ['p1', 'Versus — Player 1'], ['p2', 'Versus — Player 2']];

  /** Pretty names for KeyboardEvent.code values. */
  BX.keyName = (code) => {
    if (!code) return '—';
    const map = {
      Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Semicolon: ';',
      Quote: "'", BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Enter: 'Enter',
      NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', Minus: '-', Equal: '=', Backquote: '`', Tab: 'Tab',
      Backspace: 'Bksp', MouseLeft: 'Mouse L', MouseRight: 'Mouse R',
    };
    if (map[code]) return map[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  };
})();
