"use strict";

const { envelope } = require("./stateUtil");

const COLORS = ["cyan", "pink", "green", "orange"];
const COLOR_LABELS = { cyan: "Neon Cyan", pink: "Plasma Pink", green: "Volt Green", orange: "Solar Orange" };
const VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "skip", "reverse", "draw2", "wild", "wild4"];
const ACTION_VALUES = new Set(["skip", "reverse", "draw2", "wild", "wild4"]);
const VALUE_LABELS = {
  0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  skip: "⊘", reverse: "⇄", draw2: "+2", wild: "★", wild4: "+4",
};

const HAND_SIZE = 7;
const TURN_TIMEOUT_MS = 30 * 1000;
const PENALTY_DRAW = 2;

let cardId = 0;

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ id: cardId += 1, color, value: 0 });
    for (let value = 1; value <= 9; value += 1) {
      deck.push({ id: cardId += 1, color, value });
      deck.push({ id: cardId += 1, color, value });
    }
    for (const value of ["skip", "reverse", "draw2"]) {
      deck.push({ id: cardId += 1, color, value });
      deck.push({ id: cardId += 1, color, value });
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push({ id: cardId += 1, color: "wild", value: "wild" });
    deck.push({ id: cardId += 1, color: "wild", value: "wild4" });
  }
  return deck;
}

