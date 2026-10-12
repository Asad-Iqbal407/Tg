/* Knockout Arena — particle effects (impact sparks, sweat, dust) and the camera director */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const T = THREE;

  /* ------------------------------------------------------------------ particles */
  const FX = {
    pool: [], flashes: [], scene: null, tex: null,

    init(scene) {
      FX.scene = scene;
      const geo = new T.SphereGeometry(1, 6, 4);
      for (let i = 0; i < 90; i++) {
        const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
        m.visible = false;
        m.userData = { vel: new T.Vector3(), life: 0, max: 1, grav: 6, size: 0.03 };
        scene.add(m);
        FX.pool.push(m);
      }
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,220,150,0.7)'); r.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      FX.tex = new T.CanvasTexture(c);
      for (let i = 0; i < 6; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: FX.tex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: false }));
        s.visible = false;
        s.userData = { life: 0, max: 0.2, size: 1 };
        scene.add(s);
        FX.flashes.push(s);
      }
    },

    clear() {
      for (const p of FX.pool) p.visible = false;
      for (const s of FX.flashes) s.visible = false;
    },

    spawn(pos, vel, color, size, life, grav) {
      let p = null;
      for (const q of FX.pool) if (!q.visible) { p = q; break; }
      if (!p) return;
      p.visible = true;
      p.position.copy(pos);
      p.material.color.set(color);
      p.material.opacity = 1;
      p.scale.setScalar(size);
      const u = p.userData;
      u.vel.copy(vel); u.life = life; u.max = life; u.size = size; u.grav = grav == null ? 6 : grav;
    },

    flash(pos, size, color) {
      let s = null;
      for (const q of FX.flashes) if (!q.visible) { s = q; break; }
      if (!s) return;
      s.visible = true; s.position.copy(pos);
      s.material.color.set(color || 0xffffff);
      s.userData.life = 0.18; s.userData.max = 0.18; s.userData.size = size;
      s.scale.setScalar(size * 0.4);
      s.material.opacity = 1;
    },

    /** Hit burst: sparks + sweat spray in the punch direction. */
    impact(pos, dir, power, kind) {
      const n = Math.round(6 + power * 12);
      const v = new T.Vector3();
      for (let i = 0; i < n; i++) {
        v.set(BX.rand(-1, 1), BX.rand(-0.2, 1.2), BX.rand(-1, 1)).normalize().multiplyScalar(BX.rand(1.2, 3.2 + power * 3));
        v.addScaledVector(dir, BX.rand(0.5, 2.2 + power * 2));
        const sweat = i % 3 !== 0;
        FX.spawn(pos, v, sweat ? 0xcfeaff : (kind === 'special' ? 0xff7a1a : 0xffe08a), sweat ? BX.rand(0.012, 0.022) : BX.rand(0.018, 0.03), BX.rand(0.3, 0.6), sweat ? 7 : 2);
      }
      FX.flash(pos, 0.6 + power * 0.8, kind === 'special' ? 0xff8a2a : 0xffffff);
    },
    block(pos, dir) {
      const v = new T.Vector3();
      for (let i = 0; i < 5; i++) {
        v.set(BX.rand(-1, 1), BX.rand(0, 1), BX.rand(-1, 1)).normalize().multiplyScalar(BX.rand(0.8, 1.8)).addScaledVector(dir, 1);
        FX.spawn(pos, v, 0x9ec7ff, 0.02, 0.3, 4);
      }
      FX.flash(pos, 0.45, 0x9ec7ff);
    },
    dust(pos) {
      const v = new T.Vector3();
      for (let i = 0; i < 14; i++) {
        v.set(BX.rand(-1, 1), BX.rand(0.1, 0.5), BX.rand(-1, 1)).normalize().multiplyScalar(BX.rand(0.5, 1.6));
        FX.spawn(pos, v, 0xbfc4d6, BX.rand(0.03, 0.06), BX.rand(0.5, 0.9), -0.2);
      }
    },
    confetti(center, n) {
      const v = new T.Vector3(), p = new T.Vector3();
      const cols = [0xff4d4d, 0xffd24d, 0x4da3ff, 0x6bff9a, 0xffffff, 0xff6bd6];
      for (let i = 0; i < n; i++) {
        p.set(center.x + BX.rand(-2.5, 2.5), BX.rand(4.5, 6), center.z + BX.rand(-2.5, 2.5));
        v.set(BX.rand(-0.6, 0.6), BX.rand(-0.5, 0.2), BX.rand(-0.6, 0.6));
        FX.spawn(p, v, BX.pick(cols), BX.rand(0.025, 0.045), BX.rand(2.5, 4.5), 0.6);
      }
    },

    update(dt) {
      for (const p of FX.pool) {
        if (!p.visible) continue;
        const u = p.userData;
        u.life -= dt;
        if (u.life <= 0) { p.visible = false; continue; }
        u.vel.y -= u.grav * dt;
        p.position.addScaledVector(u.vel, dt);
        if (p.position.y < 0.02 && u.grav > 0) { p.position.y = 0.02; u.vel.multiplyScalar(0.3); u.vel.y = 0; }
        const k = u.life / u.max;
        p.material.opacity = Math.min(1, k * 1.6);
        p.scale.setScalar(u.size * (0.4 + 0.6 * k));
      }
      for (const s of FX.flashes) {
        if (!s.visible) continue;
        const u = s.userData;
        u.life -= dt;
        if (u.life <= 0) { s.visible = false; continue; }
        const k = u.life / u.max;
        s.material.opacity = k;
        s.scale.setScalar(u.size * (1.4 - k));
      }
    },
  };
  BX.FX = FX;

  /* ------------------------------------------------------------------ camera director */
  class CameraRig {
    constructor(camera) {
      this.cam = camera;
      this.pos = new T.Vector3(0, 2, -5);
      this.look = new T.Vector3(0, 1.2, 0);
      this.fov = 52;
      this.fovKick = 0;
      this.shake = 0;
      this.mode = 'behind';
      this.override = null;
      this.t = 0;
      this._d = new T.Vector3(); this._r = new T.Vector3(); this._mid = new T.Vector3();
      this._p = new T.Vector3(); this._l = new T.Vector3();
      this.shakeEnabled = true;
      this.aspect = 16 / 9;
    }
    setOverride(fn, dur, smooth) { this.override = { fn, dur: dur == null ? Infinity : dur, t: 0, smooth: smooth || 4 }; }
    clearOverride() { this.override = null; }
    addShake(a) { if (this.shakeEnabled) this.shake = Math.min(1.4, this.shake + a); }
    kickFov(d) { this.fovKick = Math.min(18, this.fovKick + d); }
    snap(pos, look) { this.pos.copy(pos); this.look.copy(look); }

    /** Desired framing for the current gameplay camera mode. */
    frame(a, b, mode, outPos, outLook) {
      const d = this._d.set(b.pos.x - a.pos.x, 0, b.pos.z - a.pos.z);
      const dist = Math.max(0.5, d.length());
      d.multiplyScalar(1 / dist);
      const r = this._r.set(-d.z, 0, d.x);                 // a's right
      const mid = this._mid.set((a.pos.x + b.pos.x) / 2, 0, (a.pos.z + b.pos.z) / 2);
      let fov = 52;
      const narrow = Math.max(0, 1.3 - this.aspect);   // portrait screens: pull back and widen
      const dm = 1 + narrow * 0.8;
      switch (mode) {
        case 'side':
          outPos.set(mid.x + r.x * (3.1 + dist * 0.55) * dm, 1.55 + dist * 0.1, mid.z + r.z * (3.1 + dist * 0.55) * dm);
          outLook.set(mid.x, 1.15, mid.z);
          fov = 46;
          break;
        case 'broadcast':
          outPos.set(-4.9 + mid.x * 0.2, 3.5, -5.6 + mid.z * 0.2);
          outLook.set(mid.x, 1.1, mid.z);
          fov = 44 + dist * 3;
          break;
        case 'high':
          outPos.set(a.pos.x - d.x * (2.6 + dist * 0.3) * dm, 4.7 * dm, a.pos.z - d.z * (2.6 + dist * 0.3) * dm);
          outLook.set(mid.x, 0.9, mid.z);
          fov = 52;
          break;
        default: // behind (over-the-shoulder)
          outPos.set(a.pos.x - d.x * (2.35 + dist * 0.38) * dm + r.x * 0.62, 1.82 + dist * 0.12 + narrow * 0.3, a.pos.z - d.z * (2.35 + dist * 0.38) * dm + r.z * 0.62);
          outLook.set(mid.x - r.x * 0.15, 1.28, mid.z - r.z * 0.15);
          fov = 54;
      }
      fov += narrow * 16;
      // keep the camera inside the hall
      const lim = 6.3;
      outPos.x = BX.clamp(outPos.x, -lim, lim);
      outPos.z = BX.clamp(outPos.z, -lim, lim);
      return fov;
    }

    update(dt, a, b, realDt) {
      this.t += dt;
      const P = this._p, L = this._l;
      let fov, smooth = 5.5;
      if (this.override) {
        const o = this.override;
        o.t += realDt;
        const res = o.fn(o.t, realDt, P, L);
        fov = res || 50;
        smooth = o.smooth;
        if (o.t >= o.dur) this.override = null;
      } else if (a && b) {
        fov = this.frame(a, b, this.mode, P, L);
      } else {
        P.copy(this.pos); L.copy(this.look); fov = this.fov;
      }
      const k = 1 - Math.exp(-smooth * realDt);
      this.pos.lerp(P, k);
      this.look.lerp(L, k);
      this.fov = BX.damp(this.fov, fov, 4, realDt);
      this.fovKick = BX.damp(this.fovKick, 0, 6, realDt);

      const cam = this.cam;
      cam.position.copy(this.pos);
      if (this.shake > 0.001) {
        const s = this.shake * 0.07;
        cam.position.x += (Math.random() - 0.5) * s;
        cam.position.y += (Math.random() - 0.5) * s;
        cam.position.z += (Math.random() - 0.5) * s;
        this.shake *= Math.exp(-9 * realDt);
      }
      cam.lookAt(this.look);
      const f = this.fov - this.fovKick;
      if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
    }
  }
  BX.CameraRig = CameraRig;
})();
