# Neon Arcade

A browser arcade with eight original canvas games and one shared progression and reward system.
The browser app has no runtime dependencies. All graphics and sound are generated in code, so there are no
image or audio files to download, and it keeps working offline after the first visit. Players can
optionally create an account, which syncs their progress through a small API backed by MongoDB Atlas.

| Game              | Genre (inspired by)                       | Highlights                                                                                         |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Metro Dash**    | Endless 3-lane runner (_Subway Surfers_)  | Pseudo-3D track, ramps onto train roofs, oncoming trains, magnet / 2× / super-jump / jetpack       |
| **Pixel Quest**   | Side-scrolling platformer (_Super Mario_) | Levels assembled from hand-built chunks, coyote time and jump buffering, stomps, shells, fireballs |
| **Duck Season**   | Shooting gallery (_Duck Hunt_)            | Rounds of 10 ducks, combos, double kills, golden ducks, slow-mo and scatter-shot crates            |
| **Hill Rider**    | Physics driving (_Hill Climb Racing_)     | Verlet soft-body suspension, fuel, flips and air time, four biomes including a low-gravity Moon    |
| **Galaxy War**    | Vertical shoot-'em-up (_Galaga_)          | Five weapon levels, bombs, chain multipliers, formations and a Mothership boss every fifth wave    |
| **Snake Classic** | Grid snake (_Nokia Snake_)                | Queued turns, golden apples that slow time, new walls every few apples, a Guardian shield          |
| **Bomb Squad**    | Bomb arena (_BombSquad_)                  | Lay bombs on the floor and kick them with punch, crates, walker and bomber bots, waves and items   |
| **Block Drop**    | Falling-block puzzle (_Tetris_)           | Seven-bag randomiser, hold, ghost piece, wall kicks, lock delay and endless levels                 |

All characters, names, pixel art and sounds are original. The games are inspired by those
classics and are not affiliated with them.

## Reward system

Every run feeds one profile:

- **Coins**: coins collected in the game, plus a conversion of your score. Spend them in the shop.
- **XP and levels**: XP comes from score. Each level-up pays coins, and every fifth level also pays gems.
- **Gems**: the premium currency. You earn them from level-ups, achievements, hard missions and login streaks.
- **Daily login**: a 7-day reward calendar. The streak resets if you miss a day.
- **Daily missions**: three a day (easy, medium and hard), the same set for everyone on a given date.
- **38 achievements** in bronze, silver, gold and platinum tiers, each paying coins and gems.
- **Shop**:
  - **Skins**: 32, four per game. Hill Rider vehicles and Galaxy War ships also change handling and stats.
  - **Boosts**: four single-use items. Coin Doubler, XP Booster, Guardian (a one-time save that works differently in each game) and Power Start.
  - **Upgrades**: four permanent upgrades. Lucky Charm (more coins), Scholar (more XP), Overclock (longer power-ups) and Loyalty Card (bigger daily rewards).
- **Hall of Fame**: your top 10 runs per game.

Rewards are always banked, whether you finish, quit or restart. A run shorter than 3 seconds with
no score isn't recorded, so missions and achievements can't be farmed by starting and quitting.

## Accounts and cloud saves

You can play as a guest. Guest progress stays in this browser's `localStorage`, as it always has, and
the game works the same without an account. Create an account to keep your progress on the server and
use it on other devices.

- **Accounts** need a username (3 to 20 letters, digits or underscores) and a password (10 to 128
  characters). The server stores a salted scrypt hash of the password, never the password itself.
- **Signing in** loads your saved profile. If this device has progress that your account has never
  seen, the game asks which copy to keep. Creating an account keeps this device's progress and uploads it.
- **Sync** sends profile changes shortly after you stop making them. While you are offline, changes stay
  on the device and are sent when the connection returns.
- **Runs** are posted to your account when they finish, while you are signed in. A run that cannot be
  posted waits for a retry. Up to 50 runs can wait; past that, the oldest is dropped.
- **Leaderboards**: the Hall of Fame shows your best runs for each game, and the global top 10 for each
  game comes from the server.
- **Signing out** stops syncing on this device and keeps the profile here as a guest profile. Runs still
  waiting to be posted for that account are discarded.

Without the API, the game still works as a guest, and the account features are unavailable.

## API

The API is an Express server in `server/`, with MongoDB Atlas for storage. The browser and the server
share one contract, `shared/api.ts`, which defines every route, request, response and error code. Every
route is under `/api`. The main ones:

