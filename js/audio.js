'use strict';
// Procedural audio: every sound effect and music track is synthesized with WebAudio.
// All melodies below are original compositions written for this game.
const Sound = (() => {
  let ac = null, master, musicBus, sfxBus, noiseBuffer;
  const vol = { music: 0.5, sfx: 0.7 };
  let song = null, songName = null, pending = null, step = 0, nextTime = 0, timer = null;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); sfxBus = ac.createGain();
    musicBus.connect(master); sfxBus.connect(master);
    setVolume(vol.music, vol.sfx);
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pending) { const p = pending; pending = null; play(p); }
  }

  function setVolume(m, s) {
    vol.music = m; vol.sfx = s;
    if (!ac) return;
    musicBus.gain.value = m * 0.55;
    sfxBus.gain.value = s * 0.8;
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function noteNum(name) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + base;
  }

  function tone(freq, dur, o = {}) {
    if (!ac) return;
    const t = o.when ?? ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.slideTime ?? dur));
    if (o.vib) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 6; lg.gain.value = freq * 0.012;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const v = o.vol ?? 0.2, a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noise(dur, o = {}) {
    if (!ac) return;
    const t = o.when ?? ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ac.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.value = o.freq || 2000;
    const g = ac.createGain();
    g.gain.setValueAtTime(o.vol ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  function arp(notes, stepDur, o = {}) {
    const t = ac.currentTime;
    notes.forEach((n, i) => tone(mtof(n), o.len || stepDur * 1.6, { ...o, when: t + i * stepDur }));
  }

  const SFX = {
    jump() { tone(260, 0.16, { to: 640, vol: 0.1 }); },
    djump() { tone(420, 0.2, { to: 980, type: 'triangle', vol: 0.2 }); noise(0.12, { freq: 3500, vol: 0.06 }); },
    coin() { arp([84, 91], 0.055, { vol: 0.08, len: 0.14 }); },
    stomp() { tone(240, 0.12, { to: 70, vol: 0.16 }); noise(0.08, { freq: 900, vol: 0.14 }); },
    kick() { tone(150, 0.09, { to: 420, vol: 0.14 }); },
    bump() { tone(120, 0.1, { to: 70, type: 'triangle', vol: 0.32 }); },
    brk() { noise(0.28, { freq: 1600, vol: 0.32 }); tone(95, 0.15, { to: 40, vol: 0.14 }); },
    sprout() { arp([60, 64, 67, 72, 76, 79], 0.045, { type: 'triangle', vol: 0.2 }); },
    power() { arp([60, 67, 72, 64, 71, 76, 67, 74, 79, 72, 79, 84], 0.035, { vol: 0.08 }); },
    hurt() { arp([76, 72, 69, 64, 60], 0.055, { vol: 0.12 }); },
    die() { arp([72, 71, 70, 69, 67, 64, 60, 55], 0.09, { vol: 0.12, len: 0.13 }); },
    oneup() { arp([76, 79, 88, 84, 86, 91], 0.08, { vol: 0.1 }); },
    fire() { tone(880, 0.09, { to: 220, type: 'sawtooth', vol: 0.07 }); noise(0.06, { freq: 4000, vol: 0.05 }); },
    poof() { noise(0.12, { freq: 2600, vol: 0.1 }); },
    flag() { tone(300, 0.9, { to: 1200, type: 'triangle', vol: 0.16 }); },
    clear() {
      arp([67, 72, 76, 79, 84, 79, 84, 88], 0.11, { vol: 0.09, len: 0.22 });
      const t = ac.currentTime;
      [48, 55, 60, 64].forEach((n, i) => tone(mtof(n), 0.5, { type: 'triangle', vol: 0.2, when: t + i * 0.22 }));
    },
    medal() { arp([79, 83, 86, 91, 95, 98], 0.05, { type: 'triangle', vol: 0.15, len: 0.3 }); },
    spring() { tone(200, 0.3, { to: 900, type: 'triangle', vol: 0.2 }); },
    pound() { tone(130, 0.25, { to: 40, type: 'sine', vol: 0.5 }); noise(0.22, { freq: 600, vol: 0.3 }); },
    shield() { tone(620, 0.35, { to: 200, type: 'sine', vol: 0.25 }); noise(0.2, { freq: 5000, vol: 0.06 }); },
    check() { arp([67, 72, 76, 79], 0.07, { type: 'triangle', vol: 0.16 }); },
    bossHit() { tone(160, 0.35, { to: 50, type: 'sawtooth', vol: 0.18 }); noise(0.25, { freq: 800, vol: 0.2 }); },
    boom() { noise(0.7, { freq: 500, vol: 0.45 }); tone(90, 0.6, { to: 30, type: 'sine', vol: 0.45 }); },
    roar() { tone(110, 0.6, { to: 60, type: 'sawtooth', vol: 0.15, vib: true }); noise(0.5, { freq: 400, vol: 0.2 }); },
    click() { tone(660, 0.05, { type: 'triangle', vol: 0.12 }); },
    buy() { arp([72, 76, 79, 84], 0.05, { type: 'triangle', vol: 0.16 }); },
    deny() { tone(180, 0.15, { to: 120, vol: 0.12 }); },
    tick() { tone(1400, 0.03, { vol: 0.035 }); },
    gameover() { arp([67, 64, 60, 55, 52, 48], 0.18, { type: 'triangle', vol: 0.2, len: 0.32 }); },
    chest() { arp([60, 64, 67, 72, 76, 79, 84, 88, 91], 0.06, { type: 'triangle', vol: 0.15, len: 0.3 }); },
    crack() { noise(0.35, { freq: 3000, vol: 0.15, filter: 'highpass' }); },
    shoot() { tone(200, 0.15, { to: 90, vol: 0.12 }); noise(0.15, { freq: 1200, vol: 0.15 }); },
    firework() { noise(0.4, { freq: 1800, vol: 0.12 }); },
  };

  function sfx(name) {
    if (!ac || vol.sfx <= 0) return;
    try { SFX[name] && SFX[name](); } catch (e) { /* ignore audio glitches */ }
  }

  // ---- Music --------------------------------------------------------------
  // Tokens are eighth notes: note name plays, '_' extends the previous note, '-' is a rest.
  const SONGS = {
    title: {
      bpm: 124, wave: 'triangle', lvol: 0.13, drums: 'k-h-s-hk',
      lead: 'C5 E5 G5 _ A5 G5 E5 _ F5 A5 C6 _ B5 A5 G5 _ E5 G5 A5 G5 F5 E5 D5 _ E5 _ C5 _ - - - - ' +
            'A4 C5 E5 _ D5 C5 A4 _ F5 _ E5 D5 C5 _ D5 _ E5 G5 C6 _ B5 G5 D5 E5 C5 _ _ _ - - - -',
      bass: 'C3 - G3 - C3 - G3 - F3 - C4 - F3 - C4 - A2 - E3 - D3 - A3 - G2 - D3 - G2 - B2 - ' +
            'A2 - E3 - A2 - E3 - F2 - C3 - F2 - C3 - C3 - G3 - G2 - D3 - C3 - G2 - C3 - - -',
    },
    meadow: {
      bpm: 140, wave: 'square', lvol: 0.07, drums: 'k-h-s-h-',
      lead: 'E5 G5 C6 G5 A5 G5 E5 D5 E5 G5 A5 G5 E5 _ - - F5 A5 C6 A5 G5 E5 C5 D5 E5 D5 C5 D5 C5 _ - - ' +
            'G5 _ E5 G5 A5 _ G5 E5 F5 _ D5 F5 G5 _ - - E5 G5 C6 _ B5 _ A5 G5 A5 _ G5 _ C6 _ - -',
      bass: 'C3 - G3 - C3 - G3 - F3 - C4 - F3 - C4 - F3 - A3 - G3 - B3 - C3 - G3 - C3 - E3 G3 ' +
            'C3 - G3 - C3 - G3 - D3 - A3 - D3 - A3 - C3 - G3 - F3 - C4 - F3 - G3 - C3 - - -',
    },
    cave: {
      bpm: 108, wave: 'triangle', lvol: 0.14, drums: 'k---h---s---h-h-',
      lead: 'A4 - C5 - E5 - D5 C5 B4 _ _ - G4 _ _ - A4 - C5 - E5 - G5 E5 F5 _ E5 _ D5 _ _ - ' +
            'E5 - D5 - C5 - B4 A4 G#4 _ _ - E4 _ _ - A4 - B4 - C5 - D5 E5 A4 _ _ _ - - - -',
      bass: 'A2 - - A2 E3 - - - G2 - - G2 D3 - - - F2 - - F2 C3 - - - E2 - - E2 B2 - - - ' +
            'A2 - - A2 E3 - - - E2 - - E2 B2 - - - F2 - - F2 C3 - - - E2 - E2 - A2 - - -',
    },
    desert: {
      bpm: 120, wave: 'sawtooth', lvol: 0.05, drums: 'k-hsk-s-',
      lead: 'D5 Eb5 F#5 G5 A5 _ G5 F#5 Eb5 _ D5 _ _ _ - - A5 Bb5 A5 G5 F#5 _ G5 A5 F#5 Eb5 D5 _ _ _ - - ' +
            'G5 _ F#5 _ Eb5 _ F#5 G5 A5 _ _ _ D6 _ C6 Bb5 A5 _ G5 _ F#5 _ Eb5 _ D5 _ _ _ - - - -',
      bass: 'D3 - A2 - D3 - A2 - Eb3 - Bb2 - Eb3 - D3 - G2 - D3 - G2 - D3 - D3 - A2 - D3 - - - ' +
            'G2 - D3 - G2 - D3 - D3 - A2 - D3 - A2 - Eb3 - Bb2 - C3 - G2 - D3 - A2 - D3 - - -',
    },
    ice: {
      bpm: 100, wave: 'sine', lvol: 0.16, drums: 'k---h-h-s---h---',
      lead: 'B5 - G#5 - E5 - G#5 B5 C#6 _ B5 - G#5 _ _ - A5 - F#5 - D#5 - F#5 A5 B5 _ _ _ - - - - ' +
            'E6 - D#6 - C#6 - B5 - A5 _ G#5 - F#5 _ _ - G#5 - A5 - B5 - C#6 D#6 E6 _ _ _ - - - -',
      bass: 'E3 - B3 - E4 - B3 - A2 - E3 - A3 - E3 - B2 - F#3 - B3 - F#3 - E3 - B3 - E4 - - - ' +
            'C#3 - G#3 - C#4 - G#3 - A2 - E3 - A3 - E3 - B2 - F#3 - B3 - F#3 - E3 - B3 - E3 - - -',
    },
    sky: {
      bpm: 128, wave: 'square', lvol: 0.065, drums: 'k-h-s-hh',
      lead: 'F5 A5 C6 - A5 - C6 D6 C6 _ A5 - F5 - G5 - A5 - Bb5 - C6 - D6 C6 A5 _ G5 _ F5 _ - - ' +
            'D6 _ C6 _ A5 _ F5 _ G5 A5 Bb5 _ A5 _ G5 _ A5 _ C6 _ F6 _ E6 D6 C6 _ _ _ F5 _ - -',
      bass: 'F2 - C3 - F3 - C3 - Bb2 - F3 - Bb3 - F3 - C3 - G3 - C4 - G3 - F2 - C3 - F3 - - - ' +
            'D3 - A3 - D3 - A3 - G2 - D3 - G2 - D3 - Bb2 - F3 - C3 - G3 - F2 - C3 - F2 - - -',
    },
    castle: {
      bpm: 150, wave: 'square', lvol: 0.06, drums: 'k-skk-s-',
      lead: 'C5 C5 Eb5 - C5 C5 F#5 - G5 _ F#5 F5 Eb5 _ D5 - C5 C5 Eb5 - C5 C5 G5 - Ab5 _ G5 _ F#5 _ _ - ' +
            'Eb5 D5 C5 - Eb5 D5 C5 - G4 _ Ab4 _ B4 _ _ - C5 Eb5 G5 - C6 _ B5 Ab5 G5 _ F#5 _ G5 _ _ -',
      bass: 'C2 C3 C2 C3 C2 C3 C2 C3 Ab1 Ab2 Ab1 Ab2 G1 G2 G1 G2 C2 C3 C2 C3 C2 C3 C2 C3 Ab1 Ab2 G1 G2 F#1 F#2 G1 G2 ' +
            'C2 C3 C2 C3 Ab1 Ab2 Ab1 Ab2 F1 F2 F1 F2 G1 G2 G1 G2 C2 C3 C2 C3 Eb2 Eb3 Eb2 Eb3 G1 G2 G1 G2 C2 C3 C2 -',
    },
    boss: {
      bpm: 168, wave: 'sawtooth', lvol: 0.05, drums: 'kshskshs',
      lead: 'C5 D5 Eb5 G5 C6 G5 Eb5 D5 B4 D5 F5 G5 B5 G5 F5 D5 C5 D5 Eb5 G5 C6 D6 Eb6 D6 B5 _ G5 _ F5 _ D5 _ ' +
            'Ab5 G5 F5 Eb5 F5 G5 Ab5 _ G5 F5 Eb5 D5 Eb5 F5 G5 _ C6 B5 Ab5 G5 F5 Eb5 D5 C5 B4 _ D5 _ G5 _ _ _',
      bass: 'C2 C2 C3 C2 C2 C3 C2 C3 G1 G1 G2 G1 G1 G2 G1 G2 C2 C2 C3 C2 C2 C3 C2 C3 G1 G1 G2 G1 B1 B2 D2 D3 ' +
            'Ab1 Ab1 Ab2 Ab1 Ab1 Ab2 Ab1 Ab2 Eb2 Eb2 Eb3 Eb2 Eb2 Eb3 Eb2 Eb3 F1 F1 F2 F1 F1 F2 F1 F2 G1 G1 G2 G1 G1 G2 G1 G2',
    },
    bonus: {
      bpm: 150, wave: 'triangle', lvol: 0.14, drums: 'k-hsk-hs',
      lead: 'G5 B5 D6 B5 G5 B5 D6 G6 F#6 _ D6 _ A5 _ - - E5 G5 B5 G5 C6 B5 A5 G5 F#5 _ A5 _ D6 _ - - ' +
            'G5 _ A5 B5 C6 _ B5 A5 B5 _ G5 _ D5 _ - - E5 F#5 G5 A5 B5 C6 D6 E6 D6 _ B5 _ G5 _ _ -',
      bass: 'G2 - D3 - G3 - D3 - D3 - A3 - D3 - F#3 - C3 - G3 - C3 - E3 - D3 - A3 - D3 - - - ' +
            'C3 - G3 - C3 - G3 - G2 - D3 - G2 - D3 - C3 - E3 - A2 - E3 - D3 - A3 - G2 - - -',
    },
    star: {
      bpm: 190, wave: 'square', lvol: 0.06, drums: 'khshkhsh',
      lead: 'G5 C6 E6 C6 G5 C6 E6 G6 A5 D6 F6 D6 A5 D6 F6 A6 B5 E6 G6 E6 B5 E6 G6 B6 C7 _ G6 _ E6 _ C6 _',
      bass: 'C3 C4 C3 C4 C3 C4 C3 C4 D3 D4 D3 D4 D3 D4 D3 D4 E3 E4 E3 E4 E3 E4 E3 E4 G2 G3 G2 G3 C3 C4 C3 C4',
    },
  };

  function parse(str) {
    const toks = str.trim().split(/\s+/);
    const out = new Array(toks.length).fill(null);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === '-' || t === '_') continue;
      let len = 1;
      while (toks[i + len] === '_') len++;
      out[i] = { m: noteNum(t), len };
    }
    return out;
  }

  function play(name) {
    if (!ac) { pending = name; return; }
    if (songName === name) return;
    stop();
    const s = SONGS[name];
    if (!s) return;
    song = { ...s, leadSeq: parse(s.lead), bassSeq: parse(s.bass) };
    songName = name;
    step = 0;
    nextTime = ac.currentTime + 0.06;
    timer = setInterval(schedule, 25);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null; song = null; songName = null; pending = null;
  }

  function schedule() {
    if (!song || !ac) return;
    const sd = 60 / song.bpm / 2;
    if (nextTime < ac.currentTime - 0.25) nextTime = ac.currentTime + 0.02; // recover from throttling
    while (nextTime < ac.currentTime + 0.12) {
      playStep(step, nextTime, sd);
      step++;
      nextTime += sd;
    }
  }

  function playStep(i, t, sd) {
    if (vol.music <= 0) return;
    const L = song.leadSeq[i % song.leadSeq.length];
    if (L) tone(mtof(L.m), sd * L.len * 0.92, { type: song.wave, vol: song.lvol, when: t, bus: musicBus, attack: 0.012, vib: L.len > 2 });
    const B = song.bassSeq[i % song.bassSeq.length];
    if (B) tone(mtof(B.m), sd * B.len * 0.9, { type: 'triangle', vol: 0.17, when: t, bus: musicBus, attack: 0.008 });
    const d = song.drums[i % song.drums.length];
    if (d === 'k') tone(150, 0.13, { to: 40, type: 'sine', vol: 0.36, when: t, bus: musicBus });
    else if (d === 's') noise(0.11, { filter: 'highpass', freq: 1400, vol: 0.11, when: t, bus: musicBus });
    else if (d === 'h') noise(0.035, { filter: 'highpass', freq: 6500, vol: 0.05, when: t, bus: musicBus });
  }

  return {
    init, sfx, play, stop, setVolume,
    get current() { return songName || pending; },
  };
})();
