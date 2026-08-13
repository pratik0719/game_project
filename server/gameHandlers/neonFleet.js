"use strict";

const { envelope } = require("./stateUtil");

const GRID = 10;

const SHIPS = [
  { name: "carrier", size: 5, label: "Carrier" },
  { name: "battleship", size: 4, label: "Battleship" },
  { name: "cruiser", size: 3, label: "Cruiser" },
  { name: "submarine", size: 3, label: "Submarine" },
  { name: "destroyer", size: 2, label: "Destroyer" },
];
const SHIP_BY_NAME = Object.fromEntries(SHIPS.map((ship) => [ship.name, ship]));
const TOTAL_SHIP_CELLS = SHIPS.reduce((sum, ship) => sum + ship.size, 0);

const key = (row, col) => `${row},${col}`;

function buildCells(row, col, horizontal, size) {
  const cells = [];
  for (let step = 0; step < size; step += 1) {
    cells.push(horizontal ? { row, col: col + step } : { row: row + step, col });
  }
  return cells;
}

function cellsInBounds(cells) {
  return cells.every((cell) => cell.row >= 0 && cell.row < GRID && cell.col >= 0 && cell.col < GRID);
}

function overlaps(ships, cells) {
  const occupied = new Set();
  for (const ship of ships) {
    for (const cell of ship.cells) occupied.add(key(cell.row, cell.col));
  }
  return cells.some((cell) => occupied.has(key(cell.row, cell.col)));
}

/** Random but valid full-fleet layout; returns ship descriptors or null. */
function randomFleet() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const placed = [];
    let valid = true;
    for (const ship of SHIPS) {
      const horizontal = Math.random() < 0.5;
      const row = horizontal
        ? Math.floor(Math.random() * GRID)
        : Math.floor(Math.random() * (GRID - ship.size + 1));
      const col = horizontal
        ? Math.floor(Math.random() * (GRID - ship.size + 1))
        : Math.floor(Math.random() * GRID);
      const cells = buildCells(row, col, horizontal, ship.size);
      if (!cellsInBounds(cells) || overlaps(placed, cells)) {
        valid = false;
        break;
      }
      placed.push({ name: ship.name, size: ship.size, label: ship.label, row, col, horizontal, cells });
    }
    if (valid) return placed;
  }
  return null;
}

/**
 * Server-authoritative Neon Fleet adapter (turn-based, private boards).
 *
 * Phases: placement -> battle -> finished. Ship positions are stored
 * server-side and a personalized state is sent to every player, so an
 * opponent can never see unhit ship coordinates.
 */
