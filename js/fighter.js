/* Knockout Arena — Fighter: combat state machine + fully procedural animation (2-bone IK arms/legs, foot planting) */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const T = THREE;
  const D = BX.Model.D;
  const UP = new T.Vector3(0, 1, 0);
  const RING_HALF = 2.72;
  BX.RING_HALF = RING_HALF;

  // ---- scratch objects (avoid per-frame allocations) ----
  const v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), v4 = new T.Vector3();
  const vElbow = new T.Vector3(), vEnd = new T.Vector3(), vPole = new T.Vector3(), vShoulder = new T.Vector3();
  const mBasis = new T.Matrix4(), mTmp = new T.Matrix4();
  const xA = new T.Vector3(), yA = new T.Vector3(), zA = new T.Vector3();

  class Spring {
    constructor(k, c) { this.k = k; this.c = c; this.p = 0; this.v = 0; }
    step(dt) { this.v += (-this.k * this.p - this.c * this.v) * dt; this.p += this.v * dt; }
    kick(v) { this.v += v; }
    reset() { this.p = 0; this.v = 0; }
  }

  /** Analytic two-bone IK. Writes elbow/knee and end positions. */
  function solve2Bone(root, target, l1, l2, pole, outMid, outEnd) {
    v4.subVectors(target, root);
    let dist = v4.length();
    if (dist < 1e-5) { v4.set(0, 0, 1); dist = 1e-5; } else v4.multiplyScalar(1 / dist);
    const maxD = (l1 + l2) * 0.995, minD = Math.abs(l1 - l2) + 0.03;
    const cd = dist > maxD ? maxD : dist < minD ? minD : dist;
    const a = (l1 * l1 - l2 * l2 + cd * cd) / (2 * cd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    vPole.copy(pole).addScaledVector(v4, -pole.dot(v4));
    if (vPole.lengthSq() < 1e-6) vPole.set(0, -1, 0).addScaledVector(v4, v4.y);
    if (vPole.lengthSq() < 1e-6) vPole.set(1, 0, 0);
    vPole.normalize();
    outMid.copy(root).addScaledVector(v4, a).addScaledVector(vPole, h);
    outEnd.copy(root).addScaledVector(v4, cd);
    return dist - cd; // positive when the target was out of reach
  }

  function placeLimb(obj, a, b) {
    obj.position.addVectors(a, b).multiplyScalar(0.5);
    v3.subVectors(b, a).normalize();
    obj.quaternion.setFromUnitVectors(UP, v3);
  }

  function orientGlove(glove, wrist, dir, hintBlend) {
    // y along forearm, knuckles roughly forward / up
    yA.copy(dir).normalize();
    v3.set(0, 1 - hintBlend, hintBlend).normalize();
    xA.crossVectors(v3, yA);
    if (xA.lengthSq() < 1e-6) xA.set(1, 0, 0);
    xA.normalize();
    zA.crossVectors(xA, yA).normalize();
    mBasis.makeBasis(xA, yA, zA);
    glove.quaternion.setFromRotationMatrix(mBasis);
    glove.position.copy(wrist);
  }

  const STANCE_TWIST = -0.5;
  // glove ("wrist") rest positions in chest-local space
  const GUARD = { lead: [0.15, 0.44, 0.34], rear: [-0.1, 0.4, 0.24] };
  const BLOCKP = { lead: [0.1, 0.5, 0.25], rear: [-0.08, 0.49, 0.22] };
  const RELAX = { lead: [0.27, -0.14, 0.1], rear: [-0.27, -0.14, 0.1] };
  const STANCE_FEET = [[0.17, 0.27], [-0.17, -0.2]]; // [lead, rear] (x, z) in body units
  const LUNGE = { straight: 0.12, hook: 0.1, upper: 0.08, special: 0.28 };

  class Fighter {
    constructor(look, opts) {
      opts = opts || {};
      this.role = opts.role || 'fighter';
      this.slot = opts.slot || 0;
      this.stats = Object.assign({ power: 0, speed: 0, stamina: 0, chin: 0 }, opts.stats || {});
      this.isAI = false;
      this.ai = null;
      this.punchTimeMul = 1;
      this.root = new T.Group();
      this.rig = null;
      this.t = Math.random() * 10;

      // springs for hit reactions (lateral ones are in "world" sense: + = fighter's left)
      this.sp = {
        headPitch: new Spring(150, 13), headYaw: new Spring(150, 13), headRoll: new Spring(150, 13),
        lean: new Spring(120, 11), twist: new Spring(120, 11), sway: new Spring(110, 11),
      };
      this.pose = { hipY: D.hipY, px: 0, pz: 0, twist: STANCE_TWIST, lean: 0.1, roll: 0, block: 0, fall: 0, e: { lead: 0, rear: 0 }, win: 0, lose: 0, intro: 0 };
      this.hand = { lead: new T.Vector3(), rear: new T.Vector3() };
      this.handInit = false;
      this.feet = [{ x: 0, z: 0, lift: 0, step: null }, { x: 0, z: 0, lift: 0, step: null }];
      this.mChest = new T.Matrix4();
      this.mPelvis = new T.Matrix4();
      this.vel = new T.Vector3();
      this.setLook(opts.look || look);
      this.reset(0, 0, 0);
    }

    /* ------------------------------------------------------------------ build / reset */
    setLook(look) {
      this.look = look;
      if (this.rig) {
        this.root.remove(this.rig.body);
        BX.disposeRig(this.rig);   // deferred: the replacement acquires the shared shader programs first
      }
      this.rig = BX.Model.build(look, this.role, BX.Perf && BX.Perf.current);
      this.root.add(this.rig.body);
      this.mx = look.stance === 'southpaw' ? -1 : 1;
      this.rig.body.scale.x = this.mx;
      this.size = this.rig.dims.h * (this.role === 'ref' ? 1.0 : 1);
      this.root.scale.setScalar(this.size);
      this.handInit = false;
      this.recalcStats();
    }

    recalcStats() {
      const s = this.stats;
      this.powerMul = 1 + 0.04 * s.power;
      this.speedMul = 1 + 0.03 * s.speed;
      this.maxStamina = 100 * (1 + 0.05 * s.stamina);
      this.maxHealth = Math.round((100 + 3 * s.chin) * this.rig.dims.health);
      this.dmgTaken = 1 - 0.035 * s.chin;
      this.regenMul = 1 + 0.05 * s.stamina;
    }

    reset(x, z, yaw) {
      this.root.position.set(x, 0, z);
      this.root.rotation.y = yaw || 0;
      this.vel.set(0, 0, 0);
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.fury = 0;
      this.act = null;
      this.buf = [];
      this.blockT = 0;
      this.blocking = false;
      this.crouchAmt = 0;
      this.invuln = 0;
      this.counterT = 0;
      this.staminaDelay = 0;
      this.locked = false;
      this.forcedPose = null;
      this.ouch = 0;
      this.bruiseAmt = 0;
      this.guardFlash = 0;
      this.furyReadyShown = false;
      this.lastIntent = { moveF: 0, moveS: 0 };
      this.fall = 0;
      this.pose.fall = 0;
      this.downYawOffset = 0;
      for (const k of Object.keys(this.sp)) this.sp[k].reset();
      this.snapFeet();
      this.handInit = false;
      this.refTarget = new T.Vector3(x, 0, z);
      this.refLook = new T.Vector3(0, 0, 1);
      this.refMode = 'idle';
      this.refCount = 0;
    }

    /** Between rounds: partial recovery, back to guard. */
    refresh(healthFrac, staminaFrac) {
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * healthFrac);
      this.stamina = Math.min(this.maxStamina, this.stamina + this.maxStamina * staminaFrac);
      this.act = null; this.buf = []; this.blockT = 0; this.crouchAmt = 0; this.invuln = 0; this.vel.set(0, 0, 0);
      this.fall = 0; this.pose.fall = 0; this.forcedPose = null; this.downYawOffset = 0;
    }

    get pos() { return this.root.position; }
    get yaw() { return this.root.rotation.y; }
    get isDown() { const a = this.act; return !!a && (a.type === 'fall' || a.type === 'down' || a.type === 'getup'); }
    get isStanding() { return !this.isDown; }
    get isDucking() { return this.crouchAmt > 0.55; }
    get isLow() { return this.crouchAmt > 0.5; }
    get isBlocking() { return this.blockT > 0.07 && !this.act; }
    get healthFrac() { return this.health / this.maxHealth; }

    forwardTo(opp, out) {
      out = out || new T.Vector3();
      out.set(opp.pos.x - this.pos.x, 0, opp.pos.z - this.pos.z);
      const l = out.length();
      if (l < 1e-4) return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      return out.multiplyScalar(1 / l);
    }

    /* world/body conversions for XZ (includes yaw, scale and southpaw mirror) */
    bodyToWorldXZ(lx, lz, out) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), s2 = this.size, mlx = this.mx * lx;
      out.x = this.pos.x + s2 * (c * mlx + s * lz);
      out.z = this.pos.z + s2 * (-s * mlx + c * lz);
      return out;
    }
    worldToBodyXZ(wx, wz, out) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = (wx - this.pos.x) / this.size, dz = (wz - this.pos.z) / this.size;
      out.x = this.mx * (c * dx - s * dz);
      out.z = s * dx + c * dz;
      return out;
    }

    snapFeet() {
      const o = { x: 0, z: 0 };
      for (let i = 0; i < 2; i++) {
        this.bodyToWorldXZ(STANCE_FEET[i][0], STANCE_FEET[i][1], o);
        this.feet[i].x = o.x; this.feet[i].z = o.z; this.feet[i].lift = 0; this.feet[i].step = null;
      }
    }

    getHeadWorld(out) { return this.rig.headCenter.getWorldPosition(out); }
    getTorsoWorld(out) { return this.rig.torsoCenter.getWorldPosition(out); }
    getGloveWorld(hand, out) { return this.rig.arms[hand].fist.getWorldPosition(out); }

    /* ------------------------------------------------------------------ combat: starting actions */
    queue(name) {
      this.buf.push({ name, ttl: 0.24 });
      if (this.buf.length > 2) this.buf.shift();
    }

    _canStart() {
      if (this.locked || this.role !== 'fighter') return false;
      const a = this.act;
      if (!a) return true;
      if (a.type === 'punch') return a.t >= a.cancelT;
      if (a.type === 'slip' || a.type === 'dash') return a.t >= a.dur * 0.6;
      return false;
    }

    startPunch(def, game) {
      if (this.stamina < 1 && def.stam > 0) { if (game) game.onGassed(this); return false; }
      const stFrac = this.stamina / this.maxStamina;
      const tm = (1 / this.speedMul) * (1 + (1 - Math.min(1, stFrac * 2)) * 0.22) * this.punchTimeMul;
      const base = def.wind + def.strike + def.hold;
      this.act = {
        type: 'punch', def, t: 0, tm, hand: def.hand,
        impactT: (def.wind + def.strike) * tm,
        dur: (base + def.rec) * tm,
        cancelT: (base + def.rec * def.cancel) * tm,
        resolved: false, connected: false, low: this.isLow, lunged: false, e: 0, deficit: 0,
        id: ++Fighter._punchId,
      };
      this.stamina = Math.max(0, this.stamina - def.stam);
      this.staminaDelay = 0.55;
      this.blockT = 0;
      if (game) game.onPunchStart(this, this.act);
      return true;
    }

    startSlip(side, game) {
      if (this.stamina < 3) return false;
      this.stamina -= 4;
      this.staminaDelay = 0.4;
      this.act = { type: 'slip', side, t: 0, dur: 0.36, inv: 0.25, id: ++Fighter._punchId };
      this.blockT = 0;
      if (game) game.onDodgeStart(this, 'slip');
      return true;
    }

    startDash(intent, opp, game) {
      if (this.stamina < 8) return false;
      this.stamina -= 13;
      this.staminaDelay = 0.7;
      const f = this.forwardTo(opp, v1);
      const r = v2.set(-f.z, 0, f.x);
      let dx = f.x * intent.moveF + r.x * intent.moveS, dz = f.z * intent.moveF + r.z * intent.moveS;
      let len = Math.hypot(dx, dz);
      if (len < 0.3) { dx = -f.x; dz = -f.z; len = 1; }
      dx /= len; dz /= len;
      this.vel.set(dx * 6.4, 0, dz * 6.4);
      // body-lean direction for the animation, measured in the fighter's frame
      const fwd = dx * f.x + dz * f.z, side = dx * r.x + dz * r.z;
      this.act = { type: 'dash', t: 0, dur: 0.4, inv: 0.27, fwd, side, id: ++Fighter._punchId };
      this.blockT = 0;
      if (game) game.onDodgeStart(this, 'dash');
      return true;
    }

    startTaunt(game) {
      this.act = { type: 'taunt', t: 0, dur: 1.5 };
      this.blockT = 0;
      if (game) game.onTaunt(this);
      return true;
    }

    _start(name, intent, opp, game) {
      const def = BX.PUNCHES[name];
      if (def && name !== 'special') return this.startPunch(def, game);
      switch (name) {
        case 'special':
          if (this.fury >= 99.9) {
            if (this.startPunch(BX.PUNCHES.special, game)) { this.fury = 0; game.onFuryUsed(this); return true; }
            return false;
          }
          game.onFuryDenied(this);
          return false;
        case 'slipL': return this.startSlip(+1, game);
        case 'slipR': return this.startSlip(-1, game);
        case 'dodge': return this.startDash(intent, opp, game);
        case 'taunt': return this.startTaunt(game);
        default: return false;
      }
    }

    /* ------------------------------------------------------------------ combat: being hit */
    takeHit(info) {
      const d = info.dir; // unit vector attacker -> defender (xz)
      const def = info.def;
      const p = BX.clamp(info.power, 0.15, 1.6);
      if (info.blocked) {
        this.vel.addScaledVector(d, def.kb * 0.35);
        this.guardFlash = 1;
        this.sp.lean.kick(-2.2 * p);
        if (info.guardBreak) {
          this.act = { type: 'guardbreak', t: 0, dur: 0.95 };
          this.blockT = 0;
          this.sp.headPitch.kick(-5);
          this.sp.lean.kick(-5);
        }
        return;
      }
      const side = (def.hand === 'lead' ? 1 : -1) * (info.att ? info.att.mx : 1);
      this.act = { type: 'hit', t: 0, dur: info.stun, kind: def.kind, low: info.low };
      this.buf.length = 0;
      this.blockT = 0;
      this.vel.addScaledVector(d, info.kb);
      this.ouch = 1;
      this.bruiseAmt = Math.min(1, this.bruiseAmt + (info.low ? 0.01 : 0.045) * p);
      const sp = this.sp;
      switch (def.kind) {
        case 'hook':
          sp.headYaw.kick(side * 11 * p); sp.headRoll.kick(-side * 6 * p); sp.twist.kick(side * 3 * p); sp.sway.kick(side * 1.2 * p);
          break;
        case 'upper':
          sp.headPitch.kick(-14 * p); sp.lean.kick(-4 * p); sp.headYaw.kick(side * 2);
          break;
        case 'special':
          sp.headPitch.kick(-18); sp.headYaw.kick(side * 14); sp.lean.kick(-9); sp.twist.kick(side * 6);
          break;
        default:
          sp.headPitch.kick(-9 * p); sp.lean.kick(-3.2 * p); sp.headYaw.kick(side * 3 * p);
      }
      if (info.low) { sp.lean.kick(9 * p); sp.headPitch.kick(8 * p); }
      if (info.counter) { sp.headPitch.kick(-4); }
    }

    startFall(game, info) {
      this.act = { type: 'fall', t: 0, dur: 0.62, back: info && info.forward ? -1 : 1, roll: (Math.random() - 0.5) * 0.7 };
      this.blockT = 0;
      this.buf.length = 0;
      this.crouchAmt = 0;
      this.downYawOffset = (Math.random() - 0.5) * 0.9;
    }

    getUp() {
      if (!this.act || this.act.type !== 'down') return false;
      this.act = { type: 'getup', t: 0, dur: 1.15 };
      return true;
    }

    /* ------------------------------------------------------------------ per-frame logic */
    update(dt, intent, opp, game) {
      if (this.role !== 'fighter') return;
      this.t += dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.counterT > 0) this.counterT -= dt;
      if (this.staminaDelay > 0) this.staminaDelay -= dt;
      if (this.ouch > 0) this.ouch = Math.max(0, this.ouch - dt * 3.2);
      if (this.guardFlash > 0) this.guardFlash = Math.max(0, this.guardFlash - dt * 4);
      for (const b of this.buf) b.ttl -= dt;
      while (this.buf.length && this.buf[0].ttl <= 0) this.buf.shift();

      intent = intent || { moveF: 0, moveS: 0, block: false, crouch: false, actions: [] };
      this.lastIntent = intent;
      const down = this.isDown;

      // ---- tick the running action
      let a = this.act;
      if (a) {
        a.t += dt;
        switch (a.type) {
          case 'punch': this._tickPunch(dt, opp, game); break;
          case 'slip': case 'dash': case 'hit': case 'guardbreak': case 'taunt':
            if (a.t >= a.dur) this.act = null;
            break;
          case 'fall':
            if (a.t >= a.dur) { this.act = { type: 'down', t: 0 }; game.onFighterDown(this); }
            break;
          case 'getup':
            if (a.t >= a.dur) { this.act = null; this.invuln = Math.max(this.invuln, 1.0); game.onFighterUp(this); }
            break;
          default: break;
        }
      }

      // ---- buffer new inputs
      if (!down && !this.locked) {
        for (const name of intent.actions) this.queue(name);
        if (this.buf.length && this._canStart()) {
          const b = this.buf.shift();
          this._start(b.name, intent, opp, game);
        }
      } else if (this.locked) {
        this.buf.length = 0;
      }

      // ---- block / crouch holds
      a = this.act;
      const wantBlock = intent.block && !this.locked && !a && this.stamina > 0.5;
      if (wantBlock) this.blockT += dt; else this.blockT = Math.max(0, this.blockT - dt * 6);
      this.blocking = this.blockT > 0.07 && !a;
      const wantCrouch = intent.crouch && !this.locked && (!a || a.type === 'punch') && !down;
      this.crouchAmt = BX.damp(this.crouchAmt, wantCrouch ? 1 : 0, 11, dt);

      // ---- stamina regeneration
      if (!down) {
        let regen = 13;
        if (this.staminaDelay > 0) regen = 0;
        else if (this.blocking) regen = 4;
        else if (Math.abs(intent.moveF) + Math.abs(intent.moveS) > 0.1) regen = 8;
        this.stamina = Math.min(this.maxStamina, this.stamina + regen * this.regenMul * dt);
      }

      // ---- movement
      this._move(dt, intent, opp, game);
    }

    _tickPunch(dt, opp, game) {
      const a = this.act, def = a.def;
      if (!a.lunged && a.t >= def.wind * a.tm * 0.45) {
        a.lunged = true;
        const f = this.forwardTo(opp, v1);
        const mag = def.kind === 'special' ? 3.2 : def.id === 'cross' ? 1.9 : def.kind === 'straight' ? 1.4 : 1.15;
        this.vel.addScaledVector(f, mag);
      }
      if (!a.resolved && a.t >= a.impactT) {
        a.resolved = true;
        game.resolvePunch(this, opp, a);
      }
      if (a.t >= a.dur) this.act = null;
    }

    _move(dt, intent, opp, game) {
      const pos = this.pos;
      const a = this.act;
      const down = this.isDown;

      // ---- facing
      const dx = opp.pos.x - pos.x, dz = opp.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (!down && !this.forcedPose) {
        const target = Math.atan2(dx, dz);
        this.root.rotation.y = BX.dampAngle(this.root.rotation.y, target, 16, dt);
      }

      // ---- voluntary movement (orbit around the opponent + step in/out)
      const mayMove = !this.locked && !down && (!a || a.type === 'punch');
      if (mayMove && (intent.moveF !== 0 || intent.moveS !== 0)) {
        let speed = 2.15 * this.speedMul * (0.72 + 0.28 * Math.min(1, this.stamina / (this.maxStamina * 0.4)));
        if (this.blocking) speed *= 0.62;
        if (this.crouchAmt > 0.5) speed *= 0.6;
        if (a) speed *= 0.3;
        let nd = dist;
        const mf = intent.moveF;
        nd -= mf * speed * (mf < 0 ? 0.8 : 1) * dt;
        nd = Math.max(0.66, nd);
        const ang = (intent.moveS * speed * 0.95 * dt) / Math.max(nd, 0.8);
        // rotate the opponent->me vector about Y: positive angle = toward my right
        let px = -(dx) / (dist || 1), pz = -(dz) / (dist || 1);
        const c = Math.cos(ang), s = Math.sin(ang);
        const rx = px * c + pz * s, rz = -px * s + pz * c;
        pos.x = opp.pos.x + rx * nd;
        pos.z = opp.pos.z + rz * nd;
      }

      // ---- velocity (lunges, knock-back, dashes)
      if (this.vel.lengthSq() > 1e-6) {
        pos.x += this.vel.x * dt;
        pos.z += this.vel.z * dt;
        const fr = Math.exp(-(a && a.type === 'dash' ? 4.2 : 7.5) * dt);
        this.vel.multiplyScalar(fr);
      }

      // ---- ring ropes
      const lim = RING_HALF - 0.05;
      if (pos.x > lim) { pos.x = lim; if (this.vel.x > 0) this.vel.x *= -0.2; }
      if (pos.x < -lim) { pos.x = -lim; if (this.vel.x < 0) this.vel.x *= -0.2; }
      if (pos.z > lim) { pos.z = lim; if (this.vel.z > 0) this.vel.z *= -0.2; }
      if (pos.z < -lim) { pos.z = -lim; if (this.vel.z < 0) this.vel.z *= -0.2; }
    }

    /* ------------------------------------------------------------------ animation */
    /** Extension curve of a punch in [-back .. 1]. */
    _punchPhase(a) {
      const d = a.def, tm = a.tm, t = a.t;
      const w = d.wind * tm, s = d.strike * tm, h = d.hold * tm, r = d.rec * tm;
      if (t < w) return { name: 'wind', p: t / w, e: -d.back * BX.ease.outQuad(t / w) };
      if (t < w + s) { const p = (t - w) / s; return { name: 'strike', p, e: BX.lerp(-d.back, 1, BX.ease.outCubic(p)) }; }
      if (t < w + s + h) return { name: 'hold', p: (t - w - s) / h, e: 1 };
      const p = Math.min(1, (t - w - s - h) / r);
      return { name: 'rec', p, e: 1 - BX.ease.inOutQuad(p) };
    }

    _shoulderBody(hand, out) {
      const sx = hand === 'lead' ? 1 : -1;
      out.set(sx * D.shX * this.rig.dims.w, D.shY, 0).applyMatrix4(this.mChest);
      return out;
    }

    animate(dt, opp, game) {
      if (this.role === 'ref') { this._animateRef(dt, game); return; }
      const R = this.rig, P = this.pose, act = this.act, mx = this.mx, w = R.dims.w;
      const sp = this.sp;
      for (const k in sp) sp[k].step(dt);

      const moving = Math.min(1, Math.hypot(this.lastIntent.moveF, this.lastIntent.moveS) + this.vel.length() * 0.2);
      const cr = this.crouchAmt;
      P.block = BX.damp(P.block, this.blocking || this.blockT > 0.02 ? 1 : 0, 18, dt);

      // ---------------- targets ----------------
      const bob = Math.sin(this.t * (5.4 + moving * 3)) * (0.011 + moving * 0.012);
      let tHipY = D.hipY - cr * 0.27 + bob;
      let tPx = Math.sin(this.t * 2.7) * 0.01, tPz = cr * 0.06;
      let tTwist = STANCE_TWIST, tLean = 0.1 + cr * 0.42 + P.block * 0.12, tRoll = 0;
      let tHeadPitch = 0.05 - cr * 0.12, tHeadRoll = 0;
      let rate = 16;
      const ext = { lead: 0, rear: 0 };
      const poleLead = v1.set(0.3, -1, -0.3), poleRear = v2.set(-0.3, -1, -0.3);
      let fallTarget = 0, fallBack = 1, fallRoll = 0;
      let mode = 'guard'; // hand mode: guard | block | relax | up | taunt | down

      if (this.forcedPose === 'win') {
        P.win = BX.damp(P.win, 1, 6, dt); mode = 'up';
        tHipY += Math.abs(Math.sin(this.t * 6)) * 0.06; tTwist = -0.15; tLean = 0.0; tHeadPitch = -0.15;
      } else if (this.forcedPose === 'lose') {
        mode = 'relax'; tLean = 0.38; tHeadPitch = 0.5; tTwist = -0.2; tHipY -= 0.04;
      } else if (this.forcedPose === 'intro') {
        mode = 'taunt'; tHipY += Math.abs(Math.sin(this.t * 5)) * 0.04; tTwist = -0.35;
      } else if (this.forcedPose === 'corner') {
        mode = 'relax'; tLean = 0.05; tTwist = -0.2;
      }

      if (act) {
        switch (act.type) {
          case 'punch': {
            const ph = this._punchPhase(act);
            act.e = ph.e;
            const k = BX.clamp(ph.e, -0.35, 1);
            const d = act.def;
            const sgn = d.hand === 'lead' ? -1 : 1;
            ext[d.hand] = k;
            const env = Math.sin(Math.PI * BX.clamp(act.t / act.dur, 0, 1));
            const lunge = LUNGE[d.kind] || 0.1;
            tPz += lunge * k + BX.clamp(act.deficit, 0, 0.3) * Math.max(0, k);
            tLean += 0.14 * k;
            if (d.kind === 'straight') tTwist += (d.hand === 'lead' ? -0.28 : 0.95) * k;
            else if (d.kind === 'hook') tTwist += sgn * 0.78 * k;
            else if (d.kind === 'upper') { tTwist += sgn * 0.42 * k; tHipY -= 0.13 * env; tLean += 0.1 * env; }
            else tTwist += 0.9 * k - 0.2 * (1 - k);
            if (d.kind === 'hook') { tRoll += -sgn * 0.1 * k; tPx += -sgn * 0.04 * k; }
            if (d.kind === 'special') { tHipY -= 0.12 * Math.max(0, -k) * 3; tLean += -0.4 * Math.max(0, -k) * 1.2; rate = 22; }
            if (d.hand === 'lead') poleLead.set(d.kind === 'hook' ? 1 : 0.4, d.kind === 'hook' ? 0.05 : -0.9, -0.2);
            else poleRear.set(d.kind === 'hook' ? -1 : -0.4, d.kind === 'hook' ? 0.05 : -0.9, -0.2);
            rate = Math.max(rate, 26);
            break;
          }
          case 'slip': {
            const s = Math.sin(Math.PI * BX.clamp(act.t / act.dur, 0, 1));
            const bs = act.side * mx; // body-space side (+1 = body-left)
            tPx += bs * 0.17 * s; tRoll += -bs * 0.34 * s; tHeadRoll += bs * 0.18 * s; tLean += 0.1 * s; tHipY -= 0.06 * s;
            rate = 24;
            break;
          }
          case 'dash': {
            const s = Math.sin(Math.PI * BX.clamp(act.t / act.dur, 0, 1));
            tLean += (act.fwd > 0.3 ? 0.35 : -0.25) * s; tRoll += -act.side * mx * 0.25 * s; tHipY -= 0.1 * s;
            rate = 22;
            break;
          }
          case 'hit': {
            mode = 'guard';
            tLean += 0.0; tHipY -= 0.04;
            break;
          }
          case 'guardbreak': {
            mode = 'relax'; tLean = 0.3; tHipY -= 0.06; tHeadPitch = 0.3;
            break;
          }
          case 'taunt': {
            mode = 'taunt'; tHipY += Math.abs(Math.sin(act.t * 7)) * 0.05; tTwist = -0.2;
            break;
          }
          case 'fall': {
            const p = BX.clamp(act.t / act.dur, 0, 1);
            fallTarget = BX.ease.inQuad(p); fallBack = act.back; fallRoll = act.roll;
            mode = 'down'; rate = 30;
            break;
          }
          case 'down': {
            fallTarget = 1; fallBack = this._lastFallBack || 1; mode = 'down';
            break;
          }
          case 'getup': {
            const p = BX.clamp(act.t / act.dur, 0, 1);
            fallTarget = 1 - BX.ease.inOutCubic(p); mode = p > 0.6 ? 'guard' : 'down'; rate = 12;
            break;
          }
          default: break;
        }
        if (act.type === 'fall') this._lastFallBack = act.back, this._lastFallRoll = act.roll;
      }
      if (act && act.type === 'down') fallRoll = this._lastFallRoll || 0;
      if (act && act.type === 'getup') { fallBack = this._lastFallBack || 1; fallRoll = (this._lastFallRoll || 0) * (1 - BX.ease.inOutCubic(act.t / act.dur)); }
      if (!act && P.block > 0.5) mode = 'block';

      // ---------------- smoothing into pose ----------------
      P.hipY = BX.damp(P.hipY, tHipY, rate, dt);
      P.px = BX.damp(P.px, tPx, rate, dt);
      P.pz = BX.damp(P.pz, tPz, rate, dt);
      P.twist = BX.damp(P.twist, tTwist, rate, dt);
      P.lean = BX.damp(P.lean, tLean, rate, dt);
      P.roll = BX.damp(P.roll, tRoll, rate, dt);
      P.fall = BX.damp(P.fall, fallTarget, fallTarget > P.fall ? 40 : 12, dt);
      if (act && act.type === 'fall') P.fall = fallTarget;
      if (act && act.type === 'getup') P.fall = fallTarget;
      if (act && act.type === 'down') P.fall = 1;
      this.fall = P.fall;
      P.headPitch = BX.damp(P.headPitch || 0, tHeadPitch, 14, dt);
      P.headRoll = BX.damp(P.headRoll || 0, tHeadRoll, 14, dt);

      // ---------------- apply pose to the skeleton ----------------
      const body = R.body;
      // knockdown pitch (rigid body rotation about the feet)
      body.rotation.set(-P.fall * fallBack * (Math.PI / 2 - 0.04), 0, P.fall * fallRoll * 0.4, 'YXZ');
      body.position.set(0, P.fall * 0.17, P.fall * -0.1 * fallBack);

      const sway = sp.sway.p * mx;
      R.pelvis.position.set(P.px * mx + sway * 0.1, P.hipY, P.pz);
      const pelvisYaw = (P.twist + sp.twist.p * mx) * 0.5;
      R.pelvis.rotation.set(0, pelvisYaw, P.roll * 0.5, 'YXZ');
      R.chest.rotation.set(P.lean + sp.lean.p, (P.twist + sp.twist.p * mx) - pelvisYaw, P.roll * 0.5, 'YXZ');
      // head looks at the opponent: cancel the chest twist, plus reaction springs
      const headYawBase = -(P.twist + sp.twist.p * mx) * 0.85 + 0.05;
      R.head.rotation.set(P.headPitch + sp.headPitch.p - P.lean * 0.45, headYawBase + sp.headYaw.p * mx, P.headRoll * 1 + sp.headRoll.p * mx, 'YXZ');
      if (this.forcedPose === 'lose') R.head.rotation.x += 0.2;

      R.pelvis.updateMatrix(); R.chest.updateMatrix();
      this.mPelvis.copy(R.pelvis.matrix);
      this.mChest.multiplyMatrices(R.pelvis.matrix, R.chest.matrix);

      // ---------------- arms ----------------
      const ua = D.ua, fa = D.fa;
      let aimFinal = null;
      for (const hand of ['lead', 'rear']) {
        const sx = hand === 'lead' ? 1 : -1;
        const arm = R.arms[hand];
        const base = mode === 'block' ? BLOCKP[hand] : mode === 'relax' || mode === 'down' ? RELAX[hand] : GUARD[hand];
        let tgt = v3.set(base[0] * (w * 0.9 + 0.1), base[1], base[2]);
        let k = 14;
        const pole = hand === 'lead' ? poleLead : poleRear;
        if (mode === 'up') {
          tgt.set(sx * 0.27, 0.86 + Math.sin(this.t * 7 + sx) * 0.05, 0.08); k = 10; pole.set(sx * 0.6, -0.2, -0.4);
        } else if (mode === 'taunt') {
          const ph = this.t * 8 + (hand === 'lead' ? 0 : Math.PI);
          tgt.set(sx * 0.3, 0.7 + Math.sin(ph) * 0.12, 0.18 + Math.cos(ph) * 0.05); k = 12; pole.set(sx * 0.7, -0.3, -0.2);
        } else if (mode === 'down') {
          tgt.set(sx * 0.3, -0.05, -0.04); k = 10;
        } else if (mode === 'block') {
          pole.set(sx * 0.15, -1, 0.1);
        }
        // guard "breathing"
        if (mode === 'guard' || mode === 'block') {
          tgt.y += Math.sin(this.t * 5.4 + sx) * 0.012;
          tgt.z += Math.sin(this.t * 2.7 + sx * 2) * 0.01;
        }
        tgt.applyMatrix4(this.mChest);

        let wrist = this.hand[hand];
        if (!this.handInit) wrist.copy(tgt);
        const punching = act && act.type === 'punch' && act.def.hand === hand;
        if (punching && opp) {
          const aim = this._punchTarget(act, hand, tgt, opp);
          wrist.lerp(aim, 1 - Math.exp(-70 * dt));
          k = 0;
        } else {
          // returning to guard blends quickly but not instantly
          wrist.lerp(tgt, 1 - Math.exp(-k * dt));
        }

        this._shoulderBody(hand, vShoulder);
        const over = solve2Bone(vShoulder, wrist, ua, fa, pole, vElbow, vEnd);
        placeLimb(arm.upper, vShoulder, vElbow);
        placeLimb(arm.fore, vElbow, vEnd);
        v3.subVectors(vEnd, vElbow).normalize();
        const hint = BX.clamp((Math.abs(v3.y) - 0.35) / 0.4, 0, 1);
        orientGlove(arm.glove, vEnd, v3, hint);
        if (punching) act.deficit = BX.damp(act.deficit, Math.max(0, over), 20, dt);
      }
      this.handInit = true;

      // ---------------- legs ----------------
      this._animateLegs(dt, moving);

      // ---------------- face / skin / glow ----------------
      this._animateFace(dt);

      this.root.updateMatrixWorld(true);
    }

    /** Where the wrist should be for the given punch at the current phase (body space). */
    _punchTarget(act, hand, guard, opp) {
      const ph = this._punchPhase(act);
      const d = act.def;
      const sx = hand === 'lead' ? 1 : -1;
      const R = this.rig;

      // aim point: the opponent's head (standing) or torso (crouched/low), in my body space
      const aimObj = act.low ? opp.rig.torsoCenter : opp.rig.headCenter;
      aimObj.getWorldPosition(v1);
      R.body.worldToLocal(v1);
      if (d.kind === 'upper') v1.y -= 0.1;
      // glove sits ~0.2 in front of the wrist; stop short of the target surface
      this._shoulderBody(hand, vShoulder);
      v2.subVectors(v1, vShoulder);
      const dist = v2.length();
      const reach = (D.ua + D.fa) * 0.99;
      const stop = 0.2 + (act.low ? 0.1 : 0.12);
      let want = Math.max(0.15, dist - stop);
      v2.multiplyScalar(1 / (dist || 1));
      want = Math.min(want, reach);
      const aim = v4.copy(vShoulder).addScaledVector(v2, want);
      aim.z = Math.max(aim.z, vShoulder.z + 0.12);
      const aimC = new T.Vector3().copy(aim);
      const g = guard;
      const out = this._pt || (this._pt = new T.Vector3());

      if (d.kind === 'straight') {
        out.lerpVectors(g, aimC, ph.e);
      } else if (d.kind === 'hook') {
        const ctrl = v3.lerpVectors(g, aimC, 0.45);
        ctrl.x += sx * 0.42; ctrl.y += 0.02; ctrl.z -= 0.02;
        const e = ph.e, ie = 1 - e;
        out.set(0, 0, 0).addScaledVector(g, ie * ie).addScaledVector(ctrl, 2 * ie * e).addScaledVector(aimC, e * e);
      } else if (d.kind === 'upper') {
        const ctrl = v3.lerpVectors(g, aimC, 0.3);
        ctrl.y -= 0.3; ctrl.z += 0.02;
        const e = ph.e, ie = 1 - e;
        out.set(0, 0, 0).addScaledVector(g, ie * ie).addScaledVector(ctrl, 2 * ie * e).addScaledVector(aimC, e * e);
      } else {
        // overhand haymaker: cock the glove high behind the head, then smash down through the target
        const W = v3.copy(vShoulder).add(v2.set(-sx * 0.05, 0.42, -0.32));
        if (ph.name === 'wind') out.lerpVectors(g, W, BX.ease.inOutCubic(ph.p));
        else if (ph.name === 'strike') {
          const t = BX.ease.inCubic(ph.p), it = 1 - t;
          const ctrl = v2.lerpVectors(W, aimC, 0.5); ctrl.y += 0.28;
          out.set(0, 0, 0).addScaledVector(W, it * it).addScaledVector(ctrl, 2 * it * t).addScaledVector(aimC, t * t);
        } else if (ph.name === 'hold') out.copy(aimC);
        else out.lerpVectors(aimC, g, BX.ease.inOutQuad(ph.p));
      }
      return out;
    }

    _animateLegs(dt, moving) {
      const R = this.rig, w = R.dims.w, limb = R.dims.limb;
      const P = this.pose;
      const lying = P.fall > 0.08;
      const speed = this.vel.length();
      const cr = this.crouchAmt;
      const o = { x: 0, z: 0 }, o2 = { x: 0, z: 0 };

      for (let i = 0; i < 2; i++) {
        const f = this.feet[i], other = this.feet[1 - i];
        const sx = i === 0 ? 1 : -1;
        const st = STANCE_FEET[i];
        this.bodyToWorldXZ(st[0] * (1 + cr * 0.3), st[1] + (i === 0 ? cr * 0.08 : -cr * 0.05), o);
        const dx = o.x - f.x, dz = o.z - f.z;
        const d = Math.hypot(dx, dz);
        const thresh = 0.17 + (speed > 2 ? 0.1 : 0);
        if (!f.step && !lying && d > thresh && (!other.step || d > 0.6)) {
          const lead = Math.min(0.3, moving * 0.12 + speed * 0.04);
          const dirx = d > 0 ? dx / d : 0, dirz = d > 0 ? dz / d : 0;
          f.step = { t: 0, dur: 0.15 / Math.min(1.6, this.speedMul), fx: f.x, fz: f.z, tx: o.x + dirx * lead, tz: o.z + dirz * lead };
        }
        if (f.step) {
          const s = f.step;
          s.t += dt;
          const p = Math.min(1, s.t / s.dur);
          const e = BX.ease.inOutQuad(p);
          f.x = BX.lerp(s.fx, s.tx, e); f.z = BX.lerp(s.fz, s.tz, e);
          f.lift = Math.sin(Math.PI * p) * 0.1;
          if (p >= 1) { f.step = null; f.lift = 0; }
        }
        if (lying) { f.x = o.x; f.z = o.z; f.step = null; f.lift = 0; }
      }

      const leg = R.legs;
      const pole = v2;
      for (let i = 0; i < 2; i++) {
        const name = i === 0 ? 'lead' : 'rear';
        const sx = i === 0 ? 1 : -1;
        const f = this.feet[i];
        // foot position in body space
        this.worldToBodyXZ(f.x, f.z, o2);
        let fx = o2.x, fz = o2.z, fy = D.ankle + f.lift;
        if (lying) {
          // legs relax a little apart while lying
          fx = sx * 0.2; fz = 0.04 - (i === 0 ? -0.05 : 0.08); fy = D.ankle + 0.02;
        }
        const ankle = v3.set(fx, fy, fz);
        // hip joint (body space)
        const hip = vShoulder.set(sx * D.hipHalf * w, -0.05, 0).applyMatrix4(this.mPelvis);
        pole.set(sx * 0.25, 0.1, 1);
        const over = solve2Bone(hip, ankle, D.thigh, D.shin, pole, vElbow, vEnd);
        placeLimb(leg[name].thigh, hip, vElbow);
        placeLimb(leg[name].shin, vElbow, vEnd);
        const boot = leg[name].boot;
        boot.position.set(vEnd.x, vEnd.y - 0.01, vEnd.z);
        boot.rotation.set(-f.lift * 3.5, (i === 0 ? -0.18 : -0.62) , 0, 'YXZ');
      }
    }

    _animateFace(dt) {
      const F = this.rig.face, M = this.rig.mats;
      const ouch = this.ouch;
      const exert = this.act && this.act.type === 'punch' ? 1 : 0;
      const squint = BX.clamp(ouch * 1.2 + (this.act && this.act.type === 'hit' ? 0.3 : 0) + this.bruiseAmt * 0.5 + (this.blocking ? 0.35 : 0), 0, 1);
      F.eyes.scale.y = 1 - squint * 0.7;       // eyes/pupils/brows are left+right pairs merged into one mesh each
      F.pupils.scale.y = 1 - squint * 0.6;
      F.brows.position.y = 0.222 - squint * 0.012;
      const open = BX.clamp(ouch * 1.3 + exert * 0.6 + (this.stamina < this.maxStamina * 0.25 ? 0.5 + Math.sin(this.t * 9) * 0.2 : 0), 0, 1);
      F.lips.scale.y = 0.008 + open * 0.02;
      F.guard.scale.y = open * 0.016;
      F.guard.visible = open > 0.03;
      // bruises
      const b = this.bruiseAmt;
      M.bruise.opacity = Math.min(0.75, b * 1.3);
      M.flush.opacity = Math.min(0.5, 0.1 * (1 - this.healthFrac) + b * 0.4);
      const sw = 1 + b * 0.35;
      // marks are only submitted to the GPU once they are visible
      const showB = M.bruise.opacity > 0.02;
      F.bruiseA.visible = showB; F.bruiseB.visible = showB;
      if (showB) { F.bruiseA.scale.setScalar(sw); F.bruiseB.scale.setScalar(sw); }
      F.noseFlush.visible = M.flush.opacity > 0.02;
      // fury aura
      const ready = this.fury >= 99.9;
      M.glove.emissive.setRGB(ready ? 0.5 + 0.5 * Math.sin(this.t * 10) : 0, ready ? 0.25 + 0.2 * Math.sin(this.t * 10) : 0, 0);
      if (this.guardFlash > 0) M.glove.emissive.setRGB(0.3 * this.guardFlash, 0.3 * this.guardFlash, 0.5 * this.guardFlash);
    }

    /* ------------------------------------------------------------------ referee */
    _animateRef(dt, game) {
      const R = this.rig, P = this.pose, w = R.dims.w;
      this.t += dt;
      const pos = this.pos;
      // walk toward target
      v1.set(this.refTarget.x - pos.x, 0, this.refTarget.z - pos.z);
      const dist = v1.length();
      const moving = dist > 0.08;
      if (moving) {
        const sp = Math.min(dist * 3, 2.6);
        pos.x += (v1.x / dist) * sp * dt;
        pos.z += (v1.z / dist) * sp * dt;
      }
      const look = Math.atan2(this.refLook.x - pos.x, this.refLook.z - pos.z);
      this.root.rotation.y = BX.dampAngle(this.root.rotation.y, look, 6, dt);

      const bob = Math.sin(this.t * (moving ? 9 : 2)) * (moving ? 0.02 : 0.005);
      P.hipY = BX.damp(P.hipY, D.hipY + 0.04 + bob, 10, dt);
      P.lean = BX.damp(P.lean, 0.06, 6, dt);
      P.twist = BX.damp(P.twist, 0, 6, dt);
      R.body.rotation.set(0, 0, 0);
      R.body.position.set(0, 0, 0);
      R.pelvis.position.set(0, P.hipY, 0);
      R.pelvis.rotation.set(0, 0, 0);
      R.chest.rotation.set(P.lean, 0, 0);
      R.head.rotation.set(0.05, 0, 0);
      R.pelvis.updateMatrix(); R.chest.updateMatrix();
      this.mPelvis.copy(R.pelvis.matrix);
      this.mChest.multiplyMatrices(R.pelvis.matrix, R.chest.matrix);

      // arms
      let swing = 0;
      if (this.refMode === 'count') swing = Math.max(0, Math.sin(this.t * Math.PI * 1.0 + 0.2)) ; // chop every second
      for (const hand of ['lead', 'rear']) {
        const sx = hand === 'lead' ? 1 : -1;
        const tgt = v3.set(sx * 0.26, -0.02, 0.2);
        const pole = vPole.set(sx * 0.5, -1, -0.2).clone();
        if (this.refMode === 'count' && hand === 'rear') {
          tgt.set(-0.22, 0.45 - swing * 0.55, 0.35); pole.set(-0.6, -0.3, -0.2);
        } else if (this.refMode === 'raise' && hand === 'rear') {
          tgt.set(-0.3, 0.8, 0.1);
        } else if (this.refMode === 'wave') {
          tgt.set(sx * 0.35, 0.2 + Math.sin(this.t * 6 + sx) * 0.1, 0.3);
        } else if (this.refMode === 'raise' && hand === 'lead') {
          tgt.set(0.35, 0.1, 0.2);
        }
        tgt.applyMatrix4(this.mChest);
        const wrist = this.hand[hand];
        if (!this.handInit) wrist.copy(tgt);
        wrist.lerp(tgt, 1 - Math.exp(-16 * dt));
        this._shoulderBody(hand, vShoulder);
        solve2Bone(vShoulder, wrist, D.ua, D.fa, pole, vElbow, vEnd);
        const arm = R.arms[hand];
        placeLimb(arm.upper, vShoulder, vElbow);
        placeLimb(arm.fore, vElbow, vEnd);
        v3.subVectors(vEnd, vElbow).normalize();
        orientGlove(arm.glove, vEnd, v3, 0.5);
      }
      this.handInit = true;
      this._animateLegs(dt, moving ? 1 : 0);
      this.root.updateMatrixWorld(true);
    }

    /** Referee: stand at (x,z), look at (lx,lz). */
    refGoto(x, z, lx, lz) {
      this.refTarget.set(x, 0, z);
      this.refLook.set(lx, 0, lz);
    }

    /** Put the fighter back in a neutral state at a position without touching health / fury. */
    place(x, z, yaw) {
      this.root.position.set(x, 0, z);
      this.root.rotation.y = yaw;
      this.vel.set(0, 0, 0);
      this.act = null; this.buf = []; this.blockT = 0; this.blocking = false; this.crouchAmt = 0;
      this.fall = 0; this.pose.fall = 0; this.forcedPose = null; this.invuln = 0; this.counterT = 0; this.ouch = 0;
      this.downYawOffset = 0;
      for (const k of Object.keys(this.sp)) this.sp[k].reset();
      this.snapFeet();
      this.handInit = false;
    }

    /** Make the fighter ready for the next frame/menu: call after moving the root externally. */
    teleport(x, z, yaw) {
      this.root.position.set(x, 0, z);
      if (yaw != null) this.root.rotation.y = yaw;
      this.snapFeet();
      this.vel.set(0, 0, 0);
    }
  }
  Fighter._punchId = 0;

  BX.Fighter = Fighter;
})();
