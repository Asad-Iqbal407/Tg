# कर्ण अर्जुन युद्ध

महाभारत के कर्ण पर्व पर आधारित एक एनिमेटेड हिंदी फ़िल्म (लगभग ९ मिनट): कुरुक्षेत्र के सत्रहवें दिन कर्ण और अर्जुन का अंतिम युद्ध, दिव्यास्त्रों, हिंदी संवादों और पार्श्व-संगीत के साथ।

An animated Hindi short film (about 9 minutes) of the final duel between Karna and Arjuna on the 17th day of Kurukshetra, based on the Karna Parva of Vyasa's Mahabharata. Everything (pictures, music and sound) is generated in the browser. There are no image or audio files.

## देखें (Watch)

Open `index.html` in a modern browser (Chrome, Edge, Safari or Firefox) and press **फ़िल्म देखें**. Headphones help.

- **हिंदी आवाज़**: dialogue is read aloud by your device's own Hindi speech voice (Google हिन्दी on Android/Chrome, Lekha on Apple devices, Hemant/Kalpana on Windows). If the device has no Hindi voice, the dialogue still appears as subtitles.
- Keys: `Space` play/pause · `←` `→` 5 seconds · `F` fullscreen · `C` subtitles · `V` voice.
- The chapter list under the player jumps to any of the ten chapters.

## अध्याय (Chapters)

| # | अध्याय | What happens |
|---|---|---|
| १ | प्रस्तावना | Day 17; Bhishma has fallen, Drona is dead, Karna commands the Kauravas |
| २ | सत्रहवाँ दिन | Dawn, the conches Panchajanya and Devadatta, title |
| ३ | दो महारथी | Arjuna and Karna ride out; Shalya's taunts; Krishna's warning |
| ४ | पहला प्रहार | First exchange; "वाह कर्ण, वाह!" |
| ५ | दिव्यास्त्रों का युद्ध | Agneyastra, Varunastra, Vayavyastra, Aindrastra, Bhargavastra |
| ६ | नागास्त्र | Ashvasena's serpent arrow; Krishna presses the chariot down; the crown falls |
| ७ | शाप | The wheel sinks; Karna forgets the Brahmastra; Parashurama's curse (flashback) |
| ८ | धर्म का प्रश्न | Karna appeals to dharma; Krishna: "क्व ते धर्मस्तदा गतः" |
| ९ | अंजलिकास्त्र | Arjuna's vow and the final arrow |
| १० | सूर्य में विलीन | Karna's light enters the sun |

## अस्त्र (The weapons in the film)

| अस्त्र | देवता / स्रोत | चलाया | शक्ति |
|---|---|---|---|
| आग्नेयास्त्र | अग्निदेव | अर्जुन | rains fire from the sky |
| वरुणास्त्र | वरुणदेव | कर्ण | clouds and torrents that quench fire |
| वायव्यास्त्र | वायुदेव | अर्जुन | a gale that tears the clouds apart |
| ऐन्द्रास्त्र | देवराज इन्द्र | अर्जुन | thousands of arrows with thunder |
| भार्गवास्त्र | परशुराम | कर्ण | cuts down the Aindrastra; devastates the Panchala ranks |
| नागास्त्र (सर्पमुख बाण) | नाग अश्वसेन | कर्ण | a serpent hidden in the arrow; knocked off Arjuna's crown |
| ब्रह्मास्त्र | ब्रह्मा | कर्ण (failed) | forgotten through Parashurama's curse |
| अंजलिकास्त्र | — | अर्जुन | the final arrow that slew Karna |

The page also covers Gandiva, Vijaya, the chariot flags (Hanuman, Hastikakshya), the conches, and what is taken from Vyasa versus folk tradition (the "वाह कर्ण" episode is folk tradition).

## MP4 बनाएँ (Render a video file)

Needs Node 18+, [Playwright](https://playwright.dev) with Chromium, and `ffmpeg`:

```sh
npm install playwright            # once, if it is not installed globally
node tools/render-mp4.mjs karna-arjun-yuddh.mp4             # full film, 1920×1080, 24 fps
node tools/render-mp4.mjs clip.mp4 --from 160 --to 230      # one part
```

The MP4 has the music, sound effects and burned-in Hindi subtitles. It has no spoken dialogue, because the voice comes from the viewer's browser.

`node tools/snap.mjs <dir> <seconds...>` saves still frames, which is handy for checking a shot.

## फ़ाइलें (Files)

- `index.html`: the page, player and reference sections
- `js/engine.js`: drawing primitives (sky, armies, horses, chariots, busts, astra effects)
- `js/script.js`: the screenplay: Hindi dialogue, shot list, chapters, astra data
- `js/shots.js`: one drawing function per kind of shot
- `js/audio.js`: Web Audio instruments (tanpura, nagara, shankh, strings, choir, bansuri), sound effects and the score
- `js/player.js`: playback, overlays, Hindi voice, controls and the render hook
- `tools/`: still-frame and MP4 renderers