| Method | Path                       | Purpose                                                                         |
| ------ | -------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/health`              | 200 when the database answers, 503 when it does not                             |
| POST   | `/api/register`            | Create an account and start a session                                           |
| POST   | `/api/login`               | Start a session                                                                 |
| POST   | `/api/logout`              | End the session                                                                 |
| GET    | `/api/session`             | The signed-in user, or `null`                                                   |
| GET    | `/api/profile`             | The saved profile and its version                                               |
| PUT    | `/api/profile`             | Save the profile. A stale version gets 409 and nothing is stored                |
| POST   | `/api/runs`                | Post a finished run. Sending the same `clientRunId` again is not recorded twice |
| GET    | `/api/runs?limit=N`        | Your most recent runs                                                           |
| GET    | `/api/leaderboard/:gameId` | The top 10 scores for one game, across all players                              |

The session is an httpOnly cookie. The full request and response shapes, error codes, validation
rules and data model are in [server/README.md](server/README.md).

### Limits

- **Scores are client-reported.** The server checks that each value is in range, but it cannot verify a
  run without replaying the game. Treat the leaderboards as a friendly board, not as proof of skill.
- **Rate limits are per instance.** Register and login allow 10 attempts per 15 minutes, counted per
  client address and per username. Each process counts its own requests, so N replicas allow N times
  the limit. A global limit needs a shared store.
- **Runs and profile saves have no quota yet.** Only register and login are rate limited. Add a per-user
  limit before a public launch.

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

| Script                 | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Vite dev server with hot reload. Forwards `/api` to the API on port 8787 |
| `npm run build`        | Type-check, then produce an optimized build in `dist/`                   |
| `npm run preview`      | Serve the production build locally, with the same `/api` forwarding      |
| `npm run server:dev`   | The API with reload (`tsx watch`). Reads `.env` when present             |
| `npm run server:build` | Compile the API to `dist-server/`                                        |
| `npm run server:start` | Run the compiled API (`node dist-server/server/index.js`)                |
| `npm test`             | Run the Vitest suite                                                     |
| `npm run lint`         | ESLint with typescript-eslint                                            |
| `npm run typecheck`    | `tsc` for the app, the build config and the API                          |
| `npm run format`       | Prettier                                                                 |
| `npm run check`        | Lint, type-check, test and build: everything CI runs                     |

### Controls

| Action           | Keyboard           | Gamepad      | Touch                        |
| ---------------- | ------------------ | ------------ | ---------------------------- |
| Move / steer     | Arrows or WASD     | D-pad, stick | Swipe / drag / on-screen pad |
| Primary action   | Space, Enter, Z, J | A, RT        | A button / tap               |
| Secondary action | Shift, X, K, B     | B, X, LT     | B / BOMB button              |
| Pause            | Esc, P             | Start        | Pause button                 |
| Mute             | M                  |              | Speaker button               |

## Local development

Pick the setup that matches what you are working on. The first needs no database and no API.

**Browser only.** `npm run dev` serves the game at http://localhost:5173. Guests can play, but accounts
have no server to talk to.

**With the API, without a database.** Set `DATA_STORE=memory`. Accounts and runs are kept in memory and
disappear when the server stops.

```bash
DATA_STORE=memory npm run server:dev   # API on http://localhost:8787
npm run dev                            # second terminal; /api is forwarded to port 8787
```

**With the API and Atlas.** Copy `.env.example` to `.env` (git ignores it), set `MONGODB_URI` to your
connection string (see [MongoDB Atlas setup](#mongodb-atlas-setup)) and set `APP_ORIGIN=http://localhost:5173`,
because the Vite server is on that port.

```bash
cp .env.example .env
npm run server:dev
npm run dev
```

The API reads `.env` from the directory it runs in, but only when `NODE_ENV` is not `production`.
Variables already set in the environment win over the file. Keep `.env` out of git and out of images.

To run the compiled API the way production does:

```bash
npm run server:build
npm run server:start     # reads .env too; needs MONGODB_URI unless DATA_STORE=memory
```

For a production run, also set `NODE_ENV=production` and `APP_ORIGIN`. The file is then not read, so the
environment must hold every setting.

**Tests.** `npm test` needs no database. The repository contract runs against the in-memory store. Set
`MONGODB_TEST_URI` to run the same contract against Atlas. The test creates a database with a random name
and drops it at the end, so use a test cluster or a user that may create databases.

## Environment variables

The API reads its settings from the environment and checks them at startup. A problem stops the process
before it listens, and the message names each problem without showing a value. `.env.example` lists every
name with a placeholder, and [server/README.md](server/README.md) explains each one.

| Variable        | Default                 | Purpose                                                                                           |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`   | none                    | Atlas connection string. Required unless `DATA_STORE=memory`. Keep it secret.                     |
| `MONGODB_DB`    | `neon_arcade`           | Database name.                                                                                    |
| `DATA_STORE`    | `mongo`                 | `mongo`, or `memory` for development. Not allowed in production.                                  |
| `APP_ORIGIN`    | `http://localhost:5173` | The origin users load the app from, such as `https://arcade.example.com`. Required in production. |
| `COOKIE_SECURE` | `true` in production    | Adds `Secure` to the session cookie. Set it to `true` for any HTTPS site.                         |
| `TRUST_PROXY`   | `true` in production    | Trusts one proxy hop for the client address. Only turn it on behind a proxy.                      |
| `PORT`          | `8787`                  | Port the API listens on.                                                                          |
| `HOST`          | `0.0.0.0`               | Address the API listens on.                                                                       |
| `NODE_ENV`      | `development`           | `development`, `test` or `production`.                                                            |

