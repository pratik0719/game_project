(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("quiz");
    config = response.quiz || response;
  } catch (error) {
    statusEl.textContent = `Could not load quiz config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load quiz config", "error");
    return;
  }

  let questions = (config.questions || {}).question || [];
  if (!Array.isArray(questions)) {
    questions = [questions];
  }

  questions = questions
    .filter(Boolean)
    .map((item) => {
      let options = item.option || [];
      if (!Array.isArray(options)) {
        options = [options];
      }
      return {
        text: item.text || "Question",
        options,
        answer: Number(item.answer || 1),
      };
    });

  const timerPerQuestion = Number(config.timer_per_question || 15);
  const pointsPerCorrect = Number(config.points_per_correct || 10);

  // ------------------------------------------------------------------
  // Multiplayer integration. In a room every player answers the SAME
  // server-driven questions; the browser only sends answer intents and
  // renders the shared question index, scores and result.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("quiz", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "quiz";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;
  let mpRenderedIndex = -1;
  let mpLocalTimer = null;
  let mpRemaining = timerPerQuestion;

  let index = 0;
  let score = 0;
  let correctCount = 0;
  let remaining = timerPerQuestion;
  let timerId = null;
  let locked = false;

  function onMpStatus(status) {
    if (status === "solo") exitMultiplayer();
  }

  function onMpRoom(room) {
    if (!room) {
      exitMultiplayer();
      return;
    }
    if (room.gameId !== MP_GAME) return;
    if (room.status === "playing" && room.gameState) enterMpMatch();
    else enterMpWaiting();
  }

  function onMpMatchStart() {
    enterMpMatch();
  }

  function onMpState(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    if (payload.status && payload.status !== "playing") {
      enterMpWaiting();
      return;
    }
    if (!mpPlaying) enterMpMatch();
    if (mpPlaying) renderMpQuestion();
  }

  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    clearMpLocalTimer();
    renderMpResult();
  }

  function onMpMatchEnded() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mpSupport ? mpSupport.getRoom() : null;
    if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    else enterMpWaiting();
  }

  if (mpSupport) {
    const initialRoom = mpSupport.getRoom();
    if (urlRoomCode) {
      enterMpWaiting();
      window.setTimeout(() => {
        const room = mpSupport ? mpSupport.getRoom() : null;
        if (!room || room.gameId !== MP_GAME) exitMultiplayer();
      }, 6000);
    } else if (initialRoom && initialRoom.gameId === MP_GAME) {
      if (initialRoom.status === "playing" && initialRoom.gameState) enterMpMatch();
      else enterMpWaiting();
    } else {
      startQuiz();
    }
  } else {
    startQuiz();
  }

  function startQuiz() {
    index = 0;
    score = 0;
    correctCount = 0;
    statusEl.textContent = "Answer before the timer runs out.";
    renderQuestion();
    renderControls();
  }

  function renderControls() {
    controls.innerHTML = "";
    const restart = document.createElement("button");
    restart.className = "btn btn-outline";
    restart.textContent = "Restart Quiz";
    restart.addEventListener("click", () => {
      clearTimer();
      startQuiz();
    });
    controls.appendChild(restart);
  }

  function renderQuestion() {
    clearTimer();

    const question = questions[index];
    if (!question) {
      finishQuiz();
      return;
    }

    locked = false;
    remaining = timerPerQuestion;

    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "quiz-wrap";

    const progress = document.createElement("p");
    progress.textContent = `Question ${index + 1} / ${questions.length}`;

    const questionEl = document.createElement("h3");
    questionEl.className = "quiz-question";
    questionEl.textContent = question.text;

    const timerBar = document.createElement("div");
    timerBar.className = "timer-bar";
    timerBar.innerHTML = "<span></span>";

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "quiz-options";

    question.options.forEach((optionText, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      button.textContent = optionText;
      button.addEventListener("click", () => onAnswer(optionIndex + 1, button));
      optionsWrap.appendChild(button);
    });

    wrap.appendChild(progress);
    wrap.appendChild(questionEl);
    wrap.appendChild(timerBar);
    wrap.appendChild(optionsWrap);
    root.appendChild(wrap);

    statusEl.textContent = `Score: ${score}`;

    timerId = window.setInterval(() => {
      remaining -= 1;
      const pct = Math.max(0, (remaining / timerPerQuestion) * 100);
      const bar = timerBar.querySelector("span");
      if (bar) {
        bar.style.width = `${pct}%`;
      }
      if (remaining <= 0) {
        onAnswer(-1, null);
      }
    }, 1000);
  }

  function onAnswer(selected, selectedBtn) {
    if (locked) {
      return;
    }

    locked = true;
    clearTimer();

    const question = questions[index];
    const buttons = Array.from(root.querySelectorAll(".quiz-option"));
    buttons.forEach((btn) => {
      btn.disabled = true;
    });

    const isCorrect = selected === question.answer;
    if (isCorrect) {
      correctCount += 1;
      score += pointsPerCorrect + remaining;
      if (selectedBtn) {
        selectedBtn.classList.add("correct");
      }
      statusEl.textContent = `Correct. Score: ${score}`;
    } else {
      if (selectedBtn) {
        selectedBtn.classList.add("wrong");
      }
      const answerBtn = buttons[question.answer - 1];
      if (answerBtn) {
        answerBtn.classList.add("correct");
      }
      statusEl.textContent = `Wrong answer. Score: ${score}`;
    }

    window.setTimeout(() => {
      index += 1;
      renderQuestion();
    }, 900);
  }

  function clearTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function finishQuiz() {
    clearTimer();
    root.innerHTML = `
      <div class="quiz-wrap">
        <h3>Quiz Complete</h3>
        <p>You answered ${correctCount} / ${questions.length} correctly.</p>
        <p>Final score: ${score}</p>
      </div>
    `;

    statusEl.textContent = "Round finished.";

    window.ArcadeAPI.promptScoreSubmission(
      "quiz",
      score,
      `Correct: ${correctCount}/${questions.length}`,
      { correct: correctCount, total: questions.length }
    );
  }

  // ---------- Multiplayer mode ----------

  function mpQuizState() {
    return mpSupport ? mpSupport.getGameState() : null;
  }

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    clearMpLocalTimer();
    clearTimer();
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
    root.innerHTML = '<p class="mp-muted">Waiting for the host to start the match...</p>';
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    mpRenderedIndex = -1;
    clearTimer();
    renderMpControls();
    renderMpQuestion();
  }

  function renderMpQuestion() {
    const state = mpQuizState();
    if (!state) return;
    const question = state.questions[state.index];
    if (!question) {
      renderMpResult();
      return;
    }

    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const myEntry = state.playerStates ? state.playerStates[myNumber] : null;

    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "quiz-wrap";

    const progress = document.createElement("p");
    progress.textContent = `Question ${state.index + 1} / ${state.questions.length}`;

    const questionEl = document.createElement("h3");
    questionEl.className = "quiz-question";
    questionEl.textContent = question.text;

    const timerBar = document.createElement("div");
    timerBar.className = "timer-bar";
    timerBar.innerHTML = "<span></span>";

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "quiz-options";

    question.options.forEach((optionText, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      button.textContent = optionText;
      button.disabled = Boolean(myEntry && myEntry.answered) || Boolean(mpResult);
      button.addEventListener("click", () => {
        if (mpSupport) {
          // Stamp the question index so a stale answer can never be scored
          // against a newer question after the shared timer advanced.
          mpSupport.sendAction({ type: "answer", selected: optionIndex + 1, questionIndex: state.index });
        }
        button.classList.add(optionIndex + 1 === question.answer ? "correct" : "wrong");
      });
      optionsWrap.appendChild(button);
    });

    wrap.appendChild(progress);
    wrap.appendChild(questionEl);
    wrap.appendChild(timerBar);
    wrap.appendChild(optionsWrap);
    root.appendChild(wrap);

    // Opponent progress.
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const lines = players.map((player) => {
      const entry = state.playerStates ? state.playerStates[player.playerNumber] : null;
      const answered = entry ? entry.answered : false;
      const pScore = entry ? entry.score : 0;
      return `${player.name}${answered ? " ✓" : ""} - ${pScore}`;
    });
    statusEl.textContent = lines.join("  |  ");

    // Cosmetic local countdown; the server remains authoritative.
    if (state.index !== mpRenderedIndex) {
      mpRenderedIndex = state.index;
      startMpLocalTimer(timerBar);
    } else {
      const bar = timerBar.querySelector("span");
      if (bar) bar.style.width = `${Math.max(0, (mpRemaining / timerPerQuestion) * 100)}%`;
    }

    renderMpControls();
  }

  function startMpLocalTimer(timerBar) {
    clearMpLocalTimer();
    mpRemaining = timerPerQuestion;
    const bar = timerBar.querySelector("span");
    if (bar) bar.style.width = "100%";
    mpLocalTimer = window.setInterval(() => {
      mpRemaining -= 1;
      const pct = Math.max(0, (mpRemaining / timerPerQuestion) * 100);
      const span = timerBar.querySelector("span");
      if (span) span.style.width = `${pct}%`;
      if (mpRemaining <= 0) {
        clearMpLocalTimer();
      }
    }, 1000);
  }

  function clearMpLocalTimer() {
    if (mpLocalTimer) {
      window.clearInterval(mpLocalTimer);
      mpLocalTimer = null;
    }
  }

  function renderMpResult() {
    clearMpLocalTimer();
    const state = mpQuizState();
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const rows = players
      .map((player) => {
        const entry = state && state.playerStates ? state.playerStates[player.playerNumber] : null;
        return `<p><strong>${escapeHtml(player.name)}</strong> - ${entry ? entry.score : 0} pts (${entry ? entry.correctCount : 0} correct)</p>`;
      })
      .join("");

    const winnerName = (pn) => {
      const player = players.find((entry) => entry.playerNumber === pn);
      return player ? player.name : `Player ${pn}`;
    };
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    let headline = "Quiz Complete";
    if (mpResult) {
      if (mpResult.draw) headline = "Match over - it is a draw!";
      else if (mpResult.winner === myNumber) headline = "You win!";
      else headline = `${winnerName(mpResult.winner)} wins!`;
    }

    root.innerHTML = `<div class="quiz-wrap"><h3>${headline}</h3>${rows}</div>`;
    statusEl.textContent = "Round finished.";
    renderMpControls();
  }

  function renderMpControls() {
    controls.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);
    if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    clearMpLocalTimer();
    controls.innerHTML = "";
    startQuiz();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Start the local quiz only when we are not inside a multiplayer room.
  if (!mpWaiting && !mpPlaying) startQuiz();
})();

