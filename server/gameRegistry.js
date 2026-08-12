"use strict";

/**
 * Central game registry.
 *
 * This is the single source of truth for every game on the platform.
 * The multiplayer system (room manager, socket handlers, handlers index
 * and the browser-side game picker) is generated from this object, so a
 * game ID used in the frontend and the backend can never drift apart.
 *
 * IDs here are the canonical route names used across the whole site
 * (e.g. "/game/snake" -> id "snake", "/game/2048" -> id "2048").
 */
const gameRegistry = {
  snake: {
    id: "snake",
    name: "Snake Rush",
    icon: "🐍",
    accent: "#39ff14",
    description: "Classic arcade snake on a neon grid.",
    route: "/game/snake",
    minPlayers: 2,
    maxPlayers: 2,
    multiplayer: true,
    mode: "simultaneous",
  },
  memory: {
    id: "memory",
    name: "Memory Pulse",
    icon: "🧠",
    accent: "#00e5ff",
    description: "Flip cards, match pairs, and race your opponent.",
    route: "/game/memory",
    minPlayers: 2,
    maxPlayers: 2,
    multiplayer: true,
    mode: "simultaneous",
  },
  quiz: {
    id: "quiz",
    name: "Quiz Reactor",
    icon: "❓",
    accent: "#ffb703",
    description: "Fast multiple-choice rounds with per-question timers.",
    route: "/game/quiz",
    minPlayers: 2,
    maxPlayers: 8,
    multiplayer: true,
    mode: "simultaneous",
  },
  tictactoe: {
    id: "tictactoe",
    name: "Tic Tac Toe Grid",
    icon: "⭕",
    accent: "#ff4d9d",
    description: "Play head-to-head or challenge the AI.",
    route: "/game/tictactoe",
    minPlayers: 2,
    maxPlayers: 2,
    multiplayer: true,
    mode: "turn-based",
  },
  spinwheel: {
    id: "spinwheel",
    name: "Spin the Wheel",
    icon: "🎡",
    accent: "#c084fc",
    description: "Spin a colorful prize wheel and out-spin your rivals.",
    route: "/game/spinwheel",
    minPlayers: 2,
    maxPlayers: 8,
    multiplayer: true,
    mode: "simultaneous",
  },
  ludo: {
    id: "ludo",
    name: "Ludo Blitz",
    icon: "🎲",
    accent: "#ff6b35",
    description: "Race tokens home in a 2-4 player Ludo showdown.",
    route: "/game/ludo",
    minPlayers: 2,
    maxPlayers: 4,
    multiplayer: true,
    mode: "turn-based",
  },
  chess: {
    id: "chess",
    name: "Neon Chess",
    icon: "♞",
    accent: "#f0c040",
    description: "Classic chess with legal hints and minimax AI.",
    route: "/game/chess",
    minPlayers: 2,
    maxPlayers: 2,
    multiplayer: true,
    mode: "turn-based",
  },
  "2048": {
    id: "2048",
    name: "2048 Surge",
    icon: "🔢",
    accent: "#fb923c",
    description: "Merge tiles, chase 2048, and outscore your rival.",
    route: "/game/2048",
    minPlayers: 2,
    maxPlayers: 4,
    multiplayer: true,
    mode: "simultaneous",
  },
  whackamole: {
    id: "whackamole",
    name: "Whack-a-Mole",
    icon: "🐹",
    accent: "#4ade80",
    description: "Whack popping moles before the timer ends.",
    route: "/game/whackamole",
    minPlayers: 2,
    maxPlayers: 4,
    multiplayer: true,
    mode: "simultaneous",
  },
  flappy: {
    id: "flappy",
    name: "Flappy Burst",
    icon: "🐤",
    accent: "#38bdf8",
    description: "Flap through pipes in a head-to-head race.",
    route: "/game/flappy",
    minPlayers: 2,
    maxPlayers: 4,
    multiplayer: true,
    mode: "simultaneous",
  },
  breakout: {
    id: "breakout",
    name: "Breakout Neon",
    icon: "🧱",
    accent: "#e879f9",
    description: "Smash bricks, preserve lives, and outlast the opponent.",
    route: "/game/breakout",
    minPlayers: 2,
    maxPlayers: 4,
    multiplayer: true,
    mode: "simultaneous",
  },
};

/**
 * Compact per-game configuration used by the room manager and handlers.
 * Every entry is multiplayer-ready because every game now has a server
 * adapter registered in server/gameHandlers/index.js.
 */
const gameConfig = Object.fromEntries(
  Object.entries(gameRegistry).map(([id, game]) => [
    id,
    {
      title: game.name,
      route: game.route,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      multiplayerReady: true,
      mode: game.mode,
    },
  ])
);

/** Alternate spellings clients may send (kept for forward compatibility). */
const GAME_ALIASES = {
  "tic-tac-toe": "tictactoe",
  "tick-tac-toe": "tictactoe",
  "2048-surge": "2048",
};

function canonicalGameId(value) {
  const id = String(value || "").trim().toLowerCase();
  return GAME_ALIASES[id] || id;
}

module.exports = {
  gameRegistry,
  gameConfig,
  canonicalGameId,
};
