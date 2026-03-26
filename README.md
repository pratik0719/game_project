# game_project

Neon arcade multi-game platform built with Flask + XML-configured games.

## Setup

```bash
python -m pip install -r requirements.txt
python app.py
```

Open: `http://127.0.0.1:5000`

## Included games

- Snake (canvas)
- Memory Match
- Quiz
- Tic Tac Toe (2-player or vs AI)

## API endpoints

- `GET /`
- `GET /game/<game_name>`
- `GET /api/config/<game_name>`
- `POST /api/score`
- `GET /api/leaderboard`

