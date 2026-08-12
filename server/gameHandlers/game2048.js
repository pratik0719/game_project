"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("2048");
const SIZE = Math.max(4, Math.min(6, Number(config.grid_size || 4)));
const WINNING_TILE = Number(config.winning_tile || 2048);

const DIRECTIONS = ["up", "down", "left", "right"];

/**
 * Server-authoritative 2048 adapter (simultaneous competitive).
 *
 * Every player plays their own board of the same size. The server owns
 * every merge and every random tile spawn. The first player to reach the
 * winning tile wins; if nobody makes it, the player with the highest
 * score once every board is stuck wins (draw on equal scores).
 */
const game2048Handler = {
  gameId: "2048",
  mode: "simultaneous",
  roles: ["Player 1", "Player 2"],

  createInitialState() {
    return {
      playerStates: {},
      finished: false,
      winner: null,
      draw: false,
      winningTile: WINNING_TILE,
      size: SIZE,
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
      const state = {
        board: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)),
        score: 0,
        over: false,
        reachedWin: false,
      };
      this.addRandomTile(state.board);
      this.addRandomTile(state.board);
      room.gameState.playerStates[player.playerNumber] = state;
    });
  },

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "move") return { ok: false, error: "Unknown action type for this game." };
    const direction = String(action.direction || "").trim().toLowerCase();
    if (!DIRECTIONS.includes(direction)) return { ok: false, error: "Invalid move direction." };

    const playerState = room.gameState.playerStates[player.playerNumber];
    if (!playerState) return { ok: false, error: "You are not part of this match." };
    if (playerState.over || playerState.reachedWin) return { ok: false, error: "Your board is already finished." };
    return { ok: true, direction };
  },

  applyAction({ room, player, action, valid }) {
    const playerState = room.gameState.playerStates[player.playerNumber];
    const board = playerState.board;

    const moved = this.move(board, valid.direction, playerState);
    if (!moved) return;

    this.addRandomTile(board);

    if (board.flat().some((value) => value >= WINNING_TILE)) {
      playerState.reachedWin = true;
      room.gameState.finished = true;
      room.gameState.winner = player.playerNumber;
      room.gameState.draw = false;
      return;
    }

    if (!this.canMove(board)) {
      playerState.over = true;
    }
  },

  move(board, direction, playerState) {
    let moved = false;
    const range = (start, end, step) => {
      const result = [];
      if (end === undefined) {
        end = start;
        start = 0;
      }
      if (step === undefined) step = start < end ? 1 : -1;
      for (let value = start; step > 0 ? value < end : value > end; value += step) result.push(value);
      return result;
    };

    const iterate = {
      left: { outer: range(SIZE), inner: range(SIZE), get: (r, c) => [r, c], set: (r, c, value) => (board[r][c] = value) },
      right: { outer: range(SIZE), inner: range(SIZE - 1, -1, -1), get: (r, c) => [r, c], set: (r, c, value) => (board[r][c] = value) },
      up: { outer: range(SIZE), inner: range(SIZE), get: (c, r) => [r, c], set: (c, r, value) => (board[r][c] = value) },
      down: { outer: range(SIZE), inner: range(SIZE - 1, -1, -1), get: (c, r) => [r, c], set: (c, r, value) => (board[r][c] = value) },
    }[direction];

    iterate.outer.forEach((fixed) => {
      const line = [];
      iterate.inner.forEach((moving) => {
        const [r, c] = iterate.get(fixed, moving);
        const value = board[r][c];
        if (value !== 0) line.push(value);
      });

      const merged = [];
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === line[i + 1]) {
          const value = line[i] * 2;
          merged.push(value);
          playerState.score += value;
          i += 1;
        } else {
          merged.push(line[i]);
        }
      }
      while (merged.length < SIZE) merged.push(0);

      iterate.inner.forEach((moving, index) => {
        const [r, c] = iterate.get(fixed, moving);
        if (board[r][c] !== merged[index]) moved = true;
        iterate.set(fixed, moving, merged[index]);
      });
    });

    return moved;
  },

  canMove(board) {
    if (board.flat().some((value) => value === 0)) return true;
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const value = board[r][c];
        const right = c + 1 < SIZE ? board[r][c + 1] : null;
        const down = r + 1 < SIZE ? board[r + 1][c] : null;
        if (value === right || value === down) return true;
      }
    }
    return false;
  },

  addRandomTile(board) {
    const empties = [];
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (board[r][c] === 0) empties.push([r, c]);
      }
    }
    if (empties.length === 0) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    board[r][c] = Math.random() < 0.9 ? 2 : 4;
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };

    const entries = Object.entries(state.playerStates);
    if (entries.some(([, ps]) => ps.reachedWin)) {
      state.finished = true;
      state.winner = Number(entries.find(([, ps]) => ps.reachedWin)[0]);
      state.draw = false;
      return { finished: true, winner: state.winner, draw: false };
    }

    if (!entries.every(([, ps]) => ps.over)) return { finished: false, winner: null, draw: false };

    const ranked = entries.map(([playerNumber, ps]) => ({ playerNumber: Number(playerNumber), score: ps.score }));
    ranked.sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const second = ranked[1];
    const draw = Boolean(second && second.score === top.score);

    state.finished = true;
    state.winner = draw ? null : top.playerNumber;
    state.draw = draw;
    return { finished: true, winner: state.winner, draw };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },
};

module.exports = game2048Handler;
