(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) return;

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("rps-arena");
    config = response.rps || response;
  } catch (error) {
    statusEl.textContent = `Could not load rps-arena config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load rps-arena config", "error");
    return;
  }

  const ROUNDS_TO_WIN = Math.max(1, Number(config.rounds_to_win || 3));
  const CHOICE_SECONDS = Math.max(5, Number(config.choice_seconds || 15));

  const CHOICES = [
    { id: "rock", label: "Rock", glyph: "✊" },
    { id: "paper", label: "Paper", glyph: "✋" },
    { id: "scissors", label: "Scissors", glyph: "✌️" },
  ];
  const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  const CHOICE_LABELS = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

  // ------------------------------------------------------------------
  // Multiplayer integration. In a room the server owns all choices and
  // sends personalized state (my choice + opponent ready only).
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("rps-arena", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "rps-arena";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

  // Shared render state (solo or multiplayer).
  let phase = "idle"; // idle | choosing | locked | revealed | finished
  let round = 1;
  let myScore = 0;
  let oppScore = 0;
  let myChoice = null;
  let oppChoice = null;
  let roundWinner = null; // "me" | "opponent" | "draw"
  let opponentName = "Computer";
  let deadline = 0;
  let timerId = null;

  // ---- Multiplayer callbacks ----
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
    if (mpPlaying) applyMpState(payload.gameState);
  }
  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    renderMpResult();
  }
  function onMpMatchEnded() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mpSupport ? mpSupport.getRoom() : null;
    if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    else enterMpWaiting();
  }

  function applyMpState(state) {
    if (!state) return;
    round = Number(state.round || 1);
    myScore = Number(state.myScore || 0);
    oppScore = Number(state.opponentScore || 0);
    myChoice = state.myChoice || null;
    oppChoice = state.revealedChoices ? state.revealedChoices.theirs || null : null;
    phase = state.phase === "choosing" ? (myChoice ? "locked" : "choosing") : state.phase;
    deadline = state.deadline || 0;
    roundWinner = state.roundWinnerName ? "opponent" : null;
    if (state.roundWinnerSession) {
      const players = mpSupport ? mpSupport.getPlayers() : [];
      const me = mpSupport ? mpSupport.me() : null;
      roundWinner = state.roundWinnerSession === "draw" ? "draw" : state.roundWinnerSession === (me ? me.sessionId : null) ? "me" : "opponent";
    }
    if (state.matchWinnerSession) phase = "finished";
    opponentName = mpOpponentName();
    render();
  }

  function mpOpponentName() {
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const me = mpSupport ? mpSupport.me() : null;
    const opponent = players.find((player) => player.socketId !== (me ? me.socketId : null));
    return opponent ? opponent.name : "Opponent";
  }

  // ---- Boot ----
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
      startSolo();
    }
  } else {
    startSolo();
  }

  // ---- Single-player mode (vs computer) ----
  let botPick = null;

  function startSolo() {
    resetSolo();
    statusEl.textContent = `First to ${ROUNDS_TO_WIN} wins. Choose your move!`;
    render();
  }

  function resetSolo() {
    phase = "choosing";
    round = 1;
    myScore = 0;
    oppScore = 0;
    myChoice = null;
    oppChoice = null;
    roundWinner = null;
    opponentName = "Computer";
    deadline = 0;
    stopTimer();
    render();
  }

  function soloPick(choice) {
    if (phase !== "choosing" || myChoice) return;
    myChoice = choice;
    phase = "locked";
    // The computer picks independently - it never sees the player's choice.
    botPick = CHOICES[Math.floor(Math.random() * CHOICES.length)].id;
    render();
    window.ArcadeSFX.play("move");
    window.setTimeout(resolveSoloRound, 700);
  }

  function resolveSoloRound() {
    let winner = null;
    if (myChoice === botPick) winner = "draw";
    else winner = BEATS[myChoice] === botPick ? "me" : "opponent";

    if (winner === "me") myScore += 1;
    if (winner === "opponent") oppScore += 1;
    oppChoice = botPick;
    roundWinner = winner;
    phase = "revealed";
    render();

    if (winner === "me") window.ArcadeSFX.play("win");
    else if (winner === "opponent") window.ArcadeSFX.play("lose");
    else window.ArcadeSFX.play("reveal");

    if (myScore >= ROUNDS_TO_WIN || oppScore >= ROUNDS_TO_WIN) {
      window.setTimeout(() => {
        phase = "finished";
        render();
        if (myScore >= ROUNDS_TO_WIN) window.ArcadeSFX.play("win");
      }, 1200);
    }
  }

  function soloNextRound() {
    round += 1;
    myChoice = null;
    oppChoice = null;
    roundWinner = null;
    phase = "choosing";
    render();
  }

  function soloRestart() {
    resetSolo();
  }

  // ---- Multiplayer waiting / match ----
  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    stopTimer();
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    controls.innerHTML = "";
    root.innerHTML = '<div class="rps-wrap"><p class="mp-muted">Waiting for the host to start the match...</p></div>';
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    statusEl.textContent = "First to three rounds wins. Choose in secret!";
    renderMpControls();
    render();
  }

  function sendChoice(choice) {
    if (!mpPlaying || phase !== "choosing" || myChoice) return;
    myChoice = choice;
    phase = "locked";
    render();
    window.ArcadeSFX.play("move");
    if (mpSupport) mpSupport.sendAction({ type: "submit_choice", choice });
  }

  function sendNextRound() {
    if (!mpPlaying) return;
    if (mpSupport) mpSupport.sendAction({ type: "next_round" });
  }

  async function sendSurrender() {
    if (!mpPlaying || mpResult) return;
    const ok = window.ArcadeUI ? await window.ArcadeUI.confirm("Surrender the match?", { okText: "Surrender", danger: true }) : true;
    if (!ok) return;
    if (mpSupport) mpSupport.sendAction({ type: "surrender" });
  }

  // ---- Rendering ----
  function stopTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimerTicks() {
    stopTimer();
    if (phase === "choosing" && deadline) {
      timerId = window.setInterval(() => {
        const left = Math.max(0, deadline - Date.now());
        const bar = document.querySelector(".rps-timer-bar > span");
        if (bar) bar.style.width = `${(left / (CHOICE_SECONDS * 1000)) * 100}%`;
        const label = document.querySelector(".rps-timer-label");
        if (label) label.textContent = `${Math.ceil(left / 1000)}s`;
      }, 250);
    }
  }

  function render() {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rps-wrap";

    if (phase === "idle") {
      wrap.innerHTML = '<p class="mp-muted">Preparing the arena...</p>';
      root.appendChild(wrap);
      return;
    }

    // Scoreboard.
    const scoreboard = document.createElement("div");
    scoreboard.className = "rps-scoreboard";
    scoreboard.innerHTML = `
      <div class="rps-score-card ${mpPlaying && mpSupport && mpSupport.me() && mpSupport.me().socketId === (mpSupport.getRoom()?.currentTurn) ? "" : ""}">
        <span class="rps-score-name">You</span>
        <strong class="rps-score-value">${myScore}</strong>
      </div>
      <div class="rps-round-pips">${Array.from({ length: ROUNDS_TO_WIN }, (_, i) => `<span class="rps-pip ${i < Math.max(myScore, oppScore) ? "lit" : ""}"></span>`).join("")}</div>
      <div class="rps-score-card">
        <span class="rps-score-name">${escapeHtml(opponentName)}</span>
        <strong class="rps-score-value">${oppScore}</strong>
      </div>
    `;
    wrap.appendChild(scoreboard);

    const meta = document.createElement("p");
    meta.className = "rps-meta";
    meta.textContent = `Round ${round} - first to ${ROUNDS_TO_WIN} wins`;
    wrap.appendChild(meta);

    // Timer.
    if (phase === "choosing") {
      const timer = document.createElement("div");
      timer.className = "rps-timer";
      timer.innerHTML = `<div class="rps-timer-bar"><span style="width:100%"></span></div><span class="rps-timer-label">${CHOICE_SECONDS}s</span>`;
      wrap.appendChild(timer);
    }

    // Choices.
    const choiceRow = document.createElement("div");
    choiceRow.className = "rps-choices";
    const disabled = phase !== "choosing" || Boolean(myChoice);
    CHOICES.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rps-choice";
      if (myChoice === choice.id) button.classList.add("picked");
      button.disabled = disabled;
      button.innerHTML = `<span class="rps-glyph">${choice.glyph}</span><span class="rps-choice-label">${choice.label}</span>`;
      button.addEventListener("click", () => {
        if (mpPlaying) sendChoice(choice.id);
        else soloPick(choice.id);
      });
      choiceRow.appendChild(button);
    });
    wrap.appendChild(choiceRow);

    if (myChoice && phase === "locked") {
      const locked = document.createElement("p");
      locked.className = "rps-locked";
      locked.innerHTML = `Choice locked <span class="rps-glyph">${glyphFor(myChoice)}</span>. Waiting for ${mpPlaying ? escapeHtml(opponentName) : "the computer"}...`;
      wrap.appendChild(locked);
    }

    // Reveal panel.
    if (phase === "revealed" || phase === "finished") {
      const reveal = document.createElement("div");
      reveal.className = "rps-reveal";
      const mine = myChoice || "?";
      const theirs = oppChoice || "?";
      const winnerText =
        roundWinner === "me"
          ? "You win the round!"
          : roundWinner === "opponent"
            ? `${mpPlaying ? escapeHtml(opponentName) : "The computer"} wins the round.`
            : "Round draw.";
      reveal.innerHTML = `
        <div class="rps-reveal-row">
          <div class="rps-reveal-side"><span class="rps-glyph">${glyphFor(mine)}</span><span>You</span></div>
          <div class="rps-vs">VS</div>
          <div class="rps-reveal-side"><span class="rps-glyph">${glyphFor(theirs)}</span><span>${escapeHtml(opponentName)}</span></div>
        </div>
        <p class="rps-reveal-text">${winnerText}</p>
      `;
      wrap.appendChild(reveal);
    }

    root.appendChild(wrap);
    renderControls();
    startTimerTicks();
  }

  function renderControls() {
    controls.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);

    if (mpWaiting) {
      return;
    }

    if (mpPlaying) {
      if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
      if (phase === "revealed" && !mpResult) {
        const nextBtn = document.createElement("button");
        nextBtn.className = "btn btn-primary";
        nextBtn.textContent = "Next Round";
        nextBtn.addEventListener("click", sendNextRound);
        controls.appendChild(nextBtn);
      }
      if (!mpResult) {
        const surrender = document.createElement("button");
        surrender.className = "btn btn-outline";
        surrender.textContent = "Surrender";
        surrender.addEventListener("click", sendSurrender);
        controls.appendChild(surrender);
      }
      return;
    }

    // Solo controls.
    if (phase === "revealed" && myScore < ROUNDS_TO_WIN && oppScore < ROUNDS_TO_WIN) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary";
      nextBtn.textContent = "Next Round";
      nextBtn.addEventListener("click", soloNextRound);
      controls.appendChild(nextBtn);
    }
    if (phase === "finished") {
      const again = document.createElement("button");
      again.className = "btn btn-primary";
      again.textContent = "Play Again";
      again.addEventListener("click", soloRestart);
      controls.appendChild(again);
    } else {
      const restart = document.createElement("button");
      restart.className = "btn btn-outline";
      restart.textContent = "Restart";
      restart.addEventListener("click", soloRestart);
      controls.appendChild(restart);
    }
  }

  function renderMpResult() {
    if (!mpPlaying) return;
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const winnerName = (pn) => {
      const player = players.find((entry) => entry.playerNumber === pn);
      return player ? player.name : `Player ${pn}`;
    };
    if (mpResult.draw) {
      statusEl.textContent = "Match over - it is a draw!";
    } else if (mpResult.winner === myNumber) {
      statusEl.textContent = "You win the match!";
    } else {
      statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
    }
    render();
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    stopTimer();
    startSolo();
  }

  function glyphFor(choice) {
    if (!choice || choice === "?") return "?";
    const found = CHOICES.find((entry) => entry.id === choice);
    return found ? found.glyph : "?";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
