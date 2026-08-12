(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("flappy");
    config = response.flappy || response;
  } catch (error) {
    statusEl.textContent = `Could not load flappy config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load flappy config", "error");
    return;
  }

  const gravity = Number(config.gravity || 0.38);
  const pipeGap = Number(config.pipe_gap || 132);
  const pipeSpeed = Number(config.pipe_speed || 2.4);
  const birdColor = String(config.bird_color || "#38bdf8");

  root.innerHTML = `
    <div class="flappy-wrap">
      <canvas id="flappy-canvas" width="420" height="520"></canvas>
    </div>
  `;

  controls.innerHTML = `
    <div class="game-hud"><strong>Score:</strong> <span id="flappy-score">0</span> <strong>Best:</strong> <span id="flappy-best">0</span></div>
    <button class="btn btn-primary" id="flappy-start">Start</button>
    <button class="btn btn-outline" id="flappy-reset">Reset</button>
  `;

  const canvas = document.getElementById("flappy-canvas");
  const ctx = canvas.getContext("2d");
  const startBtn = document.getElementById("flappy-start");
  const resetBtn = document.getElementById("flappy-reset");
  const scoreEl = document.getElementById("flappy-score");
  const bestEl = document.getElementById("flappy-best");

  const pipeWidth = 66;
  const spawnInterval = 95;

  let best = Number(localStorage.getItem("arcade_best_flappy") || 0);
  bestEl.textContent = String(best);

  let bird;
  let pipes;
  let frames;
  let score;
  let running;
  let started;
  let rafId;

  // ------------------------------------------------------------------
  // Multiplayer integration. All players fly through the SAME server-
  // generated pipe field; the browser only sends "flap" intents and
  // renders the shared state (both birds drawn on the same canvas).
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("flappy", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "flappy";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

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
    if (mpPlaying) renderMp();
  }

  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    renderMp();
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
      resetState();
      render();
    }
  } else {
    resetState();
    render();
  }


  startBtn.addEventListener("click", () => {
    if (!running) {
      running = true;
      started = true;
      statusEl.textContent = "Tap canvas or press Space to flap.";
      loop();
    }
  });

  resetBtn.addEventListener("click", () => {
    stop();
    resetState();
    render();
    statusEl.textContent = "Reset complete. Press Start.";
  });

  canvas.addEventListener("click", flap);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      flap();
      if (!running && !mpPlaying) {
        running = true;
        started = true;
        loop();
      }
    }
  });

  function resetState() {
    bird = {
      x: 110,
      y: canvas.height / 2,
      vy: 0,
      radius: 14,
    };
    pipes = [];
    frames = 0;
    score = 0;
    running = false;
    started = false;
    scoreEl.textContent = "0";
  }

  function loop() {
    update();
    render();
    if (running) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function flap() {
    if (mpPlaying) {
      if (mpSupport && !mpResult) mpSupport.sendAction({ type: "flap" });
      return;
    }
    if (!started) {
      return;
    }
    bird.vy = -6.4;
  }

  function update() {
    frames += 1;

    bird.vy += gravity;
    bird.y += bird.vy;

    if (frames % spawnInterval === 0) {
      const minY = 90;
      const maxY = canvas.height - 90;
      const gapY = minY + Math.random() * (maxY - minY);
      pipes.push({
        x: canvas.width + 20,
        gapY,
        passed: false,
      });
    }

    pipes.forEach((pipe) => {
      pipe.x -= pipeSpeed;

      if (!pipe.passed && pipe.x + pipeWidth < bird.x) {
        pipe.passed = true;
        score += 1;
        scoreEl.textContent = String(score);
      }
    });

    pipes = pipes.filter((pipe) => pipe.x + pipeWidth > -30);

    if (bird.y - bird.radius < 0 || bird.y + bird.radius > canvas.height) {
      onGameOver();
      return;
    }

    for (const pipe of pipes) {
      const inX = bird.x + bird.radius > pipe.x && bird.x - bird.radius < pipe.x + pipeWidth;
      const hitTop = bird.y - bird.radius < pipe.gapY - pipeGap / 2;
      const hitBottom = bird.y + bird.radius > pipe.gapY + pipeGap / 2;
      if (inX && (hitTop || hitBottom)) {
        onGameOver();
        return;
      }
    }
  }

  function onGameOver() {
    stop();
    statusEl.textContent = `Crashed. Score: ${score}`;

    if (score > best) {
      best = score;
      localStorage.setItem("arcade_best_flappy", String(best));
      bestEl.textContent = String(best);
      window.ArcadeAPI.toast("New Flappy high score!", "success");
    }

    if (started) {
      started = false;
      window.ArcadeAPI.promptScoreSubmission(
        "flappy",
        score,
        `Best: ${best}`,
        { best, pipe_gap: pipeGap }
      );
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0d2446");
    gradient.addColorStop(1, "#081222");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    pipes.forEach((pipe) => {
      ctx.fillStyle = "#34d399";
      ctx.fillRect(pipe.x, 0, pipeWidth, pipe.gapY - pipeGap / 2);
      ctx.fillRect(pipe.x, pipe.gapY + pipeGap / 2, pipeWidth, canvas.height - (pipe.gapY + pipeGap / 2));
    });

    ctx.beginPath();
    ctx.fillStyle = birdColor;
    ctx.arc(bird.x, bird.y, bird.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#f8fbff";
    ctx.arc(bird.x + 5, bird.y - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0f1f34";
    ctx.font = "bold 24px Orbitron";
    ctx.fillText(String(score), 12, 32);
  }

  // ---------- Multiplayer mode ----------

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    stop();
    startBtn.hidden = true;
    resetBtn.hidden = true;
    scoreEl.textContent = "0";
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpWaitingCanvas();
    renderMpControls();
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    startBtn.hidden = true;
    resetBtn.hidden = true;
    statusEl.textContent = "Flap! First to crash loses.";
    renderMpControls();
    renderMp();
  }

  function renderMpWaitingCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0d2446";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(144, 166, 195, 0.6)";
    ctx.font = "16px Orbitron";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the host...", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "start";
  }

  function renderMp() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    if (!state) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0d2446");
    gradient.addColorStop(1, "#081222");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    (state.pipes || []).forEach((pipe) => {
      ctx.fillStyle = "#34d399";
      ctx.fillRect(pipe.x, 0, pipeWidth, pipe.gapY - pipeGap / 2);
      ctx.fillRect(pipe.x, pipe.gapY + pipeGap / 2, pipeWidth, canvas.height - (pipe.gapY + pipeGap / 2));
    });

    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const players = mpSupport ? mpSupport.getPlayers() : [];
    Object.keys(state.playerStates || {}).forEach((number) => {
      const entry = state.playerStates[number];
      const isMe = Number(number) === myNumber;
      const color = isMe ? birdColor : "#ff6b6b";
      drawMpBird(entry.bird, color);

      const player = players.find((entry2) => entry2.playerNumber === Number(number));
      const label = isMe ? "You" : player ? player.name : "Opponent";
      ctx.fillStyle = isMe ? birdColor : "#ff9aac";
      ctx.font = "bold 13px Orbitron";
      ctx.fillText(`${label} ${entry.score}`, 12, isMe ? 30 : 50);
    });

    if (mpResult) {
      const winnerName = (pn) => {
        const player = players.find((entry2) => entry2.playerNumber === pn);
        return player ? player.name : `Player ${pn}`;
      };
      if (mpResult.draw) statusEl.textContent = "Match over - it is a draw!";
      else if (mpResult.winner === myNumber) statusEl.textContent = "You win!";
      else statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
    }

    renderMpControls();
  }

  function drawMpBird(birdState, color) {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(birdState.x, birdState.y, birdState.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#f8fbff";
    ctx.arc(birdState.x + 5, birdState.y - 5, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderMpControls() {
    controls.querySelector(".mp-match-bar")?.remove();
    controls.querySelector(".mp-play-again")?.remove();
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
    startBtn.hidden = false;
    resetBtn.hidden = false;
    const bar = controls.querySelector(".mp-match-bar");
    if (bar) bar.remove();
    const again = controls.querySelector(".mp-play-again");
    if (again) again.remove();
    resetState();
    render();
  }
})();
