"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("ludo");
let paletteRaw = (config.token_colors || {}).color || [];
if (!Array.isArray(paletteRaw)) paletteRaw = [paletteRaw];
const palette = paletteRaw.map((entry) => ({
  name: String(entry?.["@_name"] || "Player"),
  color: String(entry?.["@_code"] || "#ffffff"),
}));
while (palette.length < 4) {
  const names = ["Red", "Green", "Yellow", "Blue"];
  const colors = ["#ff4d4d", "#22c55e", "#facc15", "#38bdf8"];
  palette.push({ name: names[palette.length], color: colors[palette.length] });
}

const START_OFFSETS = [0, 13, 26, 39];
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/**
 * Server-authoritative Ludo adapter (turn-based shared board).
 *
 * Every human in the room takes one color. The server owns the dice, all
 * token movement, captures, extra turns and the win condition. Clients
 * only send "roll" and "move" intents.
 */
const ludoHandler = {
  gameId: "ludo",
  mode: "turn-based",
  roles: palette.slice(0, 4).map((entry) => entry.name),

  createInitialState() {
    return {
      players: [],
      currentPlayerIndex: 0,
      dice: null,
      canRoll: true,
      finished: false,
      winner: null,
      draw: false,
      startTime: Date.now(),
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = palette[index % palette.length].name;
    });
  },

  firstTurn(room) {
    return room.players[0]?.socketId || null;
  },

  // Turn flow (roll -> move -> next) is managed entirely inside applyAction
  // because a single roll can trigger a move, an extra turn or a turn skip.
  nextTurn(room) {
    // no-op: ludo manages its own turn transitions internally.
  },

  initializeMatch(room) {
    room.gameState.players = room.players.map((player) => ({
      playerNumber: player.playerNumber,
      tokens: [-1, -1, -1, -1],
      captures: 0,
    }));
    room.gameState.currentPlayerIndex = 0;
    room.currentTurn = room.players[0]?.socketId || null;
  },

  currentState(room) {
    return room.gameState.players[room.gameState.currentPlayerIndex];
  },

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    const state = room.gameState;

    if (state.finished) return { ok: false, error: "The match is already over." };
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.socketId !== player.socketId) {
      return { ok: false, error: "It is not your turn." };
    }

    if (type === "roll") {
      if (!state.canRoll) return { ok: false, error: "You already rolled. Move a token first." };
      return { ok: true, type: "roll" };
    }

    if (type === "move") {
      if (state.dice === null || state.canRoll) return { ok: false, error: "Roll the dice first." };
      const tokenIndex = Number.parseInt(action.tokenIndex, 10);
      if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
        return { ok: false, error: "Invalid token index." };
      }
      const validMoves = this.validMovesForPlayer(this.currentState(room), state.dice);
      if (!validMoves.includes(tokenIndex)) {
        return { ok: false, error: "That token cannot move with this roll." };
      }
      return { ok: true, type: "move", tokenIndex };
    }

    return { ok: false, error: "Unknown action type for this game." };
  },

  validMovesForPlayer(state, rolled) {
    const moves = [];
    state.tokens.forEach((step, tokenIndex) => {
      if (step === -1 && rolled === 6) {
        moves.push(tokenIndex);
        return;
      }
      if (step >= 0 && step + rolled <= 57) moves.push(tokenIndex);
    });
    return moves;
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;

    if (valid.type === "roll") {
      state.dice = 1 + Math.floor(Math.random() * 6);
      state.canRoll = false;
      const playerState = this.currentState(room);
      const moves = this.validMovesForPlayer(playerState, state.dice);
      if (moves.length === 0) {
        this.advanceTurn(room);
      }
      return;
    }

    // --- move ---
    const playerState = this.currentState(room);
    const dice = state.dice;
    const tokenIndex = valid.tokenIndex;
    const currentStep = playerState.tokens[tokenIndex];
    let nextStep = currentStep;

    if (currentStep === -1 && dice === 6) {
      nextStep = 0;
    } else if (currentStep >= 0 && currentStep + dice <= 57) {
      nextStep = currentStep + dice;
    } else {
      this.advanceTurn(room);
      return;
    }

    playerState.tokens[tokenIndex] = nextStep;
    this.handleCaptures(state, playerState, tokenIndex, nextStep);

    if (playerState.tokens.every((step) => step === 57)) {
      state.finished = true;
      state.winner = playerState.playerNumber;
      state.draw = false;
      return;
    }

    if (dice === 6) {
      state.dice = null;
      state.canRoll = true;
      return; // extra turn
    }

    this.advanceTurn(room);
  },

  handleCaptures(state, playerState, tokenIndex, step) {
    if (step < 0 || step > 51) return;
    const landingBoardIndex = (START_OFFSETS[state.currentPlayerIndex] + step) % 52;
    if (SAFE_SQUARES.has(landingBoardIndex)) return;

    state.players.forEach((opponent) => {
      if (opponent.playerNumber === playerState.playerNumber) return;
      opponent.tokens.forEach((oppStep, oppTokenIndex) => {
        if (oppStep < 0 || oppStep > 51) return;
        const oppBoardIndex = (START_OFFSETS[state.players.indexOf(opponent)] + oppStep) % 52;
        if (oppBoardIndex === landingBoardIndex) {
          opponent.tokens[oppTokenIndex] = -1;
          playerState.captures += 1;
        }
      });
    });
  },

  advanceTurn(room) {
    const state = room.gameState;
    state.dice = null;
    state.canRoll = true;
    if (state.finished) return;
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % room.players.length;
    room.currentTurn = room.players[state.currentPlayerIndex]?.socketId || null;
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },
};

module.exports = ludoHandler;
