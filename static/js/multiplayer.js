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
  };

  const els = {
    connection: document.getElementById("mp-connection"),
    nameForm: document.getElementById("mp-name-form"),
    nameInput: document.getElementById("mp-player-name"),
    nameError: document.getElementById("mp-name-error"),
    createForm: document.getElementById("mp-create-form"),
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

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    state.playerName = sessionStorage.getItem(STORAGE.name) || localStorage.getItem(STORAGE.name) || "";
    if (els.nameInput) els.nameInput.value = state.playerName;

    state.socket = io({ transports: ["websocket", "polling"] });
    bindSocket();
    bindForms();
    hydrateInviteCode();

    window.MultiplayerAPI = {
      getRoom: () => state.room,
      getSocket: () => state.socket,
      sendGameAction(action) {
        if (!state.room) return false;
        state.socket.emit("game_action", {
          roomCode: state.room.code,
          gameId: state.room.gameId,
          action,
        });
        return true;
      },
    };
  }

  function bindSocket() {
    state.socket.on("connect", () => {
      setConnection("Online", "online");
      const lastRoom = sessionStorage.getItem(STORAGE.lastRoom);
      if (lastRoom && state.playerName && !state.room) joinRoom(lastRoom, true);
    });
    state.socket.on("disconnect", () => setConnection("Offline", "offline"));
    state.socket.on("connect_error", () => setError("Connection failed. Check that the server is running."));
    state.socket.on("room_state", renderRoom);
    state.socket.on("player_joined", (payload) => payload?.room && renderRoom(payload.room));
    state.socket.on("player_left", (payload) => payload?.room && renderRoom(payload.room));
    state.socket.on("host_changed", (payload) => payload?.room && renderRoom(payload.room));
    state.socket.on("game_started", onGameStarted);
    state.socket.on("chat_message", appendMessage);
    state.socket.on("system_message", appendMessage);
    state.socket.on("room_error", (payload) => setError(payload?.error || "Room action failed."));
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
      const gameId = selectedGameId();
      emitWithAck("create_room", { playerName: name, gameId, clientId: state.clientId }, (result) => {
        if (!result.ok) {
          setError(result.error || "Unable to create room.");
          return;
        }
        sessionStorage.setItem(STORAGE.lastRoom, result.roomCode);
        if (els.roomCodeInput) els.roomCodeInput.value = result.roomCode;
        renderRoom(result.room);
        setError("");
        toast("Room created.", "success");
      });
    });

    els.joinForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = (els.roomCodeInput?.value || "").trim().toUpperCase();
      joinRoom(code, false);
    });

    els.leaveRoom?.addEventListener("click", () => {
      if (state.room) state.socket.emit("leave_room", { roomCode: state.room.code });
      sessionStorage.removeItem(STORAGE.lastRoom);
      state.room = null;
      renderRoom(null);
      toast("Left room.", "info");
    });

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
      setError("Invalid room code.");
      return;
    }
    emitWithAck("join_room", { playerName: name, roomCode, clientId: state.clientId }, (result) => {
      if (!result.ok) {
        if (!silent) setError(result.error || "Unable to join room.");
        return;
      }
      sessionStorage.setItem(STORAGE.lastRoom, result.roomCode);
      renderRoom(result.room);
      setError("");
      if (!silent) toast("Joined room.", "success");
      redirectToRoomGame(result.room);
    });
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
    setText(els.lobbyStatus, `${room.status === "waiting" ? "Waiting" : "Started"} - ${room.players.length}/${room.maxPlayers} players`);

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
      name.textContent = `${player.playerNumber}. ${player.name}`;
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

  function onGameStarted(room) {
    renderRoom(room);
    redirectToRoomGame(room);
  }

  function redirectToRoomGame(room) {
    if (!room?.gameId || state.currentGame === room.gameId) return;
    window.location.assign(`/game/${encodeURIComponent(room.gameId)}?room=${encodeURIComponent(room.code)}`);
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
