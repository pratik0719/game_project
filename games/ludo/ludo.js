(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("ludo");
    config = response.ludo || response;
  } catch (error) {
    statusEl.textContent = `Could not load ludo config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load ludo config", "error");
    return;
  }

  let colorsRaw = (config.token_colors || {}).color || [];
  if (!Array.isArray(colorsRaw)) {
    colorsRaw = [colorsRaw];
  }

  const playerPalette = colorsRaw.map((entry, idx) => {
    const attrs = entry && entry["@attributes"] ? entry["@attributes"] : {};
    const defaults = ["#ff4d4d", "#22c55e", "#facc15", "#38bdf8"];
    const names = ["Red", "Green", "Yellow", "Blue"];
    return {
      name: attrs.name || names[idx] || `Player ${idx + 1}`,
      color: attrs.code || defaults[idx] || "#ffffff",
    };
  });

  const playerCount = Math.max(2, Math.min(4, Number(config.player_count || 4)));
  const botDifficulty = String(config.bot_difficulty || "medium").toLowerCase();

  const startOffsets = [0, 13, 26, 39];
  const safeSquares = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

  const canvas = document.createElement("canvas");
  canvas.width = 620;
  canvas.height = 620;

  root.innerHTML = "<div class='ludo-wrap'></div>";
  const wrap = root.querySelector(".ludo-wrap");
  wrap.appendChild(canvas);
  wrap.insertAdjacentHTML("beforeend", "<div class='ludo-token-list' id='ludo-token-list'></div>");

  controls.innerHTML = `
    <div class="ludo-panel">
      <button class="btn btn-primary" id="ludo-roll">Roll Dice</button>
      <button class="btn btn-outline" id="ludo-restart">Restart</button>
      <div class="game-hud"><strong>Dice:</strong> <span id="ludo-dice">-</span> <strong>Turn:</strong> <span id="ludo-turn">-</span></div>
    </div>
  `;

  const ctx = canvas.getContext("2d");
  const rollBtn = document.getElementById("ludo-roll");
  const restartBtn = document.getElementById("ludo-restart");
  const diceEl = document.getElementById("ludo-dice");
  const turnEl = document.getElementById("ludo-turn");
  const tokenList = document.getElementById("ludo-token-list");

  const pathCoords = createRingPath(310, 310, 215, 52);
  const homeCoords = createHomeLanes(pathCoords, 310, 310);
  const yardCoords = createYardSlots();

  let players = [];
  let currentPlayer = 0;
  let dice = null;
  let canRoll = true;
  let gameOver = false;

  // ------------------------------------------------------------------
  // Multiplayer integration. The server owns the dice and every token;
  // the browser only sends "roll" and "move" intents and renders the
  // shared board state. Bots are disabled - humans only.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("ludo", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "ludo";
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
      initialize();
    }
  } else {
    initialize();
  }


  rollBtn.addEventListener("click", onRollDice);
  restartBtn.addEventListener("click", initialize);

  function initialize() {
    players = [];
    for (let i = 0; i < playerCount; i += 1) {
      const palette = playerPalette[i] || { name: `Player ${i + 1}`, color: "#ffffff" };
      players.push({
        index: i,
        name: i === 0 ? "You" : `${palette.name} Bot`,
        color: palette.color,
        tokens: [-1, -1, -1, -1],
        captures: 0,
        isBot: i !== 0,
      });
    }

    currentPlayer = 0;
    dice = null;
    canRoll = true;
    gameOver = false;
    statusEl.textContent = "Roll a 6 to deploy tokens from home.";
    render();
    maybeBotTurn();
  }

  function render() {
    drawBoard();
    drawTokens();

    const player = players[currentPlayer];
    diceEl.textContent = dice === null ? "-" : String(dice);
    turnEl.textContent = `${player.name}`;
    rollBtn.disabled = !canRoll || gameOver || player.isBot;

    renderTokenChoices();
  }

  function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#06101f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const homeZones = [
      { x: 26, y: 26, color: players[0]?.color || "#ff4d4d" },
      { x: 404, y: 26, color: players[1]?.color || "#22c55e" },
      { x: 404, y: 404, color: players[2]?.color || "#facc15" },
      { x: 26, y: 404, color: players[3]?.color || "#38bdf8" },
    ];

    homeZones.forEach((zone) => {
      ctx.fillStyle = `${zone.color}26`;
      ctx.fillRect(zone.x, zone.y, 190, 190);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(zone.x, zone.y, 190, 190);
    });

    ctx.fillStyle = "#0c1c36";
    ctx.beginPath();
    ctx.arc(310, 310, 240, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < pathCoords.length; i += 1) {
      const point = pathCoords[i];
      ctx.fillStyle = safeSquares.has(i) ? "#1a3158" : "#101c34";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#334d73";
      ctx.stroke();
    }

    homeCoords.forEach((lane, index) => {
      lane.forEach((pt, step) => {
        ctx.fillStyle = `${players[index]?.color || "#ffffff"}40`;
        if (step === lane.length - 1) {
          ctx.fillStyle = `${players[index]?.color || "#ffffff"}`;
        }
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#334d73";
        ctx.stroke();
      });
    });

    ctx.fillStyle = "#f2f6ff";
    ctx.font = "16px Orbitron";
    ctx.fillText("Safe", 286, 74);
  }

  function drawTokens() {
    players.forEach((player) => {
      player.tokens.forEach((tokenStep, tokenIdx) => {
        const pos = resolveTokenPosition(player.index, tokenIdx, tokenStep);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.strokeStyle = "#f4f7ff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "#06101f";
        ctx.font = "bold 10px Orbitron";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(tokenIdx + 1), pos.x, pos.y + 0.5);
      });
    });
  }

  function renderTokenChoices() {
    tokenList.innerHTML = "";
    if (gameOver) {
      return;
    }

    const player = players[currentPlayer];
    if (player.isBot || dice === null) {
      return;
    }

    // In multiplayer, only the player whose turn it is may move tokens.
    if (mpPlaying && currentPlayer !== mpMyIndex()) {
      return;
    }

    const moves = validMovesForPlayer(player, dice);
    if (moves.length === 0) {
      tokenList.innerHTML = "<span>No valid token for this roll.</span>";
      return;
    }

    moves.forEach((tokenIndex) => {
      const button = document.createElement("button");
      button.className = "ludo-token-btn active";
      button.textContent = `Token ${tokenIndex + 1}`;
      button.addEventListener("click", () => {
        if (mpPlaying) {
          if (mpSupport) mpSupport.sendAction({ type: "move", tokenIndex });
          return;
        }
        applyMove(player, tokenIndex, dice);
      });
      tokenList.appendChild(button);
    });
  }

  function onRollDice() {
    if (!canRoll || gameOver) {
      return;
    }

    if (mpPlaying) {
      if (currentPlayer === mpMyIndex() && mpSupport) mpSupport.sendAction({ type: "roll" });
      return;
    }

    const player = players[currentPlayer];
    if (player.isBot) {
      return;
    }

    rollWithAnimation((value) => {
      dice = value;
      canRoll = false;
      const moves = validMovesForPlayer(player, dice);
      statusEl.textContent = `${player.name} rolled ${dice}.`;
      render();
      if (moves.length === 0) {
        window.setTimeout(() => endTurn(false), 600);
      }
    });
  }

  function maybeBotTurn() {
    if (gameOver) {
      return;
    }

    const player = players[currentPlayer];
    if (!player.isBot) {
      return;
    }

    rollBtn.disabled = true;
    statusEl.textContent = `${player.name} is rolling...`;

    rollWithAnimation((value) => {
      dice = value;
      canRoll = false;
      render();
      const moves = validMovesForPlayer(player, dice);

      if (moves.length === 0) {
        statusEl.textContent = `${player.name} rolled ${dice} and cannot move.`;
        window.setTimeout(() => endTurn(false), 900);
        return;
      }

      const chosenToken = chooseBotMove(player, moves, dice);
      window.setTimeout(() => {
        applyMove(player, chosenToken, dice);
      }, 650);
    });
  }

  function rollWithAnimation(onDone) {
    let ticks = 0;
    const timer = window.setInterval(() => {
      const face = 1 + Math.floor(Math.random() * 6);
      diceEl.textContent = String(face);
      ticks += 1;
      if (ticks > 12) {
        window.clearInterval(timer);
        const finalFace = 1 + Math.floor(Math.random() * 6);
        diceEl.textContent = String(finalFace);
        onDone(finalFace);
      }
    }, 55);
  }

  function validMovesForPlayer(player, rolled) {
    const moves = [];
    player.tokens.forEach((step, tokenIndex) => {
      if (step === -1 && rolled === 6) {
        moves.push(tokenIndex);
        return;
      }
      if (step >= 0 && step + rolled <= 57) {
        moves.push(tokenIndex);
      }
    });
    return moves;
  }

  function applyMove(player, tokenIndex, rolled) {
    if (gameOver) {
      return;
    }

    const currentStep = player.tokens[tokenIndex];
    let nextStep = currentStep;

    if (currentStep === -1 && rolled === 6) {
      nextStep = 0;
    } else if (currentStep >= 0 && currentStep + rolled <= 57) {
      nextStep = currentStep + rolled;
    } else {
      endTurn(false);
      return;
    }

    player.tokens[tokenIndex] = nextStep;
    handleCaptures(player.index, tokenIndex, nextStep);

    if (player.tokens.every((step) => step === 57)) {
      onWin(player);
      return;
    }

    const extraTurn = rolled === 6;
    if (extraTurn) {
      dice = null;
      canRoll = true;
      statusEl.textContent = `${player.name} rolled 6 and gets another turn.`;
      render();
      maybeBotTurn();
      return;
    }

    endTurn(true);
  }

  function handleCaptures(playerIndex, tokenIndex, step) {
    if (step < 0 || step > 51) {
      return;
    }

    const landingBoardIndex = (startOffsets[playerIndex] + step) % 52;
    if (safeSquares.has(landingBoardIndex)) {
      return;
    }

    players.forEach((opponent, oppIndex) => {
      if (oppIndex === playerIndex) {
        return;
      }

      opponent.tokens.forEach((oppStep, oppTokenIndex) => {
        if (oppStep < 0 || oppStep > 51) {
          return;
        }
        const oppBoardIndex = (startOffsets[oppIndex] + oppStep) % 52;
        if (oppBoardIndex === landingBoardIndex) {
          opponent.tokens[oppTokenIndex] = -1;
          players[playerIndex].captures += 1;
          window.ArcadeAPI.toast(`${players[playerIndex].name} captured a token!`, "success");
        }
      });
    });
  }

  function endTurn(moved) {
    dice = null;
    canRoll = true;
    tokenList.innerHTML = "";

    if (!gameOver) {
      currentPlayer = (currentPlayer + 1) % players.length;
      if (moved) {
        statusEl.textContent = `${players[currentPlayer].name}'s turn.`;
      }
      render();
      maybeBotTurn();
    }
  }

  function chooseBotMove(player, moves, rolled) {
    if (botDifficulty === "easy") {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    let best = moves[0];
    let bestScore = -999;

    moves.forEach((tokenIndex) => {
      const currentStep = player.tokens[tokenIndex];
      const targetStep = currentStep === -1 ? 0 : currentStep + rolled;
      const landing = targetStep <= 51 ? (startOffsets[player.index] + targetStep) % 52 : -1;

      let score = targetStep;
      if (targetStep === 57) {
        score += 300;
      }
      if (landing >= 0 && safeSquares.has(landing)) {
        score += 15;
      }
      if (landing >= 0) {
        players.forEach((opp, oppIdx) => {
          if (oppIdx === player.index) {
            return;
          }
          opp.tokens.forEach((oppStep) => {
            if (oppStep < 0 || oppStep > 51) {
              return;
            }
            const oppLanding = (startOffsets[oppIdx] + oppStep) % 52;
            if (oppLanding === landing && !safeSquares.has(landing)) {
              score += 80;
            }
          });
        });
      }

      if (botDifficulty === "hard") {
        score += currentStep * 0.6;
      }

      if (score > bestScore) {
        bestScore = score;
        best = tokenIndex;
      }
    });

    return best;
  }

  function onWin(player) {
    gameOver = true;
    render();
    statusEl.textContent = `${player.name} wins the game!`;

    const score = player.index === 0 ? 260 + player.captures * 15 : 90 + player.captures * 10;
    const summary = `${player.name} won | Captures: ${player.captures}`;

    window.ArcadeAPI.promptScoreSubmission(
      "ludo",
      score,
      summary,
      { winner: player.name, captures: player.captures, players: playerCount }
    );
  }

  function resolveTokenPosition(playerIndex, tokenIndex, step) {
    if (step === -1) {
      return yardCoords[playerIndex][tokenIndex];
    }
    if (step <= 51) {
      const boardIndex = (startOffsets[playerIndex] + step) % 52;
      return pathCoords[boardIndex];
    }
    const laneIndex = Math.min(5, Math.max(0, step - 52));
    return homeCoords[playerIndex][laneIndex];
  }

  function createRingPath(cx, cy, radius, count) {
    const arr = [];
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * (Math.PI * 2);
      arr.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
    return arr;
  }

  function createHomeLanes(ring, cx, cy) {
    const starts = [0, 13, 26, 39].map((i) => ring[i]);
    return starts.map((start) => {
      const lane = [];
      for (let step = 1; step <= 6; step += 1) {
        const t = step / 7;
        lane.push({
          x: start.x + (cx - start.x) * t,
          y: start.y + (cy - start.y) * t,
        });
      }
      return lane;
    });
  }

  function createYardSlots() {
    return [
      [
        { x: 72, y: 72 },
        { x: 168, y: 72 },
        { x: 72, y: 168 },
        { x: 168, y: 168 },
      ],
      [
        { x: 452, y: 72 },
        { x: 548, y: 72 },
        { x: 452, y: 168 },
        { x: 548, y: 168 },
      ],
      [
        { x: 452, y: 452 },
        { x: 548, y: 452 },
        { x: 452, y: 548 },
        { x: 548, y: 548 },
      ],
      [
        { x: 72, y: 452 },
        { x: 168, y: 452 },
        { x: 72, y: 548 },
        { x: 168, y: 548 },
      ],
    ];
  }

  // ---------- Multiplayer mode ----------

  function mpMyIndex() {
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    return players.findIndex((player) => player.playerNumber === myNumber);
  }

  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    rollBtn.disabled = true;
    tokenList.innerHTML = "";
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    renderMpControls();
    ctx.fillStyle = "#06101f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(144, 166, 195, 0.6)";
    ctx.font = "16px Orbitron";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the host...", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "start";
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    statusEl.textContent = "Race your tokens home!";
    renderMpControls();
    renderMp();
  }

  function applyMpState() {
    const state = mpSupport ? mpSupport.getGameState() : null;
    if (!state || !Array.isArray(state.players)) return false;

    const roomPlayers = mpSupport ? mpSupport.getPlayers() : [];
    players = state.players.map((entry, idx) => {
      const paletteEntry = playerPalette[idx] || { name: `Player ${idx + 1}`, color: "#ffffff" };
      const roomPlayer = roomPlayers.find((p) => p.playerNumber === entry.playerNumber);
      return {
        index: idx,
        playerNumber: entry.playerNumber,
        name: roomPlayer ? roomPlayer.name : paletteEntry.name,
        color: paletteEntry.color,
        tokens: entry.tokens,
        captures: entry.captures,
        isBot: false,
      };
    });
    currentPlayer = Math.min(state.currentPlayerIndex, Math.max(0, players.length - 1));
    dice = state.dice;
    canRoll = Boolean(state.canRoll);
    gameOver = Boolean(state.finished);
    return true;
  }

  function renderMp() {
    if (!applyMpState()) return;
    render();

    // Enforce the turn gate locally so only the acting player can roll.
    rollBtn.disabled = !canRoll || gameOver || currentPlayer !== mpMyIndex();

    const playersList = mpSupport ? mpSupport.getPlayers() : [];
    if (mpResult) {
      const winnerName = (pn) => {
        const player = playersList.find((entry) => entry.playerNumber === pn);
        return player ? player.name : `Player ${pn}`;
      };
      const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
      if (mpResult.draw) statusEl.textContent = "Match over - it is a draw!";
      else if (mpResult.winner === myNumber) statusEl.textContent = "You win!";
      else statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
    } else if (currentPlayer === mpMyIndex()) {
      statusEl.textContent = dice === null ? "Your turn. Roll the dice." : `You rolled ${dice}. Move a token.`;
    } else {
      statusEl.textContent = `${players[currentPlayer] ? players[currentPlayer].name : "Opponent"} is playing...`;
    }

    renderMpControls();
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
    const bar = controls.querySelector(".mp-match-bar");
    if (bar) bar.remove();
    const again = controls.querySelector(".mp-play-again");
    if (again) again.remove();
    initialize();
  }
})();
