"use strict";

/**
 * chatManager
 * -----------
 * All chat validation and message creation lives here so the socket
 * handlers stay thin and no single file becomes a dumping ground.
 *
 * The server always creates the authoritative message object - clients
 * only ever send { roomCode, text } and the sender is resolved from the
 * room membership associated with the socket. Sender names, timestamps,
 * session ids and message types are never trusted from the browser.
 */

const crypto = require("node:crypto");

const MAX_MESSAGE_LENGTH = 300;
const CHAT_RATE_LIMIT = { limit: 5, windowMs: 10_000 };
const TYPING_TTL_MS = 2500;

// Per-player rate buckets keyed by sessionId (stable across reconnects).
const chatRateBuckets = new Map();

// Per-room typing tracker: roomCode -> Map(sessionId -> { name, expiresAt }).
const typingByRoom = new Map();

/** Create a player chat message. Never trust client-provided metadata. */
function createPlayerMessage(room, player, text) {
  return {
    id: crypto.randomUUID(),
    roomCode: room.code,
    senderSessionId: player.sessionId,
    senderName: player.name,
    type: "player",
    text,
    createdAt: Date.now(),
  };
}

/** Create a system message (joins, leaves, host changes, round starts...). */
function createSystemMessage(room, text) {
  return {
    id: crypto.randomUUID(),
    roomCode: room.code,
    type: "system",
    text,
    createdAt: Date.now(),
  };
}

/** Trim control characters and whitespace. */
function sanitizeChatText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * Rate limit each player to roughly five messages per ten seconds.
 * Buckets are keyed by sessionId so the limit survives socket churn.
 */
function isChatRateLimited(sessionId) {
  const now = Date.now();
  const bucket = chatRateBuckets.get(sessionId) || { count: 0, resetAt: now + CHAT_RATE_LIMIT.windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + CHAT_RATE_LIMIT.windowMs;
  }
  bucket.count += 1;
  chatRateBuckets.set(sessionId, bucket);
  return bucket.count > CHAT_RATE_LIMIT.limit;
}

/** Mark a player as typing. Expires automatically after TYPING_TTL_MS. */
function setTyping(roomCode, sessionId, name) {
  let room = typingByRoom.get(roomCode);
  if (!room) {
    room = new Map();
    typingByRoom.set(roomCode, room);
  }
  room.set(sessionId, { name, expiresAt: Date.now() + TYPING_TTL_MS });
}

/** Clear a player's typing state (they sent a message or stopped typing). */
function clearTyping(roomCode, sessionId) {
  const room = typingByRoom.get(roomCode);
  if (room) room.delete(sessionId);
}

/** Current active typers for a room, dropping expired entries. */
function activeTypers(roomCode) {
  const room = typingByRoom.get(roomCode);
  if (!room) return [];
  const now = Date.now();
  const active = [];
  for (const [sessionId, entry] of room.entries()) {
    if (entry.expiresAt <= now) room.delete(sessionId);
    else active.push({ sessionId, senderName: entry.name });
  }
  return active;
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  createPlayerMessage,
  createSystemMessage,
  sanitizeChatText,
  isChatRateLimited,
  setTyping,
  clearTyping,
  activeTypers,
};
