/* Knockout Arena — performance: quality tiers, pixel budget, adaptive governor (dynamic resolution + feature ladder)
 *
 * Design notes (from the mobile GPU/CPU audit):
 *  - Tiers differ in CONTENT (lights, materials, crowd size/LOD, shadow map, particles). Content changes can recompile
 *    shaders (1-2 s on a phone), so they only happen at build time / safe points.
 *  - The governor only walks a ladder of FREE operations during a fight: resolution scale, hiding beams/flashes,
 *    switching the shadow pass off (receiveShadow=false + autoUpdate=false), thinning the crowd (InstancedMesh.count) and a 30 fps cap.
 *    If even that is not enough it asks for a one-off switch to the cheapest content at the next safe point.
 */
(function (root) {
  'use strict';
  const BX = (root.BX = root.BX || {});

  const nav = root.navigator || {};
  const isTouch = (() => {
    try { return !!((root.matchMedia && root.matchMedia('(pointer:coarse)').matches) || nav.maxTouchPoints > 0 || 'ontouchstart' in root); } catch (e) { return false; }
  })();

  /* Content / budget presets. pxBudget is in megapixels of drawing buffer. */
  const TIERS = {
    low: {
      id: 'low', label: 'Low',
      pxBudget: 0.40, pxBudgetTouch: 0.40, prCap: 1.0, prFloor: 0.65,
      shadowMap: 0, shadowFocus: 0.7, shadowEvery: 1,
      crowd: { tiers: 3, spacing: 0.95, lod: 'B', chunks: 12 },
      beams: 2, beamK: 10.5, flashes: 0, pointLights: 0, hemi: 0.75,
      lambertStatics: true, lambertFighters: true, faceDetail: false, fxPool: 24, smallCasterR: 0.075,
    },
    med: {
      id: 'med', label: 'Medium',
      pxBudget: 0.85, pxBudgetTouch: 0.85, prCap: 1.5, prFloor: 0.65,
      shadowMap: 512, shadowFocus: 0.7, shadowEvery: 2,
      crowd: { tiers: 4, spacing: 0.7, lod: 'B', chunks: 16 },
      beams: 3, beamK: 10.5, flashes: 4, pointLights: 1, hemi: 0.75,
      lambertStatics: true, lambertFighters: false, faceDetail: false, fxPool: 48, smallCasterR: 0.075,
    },
    high: {
      id: 'high', label: 'High',
      pxBudget: 5.2, pxBudgetTouch: 1.8, prCap: 2.0, prFloor: 0.65,
      shadowMap: 2048, shadowMapTouch: 1024, shadowFocus: 0.7, shadowEvery: 1,
      crowd: { tiers: 5, spacing: 0.56, lod: 'A', chunks: 16 },
      beams: 6, beamK: 10.5, flashes: 10, pointLights: 3, hemi: 0.55,
      lambertStatics: false, lambertFighters: false, faceDetail: true, fxPool: 90, smallCasterR: 0.075,
    },
  };

  /** Resolve the user's quality setting into a concrete tier object. 'auto' = touch ? med : high (+ governor). */
  function resolve(setting, contentLow) {
    let id = setting;
    if (id === 'auto' || !TIERS[id]) id = isTouch ? 'med' : 'high';
    if (setting === 'auto' && contentLow) id = 'low';
    const t = Object.assign({}, TIERS[id]);
    if (isTouch && t.shadowMapTouch) t.shadowMap = t.shadowMapTouch;
    // touch devices re-use the shadow map every other frame (one frame of lag is invisible)
    if (isTouch && id !== 'low') t.shadowEvery = 2;
    // desktop High keeps the original look (double-sided cones at the original opacity); everything else uses front faces only at ~half the fill cost
    t.beamDouble = id === 'high' && !isTouch;
    if (t.beamDouble) t.beamK = 6;
    t.key = [id, t.shadowMap, t.pointLights, t.lambertStatics ? 'L' : 'S', t.crowd.lod, t.crowd.tiers, t.beams, t.flashes].join('|');
    t.modelKey = (t.lambertFighters ? 'L' : 'S') + (t.faceDetail ? 'F' : 'f');
    t.auto = setting === 'auto';
    return t;
  }

  /** Drawing-buffer pixel ratio from the tier's pixel budget (never above dpr or the tier cap, never below the floor). */
  function pixelRatio(tier, cssW, cssH, scale) {
    const dpr = root.devicePixelRatio || 1;
    const budget = (isTouch ? tier.pxBudgetTouch : tier.pxBudget) * 1e6;
    const byBudget = Math.sqrt(budget / Math.max(1, cssW * cssH));
    let pr = Math.min(dpr, tier.prCap, byBudget) * (scale || 1);
    return Math.max(Math.min(tier.prFloor, dpr), Math.min(pr, tier.prCap, dpr));
  }

  /** Software GL (SwiftShader / llvmpipe / WARP) — start from a cheap level. */
  function isSoftwareGL(gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return false;
      return /swiftshader|llvmpipe|software|basic render|softpipe/i.test(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)));
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- the governor (pure logic) */
  function makeGovernor(opts) {
    const o = Object.assign({
      targetFps: 60, refreshHz: 60, levels: 7, startLevel: 0,
      evalMs: 900, warmMs: 1000, warmFeatureMs: 1600,
      isFeatureStep: () => false,
      downBadFrac: 0.22, downAvgFps: 0.88, jumpFps: 0.55,
      upCleanMs: 6000, probeEvalMs: 450, probeBadFrac: 0.30,
      backoffMs: 20000, maxHitchMs: 250, cb: null,
    }, opts || {});
    const budget = () => 1000 / Math.min(o.targetFps, o.refreshHz);
    const S = { level: o.startLevel, last: 0, win: [], lastChange: 0, cleanSince: 0, probing: null, banned: {}, fails: {}, warm: o.warmFeatureMs, enabled: true };
    function change(now, lvl, reason) {
      const from = S.level;
      lvl = Math.max(0, Math.min(o.levels - 1, lvl));
      if (lvl === from) return;
      S.level = lvl; S.win = []; S.lastChange = now; S.cleanSince = now;
      S.warm = o.isFeatureStep(from, lvl) ? o.warmFeatureMs : o.warmMs;
      if (o.cb) o.cb(lvl, reason, from);
    }
    function frame(now) {
      if (S.last === 0) { S.last = now; S.lastChange = now; return; }
      const dtRaw = now - S.last;
      S.last = now;
      if (dtRaw > o.maxHitchMs) {
        // an isolated stall (tab switch, shader compile, GC) is not a verdict — but a RUN of long frames is simply the frame rate
        S.longRun = (S.longRun || 0) + 1;
        if (S.longRun < 3) { S.lastChange = now; S.warm = o.warmMs; S.win = []; return; }
      } else S.longRun = 0;
      const dt = Math.min(dtRaw, 500);
      if (now - S.lastChange < S.warm) return;
      S.win.push(dt);
      const need = S.probing ? o.probeEvalMs : o.evalMs;
      let tot = 0;
      for (let i = 0; i < S.win.length; i++) tot += S.win[i];
      const minFrames = tot / S.win.length > 80 ? 4 : (S.probing ? 12 : 20);   // very slow devices: decide after a few frames
      if (S.win.length < minFrames || tot < need) return;
      const w = S.win;
      S.win = [];
      const avg = tot / w.length, fps = 1000 / avg, b = budget() * 1.3;
      let bad = 0;
      for (let i = 0; i < w.length; i++) if (w[i] > b) bad++;
      bad /= w.length;
      const down = S.probing ? bad > o.probeBadFrac : (bad > o.downBadFrac || fps < o.targetFps * o.downAvgFps);
      if (down) {
        if (S.probing) {
          const { from, to } = S.probing;
          S.probing = null;
          S.fails[to] = (S.fails[to] || 0) + 1;
          S.banned[to] = now + Math.min(160000, o.backoffMs * Math.pow(2, S.fails[to] - 1));
          change(now, from, 'probe-failed');
        } else change(now, S.level + (fps < o.targetFps * o.jumpFps ? 2 : 1), 'slow ' + fps.toFixed(0) + 'fps bad=' + Math.round(bad * 100) + '%');
        S.cleanSince = now;
        return;
      }
      if (S.probing) { if (now - S.lastChange > 3000) S.probing = null; return; }
      if (S.level > 0 && now - S.cleanSince > o.upCleanMs && fps > o.targetFps * 0.96 && !(S.banned[S.level - 1] > now)) {
        const from = S.level;
        change(now, S.level - 1, 'probe-up');
        S.probing = { from, to: S.level };
      }
    }
    return {
      frame, state: S, opts: o,
      setTarget(fps) { o.targetFps = fps; S.win = []; },
      setRefresh(hz) { o.refreshHz = hz; S.win = []; },
      force(level, now) { S.level = Math.max(0, Math.min(o.levels - 1, level)); S.win = []; S.lastChange = now || S.last; S.cleanSince = S.lastChange; S.probing = null; S.warm = o.warmFeatureMs; },
      reset(now) { S.win = []; S.last = 0; S.lastChange = now || 0; S.warm = o.warmFeatureMs; S.probing = null; },
    };
  }

  /** What each governor level means. All of these are FREE operations (no shader recompiles). */
  const LADDER = [
    { res: 1.00 },
    { res: 0.85 },
    { res: 0.72 },
    { res: 0.62, flashes: false, beams: 2, fxMax: 24 },
    { res: 0.62, flashes: false, beams: 2, fxMax: 24, shadows: false },
    { res: 0.62, flashes: false, beams: 2, fxMax: 24, shadows: false, crowd: 0.5 },
    { res: 0.62, flashes: false, beams: 2, fxMax: 24, shadows: false, crowd: 0.5, cap30: true },
  ];

  function deviceKey() {
    const s = root.screen || {};
    return [String(nav.userAgent || '').slice(0, 60), s.width, s.height, root.devicePixelRatio || 1].join('|');
  }

  const Perf = {
    isTouch, TIERS, LADDER, resolve, pixelRatio, isSoftwareGL, makeGovernor, deviceKey,
    current: resolve('high'),   // the tier currently applied (read by model.js / arena.js / fx.js)
    softwareGL: false,
  };
  BX.Perf = Perf;
})(typeof window !== 'undefined' ? window : globalThis);
