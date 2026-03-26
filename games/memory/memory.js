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

  const symbolContainer = config.symbols || {};
  let symbols = symbolContainer.symbol || [];
  if (!Array.isArray(symbols)) {
    symbols = [symbols];
  }
  symbols = symbols.filter(Boolean);

  const pairCount = Math.max(2, Number(config.pair_count || 8));
  const timeBonus = Number(config.time_bonus || 300);

  let deck = [];
  let openCards = [];
  let lockBoard = false;
  let matchedPairs = 0;
  let moves = 0;
  let seconds = 0;
  let timerId = null;
  let timerStarted = false;

  function startRound() {
    const selected = symbols.slice(0, pairCount);
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

    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }

    statusEl.textContent = "Find all matching pairs.";
    render();
    renderControls();
  }

  function renderControls() {
    controls.innerHTML = "";

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

  startRound();
})();

