(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("breakout");
    config = response.breakout || response;
  } catch (error) {
    statusEl.textContent = `Could not load breakout config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load breakout config", "error");
    return;
  }

  const rows = Math.max(3, Math.min(8, Number(config.rows || 5)));
  const cols = Math.max(5, Math.min(12, Number(config.cols || 9)));
  const baseSpeed = Number(config.ball_speed || 4.2);
  const paddleWidthDefault = Number(config.paddle_width || 88);

  root.innerHTML = `
    <div class="breakout-wrap">
      <canvas id="breakout-canvas" width="560" height="420"></canvas>
    </div>
  `;

  controls.innerHTML = `
    <div class="game-hud"><strong>Score:</strong> <span id="breakout-score">0</span> <strong>Lives:</strong> <span id="breakout-lives">3</span> <strong>Level:</strong> <span id="breakout-level">1</span></div>
    <button class="btn btn-primary" id="breakout-start">Start</button>
    <button class="btn btn-outline" id="breakout-reset">Reset</button>
  `;

  const canvas = document.getElementById("breakout-canvas");
  const ctx = canvas.getContext("2d");

  // Logical game space stays fixed (physics untouched); only the backing
  // bitmap is re-backed at devicePixelRatio for crisp mobile rendering.
  const LOGICAL_W = canvas.width;
  const LOGICAL_H = canvas.height;
  let canvasDpr = 1;
  function applyCanvasDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr === canvasDpr) return;
    canvasDpr = dpr;
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  applyCanvasDpr();
  const scoreEl = document.getElementById("breakout-score");
  const livesEl = document.getElementById("breakout-lives");
  const levelEl = document.getElementById("breakout-level");
  const startBtn = document.getElementById("breakout-start");
  const resetBtn = document.getElementById("breakout-reset");

  const brickPadding = 6;
  const brickTop = 52;
  const brickHeight = 20;

  let paddle;
  let ball;
  let bricks;
  let lives;
  let level;
  let score;
  let running;
  let rafId;
  let rightPressed = false;
  let leftPressed = false;

  // ------------------------------------------------------------------
  // Multiplayer integration. Each player gets their own server-simulated
  // field; the browser reports the desired paddle position and renders
  // both fields from the shared state.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("breakout", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "breakout";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;
  let mpTargetX = LOGICAL_W / 2;
  let mpLastPaddleSend = 0;
  const OPPONENT_PALETTE = { paddle: "#f472b6", ball: "#fb7185" };

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
    startState();
    draw();
    statusEl.textContent = "Press Start to begin.";
  }
} else {
  startState();
  draw();
  statusEl.textContent = "Press Start to begin.";
}


  startBtn.addEventListener("click", () => {
    if (!running) {
      running = true;
      statusEl.textContent = "Break all bricks. Arrow keys or mouse to move.";
      loop();
    }
  });

  resetBtn.addEventListener("click", () => {
    stop();
    startState();
    draw();
    statusEl.textContent = "Game reset.";
  });

  window.addEventListener("keydown", (event) => {
    if (mpPlaying) {
      if (event.key === "ArrowRight") {
        mpTargetX = Math.min(LOGICAL_W, mpTargetX + 24);
        sendMpPaddle();
      }
      if (event.key === "ArrowLeft") {
        mpTargetX = Math.max(0, mpTargetX - 24);
        sendMpPaddle();
      }
      return;
    }
    if (event.key === "ArrowRight") {
      rightPressed = true;
    }
    if (event.key === "ArrowLeft") {
      leftPressed = true;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowRight") {
      rightPressed = false;
    }
    if (event.key === "ArrowLeft") {
      leftPressed = false;
    }
  });

  // Drag (or hover with a mouse) to move the paddle. Pointer events cover
  // touch drags; the game area is touch-action:none so the gesture never
  // scrolls the page.
  function paddleFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (mpPlaying) {
      mpTargetX = Math.max(0, Math.min(LOGICAL_W, x));
      sendMpPaddle();
      return;
    }
    paddle.x = Math.max(0, Math.min(LOGICAL_W - paddle.width, x - paddle.width / 2));
  }
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    paddleFromPointer(event);
  });
  canvas.addEventListener("pointermove", paddleFromPointer);

  // Optional hold-to-move paddle buttons (touch-friendly, also work in MP).
  let holdTimers = {};
  function startHold(dir) {
    if (mpPlaying) {
      holdTimers[dir] = window.setInterval(() => {
        mpTargetX = Math.max(0, Math.min(LOGICAL_W, mpTargetX + (dir === "right" ? 24 : -24)));
        sendMpPaddle();
      }, 60);
      return;
    }
    if (dir === "right") rightPressed = true;
    else leftPressed = true;
  }
  function stopHold(dir) {
    if (holdTimers[dir]) {
      window.clearInterval(holdTimers[dir]);
      delete holdTimers[dir];
    }
    if (dir === "right") rightPressed = false;
    else leftPressed = false;
  }
  function buildDirButtons() {
    const row = document.createElement("div");
    row.className = "arcade-dir-row";
    [
      ["left", "◀", "Move paddle left"],
      ["right", "▶", "Move paddle right"],
    ].forEach(([dir, glyph, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "arcade-dir-btn";
      btn.dataset.dir = dir;
      btn.setAttribute("aria-label", label);
      btn.textContent = glyph;
      btn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        startHold(dir);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
        btn.addEventListener(evt, () => stopHold(dir));
      });
      row.appendChild(btn);
    });
    return row;
  }
  function mountDirButtons() {
    if (controls.querySelector(".arcade-dir-row")) return;
    controls.appendChild(buildDirButtons());
  }
  mountDirButtons();

  function startState() {
    paddle = {
      width: paddleWidthDefault,
      height: 12,
      x: (LOGICAL_W - paddleWidthDefault) / 2,
      y: LOGICAL_H - 24,
      speed: 6,
    };

    ball = {
      x: LOGICAL_W / 2,
      y: LOGICAL_H - 40,
      r: 8,
      vx: baseSpeed,
      vy: -baseSpeed,
    };

    lives = 3;
    level = 1;
    score = 0;
    running = false;

    bricks = createBricks(rows, cols);
    updateHud();
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function loop() {
    update();
    draw();
    if (running) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function update() {
    if (rightPressed) {
      paddle.x = Math.min(LOGICAL_W - paddle.width, paddle.x + paddle.speed);
    }
    if (leftPressed) {
      paddle.x = Math.max(0, paddle.x - paddle.speed);
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.x - ball.r < 0 || ball.x + ball.r > LOGICAL_W) {
      ball.vx *= -1;
    }
    if (ball.y - ball.r < 0) {
      ball.vy *= -1;
    }

    if (
      ball.y + ball.r >= paddle.y &&
      ball.y + ball.r <= paddle.y + paddle.height + 3 &&
      ball.x >= paddle.x &&
      ball.x <= paddle.x + paddle.width
    ) {
      const hitPos = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
      ball.vx = hitPos * 6;
      ball.vy = -Math.abs(ball.vy);
    }

    if (ball.y - ball.r > LOGICAL_H) {
      lives -= 1;
      updateHud();
      if (lives <= 0) {
        gameOver();
        return;
      }
      resetBall();
    }

    handleBrickCollisions();

    if (bricks.every((brick) => brick.destroyed)) {
      level += 1;
      ball.vx *= 1.1;
      ball.vy *= 1.1;
      bricks = createBricks(rows, cols);
      resetBall();
      updateHud();
      window.ArcadeAPI.toast(`Level ${level}`, "success");
    }
  }

  function handleBrickCollisions() {
    for (const brick of bricks) {
      if (brick.destroyed) {
        continue;
      }

      if (
        ball.x + ball.r > brick.x &&
        ball.x - ball.r < brick.x + brick.w &&
        ball.y + ball.r > brick.y &&
        ball.y - ball.r < brick.y + brick.h
      ) {
        brick.destroyed = true;
        ball.vy *= -1;
        score += brick.points;
        updateHud();
        return;
      }
    }
  }

  function resetBall() {
    ball.x = LOGICAL_W / 2;
    ball.y = LOGICAL_H - 40;
    ball.vx = baseSpeed * (Math.random() < 0.5 ? -1 : 1);
    ball.vy = -Math.abs(baseSpeed + level * 0.15);
  }

  function gameOver() {
    stop();
    statusEl.textContent = `Game over. Final score: ${score}`;

    window.ArcadeAPI.promptScoreSubmission(
      "breakout",
      score,
      `Level reached: ${level}`,
      { level, lives: 0 }
    );
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
  }

  function draw() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    const background = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    background.addColorStop(0, "#160824");
    background.addColorStop(1, "#090f1f");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    drawBricks();

    ctx.fillStyle = "#6dd3ff";
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = "#f9a8d4";
    ctx.fill();
  }

  function drawBricks() {
    bricks.forEach((brick) => {
      if (brick.destroyed) {
        return;
      }
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.strokeRect(brick.x, brick.y, brick.w, brick.h);
    });
  }

  // ---------- Multiplayer mode ----------

  function sendMpPaddle() {
    const now = performance.now();
    if (now - mpLastPaddleSend < 50) return;
    mpLastPaddleSend = now;
    if (mpSupport && mpPlaying && !mpResult) {
      mpSupport.sendAction({ type: "paddle", x: mpTargetX });
    }
  }

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    stop();
    startBtn.hidden = true;
    resetBtn.hidden = true;
    scoreEl.textContent = "0";
    livesEl.textContent = "-";
    levelEl.textContent = "-";
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    drawMpWaiting();
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
    statusEl.textContent = "Break bricks and outlast the opponent!";
    renderMpControls();
    renderMp();
  }

  function drawMpWaiting() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.fillStyle = "#0a0f1f";
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.fillStyle = "rgba(144, 166, 195, 0.6)";
    ctx.font = "16px Orbitron";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the host...", LOGICAL_W / 2, LOGICAL_H / 2);
    ctx.textAlign = "start";
  }

  function renderMp() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    if (!state || !state.playerStates) return;

    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const halfWidth = LOGICAL_W / 2;
    const scale = halfWidth / LOGICAL_W;

    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    let index = 0;
    Object.keys(state.playerStates).forEach((number) => {
      const field = state.playerStates[number];
      const isMe = Number(number) === myNumber;
      const offsetX = index * halfWidth;
      const player = players.find((entry) => entry.playerNumber === Number(number));
      const label = isMe ? "You" : player ? player.name : "Opponent";
      drawMpField(field, offsetX, halfWidth, scale, isMe, label, isMe ? "#6dd3ff" : OPPONENT_PALETTE.paddle, isMe ? "#f9a8d4" : OPPONENT_PALETTE.ball);
      index += 1;
    });

    if (mpResult) {
      const winnerName = (pn) => {
        const player = players.find((entry) => entry.playerNumber === pn);
        return player ? player.name : `Player ${pn}`;
      };
      if (mpResult.draw) statusEl.textContent = "Match over - it is a draw!";
      else if (mpResult.winner === myNumber) statusEl.textContent = "You win!";
      else statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
    }

    renderMpControls();
  }

  function drawMpField(field, offsetX, width, scale, label, paddleColor, ballColor) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, 0, width, LOGICAL_H);
    ctx.clip();

    ctx.fillStyle = "#160824";
    ctx.fillRect(offsetX, 0, width, LOGICAL_H);

    (field.bricks || []).forEach((brick) => {
      if (brick.destroyed) return;
      ctx.fillStyle = brick.color;
      ctx.fillRect(offsetX + brick.x * scale, brick.y * scale, brick.w * scale, brick.h * scale);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.strokeRect(offsetX + brick.x * scale, brick.y * scale, brick.w * scale, brick.h * scale);
    });

    ctx.fillStyle = paddleColor;
    ctx.fillRect(offsetX + field.paddle.x * scale, field.paddle.y * scale, field.paddle.width * scale, field.paddle.height * scale);

    ctx.beginPath();
    ctx.arc(offsetX + field.ball.x * scale, field.ball.y * scale, field.ball.r * scale, 0, Math.PI * 2);
    ctx.fillStyle = ballColor;
    ctx.fill();

    ctx.fillStyle = "rgba(232, 242, 255, 0.85)";
    ctx.font = "bold 12px Orbitron";
    ctx.textAlign = "center";
    ctx.fillText(`${label}  ${field.score}`, offsetX + width / 2, 16);
    ctx.fillStyle = "#90a6c3";
    ctx.font = "10px Orbitron";
    ctx.fillText(`Lives: ${field.lives}  Level: ${field.level}`, offsetX + width / 2, 32);
    ctx.restore();
  }

  function renderMpControls() {
    controls.querySelector(".mp-match-bar")?.remove();
    controls.querySelector(".mp-play-again")?.remove();
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);
    if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
    mountDirButtons();
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
    startState();
    draw();
    statusEl.textContent = "Press Start to begin.";
  }

  function createBricks(rCount, cCount) {
    const result = [];
    const brickWidth = (LOGICAL_W - (cCount + 1) * brickPadding) / cCount;

    for (let r = 0; r < rCount; r += 1) {
      for (let c = 0; c < cCount; c += 1) {
        const x = brickPadding + c * (brickWidth + brickPadding);
        const y = brickTop + r * (brickHeight + brickPadding);
        result.push({
          x,
          y,
          w: brickWidth,
          h: brickHeight,
          points: (rCount - r) * 10,
          color: rowColor(r),
          destroyed: false,
        });
      }
    }

    return result;
  }

  function rowColor(row) {
    const palette = ["#f472b6", "#e879f9", "#c084fc", "#60a5fa", "#34d399", "#fb7185", "#fbbf24"];
    return palette[row % palette.length];
  }
})();
