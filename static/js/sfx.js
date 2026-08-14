/**
 * ArcadeSFX
 * ---------
 * Tiny shared sound utility for the arcade games. Generates short synth
 * blips with the Web Audio API (no audio files), remembers the mute
 * preference locally, and injects a floating mute toggle on game pages.
 *
 *   window.ArcadeSFX.play("turn");
 *   window.ArcadeSFX.toggleMute();
 *
 * No audio plays until the user has interacted with the page at least once
 * (browser autoplay policy), so nothing loud ever autoplays.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "arcadeSfxMuted";
  let ctx = null;
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_error) {
    muted = false;
  }

  // name -> [type, freq, duration(ms), gain]
  const SOUNDS = {
    turn: ["square", 660, 90, 0.05],
    move: ["triangle", 520, 80, 0.06],
    invalid: ["sawtooth", 180, 160, 0.07],
    hit: ["square", 220, 180, 0.12],
    miss: ["sine", 320, 220, 0.05],
    card: ["triangle", 700, 90, 0.06],
    reveal: ["sine", 880, 260, 0.09],
    win: ["square", 660, 420, 0.09],
    lose: ["sawtooth", 240, 420, 0.08],
    chat: ["sine", 520, 120, 0.04],
  };

  function ensureContext() {
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function play(name) {
    if (muted) return;
    const spec = SOUNDS[name];
    if (!spec) return;
    const context = ensureContext();
    if (!context) return;

    const [type, frequency, duration, gainValue] = spec;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration / 1000 + 0.02);
  }

  function setMuted(next) {
    muted = Boolean(next);
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (_error) {
      /* ignore */
    }
    updateButton();
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  function isMuted() {
    return muted;
  }

  let buttons = [];

  function setButtonState(el) {
    const glyph = muted ? "🔇" : "🔊";
    // Drawer buttons keep a separate label span (e.g. "Sound"); compact
    // header buttons are icon-only.
    const icon = el.querySelector(".nav-sfx-icon");
    if (icon) icon.textContent = glyph;
    else el.textContent = glyph;
    el.classList.toggle("muted", muted);
    el.setAttribute("aria-pressed", muted ? "true" : "false");
    el.setAttribute("aria-label", muted ? "Unmute sounds" : "Mute sounds");
  }

  function updateButton() {
    buttons.forEach(setButtonState);
  }

  // Wire every sound toggle on the page (header button + mobile drawer
  // button) so they all share one mute state.
  function wireMuteButton() {
    if (buttons.length) return;
    buttons = Array.from(document.querySelectorAll("[data-sfx-toggle]"));
    if (buttons.length === 0) {
      // Defensive fallback: drop one into the header nav if the markup
      // is missing on some future page.
      const fallback = document.createElement("button");
      fallback.id = "sfx-mute";
      fallback.type = "button";
      fallback.className = "sfx-mute-btn";
      fallback.dataset.sfxToggle = "";
      const nav = document.querySelector(".site-header .top-nav");
      if (nav) nav.appendChild(fallback);
      else document.body.appendChild(fallback);
      buttons.push(fallback);
    }
    buttons.forEach((el) => {
      el.title = "Toggle sound";
      el.addEventListener("click", toggleMute);
    });
    updateButton();
  }

  // Resume/prime the audio context on the first interaction.
  function prime() {
    ensureContext();
  }
  document.addEventListener("pointerdown", prime, { once: true });
  document.addEventListener("keydown", prime, { once: true });

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "home" || page === "game" || page === "leaderboard") wireMuteButton();
  });

  window.ArcadeSFX = {
    play,
    toggleMute,
    setMuted,
    isMuted,
  };
})();
