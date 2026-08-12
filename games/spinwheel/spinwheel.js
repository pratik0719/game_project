(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("spinwheel");
    config = response.spinwheel || response;
  } catch (error) {
    statusEl.textContent = `Could not load spin wheel config: ${error.message}`;
    return;
  }

  let segments = (config.segments || {}).segment || [];
  if (!Array.isArray(segments)) {
    segments = [segments];
  }

  segments = segments
    .map((segment, idx) => {
      const attrs = (segment && (segment["@attributes"] || segment)) || {};
      return {
        label: attrs["@_label"] || attrs.label || `Segment ${idx + 1}`,
        color: attrs["@_color"] || attrs.color || "#c084fc",
        prize: Number(attrs["@_prize"] || attrs.prize || 0),
      };
    })
    .filter((item) => item.label);

  if (segments.length < 2) {
    statusEl.textContent = "Config must have at least 2 wheel segments.";
    return;
  }

  const spinDuration = Number(config.spin_duration || 4600);

  // ------------------------------------------------------------------
  // Multiplayer integration. The server decides every spin result; the
  // browser only sends "spin" intents and animates to the segment the
  // server chose for us.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("spinwheel", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "spinwheel";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;
  let mpLastAnimatedRound = -1;

  root.innerHTML = `
    <div class="spinwheel-wrap">
      <div class="spinwheel-board">
        <div class="spinwheel-pointer"></div>
        <canvas class="spinwheel-canvas" width="420" height="420"></canvas>
      </div>
      <p id="spinwheel-result" class="spinwheel-result">Press SPIN to test your luck.</p>
    </div>
  `;

  controls.innerHTML = `
    <button class="btn btn-primary" id="spinwheel-spin">SPIN</button>
    <button class="btn btn-outline" id="spinwheel-save">Save Total Score</button>
    <button class="btn btn-outline" id="spinwheel-reset">Play Again</button>
    <div class="game-hud"><strong>Wins:</strong> <span id="spinwheel-wins">0</span> <strong>Total:</strong> <span id="spinwheel-total">0</span></div>
  `;

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const resultEl = document.getElementById("spinwheel-result");
  const winsEl = document.getElementById("spinwheel-wins");
  const totalEl = document.getElementById("spinwheel-total");
  const spinBtn = document.getElementById("spinwheel-spin");
  const saveBtn = document.getElementById("spinwheel-save");
  const resetBtn = document.getElementById("spinwheel-reset");

  let rotation = 0;
  let spinning = false;
  let wins = 0;
  let totalScore = 0;

  // ---------- Multiplayer event handlers ----------

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
    if (!mpPlaying) return;

    const state = payload.gameState;
    refreshMpHud(state);

    if (state && state.lastSpin) {
      const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
      if (state.lastSpin.playerNumber === myNumber && state.lastSpin.round > mpLastAnimatedRound) {
        mpLastAnimatedRound = state.lastSpin.round;
        const segment = segments[state.lastSpin.segmentIndex] || null;
        animateToSegment(state.lastSpin.segmentIndex, state.lastSpin.prize, segment ? segment.label : state.lastSpin.segmentLabel, segment ? segment.color : "#c084fc");
      }
    }
  }

  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    const state = payload.gameState;
    refreshMpHud(state);
    renderMpResult();
  }

  function onMpMatchEnded() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mpSupport ? mpSupport.getRoom() : null;
    if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    else enterMpWaiting();
  }

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    spinBtn.disabled = true;
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    statusEl.textContent = "Spin for prizes and out-total the opponent!";
    renderMpControls();
    refreshMpHud(mpSupport.getGameState());
  }

  function refreshMpHud(state) {
    if (!state || !state.playerStates) return;
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const parts = players.map((player) => {
      const entry = state.playerStates[player.playerNumber];
      const total = entry ? entry.total : 0;
      const spins = entry ? entry.spins : 0;
      return `${player.name}: ${total} (${spins}/${state.spinsPerMatch})`;
    });
    statusEl.textContent = parts.join("  |  ");

    const me = myNumber ? state.playerStates[myNumber] : null;
    if (me) {
      winsEl.textContent = String(me.spins);
      totalEl.textContent = String(me.total);
    }

    // Disable the spin button when it is not this player's turn to spin.
    const allSpins = Object.values(state.playerStates).map((entry) => entry.spins);
    const minSpins = Math.min(...allSpins);
    const mySpins = me ? me.spins : 0;
    spinBtn.disabled =
      spinning ||
      Boolean(mpResult) ||
      !mpPlaying ||
      mySpins >= state.spinsPerMatch ||
      mySpins > minSpins + 1;
  }

  function renderMpResult() {
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const winnerName = (pn) => {
      const player = players.find((entry) => entry.playerNumber === pn);
      return player ? player.name : `Player ${pn}`;
    };
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    if (mpResult) {
      if (mpResult.draw) {
        resultEl.textContent = "Match over - it is a draw!";
        resultEl.style.removeProperty("--spin-result-color");
      } else if (mpResult.winner === myNumber) {
        resultEl.innerHTML = `<span class="segment-name">You win!</span>`;
        resultEl.style.setProperty("--spin-result-color", "#4ade80");
      } else {
        resultEl.innerHTML = `<span class="segment-name">${escapeHtml(winnerName(mpResult.winner))} wins!</span>`;
        resultEl.style.setProperty("--spin-result-color", "#fb7185");
      }
      resultEl.classList.remove("is-celebrating");
    }
    renderMpControls();
  }

  function renderMpControls() {
    controls.querySelector("#spinwheel-save")?.setAttribute("hidden", "");
    controls.querySelector("#spinwheel-reset")?.setAttribute("hidden", "");
    let bar = controls.querySelector(".mp-match-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mp-match-bar";
      controls.appendChild(bar);
    }
    if (mpSupport) mpSupport.renderMatchBar(bar);
    if (mpSupport) mpSupport.renderPlayAgainButton(controls, mpPlaying && Boolean(mpResult));
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    mpLastAnimatedRound = -1;
    spinBtn.disabled = false;
    controls.querySelector("#spinwheel-save")?.removeAttribute("hidden");
    controls.querySelector("#spinwheel-reset")?.removeAttribute("hidden");
    const bar = controls.querySelector(".mp-match-bar");
    if (bar) bar.remove();
    const again = controls.querySelector(".mp-play-again");
    if (again) again.remove();
    statusEl.textContent = "Spin for random prizes.";
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
    }
  }

  drawWheel(rotation);

  spinBtn.addEventListener("click", spin);
  saveBtn.addEventListener("click", saveScore);
  resetBtn.addEventListener("click", () => {
    wins = 0;
    totalScore = 0;
    winsEl.textContent = "0";
    totalEl.textContent = "0";
    resultEl.textContent = "Round reset. Press SPIN.";
    resultEl.style.removeProperty("--spin-result-color");
    resultEl.classList.remove("is-celebrating");
    statusEl.textContent = "Spin for random prizes.";
  });

  if (!mpWaiting && !mpPlaying) statusEl.textContent = "Spin for random prizes.";

  function drawWheel(angle) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 182;
    const segAngle = (Math.PI * 2) / segments.length;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    segments.forEach((segment, idx) => {
      const start = idx * segAngle;
      const end = start + segAngle;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = segment.color;
      ctx.fill();

      ctx.strokeStyle = "rgba(6, 8, 16, 0.75)";
      ctx.lineWidth = 2;
      ctx.stroke();

      const textAngle = start + segAngle / 2;
      ctx.save();
      ctx.rotate(textAngle);
      ctx.textAlign = "right";
      ctx.fillStyle = "#070b16";
      ctx.font = "bold 15px Orbitron";
      ctx.fillText(segment.label, radius - 14, 5);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fillStyle = "#f6f0d9";
    ctx.fill();
    ctx.restore();
  }

  function spin() {
    if (spinning) {
      return;
    }

    if (mpPlaying) {
      // Server-authoritative: ask the server for a spin result.
      if (mpSupport) mpSupport.sendAction({ type: "spin" });
      return;
    }

    spinning = true;
    spinBtn.disabled = true;
    const startRotation = rotation;
    const extraTurns = Math.PI * 2 * (5 + Math.random() * 2);
    const offset = Math.random() * Math.PI * 2;
    const targetRotation = startRotation + extraTurns + offset;

    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / spinDuration);
      const eased = 1 - Math.pow(1 - t, 3);
      rotation = startRotation + (targetRotation - startRotation) * eased;
      drawWheel(rotation);

      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }

      spinning = false;
      spinBtn.disabled = false;
      onSpinDone();
    }

    requestAnimationFrame(frame);
  }

  /** Animate the wheel so the pointer lands on the server-chosen segment. */
  function animateToSegment(segmentIndex, prize, label, color) {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;

    const segAngle = (Math.PI * 2) / segments.length;
    const startRotation = rotation;
    const targetMod = ((Math.PI * 1.5 - (segmentIndex + 0.5) * segAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const turns = Math.ceil((startRotation + Math.PI * 2 * 5 - targetMod) / (Math.PI * 2));
    const targetRotation = targetMod + Math.max(5, turns) * Math.PI * 2;

    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / spinDuration);
      const eased = 1 - Math.pow(1 - t, 3);
      rotation = startRotation + (targetRotation - startRotation) * eased;
      drawWheel(rotation);

      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }

      spinning = false;
      spinBtn.disabled = false;
      resultEl.innerHTML = `Winner: <span class="segment-name">${escapeHtml(label)}</span> (+${prize})`;
      resultEl.style.setProperty("--spin-result-color", color || "#c084fc");
      resultEl.classList.remove("is-celebrating");
      void resultEl.offsetWidth;
      resultEl.classList.add("is-celebrating");
      refreshMpHud(mpSupport ? mpSupport.getGameState() : null);
    }

    requestAnimationFrame(frame);
  }

  function onSpinDone() {
    const segAngle = (Math.PI * 2) / segments.length;
    const normalized = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const pointerAngle = (Math.PI * 1.5 - normalized + Math.PI * 2) % (Math.PI * 2);
    const winningIndex = Math.floor(pointerAngle / segAngle) % segments.length;
    const winner = segments[winningIndex];

    wins += 1;
    totalScore += Number(winner.prize || 0);
    winsEl.textContent = String(wins);
    totalEl.textContent = String(totalScore);

    resultEl.innerHTML = `Winner: <span class="segment-name">${escapeHtml(winner.label)}</span> (+${winner.prize})`;
    resultEl.style.setProperty("--spin-result-color", winner.color);
    resultEl.classList.remove("is-celebrating");
    void resultEl.offsetWidth;
    resultEl.classList.add("is-celebrating");
    statusEl.textContent = `Spin complete: ${winner.label}`;
  }

  function saveScore() {
    if (wins === 0) {
      resultEl.textContent = "Spin at least once before saving.";
      resultEl.style.removeProperty("--spin-result-color");
      resultEl.classList.remove("is-celebrating");
      return;
    }

    window.ArcadeAPI.promptScoreSubmission(
      "spinwheel",
      totalScore,
      `Wins: ${wins}`,
      { wins }
    );
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
