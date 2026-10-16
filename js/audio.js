/* Knockout Arena — fully synthesised audio (no asset files): punches, bell, crowd, referee, music */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  let ctx = null, master = null, sfxBus = null, musicBus = null, crowdGain = null, crowdFilter = null, noiseBuf = null;
  const st = { vol: 0.8, sfx: true, music: true, speech: true, crowdTarget: 0.12 };
  let musicTimer = null, musicStep = 0, musicNext = 0, musicMode = null;
  let crowdLast = -1, unlockArmed = false, speechPrimed = false;
  const runningCbs = [];

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    master = ctx.createGain();
    master.gain.value = st.vol;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = st.sfx ? 1 : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = st.music ? 0.32 : 0; musicBus.connect(master);

    // 2 seconds of white noise, re-used by every noise based sound
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous crowd murmur
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 650; crowdFilter.Q.value = 0.5;
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
    src.connect(crowdFilter); crowdFilter.connect(crowdGain); crowdGain.connect(sfxBus);
    src.start();
    ctx.onstatechange = () => { if (ctx.state === 'running') onRunning(); };
    return true;
  }

  /** Resume the context from inside a user-activation event. iOS Safari only honours touchend / pointerup / click / keydown
   *  (NOT pointerdown or touchstart), and a silent one-sample buffer played in the same event fully unlocks output. */
  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
      } catch (e) { /* ignore */ }
      const p = ctx.resume && ctx.resume();
      if (p && p.then) p.then(onRunning, () => {});
      // iOS also gates speech synthesis behind a user gesture: prime it once with a silent utterance
      if (!speechPrimed) {
        speechPrimed = true;
        try { const ss = window.speechSynthesis; if (ss && typeof SpeechSynthesisUtterance !== 'undefined') { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; ss.speak(u); } } catch (e) { /* ignore */ }
      }
    }
    onRunning();
  }
  function onRunning() {
    if (!ctx || ctx.state !== 'running') return;
    while (runningCbs.length) { try { runningCbs.shift()(); } catch (e) { /* ignore */ } }
  }
  /** Keep trying on every user gesture until sound is running (and again after interruptions / backgrounding). */
  function armUnlock(cb) {
    if (cb) runningCbs.push(cb);
    if (unlockArmed) return;
    unlockArmed = true;
    const h = () => { if (!ctx || ctx.state !== 'running') unlock(); };
    ['touchend', 'pointerup', 'click', 'keydown', 'mouseup'].forEach((ev) => window.addEventListener(ev, h, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
      else {
        if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(() => {});
        if (musicMode && st.music && !musicTimer) A.musicStart(musicMode, true);
      }
    });
  }

  function noise(dur, o) {
    o = o || {};
    if (!ctx || (!st.sfx && !o.bus)) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + dur);
    f.Q.value = o.q || 0.7;
    const g = ctx.createGain();
    const peak = (o.gain == null ? 0.5 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  function tone(freq, dur, o) {
    o = o || {};
    if (!ctx || (!st.sfx && !o.bus)) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + dur);
    const g = ctx.createGain();
    const peak = (o.gain == null ? 0.3 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  const A = {
    state: st,
    init, unlock, armUnlock,
    get ready() { return !!ctx; },
    get running() { return !!ctx && ctx.state === 'running'; },
    suspendAudio() { if (ctx && ctx.state === 'running') { try { ctx.suspend().catch(() => {}); } catch (e) {} } try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} },
    resumeAudio() { if (ctx && ctx.state !== 'running') { try { ctx.resume().catch(() => {}); } catch (e) {} } if (ctx && musicTimer) musicNext = ctx.currentTime + 0.1; },

    setVolume(v) { st.vol = v; if (master) master.gain.value = v; },
    setSfx(on) { st.sfx = on; if (sfxBus) sfxBus.gain.value = on ? 1 : 0; },
    setMusic(on) {
      const was = st.music;
      st.music = on;
      if (musicBus) musicBus.gain.value = on ? 0.32 : 0;
      if (!on) A.musicStop(); else if (!was && musicMode) A.musicStart(musicMode);   // only restart when it was actually off
    },
    setSpeech(on) { st.speech = on; },

    /* ----- combat ----- */
    hit(power, body) {
      // power 0..1
      const p = BX.clamp(power, 0, 1);
      tone(body ? 95 : 150 + p * 40, 0.16 + p * 0.1, { type: 'sine', freqEnd: 45, gain: 0.55 + p * 0.4 });
      noise(0.09 + p * 0.05, { type: 'bandpass', freq: body ? 500 : 1400, q: 0.9, gain: 0.35 + p * 0.35, freqEnd: body ? 250 : 600 });
      if (p > 0.55) tone(60, 0.3, { type: 'sine', freqEnd: 30, gain: 0.5 });
    },
    block(power) {
      const p = BX.clamp(power || 0.4, 0, 1);
      noise(0.1, { type: 'lowpass', freq: 500, gain: 0.35 + p * 0.2, freqEnd: 180 });
      tone(110, 0.12, { type: 'triangle', freqEnd: 70, gain: 0.3 });
    },
    whoosh(speed, delay) {
      const s = BX.clamp(speed || 0.5, 0, 1);
      noise(0.16, { type: 'bandpass', freq: 450 + s * 400, freqEnd: 1800 + s * 900, q: 0.8, gain: 0.07 + s * 0.08, attack: 0.05, delay: delay || 0 });
    },
    dodge() { noise(0.12, { type: 'highpass', freq: 1500, freqEnd: 3500, gain: 0.07, attack: 0.03 }); },
    knockdown() {
      tone(75, 0.45, { type: 'sine', freqEnd: 28, gain: 0.9 });
      noise(0.35, { type: 'lowpass', freq: 400, gain: 0.7, freqEnd: 90 });
    },
    stagger() { tone(200, 0.1, { type: 'square', freqEnd: 90, gain: 0.08 }); },
    furyReady() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', gain: 0.18, delay: i * 0.07 }));
    },
    furyCharge() {
      tone(110, 0.7, { type: 'sawtooth', freqEnd: 440, gain: 0.12, attack: 0.1 });
      noise(0.7, { type: 'bandpass', freq: 300, freqEnd: 2500, q: 2, gain: 0.12, attack: 0.1 });
    },
    furyHit() {
      tone(55, 0.7, { type: 'sine', freqEnd: 24, gain: 1.0 });
      noise(0.5, { type: 'lowpass', freq: 1800, gain: 0.9, freqEnd: 120 });
      tone(900, 0.25, { type: 'square', freqEnd: 120, gain: 0.16 });
    },

    /* ----- ring ----- */
    bell(n) {
      if (!ctx || !st.sfx) return;
      n = n || 1;
      for (let i = 0; i < n; i++) {
        const delay = i * 0.2;
        [1, 2.76, 5.4, 8.93].forEach((m, k) => {
          tone(740 * m, 1.6 - k * 0.25, { type: 'sine', gain: 0.22 / (k + 1), delay, attack: 0.002 });
        });
      }
    },
    tick() { tone(1000, 0.05, { type: 'square', gain: 0.07 }); },
    countBeep(n) { tone(n >= 8 ? 880 : 660, 0.12, { type: 'triangle', gain: 0.2 }); },

    crowd(level) { st.crowdTarget = BX.clamp(level, 0, 1); },
    cheer(amount) {
      if (!ctx || !st.sfx) return;
      const a = BX.clamp(amount == null ? 0.6 : amount, 0.1, 1);
      noise(0.9 + a * 1.1, { type: 'bandpass', freq: 700, freqEnd: 1200, q: 0.6, gain: 0.12 + a * 0.22, attack: 0.25 });
      noise(0.7 + a, { type: 'bandpass', freq: 1500, q: 0.5, gain: 0.05 + a * 0.1, attack: 0.2, delay: 0.05 });
    },
    gasp() { noise(0.6, { type: 'highpass', freq: 1200, freqEnd: 2600, gain: 0.2, attack: 0.15 }); },
    boo() { noise(1.2, { type: 'bandpass', freq: 260, q: 1.2, gain: 0.25, attack: 0.3 }); },

    /** Per-frame crowd murmur level update. */
    update(dt) {
      if (!ctx || !crowdGain) return;
      const target = st.crowdTarget * 0.22;
      if (Math.abs(target - crowdLast) < 0.004) return;      // only touch the audio graph when the level actually moved
      crowdLast = target;
      const t = ctx.currentTime;
      crowdGain.gain.setTargetAtTime(target, t, 0.3);
      crowdFilter.frequency.setTargetAtTime(500 + st.crowdTarget * 700, t, 0.4);
    },

    speak(text) {
      if (!st.speech || !st.sfx) return;
      try {
        const ss = window.speechSynthesis;
        if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
        ss.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95; u.pitch = 0.8; u.volume = Math.min(1, st.vol + 0.1);
        ss.speak(u);
      } catch (e) { /* speech is optional */ }
    },

    /* ----- ui ----- */
    ui(kind) {
      if (kind === 'back') { tone(330, 0.09, { type: 'triangle', gain: 0.14 }); return; }
      if (kind === 'select') { tone(520, 0.07, { type: 'triangle', gain: 0.16 }); tone(780, 0.1, { type: 'triangle', gain: 0.16, delay: 0.06 }); return; }
      if (kind === 'win') { [523, 659, 784, 1047, 1318].forEach((f, i) => tone(f, 0.25, { type: 'triangle', gain: 0.2, delay: i * 0.11 })); return; }
      if (kind === 'lose') { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', gain: 0.1, delay: i * 0.18 })); return; }
      tone(700, 0.04, { type: 'square', gain: 0.06 });
    },

    /* ----- tiny generative music loop ----- */
    musicStart(mode, force) {
      mode = mode || 'menu';
      const same = musicMode === mode && musicTimer;
      musicMode = mode;
      if (!ctx || !st.music || document.hidden) return;
      if (same && !force) return;                      // already playing this track
      if (musicTimer) clearInterval(musicTimer);
      if (!same) musicStep = 0;
      musicNext = ctx.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 100);    // 0.4 s look-ahead below keeps it gap-free at 10 Hz
    },
    musicStop() {
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = null;
    },
  };

  const BASS = [55, 55, 82.4, 55, 65.4, 65.4, 73.4, 82.4];
  function scheduleMusic() {
    if (!ctx) return;
    const bpm = musicMode === 'fight' ? 118 : 98;
    const stepDur = 60 / bpm / 2; // 8th notes
    const now = ctx.currentTime;
    if (musicNext < now - 0.05) musicNext = now + 0.05;   // after a stall, restart the grid instead of bursting
    while (musicNext < now + 0.4) {
      const i = musicStep % 16;
      const t = musicNext - now;
      if (i % 4 === 0) tone(120, 0.2, { type: 'sine', freqEnd: 40, gain: 0.55, bus: musicBus, delay: t });
      if (i % 4 === 2) noise(0.06, { type: 'highpass', freq: 6000, gain: 0.12, bus: musicBus, delay: t });
      if (i % 8 === 4) noise(0.14, { type: 'bandpass', freq: 1800, q: 0.8, gain: 0.3, bus: musicBus, delay: t });
      const b = BASS[Math.floor(i / 2) % BASS.length];
      if (i % 2 === 0) tone(b, stepDur * 1.7, { type: 'sawtooth', gain: musicMode === 'fight' ? 0.1 : 0.14, bus: musicBus, delay: t });
      if (musicMode !== 'fight' && i % 8 === 0) tone(b * 4, stepDur * 6, { type: 'triangle', gain: 0.05, bus: musicBus, delay: t });
      musicStep++;
      musicNext += stepDur;
    }
  }

  BX.Audio = A;
})();
