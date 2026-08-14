(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) return;

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("neon-connect");
    config = response.connect || response;
  } catch (error) {
    statusEl.textContent = `Could not load neon-connect config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load neon-connect config", "error");
    return;
  }

  const COLS = Math.max(3, Number(config.columns || 7));
  const ROWS = Math.max(3, Number(config.rows || 6));
  const WIN_LENGTH = Math.max(3, Number(config.win_length || 4));
  const AI_DIFFICULTY = String(config.ai_difficulty || "medium").toLowerCase();

  const ROLES = { cyan: "#00e5ff", magenta: "#ff4d9d" };

  // ------------------------------------------------------------------
  // Multiplayer integration. The server owns the board; the browser only
  // sends { type: "drop_disc", column } intents.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("neon-connect", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "neon-connect";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

  let board = [];
  let myRole = null;
  let currentTurnRole = null;
  let winner = null;
  let draw = false;
  let winningCells = [];
  let lastDrop = null;
  let gameActive = false;
  let myWins = 0;
  let oppWins = 0;
  let soloDifficulty = AI_DIFFICULTY;

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
    if (mpPlaying) applyMpState(payload);
  }
  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    renderControls();
    updateMpResultText();
  }
  function onMpMatchEnded() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mpSupport ? mpSupport.getRoom() : null;
    if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    else enterMpWaiting();
  }

  function applyMpState(payload) {
    const state = payload.gameState;
    if (!state || !Array.isArray(state.board)) return;
    board = state.board.map((row) => [...row]);
    myRole = payload.players?.find((p) => p.sessionId === (mpSupport ? mpSupport.me()?.sessionId : null))?.role || mpSupport?.myRole || myRole;
    currentTurnRole = payload.currentTurnRole || null;
    winner = state.winner || null;
    draw = Boolean(state.draw);
    winningCells = Array.isArray(state.winningCells) ? state.winningCells : [];
    lastDrop = state.lastDrop || null;
    gameActive = !winner && !draw;
    render();
    // Rebuild the match bar on every state so the turn highlight tracks
    // the server's currentTurn (same pattern as every other game).
    renderControls();
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

  // ---- Single-player mode ----
  function startSolo() {
    resetSolo();
    statusEl.textContent = "Drop a disc - get four in a row to win!";
    renderControls();
    render();
  }

  function resetSolo() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    myRole = "cyan";
    winner = null;
    draw = false;
    winningCells = [];
    lastDrop = null;
    currentTurnRole = "cyan";
    gameActive = true;
  }

  function setSoloDifficulty(difficulty) {
    soloDifficulty = difficulty;
    startSolo();
  }

  function soloDrop(column) {
    if (!gameActive || currentTurnRole !== "cyan") return;
    const row = lowestEmptyRow(column);
    if (row === -1) {
      window.ArcadeSFX.play("invalid");
      return;
    }
    placeDisc(column, row, "cyan");
    if (gameActive) {
      currentTurnRole = "magenta";
      render();
      window.setTimeout(() => {
        const move = aiBestMove(board, "magenta", soloDifficulty);
        if (move === -1 || !gameActive) return;
        const aiRow = lowestEmptyRow(move);
        if (aiRow === -1) return;
        placeDisc(move, aiRow, "magenta");
        if (gameActive) {
          currentTurnRole = "cyan";
          render();
        }
      }, 60);
    }
  }

  function placeDisc(column, row, role) {
    board[row][column] = role;
    lastDrop = { row, column };
    window.ArcadeSFX.play("move");
    const cells = findWinningCells(board, row, column, role);
    if (cells.length >= WIN_LENGTH) {
      winner = role;
      winningCells = cells.slice(0, WIN_LENGTH);
      gameActive = false;
      if (role === "cyan") myWins += 1;
      else oppWins += 1;
      if (role === "cyan") window.ArcadeSFX.play("win");
      else window.ArcadeSFX.play("lose");
    } else if (isBoardFull(board)) {
      draw = true;
      gameActive = false;
      window.ArcadeSFX.play("reveal");
    }
    render();
    renderControls();
  }

  function lowestEmptyRow(column) {
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (!board[row][column]) return row;
    }
    return -1;
  }

  function isBoardFull(grid) {
    return grid.every((row) => row.every(Boolean));
  }

  function findWinningCells(grid, row, col, role) {
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dr, dc] of directions) {
      const cells = [[row, col]];
      for (const sign of [-1, 1]) {
        let r = row + dr * sign;
        let c = col + dc * sign;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === role) {
          cells.push([r, c]);
          r += dr * sign;
          c += dc * sign;
        }
      }
      if (cells.length >= WIN_LENGTH) return cells;
    }
    return [];
  }

  // ---- AI ----
  function aiBestMove(grid, role, difficulty) {
    const validColumns = [];
    for (let col = 0; col < COLS; col += 1) {
      if (!grid[0][col]) validColumns.push(col);
    }
    if (validColumns.length === 0) return -1;

    if (difficulty === "easy") {
      return validColumns[Math.floor(Math.random() * validColumns.length)];
    }

    const opponent = role === "cyan" ? "magenta" : "cyan";

    // Win immediately if possible.
    for (const col of validColumns) {
      const row = lowestEmptyRow(col);
      if (row === -1) continue;
      if (simulateWin(grid, row, col, role)) return col;
    }
    // Block opponent's immediate win.
    if (difficulty !== "easy") {
      for (const col of validColumns) {
        const row = lowestEmptyRow(col);
        if (row === -1) continue;
        if (simulateWin(grid, row, col, opponent)) return col;
      }
    }
    if (difficulty === "medium") {
      return validColumns[Math.floor(Math.random() * validColumns.length)];
    }

    // Hard: depth-limited minimax with alpha-beta.
    let bestScore = -Infinity;
    let bestCol = validColumns[0];
    for (const col of validColumns) {
      const row = lowestEmptyRow(col);
      if (row === -1) continue;
      const clone = cloneGrid(grid);
      clone[row][col] = role;
      const score = minimax(clone, 5, -Infinity, Infinity, false, role, opponent);
      if (score > bestScore) {
        bestScore = score;
        bestCol = col;
      }
    }
    return bestCol;
  }

  function simulateWin(grid, row, col, role) {
    return findWinningCells(grid, row, col, role).length >= WIN_LENGTH;
  }

  function cloneGrid(grid) {
    return grid.map((row) => [...row]);
  }

  function minimax(grid, depth, alpha, beta, maximizing, aiRole, humanRole) {
    const cols = [];
    for (let col = 0; col < COLS; col += 1) {
      if (!grid[0][col]) cols.push(col);
    }
    const winnerRole = terminalWinner(grid);
    if (winnerRole === aiRole) return 1000 + depth;
    if (winnerRole === humanRole) return -1000 - depth;
    if (cols.length === 0 || depth === 0) return evaluateBoard(grid, aiRole, humanRole);

    if (maximizing) {
      let best = -Infinity;
      for (const col of cols) {
        const row = lowestEmptyRowIn(grid, col);
        if (row === -1) continue;
        const clone = cloneGrid(grid);
        clone[row][col] = aiRole;
        best = Math.max(best, minimax(clone, depth - 1, alpha, beta, false, aiRole, humanRole));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const col of cols) {
      const row = lowestEmptyRowIn(grid, col);
      if (row === -1) continue;
      const clone = cloneGrid(grid);
      clone[row][col] = humanRole;
      best = Math.min(best, minimax(clone, depth - 1, alpha, beta, true, aiRole, humanRole));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  function lowestEmptyRowIn(grid, column) {
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (!grid[row][column]) return row;
    }
    return -1;
  }

  function terminalWinner(grid) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const role = grid[row][col];
        if (!role) continue;
        if (findWinningCells(grid, row, col, role).length >= WIN_LENGTH) return role;
      }
    }
    return null;
  }

  function evaluateBoard(grid, aiRole, humanRole) {
    let score = 0;
    // Score every window of WIN_LENGTH cells.
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, -1],
        ]) {
          const windowCells = [];
          for (let step = 0; step < WIN_LENGTH; step += 1) {
            const r = row + dr * step;
            const c = col + dc * step;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
            windowCells.push(grid[r][c]);
          }
          if (windowCells.length < WIN_LENGTH) continue;
          score += windowScore(windowCells, aiRole, humanRole);
        }
      }
    }
    return score;
  }

  function windowScore(cells, aiRole, humanRole) {
    const ai = cells.filter((c) => c === aiRole).length;
    const human = cells.filter((c) => c === humanRole).length;
    if (ai > 0 && human > 0) return 0;
    if (ai === 0 && human === 0) return 0;
    if (ai > 0) return [0, 1, 10, 100, 1000][ai] || 1000;
    return -([0, 1, 10, 100, 1000][human] || 1000);
  }

  // ---- Multiplayer ----
  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    root.innerHTML = '<div class="connect-wrap"><p class="mp-muted">Waiting for the host to start the match...</p></div>';
    controls.innerHTML = "";
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    myRole = mpSupport.myRole;
    // Render a blank board until the server's first game_state arrives -
    // render() reads board[row][col], so it needs a real grid to draw.
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    winner = null;
    draw = false;
    winningCells = [];
    lastDrop = null;
    currentTurnRole = "cyan";
    gameActive = true;
    statusEl.textContent = "Connect four before your opponent!";
    render();
    renderControls();
  }

  function sendDrop(column) {
    if (!mpPlaying || !gameActive) return;
    if (currentTurnRole !== myRole) {
      statusEl.textContent = "It is not your turn. Wait for the opponent.";
      window.ArcadeSFX.play("invalid");
      return;
    }
    window.ArcadeSFX.play("move");
    if (mpSupport) mpSupport.sendAction({ type: "drop_disc", column });
  }

  async function sendSurrender() {
    if (!mpPlaying || mpResult) return;
    const ok = window.ArcadeUI ? await window.ArcadeUI.confirm("Surrender the match?", { okText: "Surrender", danger: true }) : true;
    if (!ok) return;
    if (mpSupport) mpSupport.sendAction({ type: "surrender" });
  }

  // ---- Rendering ----
  function render() {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "connect-wrap";

    const scoreboard = document.createElement("div");
    scoreboard.className = "connect-scoreboard";
    const youLabel = mpPlaying ? "You" : "You";
    const oppLabel = mpPlaying ? escapeHtml(mpOpponentName()) : "Computer";
    scoreboard.innerHTML = `
      <div class="connect-score-card"><span>${youLabel}</span><strong>${myWins}</strong></div>
      <div class="connect-round"><span class="connect-round-label">WINS</span></div>
      <div class="connect-score-card"><span>${oppLabel}</span><strong>${oppWins}</strong></div>
    `;
    wrap.appendChild(scoreboard);

    const boardEl = document.createElement("div");
    boardEl.className = "connect-board";
    const playerColor = ROLES[currentTurnRole || "cyan"] || "#ffffff";
    boardEl.style.setProperty("--player-color", playerColor);

    for (let col = 0; col < COLS; col += 1) {
      const column = document.createElement("div");
      column.className = "connect-col";
      const isWinCol = winningCells.some(([r, c]) => c === col);
      if (isWinCol) column.classList.add("win-col");
      column.addEventListener("click", () => {
        if (mpPlaying) sendDrop(col);
        else soloDrop(col);
      });
      for (let row = 0; row < ROWS; row += 1) {
        const cell = document.createElement("div");
        cell.className = "connect-cell";
        const role = board[row][col];
        if (role) {
          const disc = document.createElement("span");
          disc.className = `connect-disc ${role}`;
          if (lastDrop && lastDrop.row === row && lastDrop.column === col) {
            disc.classList.add("falling");
            disc.style.setProperty("--fall-from", String(row));
          }
          if (winningCells.some(([r, c]) => r === row && c === col)) {
            disc.classList.add("win");
          }
          cell.appendChild(disc);
        }
        column.appendChild(cell);
      }
      boardEl.appendChild(column);
    }
    wrap.appendChild(boardEl);

    const turnText = document.createElement("p");
    turnText.className = "connect-turn";
    if (!gameActive) {
      turnText.textContent = winner
        ? `${winner === myRole ? "You" : (mpPlaying ? escapeHtml(mpOpponentName()) : "The computer")} win${winner === myRole || mpPlaying ? "" : "s"}!`
        : "It is a draw.";
      turnText.classList.add("final");
    } else {
      const isMine = currentTurnRole === myRole;
      turnText.textContent = mpPlaying
        ? isMine ? "Your turn - pick a column." : `${escapeHtml(mpOpponentName())} is thinking...`
        : currentTurnRole === "cyan" ? "Your turn - pick a column." : "Computer is thinking...";
    }
    wrap.appendChild(turnText);

    root.appendChild(wrap);
  }

  function renderControls() {
    controls.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);

    if (mpWaiting) return;

    if (mpPlaying) {
      if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
      if (!mpResult) {
        const surrender = document.createElement("button");
        surrender.className = "btn btn-outline";
        surrender.textContent = "Surrender";
        surrender.addEventListener("click", sendSurrender);
        controls.appendChild(surrender);
      }
      return;
    }

    // Solo: difficulty switch + restart.
    const modeWrap = document.createElement("div");
    modeWrap.className = "mode-switch";
    [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]].forEach(([id, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline";
      btn.textContent = label;
      if (soloDifficulty === id) btn.classList.add("active");
      btn.addEventListener("click", () => setSoloDifficulty(id));
      modeWrap.appendChild(btn);
    });
    controls.appendChild(modeWrap);

    const restart = document.createElement("button");
    restart.className = "btn btn-outline";
    restart.textContent = "Restart";
    restart.addEventListener("click", () => {
      resetSolo();
      render();
    });
    controls.appendChild(restart);
  }

  function updateMpResultText() {
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
      statusEl.textContent = "You win!";
      myWins += 1;
    } else {
      statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
      oppWins += 1;
    }
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    startSolo();
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
