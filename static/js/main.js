(function () {
  const PAGE = document.body.dataset.page || "";

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

  async function renderLeaderboard() {
    const root = document.getElementById("leaderboard-root");
    if (!root) {
      return;
    }

    root.innerHTML = "<p>Loading leaderboard...</p>";
    try {
      const response = await ArcadeAPI.getLeaderboard(5);
      const data = response.leaderboard || {};
      const gameNames = ["snake", "memory", "quiz", "tictactoe"];

      root.innerHTML = "";
      gameNames.forEach((gameName) => {
        const entries = Array.isArray(data[gameName]) ? data[gameName] : [];
        const card = document.createElement("article");
        card.className = "lb-card card-surface";
        card.innerHTML = `<h3>${formatGameTitle(gameName)}</h3>`;

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
    switch (name) {
      case "snake":
        return "Snake Rush";
      case "memory":
        return "Memory Pulse";
      case "quiz":
        return "Quiz Reactor";
      case "tictactoe":
        return "Tic Tac Toe Grid";
      default:
        return name;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  if (PAGE === "leaderboard") {
    renderLeaderboard();
  }
})();

