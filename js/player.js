'use strict';
/* प्रोजेक्टर — playback, overlays, Hindi voice, controls, and the MP4 render hook. */

const TL = buildTimeline();
const DEV = '०१२३४५६७८९';
const devNum = (n) => String(n).replace(/\d/g, (d) => DEV[d]);
const fmt = (t) => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const $ = (id) => document.getElementById(id);
const RENDER = !!window.__RENDER__;

const canvas = $('film'), ctx = canvas.getContext('2d', { alpha: false });
const ov = { sub: $('ovSub'), who: $('ovWho'), line: $('ovLine'), card: $('ovCard'), chapter: $('ovChapter'), cap: $('ovCap') };

function shotAt(T) {
  const S = TL.shots; let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].start <= T) lo = m; else hi = m - 1; }
  return S[lo];
}
function cueAt(T) {
  for (const c of TL.cues) { if (c.t > T) break; if (T < c.t + c.d) return c; }
  return null;
}

/* ---------- frame ---------- */
let quality = 1920;
function sizeCanvas() {
  if (RENDER) { canvas.width = 1920; canvas.height = 1080; VIEW.scale = 1; return; }
  const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(480, Math.min(quality, Math.round(r.width * dpr)));
  if (canvas.width !== w) { canvas.width = w; canvas.height = Math.round(w * 9 / 16); }
  VIEW.scale = canvas.width / W;
}

