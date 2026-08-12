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

  // ------------------------------------------------------------------
  // Multiplayer integration. Every board is server-authoritative; the
  // browser only sends move intents and renders own + opponent boards.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("2048", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "2048";
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
      start();
    }
  } else {
    start();
  }

  bestEl.textContent = String(best);

  restartBtn.addEventListener("click", start);
  window.addEventListener("keydown", onKeyDown);
  addSwipeSupport(root);

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
    if (mpPlaying) {
      const map = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      if (mpSupport && !mpResult) mpSupport.sendAction({ type: "move", direction });
      return;
    }

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
    if (mpPlaying) {
      if (mpSupport && !mpResult) mpSupport.sendAction({ type: "move", direction });
      return;
    }

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

  // ---------- Multiplayer mode ----------

  function mpMyState() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    return (state && state.playerStates && state.playerStates[myNumber]) || null;
  }

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    restartBtn.hidden = true;
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
    boardEl.innerHTML = '<p class="mp-muted">Waiting for the host to start the match...</p>';
    scoreEl.textContent = "0";
    bestEl.textContent = "0";
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    restartBtn.hidden = true;
    statusEl.textContent = "Merge tiles and outscore the opponent!";
    renderMpControls();
    renderMp();
  }

  function renderMp() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    if (!state || !state.playerStates) {
      boardEl.innerHTML = '<p class="mp-muted">Waiting for match state...</p>';
      return;
    }

    const myState = state.playerStates[myNumber];
    if (!myState || !myState.board) {
      boardEl.innerHTML = '<p class="mp-muted">Waiting for match state...</p>';
      return;
    }

    boardEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "g2048-wrap";

    const mine = document.createElement("div");
    mine.className = "g2048-board";
    appendBoard(mine, myState.board);
    const mineLabel = document.createElement("p");
    mineLabel.className = "mp-muted";
    mineLabel.textContent = `You - ${myState.score}`;
    const mineBox = document.createElement("div");
    mineBox.appendChild(mineLabel);
    mineBox.appendChild(mine);
    wrap.appendChild(mineBox);

    const players = mpSupport ? mpSupport.getPlayers() : [];
    Object.keys(state.playerStates)
      .filter((number) => Number(number) !== myNumber)
      .forEach((number) => {
        const oppState = state.playerStates[number];
        const player = players.find((entry) => entry.playerNumber === Number(number));
        const box = document.createElement("div");
        const label = document.createElement("p");
        label.className = "mp-muted";
        label.textContent = `${player ? player.name : "Opponent"} - ${oppState.score}`;
        const opp = document.createElement("div");
        opp.className = "g2048-board";
        appendBoard(opp, oppState.board);
        box.appendChild(label);
        box.appendChild(opp);
        wrap.appendChild(box);
      });

    boardEl.appendChild(wrap);
    scoreEl.textContent = String(myState.score);

    const playersList = mpSupport ? mpSupport.getPlayers() : [];
    const lines = playersList.map((player) => {
      const entry = state.playerStates[player.playerNumber];
      return `${player.name}: ${entry ? entry.score : 0}`;
    });
    if (mpResult) {
      const winnerName = (pn) => {
        const player = playersList.find((entry) => entry.playerNumber === pn);
        return player ? player.name : `Player ${pn}`;
      };
      if (mpResult.draw) statusEl.textContent = "Match over - it is a draw!";
      else if (mpResult.winner === myNumber) statusEl.textContent = "You win!";
      else statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
    } else {
      statusEl.textContent = lines.join("  |  ");
    }

    renderMpControls();
  }

  function appendBoard(container, grid) {
    grid.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "g2048-row";
      row.forEach((value) => {
        const tile = document.createElement("div");
        tile.className = "g2048-tile";
        tile.dataset.value = String(value);
        tile.textContent = value === 0 ? "" : String(value);
        rowEl.appendChild(tile);
      });
      container.appendChild(rowEl);
    });
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
    restartBtn.hidden = false;
    const bar = controls.querySelector(".mp-match-bar");
    if (bar) bar.remove();
    const again = controls.querySelector(".mp-play-again");
    if (again) again.remove();
    start();
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
