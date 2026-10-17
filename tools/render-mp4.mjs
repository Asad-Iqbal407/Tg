// Renders the film to an MP4: frames from the same canvas engine (headless Chromium),
// sound from an offline Web Audio mix of the same score, joined with ffmpeg.
//
// usage: node tools/render-mp4.mjs <out.mp4> [--fps 24] [--workers 3] [--from 0] [--to <end>] [--crf 20] [--audio-only]
// needs: playwright (with Chromium) and ffmpeg on PATH.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const argv = process.argv.slice(2);
const out = path.resolve(argv[0] || 'karna-arjun-yuddh.mp4');
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i > 0 ? Number(argv[i + 1]) : d; };
const fps = opt('fps', 24), workers = opt('workers', 3), crf = opt('crf', 20);
const tmp = fs.mkdtempSync(path.join(path.dirname(out), '.render-'));
const page_url = pathToFileURL(path.resolve('index.html')).href;

function run(args, input) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))));
    if (input) input(p);
  });
}
async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.addInitScript(() => { window.__RENDER__ = true; });
  await page.goto(page_url);
  await page.waitForFunction(() => window.__filmReady === true, null, { timeout: 60000 });
  return page;
}

const browser = await chromium.launch();
const first = await openPage(browser);
const dur = await first.evaluate(() => window.__film.dur);
const from = opt('from', 0), to = Math.min(opt('to', dur), dur);

console.log(`film ${dur.toFixed(1)}s · rendering ${from}–${to.toFixed(1)}s at ${fps} fps with ${workers} workers`);
const t0 = Date.now();
const wavLen = await first.evaluate(() => window.__film.audio());
const wav = path.join(tmp, 'audio.wav'), fd = fs.openSync(wav, 'w'), CH = 4 << 20;
for (let i = 0; i * CH < wavLen; i++) fs.writeSync(fd, Buffer.from(await first.evaluate(([i, CH]) => window.__film.audioChunk(i, CH), [i, CH]), 'base64'));
fs.closeSync(fd);
console.log(`audio mixed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (argv.includes('--audio-only')) { fs.renameSync(wav, out.replace(/\.\w+$/, '.wav')); fs.rmSync(tmp, { recursive: true, force: true }); await browser.close(); process.exit(0); }

const N = Math.ceil((to - from) * fps), per = Math.ceil(N / workers);
let done = 0, lastLog = 0;
const segs = await Promise.all(Array.from({ length: workers }, async (_, w) => {
  const a = w * per, b = Math.min(N, a + per), seg = path.join(tmp, `seg${w}.mp4`);
  if (a >= b) return null;
  const page = w === 0 ? first : await openPage(browser);
  await run(['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-tune', 'film', '-crf', String(crf), '-pix_fmt', 'yuv420p', seg], async (p) => {
    for (let i = a; i < b; i++) {
      await page.evaluate((t) => window.__film.frame(t), from + i / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      if (!p.stdin.write(buf)) await once(p.stdin, 'drain');
      done++;
      if (Date.now() - lastLog > 15000) { lastLog = Date.now(); const el = (Date.now() - t0) / 1000; console.log(`${done}/${N} frames · ${el.toFixed(0)}s elapsed · ~${((N - done) * el / done / 60).toFixed(1)} min left`); }
    }
    p.stdin.end();
  });
  return seg;
}));
await browser.close();

const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s}'`).join('\n'));
await run(['-f', 'concat', '-safe', '0', '-i', list, '-ss', String(from), '-t', String(to - from), '-i', wav,
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  '-metadata', 'title=कर्ण अर्जुन युद्ध', '-metadata', 'language=hin', out]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
