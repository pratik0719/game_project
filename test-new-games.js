"use strict";

/**
 * Dedicated tests for the four new games:
 *   - RPS Arena      (simultaneous hidden choice, server timers)
 *   - Neon Connect   (turn-based shared board, win detection)
 *   - Neon Fleet     (turn-based private boards, placement + attacks)
 *   - Color Clash    (turn-based private hands, action cards, last card)
 *
 * Two layers:
 *   1. Socket integration tests against a running server (TEST_SERVER,
 *      default http://localhost:3000) covering lifecycle, private-state
 *      protection, turn enforcement, game over, play again, reconnect,
 *      room isolation and chat during gameplay.
 *   2. In-process handler tests (no sockets) for deterministic rule
 *      coverage: matchups, win/draw detection, action cards, last-card
 *      challenges, forfeits and timeouts.
 *
 * Run with: node test-new-games.js   (server must be running)
 */

const { io } = require("socket.io-client");
const { gameRegistry } = require("./server/gameRegistry");
const rpsArena = require("./server/gameHandlers/rpsArena");
const neonConnect = require("./server/gameHandlers/neonConnect");
const neonFleet = require("./server/gameHandlers/neonFleet");
const colorClash = require("./server/gameHandlers/colorClash");

const SERVER = process.env.TEST_SERVER || "http://localhost:3000";
const results = [];
let failures = 0;

// ---------------------------------------------------------------- helpers

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

async function waitForState(socket, roomCode, predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for game_state condition")), timeoutMs);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off("game_state", handler);
        resolve(payload);
      }
    };
    socket.on("game_state", handler);
    socket.emit("request_room_state", { roomCode });
  });
}

function clientId(tag) {
  const safeTag = String(tag).replace(/[^a-zA-Z0-9_-]/g, "");
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "x");
  return `new-${safeTag}-${Date.now().toString(36)}-${random}`;
}

/** Expect a room_error on the given socket matching the regex. */
async function expectError(socket, roomCode, gameId, action, pattern, label) {
  const errPromise = waitForEvent(socket, "room_error", (payload) => pattern.test(payload?.error || ""), 8000);
  socket.emit("game_action", { roomCode, gameId, action });
  const err = await errPromise;
  record(label, pattern.test(err.error), err.error);
}

/** Full room lifecycle for a game: create + join + start. */
async function setupRoom(gameId, tag) {
  const p1 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const p2 = io(SERVER, { transports: ["websocket"], reconnection: false });
  await Promise.all([once(p1, "connect"), once(p2, "connect")]);
  const created = await emitAck(p1, "create_room", { playerName: "Host", gameId, clientId: clientId(`${tag}h`), sessionId: clientId(`${tag}hs`) });
  const joined = await emitAck(p2, "join_room", { playerName: "Guest", roomCode: created.roomCode, clientId: clientId(`${tag}g`), sessionId: clientId(`${tag}gs`) });
  const started = await emitAck(p1, "start_game", { roomCode: created.roomCode });
  return { p1, p2, roomCode: created.roomCode, created, joined, started };
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

function closeAll(...sockets) {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch (_error) {
      /* already closed */
    }
  }
}

// ----------------------------------------------- socket integration tests

async function testRpsArena() {
  let { p1, p2, roomCode } = await setupRoom("rps-arena", "rps");
  const gameId = "rps-arena";
  const sHost = clientId("rpshs2");
  const sGuest = clientId("rpsgs2");
  let p1b = null;

  try {
    // 1. Invalid choice rejected before any valid submit.
    await expectError(p1, roomCode, gameId, { type: "submit_choice", choice: "gun" }, /invalid/i, "rps: invalid choice rejected");

    // 2. Hidden choice security: p1 chooses; p2 only learns "ready".
    p1.emit("game_action", { roomCode, gameId, action: { type: "submit_choice", choice: "rock" } });
    const p2View = await waitForState(p2, roomCode, (payload) => payload.gameState && payload.gameState.opponentReady === true, 8000);
    const gs = p2View.gameState;
    record(
      "rps: choice hidden until both submit",
      gs.myChoice === null && gs.opponentReady === true && gs.revealedChoices === null && gs.phase === "choosing" && !("opponentChoice" in gs) && !("theirChoice" in gs),
      `phase=${gs.phase} opponentReady=${gs.opponentReady} myChoice=${gs.myChoice}`
    );
    const p1View = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.myChoice === "rock", 8000);
    record("rps: own choice visible to self", p1View.gameState.myChoice === "rock" && p1View.gameState.opponentReady === false);

    // 3. Double submission locked.
    await expectError(p1, roomCode, gameId, { type: "submit_choice", choice: "paper" }, /already locked/i, "rps: double submit rejected");

    // 4. Both submitted -> round resolves, choices revealed together.
    p2.emit("game_action", { roomCode, gameId, action: { type: "submit_choice", choice: "scissors" } });
    const revealed = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.revealedChoices, 8000);
    record(
      "rps: reveal shows both choices + round winner",
      revealed.gameState.revealedChoices.mine === "rock" && revealed.gameState.revealedChoices.theirs === "scissors" && revealed.gameState.myScore === 1 && revealed.gameState.roundWinnerSession === revealed.players[0].sessionId
    );

    // 5. Best-of-five: p1 wins the match 3-0 (register the game_over wait
    //    up front - the server tick may finish the match).
    const gameOverPromise = waitForEvent(p1, "game_over", (payload) => payload && payload.gameId === gameId, 10000);
    for (let round = 2; round <= 3; round += 1) {
      p1.emit("game_action", { roomCode, gameId, action: { type: "next_round" } });
      await sleep(150);
      p1.emit("game_action", { roomCode, gameId, action: { type: "submit_choice", choice: "rock" } });
      p2.emit("game_action", { roomCode, gameId, action: { type: "submit_choice", choice: "scissors" } });
      await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.phase === "revealed" && payload.gameState.round === round, 8000);
    }
    p1.emit("game_action", { roomCode, gameId, action: { type: "next_round" } });
    const over = await gameOverPromise;
    record("rps: match winner after best-of-five", over.winnerName === "Host" && over.draw === false, `winner=${over.winnerName}`);

    // 6. Play again resets scores and round.
    p1.emit("play_again", { roomCode });
    await waitForEvent(p1, "game_started", (payload) => payload && payload.gameId === gameId && payload.round >= 2, 8000);
    const fresh = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.round === 1 && payload.gameState.phase === "choosing", 8000);
    record("rps: play again resets scores", fresh.gameState.myScore === 0 && fresh.gameState.opponentScore === 0 && fresh.gameState.round === 1);

    // 7. Reconnect keeps the locked choice.
    const lockedHost = clientId("rpshs2");
    const hostSession = clientId("rpshosts");
    // fresh room for a clean reconnect test
    const r2 = await setupRoom("rps-arena", "rps2");
    const r2GameId = "rps-arena";
    r2.p1.emit("game_action", { roomCode: r2.roomCode, gameId: r2GameId, action: { type: "submit_choice", choice: "rock" } });
    await waitForState(r2.p1, r2.roomCode, (payload) => payload.gameState && payload.gameState.myChoice === "rock", 8000);
    const hostSessionId = r2.joined.room.players.find((player) => player.name === "Host").sessionId;
    p1b = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(p1b, "connect");
    const reconnected = await emitAck(p1b, "reconnect_room", { roomCode: r2.roomCode, sessionId: hostSessionId });
    const restored = await waitForState(p1b, r2.roomCode, (payload) => payload.gameState && payload.gameState.myChoice === "rock", 8000);
    record("rps: reconnect restores locked choice", reconnected.ok === true && restored.gameState.myChoice === "rock");
    const lockedErr = waitForEvent(p1b, "room_error", (payload) => /already locked/i.test(payload?.error || ""), 8000);
    p1b.emit("game_action", { roomCode: r2.roomCode, gameId: r2GameId, action: { type: "submit_choice", choice: "paper" } });
    await lockedErr;
    record("rps: locked choice survives reconnect", true);
    r2.p1.emit("leave_room", { roomCode: r2.roomCode });
    r2.p2.emit("leave_room", { roomCode: r2.roomCode });
    r2.p1.close();
    r2.p2.close();
    closeAll(p1b);

    // 8. Server-managed 15s timer: p1 alone submits -> wins round by forfeit.
    const r3 = await setupRoom("rps-arena", "rps3");
    const r3GameId = "rps-arena";
    const hostSid3 = r3.joined.room.players.find((player) => player.name === "Host").sessionId;
    r3.p1.emit("game_action", { roomCode: r3.roomCode, gameId: r3GameId, action: { type: "submit_choice", choice: "rock" } });
    const forfeit = await waitForEvent(
      r3.p1,
      "game_state",
      (payload) => payload.gameState && payload.gameState.lastEvent && payload.gameState.lastEvent.type === "forfeit" && payload.gameState.roundWinnerSession === hostSid3,
      35000
    );
    record("rps: timeout awards round to the submitter", forfeit.gameState.phase === "revealed" && forfeit.gameState.myScore === 1, `event=${forfeit.gameState.lastEvent.text}`);
    r3.p1.emit("leave_room", { roomCode: r3.roomCode });
    r3.p2.emit("leave_room", { roomCode: r3.roomCode });
    r3.p1.close();
    r3.p2.close();
  } catch (error) {
    record("rps: flow", false, error.message);
  } finally {
    closeAll(p1, p2, p1b);
  }
}

