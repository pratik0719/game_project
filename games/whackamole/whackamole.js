(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("whackamole");
    config = response.whackamole || response;
  } catch (error) {
    statusEl.textContent = `Could not load whack-a-mole config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load whack-a-mole config", "error");
    return;
  }

  const moleCount = Math.max(6, Math.min(12, Number(config.mole_count || 9)));
  const gameDuration = Math.max(10, Number(config.game_duration || 30));

  let levels = (config.speed_levels || {}).level || [];
  if (!Array.isArray(levels)) {
    levels = [levels];
  }

  levels = levels
    .map((level) => {
      const attrs = level && level["@attributes"] ? level["@attributes"] : {};
      return {
        second: Number(attrs.second || 0),
        interval: Number(attrs.interval || 800),
      };
    })
    .sort((a, b) => a.second - b.second);

  if (levels.length === 0) {
    levels = [{ second: 0, interval: 800 }];
  }

  root.innerHTML = `
    <div class="whack-wrap">
      <div id="whack-grid" class="whack-grid"></div>
    </div>
  `;

  controls.innerHTML = `
    <div class="game-hud">
      <strong>Score:</strong> <span id="whack-score">0</span>
      <strong>Time:</strong> <span id="whack-time">${gameDuration}</span>s
    </div>
    <button class="btn btn-primary" id="whack-start">Start</button>
    <button class="btn btn-outline" id="whack-reset">Reset</button>
  `;

  const grid = document.getElementById("whack-grid");
  const scoreEl = document.getElementById("whack-score");
  const timeEl = document.getElementById("whack-time");
  const startBtn = document.getElementById("whack-start");
  const resetBtn = document.getElementById("whack-reset");

  let score = 0;
  let remaining = gameDuration;
  let running = false;
  let timerId = null;
  let popupTimer = null;
  let activeHole = -1;

  buildHoles();
  statusEl.textContent = "Tap Start to begin whacking moles.";

  startBtn.addEventListener("click", startGame);
  resetBtn.addEventListener("click", resetGame);

  function buildHoles() {
    grid.innerHTML = "";
    for (let i = 0; i < moleCount; i += 1) {
      const hole = document.createElement("button");
      hole.type = "button";
      hole.className = "whack-hole";
      hole.innerHTML = `<div class="mole">🐹</div>`;
      hole.dataset.index = String(i);
      hole.addEventListener("click", () => onHoleClick(i));
      grid.appendChild(hole);
    }
  }

  function startGame() {
    if (running) {
      return;
    }

    running = true;
    score = 0;
    remaining = gameDuration;
    scoreEl.textContent = "0";
    timeEl.textContent = String(remaining);
    statusEl.textContent = "Whack every mole before it hides.";
    startBtn.disabled = true;

    timerId = window.setInterval(() => {
      remaining -= 1;
      timeEl.textContent = String(remaining);
      if (remaining <= 0) {
        finishGame();
      }
    }, 1000);

    scheduleNextPop();
  }

  function resetGame() {
    clearTimers();
    running = false;
    score = 0;
    remaining = gameDuration;
    activeHole = -1;
    scoreEl.textContent = "0";
    timeEl.textContent = String(remaining);
    startBtn.disabled = false;
    clearActiveMole();
    statusEl.textContent = "Game reset. Tap Start.";
  }

  function finishGame() {
    clearTimers();
    running = false;
    startBtn.disabled = false;
    clearActiveMole();
    statusEl.textContent = `Time up. Final score: ${score}`;

    window.ArcadeAPI.promptScoreSubmission(
      "whackamole",
      score,
      `Duration: ${gameDuration}s`,
      { duration: gameDuration }
    );
  }

  function scheduleNextPop() {
    if (!running) {
      return;
    }

    const elapsed = gameDuration - remaining;
    const interval = currentInterval(elapsed);

    popupTimer = window.setTimeout(() => {
      showRandomMole(interval);
      scheduleNextPop();
    }, interval);
  }

  function currentInterval(elapsedSeconds) {
    let interval = levels[0].interval;
    levels.forEach((level) => {
      if (elapsedSeconds >= level.second) {
        interval = level.interval;
      }
    });
    return Math.max(180, interval);
  }

  function showRandomMole(interval) {
    clearActiveMole();

    const nextIndex = Math.floor(Math.random() * moleCount);
    activeHole = nextIndex;

    const hole = grid.children[nextIndex];
    if (!hole) {
      return;
    }

    hole.classList.add("active");

    window.setTimeout(() => {
      if (activeHole === nextIndex) {
        hole.classList.remove("active");
        activeHole = -1;
      }
    }, Math.max(120, interval - 40));
  }

  function clearActiveMole() {
    Array.from(grid.children).forEach((hole) => hole.classList.remove("active"));
    activeHole = -1;
  }

  function onHoleClick(index) {
    if (!running || index !== activeHole) {
      return;
    }

    score += 1;
    scoreEl.textContent = String(score);
    const hole = grid.children[index];
    if (hole) {
      hole.classList.remove("active");
    }
    activeHole = -1;
    window.ArcadeAPI.toast("Hit!", "success");
  }

  function clearTimers() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
    if (popupTimer) {
      window.clearTimeout(popupTimer);
      popupTimer = null;
    }
  }
})();
