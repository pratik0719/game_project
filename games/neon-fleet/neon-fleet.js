(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) return;

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("neon-fleet");
    config = response.fleet || response;
  } catch (error) {
    statusEl.textContent = `Could not load neon-fleet config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load neon-fleet config", "error");
    return;
  }

  const GRID = Math.max(8, Math.min(12, Number(config.grid_size || 10)));
  const SHIPS = [
    { name: "carrier", size: 5, label: "Carrier" },
    { name: "battleship", size: 4, label: "Battleship" },
    { name: "cruiser", size: 3, label: "Cruiser" },
    { name: "submarine", size: 3, label: "Submarine" },
    { name: "destroyer", size: 2, label: "Destroyer" },
  ];

  const key = (row, col) => `${row},${col}`;

  // ------------------------------------------------------------------
  // Multiplayer integration. All placement and attacks are validated on
  // the server; the browser renders the personalized state it receives.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("neon-fleet", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "neon-fleet";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

  // Local game state.
  let phase = "placement"; // placement | battle | finished
  let myShips = []; // { name, size, label, row, col, horizontal, cells }
  let boardTab = "mine"; // which board is visible on touch screens
  let prevPhase = null;
  let myHits = {}; // "r,c" -> "hit" | "miss" (received)
  let enemyShots = {}; // "r,c" -> "hit" | "miss" (made by me)
  let sunkShips = []; // enemy ship labels sunk
  let myReady = false;
  let opponentReady = false;
  let myTurn = false;
  let selectedShip = null;
  let horizontal = true;
  let hoverCell = null;

  // Solo-only state.
  let soloOpponentShips = [];
  let soloHunt = []; // stack of cells to try after a hit
  let soloShotCells = new Set();
  let soloGameActive = false;

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
    if (!state) return;
    phase = state.phase || "placement";
    myShips = Array.isArray(state.myBoard?.ships) ? state.myBoard.ships : [];
    myHits = state.myBoard?.hits || {};
    myReady = Boolean(state.myBoard?.ready);
    enemyShots = state.enemyBoard?.shots || {};
    sunkShips = Array.isArray(state.enemyBoard?.sunk) ? state.enemyBoard.sunk : [];
    opponentReady = Boolean(state.enemyBoard?.ready);
    const meSocket = mpSupport ? (mpSupport.me() || {}).socketId || null : null;
    myTurn = state.phase === "battle" && payload.currentTurn === meSocket;
    if (phase === "finished") {
      myShips = Array.isArray(state.myBoard?.ships) ? state.myBoard.ships : [];
    }
    // Once the server confirms a placement, advance the ship selection so
    // players can keep tapping cells without reaching for the ship chips.
    if (myShips.some((placed) => placed.name === selectedShip)) {
      selectNextShip();
    }
    render();
    // Keep the page banner in step with the battle (placement keeps the
    // "Place all five ships..." line set by enterMpMatch).
    if (phase === "battle" && mpPlaying) {
      statusEl.textContent = myTurn
        ? `Your turn - fire at ${escapeHtml(mpOpponentName())}.`
        : `${escapeHtml(mpOpponentName())} is firing...`;
    }
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
    phase = "placement";
    boardTab = "mine";
    prevPhase = null;
    myShips = [];
    myHits = {};
    enemyShots = {};
    sunkShips = [];
    myReady = false;
    opponentReady = false;
    selectedShip = SHIPS[0].name;
    horizontal = true;
    soloOpponentShips = randomFleet();
    soloHunt = [];
    soloShotCells = new Set();
    soloGameActive = true;
    statusEl.textContent = "Deploy your fleet, then destroy the enemy before they find you.";
    render();
  }

  function randomFleet() {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const placed = [];
      let valid = true;
      for (const ship of SHIPS) {
        const isHorizontal = Math.random() < 0.5;
        const row = isHorizontal ? rand(GRID) : rand(GRID - ship.size + 1);
        const col = isHorizontal ? rand(GRID - ship.size + 1) : rand(GRID);
        const cells = buildCells(row, col, isHorizontal, ship.size);
        if (!cellsInBounds(cells) || overlaps(placed, cells)) {
          valid = false;
          break;
        }
        placed.push({ name: ship.name, size: ship.size, label: ship.label, row, col, horizontal: isHorizontal, cells });
      }
      if (valid) return placed;
    }
    return [];
  }

  function rand(max) {
    return Math.floor(Math.random() * max);
  }
  function buildCells(row, col, isHorizontal, size) {
    const cells = [];
    for (let step = 0; step < size; step += 1) {
      cells.push(isHorizontal ? { row, col: col + step } : { row: row + step, col });
    }
    return cells;
  }
  function cellsInBounds(cells) {
    return cells.every((cell) => cell.row >= 0 && cell.row < GRID && cell.col >= 0 && cell.col < GRID);
  }
  function overlaps(ships, cells) {
    const occupied = new Set();
    for (const ship of ships) for (const cell of ship.cells) occupied.add(key(cell.row, cell.col));
    return cells.some((cell) => occupied.has(key(cell.row, cell.col)));
  }

  function soloPlace(row, col) {
    if (phase !== "placement" || myReady) return;
    const ship = SHIPS.find((entry) => entry.name === selectedShip);
    if (!ship) return;
    if (myShips.some((placed) => placed.name === ship.name)) return;
    const cells = buildCells(row, col, horizontal, ship.size);
    if (!cellsInBounds(cells) || overlaps(myShips, cells)) {
      window.ArcadeSFX.play("invalid");
      return;
    }
    myShips.push({ ...ship, row, col, horizontal, cells });
    window.ArcadeSFX.play("move");
    selectNextShip();
    render();
  }

  function soloRemoveShip(name) {
    myShips = myShips.filter((placed) => placed.name !== name);
    window.ArcadeSFX.play("invalid");
    render();
  }

  function soloRandomize() {
    const fleet = randomFleet();
    if (fleet.length === SHIPS.length) {
      myShips = fleet;
      window.ArcadeSFX.play("move");
      render();
    }
  }

  function soloReady() {
    if (myShips.length !== SHIPS.length) return;
    myReady = true;
    phase = "battle";
    myTurn = true;
    statusEl.textContent = "Battle! Fire at the enemy grid.";
    window.ArcadeSFX.play("turn");
    render();
  }

  function selectNextShip() {
    const remaining = SHIPS.filter((ship) => !myShips.some((placed) => placed.name === ship.name));
    selectedShip = remaining.length > 0 ? remaining[0].name : null;
  }

  function soloAttack(row, col) {
    if (phase !== "battle" || !myTurn || !soloGameActive) return;
    if (enemyShots[key(row, col)]) return;
    resolveAttack(row, col);
    if (phase === "finished") return;
    myTurn = false;
    render();
    window.setTimeout(() => {
      soloComputerAttack();
      myTurn = true;
      render();
    }, 700);
  }

  function resolveAttack(row, col) {
    let hit = false;
    let sunk = null;
    for (const ship of soloOpponentShips) {
      if (ship.cells.some((cell) => cell.row === row && cell.col === col)) {
        hit = true;
        enemyShots[key(row, col)] = "hit";
        ship.hits = (ship.hits || 0) + 1;
        if (ship.hits >= ship.size) {
          sunk = ship.label;
          sunkShips.push(sunk);
        }
        break;
      }
    }
    if (!hit) enemyShots[key(row, col)] = "miss";

    if (hit) window.ArcadeSFX.play("hit");
    else window.ArcadeSFX.play("miss");

    const allSunk = SHIPS.every((ship) => {
      const placed = soloOpponentShips.find((entry) => entry.name === ship.name);
      return placed && placed.hits >= ship.size;
    });
    if (allSunk) {
      phase = "finished";
      soloGameActive = false;
      statusEl.textContent = "Victory! You destroyed the enemy fleet.";
      window.ArcadeSFX.play("win");
    } else if (sunk) {
      statusEl.textContent = `Direct hit! Enemy ${sunk} destroyed.`;
    } else if (hit) {
      statusEl.textContent = "Direct hit!";
    } else {
      statusEl.textContent = "Miss. The enemy fires back...";
    }
    render();
  }

  function soloComputerAttack() {
    const cell = pickComputerTarget();
    if (!cell) return;
    const { row, col } = cell;
    let hit = false;
    let sunk = null;
    for (const ship of myShips) {
      if (ship.cells.some((entry) => entry.row === row && entry.col === col)) {
        hit = true;
        myHits[key(row, col)] = "hit";
        ship.hits = (ship.hits || 0) + 1;
        if (ship.hits >= ship.size) sunk = ship.label;
        break;
      }
    }
    if (!hit) myHits[key(row, col)] = "miss";
    if (hit) {
      window.ArcadeSFX.play("hit");
      // Hunt: continue around the hit.
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && !myHits[key(nr, nc)]) soloHunt.push({ row: nr, col: nc });
      });
    } else {
      window.ArcadeSFX.play("miss");
    }
    if (sunk) statusEl.textContent = `The enemy destroyed your ${sunk}!`;
    else statusEl.textContent = hit ? "The enemy scored a hit on you." : "The enemy missed.";
    render();
  }

  function pickComputerTarget() {
    while (soloHunt.length > 0) {
      const candidate = soloHunt.pop();
      if (!myHits[key(candidate.row, candidate.col)]) return candidate;
    }
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const row = rand(GRID);
      const col = rand(GRID);
      if (!myHits[key(row, col)]) return { row, col };
    }
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        if (!myHits[key(row, col)]) return { row, col };
      }
    }
    return null;
  }

  // ---- Multiplayer ----
  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    root.innerHTML = '<div class="fleet-wrap"><p class="mp-muted">Waiting for the host to start the match...</p></div>';
    controls.innerHTML = "";
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    phase = "placement";
    boardTab = "mine";
    prevPhase = null;
    selectedShip = SHIPS[0].name;
    statusEl.textContent = "Place all five ships, then press Ready.";
    render();
    renderControls();
  }

  function sendAction(action) {
    if (mpPlaying && mpSupport) mpSupport.sendAction(action);
  }

  function sendPlace(row, col) {
    if (phase !== "placement" || myReady) return;
    sendAction({ type: "place_ship", ship: selectedShip, row, col, horizontal });
  }
  function sendRemove(name) {
    sendAction({ type: "remove_ship", ship: name });
  }
  function sendRandomize() {
    sendAction({ type: "randomize_fleet" });
  }
  function sendReady() {
    sendAction({ type: "placement_ready" });
  }
  function sendAttack(row, col) {
    if (!myTurn) {
      window.ArcadeSFX.play("invalid");
      return;
    }
    sendAction({ type: "attack_cell", row, col });
  }
  async function sendSurrender() {
    if (!mpPlaying || mpResult) return;
    const ok = window.ArcadeUI ? await window.ArcadeUI.confirm("Surrender the match?", { okText: "Surrender", danger: true }) : true;
    if (!ok) return;
    sendAction({ type: "surrender" });
  }

  // ---- Rendering ----
  function buildBoard(prefix, opts) {
    const { interactive, preview, onCellClick } = opts;
    const boardEl = document.createElement("div");
    boardEl.className = `${prefix}-board fleet-board`;
    const columnLabels = document.createElement("div");
    columnLabels.className = "fleet-labels fleet-labels-cols";
    columnLabels.innerHTML = `<span></span>${Array.from({ length: GRID }, (_, c) => `<span>${String.fromCharCode(65 + c)}</span>`).join("")}`;
    boardEl.appendChild(columnLabels);

    for (let row = 0; row < GRID; row += 1) {
      const rowEl = document.createElement("div");
      rowEl.className = "fleet-row";
      const rowLabel = document.createElement("span");
      rowLabel.className = "fleet-label-row";
      rowLabel.textContent = String(row + 1);
      rowEl.appendChild(rowLabel);
      for (let col = 0; col < GRID; col += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "fleet-cell";
        cell.dataset.row = row;
        cell.dataset.col = col;
        cell.setAttribute("aria-label", `${String.fromCharCode(65 + col)}${row + 1}`);
        cell.disabled = !interactive;

        if (preview && hoverCell && hoverCell.row === row && hoverCell.col === col && phase === "placement") {
          const previewCells = buildCells(row, col, horizontal, shipSize(selectedShip));
          const valid = previewCells.every((c) => c.row >= 0 && c.row < GRID && c.col >= 0 && c.col < GRID && !shipAt(c.row, c.col));
          cell.classList.add("preview");
          cell.classList.toggle("valid", valid);
          cell.classList.toggle("invalid", !valid);
        }

        if (interactive) {
          cell.addEventListener("mouseenter", () => {
            hoverCell = { row, col };
            render();
          });
          cell.addEventListener("mouseleave", () => {
            hoverCell = null;
            render();
          });
          cell.addEventListener("click", () => onCellClick(row, col));
        }
        rowEl.appendChild(cell);
      }
      boardEl.appendChild(rowEl);
    }
    return boardEl;
  }

  function shipSize(name) {
    const ship = SHIPS.find((entry) => entry.name === name);
    return ship ? ship.size : 1;
  }

  function shipAt(row, col) {
    return myShips.some((ship) => ship.cells.some((cell) => cell.row === row && cell.col === col));
  }

  function render() {
    // When the battle starts, flip to the enemy board so the active tab
    // matches where the player has to act (they can switch back freely).
    if (prevPhase !== null && prevPhase === "placement" && phase !== "placement") {
      boardTab = "enemy";
    }
    prevPhase = phase;

    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "fleet-wrap";

    const phaseBar = document.createElement("div");
    phaseBar.className = "fleet-phases";
    phaseBar.innerHTML = ["placement", "battle", "finished"]
      .map((p) => `<span class="${phase === p ? "active" : ""}">${p === "placement" ? "Deploy" : p === "battle" ? "Battle" : "Result"}</span>`)
      .join("");
    wrap.appendChild(phaseBar);

    // Touch-screen tabs: only one board is shown at a time on phones;
    // on desktop both boards stay side by side and the tabs are hidden.
    const tabs = document.createElement("div");
    tabs.className = "fleet-tabs";
    [["mine", "My Fleet"], ["enemy", "Enemy Waters"]].forEach(([id, label]) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `fleet-tab${boardTab === id ? " active" : ""}`;
      tab.textContent = label;
      tab.addEventListener("click", () => {
        if (boardTab === id) return;
        boardTab = id;
        render();
      });
      tabs.appendChild(tab);
    });
    wrap.appendChild(tabs);

    const boards = document.createElement("div");
    boards.className = "fleet-boards";

    // My board.
    const myPanel = document.createElement("div");
    myPanel.className = "fleet-panel";
    myPanel.dataset.board = "mine";
    if (boardTab === "mine") myPanel.classList.add("active");
    const myHead = document.createElement("div");
    myHead.className = "fleet-panel-head";
    myHead.innerHTML = `<h4>My Fleet</h4><span class="fleet-count">${myShips.length}/${SHIPS.length}</span>`;
    myPanel.appendChild(myHead);

    // During placement the my-board is the placement grid: tap an empty
    // cell to drop the selected ship, tap a placed ship to remove it
    // (touch has no right-click, so the board itself is the eraser).
    const placing = phase === "placement" && !myReady && !mpResult;
    const myBoard = buildBoard("fleet-mine", {
      interactive: placing,
      preview: placing,
      onCellClick: (row, col) => {
        if (phase !== "placement" || myReady) return;
        const ship = myShips.find((entry) => entry.cells.some((c) => c.row === row && c.col === col));
        if (ship) {
          if (mpPlaying) sendRemove(ship.name);
          else soloRemoveShip(ship.name);
          return;
        }
        if (mpPlaying) sendPlace(row, col);
        else soloPlace(row, col);
      },
    });
    // Paint ships + received hits.
    myBoard.querySelectorAll(".fleet-cell").forEach((cell) => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const onShip = myShips.find((ship) => ship.cells.some((c) => c.row === row && c.col === col));
      if (onShip) {
        cell.classList.add("ship");
        const cellIndex = onShip.cells.findIndex((c) => c.row === row && c.col === col);
        cell.classList.add(`ship-${onShip.horizontal ? "h" : "v"}-${cellIndex === 0 ? "start" : cellIndex === onShip.size - 1 ? "end" : "mid"}`);
      }
      const hit = myHits[key(row, col)];
      if (hit === "hit") {
        cell.classList.add("hit");
        cell.innerHTML = '<span class="fleet-hit-mark">✕</span>';
      } else if (hit === "miss") {
        cell.classList.add("miss");
        cell.innerHTML = '<span class="fleet-miss-mark"></span>';
      }
    });
    myPanel.appendChild(myBoard);
    boards.appendChild(myPanel);

    // Enemy board.
    const enemyPanel = document.createElement("div");
    enemyPanel.className = "fleet-panel";
    enemyPanel.dataset.board = "enemy";
    if (boardTab === "enemy") enemyPanel.classList.add("active");
    const enemyHead = document.createElement("div");
    enemyHead.className = "fleet-panel-head";
    const enemyName = mpPlaying ? escapeHtml(mpOpponentName()) : "Enemy Waters";
    enemyHead.innerHTML = `<h4>${enemyName}</h4>`;
    enemyPanel.appendChild(enemyHead);

    const battleInteractive = phase === "battle" && myTurn && !mpResult;
    const enemyBoard = buildBoard("fleet-enemy", {
      interactive: battleInteractive,
      preview: false,
      onCellClick: (row, col) => {
        if (mpPlaying) sendAttack(row, col);
        else soloAttack(row, col);
      },
    });
    enemyBoard.querySelectorAll(".fleet-cell").forEach((cell) => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const shot = enemyShots[key(row, col)];
      if (shot === "hit") {
        cell.classList.add("hit");
        cell.innerHTML = '<span class="fleet-hit-mark">✕</span>';
      } else if (shot === "miss") {
        cell.classList.add("miss");
        cell.innerHTML = '<span class="fleet-miss-mark"></span>';
      }
    });
    // Reveal the enemy layout once the match is over (multiplayer).
    if (phase === "finished" && mpPlaying) {
      const state = mpSupport ? mpSupport.getGameState() : null;
      const revealed = state?.enemyBoard?.revealedShips;
      if (Array.isArray(revealed)) {
        revealed.forEach((ship) => {
          ship.cells.forEach((cell) => {
            const cellEl = enemyBoard.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
            if (cellEl) cellEl.classList.add("revealed-ship");
          });
        });
      }
    }
    enemyPanel.appendChild(enemyBoard);
    boards.appendChild(enemyPanel);

    wrap.appendChild(boards);

    const statusLine = document.createElement("p");
    statusLine.className = "fleet-status";
    statusLine.textContent = buildStatusText();
    wrap.appendChild(statusLine);

    root.appendChild(wrap);
    renderControls();
  }

  function buildStatusText() {
    if (phase === "placement") {
      if (mpPlaying && mpResult) return "Match over.";
      if (myReady) return "Fleet locked. Waiting for the opponent to deploy...";
      return `Place your ${myShips.length}/${SHIPS.length} ships, then press Ready.`;
    }
    if (phase === "battle") {
      if (!myTurn) return mpPlaying ? `${mpOpponentName()} is firing...` : "Computer is firing...";
      return `Your turn - fire at ${mpPlaying ? escapeHtml(mpOpponentName()) : "the enemy"}.`;
    }
    return mpResult
      ? "Match over."
      : "Victory! The enemy fleet is destroyed.";
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
      if (phase === "placement" && !myReady && !mpResult) {
        renderPlacementControls(true);
      } else if (!mpResult) {
        const surrender = document.createElement("button");
        surrender.className = "btn btn-outline";
        surrender.textContent = "Surrender";
        surrender.addEventListener("click", sendSurrender);
        controls.appendChild(surrender);
      }
      return;
    }

    if (phase === "placement") {
      renderPlacementControls(false);
    } else if (phase === "finished") {
      const again = document.createElement("button");
      again.className = "btn btn-primary";
      again.textContent = "Play Again";
      again.addEventListener("click", startSolo);
      controls.appendChild(again);
    }
  }

  function renderPlacementControls(isMp) {
    // Ship selector.
    const shipWrap = document.createElement("div");
    shipWrap.className = "fleet-ships";
    SHIPS.forEach((ship) => {
      const placed = myShips.some((entry) => entry.name === ship.name);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fleet-ship-chip";
      if (selectedShip === ship.name && !placed) btn.classList.add("active");
      if (placed) btn.classList.add("placed");
      btn.innerHTML = `<span>${ship.label}</span><em>${ship.size}</em>`;
      btn.disabled = placed;
      btn.addEventListener("click", () => {
        if (placed) return;
        selectedShip = ship.name;
        render();
      });
      if (placed) {
        btn.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          if (isMp) sendRemove(ship.name);
          else soloRemoveShip(ship.name);
        });
      }
      shipWrap.appendChild(btn);
    });
    controls.appendChild(shipWrap);

    if (myShips.length < SHIPS.length) {
      const rotate = document.createElement("button");
      rotate.className = "btn btn-outline";
      rotate.textContent = horizontal ? "Rotate (Vertical)" : "Rotate (Horizontal)";
      rotate.addEventListener("click", () => {
        horizontal = !horizontal;
        render();
      });
      controls.appendChild(rotate);

      const randomize = document.createElement("button");
      randomize.className = "btn btn-outline";
      randomize.textContent = "Random Placement";
      randomize.addEventListener("click", () => {
        if (isMp) sendRandomize();
        else soloRandomize();
      });
      controls.appendChild(randomize);
    }

    if (myShips.length === SHIPS.length) {
      const ready = document.createElement("button");
      ready.className = "btn btn-primary";
      ready.textContent = isMp ? "Ready" : "Ready to Battle";
      ready.addEventListener("click", () => {
        if (isMp) sendReady();
        else soloReady();
      });
      controls.appendChild(ready);
    }

    const hint = document.createElement("p");
    hint.className = "mp-muted fleet-hint";
    hint.textContent = isMp
      ? "Tap a cell to place the selected ship. Tap a placed ship to remove it."
      : "Tap a cell to place the selected ship. Tap a placed ship to remove it. Use Rotate to switch orientation.";
    controls.appendChild(hint);
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
      statusEl.textContent = "You win - the enemy fleet is destroyed!";
      window.ArcadeSFX.play("win");
    } else {
      statusEl.textContent = `Match over - ${winnerName(mpResult.winner)} wins!`;
      window.ArcadeSFX.play("lose");
    }
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    startSolo();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && phase === "placement" && !mpPlaying) {
      horizontal = !horizontal;
      render();
    }
  });

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
