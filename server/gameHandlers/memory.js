"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("memory");

const MODES = ["numbers", "fruits", "alphabets"];
const defaultMode = String(config.default_mode || "numbers").trim().toLowerCase();

// Fallback pools used only if the XML config is missing or malformed.
const MODE_DEFAULTS = {
  numbers: ["11", "23", "34", "45", "56", "67", "78", "89"],
  fruits: ["Apple", "Banana", "Cherry", "Grapes", "Kiwi", "Lemon", "Mango", "Orange"],
  alphabets: ["A", "B", "C", "D", "E", "F", "G", "H"],
};

/** Read one mode's value pool from the XML config (defensive parsing). */
function poolFor(mode) {
  const key = MODES.includes(mode) ? mode : defaultMode;
  const raw = (config.modes || {})[key];
  let values = raw && raw.value !== undefined ? raw.value : raw;
  if (!Array.isArray(values)) values = values === undefined || values === null ? [] : [values];
  const pool = values
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
    .map((value) => String(value).trim());
  return pool.length > 0 ? pool : MODE_DEFAULTS[key] || MODE_DEFAULTS[defaultMode];
}

const PAIR_COUNT = Math.max(2, Math.min(12, Number(config.pair_count || 8)));
const HIDE_MISMATCH_MS = 700;

/**
 * Server-authoritative Memory adapter (simultaneous competitive).
 *
 * Every player races to match all pairs on their own shuffled deck.
 * The server owns every card flip; mismatched cards are auto-hidden on a
 * short server tick. The first player to match every pair wins.
 */
const memoryHandler = {
  gameId: "memory",
  mode: "simultaneous",
  tickMs: HIDE_MISMATCH_MS,
  roles: ["Player 1", "Player 2"],
  modes: MODES,
  defaultMode: MODES.includes(defaultMode) ? defaultMode : MODES[0],

  createInitialState() {
    return {
      playerStates: {},
      finished: false,
      winner: null,
      draw: false,
      startTime: Date.now(),
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = `Player ${index + 1}`;
    });
  },

  firstTurn(room) {
    return null;
  },

  initializeMatch(room) {
    room.gameState.playerStates = {};
    room.players.forEach((player) => {
      room.gameState.playerStates[player.playerNumber] = this.freshPlayerState(room);
    });
  },

  freshPlayerState(room) {
    const selected = poolFor(room.mode || this.defaultMode).slice(0, PAIR_COUNT);
    const deck = this.shuffle(
      [...selected, ...selected].map((symbol, index) => ({
        id: index,
        symbol,
        revealed: false,
        matched: false,
      }))
    );
    return {
      deck,
      openCards: [],
      lockBoard: false,
      matchedPairs: 0,
      moves: 0,
      finished: false,
      finishMoves: 0,
      finishSeconds: 0,
      hideAt: null,
    };
  },

  shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
  },

  validateAction({ player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "flip") return { ok: false, error: "Unknown action type for this game." };
    const index = Number.parseInt(action.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= PAIR_COUNT * 2) {
      return { ok: false, error: "Invalid card index." };
    }
    return { ok: true, index };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState.playerStates[player.playerNumber];
    if (!state || state.finished) return;
    if (state.lockBoard) return;

    const card = state.deck[valid.index];
    if (!card || card.revealed || card.matched) return;

    card.revealed = true;
    state.openCards.push(valid.index);

    if (state.openCards.length < 2) return;

    state.moves += 1;
    state.lockBoard = true;

    const [firstIndex, secondIndex] = state.openCards;
    const first = state.deck[firstIndex];
    const second = state.deck[secondIndex];

    if (first.symbol === second.symbol) {
      first.matched = true;
      second.matched = true;
      state.matchedPairs += 1;
      state.openCards = [];
      state.lockBoard = false;
      if (state.matchedPairs === PAIR_COUNT) {
        state.finished = true;
        state.finishMoves = state.moves;
        state.finishSeconds = Math.round((Date.now() - room.gameState.startTime) / 1000);
      }
      return;
    }

    state.hideAt = Date.now() + HIDE_MISMATCH_MS;
  },

  tick(room) {
    const state = room.gameState;
    const now = Date.now();
    for (const playerNumber of Object.keys(state.playerStates)) {
      const playerState = state.playerStates[playerNumber];
      if (playerState.finished || !playerState.lockBoard || !playerState.hideAt) continue;
      if (now < playerState.hideAt) continue;
      playerState.openCards.forEach((index) => {
        const card = playerState.deck[index];
        if (card && !card.matched) card.revealed = false;
      });
      playerState.openCards = [];
      playerState.lockBoard = false;
      playerState.hideAt = null;
    }
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };

    for (const playerNumber of Object.keys(state.playerStates)) {
      if (state.playerStates[playerNumber].finished) {
        state.finished = true;
        state.winner = Number(playerNumber);
        state.draw = false;
        return { finished: true, winner: state.winner, draw: false };
      }
    }
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },
};

module.exports = memoryHandler;
