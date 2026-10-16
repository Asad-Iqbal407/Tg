# 🥊 Knockout Arena — 3D Boxing

A complete 3D boxing game that runs in the browser — no install, no build step, no asset files.
Every boxer, the ring, the crowd and every sound effect is generated procedurally with
[three.js](https://threejs.org) and the Web Audio API.

## Run it

```bash
# option 1: just open the file
open index.html            # works from file:// — all scripts are classic <script> tags

# option 2: any static server
npx serve .                # or: python3 -m http.server

# option 3: one self-contained file (e.g. to share / host anywhere)
node tools/build-single.js # -> dist/knockout-arena.html  (add --fragment for a body-only variant)
```

## Game modes

| Mode | What it is |
|------|-----------|
| **Career** | Beat five rivals (Rookie Rick → The Crusher) to win the belt. Each win earns **upgrade points** (+1 extra for a KO) to spend on Power / Speed / Stamina / Chin. |
| **Quick Fight** | Pick any rival, difficulty (Rookie → Champion), 1–12 rounds and round length (0:30 – 3:00). |
| **2-Player Versus** | Two boxers on one keyboard (or two gamepads) with split keyboard layouts. |
| **Training** | An 11-step interactive tutorial against a sparring partner (jab, cross, hooks, uppercuts, body shots, block, slip, dash, combos, FURY). |
| **My Boxer** | 3D avatar creator: name, skin, 9 hair styles + colours, build (slim/average/heavy), stance (orthodox/southpaw), trunks, trim, gloves and boots. Drag to rotate. |

## Controls

Every key can be rebound in **Controls** (two slots per action, separate sets for single player, versus P1 and versus P2).

### Single player (defaults)

| Action | Key |
|--------|-----|
| Step forward / back | `W` / `S` (or ↑ / ↓) |
| Circle left / right | `A` / `D` (or ← / →) |
| Jab (lead hand) | `J` (or left mouse button) |
| Cross (rear hand) | `K` (or right mouse button) |
| Lead hook / Rear hook | `U` / `I` |
| Lead uppercut / Rear uppercut | `N` / `M` |
| Block (hold) | `Space` or `L` |
| Crouch — duck + **body shots** (hold) | `C` |
| Slip left / right | `Q` / `E` |
| Dash (dodge) + direction | `Shift` |
| **FURY** punch (when the meter is full) | `F` |
| Taunt | `T` |
| Pause / camera / controls help / sound | `Esc`·`P` / `Tab` / `H` / `O` |

### Two-player

* **Player 1** — move `WASD`; punches `F G R T V B`; block `Space`; crouch `C`; slip `Q E`; dash `Left Shift`; FURY `X`
* **Player 2** — move arrow keys; punches `, . ; ' [ ]` (or numpad 1 2 4 5 7 8); block `/`; crouch `\`; dash `Right Shift`; FURY `Enter`

### Gamepad (standard layout)

Left stick / D-pad move · `X` jab · `A` cross · `Y` lead hook · `B` rear hook · `LB` / `RB` uppercuts ·
`LT` block · `RT` crouch · right stick ←/→ slip, ↓ dash · `Back` FURY · `D-pad ↓` taunt · `Start` pause.
Menus work with the D-pad, `A` and `B`. In versus mode controller 1 = Player 1, controller 2 = Player 2.

### Touch

On phones and tablets the touch controls appear automatically (force them on/off in Settings):

* **Floating joystick** — put your left thumb anywhere in the left half of the screen; the stick appears under it. Pull back to retreat.
* **Punch buttons** (right thumb): `JAB` and `CROSS` are the big buttons; hooks and uppercuts are labelled L/R by your stance. `SLIP ◀ ▶`, `DASH` and `FURY` sit above them.
* **BLOCK** — tap once to latch the guard (tap again to drop it) or hold it; **DUCK** is hold-to-crouch.
* Tap anywhere to skip the intro. Left-handed layout, haptics and the camera button are in Settings / the pause menu.
* Taps on the empty arena never throw punches, and 2-finger gestures are ignored so the page never zooms mid-fight.

### Mobile performance

* **Quality: Auto** (default) starts at Medium on touch devices and High on desktop and then adapts: an adaptive governor walks a ladder of cheap steps — render resolution, flashes/light beams, shadows, crowd size, 30 fps cap — and remembers the result per device. Pick Low / Medium / High yourself, or enable **Battery saver (30 fps)**, in Settings.
* The drawing buffer is held to a per-tier pixel budget (never above the device pixel ratio), MSAA is skipped on dense screens, and the page throttles itself to 30 fps in menus / pause and on 120 Hz screens.
* Boxers and the hall are merged into a few dozen draw calls, the crowd is chunk-culled and low-poly, particles are instanced, and the WebGL context is restored if the browser drops it.
* On touch the over-the-shoulder camera swings wider so the opponent is never hidden behind your own back, and the picture is shifted into the free space between the thumb controls.

## How the fighting works

* You always face your opponent. Forward/back closes or opens the gap, left/right **orbits** them. Each punch has a reach — whiff and you're open.
* **Head vs body**: standing punches target the head; hold crouch to throw body shots (less damage, big stamina drain). Crouching also ducks head-high straights and hooks.
* **Defence**: *block* soaks damage but drains stamina (empty stamina = guard break) · *slip* beats straights & uppercuts · *duck* beats jabs, crosses & hooks · *dash* has i-frames against everything except FURY.
* **Counters**: hitting someone mid-punch, punishing a whiff, or punching right after a dodge deals bonus damage. Combos get diminishing returns.
* **Stamina** is spent on punches, slips and dashes; tired boxers punch weaker and slower.
* **FURY meter** fills from landing *and* taking hits. When it glows, the FURY punch is a slow, huge, guard-breaking haymaker.
* **Knockdowns**: at 0 health you hit the canvas and the referee counts. Mash any punch button to get up (not before 3). Three knockdowns in a round is a TKO; reach 10 and it's a KO. The standing boxer retreats to a neutral corner.
* **Decisions**: if nobody is stopped, three judges score every round on the 10-point-must system.
* Opponent styles: **brawler**, **outboxer**, **slugger**, **counter-puncher**, **pressure fighter** — each with its own spacing, combos and defence habits, scaled by difficulty (reaction time, aggression, defence, combo skill).

## Project layout

```
index.html            page shell (HUD / touch markup)
css/style.css         all UI styling
vendor/three.min.js   three.js r149 (MIT)
js/util.js            helpers, safe localStorage
js/data.js            punch table, roster, difficulty, palettes, default key bindings
js/audio.js           synthesised SFX, crowd, bell, referee speech, generative music
js/input.js           keyboard (rebindable) / mouse / gamepad / touch -> one intent model
js/profile.js         saved boxer, upgrades, career progress
js/model.js           procedural 3D boxer + referee builder
js/fighter.js         combat state machine + procedural animation (2-bone IK, foot planting)
js/perf.js            quality tiers, pixel budget, adaptive performance governor
js/arena.js           ring, hall, lights, chunked low-poly crowd, jumbotron
js/fx.js              particles + camera director
js/ai.js              AI controller (same intent interface as a human)
js/game.js            fight flow, combat resolution, knockdowns, scoring, training
js/ui.js              HUD, menus, avatar creator, controls screen, settings, results, touch
js/main.js            boot
tools/build-single.js bundle everything into dist/knockout-arena.html (a prebuilt copy is committed)
```

Saved data (boxer, upgrades, career, settings, key bindings) lives in the browser's `localStorage`.
Quality can be changed in **Settings** (Auto adapts by itself).