## MongoDB Atlas setup

1. **Create a cluster.** Use any Atlas cluster that is a replica set. The free M0 tier is one. The profile
   save uses a transaction, and transactions need a replica set.
2. **Create a database user that can write to one database.** In Database Access, add a user with password
   authentication. Give it the **readWrite** role on the `neon_arcade` database only. Do not give it
   `atlasAdmin` or access to other databases.
3. **Allow the address of the host that runs the API.** In Network Access, add the public address of the
   machine or platform. Do not add `0.0.0.0/0` unless your platform gives no fixed address. That is a
   choice: it lets any address try to connect, so the database password becomes the only protection.
4. **Store the connection string as a secret.** In Connect, choose Drivers and copy the `mongodb+srv://`
   string. Replace `<password>` with the user's password, then set the result as `MONGODB_URI` in your
   platform's secret store. For local runs, put it in a `.env` file that git ignores. Treat the string as
   a password. Never commit it, paste it into an issue or put it in a Dockerfile.
5. **Leave `MONGODB_DB` at `neon_arcade`** (the default), so the user's `readWrite` role covers it. The API
   creates its indexes each time it starts. Creating an index that already exists does nothing.

## Deployment

The build is a static site with relative paths, so it can be served from any folder (GitHub Pages, S3, a CDN,
or nginx). Those hosts serve the game only. Guests can still play there, but accounts need the API. Two
caching rules matter:

- `assets/*` file names are content-hashed. Cache them for a year with `immutable`.
- `index.html` and `sw.js` must be revalidated (`Cache-Control: no-cache`) so new deploys roll out.

### Docker

```bash
docker build -t neon-arcade .
docker run -p 8080:8080 neon-arcade   # http://localhost:8080, health check at /healthz
```

The image is a two-stage build. Node builds the site and `nginx-unprivileged` serves it.
`deploy/nginx.conf` sets the cache rules, gzip and SPA fallback, blocks source maps, and adds
the security headers from `deploy/security-headers.conf`. Run on its own, the image serves the game,
and requests to `/api` get a 502 until an `api` service exists.

### Docker Compose: site and API

```bash
cp .env.example .env         # then replace the placeholder MONGODB_URI
docker compose up --build    # http://localhost:8080
```

`compose.yaml` runs two services:

- **`web`** is the image above, published on port 8080. nginx forwards `/api/` to `api` and sets
  `X-Forwarded-For` from the address it sees. It starts after `api`.
- **`api`** is built from `Dockerfile.api`. It runs as the non-root `node` user with production dependencies
  only, and listens on port 8787 inside the compose network. It is not published. It reads `.env`, so
  `MONGODB_URI` must be set there. Its health check calls `/api/health`.

Set `APP_ORIGIN` in `.env` to the public address when you deploy somewhere else. Compose serves plain HTTP
on port 8080, so put a TLS-terminating proxy in front of a public site, and set `COOKIE_SECURE=true`.
`TRUST_PROXY` assumes exactly one proxy hop. A second proxy in front of compose makes the API count that
proxy's address as the client for every request, so the register and login limit is shared by all users.

### CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It checks formatting,
lint, types, tests and the build, uploads `dist/` as an artifact, then builds the Docker image,
starts it and checks the response headers. A second job, `api`, compiles the server, builds
`Dockerfile.api` and starts the image in memory mode to check `/api/health`. The Atlas integration test
is skipped in CI, because it needs `MONGODB_TEST_URI`.

## Architecture

```
src/
  core/        engine (fixed-step loop, DPI-aware viewport), input, audio synth, storage, fx, rng, math
  games/       one folder per game + shared base class, drawing helpers and pixel-sprite system
    types.ts   the GameDefinition / GameInstance contract every game implements
    registry.ts
  meta/        reward economy: profile schema & sanitizer, progression, catalog, achievements,
               missions, daily rewards, reward math, and ArcadeService (the domain API)
    cloud/     account sync: typed API client, offline run queue, profile sync and sign-in
  ui/          DOM shell (hash router, header, nav), screens, lobby, play screen, results, overlays
  styles/      design tokens and component styles
server/        the API: routes, auth, MongoDB and in-memory repositories (see server/README.md)
shared/
  api.ts       the HTTP contract that the browser and the server both import
scripts/sw-template.js   service worker, filled in at build time by the plugin in vite.config.ts.
                         API requests always go to the network and are never cached
tests/                   unit, integration and headless game tests, and the API tests in tests/server
deploy/                  nginx configuration
Dockerfile               the static site image
Dockerfile.api           the API image
compose.yaml             the site and the API together
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
