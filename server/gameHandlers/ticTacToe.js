"use strict";

const BOARD_CELLS = 9;
const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/**
 * Server-authoritative Tic-Tac-Toe adapter.
 * The browser never decides moves, turns, scores or winners;
 * it only sends `{ type: "make_move", position }` intents.
 */
const ticTacToeHandler = {
  gameId: "tictactoe",
  minPlayers: 2,
  maxPlayers: 2,
  roles: ["X", "O"],

  createInitialState() {
    return {
      board: Array(BOARD_CELLS).fill(""),
      winner: null,
      draw: false,
    };
  },

  // Creator (players[0]) is X, second player (players[1]) is O.
  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || null;
    });
  },

  // X always opens the match.
  firstTurn(room) {
    const first = room.players.find((player) => player.role === "X");
    return first ? first.socketId : room.players[0]?.socketId || null;
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

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "make_move") {
      return { ok: false, error: "Unknown action type for this game." };
    }
    const position = Number.parseInt(action.position, 10);
    if (!Number.isInteger(position) || position < 0 || position >= BOARD_CELLS) {
      return { ok: false, error: "Invalid board position." };
    }
    if (room.currentTurn !== player.socketId) {
      return { ok: false, error: "It is not your turn yet." };
    }
    const state = room.gameState || this.createInitialState();
    if (state.winner || state.draw) {
      return { ok: false, error: "The match is already over." };
    }
    if (state.board[position]) {
      return { ok: false, error: "That cell is already taken." };
    }
    return { ok: true, position };
  },

  applyAction({ room, player, action, valid }) {
    room.gameState.board[valid.position] = player.role;
  },

  checkWinner(room) {
    const state = room.gameState;
    const winner = calculateWinner(state.board);
    if (winner) {
      state.winner = winner;
      return { finished: true, winner, draw: false };
    }
    if (state.board.every((cell) => cell)) {
      state.draw = true;
      return { finished: true, winner: null, draw: true };
    }
    return { finished: false, winner: null, draw: false };
  },

  // Play again: same room, same players, same roles, fresh shared board.
  resetState(room) {
    room.gameState = this.createInitialState();
    room.currentTurn = this.firstTurn(room);
  },
};

function calculateWinner(grid) {
  for (const [a, b, c] of WIN_LINES) {
    if (grid[a] && grid[a] === grid[b] && grid[a] === grid[c]) {
      return grid[a];
    }
  }
  return null;
}

module.exports = ticTacToeHandler;
