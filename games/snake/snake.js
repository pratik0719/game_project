(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("snake");
    config = response.snake || response;
  } catch (error) {
    statusEl.textContent = `Could not load snake config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load snake config", "error");
    return;
  }

  const gridSize = Number(config.grid_size || 20);
  const canvasWidth = Number(config.canvas_width || 420);
  const canvasHeight = Number(config.canvas_height || 420);
  const startLength = Number(config.start_length || 3);
  const speed = Number(config.speed || 3);
  const foodPoints = Number(config.food_points || 10);

  const cellWidth = canvasWidth / gridSize;
  const cellHeight = canvasHeight / gridSize;

  const hud = document.createElement("div");
  hud.className = "game-hud";
  hud.innerHTML = "<strong>Score:</strong> <span id='snake-score'>0</span>";

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.setAttribute("aria-label", "Snake game board");

  root.innerHTML = "";
  root.appendChild(hud);
  root.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("snake-score");

  let snake = [];
  let direction = { x: 1, y: 0 };
  let queuedDirection = { x: 1, y: 0 };
  let food = { x: 0, y: 0 };
  let score = 0;
  let isGameOver = false;
  let hasSubmitted = false;
  let tickTimer = null;

  function resetGame() {
    score = 0;
    hasSubmitted = false;
    isGameOver = false;
    direction = { x: 1, y: 0 };
    queuedDirection = { x: 1, y: 0 };

    const startX = Math.floor(gridSize / 2);
    const startY = Math.floor(gridSize / 2);
    snake = [];
    for (let i = 0; i < startLength; i += 1) {
      snake.push({ x: startX - i, y: startY });
    }

    placeFood();
    scoreEl.textContent = "0";
    statusEl.textContent = "Use arrow keys or WASD. Avoid walls and your tail.";

    if (tickTimer) {
      window.clearInterval(tickTimer);
    }
    tickTimer = window.setInterval(step, Math.max(60, Math.floor(1000 / speed)));

    controls.innerHTML = "<button class='btn btn-outline' id='snake-restart'>Restart</button>";
    const restartBtn = document.getElementById("snake-restart");
    restartBtn.addEventListener("click", () => {
      resetGame();
      render();
    });

    render();
  }

  function placeFood() {
    let attempts = 0;
    while (attempts < 300) {
      const candidate = {
        x: Math.floor(Math.random() * gridSize),
        y: Math.floor(Math.random() * gridSize),
      };
      const onSnake = snake.some((part) => part.x === candidate.x && part.y === candidate.y);
      if (!onSnake) {
        food = candidate;
        return;
      }
      attempts += 1;
    }
    food = { x: 0, y: 0 };
  }

  function drawCell(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth - 1, cellHeight - 1);
  }

  function render() {
    ctx.fillStyle = "#070b16";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.strokeStyle = "rgba(70, 88, 122, 0.22)";
    for (let line = 0; line <= gridSize; line += 1) {
      const x = line * cellWidth;
      const y = line * cellHeight;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    snake.forEach((part, index) => {
      const color = index === 0 ? "#9aff52" : "#39ff14";
      drawCell(part.x, part.y, color);
    });

    drawCell(food.x, food.y, "#ff4d6d");
  }

  function collides(position) {
    if (position.x < 0 || position.x >= gridSize || position.y < 0 || position.y >= gridSize) {
      return true;
    }
    return snake.some((part) => part.x === position.x && part.y === position.y);
  }

  function endRound() {
    if (isGameOver) {
      return;
    }

    isGameOver = true;
    if (tickTimer) {
      window.clearInterval(tickTimer);
    }

    statusEl.textContent = `Game over. Final score: ${score}`;

    if (!hasSubmitted) {
      hasSubmitted = true;
      window.ArcadeAPI.promptScoreSubmission(
        "snake",
        score,
        `Length: ${snake.length}`,
        { length: snake.length, speed }
      );
    }
  }

  function step() {
    if (isGameOver) {
      return;
    }

    direction = queuedDirection;
    const head = snake[0];
    const next = { x: head.x + direction.x, y: head.y + direction.y };

    if (collides(next)) {
      endRound();
      return;
    }

    snake.unshift(next);

    if (next.x === food.x && next.y === food.y) {
      score += foodPoints;
      scoreEl.textContent = String(score);
      placeFood();
    } else {
      snake.pop();
    }

    render();
  }

  function onKeyDown(event) {
    const key = event.key.toLowerCase();
    const map = {
      arrowup: { x: 0, y: -1 },
      w: { x: 0, y: -1 },
      arrowdown: { x: 0, y: 1 },
      s: { x: 0, y: 1 },
      arrowleft: { x: -1, y: 0 },
      a: { x: -1, y: 0 },
      arrowright: { x: 1, y: 0 },
      d: { x: 1, y: 0 },
    };

    if (!map[key]) {
      return;
    }

    event.preventDefault();
    const candidate = map[key];
    if (candidate.x + direction.x === 0 && candidate.y + direction.y === 0) {
      return;
    }
    queuedDirection = candidate;
  }

  window.addEventListener("keydown", onKeyDown);
  resetGame();
})();

