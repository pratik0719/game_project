/**
 * MultiplayerGameSupport
 * ---------------------
 * Shared client helper that bridges a single-player game script to the
 * MultiplayerAPI socket layer. Every game page calls:
 *
 *   window.MultiplayerGameSupport.create("snake", {
 *     onStatus(status),      // "solo" | "waiting" | "playing"
 *     onRoom(room|null),
 *     onMatchStart(room),    // match just started / resumed
 *     onState(payload),      // server game_state broadcast
 *     onGameOver(payload),   // server game_over event
 *     onMatchEnded(payload), // opponent left, match aborted
 *     onError(payload)       // room_error
 *   });
 *
 * The adapter tracks whether the game page is inside a multiplayer room
 * for ITS OWN game. It renders the shared "match bar" (player chips, VS
 * separators, turn highlight) and a "Play Again" button, and exposes
 * sendAction() / playAgain() / leaveRoom() passthroughs.
 */
(function () {
  "use strict";

  function create(gameId, callbacks) {
    const mp = window.MultiplayerAPI || null;
    const cb = callbacks || {};

    const adapter = {
      gameId,
      mp,
      status: "solo", // solo | waiting | playing
      room: null,
      myRole: null,

      inRoom() {
        return Boolean(this.room);
      },
      isWaiting() {
        return this.status === "waiting";
      },
      isPlaying() {
        return this.status === "playing";
      },
      isMyTurn() {
        return Boolean(mp && mp.isMyTurn());
      },
      me() {
        if (!this.room || !mp) return null;
        return this.room.players?.find((player) => player.socketId === mp.getSocketId()) || null;
      },
      getRoom() {
        return this.room || (mp ? mp.getRoom() : null);
      },
      getGameState() {
        const room = this.getRoom();
        return room ? room.gameState || null : null;
      },
      getPlayers() {
        const room = this.getRoom();
        return (room && room.players) || [];
      },
      opponentOf(me) {
        const players = this.getPlayers();
        if (players.length <= 1) return null;
        const socketId = mp ? mp.getSocketId() : null;
        return players.find((player) => player.socketId !== socketId) || players[0];
      },
      myPlayerNumber() {
        const me = this.me();
        return me ? me.playerNumber : null;
      },
      sendAction(action) {
        return Boolean(mp && mp.sendAction(action));
      },
      playAgain() {
        if (mp) mp.playAgain();
      },
      leaveRoom() {
        if (mp) mp.leaveRoom();
      },
      requestRoomState() {
        if (mp) mp.requestRoomState();
      },

      // ---- UI helpers shared by every game ----

      renderMatchBar(container) {
        if (!container) return;
        container.innerHTML = "";
        const players = this.getPlayers();
        const meSocket = mp ? mp.getSocketId() : null;

        players.forEach((player, index) => {
          if (index > 0) {
            const vs = document.createElement("span");
            vs.className = "mp-vs";
            vs.textContent = "VS";
            container.appendChild(vs);
          }
          const chip = document.createElement("span");
          chip.className = "mp-player-chip";
          const isMe = player.socketId === meSocket;
          const room = this.getRoom();
          const isTurn = this.isPlaying() && Boolean(room) && room.currentTurn === player.socketId;
          if (isTurn) chip.classList.add("turn");
          if (isMe) chip.classList.add("me");
          const label = player.role ? `${player.name} (${player.role})` : player.name;
          chip.textContent = isMe ? `You (${player.role || "Player " + player.playerNumber})` : label;
          container.appendChild(chip);
        });
      },

      renderPlayAgainButton(container, visible) {
        if (!container) return;
        let button = container.querySelector(".mp-play-again");
        if (!button) {
          button = document.createElement("button");
          button.className = "btn btn-primary mp-play-again";
          button.textContent = "Play Again";
          button.addEventListener("click", () => this.playAgain());
          container.appendChild(button);
        }
        button.hidden = !visible;
      },
    };

    function setStatus(next) {
      if (adapter.status !== next) {
        adapter.status = next;
        if (typeof cb.onStatus === "function") cb.onStatus(next);
      }
    }

    function lookupRole(room) {
      const meSocket = mp ? mp.getSocketId() : null;
      const me = (room.players || []).find((player) => player.socketId === meSocket);
      return me ? me.role || null : null;
    }

    function enterRoom(room) {
      adapter.room = room;
      adapter.myRole = lookupRole(room);
      if (!room) {
        adapter.myRole = null;
        setStatus("solo");
        if (typeof cb.onRoom === "function") cb.onRoom(null);
        return;
      }
      if (room.gameId !== gameId) {
        // A different room's game; multiplayer.js will redirect the page.
        setStatus("waiting");
        if (typeof cb.onRoom === "function") cb.onRoom(room);
        return;
      }
      if (room.status === "playing" && room.gameState) {
        setStatus("playing");
        if (typeof cb.onMatchStart === "function") cb.onMatchStart(room);
      } else {
        setStatus("waiting");
        if (typeof cb.onRoom === "function") cb.onRoom(room);
      }
    }

    if (mp) {
      mp.on("room", enterRoom);
      mp.on("game_started", (room) => {
        if (!room || room.gameId !== gameId) return;
        adapter.room = room;
        adapter.myRole = lookupRole(room);
        setStatus("playing");
        if (typeof cb.onMatchStart === "function") cb.onMatchStart(room);
      });
      mp.on("game_state", (payload) => {
        if (!payload || payload.gameId !== gameId) return;
        if (adapter.room && payload.gameState !== undefined) {
          adapter.room = Object.assign({}, adapter.room, {
            gameState: payload.gameState,
            currentTurn: payload.currentTurn,
            status: payload.status || adapter.room.status,
          });
        }
        if (payload.status && payload.status !== "playing") setStatus("waiting");
        if (typeof cb.onState === "function") cb.onState(payload);
      });
      mp.on("game_over", (payload) => {
        if (!payload || payload.gameId !== gameId) return;
        if (typeof cb.onGameOver === "function") cb.onGameOver(payload);
      });
      mp.on("match_ended", (payload) => {
        if (payload?.room && payload.room.gameId !== gameId) return;
        adapter.myRole = null;
        setStatus("waiting");
        if (typeof cb.onMatchEnded === "function") cb.onMatchEnded(payload);
      });
      mp.on("player_left", (payload) => {
        if (typeof cb.onPlayerLeft === "function") cb.onPlayerLeft(payload);
      });
      mp.on("room_error", (payload) => {
        if (typeof cb.onError === "function") cb.onError(payload);
      });
    }

    // Reflect any room that is already active (e.g. page reload inside a room).
    const initialRoom = mp ? mp.getRoom() : null;
    if (initialRoom) enterRoom(initialRoom);

    return adapter;
  }

  window.MultiplayerGameSupport = { create };
})();
