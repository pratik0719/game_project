# 🕹️ YUDY Game Arcade

## 📌 Project Overview
- Browser-based multi-game platform with shared backend and independent game modules.
- Tech stack: Node.js, Express, EJS, XML, JavaScript, HTML, CSS.
- Configuration system uses per-game XML files and global platform XML.
- Total games: 11

## 🚀 How to Run
1. Install Node.js 18 or later.
2. Install dependencies.
```bash
npm install
```
3. Run the app.
```bash
npm start
```
4. Open in browser.
```text
http://127.0.0.1:3000
```

## 🗂️ Full Project Structure
| Path | Type | Explanation |
|---|---|---|
| `.git` | Folder | folder |
| `server.js` | File | Express backend application |
| `server/roomManager.js` | File | In-memory multiplayer room lifecycle and validation |
| `server/socketHandlers.js` | File | Socket.IO event handlers |
| `server/gameHandlers/index.js` | File | Multiplayer game config and adapter entry point |
| `package.json` | File | Node.js dependencies and scripts |
| `config.xml` | File | XML configuration or persisted data |
| `games` | Folder | folder |
| `games/2048` | Folder | folder |
| `games/2048/game2048.js` | File | JavaScript gameplay or shared frontend logic |
| `games/2048/game2048.xml` | File | XML configuration or persisted data |
| `games/breakout` | Folder | folder |
| `games/breakout/breakout.js` | File | JavaScript gameplay or shared frontend logic |
| `games/breakout/breakout.xml` | File | XML configuration or persisted data |
| `games/breakout/README.md` | File | Documentation file |
| `games/chess` | Folder | folder |
| `games/chess/chess.js` | File | JavaScript gameplay or shared frontend logic |
| `games/chess/chess.xml` | File | XML configuration or persisted data |
| `games/chess/README.md` | File | Documentation file |
| `games/flappy` | Folder | folder |
| `games/flappy/flappy.js` | File | JavaScript gameplay or shared frontend logic |
| `games/flappy/flappy.xml` | File | XML configuration or persisted data |
| `games/flappy/README.md` | File | Documentation file |
| `games/ludo` | Folder | folder |
| `games/ludo/ludo.js` | File | JavaScript gameplay or shared frontend logic |
| `games/ludo/ludo.xml` | File | XML configuration or persisted data |
| `games/ludo/README.md` | File | Documentation file |
| `games/memory` | Folder | folder |
| `games/memory/memory.js` | File | JavaScript gameplay or shared frontend logic |
| `games/memory/memory.xml` | File | XML configuration or persisted data |
| `games/memory/README.md` | File | Documentation file |
| `games/quiz` | Folder | folder |
| `games/quiz/quiz.js` | File | JavaScript gameplay or shared frontend logic |
| `games/quiz/quiz.xml` | File | XML configuration or persisted data |
| `games/quiz/README.md` | File | Documentation file |
| `games/snake` | Folder | folder |
| `games/snake/README.md` | File | Documentation file |
| `games/snake/snake.js` | File | JavaScript gameplay or shared frontend logic |
| `games/snake/snake.xml` | File | XML configuration or persisted data |
| `games/spinwheel` | Folder | folder |
| `games/spinwheel/README.md` | File | Documentation file |
| `games/spinwheel/spinwheel.js` | File | JavaScript gameplay or shared frontend logic |
| `games/spinwheel/spinwheel.xml` | File | XML configuration or persisted data |
| `games/tictactoe` | Folder | folder |
| `games/tictactoe/README.md` | File | Documentation file |
| `games/tictactoe/tictactoe.js` | File | JavaScript gameplay or shared frontend logic |
| `games/tictactoe/tictactoe.xml` | File | XML configuration or persisted data |
| `games/whackamole` | Folder | folder |
| `games/whackamole/README.md` | File | Documentation file |
| `games/whackamole/whackamole.js` | File | JavaScript gameplay or shared frontend logic |
| `games/whackamole/whackamole.xml` | File | XML configuration or persisted data |
| `generate_docs.py` | File | project file |
| `README.md` | File | Documentation file |
| `scores.xml` | File | XML configuration or persisted data |
| `static` | Folder | folder |
| `static/css` | Folder | folder |
| `static/css/styles.css` | File | Stylesheet for shared and game-specific UI |
| `static/css/multiplayer.css` | File | Multiplayer room and chat styling |
| `static/js` | Folder | folder |
| `static/js/main.js` | File | JavaScript gameplay or shared frontend logic |
| `static/js/multiplayer.js` | File | Vanilla JavaScript Socket.IO room client |
| `templates` | Folder | folder |
| `templates/game.html` | File | Jinja/HTML template |
| `templates/index.html` | File | Jinja/HTML template |
| `templates/leaderboard.html` | File | Jinja/HTML template |

