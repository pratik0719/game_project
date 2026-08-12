"use strict";

const { createSystemMessage } = require("./chatManager");

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_MESSAGES = 100;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Room lifecycle. Players are identified by a STABLE sessionId that the
 * browser keeps in sessionStorage across full-page navigations (lobby ->
 * game page -> refresh). socketId is only the *current* transport and is
 * updated whenever a player reconnects, so a page transition never looks
 * like a new player joining or an old one leaving.
 */
class RoomManager {
  constructor(gameConfig) {
    this.rooms = new Map();
    this.socketToRoom = new Map();
    this.clientToSocket = new Map();
    this.gameConfig = gameConfig;
  }

  createRoom({ socketId, clientId, sessionId, playerName, gameId }) {
    const config = this.gameConfig[gameId];
    if (!config) return { ok: false, error: "Invalid game selected." };
    if (!config.multiplayerReady) return { ok: false, error: "This game does not support multiplayer rooms yet." };

    const room = {
      code: this.generateRoomCode(),
      gameId,
      gameName: config.title || gameId,
      gameMode: config.mode || "turn-based",
      hostId: socketId,
      status: "waiting",
      players: [],
      maxPlayers: config.maxPlayers,
      minPlayers: config.minPlayers,
      gameState: null,
      currentTurn: null,
      round: 0,
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.rooms.set(room.code, room);
    this.addPlayer(room, { socketId, clientId, sessionId, name: playerName });
    return { ok: true, room: this.publicRoom(room), roomCode: room.code };
  }

  /**
   * Validate that a join attempt can succeed WITHOUT mutating any state.
   * Used before leaveBySocket so a failed join (bad code, full room, etc.)
   * never evicts the user from the room they are currently in.
   */
  preflightJoin({ roomCode, clientId, sessionId }) {
    const code = normalizeRoomCode(roomCode);
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "Room not found." };
    if (room.status !== "waiting") return { ok: false, error: "Game has already started." };
    const existing = findPlayer(room, { clientId, sessionId });
    if (!existing && room.players.length >= room.maxPlayers) return { ok: false, error: "Room is full." };
    return { ok: true };
  }

