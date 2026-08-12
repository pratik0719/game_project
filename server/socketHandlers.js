"use strict";

const { handleGameAction } = require("./gameHandlers");
const { isValidRoomCode, normalizeRoomCode } = require("./roomManager");

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

        const gameId = normalizeGameId(payload?.gameId);
        const clientId = validateClientId(payload?.clientId);
        if (!clientId.ok) return clientId;

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing && !existing.deleted) broadcastLeave(io, roomManager, existing);

        const result = roomManager.createRoom({ socketId: socket.id, clientId: clientId.value, playerName: playerName.value, gameId });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        roomManager.addSystemMessage(roomManager.getRoom(result.roomCode), `${playerName.value} created the room.`);
        const publicRoom = roomManager.publicRoom(roomManager.getRoom(result.roomCode));
        socket.emit("room_created", { roomCode: result.roomCode, room: publicRoom });
        return { ok: true, roomCode: result.roomCode, room: publicRoom };
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

        const existing = roomManager.leaveBySocket(socket.id);
        if (existing && !existing.deleted) broadcastLeave(io, roomManager, existing);

        const result = roomManager.joinRoom({ socketId: socket.id, clientId: clientId.value, playerName: playerName.value, roomCode });
        if (!result.ok) return result;

        socket.join(result.roomCode);
        if (!result.rejoined) {
          const room = roomManager.getRoom(result.roomCode);
          const systemMessage = roomManager.addSystemMessage(room, `${playerName.value} joined the room.`);
          socket.to(result.roomCode).emit("player_joined", { room: roomManager.publicRoom(room) });
          io.to(result.roomCode).emit("system_message", systemMessage);
          io.to(result.roomCode).emit("room_state", roomManager.publicRoom(room));
        }

        socket.emit("room_joined", { roomCode: result.roomCode, room: result.room });
        return { ok: true, roomCode: result.roomCode, room: result.room };
      });
    });

    socket.on("leave_room", () => {
      const result = roomManager.leaveBySocket(socket.id);
      if (result) {
        socket.leave(result.roomCode);
        if (!result.deleted) broadcastLeave(io, roomManager, result);
      }
    });

    socket.on("request_room_state", (payload) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      if (!roomManager.isSocketInRoom(socket.id, roomCode)) {
        socket.emit("room_error", { error: "You are not a member of that room." });
        return;
      }
      socket.emit("room_state", roomManager.publicRoom(roomManager.getRoom(roomCode)));
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
      if (room.players.length < room.minPlayers) {
        socket.emit("room_error", { error: `Need at least ${room.minPlayers} players to start.` });
        return;
      }
      const publicRoom = roomManager.markStarted(room);
      const systemMessage = roomManager.addSystemMessage(room, "The host started the game.");
      io.to(room.code).emit("system_message", systemMessage);
      io.to(room.code).emit("game_started", publicRoom);
      io.to(room.code).emit("room_state", roomManager.publicRoom(room));
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
      if (normalizeGameId(payload?.gameId) !== room.gameId) {
        socket.emit("room_error", { error: "That action does not belong to this room's game." });
        return;
      }
      const result = handleGameAction(room, socket, payload);
      if (!result.ok) {
        socket.emit("room_error", { error: result.error });
        return;
      }
      io.to(room.code).emit("game_state", result.gameState);
    });

    socket.on("disconnect", () => {
      const result = roomManager.leaveBySocket(socket.id);
      if (result && !result.deleted) broadcastLeave(io, roomManager, result);
    });
  });
}

function broadcastLeave(io, roomManager, result) {
  const room = result.room;
  const systemText = `${result.player.name} left the room.`;
  const systemMessage = room ? roomManager.addSystemMessage(roomManager.getRoom(result.roomCode), systemText) : null;
  io.to(result.roomCode).emit("player_left", { player: result.player, room });
  if (result.hostChanged) io.to(result.roomCode).emit("host_changed", { host: result.hostChanged, room });
  if (systemMessage) io.to(result.roomCode).emit("system_message", systemMessage);
  if (room) io.to(result.roomCode).emit("room_state", room);
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

function normalizeGameId(value) {
  return String(value || "").trim().toLowerCase();
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
