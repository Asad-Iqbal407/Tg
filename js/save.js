'use strict';
// Persistent progression: wallet, upgrades, skins, achievements, XP rank, daily streak.
const SAVE_KEY = 'superpip_save_v1';

const SHOP = [
  { id: 'lives', name: 'Extra Heart', desc: '+1 starting life in every stage', icon: 'heart', max: 3, cost: [150, 350, 700] },
  { id: 'startBig', name: 'Sun Berry Start', desc: 'Begin every stage already powered up', icon: 'berry', max: 1, cost: [450] },
  { id: 'magnet', name: 'Coin Magnet', desc: 'Pulls nearby coins toward you (bigger each level)', icon: 'magnet', max: 3, cost: [200, 450, 900] },
  { id: 'shield', name: 'Bubble Shield', desc: 'A bubble absorbs the first hit of each stage', icon: 'shield', max: 1, cost: [550] },
  { id: 'boots', name: 'Cloud Boots', desc: 'Double jump at any time', icon: 'boots', max: 1, cost: [800] },
  { id: 'timer', name: 'Hourglass', desc: '+60 seconds on every stage clock', icon: 'clock', max: 2, cost: [150, 300] },
];

const SKINS = [
  { id: 'fox', name: 'Pip', cost: 0, fur: '#f4892f', fur2: '#c9611b', belly: '#fff3df', hood: '#23b0a0', hood2: '#16867a', scarf: '#ffd23f', boot: '#6b3f2a' },
  { id: 'arctic', name: 'Frost Pip', cost: 600, fur: '#eef5ff', fur2: '#aec4e0', belly: '#ffffff', hood: '#4a78d8', hood2: '#3358a8', scarf: '#8fe6ff', boot: '#2f4170' },
  { id: 'shadow', name: 'Shadow Pip', cost: 1000, fur: '#433b5c', fur2: '#2a2440', belly: '#c4b5ff', hood: '#7c3fd2', hood2: '#5a2a9e', scarf: '#ff4f9a', boot: '#1b1828' },
  { id: 'berry', name: 'Berry Pip', cost: 1400, fur: '#ff8fb6', fur2: '#e0628f', belly: '#fff0f6', hood: '#7bd65a', hood2: '#55a83a', scarf: '#ffffff', boot: '#7a2d4c' },
  { id: 'golden', name: 'Golden Pip', cost: 2500, fur: '#ffd043', fur2: '#dc9f12', belly: '#fff8d6', hood: '#e2473f', hood2: '#a8302a', scarf: '#ffffff', boot: '#8a4a12' },
];

const RANKS = ['Sprout', 'Scout', 'Wanderer', 'Ranger', 'Pathfinder', 'Trailblazer', 'Hero', 'Champion', 'Legend', 'Mythic'];

const ACHIEVEMENTS = [
  { id: 'first', name: 'First Steps', desc: 'Clear your first stage', reward: 100, prog: (d) => [d.stats.cleared, 1] },
  { id: 'stomp25', name: 'Bouncy Boots', desc: 'Stomp 25 enemies', reward: 150, prog: (d) => [d.stats.stomps, 25] },
  { id: 'stomp200', name: 'Stomp Master', desc: 'Stomp 200 enemies', reward: 500, prog: (d) => [d.stats.stomps, 200] },
  { id: 'coins500', name: 'Coin Collector', desc: 'Collect 500 coins in total', reward: 200, prog: (d) => [d.stats.coins, 500] },
  { id: 'coins3000', name: 'Treasure Hoarder', desc: 'Collect 3,000 coins in total', reward: 600, prog: (d) => [d.stats.coins, 3000] },
  { id: 'bricks', name: 'Brick Breaker', desc: 'Smash 50 bricks', reward: 150, prog: (d) => [d.stats.bricks, 50] },
  { id: 'pyro', name: 'Ember Thrower', desc: 'Defeat 20 enemies with fireballs', reward: 200, prog: (d) => [d.stats.fireKills, 20] },
  { id: 'shell', name: 'Shell Shock', desc: 'Defeat 10 enemies with kicked shells', reward: 200, prog: (d) => [d.stats.shellKills, 10] },
  { id: 'medal10', name: 'Medal Hunter', desc: 'Find 10 star medals', reward: 300, prog: (d) => [Save.medalCount(), 10] },
  { id: 'medalAll', name: 'Completionist', desc: 'Find every star medal', reward: 1500, prog: (d) => [Save.medalCount(), STAGES.length * 3] },
  { id: 'stars15', name: 'Star Student', desc: 'Earn 15 stage stars', reward: 400, prog: (d) => [Save.starCount(), 15] },
  { id: 'boss', name: 'Magmaw Tamer', desc: 'Defeat the boss of Magmaw Keep', reward: 600, prog: (d) => [d.stats.bossWins, 1] },
  { id: 'combo', name: 'Combo King', desc: 'Earn a 1UP from a stomp combo', reward: 300, prog: (d) => [d.stats.comboUps, 1] },
  { id: 'flawless', name: 'Untouchable', desc: 'Clear a stage without being hit', reward: 250, prog: (d) => [d.stats.flawless, 1] },
  { id: 'speed', name: 'Speedrunner', desc: 'Clear a stage under its par time', reward: 250, prog: (d) => [d.stats.parClears, 1] },
  { id: 'shopper', name: 'Big Spender', desc: 'Buy 5 upgrades or skins', reward: 250, prog: (d) => [d.stats.purchases, 5] },
  { id: 'daily', name: 'Dedicated', desc: 'Reach a 3-day daily reward streak', reward: 200, prog: (d) => [d.daily.best, 3] },
  { id: 'rank5', name: 'Pathfinder', desc: 'Reach adventurer rank 5', reward: 500, prog: (d) => [d.level, 5] },
];

