"use strict";

/**
 * Shared helpers for game handlers that need personalized game_state
 * envelopes (private boards, hands or hidden choices). The socket layer
 * emits whatever getPlayerState(room, sessionId) returns, so every handler
 * returns the same envelope shape the shared broadcast uses.
 */

/** Public player list used in game_state envelopes. */
function publicPlayers(room) {
  return (room.players || []).map((player) => ({
    socketId: player.socketId,
    sessionId: player.sessionId,
    name: player.name,
    playerNumber: player.playerNumber,
    isHost: Boolean(player.isHost),
    role: player.role || null,
    isConnected: player.isConnected !== false,
  }));
}

/**
 * Standard game_state envelope wrapping a (possibly personalized) gameState.
 * `extra` may override winner/draw (e.g. when the game resolves them with a
 * different field than gameState.winner).
 */
function envelope(room, sessionId, gameState, extra = {}) {
  const currentPlayer = room.players.find((player) => player.socketId === room.currentTurn);
  return {
    gameId: room.gameId,
    gameState,
    currentTurn: room.currentTurn,
    currentTurnRole: currentPlayer?.role || null,
    status: room.status,
    winner: extra.winner !== undefined ? extra.winner : room.gameState?.winner ?? null,
    draw: extra.draw !== undefined ? Boolean(extra.draw) : Boolean(room.gameState?.draw),
    round: room.round || 0,
    players: publicPlayers(room),
  };
}

module.exports = { publicPlayers, envelope };