let lastCardShot = -1, lastCue = null, lastChapter = -1, lastCap = null, showSubs = true;
function drawFrame(T) {
  T = clamp(T, 0, TL.dur - 0.001);
  const s = shotAt(T), lt = T - s.start;
  ctx.setTransform(VIEW.scale, 0, 0, VIEW.scale, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
  ctx.save(); SHOT[s.type](ctx, lt, s); ctx.restore();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
  if (s.fadeIn) fill(ctx, BLACK, 1 - ss(0, s.fadeIn, lt));
  if (s.flashIn) fill(ctx, [255, 248, 235], 1 - easeOut(ss(0, s.flashIn, lt)));
  if (s.fadeOut) fill(ctx, BLACK, ss(s.dur - s.fadeOut, s.dur, lt));
  const nxt = TL.shots[s.index + 1];
  if (nxt && nxt.fadeIn) fill(ctx, BLACK, ss(s.dur - Math.min(0.6, nxt.fadeIn), s.dur, lt));
  vignette(ctx, s.type === 'credits' || s.type === 'end' ? 0.4 : 1);
  grain(ctx, T, RENDER ? 0.04 : 0.065);
  letterbox(ctx);
  overlays(T, s, lt);
}

function overlays(T, s, lt) {
  // dialogue
  const cue = cueAt(T);
  if (cue !== lastCue) {
    if (cue) { ov.who.textContent = CAST[cue.who].name; ov.who.style.color = CAST[cue.who].color; ov.line.textContent = cue.text; ov.sub.dataset.who = cue.who; }
    if (cue && !RENDER && playing && T - cue.t < 0.6) Voice.speak(cue);
    lastCue = cue;
  }
  ov.sub.style.opacity = cue && showSubs ? Math.min(ss(cue.t, cue.t + 0.22, T), 1 - ss(cue.t + cue.d - 0.25, cue.t + cue.d, T)).toFixed(3) : 0;
  // character / astra card
  if (s.card) {
    if (lastCardShot !== s.index) {
      const c = s.card;
      ov.card.className = 'ov card ' + c.side;
      ov.card.style.setProperty('--acc', `rgb(${c.col.join(',')})`);
      ov.card.querySelector('.kicker').textContent = c.kicker;
      ov.card.querySelector('.title').textContent = c.title;
      ov.card.querySelector('.roman').textContent = c.roman;
      const dl = ov.card.querySelector('.rows'); dl.textContent = '';
      for (const [k, v] of c.rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; c.side === 'right' ? dl.append(dd, dt) : dl.append(dt, dd); }
      lastCardShot = s.index;
    }
    const at = s.card.at ?? 0.7, a = Math.min(ss(at, at + 0.7, lt), 1 - ss(s.dur - 0.6, s.dur - 0.05, lt));
    ov.card.style.opacity = a.toFixed(3);
    ov.card.style.transform = `translateX(${((1 - easeOut(ss(at, at + 0.9, lt))) * (s.card.side === 'left' ? -3 : 3)).toFixed(2)}cqw)`;
  } else { ov.card.style.opacity = 0; lastCardShot = -1; }
  // chapter tag
  let ch = TL.chapters[0];
  for (const c of TL.chapters) if (c.t <= T) ch = c;
  if (ch.n !== lastChapter) { ov.chapter.querySelector('.n').textContent = 'अध्याय ' + devNum(ch.n + 1); ov.chapter.querySelector('.t').textContent = ch.title; lastChapter = ch.n; }
  ov.chapter.style.opacity = (ch.n === 0 ? 0 : bump(ch.t + 0.3, ch.t + 5, T)).toFixed(3);
  // captions (conch names)
  const cap = TL.caps.find((c) => T >= c.t && T < c.t + c.d) || null;
  if (cap !== lastCap) { if (cap) ov.cap.textContent = cap.text; lastCap = cap; }
  ov.cap.style.opacity = cap ? Math.min(ss(cap.t, cap.t + 0.4, T), 1 - ss(cap.t + cap.d - 0.5, cap.t + cap.d, T)).toFixed(3) : 0;
}

/* ---------- Hindi voice (the browser's own speech engine) ---------- */
const Voice = {
  supported: 'speechSynthesis' in window, voice: null, on: true,
  init() {
    if (!this.supported) return this.ui();
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find((v) => /^hi[-_]?/i.test(v.lang) && /google|lekha|swara|madhur|kalpana|hemant/i.test(v.name)) || vs.find((v) => /^hi[-_]?/i.test(v.lang)) || null;
      this.ui();
    };
    pick(); speechSynthesis.addEventListener?.('voiceschanged', pick);
  },
  get ready() { return !!(this.supported && this.voice); },
  speak(cue) {
    if (!this.on || !this.ready) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cue.text.replace(/[—–]/g, ', ').replace(/\.\.\./g, ', '));
    u.voice = this.voice; u.lang = this.voice.lang; u.pitch = CAST[cue.who].pitch; u.rate = CAST[cue.who].rate;
    speechSynthesis.speak(u);
  },
  stop() { if (this.supported) speechSynthesis.cancel(); },
  ui() {
    const b = $('btnVoice'), note = $('voiceNote');
    if (!b) return;
    b.setAttribute('aria-pressed', String(this.on && this.ready));
    b.disabled = !this.ready;
    b.title = this.ready ? (this.on ? 'हिंदी आवाज़ बंद करें (V)' : 'हिंदी आवाज़ चालू करें (V)') : 'इस ब्राउज़र में हिंदी आवाज़ उपलब्ध नहीं';
    if (note) note.textContent = this.ready ? `संवाद-वाचन: ${this.voice.name}` : 'इस डिवाइस पर हिंदी आवाज़ नहीं मिली — संवाद उपशीर्षक में दिखेंगे।';
    if (Audio_ && Audio_.duckOn !== undefined) Audio_.duckOn = this.on && this.ready;
  },
};

