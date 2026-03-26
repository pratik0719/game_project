from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
import xml.etree.ElementTree as ET

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
GAMES_DIR = BASE_DIR / "games"
CONFIG_FILE = BASE_DIR / "config.xml"
SCORES_FILE = BASE_DIR / "scores.xml"

GAME_DEFAULTS: dict[str, dict[str, Any]] = {
    "snake": {
        "title": "Snake Rush",
        "icon": "🐍",
        "accent": "#39ff14",
        "description": "Classic arcade snake on a neon grid.",
        "script": "snake.js",
        "config_file": "snake.xml",
        "category": "arcade",
        "is_new": False,
    },
    "memory": {
        "title": "Memory Pulse",
        "icon": "🧠",
        "accent": "#00e5ff",
        "description": "Flip cards, match pairs, and beat the clock.",
        "script": "memory.js",
        "config_file": "memory.xml",
        "category": "casual",
        "is_new": False,
    },
    "quiz": {
        "title": "Quiz Reactor",
        "icon": "❓",
        "accent": "#ffb703",
        "description": "Fast multiple-choice rounds with per-question timers.",
        "script": "quiz.js",
        "config_file": "quiz.xml",
        "category": "casual",
        "is_new": False,
    },
    "tictactoe": {
        "title": "Tic Tac Toe Grid",
        "icon": "⭕",
        "accent": "#ff4d9d",
        "description": "Play head-to-head or challenge the AI.",
        "script": "tictactoe.js",
        "config_file": "tictactoe.xml",
        "category": "board",
        "is_new": False,
    },
    "spinwheel": {
        "title": "Spin the Wheel",
        "icon": "🎡",
        "accent": "#c084fc",
        "description": "Spin a colorful prize wheel and stack your wins.",
        "script": "spinwheel.js",
        "config_file": "spinwheel.xml",
        "category": "casual",
        "is_new": True,
    },
    "ludo": {
        "title": "Ludo Blitz",
        "icon": "🎲",
        "accent": "#ff6b35",
        "description": "Race tokens home in a 2-4 player Ludo showdown.",
        "script": "ludo.js",
        "config_file": "ludo.xml",
        "category": "board",
        "is_new": True,
    },
    "chess": {
        "title": "Neon Chess",
        "icon": "♞",
        "accent": "#f0c040",
        "description": "Classic chess with legal hints and minimax AI.",
        "script": "chess.js",
        "config_file": "chess.xml",
        "category": "board",
        "is_new": True,
    },
    "2048": {
        "title": "2048 Surge",
        "icon": "🔢",
        "accent": "#fb923c",
        "description": "Merge tiles, chase 2048, and beat your high score.",
        "script": "game2048.js",
        "config_file": "game2048.xml",
        "category": "board",
        "is_new": True,
    },
    "whackamole": {
        "title": "Whack-a-Mole",
        "icon": "🐹",
        "accent": "#4ade80",
        "description": "Whack popping moles before the timer ends.",
        "script": "whackamole.js",
        "config_file": "whackamole.xml",
        "category": "arcade",
        "is_new": True,
    },
    "flappy": {
        "title": "Flappy Burst",
        "icon": "🐤",
        "accent": "#38bdf8",
        "description": "Flap through pipes in a fast side-scrolling challenge.",
        "script": "flappy.js",
        "config_file": "flappy.xml",
        "category": "arcade",
        "is_new": True,
    },
    "breakout": {
        "title": "Breakout Neon",
        "icon": "🧱",
        "accent": "#e879f9",
        "description": "Smash bricks, preserve lives, and climb levels.",
        "script": "breakout.js",
        "config_file": "breakout.xml",
        "category": "arcade",
        "is_new": True,
    },
}

SCORES_LOCK = Lock()


def _coerce_value(value: str) -> Any:
    cleaned = value.strip()
    if cleaned == "":
        return ""
    lowered = cleaned.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    try:
        if "." in cleaned:
            return float(cleaned)
        return int(cleaned)
    except ValueError:
        return cleaned


