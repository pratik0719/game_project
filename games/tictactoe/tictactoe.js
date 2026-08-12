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

  // ------------------------------------------------------------------
  // Multiplayer integration. In a multiplayer room the board is
  // rendered exclusively from server-provided game_state; the browser
  // only sends move intents ({ type: "make_move", position }).
  // ------------------------------------------------------------------
  const mp = window.MultiplayerAPI || null;
  const MP_GAME = "tictactoe";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let myRole = null;

  if (mp) {
    mp.on("room", onMpRoom);
    mp.on("game_started", onMpGameStarted);
    mp.on("game_state", onMpGameState);
    mp.on("game_over", onMpGameOver);
    mp.on("match_ended", onMpMatchEnded);
    mp.on("player_left", onMpPlayerLeft);
  }

  const initialRoom = mp ? mp.getRoom() : null;
  if (urlRoomCode) {
    // Arriving via an invite link: never start a local game.
    enterWaiting();
    // If no room is actually joined shortly after (stale link or no name
    // set), fall back to the normal single-player game.
    window.setTimeout(() => {
      const room = mp ? mp.getRoom() : null;
      if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    }, 6000);
  } else if (initialRoom && initialRoom.gameId === MP_GAME) {
    if (initialRoom.status === "playing") {
      enterMatch(initialRoom);
    } else {
      enterWaiting();
    }
  } else {
    renderControls(false);
    startRound();
  }

  // ---------- Single-player mode (unchanged behavior) ----------

  function renderControls(multiplayer) {
    controls.innerHTML = "";

    if (multiplayer) {
      const bar = document.createElement("div");
      bar.className = "mp-match-bar";
      controls.appendChild(bar);

      const playAgain = document.createElement("button");
      playAgain.className = "btn btn-primary";
      playAgain.textContent = "Play Again";
      playAgain.hidden = !(mpPlaying && !gameActive);
      playAgain.addEventListener("click", () => {
        if (mp) mp.playAgain();
      });
      controls.appendChild(playAgain);

      renderMatchBar(bar);
      return;
    }

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

  // ---------- Multiplayer mode ----------

  function enterWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    myRole = null;
    gameActive = false;
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderControls(true);
    renderMpBoard(Array(9).fill(""));
  }

  function enterMatch(room) {
    if (!room) return;
    mpWaiting = false;
    mpPlaying = true;
    myRole =
      (room.players || []).find((player) => player.socketId === (mp ? mp.getSocketId() : null))?.role || null;
    applyMpState(room.gameState, room.currentTurn, room.players);
  }

  function applyMpState(gameState, currentTurn, players) {
    if (!gameState || gameState.winner === undefined) {
      enterWaiting();
      return;
    }
    board = Array.isArray(gameState.board) ? [...gameState.board] : Array(9).fill("");
    const winner = gameState.winner || null;
    const draw = Boolean(gameState.draw);
    gameActive = !winner && !draw;
    renderControls(true);
    renderMpBoard(board);
    updateMpStatus(winner, draw, players);
  }

  function renderMpBoard(cells) {
    boardEl.innerHTML = "";
    const canAct = mpPlaying && gameActive && Boolean(myRole) && Boolean(mp && mp.isMyTurn());
    cells.forEach((cell, index) => {
      const button = document.createElement("button");
      button.className = "ttt-cell";
      button.type = "button";
      button.textContent = cell;
      button.disabled = !canAct || Boolean(cell);
      button.addEventListener("click", () => onMpMove(index));
      boardEl.appendChild(button);
    });
  }

  function onMpMove(index) {
    if (!mpPlaying || !gameActive) return;
    if (board[index]) return;
    if (!myRole) return;
    if (!mp || !mp.isMyTurn()) {
      statusEl.textContent = "It is not your turn. Wait for the opponent.";
      return;
    }
    // Send only the intended action; the server applies it and broadcasts
    // the new shared board back to both players.
    mp.sendAction({ type: "make_move", position: index });
  }

  function updateMpStatus(winner, draw, players) {
    const list = players || (mp ? mp.getRoom()?.players : null) || [];
    const nameForRole = (role) => (list.find((player) => player.role === role)?.name || role);
    if (winner) {
      statusEl.textContent =
        winner === myRole ? "You win!" : `Match over - ${nameForRole(winner)} (${winner}) wins!`;
      return;
    }
    if (draw) {
      statusEl.textContent = "Match over - It is a draw.";
      return;
    }
    if (mp && mp.isMyTurn()) {
      statusEl.textContent = "Your turn.";
      return;
    }
    const opponent = list.find((player) => player.socketId !== (mp ? mp.getSocketId() : null));
    statusEl.textContent = opponent ? `${opponent.name} is thinking...` : "Waiting for the opponent...";
  }

  function renderMatchBar(bar) {
    bar.innerHTML = "";
    const room = mp ? mp.getRoom() : null;
    const players = (room && room.players) || [];
    const meSocket = mp ? mp.getSocketId() : null;

    players.forEach((player, index) => {
      if (index > 0) {
        const vs = document.createElement("span");
        vs.className = "mp-vs";
        vs.textContent = "VS";
        bar.appendChild(vs);
      }
      const chip = document.createElement("span");
      chip.className = "mp-player-chip";
      const isMe = player.socketId === meSocket;
      const isTurn = mpPlaying && Boolean(room) && room.currentTurn === player.socketId && gameActive;
      if (isTurn) chip.classList.add("turn");
      if (isMe) chip.classList.add("me");
      chip.textContent = `${isMe ? "You" : player.name} (${player.role || "?"})`;
      bar.appendChild(chip);
    });
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    myRole = null;
    renderControls(false);
    startRound();
  }

  function onMpRoom(room) {
    if (!room) {
      exitMultiplayer();
      return;
    }
    if (room.gameId !== MP_GAME) return; // a different room; multiplayer.js redirects
    if (room.status === "playing" && room.gameState) {
      enterMatch(room);
    } else {
      enterWaiting();
    }
  }

  function onMpGameStarted(room) {
    if (!room || room.gameId !== MP_GAME) return;
    enterMatch(room);
  }

  function onMpGameState(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    if (payload.status && payload.status !== "playing") {
      enterWaiting();
      return;
    }
    const players = Array.isArray(payload.players) ? payload.players : mp ? mp.getRoom()?.players : null;
    if (!mpPlaying) {
      enterMatch({
        gameId: MP_GAME,
        players,
        gameState: payload.gameState,
        currentTurn: payload.currentTurn,
      });
      return;
    }
    applyMpState(payload.gameState, payload.currentTurn, players);
  }

  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    const players = mp ? mp.getRoom()?.players : null;
    applyMpState(payload.gameState, payload.currentTurn || null, players);
  }

  function onMpMatchEnded(payload) {
    if (payload?.room && payload.room.gameId !== MP_GAME) return;
    enterWaiting();
  }

  function onMpPlayerLeft() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mp ? mp.getRoom() : null;
    if (room && room.gameId === MP_GAME) {
      enterWaiting();
      return;
    }
    exitMultiplayer();
  }
})();
