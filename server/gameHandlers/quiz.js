"use strict";

const { loadXml } = require("./configLoader");

const config = loadXml("quiz");
const TIMER_PER_QUESTION = Math.max(5, Number(config.timer_per_question || 15));
const POINTS_PER_CORRECT = Number(config.points_per_correct || 10);
const MAX_QUESTIONS = 12;

let questions = (config.questions || {}).question || [];
if (!Array.isArray(questions)) questions = [questions];
questions = questions
  .filter(Boolean)
  .slice(0, MAX_QUESTIONS)
  .map((item) => {
    let options = item.option || [];
    if (!Array.isArray(options)) options = [options];
    return {
      text: String(item.text || "Question"),
      options: options.map(String),
      answer: Number(item.answer || 1),
    };
  });

if (questions.length === 0) {
  questions = [
    { text: "Which planet is known as the Red Planet?", options: ["Earth", "Mars", "Venus"], answer: 2 },
    { text: "What does CSS stand for?", options: ["Central Sheets", "Cascading Style Sheets", "Color Sheets"], answer: 2 },
  ];
}

/**
 * Server-authoritative Quiz adapter (simultaneous competitive).
 *
 * Every player answers the exact same questions at the same time. The
 * question only advances when every player has answered (or the shared
 * timer expires). The player with the highest final score wins.
 */
const quizHandler = {
  gameId: "quiz",
  mode: "simultaneous",
  tickMs: 1000,
  roles: ["Player 1", "Player 2"],

  createInitialState() {
    return {
      questions,
      index: 0,
      playerStates: {},
      questionStartedAt: null,
      finished: false,
      winner: null,
      draw: false,
    };
  },

  assignRoles(room) {
    room.players.forEach((player, index) => {
      player.role = `Player ${index + 1}`;
    });
  },

  firstTurn(room) {
    return null;
  },

  initializeMatch(room) {
    room.gameState.playerStates = {};
    room.players.forEach((player) => {
      room.gameState.playerStates[player.playerNumber] = {
        score: 0,
        correctCount: 0,
        answered: false,
        selected: null,
      };
    });
    room.gameState.questionStartedAt = Date.now();
  },

  validateAction({ room, player, action }) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (type !== "answer") return { ok: false, error: "Unknown action type for this game." };
    if (room.gameState.finished) return { ok: false, error: "The match is already over." };
    const selected = Number.parseInt(action.selected, 10);
    const question = room.gameState.questions[room.gameState.index];
    if (!question) return { ok: false, error: "The match is already over." };
    if (!Number.isInteger(selected) || selected < 1 || selected > question.options.length) {
      return { ok: false, error: "Invalid answer choice." };
    }
    // The client stamps the question it was answering; reject a stale
    // answer that raced with the shared question timer.
    if (Number.isInteger(action.questionIndex) && action.questionIndex !== room.gameState.index) {
      return { ok: false, error: "That question already ended." };
    }
    return { ok: true, selected };
  },

  applyAction({ room, player, action, valid }) {
    const state = room.gameState;
    if (state.finished) return;
    const playerState = state.playerStates[player.playerNumber];
    if (!playerState || playerState.answered) return;

    const question = state.questions[state.index];
    playerState.selected = valid.selected;
    playerState.answered = true;

    if (valid.selected === question.answer) {
      playerState.correctCount += 1;
      const elapsed = Math.floor((Date.now() - state.questionStartedAt) / 1000);
      const remaining = Math.max(0, TIMER_PER_QUESTION - elapsed);
      playerState.score += POINTS_PER_CORRECT + remaining;
    }

    if (Object.values(state.playerStates).every((entry) => entry.answered)) {
      this.advanceQuestion(room);
    }
  },

  tick(room) {
    const state = room.gameState;
    if (state.finished) return;
    const elapsed = (Date.now() - state.questionStartedAt) / 1000;
    if (elapsed < TIMER_PER_QUESTION) return;

    // Time is up: mark everyone who hasn't answered and advance.
    for (const playerState of Object.values(state.playerStates)) {
      if (!playerState.answered) {
        playerState.answered = true;
        playerState.selected = -1;
      }
    }
    this.advanceQuestion(room);
  },

  advanceQuestion(room) {
    const state = room.gameState;
    state.index += 1;

    if (state.index >= state.questions.length) {
      state.finished = true;
      let winner = null;
      let topScore = -1;
      let draw = false;
      for (const [playerNumber, playerState] of Object.entries(state.playerStates)) {
        if (playerState.score > topScore) {
          topScore = playerState.score;
          winner = Number(playerNumber);
          draw = false;
        } else if (playerState.score === topScore) {
          draw = true;
        }
      }
      state.winner = draw ? null : winner;
      state.draw = draw;
      return;
    }

    for (const playerState of Object.values(state.playerStates)) {
      playerState.answered = false;
      playerState.selected = null;
    }
    state.questionStartedAt = Date.now();
  },

  checkGameOver(room) {
    const state = room.gameState;
    if (state.finished) return { finished: true, winner: state.winner, draw: state.draw };
    return { finished: false, winner: null, draw: false };
  },

  resetState(room) {
    room.gameState = this.createInitialState();
    this.assignRoles(room);
    this.initializeMatch(room);
  },
};

module.exports = quizHandler;