def _to_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _element_to_dict(element: ET.Element) -> Any:
    children = list(element)
    payload: dict[str, Any] = {}

    if element.attrib:
        payload["@attributes"] = dict(element.attrib)

    if children:
        grouped: dict[str, Any] = {}
        for child in children:
            child_payload = _element_to_dict(child)
            if child.tag in grouped:
                if not isinstance(grouped[child.tag], list):
                    grouped[child.tag] = [grouped[child.tag]]
                grouped[child.tag].append(child_payload)
            else:
                grouped[child.tag] = child_payload
        payload.update(grouped)

        text_value = (element.text or "").strip()
        if text_value:
            payload["#text"] = _coerce_value(text_value)
        return payload

    text_value = (element.text or "").strip()
    if payload:
        if text_value:
            payload["#text"] = _coerce_value(text_value)
        return payload

    return _coerce_value(text_value)


def parse_xml(file_path: str | Path) -> dict[str, Any]:
    xml_path = Path(file_path)
    tree = ET.parse(xml_path)
    root = tree.getroot()
    return {root.tag: _element_to_dict(root)}


def _platform_config() -> dict[str, Any]:
    parsed = parse_xml(CONFIG_FILE)
    return parsed.get("platform", {})


def _platform_name() -> str:
    return str(_platform_config().get("name", "Neon Arcade Nexus"))


def _platform_game_entries() -> list[dict[str, Any]]:
    platform = _platform_config()
    games_container = platform.get("games", {}) if isinstance(platform, dict) else {}
    games_raw = games_container.get("game", []) if isinstance(games_container, dict) else []

    if isinstance(games_raw, dict):
        games_raw = [games_raw]

    merged = {name: dict(config) for name, config in GAME_DEFAULTS.items()}

    for game in games_raw:
        attrs = game.get("@attributes", {}) if isinstance(game, dict) else {}
        name = str(attrs.get("name", "")).strip().lower()
        if name in merged:
            merged[name]["title"] = attrs.get("title", merged[name]["title"])
            merged[name]["icon"] = attrs.get("icon", merged[name]["icon"])
            merged[name]["accent"] = attrs.get("accent", merged[name]["accent"])
            merged[name]["category"] = str(attrs.get("category", merged[name]["category"]))
            merged[name]["description"] = attrs.get("description", merged[name]["description"])
            merged[name]["is_new"] = _to_bool(attrs.get("is_new"), merged[name]["is_new"])

    ordered_entries: list[dict[str, Any]] = []
    for game_name in GAME_DEFAULTS:
        entry = dict(merged[game_name])
        entry["name"] = game_name
        ordered_entries.append(entry)
    return ordered_entries


def _game_xml_path(game_name: str) -> Path:
    info = GAME_DEFAULTS[game_name]
    config_file = str(info.get("config_file", f"{game_name}.xml"))
    return GAMES_DIR / game_name / config_file


def _ensure_scores_file() -> None:
    if SCORES_FILE.exists():
        try:
            tree = ET.parse(SCORES_FILE)
            root = tree.getroot()
        except ET.ParseError:
            root = ET.Element("scores")
            tree = ET.ElementTree(root)
    else:
        root = ET.Element("scores")
        tree = ET.ElementTree(root)

    existing = {node.get("name") for node in root.findall("game")}
    for game_name in GAME_DEFAULTS:
        if game_name not in existing:
            ET.SubElement(root, "game", {"name": game_name})

    tree.write(SCORES_FILE, encoding="utf-8", xml_declaration=True)


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _append_score(game_name: str, player: str, score: int, meta: dict[str, Any] | None) -> None:
    with SCORES_LOCK:
        _ensure_scores_file()
        tree = ET.parse(SCORES_FILE)
        root = tree.getroot()

        game_node = None
        for node in root.findall("game"):
            if node.get("name") == game_name:
                game_node = node
                break

        if game_node is None:
            game_node = ET.SubElement(root, "game", {"name": game_name})

        entry = ET.SubElement(game_node, "entry")
        ET.SubElement(entry, "player").text = player
        ET.SubElement(entry, "score").text = str(score)
        ET.SubElement(entry, "timestamp").text = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

        if meta:
            meta_node = ET.SubElement(entry, "meta")
            for key, value in meta.items():
                safe_key = "".join(ch if ch.isalnum() else "_" for ch in str(key)).strip("_")[:40]
                if not safe_key:
                    continue
                ET.SubElement(meta_node, safe_key).text = str(value)[:120]

        tree.write(SCORES_FILE, encoding="utf-8", xml_declaration=True)