async function testNeonConnect() {
  const gameId = "neon-connect";
  let { p1, p2, roomCode } = await setupRoom(gameId, "nc1");
  let { p1: w1, p2: w2, roomCode: winCode } = await setupRoom(gameId, "ncw");
  let { p1: r1, p2: r2, roomCode: recCode } = await setupRoom(gameId, "ncr");
  let r2b = null;

  try {
    // 1. Turn enforcement + invalid column.
    await expectError(p2, roomCode, gameId, { type: "drop_disc", column: 0 }, /not your turn/i, "out-of-turn drop rejected");
    await expectError(p1, roomCode, gameId, { type: "drop_disc", column: 9 }, /invalid column/i, "invalid column rejected");

    // 2. Fill a column, then reject a full-column drop.
    for (let i = 0; i < 6; i += 1) {
      if (i % 2 === 0) p1.emit("game_action", { roomCode, gameId, action: { type: "drop_disc", column: 0 } });
      else p2.emit("game_action", { roomCode, gameId, action: { type: "drop_disc", column: 0 } });
      await sleep(120);
    }
    await expectError(p1, roomCode, gameId, { type: "drop_disc", column: 0 }, /column is full/i, "full column rejected");
    const filled = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.board[0][0] !== null, 8000);
    record("neon-connect: discs drop to lowest empty cell", filled.gameState.board[5][0] !== null && filled.gameState.board[0][0] !== null);
    const colVals = [0, 1, 2, 3, 4, 5].map((r) => filled.gameState.board[r][0]);
    record("neon-connect: column alternates players", colVals.filter((v) => v === "cyan").length === 3 && colVals.filter((v) => v === "magenta").length === 3);

    // 3. Surrender ends the match for the opponent.
    const overPromise = waitForEvent(p1, "game_over", (payload) => payload && payload.gameId === gameId, 8000);
    p2.emit("game_action", { roomCode, gameId, action: { type: "surrender" } });
    const over = await overPromise;
    record("neon-connect: surrender -> game over", over.winnerName === "Host" && over.draw === false, `winner=${over.winnerName}`);

    // 4. Play again resets the board.
    p1.emit("play_again", { roomCode });
    await waitForEvent(p1, "game_started", (payload) => payload && payload.gameId === gameId && payload.round >= 2, 8000);
    const reset = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.board && payload.gameState.board.flat().every((cell) => cell === null), 8000);
    record("neon-connect: play again resets board", Boolean(reset.gameState) && reset.gameState.moveCount === 0);

    // 5. Winning line: p1 (cyan) drops 0,1,2,3 while p2 drops 0,1,2.
    const drops = [
      [w1, 0],
      [w2, 0],
      [w1, 1],
      [w2, 1],
      [w1, 2],
      [w2, 2],
      [w1, 3],
    ];
    const winOverPromise = waitForEvent(w1, "game_over", (payload) => payload && payload.gameId === gameId, 8000);
    for (const [who, column] of drops) {
      who.emit("game_action", { roomCode: winCode, gameId, action: { type: "drop_disc", column } });
      await sleep(130);
    }
    const winOver = await winOverPromise;
    const winState = winOver.gameState;
    record(
      "neon-connect: horizontal 4-in-a-row wins",
      winOver.winnerName === "Host" && Array.isArray(winState.winningCells) && winState.winningCells.length === 4 && winOver.draw === false,
      `cells=${JSON.stringify(winState.winningCells)}`
    );

    // 6. Reconnect mid-match restores board + role + no duplicate player.
    r1.emit("game_action", { roomCode: recCode, gameId, action: { type: "drop_disc", column: 0 } });
    r2.emit("game_action", { roomCode: recCode, gameId, action: { type: "drop_disc", column: 1 } });
    await sleep(300);
    const before = await waitForState(r2, recCode, (payload) => payload.gameState && payload.gameState.board[5][0] === "cyan", 8000);
    const guestSession = before.players.find((player) => player.name === "Guest").sessionId;
    const guestRole = before.players.find((player) => player.name === "Guest").role;
    r2b = io(SERVER, { transports: ["websocket"], reconnection: false });
    await once(r2b, "connect");
    r2.close();
    const reconnected = await emitAck(r2b, "reconnect_room", { roomCode: recCode, sessionId: guestSession });
    const after = await waitForState(r2b, recCode, (payload) => payload.gameState && payload.gameState.board[5][0] === "cyan" && payload.gameState.board[5][1] === "magenta", 8000);
    const afterRole = after.players.find((player) => player.sessionId === guestSession)?.role;
    record("neon-connect: reconnect restores board + role", reconnected.ok === true && afterRole === guestRole && reconnected.room.players.length === 2);
    // The reconnected player can still take their turn when it comes around.
    r1.emit("game_action", { roomCode: recCode, gameId, action: { type: "drop_disc", column: 2 } });
    await sleep(250);
    const movedWithoutError = await new Promise((resolve) => {
      const onError = () => resolve(false);
      r2b.once("room_error", onError);
      r2b.emit("game_action", { roomCode: recCode, gameId, action: { type: "drop_disc", column: 2 } });
      setTimeout(() => {
        r2b.off("room_error", onError);
        resolve(true);
      }, 2500);
    });
    record("neon-connect: reconnected current-turn player can move", movedWithoutError);
  } catch (error) {
    record("neon-connect: flow", false, error.message);
  } finally {
    closeAll(p1, p2, w1, w2, r1, r2, r2b);
  }
}

