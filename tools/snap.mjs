// Renders stills of the film at given timestamps (seconds) for visual checks.
// usage: node tools/snap.mjs <outdir> <t1> <t2> ...   (or "shots" to grab the middle of every shot)
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright'); // resolved via NODE_PATH or a local install

const [outDir, ...args] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { window.__RENDER__ = true; });
await page.goto(pathToFileURL(path.resolve('index.html')).href);
await page.waitForFunction(() => window.__filmReady === true, null, { timeout: 30000 });
let times = args.map(Number);
if (args[0] === 'shots') times = await page.evaluate(() => TL.shots.map((s) => +(s.start + s.dur * 0.55).toFixed(2)));
const info = await page.evaluate(() => ({ dur: TL.dur, shots: TL.shots.map((s) => [s.type, s.mode || s.who || s.kind || '', +s.start.toFixed(1), +s.dur.toFixed(1)]) }));
console.log('duration', info.dur.toFixed(1));
const frame = await page.$('#frame');
for (const t of times) {
  await page.evaluate((t) => window.__film.frame(t), t);
  await frame.screenshot({ path: path.join(outDir, `t${String(t.toFixed(1)).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 80 });
}
console.log(JSON.stringify(info.shots));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
