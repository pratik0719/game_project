(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("tictactoe");
    config = response.tictactoe || response;
  } catch (error) {
    statusEl.textContent = `Could not load tic tac toe config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load tic tac toe config", "error");
    return;
  }

  const aiDefault = String(config.ai_default).toLowerCase() === "true";
  const aiDifficulty = String(config.ai_difficulty || "medium").toLowerCase();
  const winScore = Number(config.win_score || 100);
  const drawScore = Number(config.draw_score || 50);
  const lossScore = Number(config.loss_score || 15);

  let board = Array(9).fill("");
  let currentPlayer = "X";
  let gameActive = true;
  let mode = aiDefault ? "ai" : "pvp";

  const boardEl = document.createElement("div");
  boardEl.className = "ttt-board";
  root.innerHTML = "";
  root.appendChild(boardEl);

  renderControls();
  startRound();

  function renderControls() {
    controls.innerHTML = "";

    const modeWrap = document.createElement("div");
    modeWrap.className = "mode-switch";

    const aiBtn = document.createElement("button");
    aiBtn.className = "btn btn-outline";
    aiBtn.textContent = "Vs AI";
    aiBtn.addEventListener("click", () => {
      mode = "ai";
      highlightMode(modeWrap);
      startRound();
    });

    const pvpBtn = document.createElement("button");
    pvpBtn.className = "btn btn-outline";
    pvpBtn.textContent = "2 Player";
    pvpBtn.addEventListener("click", () => {
      mode = "pvp";
      highlightMode(modeWrap);
      startRound();
    });

    modeWrap.appendChild(aiBtn);
    modeWrap.appendChild(pvpBtn);

    const replayBtn = document.createElement("button");
    replayBtn.className = "btn btn-outline";
    replayBtn.textContent = "Replay";
    replayBtn.addEventListener("click", startRound);

    controls.appendChild(modeWrap);
    controls.appendChild(replayBtn);

    highlightMode(modeWrap);
  }

  function highlightMode(modeWrap) {
    const buttons = modeWrap.querySelectorAll("button");
    buttons.forEach((btn) => {
      const isAiButton = btn.textContent === "Vs AI";
      btn.classList.toggle("active", (mode === "ai" && isAiButton) || (mode === "pvp" && !isAiButton));
    });
  }

  function startRound() {
    board = Array(9).fill("");
    currentPlayer = "X";
    gameActive = true;
    statusEl.textContent = mode === "ai" ? "Your turn (X)." : "Player X turn.";
    renderBoard();
  }

  function renderBoard() {
    boardEl.innerHTML = "";

    board.forEach((cell, index) => {
      const button = document.createElement("button");
      button.className = "ttt-cell";
      button.type = "button";
      button.textContent = cell;
      button.disabled = !gameActive || Boolean(cell);
      button.addEventListener("click", () => onPlayerMove(index));
      boardEl.appendChild(button);
    });
  }

  function onPlayerMove(index) {
    if (!gameActive || board[index]) {
      return;
    }

    board[index] = currentPlayer;
    renderBoard();

    if (checkRoundEnd()) {
      return;
    }

    currentPlayer = currentPlayer === "X" ? "O" : "X";
    statusEl.textContent = mode === "ai" && currentPlayer === "O" ? "AI thinking..." : `Player ${currentPlayer} turn.`;

    if (mode === "ai" && currentPlayer === "O") {
      window.setTimeout(aiMove, 340);
    }
  }

  function aiMove() {
    if (!gameActive) {
      return;
    }

    const move = chooseAiMove(board, aiDifficulty);
    if (move === null) {
      return;
    }

    board[move] = "O";
    renderBoard();

    if (checkRoundEnd()) {
      return;
    }

    currentPlayer = "X";
    statusEl.textContent = "Your turn (X).";
  }

  function checkRoundEnd() {
    const winner = calculateWinner(board);
    if (winner) {
      gameActive = false;
      statusEl.textContent = winner === "X" ? "Player X wins." : "Player O wins.";
      submitResult(winner);
      renderBoard();
      return true;
    }

    if (board.every((cell) => cell)) {
      gameActive = false;
      statusEl.textContent = "It is a draw.";
      submitResult("draw");
      renderBoard();
      return true;
    }

    return false;
  }

  function submitResult(result) {
    let score;
    if (result === "draw") {
      score = drawScore;
    } else if (mode === "ai") {
      score = result === "X" ? winScore : lossScore;
    } else {
      score = winScore;
    }

    const summary = result === "draw" ? "Result: Draw" : `Winner: ${result}`;
    window.ArcadeAPI.promptScoreSubmission(
      "tictactoe",
      score,
      summary,
      { mode, result, difficulty: aiDifficulty }
    );
  }

  function calculateWinner(grid) {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const [a, b, c] of lines) {
      if (grid[a] && grid[a] === grid[b] && grid[a] === grid[c]) {
        return grid[a];
      }
    }
    return null;
  }

  function chooseAiMove(grid, difficulty) {
    const available = grid
      .map((cell, index) => (cell ? null : index))
      .filter((index) => index !== null);

    if (available.length === 0) {
      return null;
    }

    if (difficulty === "easy") {
      return randomPick(available);
    }

    if (difficulty === "medium" && Math.random() < 0.45) {
      return randomPick(available);
    }

    const winMove = findFinishingMove(grid, "O");
    if (winMove !== null) {
      return winMove;
    }

    const blockMove = findFinishingMove(grid, "X");
    if (blockMove !== null) {
      return blockMove;
    }

    if (!grid[4]) {
      return 4;
    }

    const corners = [0, 2, 6, 8].filter((index) => !grid[index]);
    if (corners.length > 0) {
      return randomPick(corners);
    }

    return randomPick(available);
  }

  function findFinishingMove(grid, player) {
    for (let i = 0; i < grid.length; i += 1) {
      if (grid[i]) {
        continue;
      }
      const clone = [...grid];
      clone[i] = player;
      if (calculateWinner(clone) === player) {
        return i;
      }
    }
    return null;
  }

  function randomPick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
})();