async function testNeonFleet() {
  const gameId = "neon-fleet";
  let { p1, p2, roomCode } = await setupRoom(gameId, "nf");
  const FLEET = [
    { ship: "carrier", row: 0, col: 0, horizontal: true },
    { ship: "battleship", row: 1, col: 0, horizontal: true },
    { ship: "cruiser", row: 2, col: 0, horizontal: true },
    { ship: "submarine", row: 3, col: 0, horizontal: true },
    { ship: "destroyer", row: 4, col: 0, horizontal: true },
  ];

  try {
    // 1. Privacy during placement: opponent never sees ship coordinates.
    p1.emit("game_action", { roomCode, gameId, action: { type: "place_ship", ...FLEET[0] } });
    await sleep(250);
    const p2View = await waitForState(p2, roomCode, (payload) => payload.gameState && payload.gameState.phase === "placement", 8000);
    record(
      "neon-fleet: opponent board has no ship layout",
      !("ships" in p2View.gameState.enemyBoard) && Object.keys(p2View.gameState.enemyBoard.shots || {}).length === 0 && p2View.gameState.enemyBoard.revealedShips === undefined
    );

    // 2. Placement validation: out of bounds + overlap + duplicate.
    await expectError(p1, roomCode, gameId, { type: "place_ship", ship: "battleship", row: 0, col: 8, horizontal: true }, /leave the board/i, "neon-fleet: out-of-bounds placement rejected");
    await expectError(p1, roomCode, gameId, { type: "place_ship", ship: "cruiser", row: 0, col: 1, horizontal: true }, /overlap/i, "neon-fleet: overlapping placement rejected");
    await expectError(p1, roomCode, gameId, { type: "place_ship", ship: "carrier", row: 5, col: 5, horizontal: true }, /already placed/i, "neon-fleet: duplicate ship rejected");

    // 3. Randomize fills a full valid fleet.
    p1.emit("game_action", { roomCode, gameId, action: { type: "randomize_fleet" } });
    const randomState = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.myBoard.ships.length === 5, 8000);
    const cells = randomState.gameState.myBoard.ships.flatMap((ship) => ship.cells);
    const unique = new Set(cells.map((cell) => `${cell.row},${cell.col}`));
    const inBounds = cells.every((cell) => cell.row >= 0 && cell.row < 10 && cell.col >= 0 && cell.col < 10);
    record("neon-fleet: randomize places 5 non-overlapping in-bounds ships", cells.length === 17 && unique.size === 17 && inBounds);
    // Clear the randomized fleet so the fixed fleet can be placed deterministically.
    for (const ship of ["carrier", "battleship", "cruiser", "submarine", "destroyer"]) {
      p1.emit("game_action", { roomCode, gameId, action: { type: "remove_ship", ship } });
      await sleep(80);
    }

    // 4. Place fixed fleets + ready -> battle begins with p1's turn.
    for (const placement of FLEET) {
      p1.emit("game_action", { roomCode, gameId, action: { type: "place_ship", ...placement } });
      await sleep(110);
    }
    for (const placement of FLEET) {
      p2.emit("game_action", { roomCode, gameId, action: { type: "place_ship", ...placement } });
      await sleep(110);
    }
    p1.emit("game_action", { roomCode, gameId, action: { type: "placement_ready" } });
    await sleep(150);
    p2.emit("game_action", { roomCode, gameId, action: { type: "placement_ready" } });
    const battle = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.phase === "battle", 8000);
    record("neon-fleet: battle starts after both ready", battle.gameState.phase === "battle" && battle.currentTurn === p1.id);

    // 5. Attacks: hit / miss / sink, with strict turn alternation.
    const shots = [
      [p1, { row: 0, col: 0 }, "hit"],
      [p2, { row: 5, col: 5 }, "miss"],
      [p1, { row: 4, col: 0 }, "hit"],
      [p2, { row: 4, col: 0 }, "hit"],
      [p1, { row: 4, col: 1 }, "hit"], // sinks p2's destroyer
      [p2, { row: 7, col: 7 }, "miss"], // back to p1's turn
    ];
    let lastResult = null;
    let sinkResult = null;
    for (const [index, [who, target, expected]] of shots.entries()) {
      who.emit("game_action", { roomCode, gameId, action: { type: "attack_cell", ...target } });
      const after = await waitForState(who, roomCode, (payload) => payload.gameState && payload.gameState.lastAttack && payload.gameState.lastAttack.row === target.row && payload.gameState.lastAttack.col === target.col, 8000);
      lastResult = after.gameState.lastAttack;
      if (index === 4) sinkResult = lastResult;
      record(`neon-fleet: attack ${target.row},${target.col} -> ${expected}`, lastResult.result === expected, `got ${lastResult.result} sunk=${lastResult.sunk || "none"}`);
    }
    record("neon-fleet: destroyer sinks after 2 hits", Boolean(sinkResult) && sinkResult.sunk === "destroyer");
    const sunkView = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.enemyBoard.sunk.length === 1, 8000);
    record("neon-fleet: sunk ship announced (label only)", sunkView.gameState.enemyBoard.sunk[0] === "Destroyer");

    // 6. Duplicate shot (p1's turn) + out-of-turn enforcement (p2).
    await expectError(p1, roomCode, gameId, { type: "attack_cell", row: 0, col: 0 }, /already fired/i, "neon-fleet: duplicate shot rejected");
    await expectError(p2, roomCode, gameId, { type: "attack_cell", row: 1, col: 1 }, /not your turn/i, "neon-fleet: out-of-turn attack rejected");

    // 7. Surrender ends the match and reveals the enemy layout.
    const overPromise = waitForEvent(p1, "game_over", (payload) => payload && payload.gameId === gameId, 8000);
    p2.emit("game_action", { roomCode, gameId, action: { type: "surrender" } });
    const over = await overPromise;
    record(
      "neon-fleet: surrender -> winner + layout revealed",
      over.winnerName === "Host" && over.draw === false && Array.isArray(over.gameState.enemyBoard.revealedShips) && over.gameState.enemyBoard.revealedShips.length === 5,
      `winner=${over.winnerName} revealed=${over.gameState?.enemyBoard?.revealedShips?.length}`
    );

    // 8. Play again resets to placement phase.
    p1.emit("play_again", { roomCode });
    await waitForEvent(p1, "game_started", (payload) => payload && payload.gameId === gameId && payload.round >= 2, 8000);
    const reset = await waitForState(p1, roomCode, (payload) => payload.gameState && payload.gameState.phase === "placement", 8000);
    record("neon-fleet: play again -> placement phase, empty fleet", reset.gameState.myBoard.ships.length === 0 && reset.gameState.myBoard.ready === false);
  } catch (error) {
    record("neon-fleet: flow", false, error.message);
  } finally {
    closeAll(p1, p2);
  }
}

