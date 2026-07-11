# Turn-Based Games

A small collection of browser-friendly turn-based games with two deployment modes:

- Static player-vs-computer mode for GitHub Pages.
- Private room-code multiplayer through a local Node server.
- Persistent server-side games against Botty.

The project has no runtime npm dependencies. Multiplayer is designed to stay bound to
localhost and be shared privately through a network layer such as Tailscale Serve.

## Games

- Battleship
- Connect Four
- Mancala
- Ultimate Tic-Tac-Toe
- UNO-style One Card for two to four players

Future game ideas are tracked in [GAME_CANDIDATES.md](GAME_CANDIDATES.md).

## Static Solo Play

Publish the repository from the default branch root with GitHub Pages. The one and
only landing page is the client at `public/`; the repository root `index.html` (and
`404.html`) just forward there so old links keep working.

Example launch paths (a launch link always wins over a leftover saved session):

```text
public/?mode=computer&game=battleship
public/?mode=computer&game=connectfour
public/?mode=computer&game=mancala
```

Solo rooms live only in browser `localStorage`; no server or shared database is used.
The deployment URL is available from the repository's Pages settings after publishing.

## Local Multiplayer

Node 16 or newer is required.

On Windows, use the named helpers:

```text
start-turn-based-games.bat
status-turn-based-games.bat
stop-turn-based-games.bat
```

The server console is titled `turn-based-games`, matching the package and helper names.
The older `start-server.bat` and `stop-server.bat` files remain as compatibility wrappers.

The server listens only on:

```text
http://127.0.0.1:8080/
```

It does not listen on the LAN or public internet by default.

For other platforms:

```bash
npm start
```

## Private Remote Multiplayer With Tailscale

The intended private path is:

```text
player browser -> private tailnet HTTPS -> Tailscale Serve -> 127.0.0.1:8080
```

One-time preparation:

1. Install Tailscale and sign in on the game host.
2. Give the host a generic, non-personal machine name before enabling HTTPS.
3. Start the local game server.
4. Run `enable-private-share.bat`, using an Administrator console if requested.
5. Inspect the private URL with `status-turn-based-games.bat`.
6. Share only the game-host machine with each intended player.
7. Restrict shared users to the HTTPS game service in the tailnet access policy.

Each person should use a separate Tailscale account. Sharing a single host is narrower
than inviting someone into the entire tailnet. Keep recipient identities and access
rules in the Tailscale admin console rather than committing them to this repository.

`enable-private-share.bat` uses Tailscale Serve, not Tailscale Funnel. Do not enable
Funnel, forward port 8080 on a router, or add a public firewall rule for this service.

Tailscale Serve configuration can remain in place while the Node backend is stopped.
The private URL will become usable again the next time the named server is started.

## Multiplayer Behavior

A player creates a room and shares its four-character code with another permitted
player. Most games are two-player; One Card supports up to four players before the
host starts the hand.

`Play Botty - save on server` creates a normal authenticated server room with Botty
already seated. Botty uses the same shared computer-move hooks as offline play, waits
briefly before each move so the client can show turn changes, and remains available
after browser or server restarts. Botty rooms are reserved for their creator and cannot
be joined by another human.

Clients poll automatically once per second. The player making a move sees the result
immediately, while other players normally see it within one second without refreshing.
Mancala animates each pickup and drop and generates quiet browser-native sounds without
downloading audio assets.

## Persistent State

Multiplayer state is stored in `data.json` beside `server.js` by default. It contains
room state, display names, and secret player tokens, so it must remain private.

`data.json`, temporary writes, and the `backups/` directory are excluded from Git.
Create a local timestamped backup with:

```text
backup-turn-based-games.bat
```

Deleting `data.json` removes every multiplayer room. Set `DATA_FILE` to an absolute
path outside the checkout if runtime state should live elsewhere.

## Security Defaults

- The backend binds to `127.0.0.1`, not all network interfaces.
- Authenticated requests use a bearer token instead of putting tokens in URLs.
- Static responses include browser security headers.
- Browser assets are local; the client does not fetch third-party fonts or analytics.
- Request bodies are limited to 64 KiB.
- API traffic is limited to 900 requests per identity per minute.
- At most 200 rooms are retained by default.
- Rooms expire after 90 days without a join, setup, or move.
- Writes use a temporary file and rename to reduce partial-file corruption.

These controls are defense in depth. The private Tailscale access boundary is still
required; the application is not intended to be exposed directly to the public internet.

Configuration can be adjusted with environment variables:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `HOST` | `127.0.0.1` | Listener address |
| `PORT` | `8080` | Local HTTP port |
| `DATA_FILE` | `./data.json` | Multiplayer state path |
| `MAX_BODY_BYTES` | `65536` | Maximum API request body |
| `RATE_LIMIT_PER_MINUTE` | `900` | API requests per identity |
| `MAX_ROOMS` | `200` | Retained multiplayer rooms |
| `ROOM_TTL_DAYS` | `90` | Inactive room lifetime |
| `BOT_MOVE_DELAY_MS` | `650` | Pause before each server-side Botty move |

## Test

The smoke test starts an isolated localhost server on a temporary port and exercises
static serving, traversal protection, request-size limits, bearer authentication,
Battleship setup and moves, Connect Four, Mancala move identity, the One Card lobby,
Botty availability in every game, and Botty persistence across a server restart.

```bash
npm test
```

## Project Layout

```text
index.html                       GitHub Pages forwarder to public/
404.html                         GitHub Pages fallback forwarder to public/
server.js                        local HTTP server, rooms, limits, and persistence
public/
  index.html                     mobile-first game client (the landing page)
  app.js                         sessions, polling, animation, sound, and UI state
  solo.js                        browser-local computer-play adapter
  games/                         shared browser and server game rules
server/games/                    Node wrappers for shared rules
test/smoke.js                    zero-dependency server smoke test
start-turn-based-games.bat       named Windows launcher
status-turn-based-games.bat      process, listener, and private-share status
stop-turn-based-games.bat        named Windows stop helper
enable-private-share.bat         tailnet-only Tailscale Serve setup
backup-turn-based-games.bat      local state backup helper
```

## Adding Games

The server keeps room, identity, persistence, and transport code separate from game
rules. A shared module under `public/games/` exposes:

- `init()`
- `validateSetup(state, player, setup)`
- `applyMove(state, player, move, players)`
- `viewFor(state, player, players)`

Optional computer-play hooks include `computerSetup()`, `computerPlayers()`, and
`computerMove()`. Register a new module in both `public/games/registry.js` and
`server/games/index.js`, add its browser script, and provide the matching UI.
