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
- Dots and Boxes
- Mancala
- Ultimate Tic-Tac-Toe
- UNO-style One Card for two to four players

Future game ideas are tracked in [GAME_CANDIDATES.md](GAME_CANDIDATES.md).

## Static Solo Play

Publish the repository from the default branch root with GitHub Pages. The one and
only landing page is the client at `public/`; the repository root `index.html` (and
`404.html`) just forward there so old links keep working.

Example launch paths (a launch link opens that game: your newest unfinished offline game
of that kind, or a new one):

```text
public/?mode=computer&game=battleship
public/?mode=computer&game=connectfour
public/?mode=computer&game=mancala
public/?mode=computer&game=dotsboxes
public/?mode=computer&game=ultimatettt
public/?mode=computer&game=onecard
```

Solo rooms live only in browser `localStorage`; no server or shared database is used.
The deployment URL is available from the repository's Pages settings after publishing.

### Home screen

The home screen greets the player by name and offers three things: **Play a friend**
(a live room with an invitation), **Play the computer**, and a box for a friend's code.
**Play the computer** seats Botty on the server when there is one, and plays offline in
the browser on GitHub Pages, where the friend options are hidden. The name is asked for
once and then kept, with the computer skill, turn alerts and moving games, behind the
gear. An invitation link opens a short "You're invited" screen with just a name and Join.

### Saved games

The home screen lists every game the browser holds a seat in (up to 12): games where it
is your turn first, then their turn, waiting rooms, computer games and finished games.
Live rooms show the opponent's name. **Home** inside a game
returns there and keeps an unfinished game saved; a finished game is cleared when you
leave it, and the x on a list entry discards it. Starting another game never forgets an
unfinished one, so a live game can be picked up days later from the same browser, as long
as the room has not expired on the server (`ROOM_TTL_DAYS`).

Saves are per browser and per address: `http://127.0.0.1:8081`, `http://localhost:8081`
and the private Tailscale URL each keep their own list, and a private window or clearing
site data loses it. A forgotten seat cannot be reclaimed by entering the room code again.

Apps that open links in their own browser (Discord on iPhone, for one) keep a separate
list too. To play the same games somewhere else, open **Settings** (the gear), tap **Copy
my games code**, and paste it under **Paste a code from another browser** in the other
browser's Settings. Both browsers can then play those seats. The code is the seat's
password, so paste it only into your own browsers. Offline computer games stay where
they were played.

### Computer skill

**Computer skill** in Settings (Easy, Normal, Hard) sets how well the offline computer
and Botty play. The browser remembers the choice, each game keeps the
level it started with (**New game** reuses it), and the footer and saved list show it.
Games saved before levels existed play at Normal.

| Game | Easy | Normal | Hard |
|---|---|---|---|
| Battleship | random shots, rarely follows a hit | follows up unsunk hits | fires where the remaining ships most likely sit |
| Connect Four | often misses your threats | wins, blocks, one move ahead | six moves ahead |
| Dots and Boxes | draws any line, usually takes boxes | careful, occasional slip | the careful bot with no slips |
| Mancala | half random | two moves ahead | six moves ahead |
| UNO | random legal card | first legal card | holds wilds, attacks a player about to go out |
| Ultimate Tic-Tac-Toe | takes wins, otherwise random | wins and blocks boards | neural net on GitHub Pages; elsewhere also avoids handing you a board |

Measured bot against bot (200 games per pairing for Battleship and Mancala, 40 for the
rest, seats alternating), each level beats the one below it in every game; in UNO luck keeps it close.

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
http://127.0.0.1:8081/
```

It does not listen on the LAN or public internet by default.

For other platforms:

```bash
npm start
```

## Private Remote Multiplayer With Tailscale

The intended private path is:

```text
player browser -> private tailnet HTTPS -> Tailscale Serve -> 127.0.0.1:8081
```

One-time preparation:

1. Install Tailscale and sign in on the game host.
2. Give the host a generic, non-personal machine name before enabling HTTPS. Tailscale
   HTTPS certificates are recorded in public Certificate Transparency logs, so the machine
   name and tailnet name become publicly visible.
3. Start the local game server.
4. Run `enable-private-share.bat`, using an Administrator console if requested.
5. Inspect the private URL with `status-turn-based-games.bat`.
6. Share only the game-host machine with each intended player.
7. Restrict shared users to the HTTPS game service in the tailnet access policy (see
   [Limit shared players to the game](#limit-shared-players-to-the-game)).

Each person should use a separate Tailscale account. Sharing a single host is narrower
than inviting someone into the entire tailnet. Keep recipient identities and access
rules in the Tailscale admin console rather than committing them to this repository.

`enable-private-share.bat` uses Tailscale Serve, not Tailscale Funnel. Do not enable
Funnel, forward port 8081 on a router, or add a public firewall rule for this service.

Tailscale Serve configuration can remain in place while the Node backend is stopped.
The private URL will become usable again the next time the named server is started.

### Limit shared players to the game

The game host is usually a home PC that also offers other things over the same tailnet:
remote desktop or game streaming, file shares, personal tools. Sharing the machine keeps
players out of your other machines, but **not** out of that machine's other services.
A share reaches every port on the shared machine that the tailnet policy allows, and a
rule with `"src": ["*"]`, like the default allow-all policy, matches shared users too.

Two rules in the tailnet policy file (admin console -> Access controls) separate the game
from everything else on the host:

```jsonc
{
  "hosts": {
    "game-host": "100.x.y.z"   // the host's Tailscale IP: tailscale ip -4
  },
  "acls": [
    // People who accepted a share of the game host: the HTTPS game service only.
    { "action": "accept", "src": ["autogroup:shared"], "dst": ["game-host:443"] },

    // Your own users and devices. autogroup:member does NOT include shared users,
    // so this keeps your access as it is today. Narrow it as you see fit; it is
    // independent of the game rule above.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] }
  ]
}
```

- Remove or rewrite every other rule whose `src` is `"*"`. Any one of them gives shared
  players access to the rest of the host again, whatever the game rule says.
- Port 443 is the only port needed. Tailscale Serve terminates HTTPS on 443 and forwards
  to the server, which listens on `127.0.0.1:8081` and is not reachable from the tailnet
  directly.
- This only governs people you **share** the machine with. Anyone you invite as a full
  member of your tailnet falls under the `autogroup:member` rule instead, so share the
  machine with players rather than inviting them.
- To check: a player's browser should open the game URL, and nothing else on the host
  (for example a streaming or file-sharing port) should answer them.

Tailscale's references: device sharing (https://tailscale.com/kb/1084/sharing) and policy
syntax, including `autogroup:shared` (https://tailscale.com/kb/1337/policy-syntax).

## Multiplayer Behavior

A player creates a room and shares its four-character code with another permitted
player. Most games are two-player; One Card supports up to four players before the
host starts the hand.

**Play the computer** creates a normal authenticated server room with Botty already
seated. Botty uses the same shared computer-move hooks as offline play, waits
briefly before each move so the client can show turn changes, and remains available
after browser or server restarts. Botty rooms are reserved for their creator and cannot
be joined by another human.

Clients poll automatically once per second. The player making a move sees the result
immediately, while other players normally see it within one second without refreshing.
Mancala animates each pickup and drop and generates quiet browser-native sounds without
downloading audio assets.

### Turn alerts

A player can get a phone or desktop notification when it becomes their turn. **Turn
alerts** in Settings (the gear on the home screen) turns them on for that device. It appears only when the
page is served by this server, not on GitHub Pages, and it needs HTTPS, so use the private
Tailscale address (`http://127.0.0.1` also works for testing on the host itself).

