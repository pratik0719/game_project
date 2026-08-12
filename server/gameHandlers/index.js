"use strict";

const ticTacToeHandler = require("./ticTacToe");

// Canonical game ids (as used by the rest of the site, e.g. "tictactoe").
const gameConfig = {
  snake: { title: "Snake Rush", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  memory: { title: "Memory Pulse", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  quiz: { title: "Quiz Reactor", minPlayers: 2, maxPlayers: 8, multiplayerReady: false },
  tictactoe: { title: "Tic Tac Toe Grid", minPlayers: 2, maxPlayers: 2, multiplayerReady: true },
  spinwheel: { title: "Spin the Wheel", minPlayers: 2, maxPlayers: 8, multiplayerReady: false },
  ludo: { title: "Ludo Blitz", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  chess: { title: "Neon Chess", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  "2048": { title: "2048 Surge", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  whackamole: { title: "Whack-a-Mole", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  flappy: { title: "Flappy Burst", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  breakout: { title: "Breakout Neon", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
};

// Each entry implements createInitialState, assignRoles, firstTurn,
// nextTurn, validateAction, applyAction, checkWinner and resetState.
const gameHandlers = {
  tictactoe: ticTacToeHandler,
};

// Alternate names clients may send for the same game (e.g. "tic-tac-toe").
const GAME_ALIASES = {
  "tic-tac-toe": "tictactoe",
  "tick-tac-toe": "tictactoe",
};

function canonicalGameId(value) {
  const id = String(value || "").trim().toLowerCase();
  return GAME_ALIASES[id] || id;
}

function getGameConfig(gameId) {
  return gameConfig[canonicalGameId(gameId)] || null;
}

function getGameHandler(gameId) {
  const id = canonicalGameId(gameId);
  const config = gameConfig[id];
  if (!config || !config.multiplayerReady) return null;
  return gameHandlers[id] || null;
}

function listGameConfig() {
  return { ...gameConfig };
}

/**
 * Initialize one shared, server-side match for the room.
 * - initializes gameState
 * - assigns each player a role
 * - selects the first turn
 * - marks the room as playing
 */
function startGame(room) {
  const handler = getGameHandler(room.gameId);
  if (!handler) {
    return { ok: false, error: "This game does not have a multiplayer adapter yet." };
  }
  room.gameState = handler.createInitialState();
  handler.assignRoles(room);
  room.currentTurn = handler.firstTurn(room);
  room.status = "playing";
  room.round = (room.round || 0) + 1;
  room.lastActivityAt = Date.now();
  return { ok: true, handler };
}

/**
 * Play again: reset the shared state but preserve room, players and game.
 */
function resetGame(room) {
  const handler = getGameHandler(room.gameId);
  if (!handler) {
    return { ok: false, error: "This game does not have a multiplayer adapter yet." };
  }
  handler.resetState(room);
  room.status = "playing";
  room.round = (room.round || 0) + 1;
  room.lastActivityAt = Date.now();
  return { ok: true, handler };
}

/**
 * Server-authoritative move pipeline:
 * room exists -> player belongs -> game has started -> player's turn ->
 * move valid by game rules -> shared state updated -> winner checked -> turn switched.
 */
function handleGameAction(room, socket, payload) {
  const handler = getGameHandler(room.gameId);
  if (!handler) {
    return { ok: false, error: "This game does not have a multiplayer adapter yet." };
  }
  if (room.status !== "playing") {
    return { ok: false, error: "The match has not started." };
  }
  const player = room.players.find((entry) => entry.socketId === socket.id);
  if (!player) {
    return { ok: false, error: "You are not part of this match." };
  }
  if (!player.role) {
    return { ok: false, error: "You have not been assigned a role yet." };
  }

  const valid = handler.validateAction({ room, player, action: payload?.action });
  if (!valid.ok) return valid;

  handler.applyAction({ room, player, action: payload?.action, valid });
  const result = handler.checkWinner(room);

  if (!result.finished && typeof handler.nextTurn === "function") {
    handler.nextTurn(room);
  }

  room.lastActivityAt = Date.now();
  return {
    ok: true,
    finished: result.finished,
    winner: result.finished ? result.winner : null,
    draw: result.finished ? result.draw : false,
  };
}

module.exports = {
  gameConfig,
  listGameConfig,
  getGameConfig,
  canonicalGameId,
  startGame,
  resetGame,
  handleGameAction,
};
