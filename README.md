# +1 Double Jump Bike Escape — game server

Colyseus 0.18 server for the bike game in `../double-jump-bike-escape-client`.

- **Lobbies of 8.** Each lobby is a `bike_escape` room with `maxClients = 8`.
  Colyseus locks a full room, so the 9th player's `joinOrCreate` opens a new
  lobby automatically. Lobbies are numbered "Lobby 1", "Lobby 2"…
- **Server-authoritative economy.** Clients only send their position. The
  server decides speed ticks, levels, wins, purchases, rebirths, quests,
  codes, egg hatches, playtime gifts (timed from the join), lucky spins (the
  slot is rolled here), continues (one free a day, only to an island reached
  this run) and star rewards, checking positions against the shared map
  (`src/shared/layout.js`).
- **Persistence.** With `MONGODB_URI` (Bloxity Legion provides one) profiles
  and mailbox feedback live in MongoDB: a profile is loaded when its player
  joins and changes are written back every few seconds, so any server can pick
  a player up. Without it (local development) they go to `data/players.json`
  and `data/feedback.log` (`DATA_DIR` moves them). Profiles whose uid starts
  with `test:` (smoke-test bots, `?uid=` dev logins) are never saved.
- **Safe, versioned saves** (`src/store/saveFormat.js`). Every save carries a
  version; older saves are upgraded step by step on load, and every field is
  checked (type, limits, valid JSON) and repaired if needed, with a log line.
  A save from a newer server version (say, during a rollback) is loaded but
  never written back, and in MongoDB the write itself refuses to replace a
  newer save, so a draining old server can't downgrade one. The JSON file keeps
  the previous good copy as `players.json.bak` and reads it if the main file is
  ever damaged. Purchases, rebirths and rewards are saved within half a second.
  To change the format: bump `SAVE_VERSION` and add a `MIGRATIONS` step.
  Version 3 added pets, the spin timer, the daily continue and star reward tiers.
- **Graceful restarts.** On SIGTERM (a deploy or scale-down) the server stops
  taking riders and moves everyone to a fresh server: riders in a lobby right
  away, riders on the course once they're back in a lobby (at most 90 s, then
  everyone). Progress is saved first and the client rejoins through the
  matchmaker. Ctrl+C (SIGINT) just saves and stops.

## Run it

```bash
npm install
npm run dev     # restarts on file changes
# or
npm start
```

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `2567` | WebSocket + HTTP port |
| `MONGODB_URI` | – | MongoDB for profiles and feedback (else the JSON file) |
| `DATA_DIR` | `./data` | profiles and feedback without MongoDB |
| `CLIENT_ORIGIN` | – | the game site's origin (CORS for `/api`; set by Legion) |
| `CLIENT_ORIGINS` | – | extra CORS origins for `/api`, comma-separated |

HTTP endpoints:

| Endpoint | |
| --- | --- |
| `GET /health` | liveness / readiness probe (Legion) |
| `GET /api/health` | liveness |
| `GET /api/lobbies` | live lobbies and their player counts |
| `GET /api/leaderboards` | top 10 per stat |
| `POST /api/legion-auth` | Bloxity auth stub (token not verified yet — see TODO) |

## Hosting (Bloxity Legion)

The `Dockerfile` builds the server image (Node 22, runs as the `node` user,
listens on `$PORT`). `.github/workflows/deploy.yml` builds it on every push,
pushes it to this repo's GitHub Container Registry and asks Legion to roll it
out: `main` → prod, `dev` → dev, with `seatCap` 8 (one full lobby per server;
the matchmaker starts another server when one is full).

One-time setup:

1. Add the repository secret `LEGION_DEPLOY_TOKEN` (My Games → eye icon).
   Never commit the token.
2. After the first push, make the GHCR package public (repo → Packages →
   Package settings → Change visibility) so Legion can pull it.

## Shared code

`src/shared/` is a copy of the client's `src/shared/`, and `config/balance.ts`
(every progression number) a copy of the client's. The client is the source
of truth. Node runs the `.ts` file directly (type stripping, Node 22.18+).
After changing either, run:

```bash
npm run sync-shared
```

## Smoke test

With the server running:

```bash
npm run test:lobbies          # ws://localhost:2567
node scripts/lobby-test.js ws://host:port
```

`npm run test:economy` checks the progression rules without a server: levels
from Speed, rebirth targets and resets, tune-ups, the login streak, daily
quests, milestone bikes, offline earnings, eggs and pets, playtime gifts, the
lucky spin, continues, rebirth rewards and star rewards. `npm run test:saves` checks the
save system: upgrading old saves, repairing bad values, leaving newer saves
alone and recovering from a damaged file through its backup.

The smoke test connects 17 bots and checks:

- the 8 / 8 / 1 lobby split
- speed ticks and treadmills
- pad validation
- Wins and Item Shop purchases (Wins are the only currency)
- rebirth refused below its Speed target
- the World 2 bike lock
