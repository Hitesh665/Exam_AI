/**
 * ExamAI - Question Paper Lab & Interactive Quiz Engine (quiz.js)
 * Handles question generation, interactive test taking, automated grading,
 * subjective answer evaluation via /api/evaluate, printable exam views, and progress tracking.
 */

// ==========================================
// Quiz State
// ==========================================
let currentQuiz = null;
let quizUserAnswers = {};
let quizScores = {
  earned: 0,
  totalMarks: 0,
  details: {}
};

// ==========================================
// Progress Tracker Helpers
// ==========================================

/**
 * Gets student progress metrics from localStorage.
 */
function getStudentProgress() {
  const user = getCurrentUser();
  if (!user || !user.id) return null;
  const key = `${STORAGE_KEYS.PROGRESS_PREFIX}${user.id}`;
  const data = localStorage.getItem(key);
  if (!data) {
    return {
      totalTests: 0,
      totalQuestions: 0,
      types: {
        mcq: { correct: 0, total: 0 },
        one_mark: { correct: 0, total: 0 },
        short: { scored: 0, total: 0 },
        long: { scored: 0, total: 0 }
      }
    };
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * Updates student progress metrics and saves to localStorage.
 */
function recordQuizProgress(quiz, scores) {
  const user = getCurrentUser();
  if (!user || !user.id || !quiz || !quiz.questions) return;
  const key = `${STORAGE_KEYS.PROGRESS_PREFIX}${user.id}`;
  const progress = getStudentProgress() || {
    totalTests: 0,
    totalQuestions: 0,
    types: {
      mcq: { correct: 0, total: 0 },
      one_mark: { correct: 0, total: 0 },
      short: { scored: 0, total: 0 },
      long: { scored: 0, total: 0 }
    }
  };

  progress.totalTests += 1;
  progress.totalQuestions += quiz.questions.length;

  quiz.questions.forEach((q) => {
    const qType = q.type || 'mcq';
    const detail = scores.details[q.id] || { scored: 0 };
    if (!progress.types[qType]) {
      progress.types[qType] = { scored: 0, total: 0 };
    }

    if (qType === 'mcq') {
      progress.types.mcq.total += 1;
      if (detail.scored >= 1) progress.types.mcq.correct += 1;
    } else if (qType === 'one_mark') {
      progress.types.one_mark.total += 1;
      if (detail.scored >= 1) progress.types.one_mark.correct += 1;
    } else {
      progress.types[qType].scored += detail.scored;
      progress.types[qType].total += q.marks || (qType === 'short' ? 3 : 5);
    }
  });

  localStorage.setItem(key, JSON.stringify(progress));

  // Trigger UI update if progress modal is open
  if (typeof renderProgressUI === 'function') {
    renderProgressUI();
  }
}

// ==========================================
// Quiz Generation API Call
// ==========================================

/**
 * Requests a structured exam paper from /api/chat in JSON mode.
 * @param {object} config - { type, count, difficulty, includeExplanations, topic }
 */
async function generateQuiz(config) {
  const profile = getUserProfile();
  const topic = config.topic || 'High Yield Exam Preparation';

  showToast('Generating exam question paper with Gemini AI...', 'info');

  try {
    const response = await authFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'quiz',
        quizConfig: config,
        profile,
        messages: [{ role: 'user', content: `Generate a ${config.difficulty} ${config.type} test on ${topic}` }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 429 || data.isRateLimit) {
        showRetryDialog('Rate limit reached on Google Gemini. Please wait a moment and try again.', () => generateQuiz(config));
        return;
      }
      if (data.isKeyMissing) {
        showToast(data.error, 'error');
        return;
      }
      throw new Error(data.error || 'Failed to generate quiz.');
    }

    if (data.quiz && data.quiz.questions) {
      openQuizModal(data.quiz, topic, config);
    } else {
      throw new Error('Invalid quiz format received from AI.');
    }
  } catch (err) {
    console.error('Quiz generation error:', err);
    showToast(err.message || 'Error creating question paper.', 'error');
  }
}

// ==========================================
// Interactive Quiz Rendering & Modal
// ==========================================

/**
 * Opens the fullscreen Quiz Modal and renders the questions.
 */
function openQuizModal(quiz, topic, config) {
  currentQuiz = quiz;
  quizUserAnswers = {};
  quizScores = {
    earned: 0,
    totalMarks: quiz.questions.reduce((sum, q) => sum + (q.marks || 1), 0),
    details: {}
  };

  const modal = document.getElementById('quizModal');
  const badge = document.getElementById('quizHeaderBadge');
  const title = document.getElementById('quizHeaderTitle');
  const body = document.getElementById('quizBody');

  if (badge) badge.textContent = `${config.difficulty} • ${config.type.toUpperCase()}`;
  if (title) title.textContent = `Test: ${topic}`;

  renderQuizBody(quiz, body);
  modal.classList.add('is-open');
}

/**
 * Closes the Quiz Modal.
 */
function closeQuizModal() {
  const modal = document.getElementById('quizModal');
  if (modal) modal.classList.remove('is-open');
}

/**
 * Renders questions grouped by sections into the modal body.
 */
function renderQuizBody(quiz, container) {
  if (!container || !quiz || !quiz.questions) return;
  container.innerHTML = '';

  // Header Paper Sheet
  const sheet = document.createElement('div');
  sheet.className = 'paper-sheet';

  const profile = getUserProfile();
  const examName = profile.exam || 'Comprehensive Examination';
  const totalMarks = quizScores.totalMarks;

  sheet.innerHTML = `
    <div class="paper-sheet__header">
      <h3 class="paper-sheet__exam-title">${escapeHtml(examName)} Practice Paper</h3>
      <div class="paper-sheet__meta">
        <span><strong>Questions:</strong> ${quiz.questions.length}</span>
        <span><strong>Max Marks:</strong> ${totalMarks}</span>
        <span><strong>Time Allowed:</strong> ${quiz.questions.length * 3} mins</span>
      </div>
    </div>
  `;

  // Group questions by section
  let currentSection = '';

  quiz.questions.forEach((q, index) => {
    // Add section heading if new
    if (q.section && q.section !== currentSection) {
      currentSection = q.section;
      const secHeading = document.createElement('div');
      secHeading.className = 'paper-section-heading';
      secHeading.innerHTML = `
        <span>SECTION ${escapeHtml(currentSection)}</span>
        <span>${getSectionTitle(q.type)}</span>
      `;
      sheet.appendChild(secHeading);
    }

    const qCard = document.createElement('div');
    qCard.className = 'q-card';
    qCard.id = `qCard_${q.id}`;

    qCard.innerHTML = `
      <div class="q-card__header">
        <span class="q-card__number">Q${index + 1}. [Section ${escapeHtml(q.section || 'A')}]</span>
        <span class="q-card__marks">${q.marks || 1} ${q.marks === 1 ? 'Mark' : 'Marks'}</span>
      </div>
      <p class="q-card__text">${escapeHtml(q.question)}</p>
    `;

    // Render interactive controls based on question type
    if (q.type === 'mcq') {
      renderMcqControls(q, qCard);
    } else if (q.type === 'one_mark') {
      renderOneMarkControls(q, qCard);
    } else if (q.type === 'short') {
      renderShortAnswerControls(q, qCard);
    } else if (q.type === 'long') {
      renderLongAnswerControls(q, qCard);
    }

    sheet.appendChild(qCard);
  });

  // Finish & Submit Action Container
  const footerAction = document.createElement('div');
  footerAction.className = 'paper-sheet__footer';
  footerAction.style.textAlign = 'center';
  footerAction.style.marginTop = '2rem';

  const finishBtn = document.createElement('button');
  finishBtn.className = 'btn btn--primary btn--lg';
  finishBtn.innerHTML = 'Finish & Complete Test';
  finishBtn.addEventListener('click', finishTest);

  footerAction.appendChild(finishBtn);
  sheet.appendChild(footerAction);

  // Render any mathematical or chemical formulas in the paper
  if (typeof renderKaTeX === 'function') {
    renderKaTeX(sheet);
  }

  container.appendChild(sheet);
}

function getSectionTitle(type) {
  switch (type) {
    case 'mcq': return 'Multiple Choice Questions (1 Mark Each)';
    case 'one_mark': return 'Objective / Direct One-Mark Questions';
    case 'short': return 'Short Answer Conceptual Questions (3 Marks Each)';
    case 'long': return 'Long Answer Comprehensive Questions (5 Marks Each)';
    default: return 'Practice Questions';
  }
}

// ------------------------------------------
// 1. MCQ Controls
// ------------------------------------------
function renderMcqControls(q, container) {
  const optionsWrapper = document.createElement('div');
  optionsWrapper.className = 'mcq-options';

  const options = Array.isArray(q.options) ? q.options : [];
  const correctLetter = (q.answer || '').trim().charAt(0).toUpperCase();

  options.forEach((optText) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mcq-option-btn';
    btn.textContent = optText;

    btn.addEventListener('click', () => {
      if (quizUserAnswers[q.id]) return; // already answered

      // Determine option letter from start of text, e.g. "A) ..." or "A. ..."
      const optionLetter = optText.trim().charAt(0).toUpperCase();
      const isCorrect = optionLetter === correctLetter;

      quizUserAnswers[q.id] = { selected: optionLetter, isCorrect };

      // Highlight buttons
      const allBtns = optionsWrapper.querySelectorAll('.mcq-option-btn');
      allBtns.forEach((b) => {
        b.disabled = true;
        const bLetter = b.textContent.trim().charAt(0).toUpperCase();
        if (bLetter === correctLetter) {
          b.classList.add('mcq-option-btn--correct');
        } else if (b === btn && !isCorrect) {
          b.classList.add('mcq-option-btn--wrong');
        }
      });

      // Update Score
      const earned = isCorrect ? (q.marks || 1) : 0;
      quizScores.earned += earned;
      quizScores.details[q.id] = { scored: earned, max: q.marks || 1, isCorrect };

      // Reveal explanation if available
      if (q.explanation) {
        const expBox = document.createElement('div');
        expBox.className = 'reveal-box';
        expBox.innerHTML = `
          <strong>${isCorrect ? '✅ Correct!' : '❌ Incorrect'}</strong>
          <p style="margin-top: 4px; font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(q.explanation)}</p>
        `;
        container.appendChild(expBox);
      }
    });

    optionsWrapper.appendChild(btn);
  });

  container.appendChild(optionsWrapper);
}

