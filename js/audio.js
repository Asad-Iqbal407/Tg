'use strict';
/* संगीत — all music and sound are synthesised with the Web Audio API (no samples).
   Scale: Bhairavi on Sa = D3. The same event list drives live playback and the offline MP4 mix. */

const SA = 146.83;
const nf = (semi, oct = 0) => SA * Math.pow(2, semi / 12 + oct);

function createSynth(ac) {
  const sr = ac.sampleRate;
  let seed = 20240917;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const noiseBuf = ac.createBuffer(1, sr * 2, sr);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const ir = ac.createBuffer(2, Math.floor(sr * 3.4), sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) { const x = i / d.length; d[i] = (rnd() * 2 - 1) * Math.pow(1 - x, 3.4) * Math.min(1, i / (sr * 0.012)); } }
  const N = 40, re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) im[n] = (1 / n) * (1 + 1.7 * Math.exp(-((n - 10) ** 2) / 22));
  const tanWave = ac.createPeriodicWave(re, im);

  const master = ac.createGain(); master.gain.value = 0.85;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
  master.connect(comp); comp.connect(ac.destination);

  const S = { ac, master, bus: null, voices: {} };
  // recorded dialogue: base64 MP3 clips from js/voices.js, decoded once per audio context
  S.loadVoices = () => S._voicesP || (S._voicesP = Promise.all(Object.entries(typeof VOICES !== 'undefined' ? VOICES : {}).map(async ([k, v]) => {
    const bin = atob(v.a), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    try { S.voices[k] = await ac.decodeAudioData(u8.buffer); } catch (e) { /* that line stays subtitled only */ }
  })));
  S.newBus = () => {
    const b = {};
    b.out = ac.createGain(); b.out.connect(master);
    b.rev = ac.createConvolver(); b.rev.buffer = ir;
    b.revIn = ac.createGain(); b.revIn.connect(b.rev);
    const ro = ac.createGain(); ro.gain.value = 0.5; b.rev.connect(ro); ro.connect(b.out);
    b.mus = ac.createGain(); b.mus.gain.value = 0.8; b.mus.connect(b.out);
    b.sfx = ac.createGain(); b.sfx.gain.value = 0.95; b.sfx.connect(b.out);
    b.vox = ac.createGain(); b.vox.gain.value = 1.45; b.vox.connect(b.out);
    return (S.bus = b);
  };
  S.killBus = () => {
    const b = S.bus; if (!b) return; S.bus = null;
    const t = ac.currentTime; b.out.gain.cancelScheduledValues(t); b.out.gain.setValueAtTime(b.out.gain.value, t); b.out.gain.linearRampToValueAtTime(0, t + 0.08);
    setTimeout(() => { try { b.out.disconnect(); } catch (e) { /* already gone */ } }, 200);
  };

  const route = (node, kind, wet = 0, pan = 0) => {
    let n = node;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
    n.connect(kind === 'm' ? S.bus.mus : kind === 'v' ? S.bus.vox : S.bus.sfx);
    if (wet) { const g = ac.createGain(); g.gain.value = wet; n.connect(g); g.connect(S.bus.revIn); }
  };
  const osc = (type, f, t, t1) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t1); return o; };
  const noise = (t, d) => { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(t, rnd() * 1.5); s.stop(t + d); return s; };
  const filt = (type, f, q = 0.7) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const env = (t, a, d, peak, hold = 0) => {
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); return g;
  };
  const pad = (t, d, peak, a, r) => { // sustained envelope that fits inside d
    const g = ac.createGain(); a = Math.min(a, d * 0.4); r = Math.min(r, d * 0.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + d - r); g.gain.linearRampToValueAtTime(0, t + d); return g;
  };

  const I = {
    tanpura(t, p) {
      const v = p.v ?? 0.16, g = env(t, 0.012, 3.6, v), lp = filt('lowpass', 4200, 0.8);
      lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 2.8);
      for (const det of [-4, 4]) { const o = ac.createOscillator(); o.setPeriodicWave(tanWave); o.frequency.value = p.f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + 3.8); }
      lp.connect(g); route(g, 'm', 0.5, p.pan || 0);
    },
    drone(t, p) {
      const d = p.d, g = pad(t, d, p.v ?? 0.05, 3, 3), lp = filt('lowpass', 600, 0.5);
      const lfo = osc('sine', 0.07, t, t + d), lg = ac.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(lp.frequency);
      for (const [f, det, lv] of [[p.f, -6, 1], [p.f, 6, 1], [p.f * 1.5, 0, 0.5], [p.f * 2, 3, 0.35]]) {
        const o = osc('sawtooth', f, t, t + d); o.detune.value = det; const og = ac.createGain(); og.gain.value = lv; o.connect(og); og.connect(lp);
      }
      const sub = osc('sine', p.f / 2, t, t + d), sg = ac.createGain(); sg.gain.value = 0.8; sub.connect(sg); sg.connect(g);
      lp.connect(g); route(g, 'm', 0.6);
    },
    nagara(t, p) {
      const v = p.v ?? 0.8, f = 104 * (p.p ?? 1);
      const o = osc('sine', f, t, t + 0.9); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.28);
      const g = env(t, 0.004, 0.7, v); o.connect(g); route(g, 'm', 0.25, p.pan || 0);
      const n = noise(t, 0.25), bp = filt('bandpass', 190, 1), g2 = env(t, 0.002, 0.16, v * 0.55); n.connect(bp); bp.connect(g2); route(g2, 'm', 0.2, p.pan || 0);
      const n2 = noise(t, 0.06), hp = filt('highpass', 2200), g3 = env(t, 0.001, 0.04, v * 0.18); n2.connect(hp); hp.connect(g3); route(g3, 'm', 0, p.pan || 0);
    },
    dhol(t, p) {
      const v = p.v ?? 0.3, o = osc('triangle', 265, t, t + 0.35); o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
      const g = env(t, 0.002, 0.22, v); o.connect(g); route(g, 'm', 0.15, p.pan ?? 0.25);
      const n = noise(t, 0.1), bp = filt('bandpass', 950, 1.4), g2 = env(t, 0.001, 0.07, v * 0.6); n.connect(bp); bp.connect(g2); route(g2, 'm', 0.1, p.pan ?? 0.25);
    },
    taiko(t, p) {
      const v = p.v ?? 1, o = osc('sine', 72, t, t + 2.2); o.frequency.exponentialRampToValueAtTime(31, t + 0.7);
      const g = env(t, 0.005, 1.8, v); o.connect(g); route(g, 'm', 0.45);
      const n = noise(t, 0.6), lp = filt('lowpass', 320), g2 = env(t, 0.003, 0.5, v * 0.7); n.connect(lp); lp.connect(g2); route(g2, 'm', 0.4);
    },
    shankh(t, p) { // conch: brassy horn through vowel-like formants
      const d = p.d ?? 3.5, f = p.f, v = p.v ?? 0.22;
      const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.8, t + 0.5); g.gain.linearRampToValueAtTime(v, t + d - 0.6); g.gain.linearRampToValueAtTime(0, t + d);
      const mixN = ac.createGain();
      for (const [type, m] of [['sawtooth', 1], ['square', 0.4]]) {
        const o = osc(type, f * 0.8, t, t + d); o.frequency.exponentialRampToValueAtTime(f, t + 0.45); o.frequency.setValueAtTime(f, t + d - 0.5); o.frequency.exponentialRampToValueAtTime(f * 0.88, t + d);
        const vib = osc('sine', 5.2, t, t + d), vg = ac.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + 1); vib.connect(vg); vg.connect(o.frequency);
        const og = ac.createGain(); og.gain.value = m; o.connect(og); og.connect(mixN);
      }
      for (const [ff, q, lv] of [[640, 4, 1], [1240, 5, 0.6], [2500, 6, 0.25]]) { const b = filt('bandpass', ff, q), bg = ac.createGain(); bg.gain.value = lv; mixN.connect(b); b.connect(bg); bg.connect(g); }
      route(g, 'm', 0.8, p.pan || -0.2);
    },
    strings(t, p) {
      const d = p.d, v = p.v ?? 0.05;
      for (const f of p.fs) {
        const g = pad(t, d, v, p.a ?? 1.4, p.r ?? 1.6), lp = filt('lowpass', 400, 0.7);
        lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(p.bright ?? 2300, t + Math.min(d * 0.6, 2.5));
        for (const det of [-9, 0, 9]) { const o = osc('sawtooth', f, t, t + d); o.detune.value = det; o.connect(lp); }
        if (p.trem) { const l = osc('sine', 11, t, t + d), lg = ac.createGain(); lg.gain.value = 0.5; l.connect(lg); const tg = ac.createGain(); tg.gain.value = 0.5; lg.connect(tg.gain); lp.connect(tg); tg.connect(g); }
        else lp.connect(g);
        route(g, 'm', 0.6);
      }
    },
    pluck(t, p) {
      const v = p.v ?? 0.07, o = osc('sawtooth', p.f, t, t + 0.3), lp = filt('lowpass', 2400, 2);
      lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.18);
      const g = env(t, 0.003, 0.2, v); o.connect(lp); lp.connect(g); route(g, 'm', 0.2);
    },
    brass(t, p) {
      const v = p.v ?? 0.1, d = p.d ?? 1.2;
      for (const f of p.fs) {
        const lp = filt('lowpass', 500, 1); lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(3200, t + 0.06); lp.frequency.exponentialRampToValueAtTime(800, t + d);
        const g = env(t, 0.02, d, v);
        for (const det of [-5, 5]) { const o = osc('sawtooth', f, t, t + d + 0.1); o.detune.value = det; o.connect(lp); }
        lp.connect(g); route(g, 'm', 0.55);
      }
    },
    choir(t, p) {
      const d = p.d, v = p.v ?? 0.035, F = p.vowel === 'o' ? [[420, 1], [820, 0.5], [2600, 0.12]] : [[780, 1], [1150, 0.6], [2850, 0.18]];
      for (const f of p.fs) {
        const g = pad(t, d, v, p.a ?? 1.8, p.r ?? 2), sum = ac.createGain();
        for (const det of [-7, 0, 7]) {
          const o = osc('sawtooth', f, t, t + d); o.detune.value = det;
          const vib = osc('sine', 4.8 + det * 0.05, t, t + d), vg = ac.createGain(); vg.gain.value = f * 0.009; vib.connect(vg); vg.connect(o.frequency);
          o.connect(sum);
        }
        for (const [ff, lv] of F) { const b = filt('bandpass', ff, 6), bg = ac.createGain(); bg.gain.value = lv; sum.connect(b); b.connect(bg); bg.connect(g); }
        route(g, 'm', 0.9);
      }
    },
    bansuri(t, p) { // p.ph: [[startOffset, dur, freq, glideFrom?], ...]
      const v = p.v ?? 0.1, last = p.ph[p.ph.length - 1], total = last[0] + last[1];
      const o = osc('sine', p.ph[0][2], t, t + total + 0.4), o2 = osc('sine', p.ph[0][2] * 2, t, t + total + 0.4);
      const g = ac.createGain(); g.gain.setValueAtTime(0, t);
      const vib = osc('sine', 5.3, t, t + total + 0.4), vg = ac.createGain(); vg.gain.value = 0; vib.connect(vg); vg.connect(o.frequency);
      for (const [s0, d, f, from] of p.ph) {
        const ts = t + s0;
        if (from) { o.frequency.setValueAtTime(from, ts); o.frequency.exponentialRampToValueAtTime(f, ts + 0.18); o2.frequency.setValueAtTime(from * 2, ts); o2.frequency.exponentialRampToValueAtTime(f * 2, ts + 0.18); }
        else { o.frequency.setValueAtTime(f, ts); o2.frequency.setValueAtTime(f * 2, ts); }
        g.gain.linearRampToValueAtTime(v, ts + 0.06); g.gain.setValueAtTime(v, ts + d - 0.08); g.gain.linearRampToValueAtTime(v * 0.75, ts + d);
        vg.gain.setValueAtTime(0, ts); vg.gain.linearRampToValueAtTime(f * 0.012, ts + Math.min(d, 0.6));
      }
      g.gain.linearRampToValueAtTime(0, t + total + 0.3);
      const og2 = ac.createGain(); og2.gain.value = 0.12; o2.connect(og2); og2.connect(g); o.connect(g);
      const n = noise(t, total + 0.4), bp = filt('bandpass', p.ph[0][2] * 2, 2), ng = ac.createGain(); ng.gain.value = 0.25; n.connect(bp); bp.connect(ng); ng.connect(g);
      route(g, 'm', 0.85, -0.1);
    },
    bell(t, p) {
      const f = p.f ?? 440, v = p.v ?? 0.12;
      for (const [m, a, d] of [[1, 1, 4], [2.01, 0.6, 2.6], [2.76, 0.4, 1.8], [4.07, 0.25, 1.2], [5.4, 0.2, 0.8]]) { const o = osc('sine', f * m, t, t + d + 0.1), g = env(t, 0.002, d, v * a); o.connect(g); route(g, 'm', 0.7); }
    },
    // ---- effects ----
    whoosh(t, p) {
      const d = p.d ?? 0.5, n = noise(t, d), bp = filt('bandpass', p.f0 ?? 2000, p.q ?? 2);
      bp.frequency.setValueAtTime(p.f0 ?? 2000, t); bp.frequency.exponentialRampToValueAtTime(p.f1 ?? 400, t + d);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p.v ?? 0.3, t + d * (p.peak ?? 0.4)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      n.connect(bp); bp.connect(g); route(g, 's', p.wet ?? 0.2, p.pan || 0);
    },
    arrow(t, p) {
      I.whoosh(t, { d: 0.34, v: p.v ?? 0.18, f0: 3600, f1: 900, q: 3, pan: p.pan });
      const o = osc('sine', 2100, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(1100, t + 0.3);
      const g = env(t, 0.03, 0.25, (p.v ?? 0.18) * 0.12); o.connect(g); route(g, 's', 0.1, p.pan || 0);
    },
    impact(t, p) {
      const v = p.v ?? 0.4, n = noise(t, 0.2), lp = filt('lowpass', 1600), g = env(t, 0.001, 0.14, v); n.connect(lp); lp.connect(g); route(g, 's', 0.3, p.pan || 0);
      const o = osc('sine', 130, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(55, t + 0.2); const g2 = env(t, 0.002, 0.22, v * 0.9); o.connect(g2); route(g2, 's', 0.2, p.pan || 0);
    },
    metal(t, p) {
      const v = p.v ?? 0.2;
      for (const [f, d] of [[523, 0.9], [1187, 0.6], [1873, 0.45], [2650, 0.3], [3410, 0.2]]) { const o = osc('triangle', f * (p.k ?? 1), t, t + d), g = env(t, 0.001, d, v * 0.3); o.connect(g); route(g, 's', 0.5, p.pan || 0); }
      const n = noise(t, 0.05), hp = filt('highpass', 3000), g = env(t, 0.001, 0.04, v * 0.5); n.connect(hp); hp.connect(g); route(g, 's', 0.3, p.pan || 0);
    },
    explosion(t, p) {
      const v = p.v ?? 0.6, n = noise(t, 2), lp = filt('lowpass', 2400);
      lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(160, t + 1.6);
      const g = env(t, 0.004, 1.6, v); n.connect(lp); lp.connect(g); route(g, 's', 0.45, p.pan || 0);
      const o = osc('sine', 64, t, t + 1.6); o.frequency.exponentialRampToValueAtTime(26, t + 1.2); const g2 = env(t, 0.004, 1.3, v); o.connect(g2); route(g2, 's', 0.2);
    },
    thunder(t, p) {
      const v = p.v ?? 0.7, n = noise(t, 0.5), hp = filt('highpass', 900), g = env(t, 0.002, 0.35, v * 0.6); n.connect(hp); hp.connect(g); route(g, 's', 0.6);
      const n2 = noise(t, 4.2), lp = filt('lowpass', 170), g2 = ac.createGain();
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(v, t + 0.12);
      for (let i = 1; i < 12; i++) g2.gain.linearRampToValueAtTime(v * (0.4 + rnd() * 0.6) * (1 - i / 12), t + 0.12 + i * 0.33);
      g2.gain.linearRampToValueAtTime(0, t + 4.1); n2.connect(lp); lp.connect(g2); route(g2, 's', 0.5);
    },
    fire(t, p) {
      const d = p.d, v = p.v ?? 0.25, n = noise(t, d), lp = filt('lowpass', 700), g = pad(t, d, v, 1, 1.2); n.connect(lp); lp.connect(g); route(g, 's', 0.2);
      const n2 = noise(t, d), hp = filt('highpass', 2500), cg = ac.createGain(); cg.gain.setValueAtTime(0, t);
      for (let x = 0; x < d; x += 0.04 + rnd() * 0.08) { const k = t + x; cg.gain.setValueAtTime(rnd() < 0.3 ? v * 0.5 : 0, k); cg.gain.setValueAtTime(0, k + 0.012); }
      n2.connect(hp); hp.connect(cg); route(cg, 's', 0.1, 0.3);
    },
    rain(t, p) { const d = p.d, n = noise(t, d), hp = filt('highpass', 1300), lp = filt('lowpass', 7500), g = pad(t, d, p.v ?? 0.18, 1, 1.5); n.connect(hp); hp.connect(lp); lp.connect(g); route(g, 's', 0.15); },
    wind(t, p) {
      const d = p.d, n = noise(t, d), bp = filt('bandpass', 500, 2.5), g = pad(t, d, p.v ?? 0.3, 0.8, 1.2);
      for (let x = 0; x < d; x += 0.5) bp.frequency.linearRampToValueAtTime(300 + rnd() * 1200, t + x);
      n.connect(bp); bp.connect(g); route(g, 's', 0.2, p.pan || 0);
    },
    hiss(t, p) {
      const d = p.d ?? 1, n = noise(t, d), hp = filt('highpass', 4200), bp = filt('bandpass', 6500, 1.5), g = pad(t, d, p.v ?? 0.12, 0.2, 0.3);
      const l = osc('sine', 9, t, t + d), lg = ac.createGain(); lg.gain.value = 0.4; l.connect(lg); const tg = ac.createGain(); tg.gain.value = 0.6; lg.connect(tg.gain);
      n.connect(hp); hp.connect(bp); bp.connect(tg); tg.connect(g); route(g, 's', 0.3, p.pan || 0);
    },
    heartbeat(t, p) {
      const v = p.v ?? 0.5;
      for (const [o0, k] of [[0, 1], [0.27, 0.7]]) { const o = osc('sine', 62, t + o0, t + o0 + 0.3); o.frequency.exponentialRampToValueAtTime(38, t + o0 + 0.15); const g = env(t + o0, 0.005, 0.18, v * k); o.connect(g); route(g, 's', 0.15); }
    },
    glint(t, p) { const v = p.v ?? 0.08; for (const f of [2637, 3951, 5274]) { const o = osc('sine', f, t, t + 1.2); o.frequency.linearRampToValueAtTime(f * 1.03, t + 1); const g = env(t, 0.003, 1, v); o.connect(g); route(g, 's', 0.8); } },
    boom(t, p) {
      const v = p.v ?? 0.8, o = osc('sine', 56, t, t + 3); o.frequency.exponentialRampToValueAtTime(27, t + 2.4); const g = env(t, 0.01, 2.6, v); o.connect(g); route(g, 's', 0.4);
      const n = noise(t, 1.5), lp = filt('lowpass', 140), g2 = env(t, 0.01, 1.2, v * 0.6); n.connect(lp); lp.connect(g2); route(g2, 's', 0.3);
    },
    riser(t, p) {
      const d = p.d ?? 2, v = p.v ?? 0.18, n = noise(t, d), bp = filt('bandpass', 300, 1.5);
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(p.fail ? 400 : 5000, t + d);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + d * 0.95); g.gain.linearRampToValueAtTime(0, t + d);
      n.connect(bp); bp.connect(g); route(g, 's', 0.5);
      const o = osc('sawtooth', 90, t, t + d); o.frequency.exponentialRampToValueAtTime(p.fail ? 60 : 520, t + d);
      const lp = filt('lowpass', 1200), g2 = ac.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(v * 0.25, t + d * 0.95); g2.gain.linearRampToValueAtTime(0, t + d);
      o.connect(lp); lp.connect(g2); route(g2, 's', 0.5);
    },
    swell(t, p) { const d = p.d ?? 1.5, n = noise(t, d), hp = filt('highpass', 3500), g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p.v ?? 0.15, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.02); n.connect(hp); hp.connect(g); route(g, 's', 0.6); },
    gallop(t, p) {
      const d = p.d, rate = p.rate ?? 2.4, v = p.v ?? 0.16;
      for (let x = 0; x < d; x += 1 / rate) for (const [o0, k] of [[0, 1], [0.09, 0.7], [0.18, 0.85]]) {
        const tt = t + x + o0 + rnd() * 0.01; if (tt > t + d) break;
        const o = osc('sine', 120, tt, tt + 0.12); o.frequency.exponentialRampToValueAtTime(60, tt + 0.07); const g = env(tt, 0.002, 0.08, v * k); o.connect(g); route(g, 's', 0.05, p.pan || 0);
      }
    },
    rumble(t, p) { const d = p.d ?? 2, n = noise(t, d), lp = filt('lowpass', 110), g = pad(t, d, p.v ?? 0.4, 0.15, d * 0.5); n.connect(lp); lp.connect(g); route(g, 's', 0.2); },
    creak(t, p) {
      const d = p.d ?? 1, o = osc('sawtooth', 70, t, t + d), bp = filt('bandpass', 420, 9), g = pad(t, d, p.v ?? 0.12, 0.1, 0.3);
      for (let x = 0; x < d; x += 0.05) o.frequency.linearRampToValueAtTime(55 + rnd() * 40, t + x);
      o.connect(bp); bp.connect(g); route(g, 's', 0.3);
    },
    mud(t, p) { const n = noise(t, 0.6), lp = filt('lowpass', 480), g = env(t, 0.01, 0.5, p.v ?? 0.3); n.connect(lp); lp.connect(g); route(g, 's', 0.2); },
    ambience(t, p) { // distant battle: crowd roar and clangs
      const d = p.d, n = noise(t, d), bp = filt('bandpass', 620, 0.8), g = pad(t, d, p.v ?? 0.08, 1.2, 1.2);
      const l = osc('sine', 0.3, t, t + d), lg = ac.createGain(); lg.gain.value = 260; l.connect(lg); lg.connect(bp.frequency);
      n.connect(bp); bp.connect(g); route(g, 's', 0.4);
      for (let x = 0.5; x < d - 0.5; x += 0.5 + rnd() * 1.4) I.metal(t + x, { v: (p.v ?? 0.08) * 0.35, k: 0.8 + rnd() * 0.5, pan: rnd() * 1.6 - 0.8 });
    },
    birds(t, p) {
      const d = p.d;
      for (let x = 0.3; x < d - 0.4; x += 0.6 + rnd() * 1.5) { const f = 2600 + rnd() * 1400, o = osc('sine', f, t + x, t + x + 0.16); o.frequency.exponentialRampToValueAtTime(f * 1.35, t + x + 0.08); o.frequency.exponentialRampToValueAtTime(f * 0.9, t + x + 0.15); const g = env(t + x, 0.01, 0.13, p.v ?? 0.03); o.connect(g); route(g, 's', 0.4, rnd() - 0.5); }
    },
    duck(t, p) { if (!S.bus) return; const gp = S.bus.mus.gain; gp.setTargetAtTime(p.to, t, p.tc ?? 0.12); },
    voice(t, p) {
      const buf = S.voices[p.key]; if (!buf) return;
      const src = ac.createBufferSource(); src.buffer = buf;
      const g = ac.createGain(); g.gain.value = 1; src.connect(g);
      route(g, 'v', p.wet ?? 0.12, p.pan || 0);
      src.start(t, p.off || 0);
    },
  };
  S.play = (ev, when, into = 0) => {
    const fn = I[ev.type]; if (!fn || !S.bus) return;
    let p = ev.p;
    if (into > 0) { if (!(p.d > into + 0.4)) return; p = Object.assign({}, p, { d: p.d - into, off: into }); }
    try { fn(Math.max(when, ac.currentTime), p); } catch (e) { /* a bad event never stops the film */ }
  };
  return S;
}

