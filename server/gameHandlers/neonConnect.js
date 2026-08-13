"use strict";

const { envelope } = require("./stateUtil");

const COLS = 7;
const ROWS = 6;
const WIN_LENGTH = 4;

/** Check for WIN_LENGTH-in-a-row through (row, col); returns cell list or []. */
function findWinningCells(board, row, col, role) {
  const directions = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // down-right
    [1, -1], // down-left
  ];
  for (const [dr, dc] of directions) {
    const cells = [[row, col]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === role) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= WIN_LENGTH) return cells;
  }
  return [];
}

/**
 * Server-authoritative Neon Connect adapter (turn-based, shared board).
 * The browser only sends column intents; the server drops the disc and
 * decides hits, draws and winners.
 */
const neonConnectHandler = {
  gameId: "neon-connect",
  mode: "turn-based-shared-board",
  roles: ["cyan", "magenta"],
  minPlayers: 2,
  maxPlayers: 2,
  roleLabels: { cyan: "Cyan", magenta: "Magenta" },

  createInitialState() {
    return {
      board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      winner: null,
      draw: false,
      winningCells: [],
      moveCount: 0,
      lastDrop: null, // { row, col }
      finished: false,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || null;
    });
  },

  firstTurn(room) {
    return room.players[0]?.socketId || null;
  },

  nextTurn(room) {
    const currentIndex = room.players.findIndex((player) => player.socketId === room.currentTurn);
    if (currentIndex === -1) {
      room.currentTurn = room.players[0]?.socketId || null;
      return;
    }
    const next = room.players[(currentIndex + 1) % room.players.length];
    room.currentTurn = next ? next.socketId : room.currentTurn;
  },

  opponent(room, player) {
    return room.players.find((entry) => entry.socketId !== player.socketId) || null;
  },

  validateAction({ room, player, action }) {
    const state = room.gameState;
    if (!state) return { ok: false, error: "The match has not started." };
    if (state.finished) return { ok: false, error: "The match is already over." };
    const type = String(action?.type || "").trim().toLowerCase();

    if (type === "drop_disc") {
      if (room.currentTurn !== player.socketId) return { ok: false, error: "It is not your turn yet." };
      const column = Number.parseInt(action.column, 10);
      if (!Number.isInteger(column) || column < 0 || column >= COLS) return { ok: false, error: "Invalid column." };
      if (state.board[0][column]) return { ok: false, error: "That column is full." };
      return { ok: true, column };
    }
    if (type === "surrender") {
      return { ok: true };
    }
    return { ok: false, error: "Unknown action type for this game." };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    const type = String(action?.type || "").trim().toLowerCase();

    if (type === "drop_disc") {
      const column = valid.column;
      let row = ROWS - 1;
      while (row >= 0 && state.board[row][column]) row -= 1;
      state.board[row][column] = player.role;
      state.moveCount += 1;
      state.lastDrop = { row, column };

      const winningCells = findWinningCells(state.board, row, column, player.role);
      if (winningCells.length >= WIN_LENGTH) {
        state.winner = player.role;
        state.winningCells = winningCells.slice(0, WIN_LENGTH);
        state.finished = true;
        return;
      }
      if (state.moveCount >= COLS * ROWS) {
        state.draw = true;
        state.finished = true;
      }
      return;
    }
    if (type === "surrender") {
      const opponent = this.opponent(room, player);
      if (opponent) {
        state.winner = opponent.role;
        state.finished = true;
      }
    }
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (!state) return { finished: false, winner: null, draw: false };
    if (state.winner) {
      // Report the winner as a player number (like every other game) rather
      // than the role string, so game_over payloads stay type-consistent.
      const winner = room.players.find((entry) => entry.role === state.winner);
      return { finished: true, winner: winner ? winner.playerNumber : null, draw: false };
    }
    if (state.draw) return { finished: true, winner: null, draw: true };
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    room.currentTurn = this.firstTurn(room);
  },

  getPlayerState(room, sessionId) {
    const state = room.gameState;
    const winner = state.winner
      ? room.players.find((entry) => entry.role === state.winner) || null
      : null;
    return envelope(room, sessionId, state, {
      winner: winner ? winner.playerNumber : null,
      draw: Boolean(state.draw),
    });
  },
};

module.exports = neonConnectHandler;
