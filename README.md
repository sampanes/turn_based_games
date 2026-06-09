# Turn-Based Games

Turn-Based Games is a small collection of browser-friendly turn-based games with two deployment modes:

- **Static player-vs-computer mode** for GitHub Pages. The repository root is a landing page, and the playable client lives in `public/`.
- **Live room-code multiplayer mode** for a Node server. The server uses the same shared game-rule modules from `public/games/` so solo and multiplayer rules stay aligned.

There are no runtime npm dependencies.

## Play On GitHub Pages

Publish this repository from the default branch root. The root `index.html` is the GitHub Pages landing page for player-vs-computer games and links into the static client under `public/`.

Static solo links use query parameters such as:

```text
public/?mode=computer&game=battleship
public/?mode=computer&game=connectfour
public/?mode=computer&game=onecard
```

The static client stores solo rooms in browser `localStorage`, so it does not need a server.
live here:
[https://sampanes.github.io/turn_based_games/]

> Note: GitHub Pages project URLs use the repository name exactly. If the repository is named `turn_based_games`, the project URL contains `/turn_based_games/`, not `/turn-based-games/`.

## Run Locally With Multiplayer

Turn-Based Games requires Node 16+.

```bash
npm start
```

By default, the server listens on all interfaces on port 8080:

```text
Turn-Based Games running at http://0.0.0.0:8080
LAN clients can open http://<server-ip>:8080
```

To test on a local network, find the host IP address and open `http://<server-ip>:8080` from another device on the same network. One player starts a game and shares the 4-character room code; other players join with that code. Most games are two-player, while UNO supports up to four players before the host starts the hand.

The port can be changed with:

```bash
PORT=3000 node server.js
```

## Test

The smoke test starts the server on a temporary local port and exercises the main Battleship API flow, Connect Four room creation and move handling, and the multiplayer UNO lobby/start flow.

```bash
npm test
```

## Project Layout

```text
index.html             GitHub Pages landing page for static solo play
404.html               GitHub Pages fallback that returns to the static landing page
package.json           Node scripts for the live multiplayer server and smoke test
server.js              shared HTTP server, API, rooms, persistence
public/
  index.html           mobile-first game client for computer and live server modes
  app.js               shared browser controller for sessions, polling, launch params, and UI state
  solo.js              GitHub Pages/localStorage API adapter for computer play
  games/
    registry.js        browser game catalog for static pages
    battleship.js      shared Battleship rules used by browser and server
    connectfour.js     shared Connect Four rules and basic computer opponent
    onecard.js         shared UNO rules for 2-4 players and solo bots
  manifest.json        mobile web app metadata
server/
  games/               Node wrappers that expose the shared browser rules to server.js
test/
  smoke.js             zero-dependency HTTP smoke test
```

## Run As A Service

For a Linux host using systemd, create `/etc/systemd/system/turn-based-games.service`:

```ini
[Unit]
Description=Turn-Based Games
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/turn-based-games/server.js
WorkingDirectory=/opt/turn-based-games
Restart=always
User=games
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart`, `WorkingDirectory`, and `User` for the deployment target. Then enable the service:

```bash
sudo systemctl enable --now turn-based-games
sudo systemctl status turn-based-games
journalctl -u turn-based-games -f
```

## Remote Access For Multiplayer

Remote play requires a reachable HTTPS URL or private network path to the host. Common options include Cloudflare Tunnel, Tailscale, or a carefully configured port forward plus dynamic DNS.

## Static Solo Architecture

Solo mode deliberately calls the same game hooks as the HTTP server:

- `init()` creates the room state.
- `validateSetup()` validates and commits setup when a game has setup.
- `applyMove()` applies both human and computer turns.
- `viewFor()` renders the player-specific board.
- Optional `computerSetup()`, `computerPlayers()`, and `computerMove()` hooks let static solo mode seat bots, set them up, and take basic opponent turns without duplicating rule logic.

That keeps turn order, hidden information, win conditions, and move validation aligned with live multiplayer instead of copying game rules into the client.

## Adding Games

The server keeps room, turn, identity, and persistence plumbing separate from game rules. A shared game module in `public/games/` exports these hooks in a browser and Node-compatible format:

- `init()`
- `validateSetup(state, player, setup)`
- `applyMove(state, player, move, players)`
- `viewFor(state, player, players)`

The `public/games/battleship.js` module is the reference implementation. Add another game by creating a module in `public/games/`, giving it metadata, and registering it through `public/games/registry.js` for static play. Register the same module for the server in `server/games/index.js`, add a `<script>` tag in `public/index.html`, and add or map the matching mobile-first UI. Expose `computerSetup()` and `computerMove()` when the game supports GitHub Pages solo play so `public/solo.js` can remain generic while each game owns its own basic opponent behavior.

## Notes

- Battleship uses one shot per turn with strict alternation.
- Connect Four uses standard 7-column, 6-row gravity drops and detects horizontal, vertical, and diagonal fours.
- UNO is a shedding game for 2-4 server players; static solo play seats the human against three first-legal-card computer players.
- To reset local multiplayer state, stop the server, delete `data.json`, and start it again.
- To reset static solo state, clear the browser's local storage for the site.
