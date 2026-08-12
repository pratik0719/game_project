(function () {
  const panel = document.getElementById("multiplayer-panel");
  if (!panel || typeof io !== "function") return;

  const STORAGE = {
    name: "arcadeMultiplayerName",
    clientId: "arcadeMultiplayerClientId",
    lastRoom: "arcadeMultiplayerLastRoom",
  };

  const state = {
    socket: null,
    room: null,
    playerName: "",
    clientId: getOrCreateClientId(),
    currentGame: (panel.dataset.currentGame || "").trim().toLowerCase(),
    mpReady: panel.dataset.mpReady === "true",
  };

  const els = {
    connection: document.getElementById("mp-connection"),
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
    lobby: document.getElementById("mp-lobby"),
    lobbyCode: document.getElementById("mp-lobby-code"),
    lobbyCodeDisplay: document.getElementById("mp-lobby-code-display"),
    lobbyGame: document.getElementById("mp-lobby-game"),
    lobbyStatus: document.getElementById("mp-lobby-status"),
    copyCode: document.getElementById("mp-copy-code"),
    copyLink: document.getElementById("mp-copy-link"),
    startGame: document.getElementById("mp-start-game"),
    leaveRoom: document.getElementById("mp-leave-room"),
    playerList: document.getElementById("mp-player-list"),
    chatForm: document.getElementById("mp-chat-form"),
    chatLog: document.getElementById("mp-chat-log"),
    chatInput: document.getElementById("mp-chat-input"),
  };

  /**
   * Bridge exposed to game scripts. Available synchronously so games can
   * subscribe before the socket connects. Games only ever receive
   * server-provided state and only ever send move intents.
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
    openRoomGame(gameId, roomCode) {
      openRoomGame(gameId, roomCode);
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
    state.playerName = sessionStorage.getItem(STORAGE.name) || localStorage.getItem(STORAGE.name) || "";
    if (els.nameInput) els.nameInput.value = state.playerName;

    // Games without a multiplayer adapter cannot host a room.
    if (els.createRoomBtn) els.createRoomBtn.disabled = !state.mpReady;
    if (els.createNote) els.createNote.hidden = state.mpReady;

    state.socket = io({ transports: ["websocket", "polling"] });
    bindSocket();
    bindForms();
    hydrateInviteCode();
  }

  function bindSocket() {
    state.socket.on("connect", () => {
      setConnection("Online", "online");
      const lastRoom = sessionStorage.getItem(STORAGE.lastRoom);
      if (lastRoom && state.playerName && !state.room) joinRoom(lastRoom, true);
    });
    state.socket.on("disconnect", () => setConnection("Offline", "offline"));
    state.socket.on("connect_error", () => setError("Connection failed. Check that the server is running."));
    state.socket.on("room_created", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("room_joined", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("room_state", (room) => room && applyRoom(room));
    state.socket.on("player_joined", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("player_left", (payload) => {
      if (payload?.room) applyRoom(payload.room);
      emitLocal("player_left", payload);
    });
    state.socket.on("host_changed", (payload) => payload?.room && applyRoom(payload.room));
    state.socket.on("game_started", (room) => {
      applyRoom(room);
      openRoomGame(room?.gameId, room?.code);
      emitLocal("game_started", room);
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
    state.socket.on("chat_message", appendMessage);
    state.socket.on("system_message", appendMessage);
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
      sessionStorage.setItem(STORAGE.name, state.playerName);
      localStorage.setItem(STORAGE.name, state.playerName);
      setNameError("");
      toast("Name saved.", "success");
    });

    els.createForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = requireName();
      if (!name) return;
      if (!state.mpReady) {
        setError("This game does not support multiplayer rooms yet.");
        return;
      }
      const gameId = selectedGameId();
      emitWithAck("create_room", { playerName: name, gameId, clientId: state.clientId }, (result) => {
        if (!result.ok) {
          setError(result.error || "Unable to create room.");
          return;
        }
        sessionStorage.setItem(STORAGE.lastRoom, result.roomCode);
        if (els.roomCodeInput) els.roomCodeInput.value = result.roomCode;
        applyRoom(result.room);
        setError("");
        toast("Room created.", "success");
        openRoomGame(result.room?.gameId, result.roomCode);
      });
    });

    els.joinForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = (els.roomCodeInput?.value || "").trim().toUpperCase();
      joinRoom(code, false);
    });

    els.leaveRoom?.addEventListener("click", leaveCurrentRoom);

    els.startGame?.addEventListener("click", () => {
      if (!state.room) return;
      state.socket.emit("start_game", { roomCode: state.room.code });
    });

    els.copyCode?.addEventListener("click", () => copyText(state.room?.code || "", "Code copied."));
    els.copyLink?.addEventListener("click", () => {
      if (!state.room) return;
      const url = new URL(window.location.href);
      url.searchParams.set("room", state.room.code);
      copyText(url.toString(), "Invite link copied.");
    });

    els.chatForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.room || !els.chatInput) return;
      const message = els.chatInput.value.trim();
      if (!message) return;
      if (message.length > 300) {
        setError("Messages must be 300 characters or less.");
        return;
      }
      state.socket.emit("send_message", { roomCode: state.room.code, message });
      els.chatInput.value = "";
    });
  }

  function joinRoom(code, silent) {
    const name = requireName();
    if (!name) return;
    const roomCode = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(roomCode) || /[0O1I]/.test(roomCode)) {
      if (!silent) setError("Invalid room code.");
      return;
    }
    emitWithAck("join_room", { playerName: name, roomCode, clientId: state.clientId }, (result) => {
      if (!result.ok) {
        if (!silent) setError(result.error || "Unable to join room.");
        // Let any game waiting on a stale room fall back to single-player.
        emitLocal("room", null);
        return;
      }
      sessionStorage.setItem(STORAGE.lastRoom, result.roomCode);
      applyRoom(result.room);
      setError("");
      if (!silent) toast("Joined room.", "success");
      // The room's game is locked — the joiner is forced onto it.
      openRoomGame(result.room?.gameId, result.roomCode);
    });
  }

  /**
   * Central function that only ever loads the game assigned to a room.
   * Every path that opens a game for a room must go through here.
   */
  function openRoomGame(gameId, roomCode) {
    const canonical = String(gameId || "").trim().toLowerCase();
    const code = String(roomCode || "").trim().toUpperCase();
    if (!canonical || !code) return;
    if (state.currentGame === canonical) return; // already on the assigned game page
    window.location.assign(`/game/${encodeURIComponent(canonical)}?room=${encodeURIComponent(code)}`);
  }

  function applyRoom(room) {
    if (!room) return;
    state.room = room;
    renderRoom(room);
    emitLocal("room", room);
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
    sessionStorage.removeItem(STORAGE.lastRoom);
    state.room = null;
    renderRoom(null);
    emitLocal("room", null);
    toast("Left room.", "info");
  }

  function me() {
    if (!state.room || !state.socket) return null;
    return state.room.players?.find((player) => player.socketId === state.socket.id) || null;
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

  function renderRoom(room) {
    state.room = room;
    if (!room) {
      els.lobby?.classList.add("hidden");
      clearNode(els.playerList);
      clearNode(els.chatLog);
      return;
    }

    els.lobby?.classList.remove("hidden");
    setText(els.lobbyCode, room.code);
    setText(els.lobbyCodeDisplay, room.code);
    if (els.roomCodeInput) els.roomCodeInput.value = room.code;
    setText(els.lobbyGame, room.gameTitle || room.gameId);
    const statusLabel =
      room.status === "waiting" ? "Waiting" : room.status === "playing" ? "Playing" : "Started";
    setText(els.lobbyStatus, `${statusLabel} - ${room.players.length}/${room.maxPlayers} players`);

    const isHost = room.hostId === state.socket.id;
    if (els.startGame) {
      els.startGame.hidden = !isHost;
      els.startGame.disabled = !isHost || room.players.length < room.minPlayers || room.status !== "waiting";
    }

    renderPlayers(room.players || []);
    renderMessages(room.messages || []);
  }

  function renderPlayers(players) {
    clearNode(els.playerList);
    players.forEach((player) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${player.playerNumber}. ${player.name}${player.role ? ` (${player.role})` : ""}`;
      item.appendChild(name);
      if (player.isHost) {
        const badge = document.createElement("span");
        badge.className = "mp-host-badge";
        badge.textContent = "HOST";
        item.appendChild(badge);
      }
      els.playerList?.appendChild(item);
    });
  }

  function renderMessages(messages) {
    clearNode(els.chatLog);
    messages.forEach(appendMessage);
  }

  function appendMessage(message) {
    if (!els.chatLog || !message) return;
    const row = document.createElement("div");
    row.className = `mp-message ${message.type === "system" ? "system" : "chat"}`;

    const meta = document.createElement("span");
    meta.className = "mp-message-meta";
    meta.textContent = `${message.sender || "Player"} - ${formatTime(message.time)}`;

    const text = document.createElement("span");
    text.className = "mp-message-text";
    text.textContent = message.text || "";

    row.appendChild(meta);
    row.appendChild(text);
    els.chatLog.appendChild(row);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function hydrateInviteCode() {
    const code = new URLSearchParams(window.location.search).get("room");
    if (code && els.roomCodeInput) els.roomCodeInput.value = code.trim().toUpperCase();
  }

  function selectedGameId() {
    return (els.gameSelect?.value || state.currentGame || "tictactoe").trim().toLowerCase();
  }

  function requireName() {
    const result = validateName(els.nameInput?.value || state.playerName);
    if (!result.ok) {
      setNameError(result.error);
      els.nameInput?.focus();
      return "";
    }
    state.playerName = result.name;
    sessionStorage.setItem(STORAGE.name, state.playerName);
    localStorage.setItem(STORAGE.name, state.playerName);
    setNameError("");
    return state.playerName;
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

  function setConnection(text, className) {
    if (!els.connection) return;
    els.connection.className = `mp-status ${className || ""}`.trim();
    els.connection.textContent = text;
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
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
})();
