"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("snake");
const GRID = Number(config.grid_size || 20);
const START_LENGTH = Number(config.start_length || 3);
const SPEED = Number(config.speed || 3);
const FOOD_POINTS = Number(config.food_points || 10);

/**
 * Server-authoritative Snake adapter (simultaneous competitive).
 *
 * Every player controls their own snake on their own grid. The server
 * advances all snakes on a shared tick. The match ends when every snake
 * has crashed; the last survivor wins, otherwise the highest score wins
 * (draw on equal scores).
 */
const snakeHandler = {
  gameId: "snake",
  mode: "simultaneous",
  tickMs: Math.max(60, Math.floor(1000 / Math.max(1, SPEED))),
  roles: ["Player 1", "Player 2"],

  createInitialState() {
    return {
      playerStates: {},
      scores: {},
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
    room.gameState.scores = {};
    room.players.forEach((player) => {
      room.gameState.playerStates[player.playerNumber] = this.freshSnakeState();
      room.gameState.scores[player.playerNumber] = 0;
    });
  },

  freshSnakeState() {
    const startX = Math.floor(GRID / 2);
    const startY = Math.floor(GRID / 2);
    const snake = [];
    for (let i = 0; i < START_LENGTH; i += 1) {
      snake.push({ x: startX - i, y: startY });
    }
    const state = {
      snake,
      direction: { x: 1, y: 0 },
      queued: { x: 1, y: 0 },
      food: { x: 0, y: 0 },
      score: 0,
      alive: true,
      crashedAt: null,
    };
    state.food = this.placeFood(state.snake);
    return state;
  },

  placeFood(snake) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const candidate = {
        x: Math.floor(Math.random() * GRID),
        y: Math.floor(Math.random() * GRID),
      };
      const onSnake = snake.some((part) => part.x === candidate.x && part.y === candidate.y);
      if (!onSnake) return candidate;
    }
    return { x: 0, y: 0 };
  },

  validateAction({ player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "direction") return { ok: false, error: "Unknown action type for this game." };
    const direction = action.direction;
    if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
      return { ok: false, error: "Invalid direction." };
    }
    const x = Math.round(direction.x);
    const y = Math.round(direction.y);
    if (Math.abs(x) + Math.abs(y) !== 1) return { ok: false, error: "Invalid direction." };
    return { ok: true, direction: { x, y } };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState.playerStates[player.playerNumber];
    if (!state || !state.alive) return;
    if (state.queued.x + valid.direction.x === 0 && state.queued.y + valid.direction.y === 0) return;
    state.queued = valid.direction;
  },

  tick(room) {
    const state = room.gameState;
    for (const playerNumber of Object.keys(state.playerStates)) {
      const playerState = state.playerStates[playerNumber];
      if (!playerState.alive) continue;

      playerState.direction = { ...playerState.queued };
      const head = playerState.snake[0];
      const next = { x: head.x + playerState.direction.x, y: head.y + playerState.direction.y };

      if (this.collides(playerState.snake, next)) {
        playerState.alive = false;
        playerState.crashedAt = Date.now();
        continue;
      }

      playerState.snake.unshift(next);
      if (next.x === playerState.food.x && next.y === playerState.food.y) {
        playerState.score += FOOD_POINTS;
        playerState.food = this.placeFood(playerState.snake);
      } else {
        playerState.snake.pop();
      }
      state.scores[playerNumber] = playerState.score;
    }
  },

  collides(snake, position) {
    if (position.x < 0 || position.x >= GRID || position.y < 0 || position.y >= GRID) return true;
    return snake.some((part) => part.x === position.x && part.y === position.y);
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };

    const entries = Object.entries(state.playerStates).filter(([, ps]) => ps.alive);
    if (entries.length > 0) return { finished: false, winner: null, draw: false };

    // Everyone crashed: compare scores.
    const scores = Object.entries(state.scores);
    scores.sort((a, b) => b[1] - a[1]);
    const top = scores[0];
    const runnerUp = scores[1];
    const draw = Boolean(runnerUp && runnerUp[1] === top[1]);

    state.finished = true;
    state.winner = draw ? null : Number(top[0]);
    state.draw = draw;
    return { finished: true, winner: state.winner, draw };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },
};

module.exports = snakeHandler;
