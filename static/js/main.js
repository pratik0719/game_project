(function () {
  const PAGE = document.body.dataset.page || "";

  const GAME_TITLES = {
    snake: "Snake Rush",
    memory: "Memory Pulse",
    quiz: "Quiz Reactor",
    tictactoe: "Tic Tac Toe Grid",
    spinwheel: "Spin the Wheel",
    ludo: "Ludo Blitz",
    chess: "Neon Chess",
    "2048": "2048 Surge",
    whackamole: "Whack-a-Mole",
    flappy: "Flappy Burst",
    breakout: "Breakout Neon",
    "rps-arena": "RPS Arena",
    "neon-connect": "Neon Connect",
    "neon-fleet": "Neon Fleet",
    "color-clash": "Color Clash",
  };

  const GAME_LOGOS = {
    snake: "/static/icons/snake.svg",
    memory: "/static/icons/memory.svg",
    quiz: "/static/icons/quiz.svg",
    tictactoe: "/static/icons/tictactoe.svg",
    spinwheel: "/static/icons/spinwheel.svg",
    ludo: "/static/icons/ludo.svg",
    chess: "/static/icons/chess.svg",
    "2048": "/static/icons/2048.svg",
    whackamole: "/static/icons/whackamole.svg",
    flappy: "/static/icons/flappy.svg",
    breakout: "/static/icons/breakout.svg",
    "rps-arena": "/static/icons/rps-arena.svg",
    "neon-connect": "/static/icons/neon-connect.svg",
    "neon-fleet": "/static/icons/neon-fleet.svg",
    "color-clash": "/static/icons/color-clash.svg",
  };

  const ArcadeAPI = {
    async requestJSON(url, options = {}) {
      const response = await fetch(url, options);
      if (!response.ok) {
        const fallback = `Request failed (${response.status})`;
        try {
          const data = await response.json();
          throw new Error(data.error || fallback);
        } catch (_error) {
          throw new Error(fallback);
        }
      }
      return response.json();
    },

    getConfig(gameName) {
      return this.requestJSON(`/api/config/${gameName}`);
    },

    submitScore(payload) {
      return this.requestJSON("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },

    getLeaderboard(top = 5) {
      return this.requestJSON(`/api/leaderboard?top=${encodeURIComponent(top)}`);
    },

    toast(message, type = "info") {
      showToast(message, type);
    },

    promptScoreSubmission(game, score, summary = "", meta = {}) {
      return openScoreModal({ game, score, summary, meta });
    },
  };

  window.ArcadeAPI = ArcadeAPI;

  // ------------------------------------------------------------------
  // Shared modal confirm (replaces window.confirm - never block the page
  // with a browser dialog). Returns a Promise<boolean>.
  // ------------------------------------------------------------------

  let confirmModal = null;

  function createConfirmModal() {
    const modal = document.createElement("div");
    modal.className = "modal hidden";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="modal-card card-surface" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <h3 id="confirm-title">Confirm</h3>
        <p id="confirm-message" class="modal-summary"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-confirm-ok>OK</button>
          <button type="button" class="btn btn-outline" data-confirm-cancel>Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * @param {string} message
   * @param {{ okText?: string, cancelText?: string, danger?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  function confirmDialog(message, options = {}) {
    return new Promise((resolve) => {
      if (!confirmModal) confirmModal = createConfirmModal();
      const modal = confirmModal;
      modal.querySelector("#confirm-message").textContent = message;
      const okBtn = modal.querySelector("[data-confirm-ok]");
      const cancelBtn = modal.querySelector("[data-confirm-cancel]");
      okBtn.textContent = options.okText || "OK";
      cancelBtn.textContent = options.cancelText || "Cancel";
      okBtn.className = options.danger ? "btn btn-danger" : "btn btn-primary";

      const close = (result) => {
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onOk = () => close(true);
      const onCancel = () => close(false);
      const onBackdrop = (event) => {
        if (event.target === modal) close(false);
      };
      const onKey = (event) => {
        if (event.key === "Escape") close(false);
      };

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      cancelBtn.focus();
    });
  }

  window.ArcadeUI = { confirm: confirmDialog };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("page-ready");
    initNavMenu();

    if (PAGE === "home") {
      initHomeFilters();
    }

    if (PAGE === "leaderboard") {
      renderLeaderboard();
    }
  });

  // ------------------------------------------------------------------
  // Mobile header menu (hamburger + drawer).
  // ------------------------------------------------------------------

  function initNavMenu() {
    const button = document.getElementById("nav-menu-btn");
    const drawer = document.getElementById("nav-drawer");
    if (!button || !drawer) return;

    const setOpen = (open) => {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      drawer.classList.toggle("open", open);
      if (open) {
        const first = drawer.querySelector("a, button");
        if (first) first.focus({ preventScroll: true });
      }
    };

    button.addEventListener("click", () => {
      setOpen(!drawer.classList.contains("open"));
    });

    // Any choice inside the drawer closes it (links navigate away anyway).
    drawer.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawer.classList.contains("open")) setOpen(false);
    });

    // Clicking outside the drawer closes it.
    document.addEventListener("click", (event) => {
      if (!drawer.classList.contains("open")) return;
      if (event.target === button || button.contains(event.target)) return;
      if (drawer.contains(event.target)) return;
      setOpen(false);
    });

    // Returning to a desktop-width viewport always resets the drawer.
    window.addEventListener("resize", () => {
      if (window.innerWidth > 767 && drawer.classList.contains("open")) setOpen(false);
    });
  }

  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  function openScoreModal({ game, score, summary, meta }) {
    const modal = document.getElementById("score-modal");
    const form = document.getElementById("score-form");
    const summaryEl = document.getElementById("score-modal-summary");
    const skipBtn = document.getElementById("score-skip");
    const nameInput = document.getElementById("player-name");
    const scoreInput = document.getElementById("score-value");
    const gameInput = document.getElementById("score-game");

    if (!modal || !form || !summaryEl || !skipBtn || !nameInput || !scoreInput || !gameInput) {
      return Promise.resolve(false);
    }

    summaryEl.textContent = `${summary} Final score: ${score}`.trim();
    scoreInput.value = score;
    gameInput.value = game;
    nameInput.value = "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    nameInput.focus();

    return new Promise((resolve) => {
      const close = (result) => {
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        form.removeEventListener("submit", onSubmit);
        skipBtn.removeEventListener("click", onSkip);
        resolve(result);
      };

      const onSkip = () => close(false);

      const onSubmit = async (event) => {
        event.preventDefault();
        const player = (nameInput.value || "Anonymous").trim();

        try {
          await ArcadeAPI.submitScore({ game, player, score, meta });
          ArcadeAPI.toast("Score saved to leaderboard", "success");
          close(true);
        } catch (error) {
          ArcadeAPI.toast(error.message || "Failed to save score", "error");
        }
      };

      form.addEventListener("submit", onSubmit);
      skipBtn.addEventListener("click", onSkip);
    });
  }

  function initHomeFilters() {
    const buttons = Array.from(document.querySelectorAll(".filter-btn"));
    const cards = Array.from(document.querySelectorAll(".game-card"));
    if (buttons.length === 0 || cards.length === 0) {
      return;
    }

    const applyFilter = (filter) => {
      cards.forEach((card) => {
        const category = (card.dataset.category || "").toLowerCase();
        const visible = filter === "all" || category === filter;
        card.classList.toggle("hidden", !visible);
      });

      buttons.forEach((button) => {
        const active = button.dataset.filter === filter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        applyFilter((button.dataset.filter || "all").toLowerCase());
      });
    });

    applyFilter("all");
  }

  async function renderLeaderboard() {
    const root = document.getElementById("leaderboard-root");
    if (!root) {
      return;
    }

    const gameNames = (document.body.dataset.games || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    root.innerHTML = "<p>Loading leaderboard...</p>";
    try {
      const response = await ArcadeAPI.getLeaderboard(5);
      const data = response.leaderboard || {};
      const names = gameNames.length > 0 ? gameNames : Object.keys(data);

      root.innerHTML = "";
      names.forEach((gameName) => {
        const entries = Array.isArray(data[gameName]) ? data[gameName] : [];
        const card = document.createElement("article");
        card.className = "lb-card card-surface";
        const logo = GAME_LOGOS[gameName];
        card.innerHTML = `<div class="lb-head">${logo ? `<img class="lb-icon" src="${escapeHtml(logo)}" alt="" loading="lazy" />` : ""}<h3>${escapeHtml(formatGameTitle(gameName))}</h3></div>`;

        const list = document.createElement("ol");
        list.className = "lb-list";

        if (entries.length === 0) {
          const row = document.createElement("li");
          row.className = "lb-row";
          row.innerHTML = "<span>No scores yet</span><span>0</span>";
          list.appendChild(row);
        } else {
          entries.forEach((entry) => {
            const row = document.createElement("li");
            row.className = "lb-row";
            row.innerHTML = `<span>${escapeHtml(entry.player || "Anonymous")}</span><span>${Number(entry.score || 0)}</span>`;
            list.appendChild(row);
          });
        }

        card.appendChild(list);
        root.appendChild(card);
      });
    } catch (error) {
      root.innerHTML = `<p>Unable to load leaderboard: ${escapeHtml(error.message)}</p>`;
    }
  }

  function formatGameTitle(name) {
    return GAME_TITLES[name] || name;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
