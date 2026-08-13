# 🎮 Color Clash

## 📌 Overview
- **What the game is:** Original color-and-number card game (UNO-style) with action cards and a last-card rule.
- **Game category:** Cards
- **Accent color:** `#fbbf24`
- **Theme:** Neon card table (cyan, pink, green, orange)
- **Mode:** Multiplayer (2–4 players, turn-based private hands) + solo vs 1–3 bots

## 🕹️ How to Play
### Step by Step
1. Open **Color Clash** from the home screen.
2. Click **Play** for a solo match or **Multiplayer** to create/join a room (2–4 players).
3. Match the top card by color, number or action symbol - or play a Wild.
4. When you hold two cards, press **Last Card!** before playing your second-to-last card (automatic fallback + challenge otherwise).
5. Empty your hand first to win; final ranking is computed from remaining card counts.

### Controls
| Control | Action |
|---|---|
| Card click / tap | Play a card (matches color, number or symbol) |
| `Draw Card` | Draw one card; play it immediately if playable or pass |
| `Pass` | End your turn after drawing |
| `Last Card!` | Declare before playing down to one card |
| `Challenge (+2)` | Penalize a player who forgot to declare |
| Color buttons | Pick a color after a Wild |
| `Play Again` | New deal on a fresh deck |
| `Surrender` | Concede the match |

### Objective
- Be the first player to empty your hand. Action cards (Skip, Reverse, Draw Two, Wild, Wild Draw Four) change turn flow.

## 🧠 Game Logic
### Core Algorithm Used
- Server-side Fisher–Yates shuffle; the deck, discard pile and every hand live on the server.
- Action effects: Skip skips the next player, Reverse flips direction (acts as Skip in 2-player), Draw Two makes the next player draw 2 and lose their turn, Wild selects a color, Wild Draw Four makes the next player draw 4 and lose their turn.
- Last-card rule: playing down to one card without declaring opens a challenge window; a successful challenge costs the offender two cards.
- The first player with zero cards wins; ranking sorts remaining card counts.

### How the Game Loop Works
- Initialize state from XML configuration.
- Shuffle the deck, deal seven cards privately to each player, flip a suitable starter card.
- Players play/draw in turn; the server validates every move.
- Action cards alter direction, skips and draw obligations.
- Check for zero cards, surrenders and the last-card challenge window.

### Win / Lose / Draw Conditions
- Win: empty your hand first (or be the last standing after surrenders).
- Lose: any other player empties their hand first.
- Draw: not applicable in normal play.

### AI Logic
- Bots play a valid card when possible, pick a wild color based on their hand, draw when necessary, and follow action-card effects without inspecting hidden cards.

## ⚙️ XML Configuration
### Fields
| Field | Type | Description |
|---|---|---|
| `hand_size` | `value` | Starting hand size (default 7). |
| `bot_count` | `value` | Solo bots 0–3 (default 1). |
| `turn_seconds` | `value` | Turn timer in seconds (default 30). |
| `colors` | `value[]` | Card colors (cyan, pink, green, orange). |

### Default XML Values
```xml
<clash>
  <hand_size>7</hand_size>
  <bot_count>1</bot_count>
  <turn_seconds>30</turn_seconds>
  <colors>
    <color>cyan</color>
    <color>pink</color>
    <color>green</color>
    <color>orange</color>
  </colors>
</clash>
```

## 📁 File Structure
| File | Description |
|---|---|
| `games/color-clash/color-clash.js` | Frontend logic (card table + bots + wild modal). |
| `games/color-clash/color-clash.css` | Game-specific neon styling. |
| `games/color-clash/color-clash.xml` | Game configuration values. |
| `server/gameHandlers/colorClash.js` | Server-authoritative rules (deck, hands, action cards, challenges). |
| `static/icons/color-clash.svg` | Homepage card artwork. |

## 🔗 API Endpoints Used
| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/config/color-clash` | Load game settings from XML as JSON. |
| `GET` | `/game/color-clash` | Open game container page. |
| `POST` | `/api/score` | Save new score entry to `scores.xml`. |
| `GET` | `/api/leaderboard` | Read top scores. |

## 🐛 Known Issues / Future Improvements
### Known Issues
- Card stacking (playing a Draw Two on a Draw Two) is intentionally not implemented in this version.

### Future Improvements
- Add card stacking and a score-streak bonus.
- Add discard-pile reshuffle animation.

## 📊 Score System
- Points are earned by winning rounds.
- Match wins are posted with `game="color-clash"` to `/api/score`.

---

## 🧾 Developer Deep-Dive Notes
- Note 01: Private-hand security - `getPlayerState` sends only `myHand`, opponent card counts and the top card; the deck and other players' cards are never broadcast.
- Note 02: `firstTurn` preserves the random starting player picked by `initializeMatch` instead of overwriting it.
- Note 03: The last-card challenge window compares the current player's sessionId to `pendingChallenge` (socketId vs sessionId mismatch is avoided) so the window closes exactly when another player acts.
- Note 04: `declare_last_card` is validated to require exactly two cards in hand.
- Note 05: Solo mode mirrors the server rules locally; multiplayer always trusts the server state.
