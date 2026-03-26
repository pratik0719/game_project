(async function () {
  const statusEl = document.getElementById("game-status");
  const root = document.getElementById("game-root");
  const controls = document.getElementById("game-controls");

  if (!statusEl || !root || !controls) {
    return;
  }

  let config;
  try {
    const response = await window.ArcadeAPI.getConfig("quiz");
    config = response.quiz || response;
  } catch (error) {
    statusEl.textContent = `Could not load quiz config: ${error.message}`;
    window.ArcadeAPI.toast("Failed to load quiz config", "error");
    return;
  }

  let questions = (config.questions || {}).question || [];
  if (!Array.isArray(questions)) {
    questions = [questions];
  }

  questions = questions
    .filter(Boolean)
    .map((item) => {
      let options = item.option || [];
      if (!Array.isArray(options)) {
        options = [options];
      }
      return {
        text: item.text || "Question",
        options,
        answer: Number(item.answer || 1),
      };
    });

  const timerPerQuestion = Number(config.timer_per_question || 15);
  const pointsPerCorrect = Number(config.points_per_correct || 10);

  let index = 0;
  let score = 0;
  let correctCount = 0;
  let remaining = timerPerQuestion;
  let timerId = null;
  let locked = false;

  function startQuiz() {
    index = 0;
    score = 0;
    correctCount = 0;
    statusEl.textContent = "Answer before the timer runs out.";
    renderQuestion();
    renderControls();
  }

  function renderControls() {
    controls.innerHTML = "";
    const restart = document.createElement("button");
    restart.className = "btn btn-outline";
    restart.textContent = "Restart Quiz";
    restart.addEventListener("click", () => {
      clearTimer();
      startQuiz();
    });
    controls.appendChild(restart);
  }

  function renderQuestion() {
    clearTimer();

    const question = questions[index];
    if (!question) {
      finishQuiz();
      return;
    }

    locked = false;
    remaining = timerPerQuestion;

    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "quiz-wrap";

    const progress = document.createElement("p");
    progress.textContent = `Question ${index + 1} / ${questions.length}`;

    const questionEl = document.createElement("h3");
    questionEl.className = "quiz-question";
    questionEl.textContent = question.text;

    const timerBar = document.createElement("div");
    timerBar.className = "timer-bar";
    timerBar.innerHTML = "<span></span>";

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "quiz-options";

    question.options.forEach((optionText, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      button.textContent = optionText;
      button.addEventListener("click", () => onAnswer(optionIndex + 1, button));
      optionsWrap.appendChild(button);
    });

    wrap.appendChild(progress);
    wrap.appendChild(questionEl);
    wrap.appendChild(timerBar);
    wrap.appendChild(optionsWrap);
    root.appendChild(wrap);

    statusEl.textContent = `Score: ${score}`;

    timerId = window.setInterval(() => {
      remaining -= 1;
      const pct = Math.max(0, (remaining / timerPerQuestion) * 100);
      const bar = timerBar.querySelector("span");
      if (bar) {
        bar.style.width = `${pct}%`;
      }
      if (remaining <= 0) {
        onAnswer(-1, null);
      }
    }, 1000);
  }

  function onAnswer(selected, selectedBtn) {
    if (locked) {
      return;
    }

    locked = true;
    clearTimer();

    const question = questions[index];
    const buttons = Array.from(root.querySelectorAll(".quiz-option"));
    buttons.forEach((btn) => {
      btn.disabled = true;
    });

    const isCorrect = selected === question.answer;
    if (isCorrect) {
      correctCount += 1;
      score += pointsPerCorrect + remaining;
      if (selectedBtn) {
        selectedBtn.classList.add("correct");
      }
      statusEl.textContent = `Correct. Score: ${score}`;
    } else {
      if (selectedBtn) {
        selectedBtn.classList.add("wrong");
      }
      const answerBtn = buttons[question.answer - 1];
      if (answerBtn) {
        answerBtn.classList.add("correct");
      }
      statusEl.textContent = `Wrong answer. Score: ${score}`;
    }

    window.setTimeout(() => {
      index += 1;
      renderQuestion();
    }, 900);
  }

  function clearTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function finishQuiz() {
    clearTimer();
    root.innerHTML = `
      <div class="quiz-wrap">
        <h3>Quiz Complete</h3>
        <p>You answered ${correctCount} / ${questions.length} correctly.</p>
        <p>Final score: ${score}</p>
      </div>
    `;

    statusEl.textContent = "Round finished.";

    window.ArcadeAPI.promptScoreSubmission(
      "quiz",
      score,
      `Correct: ${correctCount}/${questions.length}`,
      { correct: correctCount, total: questions.length }
    );
  }

  startQuiz();
})();

