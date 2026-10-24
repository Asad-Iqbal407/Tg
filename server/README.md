# Neon Arcade API

The API server stores player accounts, profile snapshots, game runs, the reward ledger and the
leaderboards. The browser game works without it: guests keep their progress in `localStorage`, and
signing in syncs the profile here.

- Runtime: Node.js 20.19 or later, Express 5, the official MongoDB driver, zod for request validation.
- Storage: MongoDB Atlas (replica set, so transactions are available), or an in-memory store for development.
- Contract: every route, request and response type lives in `shared/api.ts`. This server must match it.

## Running it

Development with no database, which keeps all data in memory until the process exits:

```sh
DATA_STORE=memory npm run server:dev
```

Development against Atlas. Put the settings in a `.env` file in the repository root. It is read only when
`NODE_ENV` is not `production`, and variables already set in the environment win over it. Never commit it.

```sh
# .env (placeholders only; use your own cluster, user and password)
MONGODB_URI=mongodb+srv://<db-user>:<db-password>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DB=neon_arcade
APP_ORIGIN=http://localhost:5173
```

```sh
npm run server:dev        # tsx watch, restarts on change
npm run dev               # the browser app on http://localhost:5173
```

Production build and start:

```sh
npm run server:build      # tsc, output in dist-server/
npm run server:start      # node dist-server/server/index.js
```

The compiled entry point registers a small resolve hook (`server/loader.ts`). The shared code under
`src/` imports its siblings without file extensions, which Vite and tsx accept but plain Node does not.
The hook adds `.js` to a relative import that fails to resolve. Nothing else changes at runtime.

On startup the server prints one line with the port and the data store. It never prints the connection
string. On SIGTERM or SIGINT it stops accepting requests, closes open connections and closes the database
client.

## Configuration

Values come from the environment. They are validated with zod at startup. Any problem stops the process
before it listens, and the message lists every problem without echoing a value.

| Variable        | Default                 | Notes                                                                                                                                                      |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development`           | `development`, `test` or `production`.                                                                                                                     |
| `PORT`          | `8787`                  | 1 to 65535.                                                                                                                                                |
| `HOST`          | `0.0.0.0`               | Address to listen on.                                                                                                                                      |
| `DATA_STORE`    | `mongo`                 | `mongo`, or `memory` (not allowed in production).                                                                                                          |
| `MONGODB_URI`   | none                    | Required unless `DATA_STORE=memory`. Must start with `mongodb://` or `mongodb+srv://`.                                                                     |
| `MONGODB_DB`    | `neon_arcade`           | Database name, 1 to 63 letters, digits, `_` or `-`.                                                                                                        |
| `APP_ORIGIN`    | `http://localhost:5173` | The exact origin the browser app is served from, such as `https://arcade.example.com`. Required in production. A trailing slash is allowed; paths are not. |
| `COOKIE_SECURE` | `true` in production    | Adds the `Secure` attribute to the session cookie.                                                                                                         |
| `TRUST_PROXY`   | `true` in production    | Trusts one proxy hop, so the client address comes from the header nginx appends. Turn it on only behind a proxy.                                           |

## Routes

All routes are under `/api`. Bodies are JSON and capped at 256 KB. Errors use the `ApiError` shape:
`{ "error": code, "message": text }`.

