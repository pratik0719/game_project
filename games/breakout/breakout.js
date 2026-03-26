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

  startState();
  draw();

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

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, x - paddle.width / 2));
  });

  function startState() {
    paddle = {
      width: paddleWidthDefault,
      height: 12,
      x: (canvas.width - paddleWidthDefault) / 2,
      y: canvas.height - 24,
      speed: 6,
    };

    ball = {
      x: canvas.width / 2,
      y: canvas.height - 40,
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
      paddle.x = Math.min(canvas.width - paddle.width, paddle.x + paddle.speed);
    }
    if (leftPressed) {
      paddle.x = Math.max(0, paddle.x - paddle.speed);
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.x - ball.r < 0 || ball.x + ball.r > canvas.width) {
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

    if (ball.y - ball.r > canvas.height) {
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
    ball.x = canvas.width / 2;
    ball.y = canvas.height - 40;
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, "#160824");
    background.addColorStop(1, "#090f1f");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  function createBricks(rCount, cCount) {
    const result = [];
    const brickWidth = (canvas.width - (cCount + 1) * brickPadding) / cCount;

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
