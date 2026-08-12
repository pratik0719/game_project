(function () {
  const panel = document.getElementById("multiplayer-panel");
  if (!panel || typeof io !== "function") return;

  const STORAGE = {
    name: "playerName",
    clientId: "arcadeMultiplayerClientId",
    sessionId: "playerSessionId",
    roomCode: "roomCode",
    gameId: "gameId",
    legacyName: "arcadeMultiplayerName",
    legacyLastRoom: "arcadeMultiplayerLastRoom",
  };

  const state = {
    socket: null,
    room: null,
    playerName: "",
    clientId: getOrCreateClientId(),
    playerSessionId: getPlayerSessionId(),
    currentGame: (panel.dataset.currentGame || "").trim().toLowerCase(),
    registry: null, // full game registry from /api/multiplayer/config
    selectedGameId: "", // game chosen in the picker (home page)
    pickerOpen: false,
    mpStarting: false, // true between clicking Start Game and the match opening
  };

  const els = {
    connection: document.getElementById("mp-connection"),
    rvConnection: document.getElementById("mp-rv-connection"),
    nameForm: document.getElementById("mp-name-form"),
    nameInput: document.getElementById("mp-player-name"),
    nameError: document.getElementById("mp-name-error"),
    createForm: document.getElementById("mp-create-form"),
    createRoomBtn: document.getElementById("mp-create-room-btn"),
    createNote: document.getElementById("mp-create-note"),
    gameSelect: document.getElementById("mp-game-select"),
    joinForm: document.getElementById("mp-join-form"),
    roomCodeInput: document.getElementById("mp-room-code"),
    actionError: document.getElementById("mp-action-error"),
    // Home-page lobby
    lobby: document.getElementById("mp-lobby"),
    lobbyIcon: document.getElementById("mp-lobby-icon"),
    lobbyCode: document.getElementById("mp-lobby-code"),
    lobbyCodeDisplay: document.getElementById("mp-lobby-code-display"),
    lobbyGame: document.getElementById("mp-lobby-game-name"),
    lobbyStatus: document.getElementById("mp-lobby-status"),
    // Game-page room view
    rvRoot: document.getElementById("mp-room-view"),
    rvIcon: document.getElementById("mp-rv-icon"),
    rvCode: document.getElementById("mp-rv-code"),
    rvGameName: document.getElementById("mp-rv-game-name"),
    rvStatus: document.getElementById("mp-rv-status"),
    // Shared room controls
    roomCount: document.getElementById("mp-room-count"),
    copyCode: document.getElementById("mp-copy-code"),
    copyLink: document.getElementById("mp-copy-link"),
    startGame: document.getElementById("mp-start-game"),
    leaveRoom: document.getElementById("mp-leave-room"),
    playerList: document.getElementById("mp-player-list"),
    chatMount: document.getElementById("mp-chat-mount"),
  };

  let chatInstance = null;
  let chatRoomCode = null;

  /**
   * Bridge exposed to game scripts. Games only ever receive server-provided
   * state and only ever send move intents.
   */
  const listeners = {
    room: [],
    game_started: [],
    game_state: [],
    game_over: [],
    match_ended: [],
    player_left: [],
    room_error: [],
  };

  const api = {
    getRoom() {
      return state.room;
    },
    getGameState() {
      return state.room?.gameState || null;
    },
    getSocketId() {
      return state.socket?.id || null;
    },
    getRole() {
      return me()?.role || null;
    },
    isMyTurn() {
      return Boolean(state.room && state.socket && state.room.currentTurn === state.socket.id);
    },
    isInRoom() {
      return Boolean(state.room);
    },
    isMatchActive() {
      return Boolean(state.room && state.room.status === "playing" && state.room.gameState);
    },
    getRegistry() {
      return state.registry || null;
    },
    sendAction(action) {
      if (!state.room || !state.socket?.connected) return false;
      state.socket.emit("game_action", { roomCode: state.room.code, gameId: state.room.gameId, action });
      return true;
    },
    playAgain() {
      if (!state.room || !state.socket?.connected) return false;
      state.socket.emit("play_again", { roomCode: state.room.code });
      return true;
    },
    requestRoomState() {
      if (!state.room || !state.socket?.connected) return;
      state.socket.emit("request_room_state", { roomCode: state.room.code });
    },
    leaveRoom() {
      leaveCurrentRoom();
    },
    openRoomGame(gameId, roomCode, gameRoute) {
      openRoomGame(gameId, roomCode, gameRoute);
    },
    openCreateRoomModal(gameId) {
      openCreateRoomModal(gameId || "");
    },
    on(event, callback) {
      if (!listeners[event]) return;
      listeners[event].push(callback);
    },
    off(event, callback) {
      const list = listeners[event];
      if (!list) return;
      const index = list.indexOf(callback);
      if (index !== -1) list.splice(index, 1);
    },
  };
  window.MultiplayerAPI = api;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    state.playerName =
      sessionStorage.getItem(STORAGE.name) ||
      localStorage.getItem(STORAGE.name) ||
      sessionStorage.getItem(STORAGE.legacyName) ||
      localStorage.getItem(STORAGE.legacyName) ||
      "";
    if (els.nameInput) els.nameInput.value = state.playerName;

    // Every game on the platform supports multiplayer now.
    if (els.createRoomBtn) els.createRoomBtn.disabled = false;
    if (els.createNote) els.createNote.hidden = true;

    loadRegistry().then(() => {
      buildGamePicker();
      bindPicker();
      bindGameCardButtons();
    });

    state.socket = io({ transports: ["websocket", "polling"] });
    bindSocket();
    bindForms();
    hydrateInviteCode();
  }

  async function loadRegistry() {
    try {
      const response = await window.ArcadeAPI.requestJSON("/api/multiplayer/config");
      const registry = response.registry || response.games || {};
      state.registry = {};
      for (const [id, game] of Object.entries(registry)) {
        state.registry[id] = {
          id,
          name: game.name || game.title || id,
          icon: game.icon || "🎮",
          accent: game.accent || "#39ff14",
          description: game.description || "",
          minPlayers: Number(game.minPlayers || 2),
          maxPlayers: Number(game.maxPlayers || 2),
          mode: game.mode || "turn-based",
        };
      }
      // Seed the home-page select with every registered game.
      if (els.gameSelect && els.gameSelect.tagName === "SELECT") {
        els.gameSelect.innerHTML = Object.values(state.registry)
          .map((game) => `<option value="${escapeAttr(game.id)}">${escapeHtml(game.name)}</option>`)
          .join("");
      }
    } catch (_error) {
      state.registry = null;
    }
  }

  // ------------------------------------------------------------------
  // Game-selection modal (generated from the central game registry).
  // ------------------------------------------------------------------

  let picker = null;
  let pickerBound = false;
  let cardsBound = false;

  function buildGamePicker() {
    if (!state.registry) return;
    if (document.getElementById("mp-picker-modal")) return;

    const modal = document.createElement("div");
    modal.id = "mp-picker-modal";
    modal.className = "modal hidden";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-card card-surface mp-picker-box">
        <div class="mp-picker-head">
          <div>
            <p class="eyebrow">MULTIPLAYER</p>
            <h3 id="mp-picker-title">Choose a game</h3>
            <p class="mp-muted">Pick any of the ${Object.keys(state.registry).length} games to create a multiplayer room.</p>
          </div>
          <button class="btn btn-outline mp-picker-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div id="mp-picker-grid" class="mp-picker-grid"></div>
        <div id="mp-picker-step2" class="mp-picker-step2 hidden">
          <p id="mp-picker-selected" class="mp-picker-selected"></p>
          <div class="mp-picker-form">
            <label for="mp-picker-name">Player name</label>
            <input id="mp-picker-name" type="text" maxlength="20" autocomplete="nickname" placeholder="ArcadeHero" />
            <div class="mp-actions">
              <button id="mp-picker-create" class="btn btn-primary" type="button">Create Room</button>
              <button id="mp-picker-change" class="btn btn-outline" type="button">Change Game</button>
              <button id="mp-picker-cancel" class="btn btn-outline" type="button">Cancel</button>
            </div>
          </div>
        </div>
        <p id="mp-picker-error" class="mp-error" aria-live="polite"></p>
      </div>
    `;
    document.body.appendChild(modal);

    const grid = modal.querySelector("#mp-picker-grid");
    Object.values(state.registry).forEach((game) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "mp-picker-card";
      card.dataset.game = game.id;
      card.style.setProperty("--accent", game.accent);
      card.innerHTML = `
        <span class="mp-picker-icon">${escapeHtml(game.icon)}</span>
        <span class="mp-picker-name">${escapeHtml(game.name)}</span>
        <span class="mp-picker-players">${playersLabel(game)}</span>
      `;
      card.addEventListener("click", () => selectPickerGame(game.id));
      grid.appendChild(card);
    });

    picker = {
      modal,
      grid,
      step2: modal.querySelector("#mp-picker-step2"),
      selected: modal.querySelector("#mp-picker-selected"),
      nameInput: modal.querySelector("#mp-picker-name"),
      error: modal.querySelector("#mp-picker-error"),
      createBtn: modal.querySelector("#mp-picker-create"),
      changeBtn: modal.querySelector("#mp-picker-change"),
      cancelBtn: modal.querySelector("#mp-picker-cancel"),
      closeBtn: modal.querySelector(".mp-picker-close"),
      title: modal.querySelector("#mp-picker-title"),
    };
  }

  function bindPicker() {
    if (!picker || pickerBound) return;
    pickerBound = true;
    picker.closeBtn.addEventListener("click", closePicker);
    picker.cancelBtn.addEventListener("click", closePicker);
    picker.changeBtn.addEventListener("click", () => {
      picker.step2.classList.add("hidden");
      state.selectedGameId = "";
      clearNode(picker.grid.querySelectorAll(".selected"));
      picker.error.textContent = "";
    });
    picker.createBtn.addEventListener("click", () => {
      const name = pickerName();
      if (!name) return;
      if (!state.selectedGameId) {
        picker.error.textContent = "No game selected. Choose a game first.";
        return;
      }
      createRoom(state.selectedGameId, name, (error) => {
        if (error) {
          picker.error.textContent = error;
          return;
        }
        closePicker();
      });
    });
    picker.modal.addEventListener("click", (event) => {
      if (event.target === picker.modal) closePicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.pickerOpen) closePicker();
    });
  }

  function bindGameCardButtons() {
    if (cardsBound) return;
    cardsBound = true;
    document.querySelectorAll("[data-mp-open-game]").forEach((button) => {
      button.addEventListener("click", () => {
        openCreateRoomModal(button.dataset.mpOpenGame);
      });
    });
    const openPickerBtn = document.getElementById("mp-open-picker");
    if (openPickerBtn) {
      openPickerBtn.addEventListener("click", () => openCreateRoomModal(state.currentGame || ""));
    }
  }

  /**
   * Opens the game-selection modal. When called from a game page the
   * current game is pre-selected; when called from the home page the
   * player can pick any of the 11 games.
   */
  function openCreateRoomModal(preferredGameId) {
    if (!picker || !state.registry) {
      setError("Game list is still loading. Try again in a moment.");
      loadRegistry().then(() => {
        buildGamePicker();
        bindPicker();
        bindGameCardButtons();
        openCreateRoomModal(preferredGameId);
      });
      return;
    }

    // Navigation protection: never start a second room while inside one.
    if (state.room) {
      const gameName = state.room.gameName || state.room.gameId;
      setError(`You are already in room ${state.room.code} for ${gameName}. Leave it before creating another.`);
      return;
    }

    state.selectedGameId = "";
    picker.error.textContent = "";
    picker.step2.classList.add("hidden");
    clearNode(picker.grid.querySelectorAll(".selected"));
    picker.nameInput.value = state.playerName;

    const canonical = String(preferredGameId || "").trim().toLowerCase();
    if (canonical && state.registry[canonical]) {
      selectPickerGame(canonical);
    }

    picker.modal.classList.remove("hidden");
    picker.modal.setAttribute("aria-hidden", "false");
    state.pickerOpen = true;
  }

  function selectPickerGame(gameId) {
    state.selectedGameId = gameId;
    clearNode(picker.grid.querySelectorAll(".selected"));
    const card = picker.grid.querySelector(`[data-game="${CSS.escape(gameId)}"]`);
    if (card) card.classList.add("selected");

    const game = state.registry[gameId];
    picker.selected.innerHTML = `Create a room for <strong>${escapeHtml(game.icon)} ${escapeHtml(game.name)}</strong> (${playersLabel(game)}, ${game.mode === "turn-based" ? "turn-based" : "simultaneous"}).`;
    picker.step2.classList.remove("hidden");
    picker.error.textContent = "";
    picker.nameInput.focus();
  }

  function pickerName() {
    const result = validateName(picker.nameInput.value);
    if (!result.ok) {
      picker.error.textContent = result.error;
      return "";
    }
    state.playerName = result.name;
    persistName();
    picker.error.textContent = "";
    return state.playerName;
  }

  function closePicker() {
    if (!picker) return;
    picker.modal.classList.add("hidden");
    picker.modal.setAttribute("aria-hidden", "true");
    state.pickerOpen = false;
  }

  function playersLabel(game) {
    const min = game.minPlayers;
    const max = game.maxPlayers;
    if (min === max) return `${min} Player${min > 1 ? "s" : ""}`;
    return `${min}-${max} Players`;
  }

  // ------------------------------------------------------------------
  // Socket wiring.
  // ------------------------------------------------------------------

  function bindSocket() {
    state.socket.on("connect", () => {
      setConnection("Connected", "online");
      // Rejoin the room the player was in before a refresh / navigation.
      const storedCode = sessionStorage.getItem(STORAGE.roomCode) || sessionStorage.getItem(STORAGE.legacyLastRoom);
      if (storedCode) {
        reconnectRoom(storedCode, Boolean(state.room));
      }
    });
    state.socket.on("disconnect", () => setConnection("Reconnecting…", "offline"));
    state.socket.on("connect_error", () => setConnection("Connection lost", "offline"));
    state.socket.on("room_created", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("room_joined", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("room_state", (room) => room && applyRoom(room));
    state.socket.on("player_joined", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("player_left", (payload) => {
      if (payload?.room) applyRoom(payload.room);
      emitLocal("player_left", payload);
    });
    state.socket.on("host_changed", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("game_started", (data) => {
      if (data?.code && data?.gameId) storeRoom(data);
      // The match started successfully - clear the "Starting…" guard so the
      // host can start a rematch after the room returns to "waiting".
      state.mpStarting = false;
      applyRoom(data);
      openRoomGame(data?.gameId, data?.code, data?.gameRoute);
      emitLocal("game_started", data);
    });
    state.socket.on("game_state", (payload) => {
      syncRoomFromGameState(payload);
      emitLocal("game_state", payload);
    });
    state.socket.on("game_over", (payload) => emitLocal("game_over", payload));
    state.socket.on("match_ended", (payload) => {
      if (payload?.room) applyRoom(payload.room);
      emitLocal("match_ended", payload);
    });
    state.socket.on("room_error", (payload) => {
      setError(payload?.error || "Room action failed.");
      emitLocal("room_error", payload);
    });
  }

  function bindForms() {
    els.nameForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = validateName(els.nameInput.value);
      if (!result.ok) {
        setNameError(result.error);
        return;
      }
      state.playerName = result.name;
      persistName();
      setNameError("");
      toast("Name saved.", "success");
    });

    // Create a room for the selected game (picker on home, current game on
    // game pages). An empty selection is an error - never a fallback game.
    els.createForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = requireName();
      if (!name) return;

      let gameId = state.currentGame;
      if (!gameId) {
        gameId = state.selectedGameId || (els.gameSelect?.value || "").trim().toLowerCase();
        if (!gameId) {
          setError("No game selected. Open the game chooser and pick one first.");
          if (els.createRoomBtn) els.createRoomBtn.disabled = false;
          return;
        }
      }

      createRoom(gameId, name, (error) => {
        if (error) setError(error);
      });
    });

    els.joinForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = (els.roomCodeInput?.value || "").trim().toUpperCase();
      joinRoom(code, false);
    });

    els.leaveRoom?.addEventListener("click", leaveCurrentRoom);

    els.startGame?.addEventListener("click", () => {
      if (!state.room || state.mpStarting) return;
      state.mpStarting = true; // prevent double clicks while the match starts
      updateStartGameButton(state.room);
      // The server reads the selected game from the room - never send gameId here.
      state.socket.timeout(5000).emit("start_game", { roomCode: state.room.code }, (error, response) => {
        if (error || !response || response.success !== true) {
          state.mpStarting = false;
          setError((response && (response.message || response.error)) || "Unable to start the game.");
          if (state.room) updateStartGameButton(state.room);
        }
        // On success the room flips to "playing" and the match opens for everyone.
      });
    });

    els.copyCode?.addEventListener("click", () => copyText(state.room?.code || "", "Code copied."));
    els.copyLink?.addEventListener("click", () => {
      if (!state.room) return;
      const url = new URL(window.location.href);
      url.searchParams.set("room", state.room.code);
      copyText(url.toString(), "Invite link copied.");
    });
  }

  // ------------------------------------------------------------------
  // Room lifecycle.
  // ------------------------------------------------------------------

  function createRoom(gameId, name, onError) {
    if (!state.socket?.connected) {
      onError("Connection failed. Check that the server is running.");
      return;
    }
    emitWithAck(
      "create_room",
      { playerName: name, gameId, clientId: state.clientId, sessionId: state.playerSessionId },
      (result) => {
        if (!result.ok) {
          onError(result.error || "Unable to create room.");
          return;
        }
        storeRoom(result.room);
        if (els.roomCodeInput) els.roomCodeInput.value = result.roomCode;
        applyRoom(result.room);
        setError("");
        toast("Room created.", "success");
        openRoomGame(result.room?.gameId, result.roomCode);
      }
    );
  }

  function joinRoom(code, silent) {
    const name = requireName();
    if (!name) return;
    const roomCode = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(roomCode) || /[0O1I]/.test(roomCode)) {
      if (!silent) setError("Invalid room code.");
      return;
    }
    emitWithAck(
      "join_room",
      { playerName: name, roomCode, clientId: state.clientId, sessionId: state.playerSessionId },
      (result) => {
        if (!result.ok) {
          if (!silent) setError(result.error || "Unable to join room.");
          // Let any game waiting on a stale room fall back to single-player.
          emitLocal("room", null);
          return;
        }
        storeRoom(result.room);
        applyRoom(result.room);
        setError("");
        if (!silent) toast("Joined room.", "success");
        // The room's game is locked - the joiner is forced onto it.
        openRoomGame(result.room?.gameId, result.roomCode);
      }
    );
  }

  /**
   * Rejoin a room using the stable player session id. Used when the page
   * loads after a navigation (lobby -> game) or when the socket reconnects.
   * The server swaps the socket in place - no duplicate player, roles kept.
   */
  function reconnectRoom(code, silent) {
    const roomCode = String(code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(roomCode) || /[0O1I]/.test(roomCode)) {
      if (!silent) setError("Invalid room code.");
      return;
    }
    if (!state.playerSessionId) return;
    emitWithAck("reconnect_room", { roomCode, sessionId: state.playerSessionId }, (result) => {
      if (!result.ok) {
        // Room is gone or this browser is no longer a member - fall back to
        // the normal lobby / single-player flow.
        sessionStorage.removeItem(STORAGE.roomCode);
        sessionStorage.removeItem(STORAGE.gameId);
        sessionStorage.removeItem(STORAGE.legacyLastRoom);
        state.room = null;
        state.mpStarting = false;
        renderRoom(null);
        emitLocal("room", null);
        if (!silent) setError(result.error || "Unable to rejoin the room.");
        return;
      }
      storeRoom(result.room);
      applyRoom(result.room);
    });
  }

  function storeRoom(room) {
    if (!room) return;
    sessionStorage.setItem(STORAGE.roomCode, room.code);
    sessionStorage.setItem(STORAGE.gameId, room.gameId);
    sessionStorage.setItem(STORAGE.name, state.playerName);
  }

  /**
   * Central function that only ever loads the game assigned to a room.
   * Every path that opens a game for a room must go through here.
   */
  function openRoomGame(gameId, roomCode, gameRoute) {
    const canonical = String(gameId || "").trim().toLowerCase();
    const code = String(roomCode || "").trim().toUpperCase();
    if (!canonical || !code) return;
    if (state.currentGame === canonical) return; // already on the assigned game page
    const base = gameRoute && String(gameRoute).startsWith("/") ? gameRoute : `/game/${encodeURIComponent(canonical)}`;
    window.location.assign(`${base}?room=${encodeURIComponent(code)}&mode=multiplayer`);
  }

  function applyRoom(room) {
    if (!room) return;
    state.room = room;
    renderRoom(room);
    emitLocal("room", room);
    // Navigation protection: if we ended up on a page that is not the
    // room's game, the room must win - redirect to the assigned game.
    if (state.currentGame && room.gameId !== state.currentGame) {
      openRoomGame(room.gameId, room.code);
    }
  }

  function syncRoomFromGameState(payload) {
    if (!state.room || !payload) return;
    if (payload.gameState !== undefined) state.room.gameState = payload.gameState;
    if (payload.currentTurn !== undefined) state.room.currentTurn = payload.currentTurn;
    if (payload.status) state.room.status = payload.status;
    if (Array.isArray(payload.players)) state.room.players = payload.players;
  }

  function emitLocal(event, detail) {
    (listeners[event] || []).forEach((callback) => {
      try {
        callback(detail);
      } catch (error) {
        console.error("Multiplayer listener error:", error);
      }
    });
  }

  function leaveCurrentRoom() {
    if (state.room) state.socket.emit("leave_room", { roomCode: state.room.code });
    sessionStorage.removeItem(STORAGE.roomCode);
    sessionStorage.removeItem(STORAGE.gameId);
    sessionStorage.removeItem(STORAGE.legacyLastRoom);
    // NOTE: the stable player session id is intentionally kept - it belongs
    // to this browser tab, not to any single room.
    state.room = null;
    state.mpStarting = false;
    renderRoom(null);
    emitLocal("room", null);
    toast("Left room.", "info");
  }

  function me() {
    if (!state.room || !state.socket) return null;
    return (
      state.room.players?.find((player) => player.sessionId === state.playerSessionId) ||
      state.room.players?.find((player) => player.socketId === state.socket.id) ||
      null
    );
  }

  function emitWithAck(eventName, payload, callback) {
    if (!state.socket?.connected) {
      callback({ ok: false, error: "Connection failed. Check that the server is running." });
      return;
    }
    state.socket.timeout(5000).emit(eventName, payload, (error, response) => {
      if (error) {
        callback({ ok: false, error: "Connection failed. Please try again." });
        return;
      }
      callback(response || { ok: false, error: "No server response." });
    });
  }

  // ------------------------------------------------------------------
  // Rendering (lobby, room view, players, chat).
  // ------------------------------------------------------------------

  function renderRoom(room) {
    state.room = room;
    if (!room) {
      els.lobby?.classList.add("hidden");
      els.rvRoot?.classList.add("hidden");
      document.body.classList.remove("in-room");
      destroyChat();
      clearNode(els.playerList);
      return;
    }

    document.body.classList.add("in-room");
    els.lobby?.classList.remove("hidden");
    els.rvRoot?.classList.remove("hidden");

    const game = state.registry?.[room.gameId] || null;
    const accent = game?.accent || getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#39ff14";

    // Home-page lobby.
    if (els.lobby) {
      setText(els.lobbyCode, room.code);
      setText(els.lobbyCodeDisplay, room.code);
      setText(els.lobbyGame, room.gameName || game?.name || room.gameId);
      if (els.lobbyIcon) {
        els.lobbyIcon.textContent = game?.icon || "🎮";
        els.lobbyIcon.style.setProperty("--chat-accent", accent);
      }
      if (els.roomCodeInput) els.roomCodeInput.value = room.code;
    }

    // Game-page room view.
    if (els.rvRoot) {
      setText(els.rvCode, room.code);
      setText(els.rvGameName, room.gameName || game?.name || room.gameId);
      if (els.rvIcon) {
        els.rvIcon.textContent = game?.icon || "🎮";
        els.rvIcon.style.setProperty("--chat-accent", accent);
      }
      setRoomStatus(room);
    }

    if (els.lobbyStatus) setRoomStatus(room);

    updateStartGameButton(room);
    renderPlayers(room.players || []);
    setRoomCount(room);
    mountChat(room);
  }

  function setRoomStatus(room) {
    const isHost = room.hostId === (me()?.socketId || state.socket?.id);
    const label =
      room.status === "waiting"
        ? isHost
          ? `Waiting for players - ${room.players.length}/${room.minPlayers}`
          : "Waiting for host to start the game…"
        : `${room.status === "playing" ? "Playing" : "Started"} - ${room.players.length}/${room.maxPlayers} players`;
    setText(els.lobbyStatus, label);
    setText(els.rvStatus, label);
  }

  function setRoomCount(room) {
    const total = (room.players || []).length;
    const label = `${total}/${room.maxPlayers || total} connected`;
    setText(els.roomCount, label);
  }

  /**
   * Host-only Start Game button. Hidden for non-hosts, disabled until the
   * room has enough players, with a live label:
   *   "Waiting for players (1/2)" -> "Start Game" -> "Starting…"
   */
  function updateStartGameButton(room) {
    if (!els.startGame || !room) return;
    const isHost = room.hostId === state.socket.id;
    const hasEnoughPlayers = room.players.length >= room.minPlayers;
    const isWaiting = room.status === "waiting";

    els.startGame.hidden = !isHost;
    els.startGame.disabled = !hasEnoughPlayers || !isWaiting || state.mpStarting;
    els.startGame.textContent = state.mpStarting
      ? "Starting…"
      : hasEnoughPlayers
        ? "Start Game"
        : `Waiting for players (${room.players.length}/${room.minPlayers})`;
  }

  function renderPlayers(players) {
    clearNode(els.playerList);
    players.forEach((player) => {
      const item = document.createElement("li");
      item.className = "mp-room-player";
      if (player.isConnected === false) item.classList.add("offline");

      const avatar = document.createElement("span");
      avatar.className = "mp-room-player-avatar";
      avatar.textContent = String(player.playerNumber);
      item.appendChild(avatar);

      const info = document.createElement("span");
      info.className = "mp-room-player-info";
      const name = document.createElement("span");
      name.className = "mp-room-player-name";
      name.textContent = player.name;
      info.appendChild(name);
      if (player.role) {
        const role = document.createElement("span");
        role.className = "mp-room-player-role";
        role.textContent = player.role;
        info.appendChild(role);
      }
      if (player.isConnected === false) {
        const stateEl = document.createElement("span");
        stateEl.className = "mp-room-player-state";
        stateEl.textContent = "reconnecting…";
        info.appendChild(stateEl);
      }
      item.appendChild(info);

      if (player.isHost) {
        const badge = document.createElement("span");
        badge.className = "mp-host-badge";
        badge.textContent = "HOST";
        item.appendChild(badge);
      }

      els.playerList?.appendChild(item);
    });
  }

  // ------------------------------------------------------------------
  // Reusable room chat component (lobby + every game page).
  // ------------------------------------------------------------------

  function mountChat(room) {
    const container = els.chatMount;
    if (!container || !state.socket) return;
    if (typeof window.RoomChat !== "object" || typeof window.RoomChat.initRoomChat !== "function") return;

    if (chatInstance && chatRoomCode === room.code) {
      chatInstance.setOnline(onlineCount(room));
      return;
    }

    destroyChat();
    const game = state.registry?.[room.gameId] || null;
    if (game?.accent) container.style.setProperty("--chat-accent", game.accent);
    try {
      chatInstance = window.RoomChat.initRoomChat({
        socket: state.socket,
        roomCode: room.code,
        sessionId: state.playerSessionId,
        container,
        onError: (message) => toast(message, "error"),
      });
      chatRoomCode = room.code;
      chatInstance.setOnline(onlineCount(room));
    } catch (error) {
      console.error("Unable to mount room chat:", error);
      chatInstance = null;
      chatRoomCode = null;
    }
  }

  function destroyChat() {
    if (chatInstance) {
      chatInstance.destroy();
      chatInstance = null;
    }
    chatRoomCode = null;
  }

  function onlineCount(room) {
    return (room?.players || []).filter((player) => player.isConnected !== false).length;
  }

  function hydrateInviteCode() {
    const code = new URLSearchParams(window.location.search).get("room");
    if (code && els.roomCodeInput) els.roomCodeInput.value = code.trim().toUpperCase();
  }

  // ------------------------------------------------------------------
  // Small helpers.
  // ------------------------------------------------------------------

  function requireName() {
    const result = validateName(els.nameInput?.value || state.playerName);
    if (!result.ok) {
      setNameError(result.error);
      els.nameInput?.focus();
      return "";
    }
    state.playerName = result.name;
    persistName();
    setNameError("");
    return state.playerName;
  }

  function persistName() {
    sessionStorage.setItem(STORAGE.name, state.playerName);
    localStorage.setItem(STORAGE.name, state.playerName);
  }

  function validateName(value) {
    const name = String(value || "").trim();
    if (name.length < 2 || name.length > 20) {
      return { ok: false, error: "Enter a name between 2 and 20 characters." };
    }
    return { ok: true, name };
  }

  function getOrCreateClientId() {
    const existing = sessionStorage.getItem(STORAGE.clientId);
    if (existing) return existing;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    sessionStorage.setItem(STORAGE.clientId, id);
    return id;
  }

  /**
   * Stable player session id - generated once per browser tab and kept in
   * sessionStorage. Full-page navigations (lobby -> game page, refresh)
   * create new socket connections but the SAME sessionId, so the server
   * recognizes the player and never duplicates or drops them.
   */
  function getPlayerSessionId() {
    let sessionId = sessionStorage.getItem(STORAGE.sessionId);
    if (!sessionId) {
      sessionId =
        window.crypto && typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(STORAGE.sessionId, sessionId);
    }
    return sessionId;
  }

  function setConnection(text, className) {
    [els.connection, els.rvConnection].forEach((element) => {
      if (!element) return;
      element.className = `mp-status ${className || ""}`.trim();
      element.textContent = text;
    });
  }

  function setNameError(message) {
    setText(els.nameError, message);
  }

  function setError(message) {
    setText(els.actionError, message);
    if (message) toast(message, "error");
  }

  function setText(element, value) {
    if (element) element.textContent = value || "";
  }

  function clearNode(element) {
    if (!element) return;
    if (element instanceof NodeList) {
      element.forEach((node) => node.classList.remove("selected"));
      return;
    }
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  async function copyText(value, successMessage) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast(successMessage, "success");
    } catch (_error) {
      setError("Copy failed. Select and copy the room code manually.");
    }
  }

  function toast(message, type) {
    if (window.ArcadeAPI?.toast) window.ArcadeAPI.toast(message, type);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