- **iPhone or iPad (iOS 16.4 or later):** open the game in Safari (from Discord or another
  app, use its menu to open the page in Safari), tap Share, then **Add to Home Screen**,
  and open the game from that icon. Tap **Turn on alerts** there and allow notifications.
  The home-screen app keeps its own saved games, separate from Safari's and Discord's;
  bring existing games over with **Copy my games code** (see Saved games).
- **Android, Chrome or Edge on a computer:** tap **Turn on alerts** and allow
  notifications.

An alert goes to whoever has to move next after a person joins, places a fleet or moves,
and to everyone else when a game ends. There are no alerts in Botty or offline games, or
while that player's game screen is open. Tapping an alert opens the game, and a newer
alert for the same game replaces the older one. Alerts turn on per device and cover
every unfinished game saved on it, including games joined later. **Turn off** stops them.
If notifications stop arriving after site data is cleared, turn alerts on again.

Alerts travel through the browser maker's push service (Apple for iPhone, Google for
Chrome and Android, Mozilla, Microsoft). This is the server's only outbound connection;
nothing new can connect in. Each message is encrypted for the receiving device, so the
push service cannot read it, and the server only accepts subscriptions on those services'
own addresses.

## Persistent State

Multiplayer state is stored in `data.json` beside `server.js` by default. It contains
room state, display names, secret player tokens, turn-alert subscriptions, and the
server's turn-alert signing key, so it must remain private.

`data.json`, temporary writes, and the `backups/` directory are excluded from Git.
Create a local timestamped backup with:

```text
backup-turn-based-games.bat
```

Deleting `data.json` removes every multiplayer room and makes a new turn-alert key, so
every device has to turn alerts on again. Set `DATA_FILE` to an absolute
path outside the checkout if runtime state should live elsewhere.

## Security Defaults

- The backend binds to `127.0.0.1`, not all network interfaces.
- Authenticated requests use a bearer token instead of putting tokens in URLs.
- Static responses include browser security headers.
- Browser assets are local; the client does not fetch third-party fonts or analytics.
  One exception: offline Ultimate Tic-Tac-Toe at Hard skill on GitHub Pages loads
  onnxruntime-web from a CDN and its neural-net opponent (~26 MB) from the companion model
  site. The local server's Content-Security-Policy blocks both, so there the simpler
  built-in bot plays instead.
- The only outbound traffic is turn alerts, sent to browser push services (see
  [Turn alerts](#turn-alerts)).
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
| `PORT` | `8081` | Local HTTP port |
| `DATA_FILE` | `./data.json` | Multiplayer state path |
| `MAX_BODY_BYTES` | `65536` | Maximum API request body |
| `RATE_LIMIT_PER_MINUTE` | `900` | API requests per identity |
| `MAX_ROOMS` | `200` | Retained multiplayer rooms |
| `ROOM_TTL_DAYS` | `90` | Inactive room lifetime |
| `BOT_MOVE_DELAY_MS` | `650` | Pause before each server-side Botty move |
| `PUSH_CONTACT` | repository URL | Contact (`mailto:` or `https:`) sent to push services with each alert |

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
  sw.js                          service worker that shows turn alerts
  games/                         shared browser and server game rules
server/games/                    Node wrappers for shared rules
server/push.js                   zero-dependency Web Push (VAPID + aes128gcm)
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
`computerMove(state, player, level)`, where `level` is `easy`, `normal` or `hard`.
Register a new module in both `public/games/registry.js` and `server/games/index.js`, add
its browser script, and provide the matching UI.
