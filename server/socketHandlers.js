"use strict";

const { isValidRoomCode, normalizeRoomCode } = require("./roomManager");
const { canonicalGameId, getGameConfig, getGameHandler, startGame, resetGame, handleGameAction } = require("./gameHandlers");
const chatManager = require("./chatManager");

const rateBuckets = new Map();
const RATE_LIMITS = {
  create_room: { limit: 5, windowMs: 60_000 },
  join_room: { limit: 12, windowMs: 60_000 },
  reconnect_room: { limit: 10, windowMs: 60_000 },
};

/**
 * Short disconnect grace period. Navigating from the lobby to the game page
 * (or refreshing) drops the old socket; we keep the player in the room for a
 * few seconds so the reconnect_room call just swaps their socketId instead of
 * removing and re-adding them. After the grace period expires without a
 * reconnect, the player is removed for real.
 */
const DISCONNECT_GRACE_MS = 8_000;
const disconnectTimers = new Map(); // sessionId -> timeout

/**
 * Server-driven simulation loops for tick-based games (snake, memory,
 * quiz, whackamole, flappy, breakout). Each tick advances the shared
 * game state and broadcasts it. Tickers self-terminate when the room
 * disappears or the match is no longer "playing".
 */
const roomTickers = new Map();

function registerSocketHandlers(io, roomManager) {
  io.on("connection", (socket) => {
    socket.on("create_room", (payload, ack) => {
      withAck(ack, () => {
        if (isRateLimited(socket, "create_room")) return { ok: false, error: "Too many room creation attempts. Try again shortly." };

        const playerName = validateName(payload?.playerName);
        if (!playerName.ok) return playerName;

        const identity = validateIdentity(payload);
        if (!identity.ok) return identity;

        // The selected game is validated against the FULL game registry.
        const gameId = canonicalGameId(payload?.gameId);
        if (!gameId) return { ok: false, error: "No game selected. Choose a game before creating a room." };
        const config = getGameConfig(gameId);
        if (!config) return { ok: false, error: "Invalid game selected." };
        if (!config.multiplayerReady) return { ok: false, error: "This game does not support multiplayer rooms yet." };

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing) {
          socket.leave(existing.roomCode);
          stopRoomTicker(existing.roomCode);
          if (!existing.deleted) handlePlayerLeave(io, roomManager, existing);
        }

        const result = roomManager.createRoom({ socketId: socket.id, clientId: identity.clientId, sessionId: identity.sessionId, playerName: playerName.value, gameId });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        const room = roomManager.getRoom(result.roomCode);
        roomManager.addSystemMessage(room, `${playerName.value} created the room.`);
        socket.emit("chat_history", { roomCode: result.roomCode, messages: roomManager.getChatMessages(room) });
        const publicRoom = roomManager.publicRoom(room);
        socket.emit("room_created", { roomCode: result.roomCode, gameId: publicRoom.gameId, room: publicRoom });
        return { ok: true, roomCode: result.roomCode, gameId: publicRoom.gameId, room: publicRoom };
      });
    });

    socket.on("join_room", (payload, ack) => {
      withAck(ack, () => {
        if (isRateLimited(socket, "join_room")) return { ok: false, error: "Too many join attempts. Try again shortly." };

        const playerName = validateName(payload?.playerName);
        if (!playerName.ok) return playerName;

        const identity = validateIdentity(payload);
        if (!identity.ok) return identity;

        const roomCode = normalizeRoomCode(payload?.roomCode);
        if (!isValidRoomCode(roomCode)) return { ok: false, error: "Invalid room code." };

        // Preflight BEFORE touching any state: a failed join must never
        // evict the user from the room they are currently in.
        const preflight = roomManager.preflightJoin({ roomCode, clientId: identity.clientId, sessionId: identity.sessionId });
        if (!preflight.ok) return preflight;

        // The same stable session rejoining through the legacy path should
        // also cancel any pending disconnect-removal timer.
        cancelPendingDisconnect(identity.sessionId);

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing) {
          socket.leave(existing.roomCode);
          stopRoomTicker(existing.roomCode);
          if (!existing.deleted) handlePlayerLeave(io, roomManager, existing);
        }

        const result = roomManager.joinRoom({ socketId: socket.id, clientId: identity.clientId, sessionId: identity.sessionId, playerName: playerName.value, roomCode });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        if (!result.rejoined) {
          const room = roomManager.getRoom(result.roomCode);
          const systemMessage = roomManager.addSystemMessage(room, `${playerName.value} joined the room.`);
          socket.to(result.roomCode).emit("player_joined", { room: roomManager.publicRoom(room) });
          io.to(result.roomCode).emit("room_system_message", systemMessage);
          io.to(result.roomCode).emit("room_state", roomManager.publicRoom(room));
          socket.emit("chat_history", { roomCode: result.roomCode, messages: roomManager.getChatMessages(room) });
        } else {
          // A reconnecting player must be re-synced with the shared state.
          const room = roomManager.getRoom(result.roomCode);
          socket.emit("room_state", roomManager.publicRoom(room));
          socket.emit("game_state", playerGameState(room, identity.sessionId));
          socket.emit("chat_history", { roomCode: result.roomCode, messages: roomManager.getChatMessages(room) });
        }

        // The joining player always receives the room's locked game.
        socket.emit("room_joined", { roomCode: result.roomCode, gameId: result.room.gameId, room: result.room });
        return { ok: true, roomCode: result.roomCode, gameId: result.room.gameId, room: result.room };
      });
    });

    /**
     * Rejoin after a full-page navigation or a dropped/re-established socket.
     * The stable sessionId identifies the player; their socketId is swapped
     * in place (role and membership preserved) and they are re-synced with
     * the current room state, game state and chat history.
     */
    socket.on("reconnect_room", (payload, ack) => {
      withAck(ack, () => {
        if (isRateLimited(socket, "reconnect_room")) return { ok: false, error: "Too many reconnect attempts. Try again shortly." };
        const roomCode = normalizeRoomCode(payload?.roomCode);
        if (!isValidRoomCode(roomCode)) return { ok: false, error: "Invalid room code." };
        const sessionId = validateSessionId(payload?.sessionId);
        if (!sessionId.ok) return sessionId;

        const room = roomManager.getRoom(roomCode);
        if (!room) return { ok: false, error: "Room not found." };
        if (!room.players.some((player) => player.sessionId === sessionId.value)) {
          return { ok: false, error: "You are not a member of that room." };
        }

        // If the previous socket is still in its disconnect grace period,
        // cancel the pending removal - this is the same player coming back.
        cancelPendingDisconnect(sessionId.value);

        const result = roomManager.reconnectRoom({ socketId: socket.id, sessionId: sessionId.value, roomCode });
        if (!result.ok) return result;

        socket.join(roomCode);
        socket.emit("room_joined", { roomCode, gameId: result.room.gameId, room: result.room });
        socket.emit("room_state", result.room);
        socket.emit("game_state", playerGameState(room, sessionId.value));
        socket.emit("chat_history", { roomCode, messages: roomManager.getChatMessages(room) });
        return { ok: true, roomCode, gameId: result.room.gameId, room: result.room };
      });
    });

    socket.on("leave_room", () => {
      const result = roomManager.leaveBySocket(socket.id);
      if (result) {
        socket.leave(result.roomCode);
        stopRoomTicker(result.roomCode);
        if (!result.deleted) handlePlayerLeave(io, roomManager, result);
      }
    });

    socket.on("request_room_state", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      if (!roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "You are not a member of that room." });
        return;
      }
      const room = roomManager.getRoom(roomCode);
      const member = room.players.find((entry) => entry.socketId === socket.id);
      socket.emit("room_state", roomManager.publicRoom(room));
      socket.emit("game_state", playerGameState(room, member?.sessionId));
    });

    socket.on("start_game", (payload, callback) => {
      withAck(callback, () => {
        const roomCode = normalizeRoomCode(payload?.roomCode);
        const room = roomManager.getRoom(roomCode);
        if (!room) return { success: false, message: "Room not found." };
        if (!roomManager.isSocketInRoom(socket.id, roomCode)) {
          return { success: false, message: "You are not a member of that room." };
        }
        if (room.hostId !== socket.id) {
          return { success: false, message: "Only the host can start the game." };
        }
        if (room.status !== "waiting") {
          return { success: false, message: "The game has already started." };
        }
        // The room's game is authoritative - never take the gameId from the client.
        const config = getGameConfig(room.gameId);
        if (!config) {
          return { success: false, message: "This game is not available for multiplayer." };
        }
        if (room.players.length < config.minPlayers) {
          return { success: false, message: `At least ${config.minPlayers} players are required to start.` };
        }

        // Initialize ONE shared match: game state, roles, first turn, status.
        // The optional content mode (memory card themes) is validated by the
        // game handler itself and falls back to its default when unknown.
        const started = startGame(room, payload?.mode);
        if (!started.ok) {
          return { success: false, message: started.error };
        }

        const publicRoom = roomManager.publicRoom(room);
        io.to(room.code).emit("game_started", gameStartedPayload(publicRoom, config));
        io.to(room.code).emit("room_state", publicRoom);
        broadcastGameState(io, roomManager, room);
        broadcastSystemMessage(io, roomManager, room, "The match has started.");

        startRoomTicker(io, roomManager, room);
        return { success: true };
      });
    });

    socket.on("play_again", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room || !roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "You are not a member of that room." });
        return;
      }
      if (room.status !== "playing" || !room.gameState) {
        socket.emit("room_error", { error: "There is no finished match to replay." });
        return;
      }
      if (!room.gameState.finished && !room.gameState.winner && !room.gameState.draw) {
        socket.emit("room_error", { error: "The current match is still in progress." });
        return;
      }

      // Reset the shared state. Room, players, roles and game stay locked.
      stopRoomTicker(room.code);
      const reset = resetGame(room);
      if (!reset.ok) {
        socket.emit("room_error", { error: reset.error });
        return;
      }

      const publicRoom = roomManager.publicRoom(room);
      roomManager.addSystemMessage(room, "A new round is starting.");
      io.to(room.code).emit("game_started", gameStartedPayload(publicRoom, getGameConfig(room.gameId)));
      io.to(room.code).emit("room_state", publicRoom);
      broadcastGameState(io, roomManager, room);
      broadcastSystemMessage(io, roomManager, room, `Round ${room.round} started.`);

      startRoomTicker(io, roomManager, room);
    });

    // ------------------------------------------------------------------
    // Private room chat
    // ------------------------------------------------------------------

    socket.on("send_room_message", (payload, callback) => {
      withAck(callback, () => {
        const roomCode = normalizeRoomCode(payload?.roomCode);
        const room = roomManager.getRoom(roomCode);
        if (!room) return { success: false, message: "Room not found." };

        // Membership is confirmed on the server - never trust the sender.
        const player = room.players.find((entry) => entry.socketId === socket.id);
        if (!player) return { success: false, message: "You are not a member of this room." };
        if (!player.isConnected) return { success: false, message: "You are not connected to this room." };

        if (chatManager.isChatRateLimited(player.sessionId)) {
          socket.emit("chat_error", { error: "You are sending messages too quickly. Please slow down." });
          return { success: false, message: "You are sending messages too quickly. Please slow down." };
        }

        const cleanText = chatManager.sanitizeChatText(payload?.text);
        if (!cleanText || cleanText.length > chatManager.MAX_MESSAGE_LENGTH) {
          socket.emit("chat_error", { error: "Message must contain 1-300 characters." });
          return { success: false, message: "Message must contain 1-300 characters." };
        }

        const message = roomManager.addMessage(room, chatManager.createPlayerMessage(room, player, cleanText));
        chatManager.clearTyping(room.code, player.sessionId);
        io.to(room.code).emit("room_message", message);
        return { success: true, messageId: message.id };
      });
    });

    socket.on("request_chat_history", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      if (!roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("chat_error", { error: "You are not a member of that room." });
        return;
      }
      const room = roomManager.getRoom(roomCode);
      socket.emit("chat_history", { roomCode, messages: roomManager.getChatMessages(room) });
    });

    socket.on("chat_typing_start", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room) return;
      const player = room.players.find((entry) => entry.socketId === socket.id);
      if (!player) return;
      chatManager.setTyping(room.code, player.sessionId, player.name);
      io.to(room.code).emit("room_typing", { roomCode: room.code, typing: chatManager.activeTypers(room.code) });
    });

    socket.on("chat_typing_stop", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room) return;
      const player = room.players.find((entry) => entry.socketId === socket.id);
      if (!player) return;
      chatManager.clearTyping(room.code, player.sessionId);
      io.to(room.code).emit("room_typing", { roomCode: room.code, typing: chatManager.activeTypers(room.code) });
    });

    socket.on("game_action", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room || !roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "You are not a member of that room." });
        return;
      }

      // The room's game is authoritative. A client-provided gameId is only
      // compared for extra safety and is never used to change the room.
      const clientGameId = canonicalGameId(payload?.gameId);
      if (clientGameId && clientGameId !== room.gameId) {
        socket.emit("room_error", { error: "That action does not belong to this room's game." });
        return;
      }

      const result = handleGameAction(room, socket, payload);
      if (!result.ok) {
        socket.emit("room_error", { error: result.error });
        return;
      }

      broadcastGameState(io, roomManager, room);
      if (result.finished) {
        stopRoomTicker(room.code);
        finishMatch(io, roomManager, room, result);
      }
    });

    socket.on("disconnect", () => {
      const result = roomManager.markPlayerDisconnected(socket.id);
      if (!result) return;

      const { roomCode, player } = result;
      const room = roomManager.getRoom(roomCode);
      if (!room) return;

      broadcastSystemMessage(io, roomManager, room, `${player.name} disconnected.`);
      io.to(roomCode).emit("room_state", roomManager.publicRoom(room));

      // Give the player a short window to come back (navigation/refresh).
      const timer = setTimeout(() => {
        disconnectTimers.delete(player.sessionId);
        const current = roomManager.getRoom(roomCode);
        if (!current) return;
        const member = current.players.find((entry) => entry.sessionId === player.sessionId);
        // Only remove if they never came back (socketId still the old one).
        if (!member || member.isConnected || member.socketId !== socket.id) return;

        const removal = roomManager.removePlayerBySessionId(roomCode, player.sessionId);
        if (removal) {
          stopRoomTicker(roomCode);
          handlePlayerLeave(io, roomManager, removal);
        }
      }, DISCONNECT_GRACE_MS);
      disconnectTimers.set(player.sessionId, timer);
    });
  });
}