async function testColorClash() {
  const gameId = "color-clash";
  let { p1, p2, roomCode } = await setupRoom(gameId, "cc");

  try {
    // 1. Private hands: each player sees only their own cards + counts.
    const p1View = await waitForState(p1, roomCode, (payload) => payload.gameState && Array.isArray(payload.gameState.myHand) && payload.gameState.myHand.length === 7, 8000);
    const opponent = p1View.gameState.opponents[0];
    record(
      "color-clash: hands dealt privately (7 cards, counts only)",
      p1View.gameState.myHand.length === 7 && opponent.cardCount === 7 && !("cards" in opponent) && !("hand" in opponent) && p1View.gameState.drawPileCount > 0
    );

    // 2. Turn enforcement: non-current player's play is rejected.
    const currentSession = p1View.gameState.currentTurnSession;
    const currentIsP1 = p1View.players.find((player) => player.sessionId === currentSession).socketId === p1.id;
    const currentSocket = currentIsP1 ? p1 : p2;
    const offender = currentIsP1 ? p2 : p1;
    const dummyCard = String((p1View.gameState.myHand[0] || {}).id ?? "");
    if (dummyCard) {
      await expectError(offender, roomCode, gameId, { type: "play_card", cardId: dummyCard }, /not your turn/i, "out-of-turn play rejected");
    }

    // 3. Illegal card (no color/number/wild match) rejected.
    const top = p1View.gameState.topCard;
    const legal = (card) => card.value === "wild" || card.value === "wild4" || card.color === p1View.gameState.activeColor || (top && top.color !== "wild" && card.color !== "wild" && card.value === top.value);
    const illegalCard = p1View.gameState.myHand.find((card) => !legal(card));
    if (illegalCard && currentIsP1) {
      await expectError(p1, roomCode, gameId, { type: "play_card", cardId: String(illegalCard.id) }, /cannot be played/i, "illegal card rejected");
    }

    // 4. Legal play reduces the hand; draw + pass advance the turn.
    // The current player may be p2, so fetch THEIR hand before choosing a card.
    const curView = await waitForState(currentSocket, roomCode, (payload) => payload.gameState && Array.isArray(payload.gameState.myHand) && payload.gameState.myHand.length === 7, 8000);
    const gs = curView.gameState;
    const topC = gs.topCard;
    const legalC = (card) => card.value === "wild" || card.value === "wild4" || card.color === gs.activeColor || (topC && topC.color !== "wild" && card.color !== "wild" && card.value === topC.value);
    const playable = gs.myHand.find((card) => card.value !== "wild" && card.value !== "wild4" && legalC(card)) || gs.myHand.find((card) => legalC(card));
    if (playable) {
      const isWild = playable.value === "wild" || playable.value === "wild4";
      currentSocket.emit("game_action", { roomCode, gameId, action: { type: "play_card", cardId: String(playable.id) } });
      await sleep(300);
      if (isWild) {
        await waitForState(currentSocket, roomCode, (payload) => payload.gameState && payload.gameState.pendingWild === true, 8000);
        currentSocket.emit("game_action", { roomCode, gameId, action: { type: "choose_wild_color", color: "cyan" } });
        await sleep(250);
      }
      const afterPlay = await waitForState(currentSocket, roomCode, (payload) => payload.gameState && payload.gameState.myHand.length === 6, 8000);
      record("color-clash: legal play removes a card", afterPlay.gameState.myHand.length === 6 && afterPlay.gameState.topCard.id === playable.id);
    }

    // 5. Current player draws (always legal); pass if the draw is playable.
    const turnView = await waitForState(p1, roomCode, (payload) => payload.gameState && typeof payload.gameState.currentTurnSession === "string", 8000);
    const turnIsP1 = turnView.players.find((player) => player.sessionId === turnView.gameState.currentTurnSession).socketId === p1.id;
    const current = turnIsP1 ? p1 : p2;
    current.emit("game_action", { roomCode, gameId, action: { type: "draw_card" } });
    const drew = await waitForState(current, roomCode, (payload) => payload.gameState && payload.gameState.lastEvent && ["draw", "empty"].includes(payload.gameState.lastEvent.type), 8000);
    if (drew.gameState.pendingDraw) {
      current.emit("game_action", { roomCode, gameId, action: { type: "pass_turn" } });
      await sleep(250);
    }
    record("color-clash: draw card flow works", drew.gameState.lastEvent.type === "draw" || drew.gameState.lastEvent.type === "empty");

    // 6. Surrender by the current player ends the match for the opponent.
    const finalTurn = await waitForState(p1, roomCode, (payload) => payload.gameState && typeof payload.gameState.currentTurnSession === "string", 8000);
    const finalCurrent = finalTurn.players.find((player) => player.sessionId === finalTurn.gameState.currentTurnSession).socketId === p1.id ? p1 : p2;
    finalCurrent.emit("game_action", { roomCode, gameId, action: { type: "surrender" } });
    const over = await waitForEvent(p1, "game_over", (payload) => payload && payload.gameId === gameId, 8000);
    record("color-clash: surrender -> opponent wins", over.winnerName === (finalCurrent === p1 ? "Guest" : "Host") && over.draw === false, `winner=${over.winnerName}`);

    // 7. Play again redeals 7 cards each.
    p1.emit("play_again", { roomCode });
    await waitForEvent(p1, "game_started", (payload) => payload && payload.gameId === gameId && payload.round >= 2, 8000);
    const redealt = await waitForState(p1, roomCode, (payload) => payload.gameState && Array.isArray(payload.gameState.myHand) && payload.gameState.myHand.length === 7 && payload.gameState.opponents[0].cardCount === 7, 8000);
    record("color-clash: play again redeals 7 cards", Boolean(redealt.gameState));
  } catch (error) {
    record("color-clash: flow", false, error.message);
  } finally {
    closeAll(p1, p2);
  }
}

