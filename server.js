"use strict";

const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Server } = require("socket.io");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { gameConfig: multiplayerGameConfig, listGameConfig } = require("./server/gameHandlers");
const { gameRegistry } = require("./server/gameRegistry");
const { RoomManager } = require("./server/roomManager");
const { registerSocketHandlers } = require("./server/socketHandlers");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const BASE_DIR = __dirname;
const GAMES_DIR = path.join(BASE_DIR, "games");
const CONFIG_FILE = path.join(BASE_DIR, "config.xml");
const SCORES_FILE = path.join(BASE_DIR, "scores.xml");

const GAME_DEFAULTS = {
  snake: { title: "Snake Rush", icon: "🐍", logo: "/static/icons/snake.svg", accent: "#39ff14", description: "Classic arcade snake on a neon grid.", script: "snake.js", configFile: "snake.xml", category: "arcade", isNew: false },
  memory: { title: "Memory Pulse", icon: "🧠", logo: "/static/icons/memory.svg", accent: "#00e5ff", description: "Flip cards, match pairs, and beat the clock.", script: "memory.js", configFile: "memory.xml", category: "casual", isNew: false },
  quiz: { title: "Quiz Reactor", icon: "❓", logo: "/static/icons/quiz.svg", accent: "#ffb703", description: "Fast multiple-choice rounds with per-question timers.", script: "quiz.js", configFile: "quiz.xml", category: "casual", isNew: false },
  tictactoe: { title: "Tic Tac Toe Grid", icon: "⭕", logo: "/static/icons/tictactoe.svg", accent: "#ff4d9d", description: "Play head-to-head or challenge the AI.", script: "tictactoe.js", configFile: "tictactoe.xml", category: "board", isNew: false },
  spinwheel: { title: "Spin the Wheel", icon: "🎡", logo: "/static/icons/spinwheel.svg", accent: "#c084fc", description: "Spin a colorful prize wheel and stack your wins.", script: "spinwheel.js", configFile: "spinwheel.xml", category: "casual", isNew: true },
  ludo: { title: "Ludo Blitz", icon: "🎲", logo: "/static/icons/ludo.svg", accent: "#ff6b35", description: "Race tokens home in a 2-4 player Ludo showdown.", script: "ludo.js", configFile: "ludo.xml", category: "board", isNew: true },
  chess: { title: "Neon Chess", icon: "♞", logo: "/static/icons/chess.svg", accent: "#f0c040", description: "Classic chess with legal hints and minimax AI.", script: "chess.js", configFile: "chess.xml", category: "board", isNew: true },
  "2048": { title: "2048 Surge", icon: "🔢", logo: "/static/icons/2048.svg", accent: "#fb923c", description: "Merge tiles, chase 2048, and beat your high score.", script: "game2048.js", configFile: "game2048.xml", category: "board", isNew: true },
  whackamole: { title: "Whack-a-Mole", icon: "🐹", logo: "/static/icons/whackamole.svg", accent: "#4ade80", description: "Whack popping moles before the timer ends.", script: "whackamole.js", configFile: "whackamole.xml", category: "arcade", isNew: true },
  flappy: { title: "Flappy Burst", icon: "🐤", logo: "/static/icons/flappy.svg", accent: "#38bdf8", description: "Flap through pipes in a fast side-scrolling challenge.", script: "flappy.js", configFile: "flappy.xml", category: "arcade", isNew: true },
  breakout: { title: "Breakout Neon", icon: "🧱", logo: "/static/icons/breakout.svg", accent: "#e879f9", description: "Smash bricks, preserve lives, and climb levels.", script: "breakout.js", configFile: "breakout.xml", category: "arcade", isNew: true },
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  isArray: (tagName) => ["game", "entry", "question", "option"].includes(tagName),
});
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

