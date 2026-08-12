"use strict";

const { isValidRoomCode, normalizeRoomCode } = require("./roomManager");
const { canonicalGameId, getGameConfig, startGame, resetGame, handleGameAction } = require("./gameHandlers");

const rateBuckets = new Map();
const RATE_LIMITS = {
  create_room: { limit: 5, windowMs: 60_000 },
  join_room: { limit: 12, windowMs: 60_000 },
  send_message: { limit: 30, windowMs: 60_000 },
};

function registerSocketHandlers(io, roomManager) {
  io.on("connection", (socket) => {
    socket.on("create_room", (payload, ack) => {
      withAck(ack, () => {
        if (isRateLimited(socket, "create_room")) return { ok: false, error: "Too many room creation attempts. Try again shortly." };

        const playerName = validateName(payload?.playerName);
        if (!playerName.ok) return playerName;

        // A room can only be created for a supported multiplayer game.
        const gameId = canonicalGameId(payload?.gameId);
        const config = getGameConfig(gameId);
        if (!config) return { ok: false, error: "Invalid game selected." };
        if (!config.multiplayerReady) return { ok: false, error: "This game does not support multiplayer rooms yet." };

        const clientId = validateClientId(payload?.clientId);
        if (!clientId.ok) return clientId;

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing) {
          socket.leave(existing.roomCode);
          if (!existing.deleted) handlePlayerLeave(io, roomManager, existing);
        }

        const result = roomManager.createRoom({ socketId: socket.id, clientId: clientId.value, playerName: playerName.value, gameId });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        roomManager.addSystemMessage(roomManager.getRoom(result.roomCode), `${playerName.value} created the room.`);
        const publicRoom = roomManager.publicRoom(roomManager.getRoom(result.roomCode));
        socket.emit("room_created", { roomCode: result.roomCode, gameId: publicRoom.gameId, room: publicRoom });
        return { ok: true, roomCode: result.roomCode, gameId: publicRoom.gameId, room: publicRoom };
      });
    });

    socket.on("join_room", (payload, ack) => {
      withAck(ack, () => {
        if (isRateLimited(socket, "join_room")) return { ok: false, error: "Too many join attempts. Try again shortly." };

        const playerName = validateName(payload?.playerName);
        if (!playerName.ok) return playerName;

        const clientId = validateClientId(payload?.clientId);
        if (!clientId.ok) return clientId;

        const roomCode = normalizeRoomCode(payload?.roomCode);
        if (!isValidRoomCode(roomCode)) return { ok: false, error: "Invalid room code." };

        // Preflight BEFORE touching any state: a failed join must never
        // evict the user from the room they are currently in.
        const preflight = roomManager.preflightJoin({ roomCode, clientId: clientId.value });
        if (!preflight.ok) return preflight;

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing) {
          socket.leave(existing.roomCode);
          if (!existing.deleted) handlePlayerLeave(io, roomManager, existing);
        }

        const result = roomManager.joinRoom({ socketId: socket.id, clientId: clientId.value, playerName: playerName.value, roomCode });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        if (!result.rejoined) {
          const room = roomManager.getRoom(result.roomCode);
          const systemMessage = roomManager.addSystemMessage(room, `${playerName.value} joined the room.`);
          socket.to(result.roomCode).emit("player_joined", { room: roomManager.publicRoom(room) });
          io.to(result.roomCode).emit("system_message", systemMessage);
          io.to(result.roomCode).emit("room_state", roomManager.publicRoom(room));
        } else {
          // A reconnecting player must be re-synced with the shared state.
          const room = roomManager.getRoom(result.roomCode);
          socket.emit("room_state", roomManager.publicRoom(room));
          socket.emit("game_state", gameStatePayload(room));
        }

        // The joining player always receives the room's locked game.
        socket.emit("room_joined", { roomCode: result.roomCode, gameId: result.room.gameId, room: result.room });
        return { ok: true, roomCode: result.roomCode, gameId: result.room.gameId, room: result.room };
      });
    });

    socket.on("leave_room", () => {
      const result = roomManager.leaveBySocket(socket.id);
      if (result) {
        socket.leave(result.roomCode);
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
      socket.emit("room_state", roomManager.publicRoom(room));
      socket.emit("game_state", gameStatePayload(room));
    });

    socket.on("start_game", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room || !roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "Room not found." });
        return;
      }
      if (room.hostId !== socket.id) {
        socket.emit("room_error", { error: "Only the host can start the game." });
        return;
      }
      if (room.status !== "waiting") {
        socket.emit("room_error", { error: "The match has already started." });
        return;
      }
      if (room.players.length < room.minPlayers) {
        socket.emit("room_error", { error: `Need at least ${room.minPlayers} players to start.` });
        return;
      }

      // Initialize ONE shared match: game state, roles, first turn, status.
      const started = startGame(room);
      if (!started.ok) {
        socket.emit("room_error", { error: started.error });
        return;
      }

      const publicRoom = roomManager.publicRoom(room);
      const systemMessage = roomManager.addSystemMessage(room, "The match has started.");
      io.to(room.code).emit("system_message", systemMessage);
      io.to(room.code).emit("game_started", publicRoom);
      io.to(room.code).emit("room_state", publicRoom);
      io.to(room.code).emit("game_state", gameStatePayload(room));
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
      if (!room.gameState.winner && !room.gameState.draw) {
        socket.emit("room_error", { error: "The current match is still in progress." });
        return;
      }

      // Reset the shared state. Room, players, roles and game stay locked.
      const reset = resetGame(room);
      if (!reset.ok) {
        socket.emit("room_error", { error: reset.error });
        return;
      }

      const publicRoom = roomManager.publicRoom(room);
      const systemMessage = roomManager.addSystemMessage(room, "A new round is starting.");
      io.to(room.code).emit("system_message", systemMessage);
      io.to(room.code).emit("game_started", publicRoom);
      io.to(room.code).emit("room_state", publicRoom);
      io.to(room.code).emit("game_state", gameStatePayload(room));
    });

    socket.on("send_message", (payload) => {
      if (isRateLimited(socket, "send_message")) {
        socket.emit("room_error", { error: "You are sending messages too quickly." });
        return;
      }

      const roomCode = normalizeRoomCode(payload?.roomCode);
      const room = roomManager.getRoom(roomCode);
      if (!room || !roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "You are not a member of that room." });
        return;
      }

      const text = sanitizeText(payload?.message, 300);
      if (!text) return;

      const sender = room.players.find((player) => player.socketId === socket.id);
      const message = roomManager.addMessage(room, {
        type: "chat",
        sender: sender?.name || "Player",
        text,
        time: new Date().toISOString(),
      });
      io.to(room.code).emit("chat_message", message);
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

      io.to(room.code).emit("game_state", gameStatePayload(room));
      if (result.finished) {
        io.to(room.code).emit("game_over", {
          roomCode: room.code,
          gameId: room.gameId,
          winner: result.winner,
          draw: result.draw,
          gameState: room.gameState,
        });
      }
    });

    socket.on("disconnect", () => {
      const result = roomManager.leaveBySocket(socket.id);
      if (result && !result.deleted) handlePlayerLeave(io, roomManager, result);
    });
  });
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
      name: player.name,
      playerNumber: player.playerNumber,
      isHost: Boolean(player.isHost),
      role: player.role || null,
    })),
  };
}

