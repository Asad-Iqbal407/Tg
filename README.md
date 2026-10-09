# Super Pip Adventure

A side-scrolling platformer in the spirit of the classic 2D platform games, with an original hero (**Pip the fox explorer**), original enemies, procedurally drawn art and synthesized chiptune music. No external image or audio assets are used — everything is drawn and generated in code.

**Play:** open `index.html` in any modern browser (no build step, no server needed). Or serve the folder, e.g. `npx http-server .`

## Features

**7 stages across 6 themed worlds**
| Stage | Name | Highlights |
|---|---|---|
| 1-1 | Meadow Hills | Tutorial-friendly hills, tubes, hidden 1UP block |
| 1-2 | Burrow Caverns | Dynamic darkness with glowing crystals, moving platforms, bats |
| 2-1 | Sunscorch Dunes | Seed cannons, cactus spikes, pyramids, falling platforms |
| 2-2 | Frostbite Peaks | Slippery ice physics, falling icicles, aurora sky |
| 3-1 | Skyward Gardens | Floating islands, bottomless pits, platform chains |
| 3-2 | Magmaw Keep | Lava, stone crushers, lava bubbles and a **boss fight** |
| ★ | Starlight Vault | Secret bonus stage, unlocked by finding 12 medals |

**Moves:** variable-height jump, run, skid, coyote time & jump buffering, ground-pound (smashes bricks), stomp combos.

**Power-ups:** Sun Berry (grow), Ember Bloom (throw bouncing fireballs), Sky Feather (double jump + glide), Star Shard (invincibility), 1UP hearts.

**Enemies:** Blobs, Shellbugs (kickable shells that chain-kill), Spikies, Hoppers, Bats, Snapvines, Crushers, Seed cannons, Lava bubbles, Icicles, and the boss **Magmaw**.

**Reward system**
- Score with stomp-chain multipliers (8+ chain = 1UP), 100 coins = 1UP, time bonus, flag-height bonus
- 3 hidden **star medals** per stage and **3 stars** per stage (clear · all medals · beat par time)
- Persistent **coin wallet**, first-clear and new-star bonuses
- **Adventurer Rank** XP levels with coin rewards per rank-up
- **Shop**: Extra Hearts, Sun Berry Start, Coin Magnet (3 levels), Bubble Shield, Cloud Boots (double jump), Hourglass (+time)
- **Outfits**: 5 unlockable skins for Pip
- **18 achievements** with claimable coin rewards
- **Daily reward** streak calendar (7-day cycle)
- Progress saved automatically in `localStorage`

**Presentation:** parallax backgrounds, animated tiles, particles (dust, debris, sparkles, fireworks, snow, embers, petals), lighting in dark stages, screen shake, squash & stretch, per-theme music, stage banners, results screen with animated stars.

**Controls**
| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | ← → / A D | Stick / D-pad | ◀ ▶ |
| Jump (hold = higher) | Space / ↑ / W / Z | A | A |
| Run / throw fireball | Shift / X / J | X / RT | B |
| Ground-pound | ↓ / S in mid-air | ↓ | ▼ |
| Pause | Esc / P | Start | ❚❚ |

## Code layout
```
index.html        screens & touch controls
css/style.css     UI styling
js/util.js        helpers
js/audio.js       WebAudio sound effects + music sequencer (original tunes)
js/levels.js      level builder + stage definitions
js/save.js        progression: shop, skins, achievements, XP, daily rewards
js/art.js         procedural art: tiles, backgrounds, characters, items
js/entities.js    player, enemies, items, platforms
js/game.js        physics, camera, rendering, HUD, stage flow
js/ui.js          menus, map, shop, results
js/main.js        input (keyboard/touch/gamepad) + fixed-timestep loop
```
