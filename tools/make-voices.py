#!/usr/bin/env python3
"""Records every dialogue line of the screenplay as Hindi speech and writes js/voices.js.

Pipeline per line: espeak-ng (Hindi pronunciation rules) -> MBROLA in1 (Hindi voice built from
recorded diphones) -> sox/rubberband for each character's pitch, timbre and room -> mono MP3,
embedded as base64 together with a loudness envelope used to animate the speaker's mouth.

Needs: node, espeak-ng, mbrola + mbrola-in1, sox, rubberband, ffmpeg (libmp3lame), numpy.
usage: python3 tools/make-voices.py
"""
import base64, json, math, os, re, subprocess, sys, tempfile, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = '/usr/share/mbrola/in1/in1'

# espeak pitch (0-99) and speed (wpm); timbre <1 = larger, darker voice; semis = final pitch shift
CAST = {
    'N':  dict(pitch=38, speed=128, gap=2, timbre=0.94, semis=-1.0, bass=4, room=0.22),
    'K':  dict(pitch=30, speed=132, gap=1, timbre=0.90, semis=-1.5, bass=6, room=0.18),
    'A':  dict(pitch=52, speed=130, gap=0, timbre=1.00, semis=0.0,  bass=2, room=0.15),
    'KR': dict(pitch=58, speed=124, gap=1, timbre=1.04, semis=0.5,  bass=2, room=0.2),
    'S':  dict(pitch=44, speed=140, gap=0, timbre=0.96, semis=0.0,  bass=1, room=0.15),
    'AS': dict(pitch=22, speed=112, gap=2, timbre=0.84, semis=-3.0, bass=5, room=0.45),
    'P':  dict(pitch=24, speed=118, gap=2, timbre=0.87, semis=-2.0, bass=6, room=0.4),
}


