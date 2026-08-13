# 🎮 RPS Arena

## 📌 Overview
- **What the game is:** Best-of-five Rock Paper Scissors duel with hidden simultaneous choices.
- **Game category:** Casual
- **Accent color:** `#ff2d78`
- **Theme:** Neon duel arena with a 15-second selection timer
- **Mode:** Multiplayer (2 players, simultaneous-hidden-choice) + solo vs computer

## 🕹️ How to Play
### Step by Step
1. Open **RPS Arena** from the home screen.
2. Click **Play** for a solo match or **Multiplayer** to create/join a room.
3. Pick Rock, Paper or Scissors before the 15-second timer runs out.
4. Both choices are revealed simultaneously after both players submit.
5. First player to win three rounds wins the match.

### Controls
| Control | Action |
|---|---|
| `Rock / Paper / Scissors` buttons | Submit your hidden choice |
| `Next Round` | Advance after a revealed round |
| `Play Again` | Rematch with reset scores |
| `Surrender` | Concede the match |

### Objective
- Win 3 of 5 rounds. Rock defeats Scissors, Scissors defeats Paper, Paper defeats Rock.

## 🧠 Game Logic
### Core Algorithm Used
- Choices are stored privately on the server; the opponent only learns "ready".
- Both choices are revealed simultaneously only after both players submit.
- A tied round awards no point; first to three round wins takes the match.
- Server-managed 15-second timer: one submission wins by forfeit, zero submissions restart the round.

### How the Game Loop Works
- Initialize state from XML configuration.
- Each player submits a locked choice.
- Server resolves the round and reveals both choices together.
- Check best-of-five terminal condition and announce the match winner.

### Win / Lose / Draw Conditions
- Win: first to 3 round points.
- Lose: opponent reaches 3 round points first.
- Draw: a round can tie (no point awarded); the match always ends with a winner or forfeit.

### AI Logic
- The computer picks randomly without inspecting the player's current choice.

## ⚙️ XML Configuration
### Fields
| Field | Type | Description |
|---|---|---|
| `rounds_to_win` | `value` | Rounds needed to win the match (default 3). |
| `turn_seconds` | `value` | Selection timer in seconds (default 15). |

### Default XML Values
```xml
<rps_arena>
  <rounds_to_win>3</rounds_to_win>
  <turn_seconds>15</turn_seconds>
</rps_arena>
```

## 📁 File Structure
| File | Description |
|---|---|
| `games/rps-arena/rps-arena.js` | Frontend game logic (solo engine + multiplayer adapter). |
| `games/rps-arena/rps-arena.css` | Game-specific neon styling. |
| `games/rps-arena/rps-arena.xml` | Game configuration values. |
| `server/gameHandlers/rpsArena.js` | Server-authoritative rules (rounds, forfeits, timers). |
| `static/icons/rps-arena.svg` | Homepage card artwork. |

## 🔗 API Endpoints Used
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/config/rps-arena` | Load game settings from XML as JSON. |
| `GET` | `/game/rps-arena` | Open game container page. |
| `POST` | `/api/score` | Save new score entry to `scores.xml`. |
| `GET` | `/api/leaderboard` | Read top scores. |

## 🐛 Known Issues / Future Improvements
### Known Issues
- Timer accuracy depends on the socket tick interval; edge-of-deadline submissions resolve on the next tick.

### Future Improvements
- Add best-of-three match option.
- Add tournament bracket mode.

## 📊 Score System
- Points are earned by winning rounds and matches.
- Match wins are posted with `game="rps-arena"` to `/api/score`.

---

## 🧾 Developer Deep-Dive Notes
- Note 01: `submit_choice` is a one-way lock - a second submission is rejected with `already locked`.
- Note 02: `getPlayerState` never includes the opponent's choice before the reveal phase.
- Note 03: The forfeit tick awards the round to the submitter and fires a `forfeit` lastEvent before the `round_win` event.
- Note 04: Solo mode mirrors the server rules locally so both modes behave identically.
