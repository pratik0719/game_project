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

  // ------------------------------------------------------------------
  // Multiplayer integration. In a multiplayer room the server drives the
  // snakes; the browser only sends direction intents and renders the
  // shared state (own grid + opponent grid side by side).
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("snake", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "snake";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null; // { winner, draw }

  function onMpStatus(status) {
    if (status === "solo") {
      exitMultiplayer();
    }
  }

  function onMpRoom(room) {
    if (!room) {
      exitMultiplayer();
      return;
    }
    if (room.gameId !== MP_GAME) return; // multiplayer.js redirects
    if (room.status === "playing" && room.gameState) {
      enterMpMatch();
    } else {
      enterMpWaiting();
    }
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
      startLocalGame();
    }
  } else {
    startLocalGame();
  }

  function startLocalGame() {
    if (mpWaiting || mpPlaying) return;
    startGame();
  }

  // ---------- Single-player mode (unchanged behavior) ----------

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

  function startGame() {
    resetGame();
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

  function drawCell(x, y, color, cellW, cellH) {
    ctx.fillStyle = color;
    ctx.fillRect(x * cellW, y * cellH, cellW - 1, cellH - 1);
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
      drawCell(part.x, part.y, color, cellWidth, cellHeight);
    });

    drawCell(food.x, food.y, "#ff4d6d", cellWidth, cellHeight);
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

    if (mpPlaying) {
      if (mpSupport) mpSupport.sendAction({ type: "direction", direction: map[key] });
      return;
    }

    const candidate = map[key];
    if (candidate.x + direction.x === 0 && candidate.y + direction.y === 0) {
      return;
    }
    queuedDirection = candidate;
  }

  window.addEventListener("keydown", onKeyDown);

  // ---------- Multiplayer mode ----------

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    if (tickTimer) {
      window.clearInterval(tickTimer);
    }
    scoreEl.textContent = "-";
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
    renderMpWaitingBoard();
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    if (tickTimer) {
      window.clearInterval(tickTimer);
    }
    statusEl.textContent = "Race your snake against the opponent!";
    renderMpControls();
    renderMp();
  }

  function mpPlayerStates() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    return (state && state.playerStates) || {};
  }

  function renderMpWaitingBoard() {
    ctx.fillStyle = "#070b16";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "rgba(144, 166, 195, 0.6)";
    ctx.font = "16px Orbitron";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the host...", canvasWidth / 2, canvasHeight / 2);
    ctx.textAlign = "start";
  }

  function renderMp() {
    const playerStates = mpPlayerStates();
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const opponents = Object.keys(playerStates).filter((number) => Number(number) !== myNumber);

    ctx.fillStyle = "#070b16";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const halfWidth = canvasWidth / 2;
    const mpCellW = halfWidth / gridSize;
    const mpCellH = canvasHeight / gridSize;

    // My grid.
    drawMpGrid(0, halfWidth, myNumber, playerStates[myNumber], "#39ff14", "#9aff52", mpCellW, mpCellH, "You");
    // Opponent grid(s).
    opponents.forEach((number, index) => {
      const name = mpOpponentName(Number(number));
      drawMpGrid(halfWidth, canvasWidth, number, playerStates[number], "#38bdf8", "#7dd3fc", mpCellW, mpCellH, name);
    });
  }

  function drawMpGrid(offsetX, endX, playerNumber, playerState, color, headColor, cellW, cellH, label) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.fillRect(offsetX, 0, endX - offsetX, canvasHeight);
    ctx.strokeStyle = "rgba(70, 88, 122, 0.22)";
    for (let line = 0; line <= gridSize; line += 1) {
      ctx.beginPath();
      ctx.moveTo(offsetX + line * cellW, 0);
      ctx.lineTo(offsetX + line * cellW, canvasHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offsetX, line * cellH);
      ctx.lineTo(endX, line * cellH);
      ctx.stroke();
    }

    if (playerState) {
      playerState.snake.forEach((part, index) => {
        drawCell(part.x, part.y, index === 0 ? headColor : color, cellW, cellH);
      });
      drawCell(playerState.food.x, playerState.food.y, "#ff4d6d", cellW, cellH);
    }

    ctx.fillStyle = "#90a6c3";
    ctx.font = "11px Orbitron";
    ctx.textAlign = "center";
    const scoreText = playerState ? String(playerState.score) : "-";
    ctx.fillText(`${label}  ${scoreText}`, offsetX + (endX - offsetX) / 2, 14);
    ctx.textAlign = "start";
  }

  function mpOpponentName(playerNumber) {
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const player = players.find((entry) => entry.playerNumber === playerNumber);
    return player ? player.name : `Player ${playerNumber}`;
  }

  function renderMpControls() {
    controls.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);
    mpSupport?.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
    if (mpPlaying && mpResult) {
      const players = mpSupport ? mpSupport.getPlayers() : [];
      const winnerName = (pn) => {
        const player = players.find((entry) => entry.playerNumber === pn);
        return player ? player.name : `Player ${pn}`;
      };
      const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
      if (mpResult.draw) {
        statusEl.textContent = "Match over - it is a draw!";
      } else if (mpResult.winner === myNumber) {
        statusEl.textContent = "You win!";
      } else {
        statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
      }
    }
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    controls.innerHTML = "";
    startLocalGame();
  }
})();
