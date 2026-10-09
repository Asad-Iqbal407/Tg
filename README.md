# Neon Arcade

A browser arcade with five original canvas games and one shared progression and reward system.
It has no runtime dependencies. All graphics and sound are generated in code, so there are no
image or audio files to download, and it keeps working offline after the first visit.

| Game            | Genre (inspired by)                       | Highlights                                                                                         |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Metro Dash**  | Endless 3-lane runner (_Subway Surfers_)  | Pseudo-3D track, ramps onto train roofs, oncoming trains, magnet / 2× / super-jump / jetpack       |
| **Pixel Quest** | Side-scrolling platformer (_Super Mario_) | Levels assembled from hand-built chunks, coyote time and jump buffering, stomps, shells, fireballs |
| **Duck Season** | Shooting gallery (_Duck Hunt_)            | Rounds of 10 ducks, combos, double kills, golden ducks, slow-mo and scatter-shot crates            |
| **Hill Rider**  | Physics driving (_Hill Climb Racing_)     | Verlet soft-body suspension, fuel, flips and air time, four biomes including a low-gravity Moon    |
| **Galaxy War**  | Vertical shoot-'em-up (_Galaga_)          | Five weapon levels, bombs, chain multipliers, formations and a Mothership boss every fifth wave    |

All characters, names, pixel art and sounds are original. The games are inspired by those
classics and are not affiliated with them.

## Reward system

Every run feeds one profile:

- **Coins**: coins collected in the game, plus a conversion of your score. Spend them in the shop.
- **XP and levels**: XP comes from score. Each level-up pays coins, and every fifth level also pays gems.
- **Gems**: the premium currency. You earn them from level-ups, achievements, hard missions and login streaks.
- **Daily login**: a 7-day reward calendar. The streak resets if you miss a day.
- **Daily missions**: three a day (easy, medium and hard), the same set for everyone on a given date.
- **27 achievements** in bronze, silver, gold and platinum tiers, each paying coins and gems.
- **Shop**:
  - **Skins**: 20, four per game. Hill Rider vehicles and Galaxy War ships also change handling and stats.
  - **Boosts**: four single-use items. Coin Doubler, XP Booster, Guardian (a one-time save that works differently in each game) and Power Start.
  - **Upgrades**: four permanent upgrades. Lucky Charm (more coins), Scholar (more XP), Overclock (longer power-ups) and Loyalty Card (bigger daily rewards).
- **Hall of Fame**: your top 10 runs per game.

Rewards are always banked, whether you finish, quit or restart. A run shorter than 3 seconds with
no score isn't recorded, so missions and achievements can't be farmed by starting and quitting.

## Platform features

- Fixed-timestep game loop (60 Hz simulation on any refresh rate). The simulation is deterministic and covered by tests.
- Input from keyboard, mouse, touch (swipes and on-screen buttons) and gamepads.
- Pause automatically when the tab is hidden or loses focus. Fullscreen mode. FPS counter.
- Synthesized sound effects and procedural chiptune music for each game, with separate volume controls.
- Accessibility: keyboard navigation, focus-trapped dialogs, reduced-motion mode (it also respects
  `prefers-reduced-motion`), live-region toasts and a skip link.
- Saves are versioned and validated, with migrations. They are synced across tabs and can be
  exported and imported, and corrupted or tampered data is repaired instead of crashing the app.
- Installable PWA. The service worker generated at build time precaches every built asset.
- Hardened delivery: strict CSP (no inline scripts or styles), security headers, immutable caching
  for hashed assets, and nginx running as an unprivileged user.

## Getting started

Requires Node.js 20.19 or newer (22 recommended).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Vite dev server with hot reload                        |
| `npm run build`     | Type-check, then produce an optimized build in `dist/` |
| `npm run preview`   | Serve the production build locally                     |
| `npm test`          | Run the Vitest suite                                   |
| `npm run lint`      | ESLint with typescript-eslint                          |
| `npm run typecheck` | `tsc` for the app and the build config                 |
| `npm run format`    | Prettier                                               |
| `npm run check`     | Lint, type-check, test and build: everything CI runs   |

### Controls

| Action           | Keyboard           | Gamepad      | Touch                        |
| ---------------- | ------------------ | ------------ | ---------------------------- |
| Move / steer     | Arrows or WASD     | D-pad, stick | Swipe / drag / on-screen pad |
| Primary action   | Space, Enter, Z, J | A, RT        | A button / tap               |
| Secondary action | Shift, X, K, B     | B, X, LT     | B / BOMB button              |
| Pause            | Esc, P             | Start        | Pause button                 |
| Mute             | M                  |              | Speaker button               |

## Deployment

The build is a static site with relative paths, so it can be served from any folder (GitHub Pages, S3, a CDN,
or nginx). Two caching rules matter:

- `assets/*` file names are content-hashed. Cache them for a year with `immutable`.
- `index.html` and `sw.js` must be revalidated (`Cache-Control: no-cache`) so new deploys roll out.

### Docker

```bash
docker build -t neon-arcade .
docker run -p 8080:8080 neon-arcade   # http://localhost:8080, health check at /healthz
```

The image is a two-stage build. Node builds the site and `nginx-unprivileged` serves it.
`deploy/nginx.conf` sets the cache rules, gzip and SPA fallback, blocks source maps, and adds
the security headers from `deploy/security-headers.conf`.

### CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It checks formatting,
lint, types, tests and the build, uploads `dist/` as an artifact, then builds the Docker image,
starts it and checks the response headers.

## Architecture

```
src/
  core/        engine (fixed-step loop, DPI-aware viewport), input, audio synth, storage, fx, rng, math
  games/       one folder per game + shared base class, drawing helpers and pixel-sprite system
    types.ts   the GameDefinition / GameInstance contract every game implements
    registry.ts
  meta/        reward economy: profile schema & sanitizer, progression, catalog, achievements,
               missions, daily rewards, reward math, and ArcadeService (the domain API)
  ui/          DOM shell (hash router, header, nav), screens, lobby, play screen, results, overlays
  styles/      design tokens and component styles
scripts/sw-template.js   service worker, filled in at build time by the plugin in vite.config.ts
tests/                   unit, integration and headless game tests
deploy/                  nginx configuration
```

- **Games don't know about the meta-game.** A game gets a `GameServices` object (canvas, input,
  audio, seeded RNG and loadout) and reports a `GameResult` (score, coins, per-run stats).
  `ArcadeService.finishRun` turns that result into rewards, records, mission progress and achievements.
- **Stats drive goals.** Each per-run stat (for example `distance` or `stomps`) is aggregated into
  lifetime totals (`runner.distance`) and single-run bests. Achievements and missions are plain
  data that point at those keys, so adding a goal never touches game code.
- **Headless-friendly.** Games only touch the canvas through the 2D context, so the test suite
  runs every game in Node against a mock context. It drives 90 seconds of random input, checks
  every boost and skin, and checks that the same seed and inputs give the same result.

### Adding a game

1. Create `src/games/<id>/` with a class that extends `BaseGame` (implement `tick` and `render`)
   and an `index.ts` that exports a `GameDefinition`.
2. Add the id to `GameId` / `GAME_IDS` in `src/games/types.ts` and register it in `src/games/registry.ts`.
3. Add a free default skin, and optionally premium ones, to `src/meta/catalog.ts`.
4. Optionally add achievements and mission templates that use the stats your game reports.

The fuzz, determinism and catalog tests then cover the new game automatically.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). Everything needs Canvas 2D; audio
uses the Web Audio API and the game still plays without it.

## License

Apache-2.0. See [LICENSE](LICENSE).
