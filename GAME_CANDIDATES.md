# Game Candidates

This is a planning list for turn-based games that fit the current app shape:
browser-friendly UI, room-code multiplayer, restartable state, and optional Botty
support. Prefer games with compact state, clear legal moves, and good mobile touch
targets.

## Implemented From This List

| Game | Notes |
| --- | --- |
| Dots and Boxes | Added as a 2-player 4x4-box board with Botty support, server persistence, edge claiming, scoring, and extra turns on completed boxes. |

## Best Next Candidates

| Game | Players | Why it fits | Implementation notes |
| --- | ---: | --- | --- |
| Reversi | 2 | Small 8x8 board, simple turns, strong visual flips, good Botty search. | Use standard legal-move generation and a lightweight minimax/heuristic bot. |
| Checkers | 2 | Familiar, readable on mobile, good animations for captures and kings. | Enforce forced captures; consider American checkers first. |
| Gomoku | 2 | Easy rules, larger strategy than Connect Four, minimal UI surface. | Use a 15x15 or scalable board; add win/block Botty heuristic. |
| Mastermind-style Codebreaker | 2 or solo | Asymmetric roles, compact state, works well against Botty. | One player sets a code, the other guesses; Botty can set or solve. |
| Draw Dominoes | 2-4 | Good family/table feel, shared boneyard, manageable rules. | Start with draw dominoes before scoring-heavy variants. |
| Gin Rummy | 2 | Good persistent card game with clear draw/discard turns. | Needs private hands and meld validation in `viewFor`. |
| Backgammon | 2 | Classic turn-based board game with dice and strong replay value. | Dice add randomness; use a rules helper to avoid edge-case bugs. |

## Good Medium-Scope Candidates

| Game | Players | Why it fits | Implementation notes |
| --- | ---: | --- | --- |
| Word Tiles | 2-4 | Async-friendly, social, easy to resume over days. | Avoid trademarked branding; needs dictionary handling and tile validation. |
| Yahtzee-style Dice | 2-4 | Short turns, simple score sheet, good solo/Botty mode. | Public-domain style scoring is straightforward; animations can stay light. |
| Spades | 4 | Strong multiplayer candidate once 4-player One Card patterns are stable. | Needs teams, bidding, trick resolution, and competent Botty partners. |
| Hearts | 4 | Familiar trick-taking game with persistent rounds. | Passing phase and trick-taking bot add complexity. |
| Cribbage | 2 | Great two-player scoring game, compact board UI. | Scoring rules are the hard part; good candidate after card infrastructure matures. |
| Nine Men's Morris | 2 | Small board, clear phases, good tactical Botty. | Track placing, sliding, and flying phases. |
| Isolation | 2 | Very simple moves, strategic, excellent for Botty. | Grid movement plus tile removal; easy to theme. |
| Nim Variants | 2 | Fast to build, good for teaching Botty/difficulty modes. | Best as a small collection rather than a headline game. |

## Bigger Or Riskier Candidates

| Game | Players | Why it is attractive | Risk |
| --- | ---: | --- | --- |
| Chess | 2 | High recognition and deep replayability. | Use an existing rules engine; hand-rolled legal move logic is not worth the risk. |
| Go | 2 | Elegant, async-friendly, strong board-game identity. | Scoring, ko, and Botty are much heavier than the current games. |
| Risk-style Territory Game | 2-6 | Persistent room play and phone sharing would be compelling. | Long games, diplomacy expectations, and map/UI scope are large. |
| Diplomacy-like Orders Game | 3-7 | Truly turn-based and great for private groups. | Simultaneous hidden orders are a new server interaction model. |
| Tile-Laying Rail/Route Game | 2-4 | Good mobile drag/drop strategy game. | Needs custom rules and careful balance unless based on a known public-domain game. |

## Selection Criteria

- Good mobile controls: no tiny precision clicks, no dense text-only turns.
- Compact persisted state: easy to serialize into existing room storage.
- Clear `applyMove` validation: server can reject illegal moves deterministically.
- Useful `viewFor`: private information stays private for card, word, and hidden-code games.
- Botty path: at least a basic legal-move bot should be possible before adding the game.
- Low asset burden: CSS, simple SVG, or generated UI should carry the first version.

## Suggested Build Order

1. Reversi
2. Checkers
3. Gomoku
4. Draw Dominoes
5. Gin Rummy

This order prioritizes games that reuse existing board-rendering and Botty patterns
before adding heavier hidden-hand and scoring systems.
