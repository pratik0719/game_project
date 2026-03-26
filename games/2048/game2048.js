(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("2048");
    config = response.game2048 || response["2048"] || response;
  } catch (error) {
    statusEl.textContent = `Could not load 2048 config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load 2048 config", "error");
    return;
  }

  const size = Math.max(4, Math.min(6, Number(config.grid_size || 4)));
  const winningTile = Number(config.winning_tile || 2048);

  root.innerHTML = "<div class='g2048-wrap'><div id='g2048-board' class='g2048-board'></div></div>";
  controls.innerHTML = `
    <div class="game-hud">
      <strong>Score:</strong> <span id="g2048-score">0</span>
      <strong>Best:</strong> <span id="g2048-best">0</span>
    </div>
    <button class="btn btn-outline" id="g2048-restart">Restart</button>
  `;

  const boardEl = document.getElementById("g2048-board");
  const scoreEl = document.getElementById("g2048-score");
  const bestEl = document.getElementById("g2048-best");
  const restartBtn = document.getElementById("g2048-restart");

  let board = [];
  let score = 0;
  let best = Number(localStorage.getItem("arcade_best_2048") || 0);
  let gameOver = false;
  let won = false;

  bestEl.textContent = String(best);

  restartBtn.addEventListener("click", start);
  window.addEventListener("keydown", onKeyDown);
  addSwipeSupport(root);

  start();

  function start() {
    board = Array.from({ length: size }, () => Array(size).fill(0));
    score = 0;
    gameOver = false;
    won = false;
    addRandomTile();
    addRandomTile();
    statusEl.textContent = "Use arrow keys or swipe to merge tiles.";
    render();
  }

  function render() {
    boardEl.innerHTML = "";
    board.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "g2048-row";
      row.forEach((value) => {
        const tile = document.createElement("div");
        tile.className = "g2048-tile";
        tile.dataset.value = String(value);
        tile.textContent = value === 0 ? "" : String(value);
        rowEl.appendChild(tile);
      });
      boardEl.appendChild(rowEl);
    });

    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
  }

  function onKeyDown(event) {
    if (gameOver) {
      return;
    }

    const map = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };

    const direction = map[event.key];
    if (!direction) {
      return;
    }

    event.preventDefault();
    attemptMove(direction);
  }

  function attemptMove(direction) {
    const before = JSON.stringify(board);
    const moved = move(direction);
    if (!moved) {
      return;
    }

    addRandomTile();
    render();

    if (score > best) {
      best = score;
      localStorage.setItem("arcade_best_2048", String(best));
      bestEl.textContent = String(best);
    }

    if (!won && board.flat().some((value) => value >= winningTile)) {
      won = true;
      statusEl.textContent = `You reached ${winningTile}! Keep going.`;
      window.ArcadeAPI.toast(`Nice! You hit ${winningTile}.`, "success");
    }

    if (!canMove()) {
      gameOver = true;
      statusEl.textContent = `Game over. Score: ${score}`;
      window.ArcadeAPI.promptScoreSubmission(
        "2048",
        score,
        `Best: ${best}`,
        { best, winning_tile: winningTile }
      );
    }

    if (before === JSON.stringify(board)) {
      return;
    }
  }

  function move(direction) {
    let moved = false;

    const iterate = {
      left: { outer: range(size), inner: range(size), get: (r, c) => [r, c], set: (r, c, value) => (board[r][c] = value) },
      right: { outer: range(size), inner: range(size - 1, -1, -1), get: (r, c) => [r, c], set: (r, c, value) => (board[r][c] = value) },
      up: { outer: range(size), inner: range(size), get: (c, r) => [r, c], set: (c, r, value) => (board[r][c] = value) },
      down: { outer: range(size), inner: range(size - 1, -1, -1), get: (c, r) => [r, c], set: (c, r, value) => (board[r][c] = value) },
    }[direction];

    iterate.outer.forEach((fixed) => {
      const line = [];
      iterate.inner.forEach((moving) => {
        const [r, c] = iterate.get(fixed, moving);
        const value = board[r][c];
        if (value !== 0) {
          line.push(value);
        }
      });

      const merged = [];
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === line[i + 1]) {
          const value = line[i] * 2;
          merged.push(value);
          score += value;
          i += 1;
        } else {
          merged.push(line[i]);
        }
      }

      while (merged.length < size) {
        merged.push(0);
      }

      iterate.inner.forEach((moving, index) => {
        const [r, c] = iterate.get(fixed, moving);
        if (board[r][c] !== merged[index]) {
          moved = true;
        }
        iterate.set(fixed, moving, merged[index]);
      });
    });

    return moved;
  }

  function canMove() {
    if (board.flat().some((value) => value === 0)) {
      return true;
    }

    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const value = board[r][c];
        const right = c + 1 < size ? board[r][c + 1] : null;
        const down = r + 1 < size ? board[r + 1][c] : null;
        if (value === right || value === down) {
          return true;
        }
      }
    }
    return false;
  }

  function addRandomTile() {
    const empties = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (board[r][c] === 0) {
          empties.push([r, c]);
        }
      }
    }

    if (empties.length === 0) {
      return;
    }

    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    board[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  function addSwipeSupport(container) {
    let startX = 0;
    let startY = 0;

    container.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    });

    container.addEventListener("touchend", (event) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        return;
      }

      if (Math.abs(dx) > Math.abs(dy)) {
        attemptMove(dx > 0 ? "right" : "left");
      } else {
        attemptMove(dy > 0 ? "down" : "up");
      }
    });
  }

  function range(start, end, step) {
    const result = [];
    if (end === undefined) {
      end = start;
      start = 0;
    }
    if (step === undefined) {
      step = start < end ? 1 : -1;
    }
    for (let value = start; step > 0 ? value < end : value > end; value += step) {
      result.push(value);
    }
    return result;
  }
})();