/* ---------- transport ---------- */
let Audio_ = null, playing = false, started = false, posterT = 0, Tpaused = 0, clockStart = 0, clockT0 = 0, volume = 0.9;
const now = () => {
  if (!started) return posterT;
  if (!playing) return Tpaused;
  if (Audio_ && Audio_.playing) return Audio_.now();
  return clockT0 + (performance.now() - clockStart) / 1000;
};
async function play() {
  if (playing) return;
  if (Tpaused >= TL.dur - 0.05) Tpaused = 0;
  if (!Audio_) { try { Audio_ = createAudioTransport(TL); } catch (e) { Audio_ = null; } if (Audio_) { Audio_.setVolume(volume); Audio_.duckOn = Voice.on && Voice.ready; } }
  if (Voice.ready) { speechSynthesis.cancel(); }
  playing = true; started = true; clockT0 = Tpaused; clockStart = performance.now();
  if (Audio_) await Audio_.start(Tpaused);
  lastCue = null; document.body.classList.add('is-playing'); $('start').hidden = true; syncButtons(); wake(true);
}
function pause() {
  if (!playing) return;
  Tpaused = now(); playing = false;
  if (Audio_) Audio_.stop();
  Voice.stop(); document.body.classList.remove('is-playing'); syncButtons(); wake(false);
}
function seek(T) {
  started = true;
  const was = playing; if (was) pause();
  Tpaused = clamp(T, 0, TL.dur - 0.05); lastCue = null; drawFrame(Tpaused); ui(true);
  if (was) play();
}
const toggle = () => (playing ? pause() : play());
let wl = null;
async function wake(on) {
  try { if (on && navigator.wakeLock) wl = await navigator.wakeLock.request('screen'); else if (wl) { await wl.release(); wl = null; } } catch (e) { wl = null; }
}

/* ---------- UI ---------- */
const seekEl = $('seek'), timeEl = $('time');
function syncButtons() {
  $('btnPlay').setAttribute('aria-label', playing ? 'रोकें' : 'चलाएँ');
  $('btnPlay').dataset.state = playing ? 'pause' : 'play';
  for (const b of document.querySelectorAll('.chap')) b.setAttribute('aria-current', 'false');
}
let lastUi = 0, curChapBtn = -1;
function ui(force) {
  const t = performance.now(); if (!force && t - lastUi < 120) return; lastUi = t;
  const T = now();
  if (!started) { seekEl.value = 0; timeEl.textContent = `0:00 / ${fmt(TL.dur)}`; return; }
  if (document.activeElement !== seekEl) seekEl.value = T.toFixed(1);
  seekEl.style.setProperty('--p', (T / TL.dur * 100).toFixed(2) + '%');
  timeEl.textContent = `${fmt(T)} / ${fmt(TL.dur)}`;
  let ci = 0; TL.chapters.forEach((c, i) => { if (c.t <= T) ci = i; });
  if (ci !== curChapBtn) { document.querySelectorAll('.chap').forEach((b, i) => b.setAttribute('aria-current', i === ci ? 'true' : 'false')); curChapBtn = ci; }
}
let frames = 0, slow = 0;
function loop() {
  requestAnimationFrame(loop);
  if (!playing && !needsDraw) return;
  let T = now();
  if (playing && T >= TL.dur) { pause(); Tpaused = TL.dur - 0.05; T = Tpaused; $('start').hidden = false; $('startLabel').textContent = 'फिर से देखें'; }
  const t0 = performance.now(); drawFrame(T); const dt = performance.now() - t0;
  needsDraw = false; ui();
  if (playing) { // step resolution down on slow devices
    frames++; if (dt > 30) slow++;
    if (frames >= 45) { if (slow > 20 && quality > 960) { quality = Math.round(quality * 0.75); sizeCanvas(); } frames = 0; slow = 0; }
  }
}
let needsDraw = true;