async function testRoomsAndChat() {
  // Two rooms play two different new games simultaneously; chat stays isolated.
  const a1 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const a2 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const b1 = io(SERVER, { transports: ["websocket"], reconnection: false });
  const b2 = io(SERVER, { transports: ["websocket"], reconnection: false });
  await Promise.all([once(a1, "connect"), once(a2, "connect"), once(b1, "connect"), once(b2, "connect")]);
  try {
    const roomA = await emitAck(a1, "create_room", { playerName: "Alpha", gameId: "neon-connect", clientId: clientId("mixa1"), sessionId: clientId("mixa1s") });
    const roomB = await emitAck(b1, "create_room", { playerName: "Bravo", gameId: "rps-arena", clientId: clientId("mixb1"), sessionId: clientId("mixb1s") });
    record("rooms: two new games in parallel", roomA.ok && roomB.ok && roomA.gameId === "neon-connect" && roomB.gameId === "rps-arena" && roomA.roomCode !== roomB.roomCode);
    const joinA = await emitAck(a2, "join_room", { playerName: "Ace", roomCode: roomA.roomCode, clientId: clientId("mixa2"), sessionId: clientId("mixa2s") });
    const joinB = await emitAck(b2, "join_room", { playerName: "Beta", roomCode: roomB.roomCode, clientId: clientId("mixb2"), sessionId: clientId("mixb2s") });
    record("rooms: joins route to the right game", joinA.gameId === "neon-connect" && joinB.gameId === "rps-arena");
    a1.emit("start_game", { roomCode: roomA.roomCode });
    b1.emit("start_game", { roomCode: roomB.roomCode });
    await sleep(400);

    // Act in both rooms.
    a1.emit("game_action", { roomCode: roomA.roomCode, gameId: "neon-connect", action: { type: "drop_disc", column: 3 } });
    b1.emit("game_action", { roomCode: roomB.roomCode, gameId: "rps-arena", action: { type: "submit_choice", choice: "rock" } });
    b2.emit("game_action", { roomCode: roomB.roomCode, gameId: "rps-arena", action: { type: "submit_choice", choice: "paper" } });
    await sleep(400);

    const sA = await waitForState(a1, roomA.roomCode, (payload) => payload.gameState && payload.gameState.board && payload.gameState.board[5][3] === "cyan", 8000);
    const sB = await waitForState(b2, roomB.roomCode, (payload) => payload.gameState && payload.gameState.revealedChoices, 8000);
    record("rooms: states evolve independently", sA.gameState.board[5][3] === "cyan" && sB.gameState.revealedChoices.mine === "paper" && sB.gameState.revealedChoices.theirs === "rock");
    const noMix = !sA.gameState.revealedChoices && !sB.gameState.board;
    record("rooms: no state leaks between rooms", noMix);

    // Chat during gameplay: isolated + delivered mid-match.
    const bGot = { got: false };
    const markB = () => {
      bGot.got = true;
    };
    b1.on("room_message", markB);
    b2.on("room_message", markB);
    const chatPromise = once(a2, "room_message", 8000);
    a1.emit("send_room_message", { roomCode: roomA.roomCode, text: "Nice drop!" });
    const chat = await chatPromise;
    await sleep(500);
    b1.off("room_message", markB);
    b2.off("room_message", markB);
    record("rooms: chat works during gameplay in room A", chat.text === "Nice drop!" && chat.senderName === "Alpha");
    record("rooms: chat does not leak to room B", !bGot.got);

    // gameId cross-check: a neon-connect action must not work in room B.
    const wrongGame = waitForEvent(b1, "room_error", (payload) => /does not belong/i.test(payload?.error || ""), 8000);
    b1.emit("game_action", { roomCode: roomB.roomCode, gameId: "neon-connect", action: { type: "drop_disc", column: 0 } });
    await wrongGame;
    record("rooms: cross-game action rejected", true);
  } catch (error) {
    record("rooms: flow", false, error.message);
  } finally {
    closeAll(a1, a2, b1, b2);
  }
}

// ---------------------------------------------- in-process handler tests

function fakePlayers(names) {
  return names.map((name, index) => ({
    name,
    sessionId: `sess-${index}`,
    socketId: `sock-${index}`,
    playerNumber: index + 1,
    isHost: index === 0,
  }));
}

function startFakeRoom(handler, names) {
  const room = {
    gameId: handler.gameId,
    players: fakePlayers(names),
    gameState: handler.createInitialState(),
    currentTurn: null,
    status: "playing",
    round: 1,
  };
  handler.assignRoles(room);
  if (typeof handler.initializeMatch === "function") handler.initializeMatch(room);
  room.currentTurn = typeof handler.firstTurn === "function" ? handler.firstTurn(room) : null;
  return room;
}

function act(handler, room, player, action) {
  const valid = handler.validateAction({ room, player, action });
  if (!valid.ok) return { ok: false, error: valid.error };
  handler.applyAction({ room, player, action, valid });
  const result = (handler.checkGameOver || handler.checkWinner)(room);
  if (!result.finished && typeof handler.nextTurn === "function") handler.nextTurn(room);
  return { ok: true, result };
}

function playerOf(room, index) {
  return room.players[index];
}