// ----------------------------------------------------------------------
// Server-side game tickers (simulation loops for tick-driven games).
// ----------------------------------------------------------------------

function startRoomTicker(io, roomManager, room) {
  const handler = getGameHandler(room.gameId);
  if (!handler || typeof handler.tick !== "function" || !handler.tickMs) return;
  stopRoomTicker(room.code);

  const interval = setInterval(() => {
    const current = roomManager.getRoom(room.code);
    if (!current || current.status !== "playing" || !current.gameState) {
      stopRoomTicker(room.code);
      return;
    }

    handler.tick(current);
    roomManager.touchRoom(current);

    const checkGameOver = handler.checkGameOver || handler.checkWinner;
    const result = checkGameOver(current);
    if (result.finished) {
      stopRoomTicker(room.code);
      finishMatch(io, roomManager, current, result);
      return;
    }

    broadcastGameState(io, roomManager, current);
  }, handler.tickMs);

  roomTickers.set(room.code, interval);
}

function stopRoomTicker(roomCode) {
  const interval = roomTickers.get(roomCode);
  if (interval) {
    clearInterval(interval);
    roomTickers.delete(roomCode);
  }
}

/** Emit the game_over event for a finished match (action- or tick-driven). */
function finishMatch(io, roomManager, room, result) {
  const base = {
    roomCode: room.code,
    gameId: room.gameId,
    winner: result.winner ?? null,
    winnerName: resolveWinnerName(room, result.winner),
    draw: Boolean(result.draw),
  };
  const handler = getGameHandler(room.gameId);
  if (handler && typeof handler.getPlayerState === "function" && room.gameState) {
    // Private-state games get a personalized final snapshot (e.g. the full
    // board is revealed once the match is over).
    for (const player of room.players) {
      const playerState = handler.getPlayerState(room, player.sessionId) || {};
      io.to(player.socketId).emit("game_over", { ...base, gameState: playerState.gameState ?? null });
    }
    return;
  }
  io.to(room.code).emit("game_over", { ...base, gameState: room.gameState });
}

