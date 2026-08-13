# 🎮 Neon Fleet

## 📌 Overview
- **What the game is:** Battleship-style strategy game with private fleets and a target board.
- **Game category:** Strategy
- **Accent color:** `#4ade80`
- **Theme:** Neon naval warfare on a 10x10 grid (A–J × 1–10)
- **Mode:** Multiplayer (2 players, turn-based private boards) + solo vs AI

## 🕹️ How to Play
### Step by Step
1. Open **Neon Fleet** from the home screen.
2. Click **Play** for a solo match or **Multiplayer** to create/join a room.
3. Placement phase: place all five ships horizontally or vertically (preview before confirming, rotate, randomize or reset).
4. Click **Ready** once your fleet is deployed; the battle begins when both players are ready.
5. Battle phase: fire at cells on the enemy board. The server resolves hits and misses.
6. Sink every enemy ship to win - your own ship positions are never shown to the opponent.

### Controls
| Control | Action |
|---|---|
| Cell click / tap | Place a ship or fire a shot |
| `Rotate` | Toggle horizontal / vertical |
| `Random Placement` | Auto-deploy a valid fleet |
| `Reset Placement` | Clear your board |
| `Ready` | Lock your fleet and start battle |
| `Play Again` | Return to placement on a fresh board |
| `Surrender` | Concede the match |

### Objective
- Deploy your fleet and destroy all five enemy ships before they find yours.

## 🧠 Game Logic
### Core Algorithm Used
- Ship placement validation: bounds, overlap and duplicate checks on the server.
- Attack resolution marks hits/misses; a ship is announced destroyed when all its cells are hit.
- The first player to sink the whole enemy fleet wins.
- Solo AI: valid random placement, attacks untried cells, and switches to a basic hunting strategy after a hit.

### How the Game Loop Works
- Initialize state from XML configuration.
- Phases: waiting → placement → battle → finished.
- Both players ready → battle starts with Player 1's turn; turns alternate after each valid attack.
- The same cell cannot be attacked twice; out-of-turn attacks are rejected.

### Win / Lose / Draw Conditions
- Win: all five enemy ships sunk.
- Lose: your fleet is fully destroyed (or you surrender).
- Draw: not applicable.

### AI Logic
- After a hit, the computer searches adjacent untried cells; otherwise it fires at random valid cells.

## ⚙️ XML Configuration
### Fields
| Field | Type | Description |
|---|---|---|
| `grid_size` | `value` | Board dimensions (default 10). |
| `ships` | `value` | Comma-separated fleet sizes (default 5,4,3,3,2). |

### Default XML Values
```xml
<neon_fleet>
  <grid_size>10</grid_size>
  <ships>5,4,3,3,2</ships>
</neon_fleet>
```

## 📁 File Structure
| File | Description |
|---|---|
| `games/neon-fleet/neon-fleet.js` | Frontend logic (placement UI + battle boards + hunting AI). |
| `games/neon-fleet/neon-fleet.css` | Game-specific neon styling. |
| `games/neon-fleet/neon-fleet.xml` | Game configuration values. |
| `server/gameHandlers/neonFleet.js` | Server-authoritative rules (placement + private battles). |
| `static/icons/neon-fleet.svg` | Homepage card artwork. |

## 🔗 API Endpoints Used
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/config/neon-fleet` | Load game settings from XML as JSON. |
| `GET` | `/game/neon-fleet` | Open game container page. |
| `POST` | `/api/score` | Save new score entry to `scores.xml`. |
| `GET` | `/api/leaderboard` | Read top scores. |

## 🐛 Known Issues / Future Improvements
### Known Issues
- AI hunting strategy is intentionally simple; a parity-based checkerboard search would sink ships faster.

### Future Improvements
- Add a ship-selection mechanic (e.g., call shots for the carrier).
- Add spectator mode for friends.

## 📊 Score System
- Points are earned by winning battles.
- Match wins are posted with `game="neon-fleet"` to `/api/score`.

---

## 🧾 Developer Deep-Dive Notes
- Note 01: Private-state protection - `getPlayerState` sends only your own ships, your received attacks, public attack results, and destroyed-ship labels; the opponent's unhit coordinates are never included in a broadcast.
- Note 02: The server resolves every shot; the client only sends `attack_cell` intents.
- Note 03: After the second `placement_ready`, the turn stays with Player 1 (the anyShot guard) so the first attack is never stolen.
- Note 04: On finish, `revealedShips` exposes the enemy layout so players can review the match.
