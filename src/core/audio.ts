import { Rng } from './rng';

export type SfxName =
  | 'click'
  | 'select'
  | 'coin'
  | 'jump'
  | 'land'
  | 'hit'
  | 'explode'
  | 'bomb'
  | 'shoot'
  | 'laser'
  | 'gun'
  | 'empty'
  | 'powerup'
  | 'gameover'
  | 'levelup'
  | 'quack'
  | 'whoosh'
  | 'error'
  | 'reward'
  | 'stomp'
  | 'bump'
  | 'fuel'
  | 'flip'
  | 'pop'
  | 'win'
  | 'warning';

export interface PlayOptions {
  volume?: number;
  /** Playback-rate style pitch multiplier (1 = unchanged). */
  pitch?: number;
}

export interface MusicTheme {
  bpm: number;
  /** MIDI note number of the tonic. */
  root: number;
  scale: 'major' | 'minor' | 'dorian' | 'pentatonic';
  /** Scale degrees (0-based) of each bar's chord. */
  progression: readonly number[];
  seed: number;
  lead?: OscillatorType;
}

export interface EngineSound {
  /** rpm and load in [0, 1]. */
  set(rpm: number, load: number): void;
  stop(): void;
}

/** The surface games depend on, so headless tests and thumbnails can use a silent implementation. */
export interface AudioLike {
  play(name: SfxName, opts?: PlayOptions): void;
  engine(): EngineSound;
}

export class NullAudio implements AudioLike {
  play(): void {}
  engine(): EngineSound {
    return { set() {}, stop() {} };
  }
}

const SCALES: Record<MusicTheme['scale'], readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface VolumeSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

/**
 * Fully synthesized audio (no asset downloads): retro sound effects, an engine drone and a
 * look-ahead step sequencer for procedural chiptune music.
 */
export class AudioEngine implements AudioLike {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volumes: VolumeSettings = { masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.5, muted: false };
  private readonly lastPlayed = new Map<SfxName, number>();

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private theme: MusicTheme | null = null;
  private melody: (number | null)[] = [];
  private step = 0;
  private nextNoteTime = 0;
  private musicPaused = false;

  /** True once a user gesture has created the audio context. */
  get unlocked(): boolean {
    return this.ac !== null;
  }

