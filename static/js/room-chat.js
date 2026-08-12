/**
 * RoomChat
 * --------
 * One reusable private-room chat component mounted in the multiplayer
 * lobby AND on every game page. It depends only on the roomCode, never on
 * a specific game, so the exact same instance follows the player from the
 * lobby through the match and between rounds.
 *
 *   const chat = RoomChat.initRoomChat({
 *     socket,          // the page's Socket.IO socket
 *     roomCode,        // e.g. "A7BK92"
 *     sessionId,       // this player's stable session id
 *     container,       // HTMLElement the panel is mounted into
 *     onError(message) // chat errors surface here (toasts)
 *   });
 *   chat.setOnline(count);
 *   chat.destroy();
 *
 * All rendering uses textContent - player names and messages are never
 * injected as HTML. Message ids are tracked so history + live events can
 * never render duplicates. Typing events are debounced and throttled.
 */
(function () {
  "use strict";

  const MAX_MESSAGE_LENGTH = 300;
  const TYPING_HIDE_MS = 2600;
  const TYPING_SEND_DELAY_MS = 400;
  const TYPING_THROTTLE_MS = 2000;
  const TYPING_STOP_MS = 1200;

  function initRoomChat({ socket, roomCode, sessionId, container, onError }) {
    if (!socket || !roomCode || !container) {
      throw new Error("RoomChat.initRoomChat requires socket, roomCode and container.");
    }

    const root = document.createElement("div");
    root.className = "room-chat-wrap";
    // Room codes are server-generated [A-Z2-9]{6} - safe to inline.
    root.innerHTML = `
      <section class="room-chat" role="region" aria-label="Room chat for ${roomCode}">
        <header class="room-chat-header">
          <div class="room-chat-title">
            <h3>Room Chat</h3>
            <span class="room-chat-online" title="Connected players">● 1 online</span>
          </div>
          <div class="room-chat-header-actions">
            <span class="room-chat-conn" role="status" aria-live="polite">Connected</span>
            <button type="button" class="room-chat-collapse" aria-label="Collapse chat" title="Collapse chat">
              <span class="room-chat-collapse-badge" hidden>0</span>
              <span class="room-chat-chevron" aria-hidden="true"></span>
            </button>
            <button type="button" class="room-chat-close" aria-label="Close chat" title="Close chat">&times;</button>
          </div>
        </header>

        <div class="room-chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <button type="button" class="room-chat-new" hidden>New messages ↓</button>
        <p class="room-chat-typing" role="status" aria-live="polite"></p>
        <p class="room-chat-error" role="alert" aria-live="assertive"></p>

        <form class="room-chat-form" autocomplete="off">
          <label class="sr-only" for="room-chat-input-${roomCode}">Message the room</label>
          <div class="room-chat-input-wrap">
            <input
              id="room-chat-input-${roomCode}"
              class="room-chat-input"
              type="text"
              maxlength="${MAX_MESSAGE_LENGTH}"
              placeholder="Message the room"
              aria-label="Message the room"
              disabled
            />
            <span class="room-chat-counter" aria-hidden="true">0/${MAX_MESSAGE_LENGTH}</span>
          </div>
          <button type="submit" class="room-chat-send" disabled>Send</button>
        </form>
      </section>

      <button type="button" class="room-chat-fab" aria-label="Open chat" title="Open chat">
        <span class="room-chat-fab-icon" aria-hidden="true">💬</span>
        <span class="room-chat-fab-text">Chat</span>
        <span class="room-chat-fab-badge" hidden>0</span>
      </button>
    `;
    container.appendChild(root);

    const panel = root.querySelector(".room-chat");
    const messagesEl = root.querySelector(".room-chat-messages");
    const typingEl = root.querySelector(".room-chat-typing");
    const errorEl = root.querySelector(".room-chat-error");
    const input = root.querySelector(".room-chat-input");
    const sendBtn = root.querySelector(".room-chat-send");
    const counterEl = root.querySelector(".room-chat-counter");
    const form = root.querySelector(".room-chat-form");
    const collapseBtn = root.querySelector(".room-chat-collapse");
    const closeBtn = root.querySelector(".room-chat-close");
    const fab = root.querySelector(".room-chat-fab");
    const fabBadge = root.querySelector(".room-chat-fab-badge");
    const collapseBadge = root.querySelector(".room-chat-collapse-badge");
    const onlineEl = root.querySelector(".room-chat-online");
    const connEl = root.querySelector(".room-chat-conn");
    const newMsgBtn = root.querySelector(".room-chat-new");

    // ---- state ----------------------------------------------------------

    let open = true; // desktop: expanded panel; mobile: drawer shown
    let unread = 0;
    let onlineCount = 1;
    let connected = Boolean(socket.connected);
    let destroyed = false;

    const renderedIds = new Set();
    let lastSender = null;
    let lastTypingStartAt = 0;
    let typingStopTimer = null;
    let typingRefreshTimer = null;
    let typingStartTimer = null;
    let closeTimer = null;

    // ---- message rendering ---------------------------------------------

    function appendMessage(message) {
      if (!message || destroyed) return;
      if (message.roomCode && message.roomCode !== roomCode) return; // never leak another room

      const id = message.id;
      if (id) {
        if (renderedIds.has(id)) return;
        renderedIds.add(id);
        if (renderedIds.size > 600) {
          // Drop the oldest ids so the set cannot grow without bound.
          for (const old of renderedIds) {
            renderedIds.delete(old);
            break;
          }
        }
      }

      const isSystem = message.type === "system";
      const mine = !isSystem && message.senderSessionId === sessionId;

      const row = document.createElement("div");
      row.className = "room-chat-msg";
      if (isSystem) row.classList.add("system");
      else if (mine) row.classList.add("mine");
      else row.classList.add("theirs");

      if (!isSystem && lastSender === message.senderSessionId) row.classList.add("grouped");
      lastSender = isSystem ? null : message.senderSessionId;

      if (isSystem) {
        const text = document.createElement("p");
        text.className = "room-chat-msg-text";
        text.textContent = message.text || "";
        row.appendChild(text);
      } else {
        const meta = document.createElement("div");
        meta.className = "room-chat-msg-meta";
        const name = document.createElement("span");
        name.className = "room-chat-msg-name";
        name.textContent = mine ? "You" : message.senderName || "Player";
        const time = document.createElement("time");
        time.textContent = formatTime(message.createdAt);
        meta.appendChild(name);
        meta.appendChild(time);

        const text = document.createElement("p");
        text.className = "room-chat-msg-text";
        text.textContent = message.text || "";

        row.appendChild(meta);
        row.appendChild(text);
      }

      messagesEl.appendChild(row);

      if (isNearBottom()) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
        newMsgBtn.hidden = true;
      } else if (!isSystem) {
        newMsgBtn.hidden = false;
      }
    }

    function isNearBottom() {
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 48;
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      newMsgBtn.hidden = true;
    }

    function renderMessages(list) {
      (list || []).forEach(appendMessage);
    }

    function formatTime(value) {
      const date = new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // ---- typing indicator ----------------------------------------------

    function renderTypers(typers) {
      if (destroyed) return;
      const others = (typers || []).filter((entry) => entry.sessionId !== sessionId);
      clearTimeout(typingRefreshTimer);
      if (others.length === 0) {
        typingEl.textContent = "";
        return;
      }
      const names = others.map((entry) => entry.senderName || "Someone").join(", ");
      typingEl.textContent = `${names} ${others.length === 1 ? "is" : "are"} typing…`;
      typingRefreshTimer = setTimeout(() => {
        typingEl.textContent = "";
      }, TYPING_HIDE_MS);
    }

    function sendTypingStart() {
      const now = Date.now();
      if (!connected || now - lastTypingStartAt < TYPING_THROTTLE_MS) return;
      lastTypingStartAt = now;
      socket.emit("chat_typing_start", { roomCode });
    }

    function stopTyping() {
      clearTimeout(typingStopTimer);
      typingStopTimer = null;
      socket.emit("chat_typing_stop", { roomCode });
    }

    // ---- sending -------------------------------------------------------

    function updateCounter() {
      counterEl.textContent = `${input.value.length}/${MAX_MESSAGE_LENGTH}`;
    }

    function showError(message) {
      errorEl.textContent = message || "";
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        errorEl.textContent = "";
      }, 4000);
    }

    function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        showError(`Message must be 1-${MAX_MESSAGE_LENGTH} characters.`);
        return;
      }
      if (!connected) {
        showError("Connection lost. Your message is saved - it will be sent when you reconnect.");
        return;
      }

      socket.emit("send_room_message", { roomCode, text }, (response) => {
        if (destroyed) return;
        if (response && response.success) {
          input.value = "";
          updateCounter();
          stopTyping();
          scrollToBottom();
        } else {
          const message = (response && (response.message || response.error)) || "Message not sent. Try again.";
          showError(message);
          if (typeof onError === "function") onError(message);
        }
      });
    }

    // ---- connection state ----------------------------------------------

    function updateConnection() {
      if (connected) {
        connEl.textContent = "Connected";
        connEl.className = "room-chat-conn online";
        input.disabled = false;
        sendBtn.disabled = false;
      } else {
        connEl.textContent = "Reconnecting…";
        connEl.className = "room-chat-conn offline";
        input.disabled = true;
        sendBtn.disabled = true;
      }
    }

    // ---- unread badges -------------------------------------------------

    function updateBadges() {
      fabBadge.hidden = unread === 0;
      collapseBadge.hidden = unread === 0;
      if (unread > 0) {
        fabBadge.textContent = String(unread);
        collapseBadge.textContent = String(unread);
      }
    }

    function isOpen() {
      return open;
    }

    function setOpen(next, options) {
      open = Boolean(next);
      root.classList.toggle("open", open);
      root.classList.toggle("collapsed", !open);
      if (open) {
        unread = 0;
        updateBadges();
        scrollToBottom();
        // Only focus when the user opened the chat - never steal focus (or
        // pop the mobile keyboard) on page load.
        if (options && options.focus) input.focus();
      }
    }

    function toggle() {
      setOpen(!open);
    }

    // ---- public API ----------------------------------------------------

    const api = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        socket.off("room_message", handleRoomMessage);
        socket.off("chat_history", handleChatHistory);
        socket.off("room_system_message", handleSystemMessage);
        socket.off("room_typing", handleTyping);
        socket.off("chat_error", handleChatError);
        socket.off("connect", handleConnect);
        socket.off("disconnect", handleDisconnect);
        socket.off("connect_error", handleConnectError);
        clearTimeout(typingStopTimer);
        clearTimeout(typingRefreshTimer);
        clearTimeout(typingStartTimer);
        clearTimeout(closeTimer);
        document.removeEventListener("keydown", handleEscape);
        root.remove();
      },
      open() {
        setOpen(true);
      },
      close() {
        setOpen(false);
      },
      toggle,
      isOpen,
      getUnreadCount() {
        return unread;
      },
      setOnline(count) {
        onlineCount = Number(count) || 0;
        onlineEl.textContent = `● ${onlineCount} online`;
      },
      getRoomCode() {
        return roomCode;
      },
    };

    // ---- socket listeners (all room-scoped by the server) --------------

    function handleRoomMessage(message) {
      if (message && message.roomCode && message.roomCode !== roomCode) return;
      appendMessage(message);
      // Unread counting: never count the player's own messages and never
      // count system messages. Reset happens when the panel opens.
      if (
        !open &&
        message &&
        message.type !== "system" &&
        message.senderSessionId &&
        message.senderSessionId !== sessionId
      ) {
        unread += 1;
        updateBadges();
      }
    }

    function handleChatHistory(payload) {
      if (!payload || payload.roomCode !== roomCode) return;
      renderMessages(payload.messages || []);
      scrollToBottom();
    }

    function handleSystemMessage(message) {
      if (message && message.roomCode && message.roomCode !== roomCode) return;
      appendMessage(message);
    }

    function handleTyping(payload) {
      if (!payload || payload.roomCode !== roomCode) return;
      renderTypers(payload.typing || []);
    }

    function handleChatError(payload) {
      const message = (payload && payload.error) || "Chat error.";
      showError(message);
      if (typeof onError === "function") onError(message);
    }

    function handleConnect() {
      connected = true;
      updateConnection();
      // Re-request history after a reconnect so nothing is missed.
      socket.emit("request_chat_history", { roomCode });
    }

    function handleDisconnect() {
      connected = false;
      updateConnection();
    }

    function handleConnectError() {
      connected = false;
      connEl.textContent = "Connection lost";
      connEl.className = "room-chat-conn offline";
      input.disabled = true;
      sendBtn.disabled = true;
    }

    socket.on("room_message", handleRoomMessage);
    socket.on("chat_history", handleChatHistory);
    socket.on("room_system_message", handleSystemMessage);
    socket.on("room_typing", handleTyping);
    socket.on("chat_error", handleChatError);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    // ---- form events ---------------------------------------------------

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage();
    });

    input.addEventListener("input", () => {
      updateCounter();
      if (input.value.trim()) {
        if (Date.now() - lastTypingStartAt >= TYPING_THROTTLE_MS) {
          // First keystroke after a pause: send after a short delay so a
          // single keystroke does not broadcast immediately.
          clearTimeout(typingStartTimer);
          typingStartTimer = setTimeout(() => {
            typingStartTimer = null;
            sendTypingStart();
          }, TYPING_SEND_DELAY_MS);
        }
        clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(stopTyping, TYPING_STOP_MS);
      } else {
        stopTyping();
      }
    });

    input.addEventListener("blur", stopTyping);

    fab.addEventListener("click", () => setOpen(true, { focus: true }));
    collapseBtn.addEventListener("click", () => setOpen(false));
    closeBtn.addEventListener("click", () => setOpen(false));
    newMsgBtn.addEventListener("click", scrollToBottom);

    function handleEscape(event) {
      if (event.key === "Escape" && open && window.matchMedia("(max-width: 900px)").matches) {
        setOpen(false);
        input.blur();
      }
    }
    document.addEventListener("keydown", handleEscape);

    // ---- initial state -------------------------------------------------
    // Desktop: panel expanded. Mobile: start closed so the floating button
    // is shown and the drawer never covers the game on page load.
    setOpen(window.matchMedia("(min-width: 901px)").matches);
    updateCounter();
    updateConnection();
    updateBadges();
    // Restore history on mount (the server validates membership).
    socket.emit("request_chat_history", { roomCode });

    return api;
  }

  window.RoomChat = { initRoomChat };
})();