def _read_leaderboard(top_n: int = 5) -> dict[str, list[dict[str, Any]]]:
    _ensure_scores_file()
    tree = ET.parse(SCORES_FILE)
    root = tree.getroot()

    leaderboard: dict[str, list[dict[str, Any]]] = {name: [] for name in GAME_DEFAULTS}

    for game_node in root.findall("game"):
        game_name = game_node.get("name", "")
        if not game_name:
            continue

        entries: list[dict[str, Any]] = []
        for entry_node in game_node.findall("entry"):
            meta_node = entry_node.find("meta")
            meta = {}
            if meta_node is not None:
                for item in list(meta_node):
                    meta[item.tag] = item.text or ""

            entries.append(
                {
                    "player": entry_node.findtext("player", "Anonymous"),
                    "score": _safe_int(entry_node.findtext("score", "0")),
                    "timestamp": entry_node.findtext("timestamp", ""),
                    "meta": meta,
                }
            )

        entries.sort(key=lambda row: row["score"], reverse=True)
        leaderboard[game_name] = entries[:top_n]

    return leaderboard


@app.get("/")
def home() -> str:
    games = _platform_game_entries()
    return render_template(
        "index.html",
        games=games,
        platform_name=_platform_name(),
        game_count=len(games),
    )


@app.get("/game/<game_name>")
def load_game(game_name: str) -> str:
    game_name = game_name.lower().strip()
    entries = {entry["name"]: entry for entry in _platform_game_entries()}
    if game_name not in entries:
        abort(404)

    game = entries[game_name]
    return render_template(
        "game.html",
        game_name=game_name,
        game_title=game["title"],
        game_script=GAME_DEFAULTS[game_name]["script"],
        accent=game["accent"],
        platform_name=_platform_name(),
    )


@app.get("/leaderboard")
def leaderboard_page() -> str:
    return render_template(
        "leaderboard.html",
        platform_name=_platform_name(),
        games=_platform_game_entries(),
    )


@app.get("/games/<game_name>/<path:filename>")
def serve_game_asset(game_name: str, filename: str):
    game_name = game_name.lower().strip()
    if game_name not in GAME_DEFAULTS:
        abort(404)
    return send_from_directory(GAMES_DIR / game_name, filename)


@app.get("/api/config/<game_name>")
def get_config(game_name: str):
    game_name = game_name.lower().strip()

    if game_name in {"platform", "config"}:
        xml_path = CONFIG_FILE
    elif game_name in GAME_DEFAULTS:
        xml_path = _game_xml_path(game_name)
    else:
        return jsonify({"error": "Unknown game"}), 404

    if not xml_path.exists():
        return jsonify({"error": "Config file not found"}), 404

    try:
        return jsonify(parse_xml(xml_path))
    except ET.ParseError as exc:
        return jsonify({"error": f"Invalid XML config: {exc}"}), 500


@app.post("/api/score")
def post_score():
    payload = request.get_json(silent=True) or {}

    game_name = str(payload.get("game", "")).lower().strip()
    if game_name not in GAME_DEFAULTS:
        return jsonify({"error": "Invalid game name"}), 400

    player = str(payload.get("player", "Anonymous")).strip()[:32] or "Anonymous"
    score = _safe_int(payload.get("score", 0))

    raw_meta = payload.get("meta", {})
    meta = raw_meta if isinstance(raw_meta, dict) else {}

    _append_score(game_name, player, score, meta)

    return jsonify(
        {
            "status": "ok",
            "saved": {
                "game": game_name,
                "player": player,
                "score": score,
            },
        }
    )


@app.get("/api/leaderboard")
def get_leaderboard():
    top_n = request.args.get("top", default=5, type=int)
    top_n = max(1, min(top_n, 20))
    return jsonify({"top": top_n, "leaderboard": _read_leaderboard(top_n=top_n)})


_ensure_scores_file()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
