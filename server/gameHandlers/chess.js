"use strict";

/**
 * Server-authoritative Chess adapter (turn-based shared board).
 *
 * The full move engine (pseudo-legal generation, king-safety filtering,
 * check/checkmate/stalemate detection, promotion) runs on the server.
 * The browser only sends { type: "move", from, to } intents.
 */
const chessHandler = {
  gameId: "chess",
  mode: "turn-based",
  roles: ["White", "Black"],

  createInitialState() {
    return {
      board: createInitialBoard(),
      turn: "w",
      history: [],
      finished: false,
      winner: null,
      draw: false,
      reason: null,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || null;
    });
  },

  firstTurn(room) {
    const white = room.players.find((player) => player.role === "White");
    return white ? white.socketId : room.players[0]?.socketId || null;
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
    if (type !== "move") return { ok: false, error: "Unknown action type for this game." };

    const from = action.from;
    const to = action.to;
    if (!isValidSquare(from) || !isValidSquare(to)) return { ok: false, error: "Invalid move squares." };

    if (room.currentTurn !== player.socketId) return { ok: false, error: "It is not your turn yet." };

    const state = room.gameState;
    if (state.finished) return { ok: false, error: "The match is already over." };

    const piece = state.board[from.row][from.col];
    if (!piece) return { ok: false, error: "There is no piece on that square." };

    const expectedColor = player.role === "White" ? "w" : player.role === "Black" ? "b" : null;
    if (!expectedColor) return { ok: false, error: "You have not been assigned a color." };
    if (piece[0] !== expectedColor) return { ok: false, error: "That is not your piece." };
    if (state.turn !== expectedColor) return { ok: false, error: "It is not your turn yet." };

    const legal = getLegalMovesForPiece(state.board, from.row, from.col, expectedColor);
    if (!legal.some((move) => move.toRow === to.row && move.toCol === to.col)) {
      return { ok: false, error: "That move is not legal." };
    }
    return { ok: true, from, to };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    const { from, to } = valid;
    const capturedPiece = state.board[to.row][to.col];
    const movedPiece = state.board[from.row][from.col];

    state.board = applyMove(state.board, { fromRow: from.row, fromCol: from.col, toRow: to.row, toCol: to.col });
    state.history.push(`${toAlgebraic(from.row, from.col)}-${toAlgebraic(to.row, to.col)}${capturedPiece ? " x" : ""}`);
    state.turn = state.turn === "w" ? "b" : "w";

    const endState = evaluateEndState(state.board, state.turn);
    if (endState.finished) {
      state.finished = true;
      state.reason = endState.type;
      if (endState.type === "checkmate") {
        state.winner = state.turn === "w" ? "Black" : "White";
        state.draw = false;
      } else {
        state.winner = null;
        state.draw = true;
      }
      return;
    }
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    room.currentTurn = this.firstTurn(room);
  },
};

// ----------------------------------------------------------------------
// Chess engine (ported from the browser game so both sides agree exactly).
// ----------------------------------------------------------------------

const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

function createInitialBoard() {
  return [
    ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
    ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
    ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
  ];
}

function isValidSquare(square) {
  return Boolean(
    square &&
      Number.isInteger(square.row) &&
      Number.isInteger(square.col) &&
      square.row >= 0 &&
      square.row < 8 &&
      square.col >= 0 &&
      square.col < 8
  );
}

function evaluateEndState(currentBoard, sideToMove) {
  const moves = getAllLegalMoves(currentBoard, sideToMove);
  if (moves.length > 0) return { finished: false, type: "running" };
  if (isInCheck(currentBoard, sideToMove)) return { finished: true, type: "checkmate" };
  return { finished: true, type: "stalemate" };
}

function getAllLegalMoves(currentBoard, side) {
  const moves = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = currentBoard[row][col];
      if (!piece || piece[0] !== side) continue;
      moves.push(...getLegalMovesForPiece(currentBoard, row, col, side));
    }
  }
  return moves;
}