def fnv(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return format(h, '08x')


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def script_lines():
    js = r"""
const fs = require('fs'), vm = require('vm');
const ctx = { console, Math, Object, Array, String, Number, JSON };
vm.createContext(ctx);
for (const f of ['js/engine.js', 'js/script.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
vm.runInContext('globalThis.__out = SCRIPT', ctx);
const out = [];
for (const s of ctx.__out) for (const l of s.L || []) if (Array.isArray(l)) out.push({ who: l[0], text: l[1] });
process.stdout.write(JSON.stringify(out));
"""
    return json.loads(run(['node', '-e', js], cwd=ROOT).stdout)


def speakable(text):
    t = text.replace('—', ', ').replace('–', ', ').replace('...', ', ').replace('…', ', ')
    t = re.sub(r'[“”"\']', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def pho_for(text, v, shout):
    pitch, speed = v['pitch'] + (14 if shout else 0), v['speed'] - (14 if shout else 0)
    out = run(['espeak-ng', '-v', 'mb-in1', '-q', '--pho', '-p', str(pitch), '-s', str(speed), '-g', str(v['gap']), text]).stdout.decode()
    return [ln for ln in out.split('\n') if ln.strip()]


def is_vowel(p):
    return p[0] in 'aeiouAEIOU@'


def fix_pho(lines, tmp):
    """MBROLA has no recording for some sound pairs; patch them until the voice renders cleanly."""
    for it in range(6):
        path = os.path.join(tmp, 'l.pho')
        open(path, 'w').write('\n'.join(lines) + '\n')
        r = subprocess.run(['mbrola', '-e', DB, path, os.path.join(tmp, 'x.wav')], capture_output=True, text=True)
        bad = {pr for pr in re.findall(r'Warning: (\S+)-(\S+) unknown', r.stderr) if '_' not in pr}
        if not bad:
            return lines
        out, changed = [], False
        for ln in lines:
            parts = ln.split()
            prev = out[-1].split()[0] if out else None
            if prev is not None and (prev, parts[0]) in bad:
                a, b = prev, parts[0]
                changed = True
                if b.endswith('~'):                      # nasal vowel: oral vowel plus a light n
                    parts[0] = b[:-1]; out.append(' '.join(parts)); out.append('n 35'); continue
                if a.endswith('~'):
                    q = out[-1].split(); q[0] = a[:-1]; out[-1] = ' '.join(q)
                elif is_vowel(a) and is_vowel(b):        # vowel meets vowel: let the first one carry on
                    q = out[-1].split(); q[1] = str(int(q[1]) + int(parts[1])); out[-1] = ' '.join(q[:2]); continue
                elif not is_vowel(a) and not is_vowel(b) and it < 2:
                    out.append('a 22')                    # break the cluster with a short schwa
                else:
                    out.append('_ 12')
            out.append(' '.join(parts))
        lines = out
        if not changed:
            break
    return lines


def wav_np(path):
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return x, w.getframerate()


def make(entry, tmp):
    who, text = entry['who'], entry['text']
    v = CAST[who]
    shout = text.strip().endswith('!') and len(text) < 26
    lines = fix_pho(pho_for(speakable(text), v, shout), tmp)
    pho = os.path.join(tmp, 'l.pho')
    open(pho, 'w').write('\n'.join(lines) + '\n')
    raw, s1, s2, fx = (os.path.join(tmp, n) for n in ('raw.wav', 's1.wav', 's2.wav', 'fx.wav'))
    run(['mbrola', '-e', DB, pho, raw])
    tb = v['timbre']
    # change timbre: resample (moves pitch + formants), then put pitch back keeping the new formants
    run(['sox', raw, '-r', '44100', s1, 'speed', f'{tb:.3f}'])
    semis = -12 * math.log2(tb) + v['semis']
    run(['rubberband', '-q', '-F', '-p', f'{semis:.2f}', '-t', f'{tb:.3f}', s1, s2])
    chain = ['bass', str(v['bass'] + (2 if shout else 0)), 'treble', '2', 'compand', '0.02,0.2', '6:-60,-40,-20,-8', '-4', '-60', '0.05']
    if v['room']:
        chain += ['reverb', str(int(v['room'] * 100)), '50', '60', '100', '6']
    run(['sox', s2, '-c', '1', fx, 'pad', '0.06', '0.12', *chain, 'norm', '-2'])
    if who == 'AS':  # serpent: add a breathy hiss layer under the voice
        hiss = os.path.join(tmp, 'hiss.wav'); dur = float(run(['soxi', '-D', fx]).stdout)
        run(['sox', '-n', '-r', '44100', '-c', '1', hiss, 'synth', f'{dur:.3f}', 'pinknoise', 'highpass', '3500', 'vol', '0.05'])
        mixed = os.path.join(tmp, 'mix.wav'); run(['sox', '-m', fx, hiss, mixed, 'norm', '-2']); fx = mixed
    x, sr = wav_np(fx)
    win = int(sr * 0.04)
    env = np.array([np.sqrt(np.mean(x[i:i + win] ** 2)) for i in range(0, len(x), win)])
    env = np.clip(env / (env.max() + 1e-9) * 1.25, 0, 1)
    mp3 = os.path.join(tmp, 'v.mp3')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', fx, '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '40k', mp3])
    return dict(d=round(len(x) / sr, 3), e=''.join(str(min(9, int(e * 9.99))) for e in env), a=base64.b64encode(open(mp3, 'rb').read()).decode())


def main():
    entries, seen = [], set()
    for e in script_lines():
        k = e['who'] + '_' + fnv(e['text'])
        if k not in seen:
            seen.add(k); entries.append((k, e))
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, (k, e) in enumerate(entries):
            out[k] = make(e, tmp)
            print(f'{i + 1:2d}/{len(entries)} {k} {out[k]["d"]:.2f}s  {e["text"][:40]}', flush=True)
    body = ',\n'.join(f'  "{k}": {{ d: {v["d"]}, e: "{v["e"]}", a: "{v["a"]}" }}' for k, v in out.items())
    src = ("'use strict';\n/* संवाद — recorded Hindi dialogue, generated by tools/make-voices.py (MBROLA in1 voice).\n"
           "   key = speaker + '_' + FNV-1a hash of the line; d = seconds; e = mouth envelope per 40 ms (0-9); a = MP3 (base64). */\n"
           f"const VOICES = {{\n{body}\n}};\n")
    open(os.path.join(ROOT, 'js', 'voices.js'), 'w', encoding='utf-8').write(src)
    total = sum(v['d'] for v in out.values())
    print(f'wrote js/voices.js: {len(out)} lines, {total:.0f}s of speech, {len(src) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