/**
 * Resolve a winner (a player number, or a role such as chess "White"/
 * "Black" or tic-tac-toe "X"/"O") to the player's display name so every
 * client can show the same winner name. Falls back to the raw value.
 */
function resolveWinnerName(room, winner) {
  if (winner === null || winner === undefined) return null;
  const player = (room.players || []).find(
    (entry) => entry.playerNumber === winner || entry.role === winner
  );
  return player ? player.name : String(winner);
}

/** game_started payload: the public room plus the game route used to open it. */
function gameStartedPayload(publicRoom, config) {
  return {
    ...publicRoom,
    gameRoute: config && config.route ? config.route : null,
  };
}

function gameStatePayload(room) {
  const currentPlayer = room.players.find((player) => player.socketId === room.currentTurn);
  return {
    gameId: room.gameId,
    gameState: room.gameState,
    currentTurn: room.currentTurn,
    currentTurnRole: currentPlayer?.role || null,
    status: room.status,
    winner: room.gameState?.winner ?? null,
    draw: room.gameState?.draw ?? false,
    round: room.round || 0,
    players: room.players.map((player) => ({
      socketId: player.socketId,
      sessionId: player.sessionId,
      name: player.name,
      playerNumber: player.playerNumber,
      isHost: Boolean(player.isHost),
      role: player.role || null,
      isConnected: player.isConnected !== false,
    })),
  };
}