function buildChapterUI() {
  const marks = $('marks'), list = $('chapters');
  TL.chapters.forEach((c, i) => {
    const m = document.createElement('span'); m.className = 'mark'; m.style.left = (c.t / TL.dur * 100).toFixed(2) + '%'; marks.append(m);
    const b = document.createElement('button'); b.className = 'chap'; b.type = 'button';
    b.innerHTML = `<span class="cn">${devNum(i + 1)}</span><span class="ct"></span><span class="ctime">${fmt(c.t)}</span>`;
    b.querySelector('.ct').textContent = c.title;
    b.addEventListener('click', () => { seek(c.t + 0.01); if (!playing) play(); $('theatre').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    list.append(b);
  });
  seekEl.max = TL.dur.toFixed(1);
}

function bindControls() {
  $('btnStart').addEventListener('click', () => { if (Voice.supported) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) { /* unlock only */ } } play(); });
  $('btnPlay').addEventListener('click', toggle);
  canvas.addEventListener('click', toggle);
  seekEl.addEventListener('input', () => { started = true; Tpaused = +seekEl.value; if (playing) { pause(); } drawFrame(Tpaused); ui(true); });
  seekEl.addEventListener('change', () => seek(+seekEl.value));
  $('btnBack').addEventListener('click', () => seek(now() - 10));
  $('btnFwd').addEventListener('click', () => seek(now() + 10));
  $('btnVoice').addEventListener('click', () => { Voice.on = !Voice.on; if (!Voice.on) Voice.stop(); Voice.ui(); });
  $('btnSubs').addEventListener('click', () => { showSubs = !showSubs; $('btnSubs').setAttribute('aria-pressed', String(showSubs)); needsDraw = true; });
  $('vol').addEventListener('input', (e) => { volume = +e.target.value; if (Audio_) Audio_.setVolume(volume); });
  const th = $('theatre'), fsBtn = $('btnFs');
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.hidden = true;
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (th.requestFullscreen || th.webkitRequestFullscreen).call(th);
    } catch (e) { /* fullscreen refused */ }
  });
  document.addEventListener('fullscreenchange', () => { setTimeout(() => { sizeCanvas(); needsDraw = true; }, 60); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) { if (e.key !== ' ') return; }
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); if (!$('start').hidden) $('btnStart').click(); else toggle(); }
    else if (k === 'arrowright') seek(now() + 5);
    else if (k === 'arrowleft') seek(now() - 5);
    else if (k === 'f') fsBtn.click();
    else if (k === 'c') $('btnSubs').click();
    else if (k === 'v') $('btnVoice').click();
  });
  window.addEventListener('resize', () => { sizeCanvas(); needsDraw = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
}

async function boot() {
  initAssets();
  try {
    await Promise.race([
      Promise.all(['196px "Rozha One"', '46px "Tiro Devanagari Hindi"', '38px "Mukta"'].map((f) => document.fonts.load(f, 'कर्ण अर्जुन युद्ध'))),
      new Promise((r) => setTimeout(r, RENDER ? 15000 : 3500)),
    ]);
  } catch (e) { /* fall back to system Devanagari fonts */ }
  sizeCanvas();
  if (RENDER) {
    document.body.classList.add('render');
    let wav = null;
    window.__film = {
      dur: TL.dur,
      frame(t) { drawFrame(t); return true; },
      async audio() { wav = await renderAudioOffline(TL); return wav.length; },
      audioChunk(i, size) {
        const part = wav.subarray(i * size, (i + 1) * size); let s = '';
        for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode.apply(null, part.subarray(k, k + 0x8000));
        return btoa(s);
      },
    };
    window.__filmReady = true;
    return;
  }
  buildChapterUI(); bindControls(); Voice.init(); syncButtons();
  const hot = window.claude && window.claude.hot;
  posterT = TL.shots.find((s) => s.type === 'title').start + 3.4;
  const start = (data) => { if (data && data.T) { Tpaused = clamp(data.T, 0, TL.dur - 0.1); started = true; } needsDraw = true; ui(true); requestAnimationFrame(loop); };
  if (hot && hot.snapshot) hot.snapshot(() => ({ T: now() }));
  if (hot && hot.ready) hot.ready(start); else start(hot && hot.data);
  $('dur').textContent = `${devNum(Math.round(TL.dur / 60))} मिनट`;
}
boot();