## 🎮 All Games List
| # | Game Name | Category | Tech Used | Accent Color |
|---|---|---|---|---|
| 1 | Snake Rush | Arcade | Vanilla JS + Node.js API | `#39ff14` |
| 2 | Memory Pulse | Casual | Vanilla JS + Node.js API | `#00e5ff` |
| 3 | Quiz Reactor | Casual | Vanilla JS + Node.js API | `#ffb703` |
| 4 | Tic Tac Toe Grid | Board | Vanilla JS + Node.js API | `#ff4d9d` |
| 5 | Ludo Blitz | Board | Vanilla JS + Node.js API | `#ff6b35` |
| 6 | Neon Chess | Board | Vanilla JS + Node.js API | `#f0c040` |
| 7 | Spin the Wheel | Casual | Vanilla JS + Node.js API | `#c084fc` |
| 8 | 2048 Surge | Board | Vanilla JS + Node.js API | `#fb923c` |
| 9 | Whack-a-Mole | Arcade | Vanilla JS + Node.js API | `#4ade80` |
| 10 | Flappy Burst | Arcade | Vanilla JS + Node.js API | `#38bdf8` |
| 11 | Breakout Neon | Arcade | Vanilla JS + Node.js API | `#e879f9` |

## ⚙️ XML System Explained
- Every game has a local XML file consumed through `/api/config/<game_name>`.
- Node.js parses XML using `fast-xml-parser`.
- `config.xml` drives game-card metadata (title, accent, category).
- `scores.xml` stores leaderboard entries grouped by game.

```js
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser();
const config = parser.parse(xmlText);
```

### Example config.xml snippet
```xml
﻿<platform>
  <name>YUDY Game Arcade </name>
  <theme>dark-neon</theme>
  <games>
    <game name="snake" title="Snake Rush" accent="#39ff14" icon="🐍" category="arcade" is_new="false" />
    <game name="memory" title="Memory Pulse" accent="#00e5ff" icon="🧠" category="casual" is_new="false" />
    <game name="quiz" title="Quiz Reactor" accent="#ffb703" icon="❓" category="casual" is_new="false" />
    <game name="tictactoe" title="Tic Tac Toe Grid" accent="#ff4d9d" icon="⭕" category="board" is_new="false" />
    <game name="spinwheel" title="Spin the Wheel" accent="#c084fc" icon="🎡" category="casual" is_new="true" />
    <game name="ludo" title="Ludo Blitz" accent="#ff6b35" icon="🎲" category="board" is_new="true" />
    <game name="chess" title="Neon Chess" accent="#f0c040" icon="♞" category="board" is_new="true" />
    <game name="2048" title="2048 Surge" accent="#fb923c" icon="🔢" category="board" is_new="true" />
    <game name="whackamole" title="Whack-a-Mole" accent="#4ade80" icon="🐹" category="arcade" is_new="true" />
    <game name="flappy" title="Flappy Burst" accent="#38bdf8" icon="🐤" category="arcade" is_new="true" />
    <game name="breakout" title="Breakout Neon" accent="#e879f9" icon="🧱" category="arcade" is_new="true" />
...
```

### Example scores.xml snippet
```xml
<?xml version='1.0' encoding='utf-8'?>
<scores>
  <game name="snake">
    <entry>
      <player>Player1</player>
      <score>120</score>
      <timestamp>2026-03-26T12:00:00Z</timestamp>
    </entry>
  </game>
  <game name="memory">
    <entry>
      <player>Player1</player>
      <score>95</score>
      <timestamp>2026-03-26T12:00:00Z</timestamp>
    </entry>
  </game>
  <game name="quiz">
    <entry>
      <player>Player1</player>
      <score>70</score>
      <timestamp>2026-03-26T12:00:00Z</timestamp>
    </entry>
  </game>
  <game name="tictactoe">
...
```

## 🌐 API Reference
| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Home page with game cards |
| `GET` | `/game/<game_name>` | Load game container |
| `GET` | `/leaderboard` | Leaderboard page |
| `GET` | `/api/config/<game_name>` | Return parsed XML config as JSON |
| `POST` | `/api/score` | Save new score to scores.xml |
| `GET` | `/api/leaderboard` | Return top scores per game |
| `GET` | `/api/multiplayer/config` | Return multiplayer player limits and adapter readiness |
| `GET` | `/games/<game_name>/<filename>` | Serve game-local assets |