/**
 * Broadcast game_state to the whole room, personalizing it per player when
 * the game's handler exposes getPlayerState() (private boards, hands or
 * hidden choices). Shared-state games keep the single-room broadcast.
 */
function broadcastGameState(io, roomManager, room) {
  const handler = getGameHandler(room.gameId);
  // A match may have just ended (gameState nulled by endActiveMatch) - fall
  // back to the shared envelope, which already tolerates a null state.
  if (handler && typeof handler.getPlayerState === "function" && room.gameState) {
    for (const player of room.players) {
      const state = handler.getPlayerState(room, player.sessionId) || gameStatePayload(room);
      io.to(player.socketId).emit("game_state", state);
    }
    return;
  }
  io.to(room.code).emit("game_state", gameStatePayload(room));
}

/** Personalized game_state for a single player (used on rejoin/resync). */
function playerGameState(room, sessionId) {
  if (!room) return null;
  const handler = getGameHandler(room.gameId);
  if (handler && typeof handler.getPlayerState === "function" && room.gameState) {
    return handler.getPlayerState(room, sessionId) || gameStatePayload(room);
  }
  return gameStatePayload(room);
}

/** Add a server-created system message and broadcast it to the room. */
function broadcastSystemMessage(io, roomManager, room, text) {
  const message = roomManager.addSystemMessage(room, text);
  io.to(room.code).emit("room_system_message", message);
}