  joinRoom({ socketId, clientId, sessionId, playerName, roomCode }) {
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) return { ok: false, error: "Invalid room code." };

    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "Room not found." };
    if (room.status !== "waiting") return { ok: false, error: "Game has already started." };

    const existing = findPlayer(room, { clientId, sessionId });
    if (existing) {
      existing.socketId = socketId;
      existing.name = playerName;
      existing.isConnected = true;
      this.socketToRoom.set(socketId, room.code);
      if (existing.clientId) this.clientToSocket.set(existing.clientId, socketId);
      // A host refresh/reconnect swaps the socket before the old one
      // disconnects - keep the host pointing at the live socket so the
      // host is still recognized (Start Game button stays visible).
      if (existing.isHost) room.hostId = socketId;
      room.lastActivityAt = Date.now();
      return { ok: true, room: this.publicRoom(room), roomCode: room.code, rejoined: true };
    }

    if (room.players.length >= room.maxPlayers) return { ok: false, error: "Room is full." };

    this.addPlayer(room, { socketId, clientId, sessionId, name: playerName });
    return { ok: true, room: this.publicRoom(room), roomCode: room.code, rejoined: false };
  }

  /**
   * Rejoin an existing room after a full-page navigation (lobby -> game
   * page) or a socket reconnection. The player is found by their stable
   * sessionId, their socketId is swapped, and their role/state is kept.
   */
  reconnectRoom({ socketId, sessionId, roomCode }) {
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) return { ok: false, error: "Invalid room code." };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "Room not found." };

    const player = room.players.find((entry) => entry.sessionId === sessionId);
    if (!player) return { ok: false, error: "You are not a member of that room." };

    const oldSocketId = player.socketId;
    player.socketId = socketId;
    player.isConnected = true;
    this.socketToRoom.set(socketId, room.code);
    if (player.clientId) this.clientToSocket.set(player.clientId, socketId);
    if (player.isHost) room.hostId = socketId;
    // If this player owned the current turn, point the turn at the live socket
    // so a mid-match refresh does not strand their move.
    if (room.currentTurn === oldSocketId) room.currentTurn = socketId;
    room.lastActivityAt = Date.now();

    return { ok: true, room: this.publicRoom(room), roomCode: room.code, rejoined: true };
  }

  /** Mark a player's socket as disconnected but KEEP them in the room so a
   *  quick page navigation does not drop them. Removal happens later via
   *  removePlayerBySessionId once the grace period expires. */
  markPlayerDisconnected(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;
    const room = this.rooms.get(roomCode);
    if (!room) {
      this.socketToRoom.delete(socketId);
      return null;
    }
    const player = room.players.find((entry) => entry.socketId === socketId);
    if (!player) {
      this.socketToRoom.delete(socketId);
      return null;
    }
    player.isConnected = false;
    this.socketToRoom.delete(socketId);
    room.lastActivityAt = Date.now();
    return { roomCode, player: publicPlayer(player), room };
  }

  /** Actually remove a player after the disconnect grace period. */
  removePlayerBySessionId(roomCode, sessionId) {
    const room = this.getRoom(roomCode);
    if (!room) return null;
    const index = room.players.findIndex((entry) => entry.sessionId === sessionId);
    if (index === -1) return null;

    const [removed] = room.players.splice(index, 1);
    this.socketToRoom.delete(removed.socketId);
    if (removed?.clientId) this.clientToSocket.delete(removed.clientId);

    let hostChanged = null;
    if (room.players.length === 0) {
      room.lastActivityAt = Date.now();
      return { deleted: false, roomCode: room.code, player: publicPlayer(removed), room: this.publicRoom(room), hostChanged };
    }

    if (room.hostId === removed.socketId) {
      room.hostId = room.players[0].socketId;
      room.players[0].isHost = true;
      hostChanged = publicPlayer(room.players[0]);
    }

    room.lastActivityAt = Date.now();
    return { deleted: false, roomCode: room.code, player: publicPlayer(removed), room: this.publicRoom(room), hostChanged };
  }

  leaveBySocket(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.socketToRoom.delete(socketId);
      return null;
    }

    const index = room.players.findIndex((player) => player.socketId === socketId);
    if (index === -1) {
      this.socketToRoom.delete(socketId);
      return null;
    }

    const [removed] = room.players.splice(index, 1);
    this.socketToRoom.delete(socketId);
    if (removed?.clientId) this.clientToSocket.delete(removed.clientId);

    const oldHostId = room.hostId;
    let hostChanged = null;
    if (room.players.length === 0) {
      // Keep the empty room alive for a short grace period (pruned later by
      // pruneInactiveRooms). This lets the host's browser rejoin the SAME room
      // after navigating to the game page or refreshing - without it, the room
      // died mid-navigation and the host landed on the game page with no lobby
      // and no way to start the match. A player who joins an empty room adopts
      // it as the new host (addPlayer handles isHost/hostId).
      room.lastActivityAt = Date.now();
      return { deleted: false, roomCode: room.code, player: publicPlayer(removed), room: this.publicRoom(room), hostChanged };
    }

    if (oldHostId === socketId) {
      room.hostId = room.players[0].socketId;
      room.players[0].isHost = true;
      hostChanged = publicPlayer(room.players[0]);
    }

    room.lastActivityAt = Date.now();
    return { deleted: false, roomCode: room.code, player: publicPlayer(removed), room: this.publicRoom(room), hostChanged };
  }

  getRoom(code) {
    return this.rooms.get(normalizeRoomCode(code)) || null;
  }

  getRoomForSocket(socketId) {
    return this.getRoom(this.socketToRoom.get(socketId));
  }

  isSocketInRoom(socketId, roomCode) {
    const room = this.getRoom(roomCode);
    return Boolean(room?.players.some((player) => player.socketId === socketId));
  }

  isSessionInRoom(sessionId, roomCode) {
    const room = this.getRoom(roomCode);
    return Boolean(room?.players.some((player) => player.sessionId === sessionId));
  }

  publicRoom(room) {
    return {
      code: room.code,
      gameId: room.gameId,
      gameName: room.gameName || room.gameTitle,
      gameTitle: room.gameTitle,
      gameMode: room.gameMode || null,
      hostId: room.hostId,
      status: room.status,
      players: room.players.map(publicPlayer),
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      gameState: room.gameState,
      currentTurn: room.currentTurn,
      round: room.round || 0,
      createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt,
    };
  }

  /** Public copy of the room's chat history (newest-first pruning kept). */
  getChatMessages(room) {
    if (!room) return [];
    return room.messages.map(publicMessage);
  }

  addMessage(room, message) {
    room.messages.push(message);
    if (room.messages.length > MAX_ROOM_MESSAGES) room.messages = room.messages.slice(-MAX_ROOM_MESSAGES);
    room.lastActivityAt = Date.now();
    return publicMessage(message);
  }

  addSystemMessage(room, text) {
    return this.addMessage(room, createSystemMessage(room, text));
  }

  /**
   * End the active match (e.g. a player disconnected mid-game).
   * The room and remaining players are preserved, shared state is cleared,
   * and the room returns to "waiting" so a new opponent can join.
   * Roles are re-assigned on the next start_game.
   */
  endActiveMatch(room) {
    room.status = "waiting";
    room.gameState = null;
    room.currentTurn = null;
    room.round = 0;
    for (const player of room.players) {
      player.role = undefined;
    }
    room.lastActivityAt = Date.now();
    return this.publicRoom(room);
  }

  /** Mark a room as active (used by server-side game tickers). */
  touchRoom(room) {
    room.lastActivityAt = Date.now();
  }

  pruneInactiveRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const emptyExpired = room.players.length === 0 && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS;
      const staleExpired = now - room.lastActivityAt > ROOM_TTL_MS;
      if (emptyExpired || staleExpired) this.rooms.delete(code);
    }
  }

  addPlayer(room, { socketId, clientId, sessionId, name }) {
    const player = {
      sessionId,
      socketId,
      clientId,
      name,
      playerNumber: nextPlayerNumber(room.players),
      isHost: room.players.length === 0,
      role: undefined,
      isConnected: true,
      joinedAt: Date.now(),
    };
    room.players.push(player);
    if (player.isHost) room.hostId = socketId;
    this.socketToRoom.set(socketId, room.code);
    this.clientToSocket.set(clientId, socketId);
    room.lastActivityAt = Date.now();
    return player;
  }

  generateRoomCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      let code = "";
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Unable to generate a unique room code.");
  }
}

