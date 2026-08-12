"use strict";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_MESSAGES = 100;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

class RoomManager {
  constructor(gameConfig) {
    this.rooms = new Map();
    this.socketToRoom = new Map();
    this.clientToSocket = new Map();
    this.gameConfig = gameConfig;
  }

  createRoom({ socketId, clientId, playerName, gameId }) {
    const config = this.gameConfig[gameId];
    if (!config) return { ok: false, error: "Invalid game selected." };

    const room = {
      code: this.generateRoomCode(),
      gameId,
      gameTitle: config.title || gameId,
      hostId: socketId,
      status: "waiting",
      players: [],
      maxPlayers: config.maxPlayers,
      minPlayers: config.minPlayers,
      gameState: null,
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.rooms.set(room.code, room);
    this.addPlayer(room, { socketId, clientId, name: playerName });
    return { ok: true, room: this.publicRoom(room), roomCode: room.code };
  }

  joinRoom({ socketId, clientId, playerName, roomCode }) {
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) return { ok: false, error: "Invalid room code." };

    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "Room not found." };
    if (room.status !== "waiting") return { ok: false, error: "Game has already started." };

    const existingByClient = room.players.find((player) => player.clientId === clientId);
    if (existingByClient) {
      existingByClient.socketId = socketId;
      existingByClient.name = playerName;
      this.socketToRoom.set(socketId, room.code);
      this.clientToSocket.set(clientId, socketId);
      room.lastActivityAt = Date.now();
      return { ok: true, room: this.publicRoom(room), roomCode: room.code, rejoined: true };
    }

    if (room.players.length >= room.maxPlayers) return { ok: false, error: "Room is full." };

    this.addPlayer(room, { socketId, clientId, name: playerName });
    return { ok: true, room: this.publicRoom(room), roomCode: room.code, rejoined: false };
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
      this.rooms.delete(room.code);
      return { deleted: true, roomCode: room.code, player: publicPlayer(removed), room: null, hostChanged };
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

  publicRoom(room) {
    return {
      code: room.code,
      gameId: room.gameId,
      gameTitle: room.gameTitle,
      hostId: room.hostId,
      status: room.status,
      players: room.players.map(publicPlayer),
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      gameState: room.gameState,
      messages: room.messages.map(publicMessage),
      createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt,
    };
  }

  addMessage(room, message) {
    room.messages.push(message);
    if (room.messages.length > MAX_ROOM_MESSAGES) room.messages = room.messages.slice(-MAX_ROOM_MESSAGES);
    room.lastActivityAt = Date.now();
    return publicMessage(message);
  }

  addSystemMessage(room, text) {
    return this.addMessage(room, {
      type: "system",
      sender: "System",
      text,
      time: new Date().toISOString(),
    });
  }

  markStarted(room) {
    room.status = "started";
    room.lastActivityAt = Date.now();
    return this.publicRoom(room);
  }

  pruneInactiveRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const emptyExpired = room.players.length === 0 && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS;
      const staleExpired = now - room.lastActivityAt > ROOM_TTL_MS;
      if (emptyExpired || staleExpired) this.rooms.delete(code);
    }
  }

  addPlayer(room, { socketId, clientId, name }) {
    const player = {
      socketId,
      clientId,
      name,
      playerNumber: nextPlayerNumber(room.players),
      isHost: room.players.length === 0,
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

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidRoomCode(code) {
  return /^[A-Z2-9]{6}$/.test(code) && !/[0O1I]/.test(code);
}

function publicPlayer(player) {
  return {
    socketId: player.socketId,
    name: player.name,
    playerNumber: player.playerNumber,
    isHost: Boolean(player.isHost),
  };
}

function publicMessage(message) {
  return {
    type: message.type || "chat",
    sender: message.sender || "Player",
    text: message.text || "",
    time: message.time || new Date().toISOString(),
  };
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
