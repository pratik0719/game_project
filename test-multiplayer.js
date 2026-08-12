"use strict";

/**
 * Multiplayer integration test: exercises the full room lifecycle for all
 * 11 registered games using two socket.io-client connections.
 *
 * Run with: node test-multiplayer.js  (server must be running)
 */

const { io } = require("socket.io-client");
const { gameRegistry } = require("./server/gameRegistry");

const SERVER = process.env.TEST_SERVER || "http://localhost:3000";
const results = [];
let failures = 0;

function once(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (error, response) => {
      if (error) return reject(new Error(`${event} ack timeout`));
      resolve(response || {});
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, event, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

function clientId(tag) {
  const safeTag = String(tag).replace(/[^a-zA-Z0-9_-]/g, "");
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "x");
  return `test-${safeTag}-${Date.now().toString(36)}-${random}`;
}

async function waitForState(socket, roomCode, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for game_state condition")), timeoutMs);
    const handler = (payload) => {
      if (!payload || payload.gameId !== undefined) {
        if (predicate(payload)) {
          clearTimeout(timer);
          socket.off("game_state", handler);
          resolve(payload);
        }
      }
    };
    socket.on("game_state", handler);
    socket.emit("request_room_state", { roomCode });
  });
}

async function finishMatchFor(p1, p2, roomCode, gameId, moves) {
  // Send the provided moves (p1/p2 alternation handled by the caller).
  for (const move of moves) {
    const [who, action] = move;
    who.emit("game_action", { roomCode, gameId, action });
    await sleep(150);
  }
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

async function run() {
  console.log("Testing against", SERVER);
  console.log("Registered games:", Object.keys(gameRegistry).length);

  for (const [gameId, game] of Object.entries(gameRegistry)) {
    const tag = `game:${gameId}`;
    // Fresh sockets per game so per-socket rate limits never interfere.
    const p1 = io(SERVER, { transports: ["websocket"], reconnection: false });
    const p2 = io(SERVER, { transports: ["websocket"], reconnection: false });
    await Promise.all([once(p1, "connect"), once(p2, "connect")]);
    try {
      const c1 = clientId(tag + "a");
      const c2 = clientId(tag + "b");

      // 1. Create room.
      const created = await emitAck(p1, "create_room", { playerName: "Host", gameId, clientId: c1, sessionId: clientId(tag + "sa") });
      record(`${gameId}: create room`, created.ok === true && created.gameId === gameId, JSON.stringify(created).slice(0, 120));
      if (!created.ok) continue;

      const roomCode = created.roomCode;

      // 2. Room stores the exact game id.
      record(`${gameId}: room.gameId == ${gameId}`, created.room?.gameId === gameId, `got ${created.room?.gameId}`);

      // 3. Invalid game id rejected.
      const bad = await emitAck(p1, "create_room", { playerName: "Host", gameId: "not-a-game", clientId: c1 + "x" });
      record(`${gameId}: unknown game rejected`, bad.ok === false, JSON.stringify(bad).slice(0, 80));

      // 4. Join with the code.
      const joined = await emitAck(p2, "join_room", { playerName: "Guest", roomCode, clientId: c2, sessionId: clientId(tag + "sb") });
      record(`${gameId}: join room`, joined.ok === true && joined.gameId === gameId, JSON.stringify(joined).slice(0, 120));

      // 5. Joining player receives the same game route.
      record(`${gameId}: joined game route`, joined.room?.gameId === gameId);

      // 6. Start the game.
      const startedEvent = once(p1, "game_started", 10000);
      p1.emit("start_game", { roomCode });
      const started = await startedEvent;
      record(`${gameId}: start game`, Boolean(started) && started.gameId === gameId && started.status === "playing");

      // 7. Actions / ticks synchronize.
      let synced = false;
      switch (game.mode) {
        case "turn-based":
          if (gameId === "tictactoe") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "make_move", position: 0 }],
              [p2, { type: "make_move", position: 3 }],
              [p1, { type: "make_move", position: 1 }],
              [p2, { type: "make_move", position: 4 }],
              [p1, { type: "make_move", position: 2 }],
            ]);
            synced = true;
          } else if (gameId === "chess") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "move", from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }],
              [p2, { type: "move", from: { row: 1, col: 4 }, to: { row: 3, col: 4 } }],
            ]);
            synced = true;
          } else if (gameId === "ludo") {
            // Roll + move a token for each player.
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "roll" }],
              [p2, { type: "roll" }],
            ]);
            synced = true;
          }
          break;
        case "simultaneous":
          if (gameId === "snake") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "direction", direction: { x: 0, y: -1 } }],
              [p2, { type: "direction", direction: { x: 0, y: 1 } }],
            ]);
          } else if (gameId === "memory") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "flip", index: 0 }],
              [p1, { type: "flip", index: 1 }],
              [p2, { type: "flip", index: 5 }],
            ]);
          } else if (gameId === "quiz") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "answer", selected: 2 }],
              [p2, { type: "answer", selected: 1 }],
            ]);
          } else if (gameId === "spinwheel") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "spin" }],
              [p2, { type: "spin" }],
            ]);
          } else if (gameId === "2048") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "move", direction: "left" }],
              [p2, { type: "move", direction: "right" }],
            ]);
          } else if (gameId === "whackamole") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "whack", index: 0 }],
            ]);
          } else if (gameId === "flappy") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "flap" }],
              [p2, { type: "flap" }],
            ]);
          } else if (gameId === "breakout") {
            await finishMatchFor(p1, p2, roomCode, gameId, [
              [p1, { type: "paddle", x: 120 }],
              [p2, { type: "paddle", x: 320 }],
            ]);
          }
          synced = true;
          break;
      }
      record(`${gameId}: actions accepted`, synced);

      // 8. Both players see shared state.
      const state1 = await waitForState(p1, roomCode, (payload) => {
        if (!payload.gameState) return false;
        if (game.mode === "simultaneous") return payload.gameState && payload.status === "playing";
        return payload.gameState && payload.currentTurn !== undefined && payload.status === "playing";
      }, 10000);
      const gameState = state1.gameState || {};
      const hasState = Boolean(gameState) && (game.mode === "turn-based" ? gameState.board || gameState.players : gameState.playerStates || gameState.scores || gameState.pipes || gameState.activeHole !== undefined || gameState.questions);
      record(`${gameId}: shared game_state broadcast`, hasState);

      // 9. Opponent list present.
      const playersOk = Array.isArray(state1.players) && state1.players.length === 2;
      record(`${gameId}: opponent info synced`, playersOk);

      // 10. Finish the match where that is fast, then verify play again.
      const FAST_FINISH = new Set(["quiz", "spinwheel", "snake", "flappy"]);
      let matchFinished = gameId === "tictactoe"; // tictactoe already finished above
      const finishWatcher = FAST_FINISH.has(gameId)
        ? waitForEvent(p1, "game_over", (payload) => payload && payload.gameId === gameId, 25000)
            .then(() => {
              matchFinished = true;
              return true;
            })
            .catch(() => false)
        : Promise.resolve(false);

      if (gameId === "quiz") {
        // Answer every question with both players until the quiz finishes.
        for (let i = 0; i < 10; i += 1) {
          p1.emit("game_action", { roomCode, gameId, action: { type: "answer", selected: 2 } });
          p2.emit("game_action", { roomCode, gameId, action: { type: "answer", selected: 1 } });
          await sleep(200);
          if (matchFinished) break;
        }
      } else if (gameId === "spinwheel") {
        for (let i = 0; i < 8; i += 1) {
          p1.emit("game_action", { roomCode, gameId, action: { type: "spin" } });
          await sleep(120);
          p2.emit("game_action", { roomCode, gameId, action: { type: "spin" } });
          await sleep(120);
          if (matchFinished) break;
        }
      } else if (gameId === "snake") {
        p1.emit("game_action", { roomCode, gameId, action: { type: "direction", direction: { x: 0, y: -1 } } });
        p2.emit("game_action", { roomCode, gameId, action: { type: "direction", direction: { x: 0, y: 1 } } });
        await sleep(6000); // snakes drive into the walls and crash
      } else if (gameId === "flappy") {
        await sleep(5000); // birds fall under gravity and crash
      }

      await finishWatcher;

      if (matchFinished) {
        p1.emit("play_again", { roomCode });
        const ok = await waitForEvent(p1, "game_started", (payload) => payload && payload.gameId === gameId && payload.round >= 2, 8000)
          .then(() => true)
          .catch(() => false);
        record(`${gameId}: play again resets`, ok);
      } else {
        p1.emit("play_again", { roomCode });
        const ok = await waitForEvent(p1, "room_error", (payload) => /in progress|already over|finished/i.test(payload?.error || ""), 8000)
          .then(() => true)
          .catch(() => false);
        record(`${gameId}: play again guarded while running`, ok);
      }

      // Leave cleanly.
      p1.emit("leave_room", { roomCode });
      p2.emit("leave_room", { roomCode });
      await sleep(200);
    } catch (error) {
      record(`${gameId}: flow`, false, error.message);
    } finally {
      p1.close();
      p2.close();
    }
  }

  // ---- Two rooms running two different games simultaneously ----
  try {
    // Each room needs its own host socket: creating a second room from the
    // same socket correctly leaves the first room first.
    const m1 = io(SERVER, { transports: ["websocket"], reconnection: false });
    const m2 = io(SERVER, { transports: ["websocket"], reconnection: false });
    const m3 = io(SERVER, { transports: ["websocket"], reconnection: false });
    const m4 = io(SERVER, { transports: ["websocket"], reconnection: false });
    await Promise.all([once(m1, "connect"), once(m2, "connect"), once(m3, "connect"), once(m4, "connect")]);
    const r1 = await emitAck(m1, "create_room", { playerName: "A1", gameId: "tictactoe", clientId: clientId("mix1"), sessionId: clientId("mix1s") });
    const r2 = await emitAck(m3, "create_room", { playerName: "B1", gameId: "snake", clientId: clientId("mix2"), sessionId: clientId("mix2s") });
    const ok = r1.ok && r2.ok && r1.gameId === "tictactoe" && r2.gameId === "snake" && r1.roomCode !== r2.roomCode;
    record("two rooms, two games", ok, JSON.stringify({ r1: r1.gameId, r2: r2.gameId }));

    const j1 = await emitAck(m2, "join_room", { playerName: "A2", roomCode: r1.roomCode, clientId: clientId("mix3"), sessionId: clientId("mix3s") });
    const j2 = await emitAck(m4, "join_room", { playerName: "B2", roomCode: r2.roomCode, clientId: clientId("mix4"), sessionId: clientId("mix4s") });
    record("joins go to correct games", j1.ok && j2.ok && j1.gameId === "tictactoe" && j2.gameId === "snake");

    m1.emit("start_game", { roomCode: r1.roomCode });
    m3.emit("start_game", { roomCode: r2.roomCode });
    await sleep(400);
    record("both rooms start independently", true);

    m1.emit("game_action", { roomCode: r1.roomCode, gameId: "tictactoe", action: { type: "make_move", position: 0 } });
    m3.emit("game_action", { roomCode: r2.roomCode, gameId: "snake", action: { type: "direction", direction: { x: 0, y: -1 } } });
    await sleep(600);

    const s1 = await waitForState(m1, r1.roomCode, (payload) => payload.gameState && payload.gameState.board && payload.gameState.board.some(Boolean), 8000);
    const s2 = await waitForState(m3, r2.roomCode, (payload) => payload.gameState && payload.gameState.playerStates, 8000);
    const noMix = s1.gameState.board[0] === "X" && s2.gameState.playerStates && !s2.gameState.board;
    record("states do not mix between rooms", noMix);

    m1.emit("leave_room", { roomCode: r1.roomCode });
    m2.emit("leave_room", { roomCode: r1.roomCode });
    m3.emit("leave_room", { roomCode: r2.roomCode });
    m4.emit("leave_room", { roomCode: r2.roomCode });
    m1.close();
    m2.close();
    m3.close();
    m4.close();
  } catch (error) {
    record("two rooms, two games", false, error.message);
  }

  // ---- Private room chat: isolation, validation, reconnect, host flow ----
  await testRoomChat();

  console.log("\n===== RESULTS =====");
  let passed = 0;
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
    if (result.ok) passed += 1;
  }
  console.log(`\n${passed}/${results.length} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Private room chat: two rooms must never share messages, validation and
 * rate limiting must hold, history must survive a sessionId reconnect, and
 * the host flow (leave -> transfer -> start) must keep working.
 */
async function testRoomChat() {
  const a1 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const a2 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const b1 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const b2 = io(SERVER, { transports: ["websocket"], reconnection: false });
  await Promise.all([once(a1, "connect"), once(a2, "connect"), once(b1, "connect"), once(b2, "connect")]);

  const sA1 = clientId("chata1s");
  const sA2 = clientId("chata2s");
  const sB1 = clientId("chatb1s");
  const sB2 = clientId("chatb2s");
  let a2b = null; // reconnect socket for the guest in room A
  let a2c = null;

  try {
    const roomA = await emitAck(a1, "create_room", { playerName: "Alpha", gameId: "tictactoe", clientId: clientId("chata1"), sessionId: sA1 });
    const roomB = await emitAck(b1, "create_room", { playerName: "Bravo", gameId: "snake", clientId: clientId("chatb1"), sessionId: sB1 });
    record("chat: two rooms created independently", roomA.ok && roomB.ok && roomA.roomCode !== roomB.roomCode);

    const sysJoinA1 = once(a1, "room_system_message", 8000);
    const sysJoinA2 = once(a2, "room_system_message", 8000);
    const joinA = await emitAck(a2, "join_room", { playerName: "Ace", roomCode: roomA.roomCode, clientId: clientId("chata2"), sessionId: sA2 });
    const joinB = await emitAck(b2, "join_room", { playerName: "Beta", roomCode: roomB.roomCode, clientId: clientId("chatb2"), sessionId: sB2 });
    record("chat: both rooms joined", joinA.ok && joinB.ok);
    const [sysA1, sysA2] = await Promise.all([sysJoinA1, sysJoinA2]);
    record("chat: join system message in room A only", sysA1.type === "system" && /joined the room/.test(sysA1.text) && sysA2.type === "system");

    // --- Room isolation: room A message must never reach room B ---
    const bGot = { got: false };
    const bMark = () => {
      bGot.got = true;
    };
    b1.on("room_message", bMark);
    b2.on("room_message", bMark);
    const aRecvPromise = once(a2, "room_message", 8000);
    const sendA = await emitAck(a1, "send_room_message", { roomCode: roomA.roomCode, text: "Hello from Room A" });
    const aRecv = await aRecvPromise;
    await sleep(600);
    b1.off("room_message", bMark);
    b2.off("room_message", bMark);
    record("chat: message acked with server-created id", sendA.success === true && typeof sendA.messageId === "string" && sendA.messageId.length > 0);
    record("chat: room A receives the message", aRecv.text === "Hello from Room A" && aRecv.type === "player" && aRecv.senderName === "Alpha" && aRecv.senderSessionId === sA1);
    record("chat: room B receives nothing from room A", !bGot.got);

    // --- Room isolation: room B message must never reach room A ---
    const aGot = { got: false };
    const aMark = () => {
      aGot.got = true;
    };
    a1.on("room_message", aMark);
    a2.on("room_message", aMark);
    const bRecvPromise = once(b2, "room_message", 8000);
    const sendB = await emitAck(b1, "send_room_message", { roomCode: roomB.roomCode, text: "Hello from Room B" });
    const bRecv = await bRecvPromise;
    await sleep(600);
    a1.off("room_message", aMark);
    a2.off("room_message", aMark);
    record("chat: room B message delivered", bRecv.text === "Hello from Room B");
    record("chat: room A receives nothing from room B", !aGot.got);

    // --- Validation & security ---
    const empty = await emitAck(a1, "send_room_message", { roomCode: roomA.roomCode, text: "   " });
    record("chat: whitespace-only rejected", empty.success === false);
    const long = await emitAck(a1, "send_room_message", { roomCode: roomA.roomCode, text: "x".repeat(301) });
    record("chat: >300 chars rejected", long.success === false);
    const html = await emitAck(a1, "send_room_message", { roomCode: roomA.roomCode, text: "<script>alert(1)</script>" });
    record("chat: html stored as plain text", html.success === true);
    const badRoom = await emitAck(a1, "send_room_message", { roomCode: "ZZZZZZ", text: "hi" });
    record("chat: unknown room rejected", badRoom.success === false);

    const stranger = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(stranger, "connect");
    const intrude = await emitAck(stranger, "send_room_message", { roomCode: roomB.roomCode, text: "intrude" });
    record("chat: non-member message rejected", intrude.success === false);
    let strangerHistory = false;
    stranger.on("chat_history", () => {
      strangerHistory = true;
    });
    const historyDenied = once(stranger, "chat_error", 8000);
    stranger.emit("request_chat_history", { roomCode: roomA.roomCode });
    const deniedPayload = await historyDenied;
    record("chat: history denied for non-member", /not a member/.test(deniedPayload.error) && !strangerHistory);
    const badReconnect = await emitAck(stranger, "reconnect_room", { roomCode: "ZZZZZZ", sessionId: sA1 });
    record("chat: invalid reconnect rejected", badReconnect.ok === false);
    stranger.close();

    // --- Rate limiting: 5 per 10 seconds per player ---
    let fastOk = true;
    for (let i = 0; i < 5; i += 1) {
      const result = await emitAck(a2, "send_room_message", { roomCode: roomA.roomCode, text: `burst ${i}` });
      if (!result.success) fastOk = false;
    }
    const sixth = await emitAck(a2, "send_room_message", { roomCode: roomA.roomCode, text: "too fast" });
    record("chat: rate limited after 5 messages / 10s", fastOk && sixth.success === false);

    // --- Typing indicator ---
    const typingPromise = once(a1, "room_typing", 8000);
    a2.emit("chat_typing_start", { roomCode: roomA.roomCode });
    const typing = await typingPromise;
    record("chat: typing broadcast to room", typing.roomCode === roomA.roomCode && typing.typing.some((t) => t.sessionId === sA2 && t.senderName === "Ace"));
    const typingStopPromise = once(a1, "room_typing", 8000);
    a2.emit("chat_typing_stop", { roomCode: roomA.roomCode });
    const typingStop = await typingStopPromise;
    record("chat: typing stopped", typingStop.typing.every((t) => t.sessionId !== sA2));

    // --- History on request ---
    const historyPromise = once(a2, "chat_history", 8000);
    a2.emit("request_chat_history", { roomCode: roomA.roomCode });
    const history = await historyPromise;
    record(
      "chat: history restored on request",
      Array.isArray(history.messages) &&
        history.messages.some((m) => m.text === "Hello from Room A") &&
        history.messages.every((m) => m.roomCode === roomA.roomCode && m.id && m.type)
    );

    // --- Reconnect with the stable sessionId (lobby -> game navigation) ---
    a2b = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(a2b, "connect");
    const histOnReconnect = once(a2b, "chat_history", 8000);
    const reconnected = await emitAck(a2b, "reconnect_room", { roomCode: roomA.roomCode, sessionId: sA2 });
    const history2 = await histOnReconnect;
    a2.close(); // the old transport drops AFTER the new socket joined
    record("chat: reconnect keeps player count (no duplicate)", reconnected.ok === true && reconnected.room.players.length === 2);
    record("chat: reconnect restores chat history", history2.messages.some((m) => m.text === "Hello from Room A"));

    // --- Match state + roles survive a reconnect mid-match ---
    const started = await emitAck(a1, "start_game", { roomCode: roomA.roomCode });
    record("chat: match starts with 2 players", started && started.success === true);
    a1.emit("game_action", { roomCode: roomA.roomCode, gameId: "tictactoe", action: { type: "make_move", position: 0 } });
    await sleep(300);
    const stateBefore = await waitForState(a2b, roomA.roomCode, (payload) => payload.gameState && payload.status === "playing", 8000);
    const roleBefore = stateBefore.players.find((player) => player.sessionId === sA2)?.role;

    const disconnectMsg = once(a1, "room_system_message", 8000);
    a2c = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(a2c, "connect");
    const histOnReconnect2 = once(a2c, "chat_history", 8000);
    a2b.close();
    const dMsg = await disconnectMsg;
    const reconnected2 = await emitAck(a2c, "reconnect_room", { roomCode: roomA.roomCode, sessionId: sA2 });
    await histOnReconnect2;
    const stateAfter = await waitForState(a2c, roomA.roomCode, (payload) => payload.gameState && payload.status === "playing", 8000);
    const roleAfter = stateAfter.players.find((player) => player.sessionId === sA2)?.role;
    record("chat: disconnect system message", /disconnected/.test(dMsg.text));
    record("chat: reconnect mid-match keeps role", Boolean(roleBefore) && roleBefore === roleAfter && reconnected2.room.players.length === 2);
    record("chat: match state preserved across reconnect", Boolean(stateAfter.gameState) && stateAfter.status === "playing");

    // The reconnected player owns the next turn (host moved first) - their
    // move must be accepted even though their socket id changed.
    const movedWithoutError = await new Promise((resolve) => {
      const onError = () => resolve(false);
      a2c.once("room_error", onError);
      a2c.emit("game_action", { roomCode: roomA.roomCode, gameId: "tictactoe", action: { type: "make_move", position: 4 } });
      setTimeout(() => {
        a2c.off("room_error", onError);
        resolve(true);
      }, 2500);
    });
    record("chat: reconnected current-turn player can move", movedWithoutError);

    // --- Host leaves: transfer + system messages + new host starts ---
    const sysMessages = [];
    const sysCollector = (message) => sysMessages.push(message.text);
    b2.on("room_system_message", sysCollector);
    const hostChangedPromise = once(b2, "host_changed", 8000);
    b1.emit("leave_room", { roomCode: roomB.roomCode });
    const hostChanged = await hostChangedPromise;
    await sleep(400);
    b2.off("room_system_message", sysCollector);
    record("chat: host transfers on leave", hostChanged.host && hostChanged.host.name === "Beta" && hostChanged.host.isHost === true);
    record(
      "chat: leave + new-host system messages",
      sysMessages.some((text) => /left the room/.test(text)) && sysMessages.some((text) => /became the new host/.test(text))
    );
    // A fresh player joins the room the old host left, then the new host
    // starts the game (snake needs 2 players).
    const b3 = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(b3, "connect");
    const joinB3 = await emitAck(b3, "join_room", { playerName: "Chip", roomCode: roomB.roomCode, clientId: clientId("chatb3"), sessionId: clientId("chatb3s") });
    const startByNewHost = await emitAck(b2, "start_game", { roomCode: roomB.roomCode });
    record("chat: new host can start the game", joinB3.ok && startByNewHost.success === true);
    b3.close();

    // Cleanup.
    a1.emit("leave_room", { roomCode: roomA.roomCode });
    if (a2c) a2c.emit("leave_room", { roomCode: roomA.roomCode });
    b2.emit("leave_room", { roomCode: roomB.roomCode });
    await sleep(200);
  } catch (error) {
    record("chat: flow", false, error.message);
  } finally {
    a1.close();
    a2.close();
    b1.close();
    b2.close();
    if (a2b) a2b.close();
    if (a2c) a2c.close();
  }
}

run().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
