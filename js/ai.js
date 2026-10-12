/* Knockout Arena — AI opponent. Produces the same "intent" objects a human does. */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  const STYLES = {
    brawler:  { range: 0.95, aggr: 1.15, def: 0.6, circle: 0.3, body: 0.12, keepAway: false, counter: 0.3,
      combos: [['jab', 'cross'], ['leadHook', 'rearHook'], ['rearHook'], ['jab', 'jab', 'cross'], ['cross', 'leadHook']] },
    outboxer: { range: 1.1, aggr: 0.95, def: 1.0, circle: 1.0, body: 0.1, keepAway: true, counter: 0.45,
      combos: [['jab'], ['jab', 'jab'], ['jab', 'cross'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'leadHook']] },
    slugger:  { range: 0.98, aggr: 0.8, def: 0.8, circle: 0.25, body: 0.25, keepAway: false, counter: 0.35,
      combos: [['rearHook'], ['leadHook', 'rearHook'], ['rearUpper'], ['cross', 'leadHook'], ['jab', 'rearHook']] },
    counter:  { range: 1.1, aggr: 0.65, def: 1.35, circle: 0.8, body: 0.1, keepAway: true, counter: 0.85,
      combos: [['jab', 'cross'], ['cross'], ['jab', 'cross', 'leadHook'], ['leadHook', 'rearUpper']] },
    pressure: { range: 0.95, aggr: 1.2, def: 1.1, circle: 0.45, body: 0.3, keepAway: false, counter: 0.5,
      combos: [['jab', 'cross', 'leadHook'], ['jab', 'jab', 'cross', 'leadHook', 'rearUpper'], ['leadHook', 'rearHook', 'leadUpper'], ['jab', 'cross'], ['cross', 'leadUpper', 'rearHook']] },
    dummy:    { range: 1.0, aggr: 0, def: 0, circle: 0.2, body: 0, keepAway: false, counter: 0, combos: [['jab']] },
  };
  BX.AI_STYLES = STYLES;

  function weighted(opts) {
    let total = 0;
    for (const k in opts) total += opts[k];
    let r = Math.random() * total;
    for (const k in opts) { r -= opts[k]; if (r <= 0) return k; }
    return Object.keys(opts)[0];
  }

  class AI {
    constructor(fighter, opts) {
      this.f = fighter;
      this.d = BX.DIFFICULTY[BX.clamp(opts.diff, 0, BX.DIFFICULTY.length - 1)];
      this.styleName = opts.style || 'brawler';
      this.s = STYLES[this.styleName] || STYLES.brawler;
      this.passive = this.styleName === 'dummy';
      this.plan = [];
      this.planWait = 0;
      this.think = BX.rand(0.2, 0.6);
      this.circleDir = BX.chance(0.5) ? 1 : -1;
      this.circleT = BX.rand(1, 2.5);
      this.seenId = 0; this.seenT = 0; this.threat = null; this.decided = true; this.reactJitter = 1;
      this.defending = null;
      this.cover = 0;
      this.mode = 'approach'; this.modeT = 0;
      this.crouchHold = 0;
      this.counterT = 0;
      this.trainerT = 3.5; this.trainerNext = 'jab';
    }

    reset() {
      this.plan.length = 0; this.defending = null; this.cover = 0; this.threat = null; this.decided = true;
      this.mode = 'approach'; this.think = BX.rand(0.3, 0.8); this.crouchHold = 0; this.counterT = 0;
    }

    /** The game tells us when our defence worked / we got hit. */
    onDefended() {
      if (this.passive) return;
      if (BX.chance(this.s.counter * (0.4 + this.d.skill * 0.7))) {
        this.plan = [{ name: BX.chance(0.5) ? 'cross' : 'jab' }];
        if (BX.chance(this.d.skill * 0.6)) this.plan.push({ name: BX.pick(['leadHook', 'cross']) });
        this.planWait = 0;
        this.think = 0.5;
      }
    }
    onHit() {
      if (this.passive) return;
      this.plan.length = 0;
      if (BX.chance(0.25 + this.d.defense * 0.5)) this.cover = BX.rand(0.5, 1.1) * (0.7 + this.d.defense);
      if (BX.chance(0.35)) { this.mode = 'recover'; this.modeT = BX.rand(0.4, 0.9); }
    }

    chooseDefense(oa, dist, remaining) {
      const f = this.f, skill = this.d.skill, kind = oa.def.kind;
      let c;
      if (kind === 'special') c = BX.chance(0.55 + skill * 0.3) ? 'dash' : 'retreat';
      else if (kind === 'straight') c = weighted({ block: 0.5, slip: 0.2 + 0.4 * skill, dash: 0.05 + 0.15 * skill, retreat: 0.1 });
      else if (kind === 'hook') c = weighted({ block: 0.5, duck: 0.15 + 0.4 * skill, dash: 0.1 });
      else c = weighted({ block: 0.45, dash: 0.15 + 0.25 * skill, retreat: 0.25 });
      if (c === 'slip' && f.stamina < 5) c = 'block';
      if (c === 'dash' && f.stamina < 10) c = 'block';
      const side = BX.chance(0.5) ? 'slipL' : 'slipR';
      switch (c) {
        case 'block': this.defending = { type: 'block', wait: 0, t: remaining + 0.3 }; break;
        case 'duck': this.defending = { type: 'duck', wait: 0, t: remaining + 0.22 }; break;
        case 'slip': this.defending = { type: 'slip', side, wait: Math.max(0, remaining - 0.13), t: remaining + 0.2, fired: false }; break;
        case 'dash': this.defending = { type: 'dash', wait: Math.max(0, remaining - (kind === 'special' ? 0.5 : 0.17)), t: remaining + 0.3, fired: false }; break;
        default: this.defending = { type: 'retreat', wait: 0, t: 0.5 };
      }
      this.defending.kind = kind;
    }

    startCombo(dist, opp) {
      const f = this.f, s = this.s, d = this.d;
      if (f.fury >= 99.9 && dist < 1.2 && BX.chance(0.35 + d.skill * 0.5)) { this.plan = [{ name: 'special' }]; return; }
      const maxLen = 1 + Math.round(d.skill * 4);
      let combo = BX.pick(s.combos).slice(0, maxLen);
      // pad to at least one punch
      if (!combo.length) combo = ['jab'];
      const body = BX.chance(s.body * d.skill * 1.5);
      this.plan = [];
      if (body) { this.crouchHold = 0.45 + combo.length * 0.45; this.plan.push({ name: null, wait: 0.2 }); }
      combo.forEach((n, i) => this.plan.push({ name: n, wait: i === 0 ? 0 : BX.rand(0, 0.06) }));
      this.planWait = 0;
    }

    update(dt, opp, game) {
      const f = this.f, d = this.d, s = this.s;
      const intent = { moveF: 0, moveS: 0, block: false, crouch: false, actions: [] };
      if (f.locked || f.isDown || !game.fightActive || opp.isDown) return intent;

      const dx = opp.pos.x - f.pos.x, dz = opp.pos.z - f.pos.z;
      const dist = Math.hypot(dx, dz);

      this.circleT -= dt;
      if (this.circleT <= 0) { this.circleDir = -this.circleDir; this.circleT = BX.rand(1.2, 3); }
      if (this.cover > 0) this.cover -= dt;
      if (this.crouchHold > 0) this.crouchHold -= dt;

      /* ---------- spot incoming punches ---------- */
      const oa = opp.act;
      if (oa && oa.type === 'punch') {
        if (oa.id !== this.seenId) {
          this.seenId = oa.id; this.seenT = 0; this.threat = oa; this.decided = false;
          this.reactJitter = BX.rand(0.7, 1.25);
        }
      } else if (this.threat && !(oa && oa.type === 'punch')) this.threat = null;
      if (this.threat && !this.decided && !this.passive) {
        this.seenT += dt;
        if (this.seenT >= d.react * this.reactJitter) {
          this.decided = true;
          const remaining = oa.impactT - oa.t;
          if (remaining > 0.04 && dist <= oa.def.range + 0.35 && BX.chance(Math.min(0.97, d.defense * s.def))) {
            this.chooseDefense(oa, dist, remaining);
            this.plan.length = 0;
          }
        }
      }

      /* ---------- execute defence ---------- */
      const df = this.defending;
      if (df) {
        df.t -= dt;
        if (df.wait > 0) { df.wait -= dt; intent.block = df.type === 'block'; }
        else {
          switch (df.type) {
            case 'block': intent.block = true; break;
            case 'duck': intent.crouch = true; break;
            case 'slip': if (!df.fired && f._canStart()) { intent.actions.push(df.side); df.fired = true; } break;
            case 'dash':
              if (!df.fired && f._canStart()) { intent.actions.push('dodge'); intent.moveF = -1; intent.moveS = df.kind === 'hook' ? this.circleDir : 0; df.fired = true; }
              break;
            case 'retreat': intent.moveF = -1; intent.moveS = this.circleDir * 0.5; intent.block = true; break;
            default: break;
          }
        }
        if (df.t <= 0) this.defending = null;
        if (this.defending) return intent;
      }

      /* ---------- scripted trainer dummy ---------- */
      if (this.passive) {
        this.trainerT -= dt;
        intent.moveS = this.circleDir * 0.25;
        if (dist > 1.5) intent.moveF = 0.6; else if (dist < 0.95) intent.moveF = -0.5;
        if (game.trainerAttacks && this.trainerT <= 0 && dist < 1.3 && f._canStart()) {
          intent.actions.push(this.trainerNext);
          this.trainerNext = this.trainerNext === 'jab' ? 'cross' : 'jab';
          this.trainerT = BX.rand(3.2, 5);
        }
        return intent;
      }

      /* ---------- executing an attack plan ---------- */
      if (this.cover > 0 && !this.plan.length) intent.block = true;
      if (this.crouchHold > 0) intent.crouch = true;
      if (this.plan.length) {
        this.planWait -= dt;
        const step = this.plan[0];
        if (this.planWait <= 0) {
          if (step.name === null) { this.plan.shift(); this.planWait = step.wait || 0; }
          else if (dist > BX.PUNCHES[step.name].range + 0.45) { this.plan.length = 0; }       // target escaped
          else if (f._canStart()) {
            intent.actions.push(step.name);
            this.plan.shift();
            this.planWait = (this.plan[0] && this.plan[0].wait) || 0;
            if (!this.plan.length) { this.mode = BX.chance(0.45 + (s.keepAway ? 0.3 : 0)) ? 'recover' : 'circle'; this.modeT = BX.rand(0.35, 0.9); }
          }
        }
        // keep closing the distance a little while attacking
        if (dist > s.range) intent.moveF = 0.5;
        return intent;
      }

      /* ---------- decision making ---------- */
      this.think -= dt;
      this.modeT -= dt;
      if (this.think <= 0) {
        this.think = d.think * BX.rand(0.7, 1.4);
        const st = f.stamina / f.maxStamina;
        if (st < 0.2 && BX.chance(0.7)) { this.mode = 'recover'; this.modeT = BX.rand(0.8, 1.6); }
        else if (this.mode === 'recover' && this.modeT > 0 && st < 0.5) { /* keep recovering */ }
        else if (dist > s.range + 0.25) this.mode = 'approach';
        else {
          const pAtt = BX.clamp(d.aggression * s.aggr * (0.45 + st * 0.7), 0.08, 0.95);
          if (BX.chance(pAtt)) { this.startCombo(dist, opp); this.mode = 'circle'; }
          else { this.mode = BX.chance(0.6) ? 'circle' : 'recover'; this.modeT = BX.rand(0.4, 1.0); }
        }
      }

      switch (this.mode) {
        case 'approach':
          intent.moveF = dist > s.range ? 1 : 0;
          intent.moveS = this.circleDir * s.circle * 0.4;
          if (dist <= s.range + 0.05) this.mode = 'circle';
          break;
        case 'recover':
          intent.moveF = dist < 1.9 ? -0.7 : 0;
          intent.moveS = this.circleDir * s.circle;
          intent.block = dist < 1.7;
          if (this.modeT <= 0) this.mode = 'circle';
          break;
        default: // circle
          intent.moveS = this.circleDir * s.circle;
          if (dist < s.range - 0.14 && s.keepAway) intent.moveF = -0.8;
          else if (dist > s.range + 0.1) intent.moveF = 0.6;
          break;
      }
      if (this.cover > 0) intent.block = true;
      return intent;
    }
  }

  BX.AI = AI;
})();
