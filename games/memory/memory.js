(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("memory");
    config = response.memory || response;
  } catch (error) {
    statusEl.textContent = `Could not load memory config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load memory config", "error");
    return;
  }

  // Card content is organised into three pickable modes: numbers (max two
  // digits), fruit names and alphabet letters. The pools come from the XML
  // config so single-player and multiplayer always use the same content.
  const MODES = ["numbers", "fruits", "alphabets"];
  const MODE_LABELS = { numbers: "Numbers", fruits: "Fruits", alphabets: "Alphabets" };
  const MODE_DEFAULTS = {
    numbers: ["11", "23", "34", "45", "56", "67", "78", "89"],
    fruits: ["Apple", "Banana", "Cherry", "Grapes", "Kiwi", "Lemon", "Mango", "Orange"],
    alphabets: ["A", "B", "C", "D", "E", "F", "G", "H"],
  };
  const defaultMode = String(config.default_mode || "numbers").trim().toLowerCase();
  const modePools = {};
  MODES.forEach((mode) => {
    const raw = (config.modes || {})[mode];
    let values = raw && raw.value !== undefined ? raw.value : raw;
    if (!Array.isArray(values)) values = values === undefined || values === null ? [] : [values];
    const pool = values
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
      .map((value) => String(value).trim());
    modePools[mode] = pool.length > 0 ? pool : MODE_DEFAULTS[mode];
  });

  const pairCount = Math.max(2, Number(config.pair_count || 8));
  const timeBonus = Number(config.time_bonus || 300);

  // ------------------------------------------------------------------
  // Multiplayer integration. In a room the deck is rendered exclusively
  // from server-provided game_state; the browser only sends flip intents.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("memory", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "memory";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

  let deck = [];
  let openCards = [];
  let lockBoard = false;
  let matchedPairs = 0;
  let moves = 0;
  let seconds = 0;
  let timerId = null;
  let timerStarted = false;
  let cardMode = MODES.includes(defaultMode) ? defaultMode : "numbers";
  let roundActive = false;

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
      enterSoloPick();
    }
  } else {
    enterSoloPick();
  }

  // ---------- Single-player mode ----------

  function enterSoloPick() {
    roundActive = false;
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
    timerStarted = false;
    statusEl.textContent = "Choose a card mode to start the game.";
    root.innerHTML = '<p class="mp-muted">Pick Numbers, Fruits or Alphabets above to start.</p>';
    renderControls();
  }

  function startRound() {
    const selected = (modePools[cardMode] || []).slice(0, pairCount);
    const doubled = [...selected, ...selected].map((symbol, index) => ({
      id: index,
      symbol,
      revealed: false,
      matched: false,
    }));

    deck = shuffle(doubled);
    openCards = [];
    lockBoard = false;
    matchedPairs = 0;
    moves = 0;
    seconds = 0;
    timerStarted = false;
    roundActive = true;

    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }

    statusEl.textContent = `Find all matching pairs - ${MODE_LABELS[cardMode]} mode.`;
    render();
    renderControls();
  }

  function renderControls() {
    controls.innerHTML = "";

    const modeWrap = document.createElement("div");
    modeWrap.className = "mode-switch";
    MODES.forEach((mode) => {
      const modeBtn = document.createElement("button");
      modeBtn.type = "button";
      modeBtn.className = "btn btn-outline";
      modeBtn.textContent = MODE_LABELS[mode];
      if (mode === cardMode) modeBtn.classList.add("active");
      modeBtn.addEventListener("click", () => {
        cardMode = mode;
        startRound();
      });
      modeWrap.appendChild(modeBtn);
    });
    controls.appendChild(modeWrap);

    if (!roundActive) {
      return;
    }

    const stats = document.createElement("div");
    stats.className = "game-hud";
    stats.innerHTML = `<strong>Moves:</strong> <span id="memory-moves">${moves}</span> <strong>Time:</strong> <span id="memory-time">${seconds}s</span>`;

    const restartBtn = document.createElement("button");
    restartBtn.className = "btn btn-outline";
    restartBtn.textContent = "Restart";
    restartBtn.addEventListener("click", startRound);

    controls.appendChild(stats);
    controls.appendChild(restartBtn);
  }

  function updateStats() {
    const movesEl = document.getElementById("memory-moves");
    const timeEl = document.getElementById("memory-time");
    if (movesEl) {
      movesEl.textContent = String(moves);
    }
    if (timeEl) {
      timeEl.textContent = `${seconds}s`;
    }
  }

  function startTimerIfNeeded() {
    if (timerStarted) {
      return;
    }
    timerStarted = true;
    timerId = window.setInterval(() => {
      seconds += 1;
      updateStats();
    }, 1000);
  }

  function render() {
    root.innerHTML = "";
    const board = document.createElement("div");
    board.className = "memory-grid";

    deck.forEach((card, index) => {
      const button = document.createElement("button");
      button.className = "memory-card";
      if (card.revealed) {
        button.classList.add("revealed");
      }
      if (card.matched) {
        button.classList.add("matched");
      }

      button.type = "button";
      button.textContent = card.revealed || card.matched ? card.symbol : "?";
      button.disabled = card.matched || lockBoard;
      button.addEventListener("click", () => onCardClick(index));
      board.appendChild(button);
    });

    root.appendChild(board);
  }

  function onCardClick(index) {
    const card = deck[index];
    if (!card || card.revealed || card.matched || lockBoard) {
      return;
    }

    startTimerIfNeeded();

    card.revealed = true;
    openCards.push(index);
    render();

    if (openCards.length < 2) {
      return;
    }

    moves += 1;
    updateStats();
    lockBoard = true;

    const [firstIndex, secondIndex] = openCards;
    const first = deck[firstIndex];
    const second = deck[secondIndex];

    if (first.symbol === second.symbol) {
      first.matched = true;
      second.matched = true;
      matchedPairs += 1;
      openCards = [];
      lockBoard = false;
      render();

      if (matchedPairs === pairCount) {
        finishRound();
      }
      return;
    }

    window.setTimeout(() => {
      first.revealed = false;
      second.revealed = false;
      openCards = [];
      lockBoard = false;
      render();
    }, 700);
  }

  function finishRound() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }

    const base = pairCount * 120;
    const efficiency = Math.max(0, base - moves * 8 - seconds * 2);
    const score = Math.max(15, efficiency + Math.max(0, timeBonus - seconds));

    statusEl.textContent = `Completed in ${moves} moves and ${seconds}s. Score: ${score}`;

    window.ArcadeAPI.promptScoreSubmission(
      "memory",
      score,
      `Moves: ${moves} | Time: ${seconds}s`,
      { moves, time_seconds: seconds }
    );
  }

  function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
  }

  // ---------- Multiplayer mode ----------

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
    root.innerHTML = '<p class="mp-muted">Waiting for the host to start the match...</p>';
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    statusEl.textContent = "Match all pairs before the opponent does!";
    renderMpControls();
    renderMp();
  }

  function mpMyState() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    return (state && state.playerStates && state.playerStates[myNumber]) || null;
  }

  function renderMp() {
    const myState = mpMyState();
    if (!myState || !Array.isArray(myState.deck)) {
      root.innerHTML = '<p class="mp-muted">Waiting for match state...</p>';
      return;
    }

    root.innerHTML = "";
    const board = document.createElement("div");
    board.className = "memory-grid";
    myState.deck.forEach((card, index) => {
      const button = document.createElement("button");
      button.className = "memory-card";
      if (card.revealed) button.classList.add("revealed");
      if (card.matched) button.classList.add("matched");
      button.type = "button";
      button.textContent = card.revealed || card.matched ? card.symbol : "?";
      button.disabled = card.matched || myState.lockBoard || Boolean(mpResult);
      button.addEventListener("click", () => {
        if (mpSupport) mpSupport.sendAction({ type: "flip", index });
      });
      board.appendChild(button);
    });
    root.appendChild(board);

    const players = mpSupport ? mpSupport.getPlayers() : [];
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const opponent = players.find((player) => player.playerNumber !== myNumber);
    if (opponent) {
      statusEl.textContent = `You: ${myState.matchedPairs}/${pairCount} pairs - ${opponent.name}: ?/${pairCount} pairs`;
    } else {
      statusEl.textContent = `Pairs matched: ${myState.matchedPairs}/${pairCount}`;
    }

    renderMpControls();
  }

  function renderMpControls() {
    controls.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mp-match-bar";
    controls.appendChild(bar);
    if (mpSupport) mpSupport.renderMatchBar(bar);

    if (mpWaiting) {
      // The card mode is chosen before the match starts. The host's current
      // selection travels with the start_game event (read from this element).
      const modeWrap = document.createElement("div");
      modeWrap.className = "mode-switch";
      modeWrap.dataset.mpMode = cardMode;
      MODES.forEach((mode) => {
        const modeBtn = document.createElement("button");
        modeBtn.type = "button";
        modeBtn.className = "btn btn-outline";
        modeBtn.textContent = MODE_LABELS[mode];
        if (mode === cardMode) modeBtn.classList.add("active");
        modeBtn.addEventListener("click", () => {
          cardMode = mode;
          renderMpControls();
        });
        modeWrap.appendChild(modeBtn);
      });
      controls.appendChild(modeWrap);

      const room = mpSupport ? mpSupport.getRoom() : null;
      const me = mpSupport ? mpSupport.me() : null;
      const isHost = Boolean(room && me && room.hostId === me.socketId);
      const note = document.createElement("p");
      note.className = "mp-muted";
      note.textContent = isHost
        ? `Pick the card mode (${MODE_LABELS[cardMode]} selected), then press Start Game.`
        : "The host picks the card mode before starting.";
      controls.appendChild(note);
      return;
    }

    if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));

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
    enterSoloPick();
  }

  // Start the local game only when we are not inside a multiplayer room.
  if (!mpWaiting && !mpPlaying) enterSoloPick();
})();

