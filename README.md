# Couch Armada

Couch Armada is a small self-hosted server for two-player turn-based games. It
uses no ads, accounts, analytics, or third-party game service. The first bundled
games are Battleship and Connect Four. The mobile-first browser client also has a static "play the
computer" mode that can run on GitHub Pages.

Live GitHub Pages build: https://sampanes.github.io/turn-based-games/

The repository root includes a tiny redirect page so that GitHub Pages URL opens
the static client in `couch-armada/public/`.

Game state is stored in `data.json`, which is created on first run. That file can
include room codes, player display names, game tokens, and in-progress boards, so
it is intentionally ignored by Git.

## Run

Couch Armada requires Node 16+ and has no package dependencies.

```bash
cd couch-armada
node server.js
```

Expected output:

```text
Couch Armada running at http://0.0.0.0:8080
LAN clients can open http://<server-ip>:8080
```

To test on a local network, find the host IP address and open
`http://<server-ip>:8080` from another device on the same network. One player
starts a game and shares the 4-character room code; the second player joins with
that code.

The port can be changed with:

```bash
PORT=3000 node server.js
```

## Test

The smoke test starts the server on a temporary local port and exercises the main
Battleship API flow plus Connect Four room creation and move handling.

```bash
cd couch-armada
npm test
```

## Project Layout

```text
index.html               GitHub Pages redirect to the static client
couch-armada/
  server.js              shared HTTP server, API, rooms, persistence
  games/
    index.js             server game registry
    battleship.js        server wrapper around the shared Battleship rules
    connectfour.js       server wrapper around the shared Connect Four rules
  public/
    index.html           mobile-first shell for online and computer modes
    app.js               shared browser controller for sessions, polling, and UI state
    solo.js              GitHub Pages/localStorage API adapter for computer play
    games/
      registry.js        browser game catalog for static pages
      battleship.js      shared Battleship rules used by browser and server
      connectfour.js     shared Connect Four rules and basic computer opponent
    manifest.json        mobile web app metadata
  test/
    smoke.js             zero-dependency HTTP smoke test
```

## Run As A Service

For a Linux host using systemd, create `/etc/systemd/system/armada.service`:

```ini
[Unit]
Description=Couch Armada
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/couch-armada/server.js
WorkingDirectory=/opt/couch-armada
Restart=always
User=armada
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart`, `WorkingDirectory`, and `User` for the deployment target.
Then enable the service:

```bash
sudo systemctl enable --now armada
sudo systemctl status armada
journalctl -u armada -f
```

## Remote Access

Remote play requires a reachable HTTPS URL or private network path to the host.
Common options:

### Cloudflare Tunnel

Cloudflare Tunnel can expose the local server over HTTPS without opening inbound
ports on the router.

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

cloudflared tunnel --url http://localhost:8080
```

The command prints a temporary `https://...trycloudflare.com` URL. For a stable
URL, configure a named tunnel in Cloudflare.

### Tailscale

Tailscale can make the server reachable only to devices in the same tailnet. This
avoids public inbound ports, but each player device needs Tailscale installed and
signed in.

### Port Forwarding And Dynamic DNS

A router port forward plus dynamic DNS also works. This is the most exposed
option and should only be used when the host and router are configured
appropriately.

## Install As A Mobile Web App

Open the server URL in a mobile browser and use the browser's "Add to Home
screen" action. HTTPS is recommended for the best install behavior.

## Static GitHub Pages / Computer Opponent Mode

The app can be hosted as static files for solo play. Publish the contents of
`couch-armada/public/` to GitHub Pages and keep `app.js`, `solo.js`, and the
`games/` directory beside `index.html`. The "Play the computer" button stores the
whole room in browser `localStorage`, so it works without a server.

Solo mode deliberately calls the same game hooks as the HTTP server:

- `init()` creates the room state.
- `validateSetup()` validates and commits both fleets.
- `applyMove()` applies both human and computer turns.
- `viewFor()` renders the player-specific board.
- Optional `computerSetup()` and `computerMove()` hooks let static solo mode set up and take a basic opponent turn without duplicating rule logic.

That keeps turn order, hidden information, win conditions, and move validation
aligned with the future online server mode instead of copying game rules into the
client.

## Adding Games

The server keeps room, turn, identity, and persistence plumbing separate from game
rules. A shared game module in `public/games/` exports these hooks in a browser
and Node-compatible format:

- `init()`
- `validateSetup(state, player, setup)`
- `applyMove(state, player, move)`
- `viewFor(state, player)`

The `public/games/battleship.js` module is the reference implementation. Add
another game by creating a module in `public/games/`, giving it metadata, and
registering it through `public/games/registry.js` for static play. Register the
same module for the server in `games/index.js`, add a `<script>` tag in
`public/index.html`, and add or map the matching mobile-first UI. Expose
`computerSetup()` and `computerMove()` when the game supports GitHub Pages solo
play so `public/solo.js` can remain generic while each game owns its own basic
opponent behavior.

## Notes

- Battleship uses one shot per turn with strict alternation.
- Connect Four uses standard 7-column, 6-row gravity drops and detects horizontal, vertical, and diagonal fours.
- To reset local state, stop the server, delete `data.json`, and start it again.
- Rooms are two-player only; a full room rejects additional joins.
