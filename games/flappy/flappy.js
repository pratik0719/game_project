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

  resetState();
  render();

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
      if (!running) {
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
})();