function parseXml(filePath) {
  return xmlParser.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function safeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function platformConfig() {
  return parseXml(CONFIG_FILE).platform || {};
}

function platformName() {
  return String(platformConfig().name || "Neon Arcade Nexus");
}

function gameEntries() {
  const configuredGames = asArray(platformConfig().games?.game);
  const merged = Object.fromEntries(Object.entries(GAME_DEFAULTS).map(([name, data]) => [name, { ...data }]));

  for (const game of configuredGames) {
    const name = String(game?.["@_name"] || "").trim().toLowerCase();
    if (!merged[name]) continue;
    merged[name].title = game["@_title"] || merged[name].title;
    merged[name].icon = game["@_icon"] || merged[name].icon;
    merged[name].logo = game["@_logo"] || merged[name].logo;
    merged[name].accent = game["@_accent"] || merged[name].accent;
    merged[name].category = String(game["@_category"] || merged[name].category);
    merged[name].description = game["@_description"] || merged[name].description;
    merged[name].isNew = toBoolean(game["@_is_new"], merged[name].isNew);
  }

  return Object.keys(GAME_DEFAULTS).map((name) => ({
    name,
    ...merged[name],
    multiplayerReady: Boolean(multiplayerGameConfig[name]?.multiplayerReady),
  }));
}

function gameConfigPath(gameName) {
  return path.join(GAMES_DIR, gameName, GAME_DEFAULTS[gameName].configFile);
}

function ensureScoresFile() {
  let scores = { scores: { game: [] } };
  let changed = !fs.existsSync(SCORES_FILE);
  try {
    if (fs.existsSync(SCORES_FILE)) scores = parseXml(SCORES_FILE);
  } catch (_error) {
    scores = { scores: { game: [] } };
    changed = true;
  }

  scores.scores ||= {};
  const games = asArray(scores.scores.game);
  const found = new Set(games.map((game) => game?.["@_name"]));
  for (const name of Object.keys(GAME_DEFAULTS)) {
    if (!found.has(name)) {
      games.push({ "@_name": name });
      changed = true;
    }
  }
  scores.scores.game = games;
  if (changed) fs.writeFileSync(SCORES_FILE, `${xmlBuilder.build(scores)}\n`, "utf8");
}

function appendScore(gameName, player, score, meta) {
  ensureScoresFile();
  const scores = parseXml(SCORES_FILE);
  const games = asArray(scores.scores.game);
  let game = games.find((item) => item?.["@_name"] === gameName);
  if (!game) {
    game = { "@_name": gameName, entry: [] };
    games.push(game);
  }
  const entry = { player, score, timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00") };
  const safeMeta = {};
  for (const [key, value] of Object.entries(meta || {})) {
    const safeKey = String(key).replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (safeKey) safeMeta[safeKey] = String(value).slice(0, 120);
  }
  if (Object.keys(safeMeta).length) entry.meta = safeMeta;
  game.entry = [...asArray(game.entry), entry];
  scores.scores.game = games;
  fs.writeFileSync(SCORES_FILE, `${xmlBuilder.build(scores)}\n`, "utf8");
}

function readLeaderboard(top = 5) {
  ensureScoresFile();
  const leaderboard = Object.fromEntries(Object.keys(GAME_DEFAULTS).map((name) => [name, []]));
  for (const game of asArray(parseXml(SCORES_FILE).scores?.game)) {
    const gameName = game?.["@_name"];
    if (!gameName) continue;
    const entries = asArray(game.entry)
      .map((entry) => ({ player: entry.player || "Anonymous", score: safeInteger(entry.score), timestamp: entry.timestamp || "", meta: entry.meta || {} }))
      .sort((a, b) => b.score - a.score)
      .slice(0, top);
    leaderboard[gameName] = entries;
  }
  return leaderboard;
}

app.engine("html", require("ejs").renderFile);
app.set("view engine", "html");
app.set("views", path.join(BASE_DIR, "templates"));
app.use(express.json({ limit: "32kb" }));
app.use("/static", express.static(path.join(BASE_DIR, "static")));

app.get("/", (_request, response) => {
  const games = gameEntries();
  response.render("index", { games, platformName: platformName(), gameCount: games.length });
});

app.get("/game/:gameName", (request, response) => {
  const gameName = request.params.gameName.trim().toLowerCase();
  const game = gameEntries().find((entry) => entry.name === gameName);
  if (!game) return response.sendStatus(404);
  return response.render("game", {
    gameName,
    gameTitle: game.title,
    gameIcon: game.logo,
    gameScript: GAME_DEFAULTS[gameName].script,
    accent: game.accent,
    platformName: platformName(),
    gameMultiplayerReady: Boolean(game.multiplayerReady),
  });
});

app.get("/leaderboard", (_request, response) => response.render("leaderboard", { platformName: platformName(), games: gameEntries() }));

app.get("/games/:gameName/*filename", (request, response) => {
  const gameName = request.params.gameName.trim().toLowerCase();
  if (!GAME_DEFAULTS[gameName]) return response.sendStatus(404);
  const filename = Array.isArray(request.params.filename) ? request.params.filename.join(path.sep) : request.params.filename;
  return response.sendFile(filename, { root: path.join(GAMES_DIR, gameName) }, (error) => {
    if (error && !response.headersSent) response.sendStatus(error.statusCode === 404 ? 404 : 500);
  });
});

app.get("/api/config/:gameName", (request, response) => {
  const gameName = request.params.gameName.trim().toLowerCase();
  const configPath = ["platform", "config"].includes(gameName) ? CONFIG_FILE : GAME_DEFAULTS[gameName] ? gameConfigPath(gameName) : null;
  if (!configPath) return response.status(404).json({ error: "Unknown game" });
  if (!fs.existsSync(configPath)) return response.status(404).json({ error: "Config file not found" });
  try {
    return response.json(parseXml(configPath));
  } catch (error) {
    return response.status(500).json({ error: `Invalid XML config: ${error.message}` });
  }
});

app.post("/api/score", (request, response) => {
  const payload = request.body || {};
  const gameName = String(payload.game || "").trim().toLowerCase();
  if (!GAME_DEFAULTS[gameName]) return response.status(400).json({ error: "Invalid game name" });
  const player = String(payload.player || "Anonymous").trim().slice(0, 32) || "Anonymous";
  const score = safeInteger(payload.score);
  const meta = payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta) ? payload.meta : {};
  appendScore(gameName, player, score, meta);
  return response.json({ status: "ok", saved: { game: gameName, player, score } });
});

app.get("/api/leaderboard", (request, response) => {
  const top = Math.max(1, Math.min(safeInteger(request.query.top, 5), 20));
  return response.json({ top, leaderboard: readLeaderboard(top) });
});

app.get("/api/multiplayer/config", (_request, response) => {
  return response.json({ games: listGameConfig(), registry: gameRegistry });
});

ensureScoresFile();
const roomManager = new RoomManager(multiplayerGameConfig);
registerSocketHandlers(io, roomManager);
setInterval(() => roomManager.pruneInactiveRooms(), 5 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`YUDY Game Arcade listening on http://localhost:${PORT}`));