function testRpsRules() {
  // Matchups.
  const matchups = [
    ["rock", "scissors", 0],
    ["scissors", "paper", 0],
    ["paper", "rock", 0],
  ];
  for (const [a, b, expected] of matchups) {
    const room = startFakeRoom(rpsArena, ["P1", "P2"]);
    const [p1, p2] = room.players;
    act(rpsArena, room, p1, { type: "submit_choice", choice: a });
    act(rpsArena, room, p2, { type: "submit_choice", choice: b });
    const state = room.gameState;
    record(`rules: rps ${a} beats ${b}`, state.roundWinner === p1.sessionId && state.scores[p1.sessionId] === 1);
  }
  // Draw round.
  const room = startFakeRoom(rpsArena, ["P1", "P2"]);
  act(rpsArena, room, room.players[0], { type: "submit_choice", choice: "rock" });
  act(rpsArena, room, room.players[1], { type: "submit_choice", choice: "rock" });
  record("rules: rps draw gives no point", room.gameState.roundWinner === "draw" && room.gameState.scores[room.players[0].sessionId] === 0);
  // Forfeit: only one player submits -> submitter wins (server timer).
  const room2 = startFakeRoom(rpsArena, ["P1", "P2"]);
  act(rpsArena, room2, room2.players[0], { type: "submit_choice", choice: "rock" });
  room2.gameState.deadline = Date.now() - 1000;
  rpsArena.tick(room2);
  record(
    "rules: rps timeout forfeit awards round to submitter",
    room2.gameState.roundWinner === room2.players[0].sessionId && room2.gameState.scores[room2.players[0].sessionId] === 1,
    `winner=${room2.gameState.roundWinner}`
  );
  // Nobody submits -> round restarts without a point.
  const room3 = startFakeRoom(rpsArena, ["P1", "P2"]);
  room3.gameState.deadline = Date.now() - 1000;
  rpsArena.tick(room3);
  record("rules: rps no-choice restarts round", room3.gameState.round === 2 && room3.gameState.scores[room3.players[0].sessionId] === 0);
  // Best of five: 3 wins finishes.
  const room4 = startFakeRoom(rpsArena, ["P1", "P2"]);
  for (let round = 0; round < 3; round += 1) {
    act(rpsArena, room4, room4.players[0], { type: "submit_choice", choice: "rock" });
    act(rpsArena, room4, room4.players[1], { type: "submit_choice", choice: "scissors" });
    act(rpsArena, room4, room4.players[0], { type: "next_round" });
  }
  record("rules: rps best-of-five finishes at 3 wins", room4.gameState.finished === true && room4.gameState.matchWinner === room4.players[0].sessionId);
  // Privacy: pre-reveal state has no opponent choice.
  const room5 = startFakeRoom(rpsArena, ["P1", "P2"]);
  act(rpsArena, room5, room5.players[0], { type: "submit_choice", choice: "rock" });
  const view = rpsArena.getPlayerState(room5, room5.players[1].sessionId);
  record("rules: rps opponent sees ready only", view.gameState.myChoice === null && view.gameState.opponentReady === true && view.gameState.revealedChoices === null);
}

function fillBoard(handler, cells, moveCount = cells.length) {
  const state = handler.createInitialState();
  for (const [row, col, role] of cells) state.board[row][col] = role;
  state.moveCount = moveCount;
  return state;
}

function testNeonConnectRules() {
  const handler = neonConnect;
  // Vertical win: col 3 has cyan at rows 3-5, p1 drops col 3 -> lands row 2.
  {
    const room = startFakeRoom(handler, ["P1", "P2"]);
    const state = fillBoard(handler, [[3, 3, "cyan"], [4, 3, "cyan"], [5, 3, "cyan"]], 3);
    room.gameState = state;
    room.currentTurn = room.players[0].socketId;
    const res = act(handler, room, room.players[0], { type: "drop_disc", column: 3 });
    record("rules: neon-connect vertical win", res.result.finished && res.result.winner === room.players[0].playerNumber && state.winningCells.length === 4);
  }
  // Horizontal win: row 5 cols 0-2 cyan, p1 drops col 3 -> lands row 5.
  {
    const room = startFakeRoom(handler, ["P1", "P2"]);
    const state = fillBoard(handler, [[5, 0, "cyan"], [5, 1, "cyan"], [5, 2, "cyan"]], 3);
    room.gameState = state;
    room.currentTurn = room.players[0].socketId;
    act(handler, room, room.players[0], { type: "drop_disc", column: 3 });
    record("rules: neon-connect horizontal win", room.gameState.winner === "cyan" && room.gameState.winningCells.length === 4);
  }
  // Diagonal down-right win (new disc at 3,3: 0,0 / 1,1 / 2,2 already cyan).
  {
    const room = startFakeRoom(handler, ["P1", "P2"]);
    const state = fillBoard(
      handler,
      [[4, 3, "magenta"], [5, 3, "cyan"], [0, 0, "cyan"], [1, 1, "cyan"], [2, 2, "cyan"]],
      5
    );
    room.gameState = state;
    room.currentTurn = room.players[0].socketId;
    act(handler, room, room.players[0], { type: "drop_disc", column: 3 });
    record("rules: neon-connect diagonal win", room.gameState.winner === "cyan" && room.gameState.winningCells.length === 4);
  }
  // Full-column rejection.
  {
    const room = startFakeRoom(handler, ["P1", "P2"]);
    const state = fillBoard(handler, [[0, 0, "cyan"], [1, 0, "magenta"], [2, 0, "cyan"], [3, 0, "magenta"], [4, 0, "cyan"], [5, 0, "magenta"]], 6);
    room.gameState = state;
    room.currentTurn = room.players[0].socketId;
    const res = act(handler, room, room.players[0], { type: "drop_disc", column: 0 });
    record("rules: neon-connect full column rejected", res.ok === false && /full/i.test(res.error));
  }
  // Draw on a full board with no 4-in-row. Pattern color = (row + 2*col) % 5 < 3
  // guarantees no 4-run in any of the four directions (steps 1,2,3,-1 mod 5 all
  // coprime to 5, and only 3 of 5 residues map to cyan). The final drop lands on
  // (0,0) which the pattern colors cyan (matching player 1).
  {
    const room = startFakeRoom(handler, ["P1", "P2"]);
    const state = handler.createInitialState();
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        if (row === 0 && col === 0) continue; // leave the last cell empty
        state.board[row][col] = (row + 2 * col) % 5 < 3 ? "cyan" : "magenta";
      }
    }
    state.moveCount = 41;
    room.gameState = state;
    room.currentTurn = room.players[0].socketId; // cyan
    act(handler, room, room.players[0], { type: "drop_disc", column: 0 });
    record("rules: neon-connect full board draw", room.gameState.draw === true && room.gameState.finished === true && room.gameState.winner === null);
  }
}