// ------------------------------------------
// 2. One-Mark Controls (Self-Graded Recall)
// ------------------------------------------
function renderOneMarkControls(q, container) {
  const wrapper = document.createElement('div');

  const revealBtn = document.createElement('button');
  revealBtn.className = 'btn btn--outline btn--sm';
  revealBtn.textContent = 'Reveal Answer';

  const answerDiv = document.createElement('div');
  answerDiv.className = 'reveal-box';
  answerDiv.style.display = 'none';

  answerDiv.innerHTML = `
    <strong>Model Answer:</strong>
    <p style="margin-top:4px;">${escapeHtml(q.answer)}</p>
    ${q.explanation ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;"><strong>Note:</strong> ${escapeHtml(q.explanation)}</p>` : ''}
    <div class="reveal-box__actions">
      <button class="btn btn--outline btn--sm btn-got-it" style="color:var(--color-success); border-color:var(--color-success);">
        ✓ I Got It (+1)
      </button>
      <button class="btn btn--outline btn--sm btn-missed-it" style="color:var(--color-danger); border-color:var(--color-danger);">
        ✗ I Missed It (0)
      </button>
    </div>
  `;

  revealBtn.addEventListener('click', () => {
    revealBtn.style.display = 'none';
    answerDiv.style.display = 'block';
  });

  const gotItBtn = answerDiv.querySelector('.btn-got-it');
  const missedItBtn = answerDiv.querySelector('.btn-missed-it');

  gotItBtn.addEventListener('click', () => {
    if (quizUserAnswers[q.id]) return;
    quizUserAnswers[q.id] = { scored: 1 };
    quizScores.earned += 1;
    quizScores.details[q.id] = { scored: 1, max: 1 };
    gotItBtn.disabled = true;
    missedItBtn.disabled = true;
    gotItBtn.style.background = 'var(--color-success-light)';
  });

  missedItBtn.addEventListener('click', () => {
    if (quizUserAnswers[q.id]) return;
    quizUserAnswers[q.id] = { scored: 0 };
    quizScores.details[q.id] = { scored: 0, max: 1 };
    gotItBtn.disabled = true;
    missedItBtn.disabled = true;
    missedItBtn.style.background = 'var(--color-danger-light)';
  });

  wrapper.appendChild(revealBtn);
  wrapper.appendChild(answerDiv);
  container.appendChild(wrapper);
}

// ------------------------------------------
// 3. Short Answer Controls
// ------------------------------------------
function renderShortAnswerControls(q, container) {
  const wrapper = document.createElement('div');

  const revealBtn = document.createElement('button');
  revealBtn.className = 'btn btn--outline btn--sm';
  revealBtn.textContent = 'View Point-wise Benchmark Answer';

  const answerDiv = document.createElement('div');
  answerDiv.className = 'reveal-box';
  answerDiv.style.display = 'none';

  answerDiv.innerHTML = `
    <strong>Benchmark Points (${q.marks || 3} Marks):</strong>
    <div style="margin-top:6px; white-space:pre-wrap; font-size:0.9rem;">${escapeHtml(q.answer)}</div>
    ${q.explanation ? `<p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;"><strong>Marking Rubric:</strong> ${escapeHtml(q.explanation)}</p>` : ''}
  `;

  revealBtn.addEventListener('click', () => {
    revealBtn.style.display = 'none';
    answerDiv.style.display = 'block';
    quizScores.details[q.id] = { scored: q.marks || 3, max: q.marks || 3 };
  });

  wrapper.appendChild(revealBtn);
  wrapper.appendChild(answerDiv);
  container.appendChild(wrapper);
}

// ------------------------------------------
// 4. Long Answer Controls (AI Evaluator)
// ------------------------------------------
function renderLongAnswerControls(q, container) {
  const evalBox = document.createElement('div');
  evalBox.className = 'eval-box';

  evalBox.innerHTML = `
    <span style="font-size: 0.8rem; color: var(--text-muted);">
      Write your answer below (approx. 80-150 words). ExamAI will grade your answer with marks, strengths, and missing keywords:
    </span>
    <textarea class="eval-box__textarea" placeholder="Type your structured answer here..."></textarea>
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span class="word-counter" style="font-size:0.75rem; color:var(--text-subtle);">0 words</span>
      <button type="button" class="btn btn--primary btn--sm btn-eval-answer">
        <span>Evaluate My Answer</span>
      </button>
    </div>
    <div class="eval-result-container"></div>
  `;

  const textarea = evalBox.querySelector('.eval-box__textarea');
  const counter = evalBox.querySelector('.word-counter');
  const evalBtn = evalBox.querySelector('.btn-eval-answer');
  const resultContainer = evalBox.querySelector('.eval-result-container');

  // Word count tracker
  textarea.addEventListener('input', () => {
    const words = textarea.value.trim().split(/\s+/).filter(Boolean).length;
    counter.textContent = `${words} words`;
  });

  // Evaluate Button Handler
  evalBtn.addEventListener('click', async () => {
    const studentAnswer = textarea.value.trim();
    if (!studentAnswer || studentAnswer.length < 15) {
      showToast('Please write a substantial answer before evaluating.', 'warning');
      return;
    }

    try {
      evalBtn.disabled = true;
      evalBtn.innerHTML = '<span>Grading with AI...</span>';

      const response = await authFetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          modelAnswer: q.answer,
          studentAnswer,
          marks: q.marks || 5
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Evaluation failed.');
      }

      // Record score
      quizScores.earned += result.score || 0;
      quizScores.details[q.id] = { scored: result.score, max: result.outOf };

      // Render evaluation card
      resultContainer.innerHTML = `
        <div class="eval-result-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="color:var(--text-main);">AI Examiner Evaluation</strong>
            <span class="eval-score-badge">${result.score} / ${result.outOf} Marks</span>
          </div>
          <div style="margin-bottom:6px;">
            <span style="font-size:0.8rem; font-weight:700; color:var(--color-success);">Strengths:</span>
            <ul style="margin: 4px 0 8px 18px; font-size:0.85rem;">
              ${(result.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
          </div>
          <div>
            <span style="font-size:0.8rem; font-weight:700; color:var(--color-warning);">Areas to Gain Full Marks:</span>
            <ul style="margin: 4px 0 0 18px; font-size:0.85rem;">
              ${(result.improvements || []).map((imp) => `<li>${escapeHtml(imp)}</li>`).join('')}
            </ul>
          </div>
        </div>
      `;

      showToast(`Answer evaluated: ${result.score}/${result.outOf} marks awarded!`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error evaluating answer.', 'error');
    } finally {
      evalBtn.disabled = false;
      evalBtn.innerHTML = '<span>Re-evaluate Answer</span>';
    }
  });

  container.appendChild(evalBox);
}

// ------------------------------------------
// Finish Test & Score Summary Screen
// ------------------------------------------
function finishTest() {
  if (!currentQuiz) return;

  const body = document.getElementById('quizBody');
  const total = quizScores.totalMarks || 1;
  const earned = Math.round(quizScores.earned * 10) / 10;
  const pct = Math.round((earned / total) * 100);

  // Record progress into persistent localStorage
  recordQuizProgress(currentQuiz, quizScores);

  // Render Score Summary Screen
  body.innerHTML = `
    <div class="score-summary-card">
      <h2>Test Complete! 🎉</h2>
      <p style="color:var(--text-muted); margin-top:4px;">Here is your performance breakdown for this practice session:</p>
      <div class="score-summary-card__score">${earned} / ${total}</div>
      <p style="font-size:1.1rem; font-weight:700; color:${pct >= 75 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'};">
        ${pct}% - ${pct >= 75 ? 'Excellent Mastery!' : pct >= 50 ? 'Solid Effort - Keep Practicing' : 'Review Weak Topics'}
      </p>
      <div style="margin-top:1.5rem; display:flex; justify-content:center; gap:12px;">
        <button class="btn btn--primary" id="reviewQuestionsBtn">Review Question Paper</button>
        <button class="btn btn--outline" id="exitQuizBtn">Return to Dashboard</button>
      </div>
    </div>
  `;

  document.getElementById('reviewQuestionsBtn')?.addEventListener('click', () => {
    renderQuizBody(currentQuiz, body);
  });

  document.getElementById('exitQuizBtn')?.addEventListener('click', () => {
    closeQuizModal();
  });
}

// ==========================================
// Copy Paper As Text & Print Setup
// ==========================================

function copyQuizAsText() {
  if (!currentQuiz || !currentQuiz.questions) {
    showToast('No active quiz paper to copy.', 'warning');
    return;
  }

  const profile = getUserProfile();
  let text = `====================================================\n`;
  text += `EXAM PAPER: ${profile.exam || 'ExamAI Practice Paper'}\n`;
  text += `Total Marks: ${quizScores.totalMarks} | Date: ${new Date().toLocaleDateString()}\n`;
  text += `====================================================\n\n`;

  let curSec = '';
  currentQuiz.questions.forEach((q, i) => {
    if (q.section && q.section !== curSec) {
      curSec = q.section;
      text += `\n--- SECTION ${curSec} (${getSectionTitle(q.type)}) ---\n\n`;
    }
    text += `Q${i + 1}. ${q.question} [${q.marks || 1}M]\n`;
    if (q.type === 'mcq' && Array.isArray(q.options)) {
      q.options.forEach((opt) => {
        text += `   ${opt}\n`;
      });
    }
    text += `\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    showToast('Exam paper copied to clipboard as text!', 'success');
  }).catch(() => {
    showToast('Failed to copy text to clipboard.', 'error');
  });
}

// Attach Quiz Header Listeners on Load
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('closeQuizModalBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeQuizModal);

  const printBtn = document.getElementById('printQuizBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  const copyTextBtn = document.getElementById('copyQuizTextBtn');
  if (copyTextBtn) copyTextBtn.addEventListener('click', copyQuizAsText);
});
