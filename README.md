# +1 Double Jump Bike Escape — game server

Colyseus 0.18 server for the bike game in `../double-jump-bike-escape-client`.

- **Lobbies of 8.** Each lobby is a `bike_escape` room with `maxClients = 8`.
  Colyseus locks a full room, so the 9th player's `joinOrCreate` opens a new
  lobby automatically. Lobbies are numbered "Lobby 1", "Lobby 2"…
- **Server-authoritative economy.** Clients only send their position. The
  server decides speed ticks, levels, wins, purchases, rebirths, quests
  and codes, checking positions against the shared map (`src/shared/layout.js`).
- **Persistence.** With `MONGODB_URI` (Bloxity Legion provides one) profiles
  and mailbox feedback live in MongoDB: a profile is loaded when its player
  joins and changes are written back every few seconds, so any server can pick
  a player up. Without it (local development) they go to `data/players.json`
  and `data/feedback.log` (`DATA_DIR` moves them). Profiles whose uid starts
  with `test:` (smoke-test bots, `?uid=` dev logins) are never saved.
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

`src/shared/` is a copy of the client's `src/shared/`. The client is the
source of truth. After changing it, run:

```bash
npm run sync-shared
```

## Smoke test

With the server running:

```bash
npm run test:lobbies          # ws://localhost:2567
node scripts/lobby-test.js ws://host:port
```

It connects 17 bots and checks:

- the 8 / 8 / 1 lobby split
- speed ticks and treadmills
- pad validation
- Wins and Item Shop purchases (Wins are the only currency)
- bulk rebirths
- the World 2 bike lock
