"use strict";

const { envelope } = require("./stateUtil");

const ROUNDS_TO_WIN = 3;
const CHOICE_SECONDS = 15;
const REVEAL_SECONDS = 4;

const CHOICES = ["rock", "paper", "scissors"];
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const CHOICE_LABELS = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

/**
 * Server-authoritative RPS Arena adapter (simultaneous hidden choice).
 *
 * Best-of-five duel. Both players choose in secret; the server stores each
 * choice privately and only reveals the round after BOTH have submitted
 * (or the 15s timer forces a forfeit). A 15s per-round timer is enforced on
 * the server tick; a 4s reveal window auto-advances to the next round.
 */
const rpsArenaHandler = {
  gameId: "rps-arena",
  mode: "simultaneous-hidden-choice",
  tickMs: 1000,
  roles: ["Fighter 1", "Fighter 2"],
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState() {
    return {
      round: 1,
      phase: "choosing", // choosing | revealed | finished
      choices: {}, // sessionId -> choice | null
      scores: {}, // sessionId -> points
      roundWinner: null, // sessionId | "draw"
      matchWinner: null, // sessionId
      deadline: Date.now() + CHOICE_SECONDS * 1000,
      revealUntil: null,
      lastEvent: null, // { type, sessionId?, text }
      finished: false,
      draw: false,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = this.roles[index] || `Player ${index + 1}`;
    });
  },

  firstTurn(room) {
    return null; // simultaneous - no turn order
  },

  initializeMatch(room) {
    const state = room.gameState;
    state.choices = {};
    state.scores = {};
    room.players.forEach((player) => {
      state.choices[player.sessionId] = null;
      state.scores[player.sessionId] = 0;
    });
  },

  opponent(room, player) {
    return room.players.find((entry) => entry.sessionId !== player.sessionId) || null;
  },

  nameFor(room, sessionId) {
    const player = room.players.find((entry) => entry.sessionId === sessionId);
    return player ? player.name : null;
  },

  resolveRound(room, state, forfeitSessionId) {
    const sessions = room.players.map((player) => player.sessionId);
    const [a, b] = sessions;
    const choiceA = state.choices[a];
    const choiceB = state.choices[b];

    let winner = null;
    if (choiceA && choiceB) {
      winner = choiceA === choiceB ? null : BEATS[choiceA] === choiceB ? a : b;
    } else if (forfeitSessionId) {
      // The player who submitted wins by forfeit (the timeout loses the round).
      winner = forfeitSessionId;
    }

    if (winner) {
      state.scores[winner] += 1;
      state.roundWinner = winner;
      state.lastEvent = {
        type: "round_win",
        text: `${this.nameFor(room, winner)} wins round ${state.round}.`,
      };
    } else {
      state.roundWinner = "draw";
      state.lastEvent = { type: "round_draw", text: `Round ${state.round} is a draw.` };
    }

    state.phase = "revealed";
    state.revealUntil = Date.now() + REVEAL_SECONDS * 1000;
    state.deadline = null;
  },

  startNextRound(state) {
    state.round += 1;
    state.phase = "choosing";
    state.roundWinner = null;
    state.revealUntil = null;
    state.deadline = Date.now() + CHOICE_SECONDS * 1000;
    for (const sessionId of Object.keys(state.choices)) {
      state.choices[sessionId] = null;
    }
  },

  validateAction({ room, player, action }) {
    const state = room.gameState;
    if (!state || state.finished) return { ok: false, error: "The match is already over." };
    const type = String(action?.type || "").trim().toLowerCase();

    if (type === "submit_choice") {
      if (state.phase !== "choosing") return { ok: false, error: "It is not time to choose." };
      if (state.choices[player.sessionId]) return { ok: false, error: "Your choice is already locked in." };
      const choice = String(action.choice || "").trim().toLowerCase();
      if (!CHOICES.includes(choice)) return { ok: false, error: "Invalid choice." };
      return { ok: true, choice };
    }
    if (type === "next_round") {
      if (state.phase !== "revealed") return { ok: false, error: "The round is still in progress." };
      return { ok: true };
    }
    if (type === "surrender") {
      return { ok: true };
    }
    return { ok: false, error: "Unknown action type for this game." };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    const type = String(action?.type || "").trim().toLowerCase();

    if (type === "submit_choice") {
      state.choices[player.sessionId] = valid.choice;
      state.lastEvent = { type: "choice", sessionId: player.sessionId };
      const opponent = this.opponent(room, player);
      if (opponent && state.choices[opponent.sessionId]) {
        this.resolveRound(room, state, null);
      }
      return;
    }
    if (type === "next_round") {
      const winner = Object.keys(state.scores).find((sessionId) => state.scores[sessionId] >= ROUNDS_TO_WIN);
      if (winner) {
        state.matchWinner = winner;
        state.phase = "finished";
        state.finished = true;
        state.lastEvent = { type: "match_win", text: `${this.nameFor(room, winner)} takes the match!` };
      } else {
        this.startNextRound(state);
      }
      return;
    }
    if (type === "surrender") {
      const opponent = this.opponent(room, player);
      if (opponent) {
        state.matchWinner = opponent.sessionId;
        state.phase = "finished";
        state.finished = true;
        state.lastEvent = { type: "surrender", text: `${player.name} surrendered.` };
      }
    }
  },

  tick(room) {
    const state = room.gameState;
    if (!state || state.finished) return;
    const now = Date.now();

    if (state.phase === "choosing" && state.deadline && now >= state.deadline) {
      const submitted = room.players.filter((player) => state.choices[player.sessionId]);
      if (submitted.length === 1) {
        // The player who chose wins the round by forfeit. Set the event AFTER
        // resolveRound so the forfeit message is not overwritten by round_win.
        this.resolveRound(room, state, submitted[0].sessionId);
        state.lastEvent = { type: "forfeit", text: `${this.nameFor(room, submitted[0].sessionId)} wins by timeout.` };
      } else if (submitted.length === 0) {
        state.lastEvent = { type: "restart", text: "Nobody chose - restarting the round." };
        this.startNextRound(state);
      } else {
        this.resolveRound(room, state, null);
      }
      return;
    }

    if (state.phase === "revealed" && state.revealUntil && now >= state.revealUntil) {
      const winner = Object.keys(state.scores).find((sessionId) => state.scores[sessionId] >= ROUNDS_TO_WIN);
      if (winner) {
        state.matchWinner = winner;
        state.phase = "finished";
        state.finished = true;
        state.lastEvent = { type: "match_win", text: `${this.nameFor(room, winner)} takes the match!` };
      } else {
        this.startNextRound(state);
      }
    }
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (!state) return { finished: false, winner: null, draw: false };
    if (state.matchWinner) {
      const winner = room.players.find((entry) => entry.sessionId === state.matchWinner);
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
    const me = room.players.find((entry) => entry.sessionId === sessionId) || null;
    const opponent = me ? this.opponent(room, me) : null;
    const revealed = state.phase === "revealed" || state.phase === "finished";
    const winnerPlayer = state.matchWinner
      ? room.players.find((entry) => entry.sessionId === state.matchWinner)
      : null;

    const gameState = {
      round: state.round,
      phase: state.phase,
      roundSeconds: CHOICE_SECONDS,
      myChoice: state.choices[sessionId] || null,
      // The opponent only knows that a choice was made - never which one.
      opponentReady: Boolean(opponent && state.choices[opponent.sessionId]),
      myScore: me ? state.scores[me.sessionId] || 0 : 0,
      opponentScore: opponent ? state.scores[opponent.sessionId] || 0 : 0,
      roundWinnerSession: revealed ? state.roundWinner : null,
      roundWinnerName: revealed && state.roundWinner !== "draw" ? this.nameFor(room, state.roundWinner) : null,
      matchWinnerSession: state.matchWinner,
      matchWinnerName: winnerPlayer ? winnerPlayer.name : null,
      // Both choices are only revealed together once the round resolves.
      revealedChoices:
        revealed && me && opponent
          ? {
              mine: state.choices[me.sessionId] || null,
              theirs: state.choices[opponent.sessionId] || null,
            }
          : null,
      choiceLabels: CHOICE_LABELS,
      deadline: state.deadline,
      revealUntil: state.revealUntil,
      lastEvent: state.lastEvent,
      finished: state.finished,
    };

    return envelope(room, sessionId, gameState, {
      winner: winnerPlayer ? winnerPlayer.playerNumber : null,
      draw: false,
    });
  },
};

module.exports = rpsArenaHandler;
