/* Knockout Arena — shared helpers */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  BX.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  BX.lerp = (a, b, t) => a + (b - a) * t;
  BX.inv = (a, b, v) => (b === a ? 0 : BX.clamp((v - a) / (b - a), 0, 1));
  /** Frame-rate independent exponential smoothing. */
  BX.damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  BX.rand = (a, b) => a + Math.random() * (b - a);
  BX.randi = (a, b) => Math.floor(BX.rand(a, b + 1));
  BX.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  BX.chance = (p) => Math.random() < p;
  BX.sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

  BX.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  BX.dampAngle = (cur, target, lambda, dt) => cur + BX.wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));

  BX.ease = {
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    smooth: (t) => t * t * (3 - 2 * t),
  };

  /** Safe localStorage wrapper (private windows / blocked storage must not break the game). */
  BX.store = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem('ka.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem('ka.' + key, JSON.stringify(value));
      } catch (e) { /* ignore */ }
    },
    remove(key) {
      try { window.localStorage.removeItem('ka.' + key); } catch (e) { /* ignore */ }
    },
  };

  BX.deepMerge = (base, extra) => {
    if (!extra || typeof extra !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(extra)) {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base && typeof base[k] === 'object') {
        out[k] = BX.deepMerge(base[k], extra[k]);
      } else {
        out[k] = extra[k];
      }
    }
    return out;
  };

  BX.fmtTime = (s) => {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  /** Deferred GPU-resource disposal: dispose a few frames later so the replacement acquires the shared shader program first
   *  (disposing the last user of a program deletes it and forces a re-link on the next frame). */
  const _dq = [];
  let _df = 0;
  BX.deferDispose = (objs) => { for (const o of objs) if (o && o.dispose) _dq.push({ o, f: _df + 3 }); };
  BX.flushDispose = () => { _df++; while (_dq.length && _dq[0].f <= _df) _dq.shift().o.dispose(); };
  /** Dispose a boxer rig (materials + geometries it owns) — deferred. */
  BX.disposeRig = (rig) => {
    if (!rig) return;
    BX.deferDispose(Object.values(rig.mats));
    rig.body.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.userData && o.geometry.userData.owned) BX.deferDispose([o.geometry]); });
  };


  /** Merge indexed BufferGeometries (position + normal only; fighter/arena materials have no textures on merged parts). */
  BX.mergeGeos = (list) => {
    const T = window.THREE;
    let vc = 0, ic = 0;
    for (const g of list) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
    let vo = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, c = p.count;
      pos.set(p.array.subarray(0, c * 3), vo * 3);
      nor.set(n.array.subarray(0, c * 3), vo * 3);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
      else for (let i = 0; i < c; i++) idx[io++] = vo + i;
      vo += c;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.userData.owned = true;
    return out;
  };

  /** Bake the local transforms of untextured static meshes (children of `parent`) into one mesh per material. Returns the new geometries. */
  BX.mergeMeshes = (parent, meshes) => {
    const T = window.THREE;
    const buckets = new Map();
    for (const m of meshes) {
      if (Array.isArray(m.material)) continue;
      const k = m.material.uuid + (m.castShadow ? 'c' : 'n') + (m.receiveShadow ? 'r' : 'x');
      let b = buckets.get(k);
      if (!b) { b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, list: [] }; buckets.set(k, b); }
      b.list.push(m);
    }
    const made = [];
    for (const b of buckets.values()) {
      const geos = b.list.map((m) => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
      const merged = BX.mergeGeos(geos);
      geos.forEach((g) => g.dispose());
      for (const m of b.list) parent.remove(m);
      const mesh = new T.Mesh(merged, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
      parent.add(mesh);
      made.push(merged);
    }
    return made;
  };

  BX.hexToInt = (hex) => parseInt(String(hex).replace('#', ''), 16);

  /** Darken / lighten a hex colour by an amount (-1..1). */
  BX.shade = (hex, amt) => {
    const n = BX.hexToInt(hex);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(BX.clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };
})();
