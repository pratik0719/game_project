"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("spinwheel");
let segments = (config.segments || {}).segment || [];
if (!Array.isArray(segments)) segments = [segments];
segments = segments
  .map((segment) => ({
    label: String(segment?.["@_label"] || "Segment"),
    color: String(segment?.["@_color"] || "#c084fc"),
    prize: Number(segment?.["@_prize"] || 0),
  }))
  .filter((item) => item.label && item.label !== "Segment");

if (segments.length < 2) {
  segments = [
    { label: "Bronze", color: "#f97316", prize: 40 },
    { label: "Silver", color: "#60a5fa", prize: 60 },
    { label: "Golden", color: "#facc15", prize: 90 },
    { label: "Mystery", color: "#c084fc", prize: 110 },
  ];
}

const SPINS_PER_MATCH = 5;

/**
 * Server-authoritative Spin the Wheel adapter (simultaneous competitive).
 *
 * Every player spins the same wheel over a fixed number of rounds. Each
 * spin's segment is chosen by the server and stored per player; the
 * player with the highest accumulated prize total wins.
 */
const spinwheelHandler = {
  gameId: "spinwheel",
  mode: "simultaneous",
  roles: ["Player 1", "Player 2"],

  createInitialState() {
    return {
      playerStates: {},
      lastSpin: null,
      spinsPerMatch: SPINS_PER_MATCH,
      finished: false,
      winner: null,
      draw: false,
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
      room.gameState.playerStates[player.playerNumber] = { total: 0, spins: 0 };
    });
  },

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "spin") return { ok: false, error: "Unknown action type for this game." };

    const state = room.gameState;
    if (state.finished) return { ok: false, error: "The match is already over." };

    const playerState = state.playerStates[player.playerNumber];
    if (!playerState) return { ok: false, error: "You are not part of this match." };
    if (playerState.spins >= SPINS_PER_MATCH) {
      return { ok: false, error: "You have used all your spins." };
    }

    // Keep players roughly in sync: nobody may lap anyone by more than one spin.
    const minSpins = Math.min(...Object.values(state.playerStates).map((entry) => entry.spins));
    if (playerState.spins > minSpins + 1) {
      return { ok: false, error: "Wait for the other players to finish their spins." };
    }
    return { ok: true };
  },

  applyAction({ room, player }) {
    const state = room.gameState;
    const playerState = state.playerStates[player.playerNumber];

    const segmentIndex = Math.floor(Math.random() * segments.length);
    const segment = segments[segmentIndex];

    playerState.total += segment.prize;
    playerState.spins += 1;

    state.lastSpin = {
      playerNumber: player.playerNumber,
      segmentIndex,
      segmentLabel: segment.label,
      prize: segment.prize,
      round: playerState.spins,
    };

    const allDone = Object.values(state.playerStates).every((entry) => entry.spins >= SPINS_PER_MATCH);
    if (allDone) {
      let winner = null;
      let top = -1;
      let draw = false;
      for (const [playerNumber, entry] of Object.entries(state.playerStates)) {
        if (entry.total > top) {
          top = entry.total;
          winner = Number(playerNumber);
          draw = false;
        } else if (entry.total === top) {
          draw = true;
        }
      }
      state.finished = true;
      state.winner = draw ? null : winner;
      state.draw = draw;
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

module.exports = spinwheelHandler;
