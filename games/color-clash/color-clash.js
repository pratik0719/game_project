(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) return;

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("color-clash");
    config = response.clash || response;
  } catch (error) {
    statusEl.textContent = `Could not load color-clash config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load color-clash config", "error");
    return;
  }

  const COLORS = Array.isArray(config.colors?.color) ? config.colors.color : ["cyan", "pink", "green", "orange"];
  const COLOR_LABELS = { cyan: "Neon Cyan", pink: "Plasma Pink", green: "Volt Green", orange: "Solar Orange" };
  const VALUE_LABELS = {
    0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
    skip: "⊘", reverse: "⇄", draw2: "+2", wild: "★", wild4: "+4",
  };
  const HAND_SIZE = Math.max(3, Number(config.hand_size || 7));
  const BOT_COUNT = Math.min(3, Math.max(0, Number(config.bot_count || 1)));
  const TURN_SECONDS = Math.max(10, Number(config.turn_seconds || 30));
  const ACTION_VALUES = new Set(["skip", "reverse", "draw2", "wild", "wild4"]);

  // ------------------------------------------------------------------
  // Multiplayer integration. The server owns the deck, discard pile and
  // every hand; the browser only sends card/draw/wild intents.
  // ------------------------------------------------------------------
  const mpSupport = window.MultiplayerGameSupport ? window.MultiplayerGameSupport.create("color-clash", {
    onStatus: onMpStatus,
    onRoom: onMpRoom,
    onMatchStart: onMpMatchStart,
    onState: onMpState,
    onGameOver: onMpGameOver,
    onMatchEnded: onMpMatchEnded,
  }) : null;
  const MP_GAME = "color-clash";
  const urlRoomCode = new URLSearchParams(window.location.search).get("room");
  let mpWaiting = false;
  let mpPlaying = false;
  let mpResult = null;

  // Shared render state.
  let myHand = [];
  let opponents = []; // { sessionId, name, cardCount, eliminated }
  let topCard = null;
  let activeColor = null;
  let direction = 1;
  let isMyTurn = false;
  let drawPileCount = 0;
  let pendingWild = false;
  let pendingDraw = false;
  let canChallenge = false;
  let challengeTarget = null;
  let currentTurnSession = null;
  let autoDeclared = false;
  let lastEvent = null;
  let turnStartedAt = 0;
  let winnerName = null;
  let ranking = [];
  let revealedHands = null;
  let gameFinished = false;
  let timerId = null;

  // Solo engine state.
  let solo = null; // { deck, discard, hands, activeColor, direction, currentIndex, playersToSkip, pendingWild, pendingDraw, pendingWild4, winner, finished, turnStartedAt }

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
    if (mpPlaying) applyMpState(payload.gameState);
  }
  function onMpGameOver(payload) {
    if (!payload || payload.gameId !== MP_GAME) return;
    mpResult = { winner: payload.winner ?? null, draw: Boolean(payload.draw) };
    applyMpState(payload.gameState);
    renderControls();
    updateMpResultText();
  }
  function onMpMatchEnded() {
    if (!mpWaiting && !mpPlaying) return;
    const room = mpSupport ? mpSupport.getRoom() : null;
    if (!room || room.gameId !== MP_GAME) exitMultiplayer();
    else enterMpWaiting();
  }

  function applyMpState(state) {
    if (!state) return;
    myHand = Array.isArray(state.myHand) ? state.myHand : [];
    opponents = Array.isArray(state.opponents) ? state.opponents : [];
    topCard = state.topCard || null;
    activeColor = state.activeColor || null;
    direction = Number(state.direction || 1);
    isMyTurn = Boolean(state.isMyTurn);
    drawPileCount = Number(state.drawPileCount || 0);
    pendingWild = Boolean(state.pendingWild);
    pendingDraw = Boolean(state.pendingDraw);
    canChallenge = Boolean(state.canChallenge);
    challengeTarget = state.challengeTarget || null;
    currentTurnSession = state.currentTurnSession || null;
    autoDeclared = Boolean(state.autoDeclared);
    lastEvent = state.lastEvent || null;
    turnStartedAt = state.turnStartedAt || Date.now();
    winnerName = state.winnerName || null;
    ranking = Array.isArray(state.ranking) ? state.ranking : [];
    revealedHands = Array.isArray(state.revealedHands) ? state.revealedHands : null;
    gameFinished = Boolean(state.finished);
    render();
  }

  // ---- Single-player engine (mirrors the server rules) ----
  // Declared before the boot section below so startSolo/buildDeck (which run
  // first) never hit the let temporal-dead-zone.
  let cardId = 0;

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

  function buildDeck() {
    const deck = [];
    for (const color of COLORS) {
      deck.push({ id: cardId += 1, color, value: 0 });
      for (let value = 1; value <= 9; value += 1) {
        deck.push({ id: cardId += 1, color, value });
        deck.push({ id: cardId += 1, color, value });
      }
      for (const value of ["skip", "reverse", "draw2"]) {
        deck.push({ id: cardId += 1, color, value });
        deck.push({ id: cardId += 1, color, value });
      }
    }
    for (let i = 0; i < 4; i += 1) {
      deck.push({ id: cardId += 1, color: "wild", value: "wild" });
      deck.push({ id: cardId += 1, color: "wild", value: "wild4" });
    }
    return shuffle(deck);
  }

  function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
  }

  function canPlay(card, color, top) {
    if (!card) return false;
    if (card.value === "wild" || card.value === "wild4") return true;
    if (card.color === color) return true;
    if (top && card.color !== "wild" && top.color !== "wild" && card.value === top.value) return true;
    return false;
  }

  function startSolo() {
    const deck = buildDeck();
    const hands = [];
    const names = ["You", "Bot"];
    const botNames = ["Volt", "Nova", "Blaze"];
    const players = [];
    for (let i = 0; i <= BOT_COUNT; i += 1) {
      players.push({ name: i === 0 ? "You" : botNames[i - 1] || `Bot ${i}` });
    }
    const handsMap = {};
    players.forEach((player, index) => {
      handsMap[index] = deck.splice(0, HAND_SIZE);
    });

    // Starter card: a number card.
    let discard = [];
    let activeColor = "cyan";
    for (let attempt = 0; attempt < deck.length; attempt += 1) {
      const card = deck.shift();
      if (typeof card.value === "number") {
        discard = [card];
        activeColor = card.color;
        break;
      }
      deck.push(card);
    }
    if (discard.length === 0) {
      discard = [deck.pop() || { id: 0, color: COLORS[0], value: 0 }];
      activeColor = discard[0].color;
    }

    solo = {
      deck,
      discard,
      hands: handsMap,
      activeColor,
      direction: 1,
      currentIndex: Math.floor(Math.random() * players.length),
      players,
      playersToSkip: 0,
      pendingWild: null,
      pendingWild4: false,
      pendingDraw: null,
      winner: null,
      finished: false,
      turnStartedAt: Date.now(),
    };

    myHand = handsMap[0];
    opponents = players.slice(1).map((player, index) => ({
      sessionId: String(index),
      name: player.name,
      cardCount: handsMap[index + 1].length,
    }));
    topCard = discard[discard.length - 1];
    activeColor = solo.activeColor;
    direction = 1;
    drawPileCount = deck.length;
    gameFinished = false;
    ranking = [];
    revealedHands = null;
    statusEl.textContent = "Match colors and numbers. First to empty their hand wins!";
    render();
    scheduleSolo();
  }

  function scheduleSolo() {
    stopTimer();
    if (!solo || solo.finished) {
      // Still refresh the DOM so a finished match shows its result screen.
      if (solo && solo.finished) {
        syncSoloRender();
        render();
      }
      return;
    }
    const current = solo.players[solo.currentIndex];
    if (current.name === "You") {
      isMyTurn = true;
      syncSoloRender();
      render();
      startSoloTimer();
      return;
    }
    isMyTurn = false;
    syncSoloRender();
    render();
    window.setTimeout(runBotTurn, 800);
  }

  function startSoloTimer() {
    stopTimer();
    solo.turnStartedAt = Date.now();
    timerId = window.setInterval(() => {
      if (!solo || solo.finished || solo.players[solo.currentIndex].name !== "You") return;
      const elapsed = Date.now() - solo.turnStartedAt;
      const bar = document.querySelector(".clash-timer-bar > span");
      if (bar) bar.style.width = `${Math.max(0, 100 - (elapsed / (TURN_SECONDS * 1000)) * 100)}%`;
      if (elapsed >= TURN_SECONDS * 1000) {
        stopTimer();
        soloDraw();
        soloAdvance();
      }
    }, 250);
  }

  function runBotTurn() {
    if (!solo || solo.finished) return;
    const index = solo.currentIndex;
    const hand = solo.hands[index];

    if (solo.pendingWild === index) {
      // Pick the most common color in the bot's hand.
      const counts = {};
      for (const card of hand) {
        if (card.color !== "wild") counts[card.color] = (counts[card.color] || 0) + 1;
      }
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || COLORS[0];
      solo.activeColor = best;
      solo.pendingWild = null;
      if (solo.pendingWild4) {
        solo.pendingWild4 = false;
        const nextIndex = nextPlayerIndex();
        drawCardsFor(nextIndex, 4);
        solo.playersToSkip += 1;
      }
      soloAdvance();
      return;
    }

    if (solo.pendingDraw === index) {
      const card = hand[hand.length - 1];
      if (canPlay(card, solo.activeColor, topCard)) {
        soloPlay(index, card);
      } else {
        solo.pendingDraw = null;
        soloAdvance();
      }
      return;
    }

    const playable = hand.find((card) => canPlay(card, solo.activeColor, topCard));
    if (playable) {
      soloPlay(index, playable);
    } else {
      soloDraw();
      soloAdvance();
    }
  }

  function nextPlayerIndex() {
    const count = solo.players.length;
    let index = (solo.currentIndex + solo.direction + count) % count;
    return index;
  }

  function drawCardsFor(playerIndex, count) {
    for (let i = 0; i < count; i += 1) {
      if (solo.deck.length === 0) {
        const top = solo.discard.pop();
        solo.deck = shuffle(solo.discard);
        solo.discard = [top];
      }
      if (solo.deck.length === 0) break;
      solo.hands[playerIndex].push(solo.deck.pop());
    }
  }

  function soloPlay(playerIndex, card) {
    const hand = solo.hands[playerIndex];
    const idx = hand.findIndex((entry) => entry.id === card.id);
    if (idx === -1) return;
    const [played] = hand.splice(idx, 1);
    solo.discard.push(played);
    const player = solo.players[playerIndex];

    if (played.value === "wild" || played.value === "wild4") {
      solo.activeColor = null;
      solo.pendingWild = playerIndex;
      solo.pendingWild4 = played.value === "wild4";
      afterPlayChecks(playerIndex);
      if (playerIndex === 0) {
        syncSoloRender();
        // Re-render so the wild-color picker (renderControls) becomes visible;
        // if this emptied the hand, render() shows the finished result screen.
        render();
      }
      return;
    }

    solo.activeColor = played.color;
    if (played.value === "skip") {
      solo.playersToSkip += 1;
    } else if (played.value === "reverse") {
      if (solo.players.length === 2) solo.playersToSkip += 1;
      else solo.direction *= -1;
    } else if (played.value === "draw2") {
      drawCardsFor(nextPlayerIndex(), 2);
      solo.playersToSkip += 1;
    }

    afterPlayChecks(playerIndex);
    if (playerIndex === 0) syncSoloRender();
  }

  function afterPlayChecks(playerIndex) {
    const hand = solo.hands[playerIndex];
    if (hand.length === 0) {
      solo.winner = playerIndex;
      solo.finished = true;
      return;
    }
    if (hand.length === 1 && playerIndex === 0) {
      // The human must have pressed the Last Card button (already validated
      // by the UI); auto-declare in solo for simplicity.
    }
  }

  function soloDraw() {
    if (solo.pendingWild !== null) return;
    if (solo.deck.length === 0) {
      const top = solo.discard.pop();
      solo.deck = shuffle(solo.discard);
      solo.discard = [top];
    }
    if (solo.deck.length === 0) return;
    const card = solo.deck.pop();
    solo.hands[solo.currentIndex].push(card);
    if (canPlay(card, solo.activeColor, topCard)) {
      solo.pendingDraw = solo.currentIndex;
    }
  }

  function soloAdvance() {
    if (!solo) return;
    solo.pendingChallenge = null;
    if (solo.pendingWild !== null || solo.pendingDraw !== null) {
      scheduleSolo();
      return;
    }
    const count = solo.players.length;
    let index = solo.currentIndex;
    const steps = 1 + (solo.playersToSkip || 0);
    solo.playersToSkip = 0;
    for (let step = 0; step < steps; step += 1) {
      index = (index + solo.direction + count) % count;
    }
    solo.currentIndex = index;
    syncSoloRender();
    scheduleSolo();
  }

  function syncSoloRender() {
    if (!solo) return;
    myHand = solo.hands[0];
    opponents = solo.players.slice(1).map((player, index) => ({
      sessionId: String(index),
      name: player.name,
      cardCount: solo.hands[index + 1].length,
    }));
    topCard = solo.discard[solo.discard.length - 1];
    activeColor = solo.activeColor;
    direction = solo.direction;
    drawPileCount = solo.deck.length;
    pendingWild = solo.pendingWild === 0;
    pendingDraw = solo.pendingDraw === 0;
    gameFinished = Boolean(solo.finished);
    winnerName = solo.finished ? solo.players[solo.winner].name : null;
    const counts = solo.players.map((p, i) => ({ name: p.name, cards: solo.hands[i].length }));
    ranking = counts.slice().sort((a, b) => a.cards - b.cards);
    if (solo.finished) {
      revealedHands = solo.players.map((p, i) => ({ sessionId: String(i), name: p.name, cards: solo.hands[i] }));
    }
  }

  function soloHumanPlay(card) {
    if (!solo || solo.finished || !isMyTurn) return;
    if (solo.pendingWild !== null) return;
    if (!canPlay(card, solo.activeColor, topCard)) {
      window.ArcadeSFX.play("invalid");
      return;
    }
    // Last Card rule: when holding two cards, the Last Card button must be
    // pressed; the card click first opens the confirmation.
    if (myHand.length === 2 && !lastCardConfirmed) {
      window.ArcadeAPI.toast("Press the Last Card button to play your second-to-last card!", "info");
      window.ArcadeSFX.play("invalid");
      return;
    }
    lastCardConfirmed = false;
    soloPlay(0, card);
    soloAdvance();
  }

  function soloHumanDraw() {
    if (!solo || solo.finished || !isMyTurn) return;
    if (solo.pendingWild !== null || solo.pendingDraw !== null) return;
    soloDraw();
    if (solo.pendingDraw === 0) {
      syncSoloRender();
      render();
    } else {
      soloAdvance();
    }
  }

  function soloHumanPass() {
    if (!solo || !isMyTurn || solo.pendingDraw !== 0) return;
    solo.pendingDraw = null;
    soloAdvance();
  }

  function soloChooseColor(color) {
    if (!solo || solo.pendingWild !== 0) return;
    solo.activeColor = color;
    solo.pendingWild = null;
    if (solo.pendingWild4) {
      solo.pendingWild4 = false;
      drawCardsFor(nextPlayerIndex(), 4);
      solo.playersToSkip += 1;
    }
    soloAdvance();
  }

  let lastCardConfirmed = false;

  // ---- Multiplayer ----
  function enterMpWaiting() {
    mpWaiting = true;
    mpPlaying = false;
    mpResult = null;
    stopTimer();
    statusEl.textContent = "In a multiplayer room. Waiting for the host to start the match...";
    root.innerHTML = '<div class="clash-wrap"><p class="mp-muted">Waiting for the host to start the match...</p></div>';
    controls.innerHTML = "";
  }

  function enterMpMatch() {
    if (!mpSupport) return;
    const room = mpSupport.getRoom();
    if (!room || room.gameId !== MP_GAME) return;
    mpWaiting = false;
    mpPlaying = true;
    mpResult = null;
    statusEl.textContent = "Match colors, numbers and powers. First to zero cards wins!";
    render();
    renderControls();
  }

  function sendPlay(cardId, lastCard) {
    if (!mpPlaying || !isMyTurn) return;
    if (mpSupport) mpSupport.sendAction({ type: "play_card", cardId, lastCard: Boolean(lastCard) });
  }
  function sendDraw() {
    if (mpPlaying && mpSupport) mpSupport.sendAction({ type: "draw_card" });
  }
  function sendPass() {
    if (mpPlaying && mpSupport) mpSupport.sendAction({ type: "pass_turn" });
  }
  function sendWildColor(color) {
    if (mpPlaying && mpSupport) mpSupport.sendAction({ type: "choose_wild_color", color });
  }
  function sendChallenge() {
    if (mpPlaying && mpSupport) mpSupport.sendAction({ type: "challenge_last_card" });
  }
  function sendSurrender() {
    if (!mpPlaying || mpResult) return;
    if (!window.confirm("Surrender the match?")) return;
    if (mpSupport) mpSupport.sendAction({ type: "surrender" });
  }

  // ---- Rendering ----
  function stopTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function startTurnTimer() {
    stopTimer();
    if (!mpPlaying && !solo) return;
    if (!isMyTurn || gameFinished) return;
    const started = mpPlaying ? turnStartedAt : solo.turnStartedAt;
    if (!started) return;
    timerId = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const bar = document.querySelector(".clash-timer-bar > span");
      if (bar) bar.style.width = `${Math.max(0, 100 - (elapsed / (TURN_SECONDS * 1000)) * 100)}%`;
      const label = document.querySelector(".clash-turn-timer-label");
      if (label) label.textContent = `${Math.max(0, Math.ceil((TURN_SECONDS * 1000 - elapsed) / 1000))}s`;
    }, 250);
  }

  function cardHtml(card, playable, clickable) {
    const colorClass = card.color === "wild" ? "wild" : card.color;
    const label = VALUE_LABELS[card.value] !== undefined ? VALUE_LABELS[card.value] : String(card.value);
    const cardEl = document.createElement("button");
    cardEl.type = "button";
    cardEl.className = `clash-card ${colorClass}`;
    if (playable) cardEl.classList.add("playable");
    cardEl.disabled = !clickable;
    cardEl.innerHTML = `<span class="clash-card-corner">${escapeHtml(label)}</span><span class="clash-card-main">${escapeHtml(label)}</span>`;
    return cardEl;
  }

  function render() {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "clash-wrap";

    // Opponents row.
    const opponentsRow = document.createElement("div");
    opponentsRow.className = "clash-opponents";
    opponents.forEach((opponent, index) => {
      const chip = document.createElement("div");
      chip.className = "clash-opponent";
      const isTheirTurn = mpPlaying
        ? currentTurnSession === opponent.sessionId
        : Boolean(solo && solo.players[solo.currentIndex].name === opponent.name);
      if (isTheirTurn) chip.classList.add("turn");
      chip.innerHTML = `
        <span class="clash-avatar">${escapeHtml((opponent.name || "?").charAt(0).toUpperCase())}</span>
        <span class="clash-opp-name">${escapeHtml(opponent.name)}</span>
        <span class="clash-opp-cards">${opponent.cardCount} card${opponent.cardCount === 1 ? "" : "s"}</span>
      `;
      opponentsRow.appendChild(chip);
    });
    wrap.appendChild(opponentsRow);

    // Center: draw pile + discard + status.
    const center = document.createElement("div");
    center.className = "clash-center";

    const drawPile = document.createElement("button");
    drawPile.type = "button";
    drawPile.className = "clash-pile clash-draw";
    drawPile.innerHTML = `<span class="clash-card-back">⚡</span>`;
    drawPile.title = `Draw pile (${drawPileCount} cards)`;
    drawPile.disabled = !isMyTurn || pendingWild || pendingDraw || gameFinished;
    drawPile.addEventListener("click", () => {
      if (mpPlaying) sendDraw();
      else soloHumanDraw();
    });

    const discardEl = document.createElement("div");
    discardEl.className = "clash-pile clash-discard";
    if (topCard) {
      const colorClass = topCard.color === "wild" ? "wild" : topCard.color;
      const label = VALUE_LABELS[topCard.value] !== undefined ? VALUE_LABELS[topCard.value] : String(topCard.value);
      discardEl.innerHTML = `<span class="clash-card ${colorClass}"><span class="clash-card-main">${escapeHtml(label)}</span></span>`;
    } else {
      discardEl.innerHTML = '<span class="clash-card muted-card"></span>';
    }

    center.appendChild(drawPile);
    center.appendChild(discardEl);
    wrap.appendChild(center);

    // Active color + direction + timer + last event.
    const info = document.createElement("div");
    info.className = "clash-info";
    const colorSwatch = activeColor ? `<span class="clash-color-chip ${activeColor}">${escapeHtml(COLOR_LABELS[activeColor] || activeColor)}</span>` : '<span class="clash-color-chip wild">Wild</span>';
    const directionLabel = mpPlaying || solo ? (direction === 1 ? "→" : "←") : "";
    info.innerHTML = `
      <span class="clash-turn-timer">${colorSwatch}</span>
      <span class="clash-direction">${directionLabel}</span>
      ${isMyTurn && !gameFinished ? '<div class="clash-turn-timer-bar"><div class="clash-timer-bar"><span style="width:100%"></span></div><span class="clash-turn-timer-label"></span></div>' : ""}
    `;
    wrap.appendChild(info);

    if (lastEvent && !gameFinished) {
      const eventLine = document.createElement("p");
      eventLine.className = "clash-event";
      eventLine.textContent = lastEvent.text || "";
      wrap.appendChild(eventLine);
    }

    if (canChallenge) {
      const challengeRow = document.createElement("div");
      challengeRow.className = "clash-challenge";
      challengeRow.innerHTML = `<span>${escapeHtml(challengeTarget || "A player")} forgot to declare Last Card!</span>`;
      const challengeBtn = document.createElement("button");
      challengeBtn.type = "button";
      challengeBtn.className = "btn btn-primary";
      challengeBtn.textContent = "Challenge (+2)";
      challengeBtn.addEventListener("click", () => {
        if (mpPlaying) sendChallenge();
      });
      challengeRow.appendChild(challengeBtn);
      wrap.appendChild(challengeRow);
    }

    if (gameFinished) {
      const result = document.createElement("div");
      result.className = "clash-result";
      result.innerHTML = `<h3>${escapeHtml(winnerName || "Match over")} wins!</h3>`;
      const list = document.createElement("ol");
      list.className = "clash-ranking";
      ranking.forEach((entry, index) => {
        const row = document.createElement("li");
        row.textContent = `${index + 1}. ${entry.name} - ${entry.cards} card${entry.cards === 1 ? "" : "s"} left`;
        list.appendChild(row);
      });
      result.appendChild(list);
      wrap.appendChild(result);
    }

    // My hand.
    if (myHand.length > 0) {
      const handEl = document.createElement("div");
      handEl.className = "clash-hand";
      myHand.forEach((card) => {
        const playable = canPlay(card, activeColor, topCard) && isMyTurn && !pendingWild && !gameFinished && !(mpPlaying && mpResult);
        const clickable = playable;
        const cardEl = cardHtml(card, playable, clickable);
        if (clickable) {
          cardEl.addEventListener("click", () => {
            if (mpPlaying) {
              const needsLast = myHand.length === 2 && !pendingDraw;
              if (needsLast && !lastCardConfirmed) {
                window.ArcadeAPI.toast("Press the Last Card button to play your second-to-last card!", "info");
                window.ArcadeSFX.play("invalid");
                return;
              }
              lastCardConfirmed = false;
              sendPlay(card.id, needsLast);
            } else {
              soloHumanPlay(card);
            }
          });
        }
        handEl.appendChild(cardEl);
      });
      wrap.appendChild(handEl);
    }

    root.appendChild(wrap);
    renderControls();
    startTurnTimer();
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
      if (isMyTurn && !gameFinished && !mpResult) {
        if (pendingWild) {
          const wildWrap = document.createElement("div");
          wildWrap.className = "clash-wild-row";
          wildWrap.innerHTML = "<span class='mp-muted'>Choose a color:</span>";
          COLORS.forEach((color) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `btn btn-outline clash-color-btn ${color}`;
            btn.textContent = COLOR_LABELS[color] || color;
            btn.addEventListener("click", () => sendWildColor(color));
            wildWrap.appendChild(btn);
          });
          controls.appendChild(wildWrap);
        } else if (pendingDraw) {
          const pass = document.createElement("button");
          pass.className = "btn btn-outline";
          pass.textContent = "Pass";
          pass.addEventListener("click", () => {
            if (mpPlaying) sendPass();
          });
          controls.appendChild(pass);
        } else {
          if (myHand.length === 2) {
            const lastCard = document.createElement("button");
            lastCard.className = "btn btn-primary clash-last-btn";
            lastCard.textContent = "Last Card!";
            lastCard.addEventListener("click", () => {
              lastCardConfirmed = true;
              window.ArcadeSFX.play("card");
            });
            controls.appendChild(lastCard);
          }
          const draw = document.createElement("button");
          draw.className = "btn btn-outline";
          draw.textContent = "Draw Card";
          draw.addEventListener("click", () => {
            if (mpPlaying) sendDraw();
          });
          controls.appendChild(draw);
        }
      }
      if (!mpResult) {
        const surrender = document.createElement("button");
        surrender.className = "btn btn-outline";
        surrender.textContent = "Surrender";
        surrender.addEventListener("click", sendSurrender);
        controls.appendChild(surrender);
      }
      return;
    }

    // Solo controls.
    if (solo && !solo.finished && isMyTurn) {
      if (solo.pendingWild === 0) {
        const wildWrap = document.createElement("div");
        wildWrap.className = "clash-wild-row";
        wildWrap.innerHTML = "<span class='mp-muted'>Choose a color:</span>";
        COLORS.forEach((color) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `btn btn-outline clash-color-btn ${color}`;
          btn.textContent = COLOR_LABELS[color] || color;
          btn.addEventListener("click", () => soloChooseColor(color));
          wildWrap.appendChild(btn);
        });
        controls.appendChild(wildWrap);
      } else if (solo.pendingDraw === 0) {
        const pass = document.createElement("button");
        pass.className = "btn btn-outline";
        pass.textContent = "Pass";
        pass.addEventListener("click", soloHumanPass);
        controls.appendChild(pass);
      } else {
        if (myHand.length === 2) {
          const lastCard = document.createElement("button");
          lastCard.className = "btn btn-primary clash-last-btn";
          lastCard.textContent = "Last Card!";
          lastCard.addEventListener("click", () => {
            lastCardConfirmed = true;
            window.ArcadeSFX.play("card");
          });
          controls.appendChild(lastCard);
        }
        const draw = document.createElement("button");
        draw.className = "btn btn-outline";
        draw.textContent = "Draw Card";
        draw.addEventListener("click", soloHumanDraw);
        controls.appendChild(draw);
      }
    }
    if (solo && solo.finished) {
      const again = document.createElement("button");
      again.className = "btn btn-primary";
      again.textContent = "Play Again";
      again.addEventListener("click", startSolo);
      controls.appendChild(again);
    }
  }

  function updateMpResultText() {
    if (!mpPlaying) return;
    const players = mpSupport ? mpSupport.getPlayers() : [];
    const myNumber = mpSupport ? mpSupport.myPlayerNumber() : null;
    const winnerNameFn = (pn) => {
      const player = players.find((entry) => entry.playerNumber === pn);
      return player ? player.name : `Player ${pn}`;
    };
    if (mpResult.draw) {
      statusEl.textContent = "Match over - it is a draw!";
    } else if (mpResult.winner === myNumber) {
      statusEl.textContent = "You win - Color Clash!";
      window.ArcadeSFX.play("win");
    } else {
      statusEl.textContent = `Match over - ${winnerNameFn(mpResult.winner)} wins!`;
      window.ArcadeSFX.play("lose");
    }
  }

  function exitMultiplayer() {
    if (!mpWaiting && !mpPlaying) return;
    mpWaiting = false;
    mpPlaying = false;
    mpResult = null;
    stopTimer();
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