/**
 * Common departure path for leave_room, disconnect grace expiry and
 * switching rooms. If an active match is running, it is ended: shared
 * state is cleared, the room returns to "waiting" and the remaining
 * player is notified.
 */
function handlePlayerLeave(io, roomManager, result) {
  const room = roomManager.getRoom(result.roomCode);
  if (room && room.status === "playing") {
    stopRoomTicker(result.roomCode);
    roomManager.endActiveMatch(room);
    broadcastSystemMessage(io, roomManager, room, `${result.player.name} left - the match was ended. Waiting for players...`);
    io.to(result.roomCode).emit("match_ended", {
      roomCode: result.roomCode,
      reason: "opponent_left",
      room: roomManager.publicRoom(room),
    });
  } else if (room) {
    broadcastSystemMessage(io, roomManager, room, `${result.player.name} left the room.`);
  }

  const updatedRoom = roomManager.getRoom(result.roomCode);
  const publicRoom = updatedRoom ? roomManager.publicRoom(updatedRoom) : null;
  io.to(result.roomCode).emit("player_left", { player: result.player, room: publicRoom });
  if (result.hostChanged) {
    io.to(result.roomCode).emit("host_changed", { host: result.hostChanged, room: publicRoom });
    if (updatedRoom) broadcastSystemMessage(io, roomManager, updatedRoom, `${result.hostChanged.name} became the new host.`);
  }
  if (updatedRoom) {
    io.to(result.roomCode).emit("room_state", publicRoom);
    broadcastGameState(io, roomManager, updatedRoom);
  }
}

