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
      const attrs = segment && segment["@attributes"] ? segment["@attributes"] : {};
      return {
        label: attrs.label || `Segment ${idx + 1}`,
        color: attrs.color || "#c084fc",
        prize: Number(attrs.prize || 0),
      };
    })
    .filter((item) => item.label);

  if (segments.length < 2) {
    statusEl.textContent = "Config must have at least 2 wheel segments.";
    return;
  }

  const spinDuration = Number(config.spin_duration || 4600);

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

  statusEl.textContent = "Spin for random prizes.";

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
