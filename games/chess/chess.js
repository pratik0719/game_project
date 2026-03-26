(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("chess");
    config = response.chess || response;
  } catch (error) {
    statusEl.textContent = `Could not load chess config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load chess config", "error");
    return;
  }

  const aiDepth = Math.max(1, Math.min(3, Number(config.ai_depth || 2)));
  const showHints = String(config.show_hints).toLowerCase() !== "false";

  root.innerHTML = `
    <div class="chess-layout">
      <div id="chess-board" class="chess-board"></div>
      <aside class="chess-history">
        <h4>Move History</h4>
        <ol id="chess-history-list" class="chess-history-list"></ol>
      </aside>
    </div>
  `;

  controls.innerHTML = `
    <div class="mode-switch" id="chess-modes">
      <button class="btn btn-outline active" data-mode="ai">Vs AI</button>
      <button class="btn btn-outline" data-mode="pvp">2 Player</button>
    </div>
    <button class="btn btn-outline" id="chess-restart">Restart</button>
  `;

  const boardEl = document.getElementById("chess-board");
  const historyEl = document.getElementById("chess-history-list");
  const modesEl = document.getElementById("chess-modes");
  const restartBtn = document.getElementById("chess-restart");

  const symbols = {
    wP: "♙",
    wR: "♖",
    wN: "♘",
    wB: "♗",
    wQ: "♕",
    wK: "♔",
    bP: "♟",
    bR: "♜",
    bN: "♞",
    bB: "♝",
    bQ: "♛",
    bK: "♚",
  };

  const pieceValues = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  let board = null;
  let turn = "w";
  let selected = null;
  let legalTargets = [];
  let mode = "ai";
  let history = [];
  let gameOver = false;
  let thinking = false;

  setup();

  restartBtn.addEventListener("click", setup);
  modesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) {
      return;
    }
    mode = button.dataset.mode;
    Array.from(modesEl.querySelectorAll("button")).forEach((node) => {
      node.classList.toggle("active", node === button);
    });
    setup();
  });

  function setup() {
    board = createInitialBoard();
    turn = "w";
    selected = null;
    legalTargets = [];
    history = [];
    gameOver = false;
    thinking = false;
    statusEl.textContent = mode === "ai" ? "Your move (White)." : "White to move.";
    renderHistory();
    renderBoard();
  }

  function renderBoard() {
    boardEl.innerHTML = "";

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `chess-cell ${(row + col) % 2 === 0 ? "light" : "dark"}`;
        button.dataset.row = String(row);
        button.dataset.col = String(col);

        const piece = board[row][col];
        button.textContent = piece ? symbols[piece] : "";

        if (selected && selected.row === row && selected.col === col) {
          button.classList.add("selected");
        }

        if (showHints && legalTargets.some((target) => target.row === row && target.col === col)) {
          button.classList.add("target");
        }

        button.disabled = gameOver || thinking;
        button.addEventListener("click", onCellClick);
        boardEl.appendChild(button);
      }
    }
  }

  function renderHistory() {
    historyEl.innerHTML = "";
    history.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      historyEl.appendChild(li);
    });
  }

  function onCellClick(event) {
    if (gameOver || thinking) {
      return;
    }

    if (mode === "ai" && turn === "b") {
      return;
    }

    const button = event.currentTarget;
    const row = Number(button.dataset.row);
    const col = Number(button.dataset.col);
    const piece = board[row][col];

    if (selected) {
      const move = legalTargets.find((candidate) => candidate.row === row && candidate.col === col);
      if (move) {
        commitMove({
          fromRow: selected.row,
          fromCol: selected.col,
          toRow: row,
          toCol: col,
        });
        return;
      }
    }

    if (piece && piece[0] === turn) {
      selected = { row, col };
      legalTargets = getLegalMovesForPiece(board, row, col, turn).map((move) => ({ row: move.toRow, col: move.toCol }));
    } else {
      selected = null;
      legalTargets = [];
    }

    renderBoard();
  }

  function commitMove(move) {
    const movedPiece = board[move.fromRow][move.fromCol];
    const capturedPiece = board[move.toRow][move.toCol];

    board = applyMove(board, move);

    const notation = `${toAlgebraic(move.fromRow, move.fromCol)}-${toAlgebraic(move.toRow, move.toCol)}`;
    history.push(capturedPiece ? `${notation} x` : notation);
    renderHistory();

    selected = null;
    legalTargets = [];
    turn = turn === "w" ? "b" : "w";

    const endState = evaluateEndState(board, turn);
    if (endState.finished) {
      finishGame(endState, movedPiece);
      renderBoard();
      return;
    }

    if (isInCheck(board, turn)) {
      statusEl.textContent = `${turn === "w" ? "White" : "Black"} is in check.`;
    } else {
      statusEl.textContent = `${turn === "w" ? "White" : "Black"} to move.`;
      if (mode === "ai" && turn === "b") {
        statusEl.textContent = "AI is thinking...";
      }
    }

    renderBoard();

    if (mode === "ai" && turn === "b") {
      window.setTimeout(playAIMove, 280);
    }
  }

  function playAIMove() {
    if (gameOver || turn !== "b") {
      return;
    }

    thinking = true;
    renderBoard();

    const move = chooseAIMove(board, aiDepth, "b");

    thinking = false;
    if (!move) {
      const endState = evaluateEndState(board, turn);
      if (endState.finished) {
        finishGame(endState, null);
      }
      renderBoard();
      return;
    }

    commitMove(move);
  }

  function finishGame(endState, movedPiece) {
    gameOver = true;

    let resultText = "Game over.";
    let score = 70;

    if (endState.type === "checkmate") {
      const winner = turn === "w" ? "Black" : "White";
      resultText = `Checkmate. ${winner} wins.`;
      if (mode === "ai") {
        score = winner === "White" ? 260 : 55;
      } else {
        score = 200;
      }
    }

    if (endState.type === "stalemate") {
      resultText = "Stalemate. Draw.";
      score = 110;
    }

    statusEl.textContent = resultText;

    const summary = `${endState.type} | Moves: ${history.length}`;
    const winnerCode = endState.type === "checkmate" ? (turn === "w" ? "b" : "w") : "draw";

    window.ArcadeAPI.promptScoreSubmission(
      "chess",
      score,
      summary,
      { mode, result: winnerCode, moves: history.length, last_piece: movedPiece || "" }
    );
  }

  function evaluateEndState(currentBoard, sideToMove) {
    const moves = getAllLegalMoves(currentBoard, sideToMove);
    if (moves.length > 0) {
      return { finished: false, type: "running" };
    }

    if (isInCheck(currentBoard, sideToMove)) {
      return { finished: true, type: "checkmate" };
    }
    return { finished: true, type: "stalemate" };
  }

  function chooseAIMove(currentBoard, depth, aiColor) {
    const moves = getAllLegalMoves(currentBoard, aiColor);
    if (moves.length === 0) {
      return null;
    }

    let bestMove = moves[0];
    let bestValue = -Infinity;

    moves.forEach((move) => {
      const next = applyMove(currentBoard, move);
      const value = minimax(next, depth - 1, -Infinity, Infinity, false, aiColor === "w" ? "b" : "w", aiColor);
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
    });

    return bestMove;
  }

  function minimax(currentBoard, depth, alpha, beta, maximizing, sideToMove, aiColor) {
    const endState = evaluateEndState(currentBoard, sideToMove);
    if (depth <= 0 || endState.finished) {
      if (endState.finished && endState.type === "checkmate") {
        return sideToMove === aiColor ? -99999 : 99999;
      }
      if (endState.finished && endState.type === "stalemate") {
        return 0;
      }
      return evaluateBoard(currentBoard, aiColor);
    }

    const moves = getAllLegalMoves(currentBoard, sideToMove);
    if (maximizing) {
      let value = -Infinity;
      for (const move of moves) {
        const next = applyMove(currentBoard, move);
        value = Math.max(value, minimax(next, depth - 1, alpha, beta, false, sideToMove === "w" ? "b" : "w", aiColor));
        alpha = Math.max(alpha, value);
        if (beta <= alpha) {
          break;
        }
      }
      return value;
    }

    let value = Infinity;
    for (const move of moves) {
      const next = applyMove(currentBoard, move);
      value = Math.min(value, minimax(next, depth - 1, alpha, beta, true, sideToMove === "w" ? "b" : "w", aiColor));
      beta = Math.min(beta, value);
      if (beta <= alpha) {
        break;
      }
    }
    return value;
  }

  function evaluateBoard(currentBoard, perspective) {
    let score = 0;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = currentBoard[row][col];
        if (!piece) {
          continue;
        }
        const value = pieceValues[piece[1]] || 0;
        score += piece[0] === perspective ? value : -value;
      }
    }
    return score;
  }

  function getAllLegalMoves(currentBoard, side) {
    const moves = [];
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = currentBoard[row][col];
        if (!piece || piece[0] !== side) {
          continue;
        }
        moves.push(...getLegalMovesForPiece(currentBoard, row, col, side));
      }
    }
    return moves;
  }

  function getLegalMovesForPiece(currentBoard, row, col, side) {
    const piece = currentBoard[row][col];
    if (!piece || piece[0] !== side) {
      return [];
    }

    const pseudo = getPseudoMoves(currentBoard, row, col, piece, false);
    return pseudo.filter((move) => {
      const next = applyMove(currentBoard, move);
      return !isInCheck(next, side);
    });
  }

  function isInCheck(currentBoard, side) {
    let kingRow = -1;
    let kingCol = -1;

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        if (currentBoard[row][col] === `${side}K`) {
          kingRow = row;
          kingCol = col;
          break;
        }
      }
    }

    if (kingRow < 0 || kingCol < 0) {
      return true;
    }

    const enemy = side === "w" ? "b" : "w";
    return isSquareAttacked(currentBoard, kingRow, kingCol, enemy);
  }

  function isSquareAttacked(currentBoard, targetRow, targetCol, bySide) {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = currentBoard[row][col];
        if (!piece || piece[0] !== bySide) {
          continue;
        }

        const attacks = getPseudoMoves(currentBoard, row, col, piece, true);
        if (attacks.some((move) => move.toRow === targetRow && move.toCol === targetCol)) {
          return true;
        }
      }
    }
    return false;
  }

  function getPseudoMoves(currentBoard, row, col, piece, attackOnly) {
    const side = piece[0];
    const kind = piece[1];
    const enemy = side === "w" ? "b" : "w";
    const moves = [];

    if (kind === "P") {
      const dir = side === "w" ? -1 : 1;
      const startRow = side === "w" ? 6 : 1;
      const oneStep = row + dir;

      if (!attackOnly && inBounds(oneStep, col) && !currentBoard[oneStep][col]) {
        moves.push({ fromRow: row, fromCol: col, toRow: oneStep, toCol: col });
        const twoStep = row + dir * 2;
        if (row === startRow && !currentBoard[twoStep][col]) {
          moves.push({ fromRow: row, fromCol: col, toRow: twoStep, toCol: col });
        }
      }

      [-1, 1].forEach((dc) => {
        const tr = row + dir;
        const tc = col + dc;
        if (!inBounds(tr, tc)) {
          return;
        }
        const target = currentBoard[tr][tc];
        if (attackOnly) {
          moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
          return;
        }
        if (target && target[0] === enemy) {
          moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
        }
      });
      return moves;
    }

    if (kind === "N") {
      const jumps = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      jumps.forEach(([dr, dc]) => {
        const tr = row + dr;
        const tc = col + dc;
        if (!inBounds(tr, tc)) {
          return;
        }
        const target = currentBoard[tr][tc];
        if (!target || target[0] !== side) {
          moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
        }
      });
      return moves;
    }

    if (kind === "B" || kind === "R" || kind === "Q") {
      const directions = [];
      if (kind === "B" || kind === "Q") {
        directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (kind === "R" || kind === "Q") {
        directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }

      directions.forEach(([dr, dc]) => {
        let tr = row + dr;
        let tc = col + dc;
        while (inBounds(tr, tc)) {
          const target = currentBoard[tr][tc];
          if (!target) {
            moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
          } else {
            if (target[0] !== side) {
              moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
            }
            break;
          }
          tr += dr;
          tc += dc;
        }
      });
      return moves;
    }

    if (kind === "K") {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          const tr = row + dr;
          const tc = col + dc;
          if (!inBounds(tr, tc)) {
            continue;
          }
          const target = currentBoard[tr][tc];
          if (!target || target[0] !== side) {
            moves.push({ fromRow: row, fromCol: col, toRow: tr, toCol: tc });
          }
        }
      }
      return moves;
    }

    return moves;
  }

  function applyMove(currentBoard, move) {
    const next = currentBoard.map((row) => row.slice());
    const piece = next[move.fromRow][move.fromCol];
    next[move.fromRow][move.fromCol] = null;

    if (piece && piece[1] === "P" && (move.toRow === 0 || move.toRow === 7)) {
      next[move.toRow][move.toCol] = `${piece[0]}Q`;
    } else {
      next[move.toRow][move.toCol] = piece;
    }

    return next;
  }

  function toAlgebraic(row, col) {
    return `${"abcdefgh"[col]}${8 - row}`;
  }

  function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function createInitialBoard() {
    return [
      ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
      ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
      ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
    ];
  }
})();
