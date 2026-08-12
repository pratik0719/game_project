"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("whackamole");
const MOLE_COUNT = Math.max(6, Math.min(12, Number(config.mole_count || 9)));
const DURATION_SECONDS = Math.max(10, Number(config.game_duration || 30));

let levels = (config.speed_levels || {}).level || [];
if (!Array.isArray(levels)) levels = [levels];
levels = levels
  .map((level) => ({
    second: Number(level?.["@_second"] || 0),
    interval: Number(level?.["@_interval"] || 800),
  }))
  .sort((a, b) => a.second - b.second);
if (levels.length === 0) levels = [{ second: 0, interval: 800 }];

const TICK_MS = 150;

/**
 * Server-authoritative Whack-a-Mole adapter (simultaneous competitive).
 *
 * All players share ONE 3x3-style grid. The server decides when and where
 * a mole pops and how long it stays; the first player to click it scores.
 * The player with the most hits when the timer expires wins.
 */
const whackamoleHandler = {
  gameId: "whackamole",
  mode: "simultaneous",
  tickMs: TICK_MS,
  roles: ["Player 1", "Player 2"],

  createInitialState() {
    return {
      moleCount: MOLE_COUNT,
      durationMs: DURATION_SECONDS * 1000,
      elapsedMs: 0,
      activeHole: -1,
      hideAt: 0,
      popInMs: 600,
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
    room.gameState.scores = {};
    room.players.forEach((player) => {
      room.gameState.scores[player.playerNumber] = 0;
    });
  },

  intervalAt(elapsedSeconds) {
    let interval = levels[0].interval;
    levels.forEach((level) => {
      if (elapsedSeconds >= level.second) interval = level.interval;
    });
    return Math.max(180, interval);
  },

  validateAction({ action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "whack") return { ok: false, error: "Unknown action type for this game." };
    const index = Number.parseInt(action.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= MOLE_COUNT) {
      return { ok: false, error: "Invalid hole index." };
    }
    return { ok: true, index };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    if (state.finished) return;
    if (state.activeHole !== valid.index) return; // missed - no state change
    if (Date.now() >= state.hideAt) return; // mole already hiding - no state change

    state.scores[player.playerNumber] += 1;
    state.activeHole = -1;
    state.hideAt = 0;
    state.popInMs = this.intervalAt(state.elapsedMs / 1000);
  },

  tick(room) {
    const state = room.gameState;
    if (state.finished) return;

    state.elapsedMs += TICK_MS;
    if (state.elapsedMs >= state.durationMs) {
      state.finished = true;
      let winner = null;
      let top = -1;
      let draw = false;
      for (const [playerNumber, score] of Object.entries(state.scores)) {
        if (score > top) {
          top = score;
          winner = Number(playerNumber);
          draw = false;
        } else if (score === top) {
          draw = true;
        }
      }
      state.winner = draw ? null : winner;
      state.draw = draw;
      return;
    }

    // Hide an expired mole.
    if (state.activeHole !== -1 && Date.now() >= state.hideAt) {
      state.activeHole = -1;
      state.hideAt = 0;
    }

    // Pop the next mole when the timer is ready.
    state.popInMs -= TICK_MS;
    if (state.popInMs <= 0 && state.activeHole === -1) {
      const nextIndex = Math.floor(Math.random() * MOLE_COUNT);
      state.activeHole = nextIndex;
      const interval = this.intervalAt(state.elapsedMs / 1000);
      state.hideAt = Date.now() + Math.max(120, interval - 40);
      state.popInMs = interval;
    }
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

module.exports = whackamoleHandler;