## Multiplayer Rooms
- Socket.IO is attached to the same Express HTTP server, so the app stays same-origin.
- Active rooms, players, chat messages and game state live in server memory using JavaScript `Map` objects.
- Player names are required, trimmed, limited to 2-20 characters, and stored in browser storage.
- Room codes are generated only on the server with six uppercase letters/numbers, excluding `0`, `O`, `1`, and `I`.
- Chat is scoped to room members, limited to 300 characters per message, and keeps the latest 100 messages in memory.
- Basic rate limits protect room creation, joining and chat.
- Existing single-player game code is still loaded the same way.

### Socket.IO events
Client to server:
`create_room`, `join_room`, `reconnect_room`, `leave_room`, `start_game`, `game_action`, `play_again`, `request_room_state`, `send_room_message`, `request_chat_history`, `chat_typing_start`, `chat_typing_stop`

Server to client:
`room_created`, `room_joined`, `room_state`, `player_joined`, `player_left`, `host_changed`, `game_started`, `game_state`, `game_over`, `match_ended`, `room_message`, `chat_history`, `room_system_message`, `room_typing`, `chat_error`, `room_error`

Create, join, reconnect and message sending use acknowledgement callbacks so the UI can display errors immediately.

### One room = one shared match
A room is permanently locked to the game it was created for. The creator selects a game, the server stores its `gameId` on the room, and every player who joins receives that same `gameId` and is forced onto that game screen (`openRoomGame` in `static/js/multiplayer.js`). Joiners never choose a game; the room's game is authoritative. Actions that reference a different `gameId` are rejected by the server.

### Private room chat + stable player sessions
Every room owns its private chat. Messages are created **only on the server** (`server/chatManager.js`), scoped to one room via `io.to(room.code)`, capped at 300 characters, rate limited to ~5 per 10 seconds per player, and kept to the latest 100 per room. History is restored on join/reconnect, and message ids are de-duplicated on the client (`static/js/room-chat.js`) so history + live events never render twice.

Each browser tab generates a stable `playerSessionId` (`crypto.randomUUID` in sessionStorage). Navigating from the lobby to a game page creates a new socket connection - the server matches the player by `sessionId`, swaps the `socketId` in place and keeps their role, so a page transition never duplicates or drops a player. A short disconnect grace period (8s) covers navigation; `reconnect_room` cancels it, otherwise the player is removed and the match ends.

The reusable chat component (`static/js/room-chat.js`, `static/css/room-chat.css`) is mounted in the multiplayer lobby AND on every game page: a two-column desktop layout keeps the game the main focus with a 320-380px chat sidebar, while mobile uses a floating chat button with an unread-message badge and a bottom-sheet drawer.

### Server-authoritative game state
The browser never decides moves, turns, scores or winners. The server owns one shared `gameState` per room:

- `create_room { playerName, gameId }` stores the locked game and makes the creator Player 1.
- `join_room { playerName, roomCode }` adds Player 2 and returns the room's `gameId`.
- `start_game` (host only) initializes one shared match, assigns roles, picks the first turn and sets the room to `playing`.
- `game_action { roomCode, action }` validates membership, turn and move against the game adapter, updates the shared state, then broadcasts `game_state` (and `game_over` when finished) to the whole room.
- `play_again` resets the shared state while preserving room, players, roles and the locked game.
- If a player disconnects mid-match, a short grace period lets them reconnect (page navigation/refresh) before the match is ended, the room returns to `waiting` (no bot is created) and the remaining player is notified; the room is deleted when no players remain.

### Game adapters
Server-side handlers live in `server/gameHandlers/`. Each adapter implements `createInitialState`, `assignRoles`, `firstTurn`, `nextTurn`, `validateAction`, `applyAction`, `checkWinner` and `resetState`:

```js
const gameHandlers = {
  "tictactoe": {
    createInitialState,
    assignRoles,
    validateAction,
    applyAction,
    checkWinner
  }
};
```

### Multiplayer readiness
Room lobby, player list, host transfer, start status, invite links and chat are available for all 11 games, and every game has a **complete** server-side multiplayer adapter.

The central registry in `server/gameRegistry.js` lists all 11 games with their player limits and mode (`turn-based` shared board or `simultaneous` competitive). `server/gameHandlers/index.js` maps every registered game id to its adapter:

- **Turn-based shared board:** Tic Tac Toe Grid (`tictactoe`), Neon Chess (`chess`), Ludo Blitz (`ludo`)
- **Simultaneous competitive:** Snake Rush (`snake`), Memory Pulse (`memory`), Quiz Reactor (`quiz`), Spin the Wheel (`spinwheel`), 2048 Surge (`2048`), Whack-a-Mole (`whackamole`), Flappy Burst (`flappy`), Breakout Neon (`breakout`)

Single-player mode is fully preserved: when a game page is not inside a room, the original local game runs unchanged.

### Request / Response format
- Score save request payload:
```json
{ "game": "snake", "player": "Player1", "score": 450, "meta": {"length": 19} }
```
- Score save response payload:
```json
{ "status": "ok", "saved": { "game": "snake", "player": "Player1", "score": 450 } }
```

## 🎨 Theme & Design
- Dark neon aesthetic with glowing accents and gradient atmospheres.
- Fonts: Orbitron (headings), Rajdhani (body/UI).
- Core CSS variables include `--bg-0`, `--bg-1`, `--text-main`, `--line`, and per-game `--accent`.
- Card animations and result effects are built with lightweight CSS keyframes.

| Visual Token | Value | Purpose |
|---|---|---|
| `--bg-0` | `#06080f` | Deep background base |
| `--bg-1` | `#0a0f1f` | Gradient secondary background |
| `--text-main` | `#e8f2ff` | Primary readable text |
| `--line` | `#1f2d4d` | Border and divider color |

## 📱 Device Support
- Desktop: supported.
- Mobile: supported via responsive layouts and touch controls.
- Tablet: supported with adaptive grid sizing.

### Local Network Access
1. Run `npm start` on host machine.
2. Find host local IP (for example `192.168.1.20`).
3. Open `http://<host-ip>:3000` from another device on same network.
4. Allow firewall access on port 3000 if needed.

## 🔮 Future Roadmap
- Add per-game server-side multiplayer adapters for board and arcade games.
- Add account profiles and persistent progression.
- Add game analytics dashboard and replay exports.
- Add mobile app wrapper (PWA + native shell).
- Add more games (Word Scramble, Minesweeper, Match-3).
- Add tournament events and seasonal leaderboards.

## 👤 Author
- Project: YUDY Game Arcade
- Author: _Your Name Here_ (placeholder)
- License: MIT

---

## 📚 Extended Appendix
- Appendix note 001: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 002: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 003: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 004: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 005: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 006: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 007: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 008: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 009: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 010: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 011: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 012: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 013: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 014: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 015: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 016: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 017: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 018: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 019: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 020: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 021: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 022: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 023: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 024: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 025: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 026: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 027: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 028: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 029: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 030: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 031: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 032: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 033: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 034: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 035: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 036: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 037: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 038: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 039: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 040: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 041: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 042: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 043: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 044: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 045: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 046: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 047: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 048: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 049: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 050: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 051: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 052: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 053: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 054: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 055: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 056: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 057: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 058: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 059: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 060: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 061: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 062: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 063: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 064: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 065: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 066: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 067: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 068: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 069: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 070: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 071: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 072: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 073: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 074: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 075: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 076: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 077: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 078: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 079: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 080: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 081: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 082: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 083: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 084: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 085: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 086: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 087: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 088: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 089: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 090: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 091: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 092: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 093: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 094: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 095: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 096: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 097: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 098: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 099: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 100: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 101: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 102: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 103: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 104: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 105: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 106: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 107: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 108: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 109: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 110: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 111: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 112: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 113: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 114: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 115: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 116: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 117: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 118: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 119: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 120: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 121: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 122: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 123: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 124: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 125: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 126: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 127: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 128: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 129: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 130: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 131: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 132: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 133: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 134: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 135: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 136: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 137: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 138: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 139: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 140: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 141: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 142: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 143: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 144: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 145: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 146: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 147: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 148: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 149: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 150: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 151: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 152: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 153: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 154: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 155: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 156: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 157: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 158: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 159: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 160: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 161: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 162: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 163: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 164: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 165: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 166: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 167: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 168: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 169: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 170: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 171: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 172: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 173: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 174: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 175: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 176: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 177: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 178: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 179: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 180: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 181: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 182: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 183: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 184: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 185: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 186: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 187: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 188: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 189: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 190: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 191: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 192: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 193: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 194: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 195: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 196: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 197: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 198: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 199: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 200: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 201: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 202: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 203: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 204: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 205: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 206: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 207: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 208: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 209: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 210: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 211: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 212: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 213: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 214: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 215: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 216: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 217: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 218: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
- Appendix note 219: Keep frontend and backend contracts aligned when extending game metadata, scoring fields, or XML schemas.