function withAck(ack, handler) {
  try {
    const result = handler();
    if (typeof ack === "function") ack(result);
  } catch (error) {
    console.error("Socket handler error:", error);
    if (typeof ack === "function") ack({ ok: false, error: "Server error. Please try again." });
  }
}

function validateName(value) {
  const name = sanitizeText(value, 20);
  if (name.length < 2 || name.length > 20) return { ok: false, error: "Enter a name between 2 and 20 characters." };
  return { ok: true, value: name };
}

function validateClientId(value) {
  const clientId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) return { ok: false, error: "Invalid browser session. Refresh and try again." };
  return { ok: true, value: clientId };
}

function validateSessionId(value) {
  const sessionId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{10,80}$/.test(sessionId)) return { ok: false, error: "Invalid player session. Refresh and try again." };
  return { ok: true, value: sessionId };
}

/** Stable identity: the browser sends sessionId (survives navigation);
 *  clientId is accepted for older clients / tests. */
function validateIdentity(payload) {
  const sessionId = validateSessionId(payload?.sessionId);
  const clientId = validateClientId(payload?.clientId);
  if (sessionId.ok) {
    return { ok: true, sessionId: sessionId.value, clientId: clientId.ok ? clientId.value : sessionId.value };
  }
  if (clientId.ok) {
    // Derive the stable session id from the legacy client id.
    return { ok: true, sessionId: clientId.value, clientId: clientId.value };
  }
  return clientId; // { ok: false, error }
}

function sanitizeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

/** Cancel a pending disconnect-removal timer for a session (if any). */
function cancelPendingDisconnect(sessionId) {
  if (!sessionId) return;
  const pending = disconnectTimers.get(sessionId);
  if (pending) {
    clearTimeout(pending);
    disconnectTimers.delete(sessionId);
  }
}

function isRateLimited(socket, eventName) {
  const config = RATE_LIMITS[eventName];
  if (!config) return false;

  const key = `${socket.id}:${eventName}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + config.windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + config.windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count > config.limit;
}

module.exports = {
  registerSocketHandlers,
};
