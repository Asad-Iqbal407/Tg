# कर्ण अर्जुन युद्ध

महाभारत के कर्ण पर्व पर आधारित एक एनिमेटेड हिंदी फ़िल्म (लगभग ९ मिनट): कुरुक्षेत्र के सत्रहवें दिन कर्ण और अर्जुन का अंतिम युद्ध, दिव्यास्त्रों, बोले गए हिंदी संवादों और पार्श्व-संगीत के साथ।

An animated Hindi short film (about 9 minutes) of the final duel between Karna and Arjuna on the 17th day of Kurukshetra, based on the Karna Parva of Vyasa's Mahabharata. The pictures and the music are generated in the browser. The dialogue is recorded Hindi speech embedded in the page.

## देखें (Watch)

Open `index.html` in a modern browser and press **फ़िल्म देखें**. Keys: `Space` play/pause · `←` `→` 5 seconds · `F` fullscreen.

## What is in the film

- **Characters:** Karna, Arjuna, Shri Krishna, Shalya, the serpent Ashvasena and Parashurama, painted in colour with lip movement that follows their recorded voices.
- **Arrows:** close-ups of each arrow being drawn and loosed, then the hit. Each divine weapon (आग्नेयास्त्र, वरुणास्त्र, वायव्यास्त्र, ऐन्द्रास्त्र, भार्गवास्त्र, नागास्त्र, ब्रह्मास्त्र, अंजलिकास्त्र) gets an on-screen card with its deity, who fired it and its power.
- **Sound:** a score in Raag Bhairavi (tanpura, nagara, shankh, strings, choir, bansuri) plus battle effects, ducked under the dialogue.

## MP4 बनाएँ (Render a video file)

Needs Node 18+, [Playwright](https://playwright.dev) with Chromium, and `ffmpeg`:

```sh
npm install playwright            # once, if it is not installed globally
node tools/render-mp4.mjs karna-arjun-yuddh.mp4             # full film, 1920×1080, 24 fps
node tools/render-mp4.mjs clip.mp4 --from 160 --to 230      # one part
node tools/render-mp4.mjs mix.mp4 --audio-only               # just the soundtrack (writes mix.wav)
node tools/render-mp4.mjs film.mp4 --audio mix.wav           # reuse that soundtrack
```

`node tools/snap.mjs <dir> <seconds...>` saves still frames for checking a shot.

## संवाद (Regenerating the voices)

`python3 tools/make-voices.py` re-records every line of `js/script.js` into `js/voices.js`. It uses espeak-ng for Hindi pronunciation and the MBROLA `in1` Hindi voice, with a different pitch, pace and timbre for each character. On Ubuntu:

```sh
sudo apt-get install espeak-ng mbrola mbrola-in1 sox rubberband-cli ffmpeg python3-numpy
```

## फ़ाइलें (Files)

- `index.html`: the page (title and film)
- `js/engine.js`: drawing (sky, armies, painted characters, horses, chariots, astra effects)
- `js/script.js`: the screenplay: Hindi dialogue, shots, astra cards
- `js/shots.js`: one drawing function per kind of shot
- `js/voices.js`: recorded dialogue (generated)
- `js/audio.js`: Web Audio instruments, effects, score and the offline mix
- `js/player.js`: playback, subtitles, controls and the render hook
- `tools/`: voice generator, still-frame and MP4 renderers