  get available(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** Must be called from a user gesture at least once (browser autoplay policy). */
  unlock(): void {
    if (!this.available) return;
    if (!this.ac) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.ac = new Ctor();
      } catch {
        return;
      }
      const ac = this.ac;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master = ac.createGain();
      this.sfxBus = ac.createGain();
      this.musicBus = ac.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(comp);
      comp.connect(ac.destination);
      const len = ac.sampleRate;
      this.noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ac.state === 'suspended') void this.ac.resume().catch(() => undefined);
  }

  setVolumes(v: VolumeSettings): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ac || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = this.ac.currentTime;
    const m = this.volumes.muted ? 0 : this.volumes.masterVolume;
    this.master.gain.setTargetAtTime(m, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfxVolume, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.musicPaused ? 0 : this.volumes.musicVolume * 0.55, t, 0.05);
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ac = this.ac;
    if (!ac || !this.sfxBus || this.volumes.muted || ac.state !== 'running') return;
    const now = ac.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.03) return; // collapse bursts of identical sounds
    this.lastPlayed.set(name, now);
    const v = opts.volume ?? 1;
    const p = opts.pitch ?? 1;
    const T = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) =>
      this.tone(type, f0 * p, f1 * p, dur, vol * v, now + delay);
    const N = (dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0) =>
      this.noise(dur, vol * v, filter, f0, f1, now + delay);

    switch (name) {
      case 'click':
        T('square', 900, 600, 0.04, 0.12);
        break;
      case 'select':
        T('triangle', 660, 660, 0.06, 0.25);
        T('triangle', 990, 990, 0.08, 0.25, 0.05);
        break;
      case 'coin':
        T('square', 988, 988, 0.05, 0.12);
        T('square', 1319, 1319, 0.16, 0.12, 0.05);
        break;
      case 'jump':
        T('square', 240, 640, 0.14, 0.12);
        break;
      case 'land':
        N(0.06, 0.25, 'lowpass', 600, 200);
        break;
      case 'hit':
        T('sawtooth', 220, 50, 0.3, 0.25);
        N(0.15, 0.3, 'lowpass', 2000, 300);
        break;
      case 'explode':
        N(0.55, 0.5, 'lowpass', 1600, 80);
        T('sine', 140, 30, 0.45, 0.45);
        break;
      case 'bomb':
        N(1.2, 0.6, 'lowpass', 2400, 60);
        T('sine', 100, 20, 1.0, 0.6);
        T('sawtooth', 60, 25, 0.8, 0.2);
        break;
      case 'shoot':
        T('square', 1100, 300, 0.07, 0.06);
        break;
      case 'laser':
        T('sawtooth', 1500, 180, 0.14, 0.12);
        break;
      case 'gun':
        N(0.3, 0.7, 'lowpass', 5000, 300);
        T('sine', 160, 40, 0.18, 0.5);
        break;
      case 'empty':
        T('square', 180, 140, 0.04, 0.12);
        break;
      case 'powerup':
        [523, 659, 784, 1047].forEach((f, i) => T('triangle', f, f, 0.09, 0.22, i * 0.06));
        break;
      case 'gameover':
        [392, 330, 262, 196].forEach((f, i) => T('sawtooth', f, f * 0.98, 0.22, 0.14, i * 0.18));
        break;
      case 'levelup':
        [523, 659, 784, 1047, 1319].forEach((f, i) => T('square', f, f, 0.12, 0.1, i * 0.07));
        T('triangle', 2093, 2093, 0.4, 0.08, 0.36);
        break;
      case 'quack':
        this.quack(now, v, p);
        break;
      case 'whoosh':
        N(0.35, 0.3, 'bandpass', 400, 2400);
        break;
      case 'error':
        T('square', 220, 220, 0.09, 0.12);
        T('square', 165, 165, 0.14, 0.12, 0.1);
        break;
      case 'reward':
        [784, 988, 1175, 1568].forEach((f, i) => T('triangle', f, f, 0.16, 0.2, i * 0.08));
        break;
      case 'stomp':
        T('square', 500, 90, 0.12, 0.16);
        break;
      case 'bump':
        T('triangle', 160, 110, 0.09, 0.3);
        break;
      case 'fuel':
        T('triangle', 440, 880, 0.18, 0.25);
        T('triangle', 660, 1320, 0.18, 0.15, 0.08);
        break;
      case 'flip':
        T('sine', 400, 1400, 0.25, 0.25);
        break;
      case 'pop':
        T('sine', 600, 1300, 0.07, 0.25);
        break;
      case 'win':
        [523, 659, 784, 659, 784, 1047].forEach((f, i) => T('square', f, f, 0.14, 0.1, i * 0.11));
        break;
      case 'warning':
        for (let i = 0; i < 3; i++) {
          T('sawtooth', 440, 440, 0.18, 0.1, i * 0.4);
          T('sawtooth', 330, 330, 0.18, 0.1, i * 0.4 + 0.2);
        }
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at: number): void {
    const ac = this.ac;
    if (!ac || !this.sfxBus) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), at);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noise(
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    at: number,
    bus: GainNode | null = this.sfxBus,
  ): void {
    const ac = this.ac;
    if (!ac || !bus || !this.noiseBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(f0, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  private quack(at: number, v: number, p: number): void {
    const ac = this.ac;
    if (!ac || !this.sfxBus) return;
    for (let i = 0; i < 2; i++) {
      const t = at + i * 0.13;
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(560 * p, t);
      osc.frequency.exponentialRampToValueAtTime(340 * p, t + 0.11);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 3;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(bp).connect(g).connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  engine(): EngineSound {
    const ac = this.ac;
    if (!ac || !this.sfxBus) return new NullAudio().engine();
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ac.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.sfxBus);
    o1.start();
    o2.start();
    let stopped = false;
    return {
      set: (rpm: number, load: number) => {
        if (stopped) return;
        const t = ac.currentTime;
        const f = 38 + rpm * 110;
        o1.frequency.setTargetAtTime(f, t, 0.05);
        o2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
        lp.frequency.setTargetAtTime(300 + rpm * 900 + load * 400, t, 0.05);
        g.gain.setTargetAtTime(0.035 + load * 0.05 + rpm * 0.02, t, 0.08);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ac.currentTime;
        g.gain.setTargetAtTime(0, t, 0.05);
        o1.stop(t + 0.3);
        o2.stop(t + 0.3);
      },
    };
  }

  // ---------------------------------------------------------------- music

  startMusic(theme: MusicTheme): void {
    this.stopMusic();
    if (!this.ac) return;
    this.theme = theme;
    this.step = 0;
    this.melody = this.composeMelody(theme);
    this.nextNoteTime = this.ac.currentTime + 0.1;
    this.musicPaused = false;
    this.applyVolumes();
    this.musicTimer = setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.theme = null;
  }

  setMusicPaused(paused: boolean): void {
    this.musicPaused = paused;
    if (!paused && this.ac) this.nextNoteTime = this.ac.currentTime + 0.05;
    this.applyVolumes();
  }

  private composeMelody(theme: MusicTheme): (number | null)[] {
    const rng = new Rng(theme.seed);
    const scale = SCALES[theme.scale];
    const notes: (number | null)[] = [];
    let degree = 0;
    const steps = theme.progression.length * 16;
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 1 || rng.chance(0.45)) {
        notes.push(null);
        continue;
      }
      degree = Math.max(-2, Math.min(scale.length + 3, degree + rng.int(-2, 2)));
      notes.push(degree);
    }
    return notes;
  }

  private noteFromDegree(degree: number, octave: number): number {
    const theme = this.theme;
    if (!theme) return 60;
    const scale = SCALES[theme.scale];
    const n = scale.length;
    const oct = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    return theme.root + (scale[idx] ?? 0) + 12 * (oct + octave);
  }

  private schedule(): void {
    const ac = this.ac;
    const theme = this.theme;
    if (!ac || !theme || !this.musicBus) return;
    if (this.musicPaused) {
      this.nextNoteTime = ac.currentTime + 0.05;
      return;
    }
    const stepDur = 60 / theme.bpm / 4;
    // If the tab was throttled, skip ahead rather than bursting a backlog of notes.
    if (this.nextNoteTime < ac.currentTime - 0.2) this.nextNoteTime = ac.currentTime + 0.05;
    while (this.nextNoteTime < ac.currentTime + 0.12) {
      this.playStep(this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % (theme.progression.length * 16);
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const theme = this.theme;
    const bus = this.musicBus;
    const ac = this.ac;
    if (!theme || !bus || !ac) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = theme.progression[bar % theme.progression.length] ?? 0;
    const voice = (type: OscillatorType, midi: number, dur: number, vol: number) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = midiToHz(midi);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };
    // Bass
    if (s === 0 || s === 6 || s === 8 || s === 14)
      voice('triangle', this.noteFromDegree(chord, -2), stepDur * 1.8, 0.32);
    // Arpeggio
    if (s % 2 === 0) {
      const tones = [chord, chord + 2, chord + 4, chord + 2];
      voice('square', this.noteFromDegree(tones[(s / 2) % 4] ?? chord, 0), stepDur * 0.9, 0.05);
    }
    // Lead melody
    const m = this.melody[step];
    if (m !== null && m !== undefined)
      voice(theme.lead ?? 'triangle', this.noteFromDegree(m, 1), stepDur * 1.7, 0.08);
    // Drums
    if (s === 0 || s === 8) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + 0.16);
    }
    if (s === 4 || s === 12) this.noise(0.12, 0.18, 'bandpass', 1800, 900, t, bus);
    if (s % 2 === 1) this.noise(0.03, 0.06, 'highpass', 7000, 9000, t, bus);
  }
}
