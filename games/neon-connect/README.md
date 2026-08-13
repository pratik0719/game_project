# 🎮 Neon Connect

## 📌 Overview
- **What the game is:** Connect Four with animated neon discs.
- **Game category:** Strategy
- **Accent color:** `#22d3ee`
- **Theme:** Neon grid, cyan vs magenta discs
- **Mode:** Multiplayer (2 players, turn-based shared board) + solo vs AI (Easy / Medium / Hard)

## 🕹️ How to Play
### Step by Step
1. Open **Neon Connect** from the home screen.
2. Click **Play** for a solo match (pick a difficulty) or **Multiplayer** to create/join a room.
3. Click a column to drop your disc into the lowest empty cell.
4. Connect four discs horizontally, vertically or diagonally before your opponent.
5. A full board with no winner is a draw.

### Controls
| Control | Action |
|---|---|
| Column click / tap | Drop a disc |
| Easy / Medium / Hard | Solo AI difficulty |
| `Play Again` | Rematch on a fresh board |
| `Surrender` | Concede the match |

### Objective
- Place four discs in a row (horizontal, vertical or diagonal) while blocking your opponent.

## 🧠 Game Logic
### Core Algorithm Used
- Drop resolution finds the lowest empty row per column.
- Win detection scans horizontal, vertical, down-right and down-left runs of four.
- A full board (42 discs) with no winner is declared a draw.
- Solo AI: Easy picks randomly; Medium blocks obvious wins and takes available wins; Hard runs a depth-limited minimax with alpha-beta pruning.

### How the Game Loop Works
- Initialize state from XML configuration.
- Current player drops a disc; the server validates the column and turn.
- Check for 4-in-a-row or a full board.
- Alternate turns until the game ends.

### Win / Lose / Draw Conditions
- Win: four connected discs.
- Lose: opponent connects four first.
- Draw: all 42 cells filled with no 4-in-a-row.

### AI Logic
- Hard mode runs minimax in a deferred/worker-friendly chunk so the interface never freezes.

## ⚙️ XML Configuration
### Fields
| Field | Type | Description |
|---|---|---|
| `columns` | `value` | Board width (default 7). |
| `rows` | `value` | Board height (default 6). |
| `win_length` | `value` | Discs needed to win (default 4). |

### Default XML Values
```xml
<neon_connect>
  <columns>7</columns>
  <rows>6</rows>
  <win_length>4</win_length>
</neon_connect>
```

## 📁 File Structure
| File | Description |
|---|---|
| `games/neon-connect/neon-connect.js` | Frontend logic (animated discs + AI opponent). |
| `games/neon-connect/neon-connect.css` | Game-specific neon styling. |
| `games/neon-connect/neon-connect.xml` | Game configuration values. |
| `server/gameHandlers/neonConnect.js` | Server-authoritative rules (win/draw detection). |
| `static/icons/neon-connect.svg` | Homepage card artwork. |

## 🔗 API Endpoints Used
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/config/neon-connect` | Load game settings from XML as JSON. |
| `GET` | `/game/neon-connect` | Open game container page. |
| `POST` | `/api/score` | Save new score entry to `scores.xml`. |
| `GET` | `/api/leaderboard` | Read top scores. |

## 🐛 Known Issues / Future Improvements
### Known Issues
- Hard AI depth is capped to keep moves fast on low-end devices.

### Future Improvements
- Add a replay of the winning line.

## 📊 Score System
- Points are earned by winning matches.
- Match wins are posted with `game="neon-connect"` to `/api/score`.

---

## 🧾 Developer Deep-Dive Notes
- Note 01: `checkGameOver` reports the winner as a playerNumber (not the role string) so game_over payloads stay type-consistent across games.
- Note 02: The server rejects out-of-turn drops, invalid columns, full columns and moves after game over.
- Note 03: `winningCells` are sent to both clients so the winning line can glow.
- Note 04: Solo mode re-implements the rules locally; multiplayer always trusts the server state.