function getLegalMovesForPiece(currentBoard, row, col, side) {
  const piece = currentBoard[row][col];
  if (!piece || piece[0] !== side) return [];
  const pseudo = getPseudoMoves(currentBoard, row, col, piece, false);
  return pseudo.filter((move) => {
    const next = applyMove(currentBoard, move);
    return !isInCheck(next, side);
  });
}

function isInCheck(currentBoard, side) {
  let kingRow = -1;
  let kingCol = -1;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if (currentBoard[row][col] === `${side}K`) {
        kingRow = row;
        kingCol = col;
        break;
      }
    }
  }
  if (kingRow < 0 || kingCol < 0) return true;
  const enemy = side === "w" ? "b" : "w";
  return isSquareAttacked(currentBoard, kingRow, kingCol, enemy);
}

function isSquareAttacked(currentBoard, targetRow, targetCol, bySide) {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = currentBoard[row][col];
      if (!piece || piece[0] !== bySide) continue;
      const attacks = getPseudoMoves(currentBoard, row, col, piece, true);
      if (attacks.some((move) => move.toRow === targetRow && move.toCol === targetCol)) return true;
    }
  }
  return false;
}

function getPseudoMoves(currentBoard, row, col, piece, attackOnly) {
  const side = piece[0];
  const kind = piece[1];
  const enemy = side === "w" ? "b" : "w";
  const moves = [];

  if (kind === "P") {
    const dir = side === "w" ? -1 : 1;
    const startRow = side === "w" ? 6 : 1;
    const oneStep = row + dir;

    if (!attackOnly && inBounds(oneStep, col) && !currentBoard[oneStep][col]) {
      moves.push({ fromRow: row, fromCol: col, toRow: oneStep, toCol: col });
      const twoStep = row + dir * 2;
      if (row === startRow && !currentBoard[twoStep][col]) {
        moves.push({ fromRow: row, fromCol: col, toRow: twoStep, toCol: col });
      }
    }

    [-1, 1].forEach((dc) => {
      const tr = row + dir;
      const tc = col + dc;
      if (!inBounds(tr, tc)) return;
      const target = currentBoard[tr][tc];
      if (attackOnly) {
        moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
        return;
      }
      if (target && target[0] === enemy) {
        moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
      }
    });
    return moves;
  }

  if (kind === "N") {
    const jumps = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    jumps.forEach(([dr, dc]) => {
      const tr = row + dr;
      const tc = col + dc;
      if (!inBounds(tr, tc)) return;
      const target = currentBoard[tr][tc];
      if (!target || target[0] !== side) moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
    });
    return moves;
  }

  if (kind === "B" || kind === "R" || kind === "Q") {
    const directions = [];
    if (kind === "B" || kind === "Q") directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (kind === "R" || kind === "Q") directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);

    directions.forEach(([dr, dc]) => {
      let tr = row + dr;
      let tc = col + dc;
      while (inBounds(tr, tc)) {
        const target = currentBoard[tr][tc];
        if (!target) {
          moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
        } else {
          if (target[0] !== side) moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
          break;
        }
        tr += dr;
        tc += dc;
      }
    });
    return moves;
  }

  if (kind === "K") {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const tr = row + dr;
        const tc = col + dc;
        if (!inBounds(tr, tc)) continue;
        const target = currentBoard[tr][tc];
        if (!target || target[0] !== side) moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
      }
    }
    return moves;
  }

  return moves;
}

function applyMove(currentBoard, move) {
  const next = currentBoard.map((row) => row.slice());
  const piece = next[move.fromRow][move.fromCol];
  next[move.fromRow][move.fromCol] = null;
  if (piece && piece[1] === "P" && (move.toRow === 0 || move.toRow === 7)) {
    next[move.toRow][move.toCol] = `${piece[0]}Q`;
  } else {
    next[move.toRow][move.toCol] = piece;
  }
  return next;
}

function toAlgebraic(row, col) {
  return `${"abcdefgh"[col]}${8 - row}`;
}

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

module.exports = chessHandler;