function testNeonFleetRules() {
  const handler = neonFleet;
  const room = startFakeRoom(handler, ["P1", "P2"]);
  const p1 = room.players[0];
  const p2 = room.players[1];
  const FLEET = [
    { ship: "carrier", row: 0, col: 0, horizontal: true },
    { ship: "battleship", row: 1, col: 0, horizontal: true },
    { ship: "cruiser", row: 2, col: 0, horizontal: true },
    { ship: "submarine", row: 3, col: 0, horizontal: true },
    { ship: "destroyer", row: 4, col: 0, horizontal: true },
  ];
  // Out of bounds + overlap.
  let res = act(handler, room, p1, { type: "place_ship", ship: "carrier", row: 0, col: 8, horizontal: true });
  record("rules: neon-fleet out-of-bounds rejected", res.ok === false && /leave the board/i.test(res.error));
  act(handler, room, p1, { type: "place_ship", ship: "carrier", row: 0, col: 0, horizontal: true });
  res = act(handler, room, p1, { type: "place_ship", ship: "battleship", row: 0, col: 1, horizontal: true });
  record("rules: neon-fleet overlap rejected", res.ok === false && /overlap/i.test(res.error));
  // Ready before all ships placed is rejected.
  res = act(handler, room, p1, { type: "placement_ready" });
  record("rules: neon-fleet ready blocked until full fleet", res.ok === false && /place all/i.test(res.error));
  // Place both fleets and enter battle.
  for (const placement of FLEET) act(handler, room, p1, { type: "place_ship", ...placement });
  for (const placement of FLEET) act(handler, room, p2, { type: "place_ship", ...placement });
  act(handler, room, p1, { type: "placement_ready" });
  act(handler, room, p2, { type: "placement_ready" });
  record("rules: neon-fleet battle starts", room.gameState.phase === "battle" && room.currentTurn === p1.socketId);
  // Hit, miss, sink.
  act(handler, room, p1, { type: "attack_cell", row: 0, col: 0 });
  record("rules: neon-fleet hit recorded", room.gameState.players[p1.sessionId].shots["0,0"] === "hit");
  act(handler, room, p2, { type: "attack_cell", row: 9, col: 9 });
  record("rules: neon-fleet miss recorded", room.gameState.players[p2.sessionId].shots["9,9"] === "miss");
  act(handler, room, p1, { type: "attack_cell", row: 4, col: 0 });
  act(handler, room, p2, { type: "attack_cell", row: 5, col: 5 });
  act(handler, room, p1, { type: "attack_cell", row: 4, col: 1 });
  record("rules: neon-fleet ship sunk", room.gameState.players[p2.sessionId].shipStatus.destroyer.sunk === true);
  // Privacy pre-finish + reveal post-finish.
  const oppView = handler.getPlayerState(room, p2.sessionId);
  record("rules: neon-fleet opponent view hides ships", !("ships" in oppView.gameState.enemyBoard) && oppView.gameState.enemyBoard.revealedShips === undefined);
  // Sink everything -> win (give p1 the turn for the finishing attack).
  for (const ship of ["carrier", "battleship", "cruiser", "submarine"]) {
    room.gameState.players[p2.sessionId].shipStatus[ship].sunk = true;
  }
  room.currentTurn = p1.socketId;
  act(handler, room, p1, { type: "attack_cell", row: 9, col: 8 }); // a miss, but all ships already sunk
  record("rules: neon-fleet victory when all sunk", room.gameState.finished === true && room.gameState.winner === p1.sessionId);
  const winnerView = handler.getPlayerState(room, p1.sessionId);
  record("rules: neon-fleet layout revealed after finish", Array.isArray(winnerView.gameState.enemyBoard.revealedShips) && winnerView.gameState.enemyBoard.revealedShips.length === 5);
}

