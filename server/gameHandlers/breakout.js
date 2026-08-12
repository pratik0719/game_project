"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("breakout");
const ROWS = Math.max(3, Math.min(8, Number(config.rows || 5)));
const COLS = Math.max(5, Math.min(12, Number(config.cols || 9)));
const BASE_SPEED = Number(config.ball_speed || 4.2);
const PADDLE_WIDTH_DEFAULT = Number(config.paddle_width || 88);

const CANVAS_WIDTH = 560;
const CANVAS_HEIGHT = 420;
const PADDLE_HEIGHT = 12;
const PADDLE_Y = CANVAS_HEIGHT - 24;
const PADDLE_SPEED = 6;
const BALL_RADIUS = 8;
const BRICK_PADDING = 6;
const BRICK_TOP = 52;
const BRICK_HEIGHT = 20;
const START_LIVES = 3;

/**
 * Server-authoritative Breakout adapter (simultaneous competitive).
 *
 * Each player plays their own identical field in the same room. The
 * server simulates both fields on a shared tick and the client only
 * reports the desired paddle position. The first player to lose all
 * lives loses; otherwise the highest score wins.
 */
const breakoutHandler = {
  gameId: "breakout",
  mode: "simultaneous",
  tickMs: 33,
  roles: ["Player 1", "Player 2"],

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
      room.gameState.playerStates[player.playerNumber] = this.freshField();
    });
  },

  freshField() {
    return {
      paddle: {
        width: PADDLE_WIDTH_DEFAULT,
        height: PADDLE_HEIGHT,
        x: (CANVAS_WIDTH - PADDLE_WIDTH_DEFAULT) / 2,
        y: PADDLE_Y,
        speed: PADDLE_SPEED,
        targetX: (CANVAS_WIDTH - PADDLE_WIDTH_DEFAULT) / 2,
      },
      ball: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - 40,
        r: BALL_RADIUS,
        vx: BASE_SPEED,
        vy: -BASE_SPEED,
      },
      bricks: this.createBricks(ROWS, COLS),
      lives: START_LIVES,
      level: 1,
      score: 0,
      alive: true,
      running: true,
    };
  },

  createBricks(rCount, cCount) {
    const result = [];
    const brickWidth = (CANVAS_WIDTH - (cCount + 1) * BRICK_PADDING) / cCount;
    for (let r = 0; r < rCount; r += 1) {
      for (let c = 0; c < cCount; c += 1) {
        const x = BRICK_PADDING + c * (brickWidth + BRICK_PADDING);
        const y = BRICK_TOP + r * (BRICK_HEIGHT + BRICK_PADDING);
        result.push({
          x,
          y,
          w: brickWidth,
          h: BRICK_HEIGHT,
          points: (rCount - r) * 10,
          color: this.rowColor(r),
          destroyed: false,
        });
      }
    }
    return result;
  },

  rowColor(row) {
    const palette = ["#f472b6", "#e879f9", "#c084fc", "#60a5fa", "#34d399", "#fb7185", "#fbbf24"];
    return palette[row % palette.length];
  },

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "paddle") return { ok: false, error: "Unknown action type for this game." };
    const x = Number(action.x);
    if (!Number.isFinite(x)) return { ok: false, error: "Invalid paddle position." };
    return { ok: true, x };
  },

  applyAction({ room, player, action, valid }) {
    const field = room.gameState.playerStates[player.playerNumber];
    if (!field || !field.alive) return;
    field.paddle.targetX = Math.max(0, Math.min(CANVAS_WIDTH - field.paddle.width, valid.x - field.paddle.width / 2));
  },

  tick(room) {
    const state = room.gameState;
    if (state.finished) return;

    for (const [playerNumber, field] of Object.entries(state.playerStates)) {
      if (!field.alive || !field.running) continue;

      const paddle = field.paddle;
      if (Math.abs(paddle.targetX - paddle.x) <= paddle.speed) {
        paddle.x = paddle.targetX;
      } else {
        paddle.x += Math.sign(paddle.targetX - paddle.x) * paddle.speed;
      }

      const ball = field.ball;
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x - ball.r < 0 || ball.x + ball.r > CANVAS_WIDTH) ball.vx *= -1;
      if (ball.y - ball.r < 0) ball.vy *= -1;

      if (
        ball.y + ball.r >= paddle.y &&
        ball.y + ball.r <= paddle.y + paddle.height + 3 &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.width
      ) {
        const hitPos = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
        ball.vx = hitPos * 6;
        ball.vy = -Math.abs(ball.vy);
      }

      if (ball.y - ball.r > CANVAS_HEIGHT) {
        field.lives -= 1;
        if (field.lives <= 0) {
          field.alive = false;
          field.running = false;
          continue;
        }
        this.resetBall(field);
      }

      this.handleBrickCollisions(field);

      if (field.bricks.every((brick) => brick.destroyed)) {
        field.level += 1;
        ball.vx *= 1.1;
        ball.vy *= 1.1;
        field.bricks = this.createBricks(ROWS, COLS);
        this.resetBall(field);
      }
    }
  },

  resetBall(field) {
    field.ball.x = CANVAS_WIDTH / 2;
    field.ball.y = CANVAS_HEIGHT - 40;
    field.ball.vx = BASE_SPEED * (Math.random() < 0.5 ? -1 : 1);
    field.ball.vy = -Math.abs(BASE_SPEED + field.level * 0.15);
  },

  handleBrickCollisions(field) {
    const ball = field.ball;
    for (const brick of field.bricks) {
      if (brick.destroyed) continue;
      if (
        ball.x + ball.r > brick.x &&
        ball.x - ball.r < brick.x + brick.w &&
        ball.y + ball.r > brick.y &&
        ball.y - ball.r < brick.y + brick.h
      ) {
        brick.destroyed = true;
        ball.vy *= -1;
        field.score += brick.points;
        return;
      }
    }
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };

    const entries = Object.entries(state.playerStates);
    const dead = entries.filter(([, field]) => !field.alive);
    if (dead.length === 0) return { finished: false, winner: null, draw: false };

    // Outlast your opponent: a player who lost all lives cannot win. If
    // anyone is still alive they win; otherwise the highest score wins.
    const survivors = entries.filter(([, field]) => field.alive);
    const pool = survivors.length > 0 ? survivors : entries;
    const ranked = pool
      .map(([playerNumber, field]) => ({ playerNumber: Number(playerNumber), score: field.score, alive: field.alive }))
      .sort((a, b) => b.score - a.score || Number(b.alive) - Number(a.alive));

    const top = ranked[0];
    const second = ranked[1];
    const draw = Boolean(second && second.score === top.score && second.alive === top.alive);

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

module.exports = breakoutHandler;
