"use strict";

const gameConfig = {
  snake: { title: "Snake Rush", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  memory: { title: "Memory Pulse", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  quiz: { title: "Quiz Reactor", minPlayers: 2, maxPlayers: 8, multiplayerReady: false },
  tictactoe: { title: "Tic Tac Toe Grid", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  spinwheel: { title: "Spin the Wheel", minPlayers: 2, maxPlayers: 8, multiplayerReady: false },
  ludo: { title: "Ludo Blitz", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  chess: { title: "Neon Chess", minPlayers: 2, maxPlayers: 2, multiplayerReady: false },
  "2048": { title: "2048 Surge", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  whackamole: { title: "Whack-a-Mole", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  flappy: { title: "Flappy Burst", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
  breakout: { title: "Breakout Neon", minPlayers: 2, maxPlayers: 4, multiplayerReady: false },
};

function getGameConfig(gameId) {
  return gameConfig[String(gameId || "").trim().toLowerCase()] || null;
}

function listGameConfig() {
  return { ...gameConfig };
}

function handleGameAction(room, socket, payload) {
  const config = getGameConfig(room.gameId);
  if (!config || !config.multiplayerReady) {
    return {
      ok: false,
      error: "This game does not have a multiplayer game-state adapter yet.",
    };
  }

  return {
    ok: false,
    error: "No game handler is registered for this action yet.",
  };
}

module.exports = {
  gameConfig,
  getGameConfig,
  listGameConfig,
  handleGameAction,
};
