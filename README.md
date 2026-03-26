# game_project

Neon Arcade Nexus: multi-game platform built with Flask + XML-configured games + Vanilla JS.

## Setup

```bash
python -m pip install -r requirements.txt
python app.py
```

Open: `http://127.0.0.1:5000`

## Included games (11)

- Snake Rush
- Memory Pulse
- Quiz Reactor
- Tic Tac Toe Grid
- Spin the Wheel
- Ludo Blitz
- Neon Chess
- 2048 Surge
- Whack-a-Mole
- Flappy Burst
- Breakout Neon

## API endpoints

- `GET /`
- `GET /game/<game_name>`
- `GET /api/config/<game_name>`
- `POST /api/score`
- `GET /api/leaderboard`