function shuffle(items) {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function canPlay(card, activeColor, topCard) {
  if (!card) return false;
  if (card.value === "wild" || card.value === "wild4") return true;
  if (card.color === activeColor) return true;
  if (topCard && card.color !== "wild" && topCard.color !== "wild" && card.value === topCard.value) return true;
  return false;
}

/**
 * Server-authoritative Color Clash adapter (turn-based, private hands).
 *
 * The deck, discard pile and every hand live on the server. Players only
 * ever receive their own cards plus opponent card counts. The "Last Card!"
 * declaration is enforced with an automatic fallback and an optional
 * challenge that costs the offender a two-card penalty.
 */
const colorClashHandler = {
  gameId: "color-clash",
  mode: "turn-based-private-hand",
  roles: ["Ace", "Blaze", "Volt", "Nova"],
  minPlayers: 2,
  maxPlayers: 4,
  tickMs: 1000,
  colors: COLORS,
  colorLabels: COLOR_LABELS,
  valueLabels: VALUE_LABELS,

  createInitialState() {
    return {
      deck: [],
      discard: [],
      hands: {},
      eliminated: {},
      activeColor: null,
      direction: 1,
      pendingWild: null, // sessionId choosing a color
      pendingWild4: false, // the pending wild also draws 4 + skips
      pendingDraw: null, // sessionId may play the drawn card or pass
      pendingChallenge: null, // offender sessionId (last-card challenge window)
      lastCardAuto: null, // sessionId who forgot to declare Last Card
      holdTurn: false,
      playersToSkip: 0,
      winner: null,
      ranking: [],
      finished: false,
      turnStartedAt: Date.now(),
      lastEvent: null,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || `Player ${index + 1}`;
    });
  },

  firstTurn(room) {
    // initializeMatch already picked a random starting player - preserve it
    // instead of overwriting it with null (startGame calls firstTurn AFTER
    // initializeMatch).
    return room.currentTurn || room.players[0]?.socketId || null;
  },

  initializeMatch(room) {
    const state = room.gameState;
    state.deck = shuffle(buildDeck());
    state.hands = {};
    state.eliminated = {};
    for (const player of room.players) {
      state.hands[player.sessionId] = state.deck.splice(0, HAND_SIZE);
      state.eliminated[player.sessionId] = false;
    }

    // Flip a suitable starter card (numbers only).
    for (let attempt = 0; attempt < state.deck.length; attempt += 1) {
      const card = state.deck.shift();
      if (typeof card.value === "number") {
        state.discard = [card];
        state.activeColor = card.color;
        break;
      }
      state.deck.push(card); // reinsert action cards
    }
    if (state.discard.length === 0) {
      const card = state.deck.shift() || { id: 0, color: "cyan", value: 0 };
      state.discard = [card];
      state.activeColor = card.color;
    }

    const first = room.players[Math.floor(Math.random() * room.players.length)];
    room.currentTurn = first.socketId;
    state.turnStartedAt = Date.now();
  },

  nameFor(room, sessionId) {
    const player = room.players.find((entry) => entry.sessionId === sessionId);
    return player ? player.name : "A player";
  },

  topCard(state) {
    return state.discard.length > 0 ? state.discard[state.discard.length - 1] : null;
  },

  drawCard(state) {
    if (state.deck.length === 0) {
      // Reshuffle the discard pile (keeping the top card).
      const top = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [top];
    }
    if (state.deck.length === 0) return null;
    return state.deck.pop();
  },

  /** Draw `count` cards into a player's hand, returning how many were drawn. */
  drawIntoHand(state, sessionId, count) {
    let drawn = 0;
    for (let i = 0; i < count; i += 1) {
      const card = this.drawCard(state);
      if (!card) break;
      state.hands[sessionId].push(card);
      drawn += 1;
    }
    return drawn;
  },

  validateAction({ room, player, action }) {
    const state = room.gameState;
    if (!state) return { ok: false, error: "The match has not started." };
    if (state.finished) return { ok: false, error: "The match is already over." };
    if (state.eliminated[player.sessionId]) return { ok: false, error: "You have been eliminated." };
    if (room.currentTurn !== player.socketId) return { ok: false, error: "It is not your turn yet." };
    const type = String(action?.type || "").trim().toLowerCase();
    const hand = state.hands[player.sessionId] || [];

    if (type === "play_card") {
      if (state.pendingWild) return { ok: false, error: "Choose a color for the wild card first." };
      const cardId = String(action.cardId ?? "");
      const card = hand.find((entry) => String(entry.id) === cardId);
      if (!card) return { ok: false, error: "You do not have that card." };
      const top = this.topCard(state);
      if (!canPlay(card, state.activeColor, top)) return { ok: false, error: "That card cannot be played." };
      return { ok: true, card };
    }
    if (type === "draw_card") {
      if (state.pendingWild) return { ok: false, error: "Choose a color for the wild card first." };
      if (state.pendingDraw) return { ok: false, error: "Play the card you drew or pass." };
      return { ok: true };
    }
    if (type === "pass_turn") {
      if (state.pendingDraw !== player.sessionId) return { ok: false, error: "You cannot pass right now." };
      return { ok: true };
    }
    if (type === "choose_wild_color") {
      if (state.pendingWild !== player.sessionId) return { ok: false, error: "It is not your turn to choose a color." };
      const color = String(action.color || "").trim().toLowerCase();
      if (!COLORS.includes(color)) return { ok: false, error: "Invalid color." };
      return { ok: true, color };
    }
    if (type === "declare_last_card") {
      // The declaration only means something when the player holds two cards
      // and plays one to reach a single card.
      if (hand.length !== 2) return { ok: false, error: "Declare Last Card only when you hold two cards." };
      return { ok: true };
    }
    if (type === "challenge_last_card") {
      if (!state.pendingChallenge) return { ok: false, error: "There is nothing to challenge." };
      if (state.pendingChallenge === player.sessionId) return { ok: false, error: "You cannot challenge yourself." };
      return { ok: true };
    }
    if (type === "surrender") {
      return { ok: true };
    }
    return { ok: false, error: "Unknown action type for this game." };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    const type = String(action?.type || "").trim().toLowerCase();
    const hand = state.hands[player.sessionId] || [];

    if (type === "play_card") {
      const card = valid.card;
      const index = hand.findIndex((entry) => entry.id === card.id);
      const [played] = hand.splice(index, 1);
      state.discard.push(played);
      const lastCardDeclared = Boolean(action.lastCard);

      // Wild cards wait for a color selection before the turn advances.
      if (played.value === "wild" || played.value === "wild4") {
        state.activeColor = null;
        state.pendingWild = player.sessionId;
        state.pendingWild4 = played.value === "wild4";
        state.lastEvent = { type: "wild", text: `${player.name} played a Wild card.` };
        this.afterPlayChecks(room, player, state, hand, lastCardDeclared);
        return;
      }

      state.activeColor = played.color;
      state.lastEvent = { type: "play", text: `${player.name} played ${COLOR_LABELS[played.color]} ${VALUE_LABELS[played.value]}.` };

      if (played.value === "skip") {
        state.playersToSkip += 1;
      } else if (played.value === "reverse") {
        if (room.players.length === 2) {
          state.playersToSkip += 1; // reverse behaves like skip in 2p
        } else {
          state.direction *= -1;
        }
      } else if (played.value === "draw2") {
        const next = this.nextPlayer(room, state);
        if (next) this.drawIntoHand(state, next.sessionId, 2);
        state.playersToSkip += 1;
      }

      this.afterPlayChecks(room, player, state, hand, lastCardDeclared);
      return;
    }

    if (type === "draw_card") {
      const card = this.drawCard(state);
      if (!card) {
        state.lastEvent = { type: "empty", text: "The draw pile is empty - turn passes." };
        return; // nextTurn advances
      }
      hand.push(card);
      if (canPlay(card, state.activeColor, this.topCard(state))) {
        state.pendingDraw = player.sessionId;
        state.lastEvent = { type: "draw", text: `${player.name} drew a playable card.` };
      } else {
        state.lastEvent = { type: "draw", text: `${player.name} drew a card.` };
      }
      return;
    }

    if (type === "pass_turn") {
      state.pendingDraw = null;
      state.lastEvent = { type: "pass", text: `${player.name} passed.` };
      return;
    }

    if (type === "choose_wild_color") {
      state.activeColor = valid.color;
      state.pendingWild = null;
      if (state.pendingWild4) {
        state.pendingWild4 = false;
        const next = this.nextPlayer(room, state);
        if (next) this.drawIntoHand(state, next.sessionId, 4);
        state.playersToSkip += 1;
      }
      state.lastEvent = { type: "color", text: `${player.name} chose ${COLOR_LABELS[valid.color]}.` };
      return;
    }

    if (type === "declare_last_card") {
      state.lastCardAuto = null;
      state.pendingChallenge = null;
      state.lastEvent = { type: "last", text: `${player.name} declared LAST CARD!` };
      return;
    }

    if (type === "challenge_last_card") {
      const offender = state.pendingChallenge;
      if (offender) {
        const drawn = this.drawIntoHand(state, offender, PENALTY_DRAW);
        state.lastEvent = {
          type: "challenge",
          text: `${player.name} challenged - ${this.nameFor(room, offender)} draws ${drawn} cards!`,
        };
      }
      state.pendingChallenge = null;
      state.lastCardAuto = null;
      state.holdTurn = true; // the challenger's turn continues without advancing
      return;
    }

    if (type === "surrender") {
      state.eliminated[player.sessionId] = true;
      state.hands[player.sessionId] = [];
      state.lastEvent = { type: "surrender", text: `${player.name} surrendered.` };
      this.checkSurrenderEnd(room, state);
    }
  },

  /** After a card is played: last-card declaration, win detection. */
  afterPlayChecks(room, player, state, hand, lastCardDeclared) {
    if (hand.length === 0) {
      state.winner = player.sessionId;
      state.finished = true;
      state.lastEvent = { type: "win", text: `${player.name} empties their hand - Color Clash!` };
      return;
    }
    if (hand.length === 1) {
      if (lastCardDeclared) {
        state.lastEvent = { type: "last", text: `${player.name} declared LAST CARD!` };
      } else {
        // Automatic fallback declaration + challenge window (stable rule).
        state.lastCardAuto = player.sessionId;
        state.pendingChallenge = player.sessionId;
        state.lastEvent = { type: "auto-last", text: `${player.name} forgot to declare Last Card - they may be challenged!` };
      }
    }
  },

  checkSurrenderEnd(room, state) {
    const remaining = room.players.filter((player) => !state.eliminated[player.sessionId]);
    if (remaining.length === 1) {
      state.winner = remaining[0].sessionId;
      state.finished = true;
      state.lastEvent = { type: "win", text: `${remaining[0].name} is the last player standing!` };
    }
  },

  nextPlayer(room, state) {
    const index = room.players.findIndex((player) => player.socketId === room.currentTurn);
    if (index === -1) return room.players[0] || null;
    const count = room.players.length;
    let nextIndex = (index + state.direction + count) % count;
    let guard = 0;
    while (state.eliminated[room.players[nextIndex]?.sessionId] && guard < count) {
      nextIndex = (nextIndex + state.direction + count) % count;
      guard += 1;
    }
    return room.players[nextIndex] || null;
  },

  nextTurn(room) {
    const state = room.gameState;
    if (!state || state.finished) return;
    // The current player must finish pending actions first.
    if (state.pendingWild || state.pendingDraw) return;
    if (state.holdTurn) {
      state.holdTurn = false;
      state.turnStartedAt = Date.now();
      return;
    }
    // The last-card challenge window belongs to the NEXT player's turn: the
    // offender's play advances with pendingChallenge intact, and the window
    // closes as soon as any other player acts (which is this call).
    // Note: currentTurn holds a socketId while pendingChallenge is a sessionId.
    const currentActor = room.players.find((entry) => entry.socketId === room.currentTurn);
    if (state.pendingChallenge && currentActor && currentActor.sessionId !== state.pendingChallenge) {
      state.pendingChallenge = null;
      state.lastCardAuto = null;
    }

    const count = room.players.length;
    if (count === 0) return;
    let index = room.players.findIndex((player) => player.socketId === room.currentTurn);
    if (index === -1) index = 0;
    const steps = 1 + state.playersToSkip;
    state.playersToSkip = 0;
    let next = room.players[index];
    for (let step = 0; step < steps; step += 1) {
      index = (index + state.direction + count) % count;
      next = room.players[index];
      let guard = 0;
      while (next && state.eliminated[next.sessionId] && guard < count) {
        index = (index + state.direction + count) % count;
        next = room.players[index];
        guard += 1;
      }
    }
    room.currentTurn = next ? next.socketId : room.currentTurn;
    state.turnStartedAt = Date.now();
  },

  tick(room) {
    const state = room.gameState;
    if (!state || state.finished) return;
    if (state.pendingChallenge) {
      // The challenger has a window to challenge; auto-decline on timeout.
      if (Date.now() - state.turnStartedAt > TURN_TIMEOUT_MS) {
        state.pendingChallenge = null;
        state.lastCardAuto = null;
        this.nextTurn(room);
      }
      return;
    }
    if (Date.now() - state.turnStartedAt <= TURN_TIMEOUT_MS) return;

    const player = room.players.find((entry) => entry.socketId === room.currentTurn);
    if (!player || state.eliminated[player.sessionId]) {
      this.nextTurn(room);
      return;
    }

    if (state.pendingWild === player.sessionId) {
      // Auto-pick a color the player holds most of.
      const hand = state.hands[player.sessionId] || [];
      const counts = {};
      for (const card of hand) {
        if (card.color !== "wild") counts[card.color] = (counts[card.color] || 0) + 1;
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || COLORS[0];
      state.activeColor = best;
      state.pendingWild = null;
      if (state.pendingWild4) {
        state.pendingWild4 = false;
        const next = this.nextPlayer(room, state);
        if (next) this.drawIntoHand(state, next.sessionId, 4);
        state.playersToSkip += 1;
      }
      state.lastEvent = { type: "auto-color", text: `${player.name} timed out - auto-chose ${COLOR_LABELS[best]}.` };
      this.nextTurn(room);
      return;
    }

    if (state.pendingDraw === player.sessionId) {
      state.pendingDraw = null;
      state.lastEvent = { type: "auto-pass", text: `${player.name} timed out - the drawn card is passed.` };
      this.nextTurn(room);
      return;
    }

    // Timeout: auto-draw one card and move on.
    const card = this.drawCard(state);
    if (card) {
      state.hands[player.sessionId].push(card);
      state.lastEvent = { type: "auto-draw", text: `${player.name} timed out and drew a card.` };
    } else {
      state.lastEvent = { type: "auto-pass", text: `${player.name} timed out.` };
    }
    this.nextTurn(room);
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (!state) return { finished: false, winner: null, draw: false };
    if (state.finished && state.winner) {
      const winner = room.players.find((entry) => entry.sessionId === state.winner);
      return { finished: true, winner: winner ? winner.playerNumber : null, draw: false };
    }
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },

  getPlayerState(room, sessionId) {
    const state = room.gameState;
    const me = room.players.find((entry) => entry.sessionId === sessionId) || null;
    const currentPlayer = room.players.find((entry) => entry.socketId === room.currentTurn);
    const winnerPlayer = state.winner ? room.players.find((entry) => entry.sessionId === state.winner) : null;

    // Ranking is computed live from remaining card counts.
    const liveRanking = room.players
      .map((player) => ({
        sessionId: player.sessionId,
        name: player.name,
        cards: (state.hands[player.sessionId] || []).length,
        eliminated: Boolean(state.eliminated[player.sessionId]),
      }))
      .sort((a, b) => a.cards - b.cards);

    const gameState = {
      myHand: state.hands[sessionId] || [],
      opponents: room.players
        .filter((player) => player.sessionId !== sessionId)
        .map((player) => ({
          sessionId: player.sessionId,
          name: player.name,
          cardCount: (state.hands[player.sessionId] || []).length,
          eliminated: Boolean(state.eliminated[player.sessionId]),
        })),
      topCard: this.topCard(state) || null,
      activeColor: state.activeColor,
      activeColorLabel: state.activeColor ? COLOR_LABELS[state.activeColor] : null,
      direction: state.direction,
      currentTurnSession: currentPlayer ? currentPlayer.sessionId : null,
      isMyTurn: Boolean(me && currentPlayer && currentPlayer.sessionId === me.sessionId),
      drawPileCount: state.deck.length,
      pendingWild: state.pendingWild === sessionId,
      pendingDraw: state.pendingDraw === sessionId,
      canChallenge: Boolean(state.pendingChallenge && me && currentPlayer && currentPlayer.sessionId === me.sessionId && state.pendingChallenge !== me.sessionId),
      challengeTarget: state.pendingChallenge ? this.nameFor(room, state.pendingChallenge) : null,
      autoDeclared: state.lastCardAuto === sessionId,
      turnSeconds: Math.ceil(TURN_TIMEOUT_MS / 1000),
      turnStartedAt: state.turnStartedAt,
      colors: COLORS,
      colorLabels: COLOR_LABELS,
      valueLabels: VALUE_LABELS,
      lastEvent: state.lastEvent,
      winnerSession: state.winner,
      winnerName: winnerPlayer ? winnerPlayer.name : null,
      ranking: liveRanking,
      finished: state.finished,
    };

    // Once finished, reveal all hands so the table can review the game.
    if (state.finished) {
      gameState.revealedHands = room.players.map((player) => ({
        sessionId: player.sessionId,
        name: player.name,
        cards: state.hands[player.sessionId] || [],
      }));
    }

    return envelope(room, sessionId, gameState, {
      winner: winnerPlayer ? winnerPlayer.playerNumber : null,
      draw: false,
    });
  },
};

module.exports = colorClashHandler;