/* ---------- score: turns the shot list into timed music + sound events ---------- */
const CHORDS = { Dm: [-12, 0, 3, 7], Bb: [-16, -4, 0, 3], Cm: [-14, -2, 1, 5], Eb: [-11, 1, 5, 8], Gm: [-7, 5, 8, 12], F: [-9, 3, 7, 10] };
const chordF = (name, oct = 0) => CHORDS[name].map((s) => nf(s, oct));
const BHAIRAVI_PHRASES = [
  [[0, 1.0, 7], [1, 0.5, 8], [1.5, 0.5, 7], [2, 1.0, 5], [3, 1.5, 3, 5], [4.5, 0.5, 1], [5, 2.2, 0]],
  [[0, 0.5, 0], [0.5, 0.5, 1], [1, 1, 3], [2, 0.5, 5], [2.5, 1.5, 7], [4, 0.5, 8], [4.5, 0.5, 10], [5, 2.4, 12, 10], [7.4, 0.5, 10], [7.9, 0.5, 8], [8.4, 2.2, 7]],
  [[0, 1, 8], [1, 1, 7], [2, 0.5, 5], [2.5, 0.5, 3], [3, 1, 5], [4, 1, 3], [5, 1, 1], [6, 3, 0, 1]],
];

function buildScore(TL) {
  const ev = [];
  const add = (t, type, p) => ev.push({ t, type, p: p || {} });
  // merge consecutive shots that share a music mood into segments
  const segs = [];
  for (const s of TL.shots) {
    const last = segs[segs.length - 1];
    if (last && last.mus === s.mus) last.t1 = s.start + s.dur;
    else segs.push({ mus: s.mus, t0: s.start, t1: s.start + s.dur });
  }
  const BEAT = 60 / 104, STEP = BEAT / 4, BAR = BEAT * 4;
  const grid = (t0, t1, fn) => { for (let i = Math.ceil(t0 / STEP); i * STEP < t1 - 0.02; i++) fn(i * STEP, i % 16, Math.floor(i / 16)); };
  const prog = (t0, t1, names, len, fn) => { let k = 0; for (let t = t0; t < t1 - 0.5; t += len, k++) fn(t, names[k % names.length], Math.min(len, t1 - t)); };
  const tanpura = (t0, t1, per = 1.15, v = 0.15) => { const seq = [7, 12, 12, 0]; let k = 0; for (let t = t0 + 0.1; t < t1 - 0.3; t += per, k++) add(t, 'tanpura', { f: nf(seq[k % 4] - 12), v, pan: (k % 2 ? 0.25 : -0.25) }); };
  const drone = (t0, t1, v = 0.045) => add(t0, 'drone', { f: nf(-12), d: t1 - t0 + 1.5, v });

  for (const g of segs) {
    const { t0, t1 } = g, d = t1 - t0;
    switch (g.mus) {
      case 'calm':
        drone(t0, t1, 0.05); tanpura(t0 + 1.5, t1, 1.25, 0.12);
        add(t0 + 2, 'choir', { fs: [nf(0)], d: d - 2, v: 0.025, vowel: 'o', a: 4 });
        for (let t = t0 + 4; t < t1 - 1; t += 6.5) add(t, 'taiko', { v: 0.35 });
        break;
      case 'dawn':
        drone(t0, t1, 0.045); tanpura(t0, t1, 1.1, 0.14);
        prog(t0 + 0.5, t1, ['Dm', 'Bb', 'Cm', 'Dm'], 4.2, (t, c, l) => add(t, 'strings', { fs: chordF(c), d: l + 0.6, v: 0.022 + (t - t0) / d * 0.03 }));
        for (let t = t0 + 2, k = 0; t < t1 - 0.4; t += BEAT * 2, k++) add(t, 'nagara', { v: 0.25 + (t - t0) / d * 0.5 });
        add(t1 - 1.6, 'swell', { d: 1.6, v: 0.2 });
        break;
      case 'hit':
        add(t0, 'taiko', { v: 1.1 }); add(t0, 'boom', { v: 0.7 }); add(t0, 'brass', { fs: chordF('Dm'), v: 0.09, d: 2.4 });
        add(t0, 'choir', { fs: chordF('Dm', 1).slice(1), d: d + 0.5, v: 0.03, a: 0.4 });
        add(t0, 'strings', { fs: chordF('Dm'), d: d + 0.5, v: 0.04, a: 0.2 });
        tanpura(t0 + 1, t1, 1.1, 0.12); drone(t0, t1, 0.05);
        break;
      case 'march': case 'talk': case 'battle': case 'astra': case 'climax': case 'rise': {
        const lvl = { talk: 1, march: 2, rise: 2, battle: 3, astra: 3, climax: 3 }[g.mus];
        drone(t0, t1, 0.04);
        if (lvl < 3) tanpura(t0, t1, 1.15, 0.1);
        const names = g.mus === 'astra' || g.mus === 'climax' ? ['Dm', 'Eb', 'Dm', 'Cm'] : ['Dm', 'Bb', 'Cm', 'Dm'];
        prog(t0, t1, names, BAR * 2, (t, c, l) => add(t, 'strings', { fs: chordF(c), d: l + 0.4, v: lvl === 1 ? 0.018 : 0.03, a: 0.6, trem: lvl === 3 }));
        if (g.mus === 'rise') prog(t0, t1, ['Dm', 'Eb'], BAR, (t, c, l) => add(t, 'choir', { fs: chordF(c, 1).slice(1, 3), d: l + 0.3, v: 0.012 + (t - t0) / d * 0.03, a: 0.6 }));
        if (lvl === 3) prog(t0, t1, names, BAR * 2, (t, c, l) => add(t, 'choir', { fs: chordF(c, 1).slice(1, 3), d: l + 0.3, v: 0.02, a: 0.8 }));
        grid(t0, t1, (t, st, bar) => {
          const lowA = lvl === 1 ? [0, 8] : lvl === 2 ? [0, 6, 8, 11] : [0, 3, 6, 8, 10, 11, 14];
          if (lowA.includes(st)) add(t, 'nagara', { v: (lvl === 1 ? 0.35 : 0.7) * (st === 0 ? 1 : 0.75), p: st % 8 === 0 ? 1 : 1.25 });
          if (lvl >= 2 && [2, 4, 10, 12, 14].includes(st)) add(t, 'dhol', { v: 0.18 });
          if (lvl === 3 && st % 2 === 1) add(t, 'dhol', { v: 0.08 + (st % 4 === 3 ? 0.06 : 0), pan: -0.3 });
          if (lvl === 3 && st === 0 && bar % 2 === 0) add(t, 'taiko', { v: 0.7 });
          if (lvl >= 2 && st % 2 === 0) add(t, 'pluck', { f: nf([0, 0, 12, 0, 1, 0, 12, 3][(st / 2) % 8], lvl === 3 ? 0 : -1), v: lvl === 3 ? 0.05 : 0.035 });
        });
        if (g.mus === 'climax') add(t0, 'riser', { d: d - 0.2, v: 0.2 });
        break;
      }
      case 'tension':
        add(t0, 'drone', { f: nf(-24), d: d + 1, v: 0.05 });
        add(t0, 'strings', { fs: [nf(0), nf(1)], d: d + 0.5, v: 0.018, trem: true, a: 1.5 });
        for (let t = t0 + 0.5; t < t1 - 0.3; t += 1.05) add(t, 'heartbeat', { v: 0.42 });
        break;
      case 'silence':
        add(t0, 'drone', { f: nf(-24), d: d + 0.8, v: 0.025 });
        for (let t = t0 + 0.6; t < t1 - 0.3; t += 1.5) add(t, 'heartbeat', { v: 0.35 });
        break;
      case 'flash':
        tanpura(t0, t1, 1.3, 0.13); add(t0, 'bell', { f: nf(12), v: 0.08 });
        add(t0 + 1.5, 'bansuri', { ph: BHAIRAVI_PHRASES[2].map(([s, l, deg, from]) => [s * 1.15, l * 1.15, nf(deg, 1), from !== undefined ? nf(from, 1) : 0]), v: 0.07 });
        add(t0, 'birds', { d: Math.min(d, 9), v: 0.02 });
        break;
      case 'sorrow': {
        tanpura(t0, t1, 1.25, 0.13); drone(t0, t1, 0.035);
        prog(t0, t1, ['Dm', 'Bb', 'Gm', 'Dm'], 5, (t, c, l) => add(t, 'strings', { fs: chordF(c), d: l + 1, v: 0.022, a: 2 }));
        add(t0 + 2, 'choir', { fs: [nf(0, 1), nf(7)], d: d - 2, v: 0.016, a: 4, vowel: 'o' });
        let t = t0 + 3;
        for (const ph of [BHAIRAVI_PHRASES[0], BHAIRAVI_PHRASES[1], BHAIRAVI_PHRASES[2]]) {
          const len = ph[ph.length - 1][0] + ph[ph.length - 1][1];
          if (t + len > t1) break;
          add(t, 'bansuri', { ph: ph.map(([s, l, deg, from]) => [s, l, nf(deg, 1), from !== undefined ? nf(from, 1) : 0]), v: 0.08 });
          t += len + 2.2;
        }
        break;
      }
      case 'end':
        tanpura(t0, t1 - 3, 1.3, 0.11); drone(t0, t1 - 1, 0.04);
        prog(t0, t1 - 2, ['Dm', 'Bb', 'Cm', 'Dm'], 5, (t, c, l) => add(t, 'strings', { fs: chordF(c), d: l + 1, v: 0.024, a: 2 }));
        add(t0 + 1, 'bansuri', { ph: BHAIRAVI_PHRASES[1].map(([s, l, deg, from]) => [s * 1.2, l * 1.2, nf(deg, 1), from !== undefined ? nf(from, 1) : 0]), v: 0.07 });
        add(t0 + 18, 'bansuri', { ph: BHAIRAVI_PHRASES[2].map(([s, l, deg, from]) => [s * 1.2, l * 1.2, nf(deg, 1), from !== undefined ? nf(from, 1) : 0]), v: 0.065 });
        add(t0, 'bell', { f: nf(12), v: 0.08 });
        break;
    }
  }
  // per-shot sound design
  for (const s of TL.shots) {
    const T0 = s.start, d = s.dur, at = (lt, type, p) => add(T0 + lt, type, p);
    if (s.hit) { at(0, 'taiko', { v: 0.9 }); at(0, 'brass', { fs: chordF('Dm'), v: 0.07, d: 1.2 }); }
    for (const f of s.fx || []) at(f[0], f[1], f[2]);
    switch (s.type) {
      case 'void': at(0, 'wind', { d, v: 0.06 }); at(0, 'fire', { d, v: 0.05 }); break;
      case 'dawn': at(0, 'ambience', { d, v: 0.05 }); at(0, 'wind', { d, v: 0.05 }); break;
      case 'title': at(0, 'boom', { v: 0.8 }); at(0.05, 'glint', { v: 0.06 }); break;
      case 'run': at(0, 'gallop', { d, rate: 2.4, v: 0.18, pan: s.who === 'A' ? -0.2 : 0.2 }); at(0, 'rumble', { d, v: 0.14 }); at(0, 'whoosh', { d: 1.2, v: 0.25, f0: 900, f1: 200 }); at(0, 'ambience', { d, v: 0.06 }); break;
      case 'bust': at(0, 'ambience', { d, v: s.mood === 'sun' ? 0 : 0.035 }); if (s.mood === 'angry') at(0, 'fire', { d, v: 0.06 }); break;
      case 'wide':
        at(0, 'ambience', { d, v: 0.07 });
        if (s.mode === 'exchange') {
          for (let k = 0; k < 26; k += 2) { at(lerp(0.2, 9.5, (k + hash(k + 1) * 0.9) / 26), 'arrow', { v: 0.15, pan: -0.5 }); at(lerp(0.3, 9.6, (k + hash(k + 2) * 0.9) / 26), 'arrow', { v: 0.15, pan: 0.5 }); }
          for (let k = 0; k < 26; k += 4) at(lerp(0.2, 9.5, (k + hash(k + 1) * 0.9) / 26) + 0.36, 'metal', { v: 0.07, k: 1 + hash(k) * 0.3 });
          at(2.65, 'whoosh', { d: 0.6, v: 0.35, f0: 3000, f1: 600, pan: -0.3 }); at(3.25, 'explosion', { v: 0.45, pan: 0.6 }); at(3.25, 'impact', { v: 0.5, pan: 0.6 });
          at(5.45, 'whoosh', { d: 0.6, v: 0.35, f0: 3000, f1: 600, pan: 0.3 }); at(6.05, 'impact', { v: 0.5, pan: -0.6 }); at(6.05, 'explosion', { v: 0.3, pan: -0.6 });
        }
        if (s.mode === 'storm') { for (let t = 0; t < d; t += 0.11) at(t, 'arrow', { v: 0.08, pan: Math.sin(t * 7) * 0.7 }); at(0, 'wind', { d, v: 0.12 }); }
        if (s.mode === 'serpentDeath') { at(0, 'hiss', { d: 3, v: 0.2, pan: 0.4 }); for (let i = 0; i < 6; i++) { at(1.55 + i * 0.24, 'arrow', { v: 0.22, pan: -0.4 }); at(1.83 + i * 0.24, 'impact', { v: 0.3, pan: 0.1 }); } at(2.9, 'explosion', { v: 0.6 }); at(3, 'fire', { d: 2.5, v: 0.2 }); }
        if (s.mode === 'chestHit') { at(0.6, 'arrow', { v: 0.3, pan: 0.3 }); at(1.05, 'impact', { v: 0.6, pan: -0.5 }); at(1.05, 'metal', { v: 0.25, pan: -0.5 }); }
        if (s.mode === 'flagCut') { at(0.5, 'arrow', { v: 0.3, pan: -0.3 }); at(0.95, 'metal', { v: 0.3, pan: 0.5, k: 0.7 }); at(1.1, 'creak', { d: 1, v: 0.12 }); at(2.2, 'impact', { v: 0.55, pan: 0.6 }); at(2.2, 'mud', { v: 0.3 }); }
        break;
      case 'invoke':
        if (s.fail) { at(0.2, 'riser', { d: 2.4, v: 0.18 }); at(2.6, 'riser', { d: 1.8, v: 0.14, fail: true }); at(2.7, 'metal', { v: 0.12, k: 0.6 }); at(3.2, 'heartbeat', { v: 0.6 }); }
        else { at(0.1, 'riser', { d: Math.min(d, 3.2), v: 0.16 }); at(0.2, 'glint', { v: 0.07 }); at(0.3, 'choir', { fs: [nf(0, 1), nf(7)], d: d - 0.3, v: 0.02, a: 0.8, vowel: 'o' }); }
        break;
      case 'astra': {
        at(0.1, 'whoosh', { d: 0.8, v: 0.45, f0: 600, f1: 4000, peak: 0.85 }); at(0.85, 'explosion', { v: 0.55 }); at(0.85, 'boom', { v: 0.6 });
        const k = s.kind;
        if (k === 'agni') { at(1, 'fire', { d: d - 1, v: 0.32 }); for (let i = 0; i < 70; i += 5) { const ts = 1 + hash(i + 3) * (d - 2) + 0.9 + hash(i) * 0.4; at(ts, 'explosion', { v: 0.18, pan: 0.4 }); } }
        if (k === 'varuna') { at(0.9, 'thunder', { v: 0.7 }); at(1.2, 'rain', { d: d - 1.2, v: 0.22 }); at(1.6, 'hiss', { d: 4, v: 0.1 }); at(2.6, 'thunder', { v: 0.5 }); at(4.6, 'thunder', { v: 0.45 }); at(0.4, 'fire', { d: 3, v: 0.2 }); }
        if (k === 'vayu') { at(0.6, 'wind', { d: d - 0.4, v: 0.45 }); at(0.6, 'whoosh', { d: 2.5, v: 0.3, f0: 300, f1: 1800 }); at(0, 'rain', { d: 2.5, v: 0.15 }); }
        if (k === 'indra') { for (const t of [0.9, 1.6, 2.3, 3.2, 4.1, 5.3, 6.4]) at(t, 'thunder', { v: 0.55 }); at(1.2, 'whoosh', { d: d - 1.4, v: 0.18, f0: 5000, f1: 2500, peak: 0.1 }); for (let t = 1.3; t < d - 0.3; t += 0.09) at(t, 'arrow', { v: 0.05, pan: 0.5 }); }
        if (k === 'bhargava') { at(1.5, 'boom', { v: 0.9 }); at(1.5, 'whoosh', { d: 1.6, v: 0.45, f0: 4000, f1: 200 }); for (let i = 0; i < 8; i++) { at(2 + i * 0.6, 'thunder', { v: 0.3 }); at(2.2 + i * 0.6, 'explosion', { v: 0.4, pan: -0.6 }); } }
        break;
      }
      case 'quiver': at(0, 'hiss', { d, v: 0.06 }); at(0.4, 'glint', { v: 0.04 }); break;
      case 'nagaFlight': at(0, 'whoosh', { d, v: 0.4, f0: 300, f1: 2500, peak: 0.7, wet: 0.5 }); at(0, 'hiss', { d, v: 0.28 }); at(d - 0.9, 'whoosh', { d: 0.9, v: 0.5, f0: 2000, f1: 300 }); break;
      case 'press': at(0.45, 'hiss', { d: 0.8, v: 0.3, pan: 0.6 }); at(0.82, 'rumble', { d: 1.6, v: 0.6 }); at(0.85, 'boom', { v: 0.7 }); at(0.9, 'mud', { v: 0.4 }); at(1.14, 'metal', { v: 0.45, pan: -0.2 }); at(1.14, 'impact', { v: 0.5 }); at(0, 'ambience', { d, v: 0.05 }); break;
      case 'crown': at(0.05, 'whoosh', { d: 0.5, v: 0.4, f0: 3000, f1: 800 }); at(0.38, 'metal', { v: 0.5, k: 0.9 }); at(0.38, 'glint', { v: 0.1 }); break;
      case 'serpent': at(0, 'hiss', { d, v: 0.1 }); at(0, 'wind', { d, v: 0.08 }); at(1.4, 'thunder', { v: 0.4 }); at(4.2, 'thunder', { v: 0.3 }); break;
      case 'wheel': at(0.3, 'rumble', { d: 2.6, v: 0.5 }); at(0.3, 'creak', { d: 1.2, v: 0.16 }); at(0.5, 'mud', { v: 0.4 }); at(1.4, 'mud', { v: 0.3 }); at(1.6, 'creak', { d: 1, v: 0.12 }); at(0, 'ambience', { d, v: 0.04 }); break;
      case 'flashback': if (s.phase === 1) { at(0.2, 'thunder', { v: 0.6 }); at(3.4, 'thunder', { v: 0.45 }); } break;
      case 'anjalikaFlight': at(0, 'whoosh', { d, v: 0.3, f0: 200, f1: 1200, peak: 0.9, wet: 0.6 }); at(0, 'choir', { fs: [nf(0, 1), nf(7, 1)], d: d + 0.5, v: 0.018, a: 3 }); break;
      case 'impact': at(0, 'boom', { v: 0.9 }); at(0, 'impact', { v: 0.6 }); at(0, 'bell', { f: nf(0, 1), v: 0.12 }); at(2.7, 'impact', { v: 0.45 }); at(2.7, 'mud', { v: 0.35 }); at(0, 'wind', { d, v: 0.06 }); break;
      case 'ascension': at(0, 'wind', { d, v: 0.05 }); at(5.2, 'glint', { v: 0.06 }); at(6.2, 'bell', { f: nf(7, 1), v: 0.08 }); break;
      case 'end': at(0.3, 'taiko', { v: 0.4 }); break;
    }
  }
  const PAN = { A: -0.15, KR: -0.15, K: 0.15, S: 0.15, AS: -0.1, P: 0.1, N: 0 };
  for (const c of TL.cues) {
    add(c.t, 'voice', { key: c.key, d: c.d, pan: PAN[c.who] || 0, wet: c.who === 'P' || c.who === 'AS' ? 0.35 : 0.12 });
    add(c.t - 0.12, 'duck', { to: 0.4 });
    add(c.t + c.d, 'duck', { to: 0.8, tc: 0.4 });
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

/* ---------- live player transport for audio ---------- */
function createAudioTransport(TL) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ac = new AC({ latencyHint: 'playback' });
  const syn = createSynth(ac), events = buildScore(TL);
  const X = { ac, playing: false, T0: 0, acT0: 0, ptr: 0, timer: 0, ready: syn.loadVoices() };
  X.now = () => X.T0 + (ac.currentTime - X.acT0);
  X.tick = () => {
    if (!X.playing) return;
    const horizon = X.now() + 0.4;
    while (X.ptr < events.length && events[X.ptr].t < horizon) { const e = events[X.ptr++]; syn.play(e, X.acT0 + (e.t - X.T0)); }
  };
  X.start = async (T) => {
    if (ac.state !== 'running') { try { await ac.resume(); } catch (e) { /* stays suspended */ } }
    await X.ready;
    syn.killBus(); syn.newBus();
    X.T0 = T; X.acT0 = ac.currentTime + 0.05; X.playing = true;
    if (TL.cues.some((c) => c.t <= T && T < c.t + c.d)) syn.bus.mus.gain.value = 0.4;
    for (const e of events) if (e.t < T && e.t + (e.p.d || 0) > T + 0.4) syn.play(e, X.acT0, T - e.t);
    X.ptr = events.findIndex((e) => e.t >= T); if (X.ptr < 0) X.ptr = events.length;
    clearInterval(X.timer); X.timer = setInterval(X.tick, 60); X.tick();
  };
  X.stop = () => { X.playing = false; clearInterval(X.timer); syn.killBus(); };
  X.setVolume = (v) => { syn.master.gain.setTargetAtTime(v * 0.85, ac.currentTime, 0.05); };
  return X;
}

/* ---------- offline mix for the MP4 renderer ---------- */
// One giant offline graph is far too slow, so music and effects render in 12 s chunks (each with its
// own tail), the dialogue is laid in directly, and the music dips under every spoken line.
async function renderAudioOffline(TL, sr = 48000) {
  const all = buildScore(TL), events = all.filter((e) => e.type !== 'voice' && e.type !== 'duck');
  const n = Math.ceil(sr * (TL.dur + 1)), L = new Float32Array(n), R = new Float32Array(n);
  const SEG = 12;
  for (let s0 = 0; s0 < TL.dur; s0 += SEG) {
    const evs = events.filter((e) => e.t >= s0 && e.t < s0 + SEG);
    if (!evs.length) continue;
    const end = Math.min(TL.dur + 1, Math.max(...evs.map((e) => e.t + (e.p.d || 3))) + 4);
    const ac = new OfflineAudioContext(2, Math.ceil((end - s0) * sr), sr);
    const syn = createSynth(ac); syn.newBus();
    for (const e of evs) syn.play(e, e.t - s0);
    const buf = await ac.startRendering(), off = Math.round(s0 * sr), bl = buf.getChannelData(0), br = buf.getChannelData(1);
    for (let i = 0, m = Math.min(bl.length, n - off); i < m; i++) { L[off + i] += bl[i]; R[off + i] += br[i]; }
  }
  // duck under dialogue: 0.12 s down, 0.4 s back up
  const duck = new Float32Array(n).fill(1);
  for (const c of TL.cues) for (let i = Math.max(0, Math.round((c.t - 0.12) * sr)), e = Math.min(n, Math.round((c.t + c.d) * sr)); i < e; i++) duck[i] = 0.42;
  for (let i = 1, g = 1; i < n; i++) { const k = duck[i] < g ? 1 / (0.12 * sr) : 1 / (0.4 * sr); g += (duck[i] - g) * Math.min(1, k * 4); duck[i] = g; }
  for (let i = 0; i < n; i++) { L[i] *= duck[i]; R[i] *= duck[i]; }
  const dec = new OfflineAudioContext(1, 1, sr), PAN = { A: -0.15, KR: -0.15, K: 0.15, S: 0.15, AS: -0.1, P: 0.1, N: 0 };
  for (const c of TL.cues) {
    const v = typeof VOICES !== 'undefined' && VOICES[c.key]; if (!v) continue;
    const bin = atob(v.a), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    let vb; try { vb = await dec.decodeAudioData(u8.buffer); } catch (e) { continue; }
    const x = vb.getChannelData(0), off = Math.round(c.t * sr), p = PAN[c.who] || 0;
    const gl = Math.cos((p + 1) * Math.PI / 4) * 1.7, gr = Math.sin((p + 1) * Math.PI / 4) * 1.7;
    for (let i = 0, m = Math.min(x.length, n - off); i < m; i++) { L[off + i] += x[i] * gl; R[off + i] += x[i] * gr; }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0.95 ? 0.95 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) { out.setInt16(o, clamp(L[i] * norm, -1, 1) * 32767, true); out.setInt16(o + 2, clamp(R[i] * norm, -1, 1) * 32767, true); }
  return new Uint8Array(out.buffer);
}