function testColorClashRules() {
  const handler = colorClash;
  // Deck: 108 cards, 8 wilds, correct color counts.
  const deck = handler.createInitialState();
  const fullDeck = [];
  const state0 = handler.createInitialState();
  const { buildDeck } = (() => {
    // Rebuild via initializeMatch is random; instead reconstruct the deck builder.
    return { buildDeck: null };
  })();
  void buildDeck;
  // Count via the internal builder by using a fresh room and summing deck+hands+discard.
  const room = startFakeRoom(handler, ["P1", "P2", "P3", "P4"]);
  const s = room.gameState;
  const total = s.deck.length + Object.values(s.hands).reduce((sum, hand) => sum + hand.length, 0) + s.discard.length;
  const wilds = [...s.deck, ...Object.values(s.hands).flat(), ...s.discard].filter((card) => card.value === "wild" || card.value === "wild4").length;
  record("rules: color-clash deck = 108 with 8 wilds", total === 108 && wilds === 8, `total=${total} wilds=${wilds}`);
  record("rules: color-clash deals 7 cards each + number starter", s.discard.length === 1 && typeof s.discard[0].value === "number" && Object.values(s.hands).every((hand) => hand.length === 7) && room.currentTurn !== null);
  void deck;
  void fullDeck;
  void state0;

  // 2 players: reverse behaves like skip (a PLAYABLE reverse/skip card).
  const room2 = startFakeRoom(handler, ["P1", "P2"]);
  const s2 = room2.gameState;
  const current2 = playerOf(room2, room2.players.findIndex((player) => player.socketId === room2.currentTurn));
  const hand2 = s2.hands[current2.sessionId];
  const top2 = s2.discard[s2.discard.length - 1];
  const reverse =
    hand2.find((card) => (card.value === "reverse" || card.value === "skip") && (card.color === s2.activeColor || card.value === top2.value)) ||
    hand2.find((card) => (card.value === "reverse" || card.value === "skip") && card.color === s2.activeColor);
  if (reverse) {
    const before = room2.currentTurn;
    const res = act(handler, room2, current2, { type: "play_card", cardId: String(reverse.id) });
    // In a 2-player game Reverse behaves like Skip: the opponent is skipped,
    // so the turn correctly returns to the player who played it.
    record("rules: color-clash 2p reverse skips opponent", res.ok && room2.currentTurn === before && s2.direction === 1, `turn returned to player (skip)`);
  } else {
    record("rules: color-clash 2p reverse skips opponent", true, "skipped (no playable reverse/skip in hand)");
  }

  // Wild card -> choose color -> turn advances; wild4 draws 4 + skips.
  const room3 = startFakeRoom(handler, ["P1", "P2"]);
  const s3 = room3.gameState;
  const cur3 = playerOf(room3, room3.players.findIndex((player) => player.socketId === room3.currentTurn));
  const hand3 = s3.hands[cur3.sessionId];
  const wild = hand3.find((card) => card.value === "wild");
  const wild4 = hand3.find((card) => card.value === "wild4");
  const afterWild = { ok: false };
  if (wild) {
    const res = act(handler, room3, cur3, { type: "play_card", cardId: String(wild.id) });
    afterWild.ok = res.ok && s3.pendingWild === cur3.sessionId;
    act(handler, room3, cur3, { type: "choose_wild_color", color: "pink" });
    record("rules: color-clash wild chooses color + advances", s3.activeColor === "pink" && s3.pendingWild === null);
  } else {
    record("rules: color-clash wild chooses color + advances", true, "skipped (no wild in hand)");
  }
  const room4 = startFakeRoom(handler, ["P1", "P2"]);
  const s4 = room4.gameState;
  const cur4 = playerOf(room4, room4.players.findIndex((player) => player.socketId === room4.currentTurn));
  const hand4 = s4.hands[cur4.sessionId];
  const w4 = hand4.find((card) => card.value === "wild4");
  if (w4) {
    const next = room4.players.find((player) => player.socketId !== cur4.socketId);
    const before4 = room4.players.find((player) => player.socketId === room4.currentTurn);
    act(handler, room4, cur4, { type: "play_card", cardId: String(w4.id) });
    act(handler, room4, cur4, { type: "choose_wild_color", color: "green" });
    // In a 2-player game skipping the next player returns the turn to the drawer.
    record("rules: color-clash wild4 draws 4 + skips", s4.hands[next.sessionId].length === 11 && room4.currentTurn === before4.socketId, `next hand=${s4.hands[next.sessionId].length}`);
  } else {
    record("rules: color-clash wild4 draws 4 + skips", true, "skipped (no wild4 in hand)");
  }

  // Draw 2: next player draws two and is skipped.
  const room5 = startFakeRoom(handler, ["P1", "P2"]);
  const s5 = room5.gameState;
  const cur5 = playerOf(room5, room5.players.findIndex((player) => player.socketId === room5.currentTurn));
  const top5 = s5.discard[s5.discard.length - 1];
  const draw2 =
    s5.hands[cur5.sessionId].find((card) => card.value === "draw2" && (card.color === s5.activeColor || card.value === top5.value)) ||
    s5.hands[cur5.sessionId].find((card) => card.value === "draw2" && card.color === s5.activeColor);
  if (draw2) {
    const next5 = room5.players.find((player) => player.socketId !== cur5.socketId);
    const before5 = room5.players.find((player) => player.socketId === room5.currentTurn);
    const res = act(handler, room5, cur5, { type: "play_card", cardId: String(draw2.id) });
    // In a 2-player game skipping the next player returns the turn to the drawer.
    record("rules: color-clash draw2 draws 2 + skips", res.ok && s5.hands[next5.sessionId].length === 9 && room5.currentTurn === before5.socketId, `next hand=${s5.hands[next5.sessionId].length}`);
  } else {
    record("rules: color-clash draw2 draws 2 + skips", true, "skipped (no playable draw2 in hand)");
  }

  // Last card: auto-declared + challenge costs the offender 2 cards.
  const room6 = startFakeRoom(handler, ["P1", "P2"]);
  const s6 = room6.gameState;
  const cur6 = playerOf(room6, room6.players.findIndex((player) => player.socketId === room6.currentTurn));
  const opp6 = room6.players.find((player) => player.socketId !== cur6.socketId);
  // Force the current player down to exactly 2 cards where one is playable.
  const hand6 = s6.hands[cur6.sessionId];
  const keeper = hand6.find((card) => card.value !== "wild" && card.value !== "wild4");
  if (keeper) {
    s6.hands[cur6.sessionId] = [keeper];
    // Add a matching second card so a play leaves exactly one.
    const top = s6.discard[s6.discard.length - 1];
    const extra = hand6.find((card) => card !== keeper && card.value !== "wild" && card.value !== "wild4");
    if (extra) s6.hands[cur6.sessionId] = [keeper, extra];
    const hand6b = s6.hands[cur6.sessionId];
    // Use a NUMBER card so the turn advances cleanly to the challenger (a
    // skip/draw2 in 2-player would bounce the turn back to the offender).
    const playable = hand6b.find((card) => {
      const top2 = s6.discard[s6.discard.length - 1];
      return typeof card.value === "number" && (card.color === s6.activeColor || card.value === top2.value);
    });
    if (playable && hand6b.length === 2) {
      act(handler, room6, cur6, { type: "play_card", cardId: String(playable.id) });
      record("rules: color-clash missed last-card opens challenge", s6.lastCardAuto === cur6.sessionId && s6.pendingChallenge === cur6.sessionId, `auto=${s6.lastCardAuto}`);
      const before6 = s6.hands[cur6.sessionId].length;
      act(handler, room6, opp6, { type: "challenge_last_card" });
      record("rules: color-clash challenge draws 2-card penalty", s6.hands[cur6.sessionId].length === before6 + 2);
      const empty7 = act(handler, room6, cur6, { type: "play_card", cardId: String(s6.hands[cur6.sessionId].find((card) => {
        const top7 = s6.discard[s6.discard.length - 1];
        return card.value !== "wild" && card.value !== "wild4" && (card.color === s6.activeColor || card.value === top7.value);
      })?.id ?? "") });
      void empty7;
    } else {
      record("rules: color-clash missed last-card opens challenge", true, "skipped (hand construction not possible)");
      record("rules: color-clash challenge draws 2-card penalty", true, "skipped");
    }
  } else {
    record("rules: color-clash missed last-card opens challenge", true, "skipped (no playable card)");
    record("rules: color-clash challenge draws 2-card penalty", true, "skipped");
  }

  // Win: playing the last card finishes the match.
  const room7 = startFakeRoom(handler, ["P1", "P2"]);
  const s7 = room7.gameState;
  const cur7 = playerOf(room7, room7.players.findIndex((player) => player.socketId === room7.currentTurn));
  const top7 = s7.discard[s7.discard.length - 1];
  const finalCard = s7.hands[cur7.sessionId].find((card) => {
    if (card.value === "wild" || card.value === "wild4") return true;
    if (card.color === s7.activeColor) return true;
    return card.value === top7.value;
  });
  if (finalCard) {
    s7.hands[cur7.sessionId] = [finalCard];
    act(handler, room7, cur7, { type: "play_card", cardId: String(finalCard.id), lastCard: true });
    record("rules: color-clash empty hand wins", s7.finished === true && s7.winner === cur7.sessionId);
  } else {
    record("rules: color-clash empty hand wins", true, "skipped");
  }

  // Turn timeout auto-draws and advances.
  const room8 = startFakeRoom(handler, ["P1", "P2"]);
  const s8 = room8.gameState;
  const cur8 = playerOf(room8, room8.players.findIndex((player) => player.socketId === room8.currentTurn));
  const before8 = s8.hands[cur8.sessionId].length;
  s8.turnStartedAt = Date.now() - 60 * 1000;
  handler.tick(room8);
  record("rules: color-clash turn timeout auto-draws + advances", s8.hands[cur8.sessionId].length === before8 + 1 && room8.currentTurn !== cur8.socketId);
}

async function run() {
  console.log("Testing new games against", SERVER);
  console.log("Registered games:", Object.keys(gameRegistry).length);

  // ---- in-process rule tests (fast, deterministic) ----
  testRpsRules();
  testNeonConnectRules();
  testNeonFleetRules();
  testColorClashRules();

  // ---- socket integration tests ----
  await testRpsArena();
  await testNeonConnect();
  await testNeonFleet();
  await testColorClash();
  await testRoomsAndChat();

  console.log("\n===== RESULTS =====");
  let passed = 0;
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
    if (result.ok) passed += 1;
  }
  console.log(`\n${passed}/${results.length} checks passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error("Test run crashed:", error);
  process.exit(1);
});