const DAILY_REWARDS = [50, 75, 100, 150, 200, 300, 600];

const Save = {
  data: null,

  defaults() {
    return {
      coins: 0, xp: 0, level: 1,
      stages: {},
      upgrades: { lives: 0, startBig: 0, magnet: 0, shield: 0, boots: 0, timer: 0 },
      skins: ['fox'], skin: 'fox',
      ach: {},
      stats: { stomps: 0, coins: 0, bricks: 0, fireKills: 0, shellKills: 0, deaths: 0, cleared: 0, bossWins: 0, comboUps: 0, flawless: 0, parClears: 0, purchases: 0, jumps: 0, playTime: 0 },
      daily: { last: null, streak: 0, best: 0 },
      settings: { music: 0.5, sfx: 0.7, touch: 'auto', shake: true },
    };
  },

  load() {
    const def = this.defaults();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = {
          ...def, ...d,
          upgrades: { ...def.upgrades, ...(d.upgrades || {}) },
          stats: { ...def.stats, ...(d.stats || {}) },
          daily: { ...def.daily, ...(d.daily || {}) },
          settings: { ...def.settings, ...(d.settings || {}) },
        };
        return;
      }
    } catch (e) { /* storage unavailable or corrupt */ }
    this.data = def;
  },

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },

  reset() {
    const settings = this.data.settings;
    this.data = this.defaults();
    this.data.settings = settings;
    this.save();
  },

  stage(id) {
    if (!this.data.stages[id]) this.data.stages[id] = { cleared: false, stars: [false, false, false], medals: [false, false, false], best: 0, bestTime: 0 };
    return this.data.stages[id];
  },

  stat(name, n = 1) { this.data.stats[name] = (this.data.stats[name] || 0) + n; },

  medalCount() {
    let n = 0;
    for (const id in this.data.stages) n += this.data.stages[id].medals.filter(Boolean).length;
    return n;
  },
  starCount() {
    let n = 0;
    for (const id in this.data.stages) n += this.data.stages[id].stars.filter(Boolean).length;
    return n;
  },

  isUnlocked(i) {
    const st = STAGES[i];
    if (st.requireMedals) return this.medalCount() >= st.requireMedals;
    if (i === 0) return true;
    // previous non-bonus stage must be cleared
    for (let j = i - 1; j >= 0; j--) if (!STAGES[j].requireMedals) return this.stage(STAGES[j].id).cleared;
    return true;
  },

  skin() { return SKINS.find((s) => s.id === this.data.skin) || SKINS[0]; },

  // XP & rank
  xpFor(level) { return 600 + (level - 1) * 400; },
  rankName(level = this.data.level) { return RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))]; },
  addXP(n) {
    const ups = [];
    this.data.xp += n;
    while (this.data.xp >= this.xpFor(this.data.level)) {
      this.data.xp -= this.xpFor(this.data.level);
      this.data.level++;
      const reward = 50 * this.data.level;
      this.data.coins += reward;
      ups.push({ level: this.data.level, reward });
    }
    return ups;
  },

  // Shop
  upgradeCost(item) {
    const lvl = this.data.upgrades[item.id] || 0;
    return lvl >= item.max ? null : item.cost[lvl];
  },
  buyUpgrade(id) {
    const item = SHOP.find((s) => s.id === id);
    const cost = this.upgradeCost(item);
    if (cost == null || this.data.coins < cost) return false;
    this.data.coins -= cost;
    this.data.upgrades[id]++;
    this.stat('purchases');
    this.save();
    return true;
  },
  buySkin(id) {
    const s = SKINS.find((k) => k.id === id);
    if (!s || this.data.skins.includes(id) || this.data.coins < s.cost) return false;
    this.data.coins -= s.cost;
    this.data.skins.push(id);
    this.data.skin = id;
    this.stat('purchases');
    this.save();
    return true;
  },

  // Achievements
  achState(a) { return this.data.ach[a.id] || 'locked'; }, // locked | ready | claimed
  checkAchievements() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (this.data.ach[a.id]) continue;
      const [v, goal] = a.prog(this.data);
      if (v >= goal) { this.data.ach[a.id] = 'ready'; fresh.push(a); }
    }
    if (fresh.length) this.save();
    return fresh;
  },
  claimAchievement(id) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || this.data.ach[id] !== 'ready') return 0;
    this.data.ach[id] = 'claimed';
    this.data.coins += a.reward;
    this.save();
    return a.reward;
  },
  unclaimedCount() { return Object.values(this.data.ach).filter((v) => v === 'ready').length; },

  // Daily streak
  dailyAvailable() { return this.data.daily.last !== U.today(); },
  dailyNextDay() {
    const d = this.data.daily;
    if (!d.last) return 1;
    const gap = U.daysBetween(d.last, U.today());
    return gap === 1 ? (d.streak % 7) + 1 : gap === 0 ? d.streak : 1;
  },
  claimDaily() {
    if (!this.dailyAvailable()) return 0;
    const day = this.dailyNextDay();
    const reward = DAILY_REWARDS[day - 1];
    const d = this.data.daily;
    d.streak = day; d.last = U.today();
    const gapStreak = (d.chain || 0);
    d.chain = day === 1 ? 1 : gapStreak + 1;
    d.best = Math.max(d.best, d.chain);
    this.data.coins += reward;
    this.save();
    return reward;
  },
};