function findPlayer(room, { clientId, sessionId }) {
  return room.players.find(
    (player) =>
      (sessionId && player.sessionId === sessionId) ||
      (clientId && player.clientId === clientId)
  );
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidRoomCode(code) {
  return /^[A-Z2-9]{6}$/.test(code) && !/[0O1I]/.test(code);
}

function publicPlayer(player) {
  return {
    socketId: player.socketId,
    sessionId: player.sessionId,
    name: player.name,
    playerNumber: player.playerNumber,
    isHost: Boolean(player.isHost),
    role: player.role || null,
    isConnected: player.isConnected !== false,
    joinedAt: player.joinedAt || 0,
  };
}

function publicMessage(message) {
  return {
    id: message.id || randomId(),
    roomCode: message.roomCode || null,
    senderSessionId: message.senderSessionId || null,
    senderName: message.senderName || message.sender || null,
    type: message.type === "system" ? "system" : "player",
    text: message.text || "",
    createdAt: message.createdAt || new Date(message.time || Date.now()).getTime() || Date.now(),
  };
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function nextPlayerNumber(players) {
  const used = new Set(players.map((player) => player.playerNumber));
  for (let number = 1; number <= 8; number += 1) {
    if (!used.has(number)) return number;
  }
  return players.length + 1;
}

module.exports = {
  RoomManager,
  normalizeRoomCode,
  isValidRoomCode,
};