const neonFleetHandler = {
  gameId: "neon-fleet",
  mode: "turn-based-private-board",
  roles: ["Admiral", "Captain"],
  minPlayers: 2,
  maxPlayers: 2,
  gridSize: GRID,
  ships: SHIPS,

  createInitialState() {
    return {
      phase: "placement",
      players: {},
      winner: null,
      draw: false,
      finished: false,
      lastAttack: null,
      lastEvent: null,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || `Player ${index + 1}`;
    });
  },

  firstTurn(room) {
    return null; // no turns during placement
  },

  initializeMatch(room) {
    const state = room.gameState;
    state.players = {};
    room.players.forEach((player) => {
      state.players[player.sessionId] = {
        ships: [],
        ready: false,
        shots: {},
        hits: {},
        shipStatus: Object.fromEntries(SHIPS.map((ship) => [ship.name, { sunk: false, hits: 0 }])),
      };
    });
  },

  opponent(room, player) {
    return room.players.find((entry) => entry.sessionId !== player.sessionId) || null;
  },

  playerState(room, sessionId) {
    return room.gameState.players[sessionId] || null;
  },

  validateAction({ room, player, action }) {
    const state = room.gameState;
    if (!state) return { ok: false, error: "The match has not started." };
    if (state.finished) return { ok: false, error: "The match is already over." };
    const type = String(action?.type || "").trim().toLowerCase();
    const playerState = this.playerState(room, player.sessionId);

    if (type === "place_ship") {
      if (state.phase !== "placement") return { ok: false, error: "The battle has already started." };
      if (playerState.ready) return { ok: false, error: "You are already ready." };
      const ship = SHIP_BY_NAME[String(action.ship || "").trim().toLowerCase()];
      if (!ship) return { ok: false, error: "Unknown ship." };
      if (playerState.ships.some((placed) => placed.name === ship.name)) {
        return { ok: false, error: "That ship is already placed." };
      }
      const row = Number.parseInt(action.row, 10);
      const col = Number.parseInt(action.col, 10);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return { ok: false, error: "Invalid position." };
      const horizontal = Boolean(action.horizontal);
      const cells = buildCells(row, col, horizontal, ship.size);
      if (!cellsInBounds(cells)) return { ok: false, error: "Ship would leave the board." };
      if (overlaps(playerState.ships, cells)) return { ok: false, error: "Ships cannot overlap." };
      return { ok: true, ship, row, col, horizontal, cells };
    }

    if (type === "remove_ship") {
      const ship = SHIP_BY_NAME[String(action.ship || "").trim().toLowerCase()];
      if (!ship) return { ok: false, error: "Unknown ship." };
      if (!playerState.ships.some((placed) => placed.name === ship.name)) {
        return { ok: false, error: "That ship is not placed." };
      }
      return { ok: true, ship };
    }

    if (type === "randomize_fleet") {
      if (state.phase !== "placement") return { ok: false, error: "The battle has already started." };
      if (playerState.ready) return { ok: false, error: "You are already ready." };
      return { ok: true };
    }

    if (type === "placement_ready") {
      if (state.phase !== "placement") return { ok: false, error: "The battle has already started." };
      if (playerState.ships.length !== SHIPS.length) {
        return { ok: false, error: `Place all ${SHIPS.length} ships first.` };
      }
      return { ok: true };
    }

    if (type === "attack_cell") {
      if (state.phase !== "battle") return { ok: false, error: "The battle has not started." };
      if (room.currentTurn !== player.socketId) return { ok: false, error: "It is not your turn yet." };
      const row = Number.parseInt(action.row, 10);
      const col = Number.parseInt(action.col, 10);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GRID || col < 0 || col >= GRID) {
        return { ok: false, error: "Invalid target cell." };
      }
      if (playerState.shots[key(row, col)]) return { ok: false, error: "You already fired at that cell." };
      return { ok: true, row, col };
    }

    if (type === "surrender") {
      return { ok: true };
    }

    return { ok: false, error: "Unknown action type for this game." };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    const type = String(action?.type || "").trim().toLowerCase();
    const playerState = this.playerState(room, player.sessionId);

    if (type === "place_ship") {
      playerState.ships.push({
        name: valid.ship.name,
        size: valid.ship.size,
        label: valid.ship.label,
        row: valid.row,
        col: valid.col,
        horizontal: valid.horizontal,
        cells: valid.cells,
      });
      state.lastEvent = { type: "place", text: `${player.name} placed the ${valid.ship.label}.` };
      return;
    }
    if (type === "remove_ship") {
      playerState.ships = playerState.ships.filter((placed) => placed.name !== valid.ship.name);
      state.lastEvent = { type: "remove", text: `${player.name} removed a ship.` };
      return;
    }
    if (type === "randomize_fleet") {
      const fleet = randomFleet();
      if (fleet) playerState.ships = fleet;
      state.lastEvent = { type: "randomize", text: `${player.name} randomized their fleet.` };
      return;
    }
    if (type === "placement_ready") {
      playerState.ready = true;
      state.lastEvent = { type: "ready", text: `${player.name} is ready for battle.` };
      const everyoneReady = room.players.every((entry) => this.playerState(room, entry.sessionId)?.ready);
      if (everyoneReady) {
        state.phase = "battle";
        room.currentTurn = room.players[0]?.socketId || null;
        state.lastEvent = { type: "battle", text: "All fleets deployed - the battle begins!" };
      }
      return;
    }
    if (type === "attack_cell") {
      const opponent = this.opponent(room, player);
      if (!opponent) return;
      const opponentState = this.playerState(room, opponent.sessionId);
      const cellKey = key(valid.row, valid.col);
      let hit = false;
      let sunk = null;

      for (const ship of opponentState.ships) {
        if (ship.cells.some((cell) => cell.row === valid.row && cell.col === valid.col)) {
          hit = true;
          playerState.shots[cellKey] = "hit";
          opponentState.hits[cellKey] = "hit";
          const status = opponentState.shipStatus[ship.name];
          if (status) {
            status.hits += 1;
            if (status.hits >= ship.size && !status.sunk) {
              status.sunk = true;
              sunk = ship.name;
            }
          }
          break;
        }
      }

      if (!hit) {
        playerState.shots[cellKey] = "miss";
        opponentState.hits[cellKey] = "miss";
      }

      state.lastAttack = { row: valid.row, col: valid.col, result: hit ? "hit" : "miss", sunk };
      state.lastEvent = hit
        ? sunk
          ? { type: "sunk", text: `${player.name} destroyed the enemy ${SHIP_BY_NAME[sunk].label}!` }
          : { type: "hit", text: `${player.name} scored a hit!` }
        : { type: "miss", text: `${player.name} missed.` };

      const allSunk = SHIPS.every((ship) => opponentState.shipStatus[ship.name]?.sunk);
      if (allSunk) {
        state.winner = player.sessionId;
        state.finished = true;
        state.phase = "finished";
        state.lastEvent = { type: "victory", text: `${player.name} destroyed the entire enemy fleet!` };
      }
      return;
    }
    if (type === "surrender") {
      const opponent = this.opponent(room, player);
      if (opponent) {
        state.winner = opponent.sessionId;
        state.finished = true;
        state.phase = "finished";
        state.lastEvent = { type: "surrender", text: `${player.name} surrendered.` };
      }
    }
  },

  nextTurn(room) {
    const state = room.gameState;
    if (!state || state.phase !== "battle" || state.finished) return;
    // The action that opened the battle (second placement_ready) must not
    // immediately advance past player 1 - player 1 attacks first.
    const anyShot = room.players.some(
      (player) => this.playerState(room, player.sessionId)?.shots && Object.keys(this.playerState(room, player.sessionId).shots).length > 0
    );
    if (!anyShot) return;
    const currentIndex = room.players.findIndex((player) => player.socketId === room.currentTurn);
    if (currentIndex === -1) {
      room.currentTurn = room.players[0]?.socketId || null;
      return;
    }
    const next = room.players[(currentIndex + 1) % room.players.length];
    room.currentTurn = next ? next.socketId : room.currentTurn;
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (!state) return { finished: false, winner: null, draw: false };
    if (state.finished && state.winner) {
      const winner = room.players.find((entry) => entry.sessionId === state.winner);
      return { finished: true, winner: winner ? winner.playerNumber : null, draw: false };
    }
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },

  getPlayerState(room, sessionId) {
    const state = room.gameState;
    const me = this.playerState(room, sessionId);
    const opponent = room.players.find((entry) => entry.sessionId !== sessionId) || null;
    const opponentState = opponent ? this.playerState(room, opponent.sessionId) : null;
    const winnerPlayer = state.winner
      ? room.players.find((entry) => entry.sessionId === state.winner)
      : null;

    const myBoard = {
      ships: me ? me.ships : [],
      hits: me ? me.hits : {},
      shipStatus: me ? me.shipStatus : {},
      ready: me ? me.ready : false,
    };

    // Enemy board shows only shot results and sunk ship names - never the
    // coordinates of unhit ships. At the end of the match the full layout
    // is revealed so both players can review the battle.
    const enemyBoard = {
      shots: me ? me.shots : {},
      sunk: opponentState
        ? SHIPS.filter((ship) => opponentState.shipStatus[ship.name]?.sunk).map((ship) => ship.label)
        : [],
      ready: opponentState ? opponentState.ready : false,
    };
    if (state.phase === "finished" && opponentState) {
      enemyBoard.revealedShips = opponentState.ships;
    }

    const gameState = {
      phase: state.phase,
      gridSize: GRID,
      ships: SHIPS.map((ship) => ({ name: ship.name, label: ship.label, size: ship.size })),
      myBoard,
      enemyBoard,
      myReady: me ? me.ready : false,
      opponentReady: opponentState ? opponentState.ready : false,
      totalShips: SHIPS.length,
      lastAttack: state.lastAttack,
      lastEvent: state.lastEvent,
      winnerSession: state.winner,
      winnerName: winnerPlayer ? winnerPlayer.name : null,
      finished: state.finished,
    };

    return envelope(room, sessionId, gameState, {
      winner: winnerPlayer ? winnerPlayer.playerNumber : null,
      draw: false,
    });
  },
};

module.exports = neonFleetHandler;
