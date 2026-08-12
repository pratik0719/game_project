"use strict";

const { gameConfig, canonicalGameId } = require("../gameRegistry");

// Every game on the platform has a server-side multiplayer adapter.
const gameHandlers = {
  snake: require("./snake"),
  memory: require("./memory"),
  quiz: require("./quiz"),
  tictactoe: require("./ticTacToe"),
  spinwheel: require("./spinwheel"),
  ludo: require("./ludo"),
  chess: require("./chess"),
  "2048": require("./game2048"),
  whackamole: require("./whackamole"),
  flappy: require("./flappy"),
  breakout: require("./breakout"),
};

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
 * Initialize one shared, server-side match for the room:
 * - initialize gameState
 * - assign each player a role
 * - initialize per-player match state (where the game needs it)
 * - select the first turn
 * - mark the room as playing
 */
function startGame(room) {
  const handler = getGameHandler(room.gameId);
  if (!handler) {
    return { ok: false, error: "This game does not have a multiplayer adapter." };
  }
  room.gameState = handler.createInitialState();
  handler.assignRoles(room);
  if (typeof handler.initializeMatch === "function") handler.initializeMatch(room);
  room.currentTurn = typeof handler.firstTurn === "function" ? handler.firstTurn(room) : null;
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
    return { ok: false, error: "This game does not have a multiplayer adapter." };
  }
  handler.resetState(room);
  room.status = "playing";
  room.round = (room.round || 0) + 1;
  room.lastActivityAt = Date.now();
  return { ok: true, handler };
}

/**
 * Server-authoritative move pipeline:
 * room exists -> player belongs -> game has started -> move valid by game
 * rules -> shared state updated -> winner checked -> turn switched.
 */
function handleGameAction(room, socket, payload) {
  const handler = getGameHandler(room.gameId);
  if (!handler) {
    return { ok: false, error: "This game does not have a multiplayer adapter." };
  }
  if (room.status !== "playing") {
    return { ok: false, error: "The match has not started." };
  }
  const player = room.players.find((entry) => entry.socketId === socket.id);
  if (!player) {
    return { ok: false, error: "You are not part of this match." };
  }

  const valid = handler.validateAction({ room, player, action: payload?.action });
  if (!valid.ok) return valid;

  handler.applyAction({ room, player, action: payload?.action, valid });
  // All adapters expose checkGameOver; the original Tic-Tac-Toe adapter
  // still names it checkWinner - accept both spellings.
  const checkGameOver = handler.checkGameOver || handler.checkWinner;
  const result = checkGameOver(room);

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
  getGameHandler,
  canonicalGameId,
  startGame,
  resetGame,
  handleGameAction,
};