| Method | Path                       | Auth   | Success                                                                    | Notable errors                                                                 |
| ------ | -------------------------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/api/health`              | none   | 200 `HealthResponse`                                                       | 503 when the database does not answer                                          |
| GET    | `/api/session`             | cookie | 200 `{ user }`; `user` is null when signed out                             | never 401                                                                      |
| POST   | `/api/register`            | none   | 201 `AccountResponse` (version 0)                                          | 400 `invalid_request`, 409 `username_taken`, 429                               |
| POST   | `/api/login`               | none   | 200 `AccountResponse`                                                      | 401 `invalid_credentials` (same body for wrong password and unknown user), 429 |
| POST   | `/api/logout`              | cookie | 200 `{ "ok": true }`                                                       | clears the cookie                                                              |
| GET    | `/api/profile`             | cookie | 200 `AccountResponse`                                                      | 401 `unauthorized`                                                             |
| PUT    | `/api/profile`             | cookie | 200 `SaveProfileResponse`                                                  | 409 `version_conflict` (with `version`), 413 `payload_too_large`               |
| POST   | `/api/runs`                | cookie | 201 `RunResponse`; 200 with `duplicate: true` for a repeated `clientRunId` | 400 `invalid_request`                                                          |
| GET    | `/api/runs?limit=N`        | cookie | 200 `RunListResponse`, newest first                                        | `limit` is 1 to 50, default 20; 400 otherwise                                  |
| GET    | `/api/leaderboard/:gameId` | none   | 200 `LeaderboardResponse`, top 10                                          | 404 `not_found` for an unknown game                                            |

Every POST, PUT and DELETE must send `Content-Type: application/json`, even when the body is empty (`{}`).
Other content types get 415 `unsupported_media_type`.

## Save and run rules

- **Profiles.** A save names the version it was based on. If that differs from the stored version, the
  server answers 409 with the current version and stores nothing. The stored value is the canonical
  profile from `src/meta/profile.ts`: `sanitizeProfile` coerces every field to its allowed shape.
- **Ledger.** Each save compares the stored profile with the new one and writes rows for coin, gem and xp
  changes, new achievements, new owned items, newly claimed missions and daily claims. Spending is a
  negative coin or gem amount. A save that would write more than 500 rows is refused with 413. The
  profile and its rows are written in one transaction.
- **Runs.** `clientRunId` must be a UUID and is unique per player. Scores and other fields are checked
  against the ranges in `server/routes/runs.ts`. A start time may be at most five minutes in the future.
  Stat names start with a letter, use letters, digits and `_`, and there are at most 64 of them.
- **Leaderboards.** Ranked by score, highest first. Ties go to the earlier run. Each entry carries the
  username, score and time. No user ids or stats are exposed.

## Data model

| Collection | Document id                 | Fields                                                                                                                  | Indexes                                                                                          |
| ---------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users`    | user UUID                   | `username`, `usernameLower`, `passwordHash`, `createdAt`                                                                | unique `usernameLower`                                                                           |
| `sessions` | SHA-256 of the cookie token | `userId`, `createdAt`, `expiresAt` (Date)                                                                               | TTL on `expiresAt`                                                                               |
| `profiles` | user id                     | `version`, `profile`, `updatedAt`                                                                                       | by `_id`                                                                                         |
| `ledger`   | generated                   | `userId`, `kind`, `amount?`, `ref`, `reward?`, `streak?`, `createdAt`                                                   | `userId` + `createdAt`                                                                           |
| `runs`     | run UUID                    | `userId`, `username`, `clientRunId`, `gameId`, `score`, `coins`, `xp`, `durationSec`, `stats`, `startedAt`, `createdAt` | unique `userId` + `clientRunId`; `userId` + `createdAt`; `gameId` + `score` (desc) + `createdAt` |

Indexes are created at startup. Creating an index that already exists does nothing. MongoDB 5.0 or later is
needed, because profiles store keys that contain dots (for example `snake.score`).

## Security model

- **Passwords.** `scrypt` (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt for each password.
  The stored string carries its own parameters. Verification uses `timingSafeEqual`. A login for an
  unknown username runs the same check against a fixed dummy hash, so response time does not reveal
  which usernames exist. Passwords are 10 to 128 characters.
- **Sessions.** A 32-byte random token in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie. Only its SHA-256
  is stored. The lifetime is 30 days, and the cookie's Max-Age matches it. Register and login create a
  session. Login also ends the session the browser already carried. Logout deletes the session and clears
  the cookie.
- **Cross-site requests.** A state-changing request whose `Origin` header is present must match
  `APP_ORIGIN` exactly, or it gets 403 `forbidden_origin`. Requests with no `Origin` header are accepted,
  which covers tools and same-origin requests from older browsers. The JSON content-type requirement stops
  form posts, which cannot send `application/json` without a preflight, and this server does not answer
  preflights.
- **Headers.** Every `/api` response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  `X-Powered-By` is disabled.
- **Errors.** Stack traces and internal messages never reach the client. Unexpected failures are logged as
  one line with the error name and message.
- **Logs.** One JSON line per request: method, path, status and duration. Bodies, headers, cookies, query
  strings and passwords are never logged.
- **Rate limits.** Register and login are limited to 10 attempts per 15 minutes, counted for the client
  address and for the username (ignoring case). The 11th attempt gets 429 `rate_limited` with a
  `Retry-After` header. Every attempt counts, whether or not it succeeds.

### Limits

- **Scores are client-reported.** The server stores what the game reports and checks only that the values
  are in range. It cannot verify a run without simulating the game. Coins, xp and unlocks in a profile are
  stored as sent. Treat leaderboards as a friendly board, not as proof of skill.
- **Rate limits are per instance.** Each process counts its own requests, so N replicas allow N times the
  limit. A shared store would be needed for a global limit. Per-username limits can also be used to lock
  out a real player who is being targeted.
- **No quota on runs or profile saves.** Only register and login are rate limited. A signed-in player can
  post runs or save profiles faster than a normal game produces them. Add a per-user limit before a public
  launch.
- **Achievement ids are not checked against the catalog.** A newer client may unlock achievements that an
  older server does not know. Dropping them would lose the player's progress, so they are stored as sent.
- **One replica set is required.** Profile saves and account creation use transactions. Atlas clusters are
  replica sets. A local `mongod` must run as a replica set too.

## Tests

```sh
npm test                    # includes the server suite under tests/server
```

The server suite runs against the in-memory repository. The same repository contract also runs against
MongoDB when `MONGODB_TEST_URI` is set. Use a dedicated test cluster or a throwaway database user. The test
creates a database with a random name and drops it when it finishes:

```sh
MONGODB_TEST_URI='mongodb+srv://<test-user>:<test-password>@<test-cluster-host>/' npm test
```