/**
 * Common departure path for leave_room and disconnect.
 * If an active match is running, it is ended: shared state is cleared,
 * the room returns to "waiting" and the remaining player is notified.
 */
function handlePlayerLeave(io, roomManager, result) {
  const room = roomManager.getRoom(result.roomCode);
  if (room && room.status === "playing") {
    roomManager.endActiveMatch(room);
    const systemMessage = roomManager.addSystemMessage(
      room,
      `${result.player.name} left - the match was ended. Waiting for players...`
    );
    io.to(result.roomCode).emit("match_ended", {
      roomCode: result.roomCode,
      reason: "opponent_left",
      room: roomManager.publicRoom(room),
    });
    io.to(result.roomCode).emit("system_message", systemMessage);
  }

  const updatedRoom = roomManager.getRoom(result.roomCode);
  const publicRoom = updatedRoom ? roomManager.publicRoom(updatedRoom) : null;
  io.to(result.roomCode).emit("player_left", { player: result.player, room: publicRoom });
  if (result.hostChanged) io.to(result.roomCode).emit("host_changed", { host: result.hostChanged, room: publicRoom });
  if (updatedRoom) {
    io.to(result.roomCode).emit("room_state", publicRoom);
    io.to(result.roomCode).emit("game_state", gameStatePayload(updatedRoom));
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

function sanitizeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
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
