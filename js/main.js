/* main.js — renders the scheduled daily puzzle and drives solving interactions.

   Schedule rules:
   - The puzzle "live" for solving before 7:35 AM local time is still the previous
     day's puzzle; at 7:35 AM it rolls over to today's (if the admin published one).
   - From 7:30 AM until 7:35 AM, the about-to-roll-over puzzle is locked (read-only)
     so answers can't sneak in right before it's revealed.
   - At 7:35 AM, the puzzle that just rolled off becomes "revealed": its full
     answers + explanations are shown read-only in a separate panel.
*/

const app = document.getElementById('app');
const progressBadge = document.getElementById('progressBadge');
const puzzleDateEl = document.getElementById('puzzleDate');

const LOCK_START_MIN = 7 * 60 + 30; // 07:30
const ROLLOVER_MIN = 7 * 60 + 35;   // 07:35
const POLL_MS = 15000;

let puzzle = null;
let liveDate = null;
let locked = false;
let activeDir = 'across';
let activeClueNumber = null;
let timerInterval = null;
let seconds = 0;
let solved = false;
let playerName = '';
let lastCompletedAt = null;

function cellId(r, c) { return `cell-${r}-${c}`; }

/** A cell can start both an across and a down word (with different numbers,
 *  since numbering runs Across 1..N then Down N+1..M) — show both, joined. */
function cellNumberLabel(cell) {
  const nums = [cell.acrossNumber, cell.downNumber].filter(n => n != null);
  return nums.join(',');
}

/** Largest cell size (px) that fits the current viewport width for a grid
 *  with `cols` columns, capped at `cap`. Re-run on resize so the puzzle
 *  always fits on screen instead of forcing horizontal scroll on phones. */
function computeCellSize(cols, cap) {
  const pagePadding = 100; // .page (24*2) + .grid-panel (22*2) + .grid-wrap (8*2) horizontal padding
  const available = Math.min(window.innerWidth - pagePadding, 560);
  const size = Math.floor(available / cols);
  return Math.max(24, Math.min(cap, size));
}

let resizeTimer = null;
/** Applies to every grid on the page (live + the revealed read-only one),
 *  each tagged with data-cols/data-cap when rendered. */
function applyResponsiveCellSize() {
  document.querySelectorAll('.xw-grid[data-cols]').forEach(grid => {
    const cols = Number(grid.dataset.cols);
    const cap = Number(grid.dataset.cap);
    grid.style.setProperty('--cell-size', computeCellSize(cols, cap) + 'px');
  });
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyResponsiveCellSize, 150);
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function computeSchedule(now) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const todayStr = localDateStr(now);
  const yestStr = addDays(todayStr, -1);
  const live = minutesNow >= ROLLOVER_MIN ? todayStr : yestStr;
  const isLocked = minutesNow >= LOCK_START_MIN && minutesNow < ROLLOVER_MIN;
  const revealed = addDays(live, -1);
  return { live, isLocked, revealed, minutesNow };
}

function minutesUntil(targetMin, minutesNow) {
  let diff = targetMin - minutesNow;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

let lastScheduleKey = null;

async function tick() {
  const now = new Date();
  const sched = computeSchedule(now);
  const key = sched.live + '|' + sched.isLocked;
  if (key !== lastScheduleKey) {
    lastScheduleKey = key;
    liveDate = sched.live;
    locked = sched.isLocked;
    await fullRender(sched);
  } else {
    updateBanner(sched);
    refreshLiveLeaderboardPanel();
  }
}

/** Quietly refreshes just the leaderboard panel's contents (no full re-render,
 *  so it doesn't disturb typing/focus) so it updates as others finish solving. */
async function refreshLiveLeaderboardPanel() {
  const el = document.getElementById('liveLeaderboard');
  if (!el || !liveDate) return;
  try {
    el.innerHTML = await leaderboardHtml(liveDate, lastCompletedAt);
  } catch (e) { /* leave existing content on failure */ }
}

function init() {
  tick();
  setInterval(tick, POLL_MS);
}

async function fullRender(sched) {
  let fetchedPuzzle, revealedPuzzle;
  try {
    [fetchedPuzzle, revealedPuzzle] = await Promise.all([
      getPuzzleForDate(liveDate),
      getPuzzleForDate(sched.revealed),
    ]);
  } catch (e) {
    app.innerHTML = `<div class="glass empty-state"><h2>Couldn't load the puzzle</h2><p>${esc(e.message || 'Network error')}</p></div>`;
    return;
  }
  puzzle = fetchedPuzzle;

  const progress = puzzle ? loadProgressForDate(liveDate) : null;
  const started = !!(progress && progress.started);

  let html = `<div id="scheduleBanner"></div>`;

  if (puzzle) {
    puzzleDateEl.textContent = puzzle.title + ' · ' + liveDate;
    html += started ? await puzzleHtml(puzzle) : await startGateHtml(puzzle);
  } else {
    puzzleDateEl.textContent = 'No puzzle live right now';
    html += emptyStateHtml();
  }

  html += revealedPuzzle ? await revealedSectionHtml(revealedPuzzle, sched.revealed) : '';

  app.innerHTML = html;
  updateBanner(sched);
  applyResponsiveCellSize();

  if (puzzle && started) {
    playerName = progress.playerName || loadPlayerName();
    renderClueList();
    attachGridEvents();
    attachToolbarEvents();
    restoreProgress();
    setLockedUI(locked);
    const fc = firstClue();
    if (fc) setActiveWord(fc.number, fc.dir);
    startTimer();
  } else if (puzzle) {
    attachStartGateEvents();
    stopTimer();
  } else {
    stopTimer();
  }
}

async function startGateHtml(p) {
  const savedName = loadPlayerName();
  const lb = await leaderboardHtml(liveDate);
  return `
    <h1 class="gradient-text puzzle-title">${esc(p.title)}</h1>
    <div class="glass start-gate">
      <div class="start-gate-icon">📝</div>
      <h2>Ready to play?</h2>
      <p>Enter your full name to start the timer and begin today's crossword. Your best time may land on the Top 5 leaderboard.</p>
      <form id="startForm" class="start-form">
        <input type="text" id="startName" placeholder="Your full name" maxlength="40" autocomplete="name" value="${esc(savedName)}" autofocus>
        <button type="submit" class="btn btn-primary">Start Puzzle</button>
      </form>
      <div class="login-error" id="startError"></div>
    </div>
    <div class="glass live-leaderboard-card" id="liveLeaderboard">${lb}</div>
  `;
}

function attachStartGateEvents() {
  const form = document.getElementById('startForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('startName');
    const name = input.value.trim();
    const err = document.getElementById('startError');
    if (!name) { err.textContent = 'Please enter your full name to start.'; return; }
    playerName = name;
    savePlayerName(name);
    saveProgressForDate(liveDate, { started: true, playerName: name, answers: {}, solved: false, seconds: 0 });
    await fullRender(computeSchedule(new Date()));
  });
}

function updateBanner(sched) {
  const el = document.getElementById('scheduleBanner');
  if (!el) return;
  if (sched.isLocked) {
    const mins = minutesUntil(ROLLOVER_MIN, sched.minutesNow);
    el.innerHTML = `<div class="glass lock-banner">🔒 Locked for the 7:35 AM switchover — new puzzle unlocks in ${mins} minute${mins === 1 ? '' : 's'}.</div>`;
    setLockedUI(true);
  } else if (!puzzle) {
    el.innerHTML = `<div class="glass lock-banner">⏳ Today's puzzle hasn't been uploaded yet. Check back soon, or visit the admin panel to publish it.</div>`;
  } else {
    el.innerHTML = '';
    setLockedUI(false);
  }
}

function setLockedUI(isLocked) {
  locked = isLocked;
  document.querySelectorAll('.xw-grid input').forEach(inp => { inp.disabled = isLocked; });
  updateCheckButtonState();
  const wrap = document.querySelector('.grid-panel');
  if (wrap) wrap.classList.toggle('is-locked', isLocked);
}

function emptyStateHtml() {
  return `
    <div class="glass empty-state">
      <h2>No puzzle published for today</h2>
      <p>Check back soon — a new crossword goes live at 7:35 AM.</p>
    </div>
  `;
}

async function puzzleHtml(p) {
  const cap = p.width > 16 ? 30 : (p.width > 11 ? 38 : 44);
  const initialSize = computeCellSize(p.width, cap);
  let gridHtml = `<div class="xw-grid" id="xwGrid" data-cols="${p.width}" data-cap="${cap}" style="--cell-size:${initialSize}px; grid-template-columns: repeat(${p.width}, var(--cell-size));">`;
  for (let r = 0; r < p.height; r++) {
    for (let c = 0; c < p.width; c++) {
      const cell = p.cells[r][c];
      if (cell.blocked) {
        gridHtml += `<div class="xw-cell blocked"></div>`;
      } else {
        gridHtml += `
          <div class="xw-cell" id="${cellId(r, c)}" data-r="${r}" data-c="${c}">
            ${cellNumberLabel(cell) ? `<span class="num">${cellNumberLabel(cell)}</span>` : ''}
            <input type="text" maxlength="1" id="input-${r}-${c}" autocomplete="off" spellcheck="false">
          </div>`;
      }
    }
  }
  gridHtml += `</div>`;

  const lb = await leaderboardHtml(liveDate, lastCompletedAt);

  return `
    <h1 class="gradient-text puzzle-title">${esc(p.title)}</h1>
    <div class="puzzle-layout">
      <div class="glass grid-panel">
        <div class="toolbar">
          <div class="toolbar-group">
            <button class="btn btn-ghost" id="checkBtn">Check puzzle</button>
          </div>
          <div class="timer" id="timerEl">00:00</div>
        </div>
        <div class="toolbar-note">Check puzzle grades whole words, not individual letters. No reveal or reset — answers &amp; explanations unlock automatically at 7:35 AM the next day.</div>
        <div class="grid-wrap">${gridHtml}</div>
      </div>
      <div class="glass clues-panel">
        <div class="live-leaderboard-inline" id="liveLeaderboard">${lb}</div>
        <div class="clues-tabs">
          <div class="clues-tab active" data-dir="across">Across</div>
          <div class="clues-tab" data-dir="down">Down</div>
        </div>
        <div id="cluesList"></div>
      </div>
    </div>
  `;
}

async function revealedSectionHtml(p, dateStr) {
  const cap = p.width > 16 ? 20 : (p.width > 11 ? 24 : 28);
  const initialSize = computeCellSize(p.width, cap);
  let gridHtml = `<div class="xw-grid revealed-grid" data-cols="${p.width}" data-cap="${cap}" style="--cell-size:${initialSize}px; grid-template-columns: repeat(${p.width}, var(--cell-size));">`;
  for (let r = 0; r < p.height; r++) {
    for (let c = 0; c < p.width; c++) {
      const cell = p.cells[r][c];
      if (cell.blocked) {
        gridHtml += `<div class="xw-cell blocked"></div>`;
      } else {
        gridHtml += `<div class="xw-cell correct">
          ${cellNumberLabel(cell) ? `<span class="num">${cellNumberLabel(cell)}</span>` : ''}
          <span class="revealed-letter">${cell.letter}</span>
        </div>`;
      }
    }
  }
  gridHtml += `</div>`;

  function explList(clues) {
    return clues.map(c => `
      <div class="expl-item">
        <div class="expl-row"><span class="expl-label">Q${c.number}.</span> ${esc(c.clue)}</div>
        <div class="expl-row"><span class="expl-label">Answer:</span> <strong>${esc(c.answer)}</strong></div>
        ${c.explanation ? `<div class="expl-row"><span class="expl-label">Explanation:</span> ${esc(c.explanation)}</div>` : ''}
      </div>
    `).join('');
  }

  const lb = await leaderboardHtml(dateStr);

  return `
    <details class="glass revealed-section" open>
      <summary>Previous Puzzle — Revealed (${esc(p.title)} · ${dateStr})</summary>
      <div class="revealed-body">
        <div class="revealed-grid-wrap">${gridHtml}</div>
        <div class="revealed-clues">
          <div class="clue-section-title">Across</div>
          ${explList(p.acrossClues)}
          <div class="clue-section-title">Down</div>
          ${explList(p.downClues)}
          ${lb}
        </div>
      </div>
    </details>
  `;
}

async function leaderboardHtml(dateStr, highlightCompletedAt) {
  let top = [];
  try { top = await topScores(dateStr, 5); } catch (e) { top = []; }
  if (top.length === 0) {
    return `<div class="clue-section-title">Top 5 — Fastest Times</div><div class="hint">No finishers yet.</div>`;
  }
  const rows = top.map((r, i) => `
    <div class="lb-row ${highlightCompletedAt && r.completedAt === highlightCompletedAt ? 'me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${esc(r.name)}</span>
      <span class="lb-time">${formatTime(r.seconds)}</span>
    </div>
  `).join('');
  return `
    <div class="clue-section-title">🏆 Top 5 — Fastest Times</div>
    <div class="leaderboard">${rows}</div>
  `;
}

function wordCells(entry, dir) {
  const cells = [];
  for (let i = 0; i < entry.length; i++) {
    const r = dir === 'across' ? entry.row : entry.row + i;
    const c = dir === 'across' ? entry.col + i : entry.col;
    cells.push([r, c]);
  }
  return cells;
}

function findClueAt(r, c, dir) {
  const list = dir === 'across' ? puzzle.acrossClues : puzzle.downClues;
  return list.find(entry => {
    const cells = wordCells(entry, dir);
    return cells.some(([cr, cc]) => cr === r && cc === c);
  });
}

function firstClue() {
  if (puzzle.acrossClues[0]) return { number: puzzle.acrossClues[0].number, dir: 'across' };
  if (puzzle.downClues[0]) return { number: puzzle.downClues[0].number, dir: 'down' };
  return null;
}

function renderClueList() {
  const list = document.getElementById('cluesList');
  if (!list) return;
  function section(title, clues, dir) {
    let html = `<div class="clue-section-title">${title}</div><ul class="clue-list">`;
    for (const entry of clues) {
      const done = isWordFilled(entry, dir);
      html += `<li class="clue-item ${done ? 'done' : ''}" data-dir="${dir}" data-number="${entry.number}">
        <span class="n">${entry.number}</span><span>${esc(entry.clue)}</span>
      </li>`;
    }
    return html + `</ul>`;
  }
  list.innerHTML = section('Across', puzzle.acrossClues, 'across') + section('Down', puzzle.downClues, 'down');

  list.querySelectorAll('.clue-item').forEach(li => {
    li.addEventListener('click', () => {
      setActiveWord(Number(li.dataset.number), li.dataset.dir);
    });
  });
}

function isWordFilled(entry, dir) {
  return wordCells(entry, dir).every(([r, c]) => {
    const inp = document.getElementById(`input-${r}-${c}`);
    return inp && inp.value.trim().length === 1;
  });
}

function getEntry(dir, number) {
  const list = dir === 'across' ? puzzle.acrossClues : puzzle.downClues;
  return list.find(e => e.number === number);
}

function setActiveWord(number, dir) {
  activeDir = dir;
  activeClueNumber = number;
  const entry = getEntry(dir, number);
  if (!entry) return;

  document.querySelectorAll('.xw-cell').forEach(el => el.classList.remove('in-word', 'active'));
  document.querySelectorAll('.clue-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.clues-tab').forEach(el => el.classList.toggle('active', el.dataset.dir === dir));

  const cells = wordCells(entry, dir);
  cells.forEach(([r, c]) => {
    const el = document.getElementById(cellId(r, c));
    if (el) el.classList.add('in-word');
  });

  const clueLi = document.querySelector(`.clue-item[data-dir="${dir}"][data-number="${number}"]`);
  if (clueLi) {
    clueLi.classList.add('active');
    clueLi.scrollIntoView({ block: 'nearest' });
  }

  let target = cells.find(([r, c]) => {
    const inp = document.getElementById(`input-${r}-${c}`);
    return inp && !inp.value;
  }) || cells[0];
  focusCell(target[0], target[1]);
}

function focusCell(r, c) {
  const el = document.getElementById(cellId(r, c));
  const inp = document.getElementById(`input-${r}-${c}`);
  if (!el || !inp) return;
  document.querySelectorAll('.xw-cell.active').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  if (!locked) { inp.focus(); inp.select(); }
}

function attachGridEvents() {
  document.querySelectorAll('.xw-cell').forEach(el => {
    el.addEventListener('click', () => {
      const r = Number(el.dataset.r), c = Number(el.dataset.c);
      const acrossEntry = findClueAt(r, c, 'across');
      const downEntry = findClueAt(r, c, 'down');
      let dir = activeDir;
      if (dir === 'across' && !acrossEntry) dir = 'down';
      if (dir === 'down' && !downEntry) dir = 'across';
      if (el.classList.contains('active') && acrossEntry && downEntry) {
        dir = dir === 'across' ? 'down' : 'across';
      }
      const entry = dir === 'across' ? acrossEntry : downEntry;
      if (entry) setActiveWord(entry.number, dir);
    });
  });

  document.querySelectorAll('.xw-grid input').forEach(inp => {
    inp.addEventListener('input', () => {
      if (locked) return;
      inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, '');
      const r = Number(inp.closest('.xw-cell').dataset.r), c = Number(inp.closest('.xw-cell').dataset.c);
      clearWordStatusAt(r, c);
      if (inp.value) moveRelative(1);
      saveProgress();
      renderClueList();
      checkIfSolved(true);
    });

    inp.addEventListener('keydown', (e) => {
      if (locked) return;
      const [, r, c] = inp.id.split('-').map((v, i) => i === 0 ? v : Number(v));
      if (e.key === 'ArrowRight') { e.preventDefault(); navigate(Number(r), Number(c), 0, 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(Number(r), Number(c), 0, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); navigate(Number(r), Number(c), 1, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navigate(Number(r), Number(c), -1, 0); }
      else if (e.key === 'Backspace' && !inp.value) { e.preventDefault(); moveRelative(-1, true); }
    });
  });
}

function navigate(r, c, dr, dc) {
  let nr = r + dr, nc = c + dc;
  while (nr >= 0 && nr < puzzle.height && nc >= 0 && nc < puzzle.width) {
    if (!puzzle.cells[nr][nc].blocked) {
      const dir = dr !== 0 ? 'down' : 'across';
      const entry = findClueAt(nr, nc, dir) || findClueAt(nr, nc, activeDir);
      if (entry) { activeDir = findClueAt(nr, nc, dir) ? dir : activeDir; activeClueNumber = entry.number; }
      highlightWordContaining(nr, nc);
      focusCell(nr, nc);
      return;
    }
    nr += dr; nc += dc;
  }
}

function highlightWordContaining(r, c) {
  const entry = findClueAt(r, c, activeDir) || findClueAt(r, c, activeDir === 'across' ? 'down' : 'across');
  if (!entry) return;
  const dir = findClueAt(r, c, activeDir) ? activeDir : (activeDir === 'across' ? 'down' : 'across');
  activeDir = dir;
  document.querySelectorAll('.xw-cell').forEach(el => el.classList.remove('in-word'));
  document.querySelectorAll('.clue-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.clues-tab').forEach(el => el.classList.toggle('active', el.dataset.dir === dir));
  wordCells(entry, dir).forEach(([wr, wc]) => {
    const el = document.getElementById(cellId(wr, wc));
    if (el) el.classList.add('in-word');
  });
  const li = document.querySelector(`.clue-item[data-dir="${dir}"][data-number="${entry.number}"]`);
  if (li) { li.classList.add('active'); li.scrollIntoView({ block: 'nearest' }); }
  activeClueNumber = entry.number;
}

function moveRelative(step, isBackspace) {
  const entry = getEntry(activeDir, activeClueNumber);
  if (!entry) return;
  const cells = wordCells(entry, activeDir);
  const activeEl = document.querySelector('.xw-cell.active');
  if (!activeEl) return;
  const r = Number(activeEl.dataset.r), c = Number(activeEl.dataset.c);
  const idx = cells.findIndex(([cr, cc]) => cr === r && cc === c);
  let nextIdx = idx + step;
  if (isBackspace) {
    if (nextIdx >= 0) {
      const [pr, pc] = cells[nextIdx];
      focusCell(pr, pc);
      document.getElementById(`input-${pr}-${pc}`).value = '';
      saveProgress();
      renderClueList();
    }
    return;
  }
  if (nextIdx >= 0 && nextIdx < cells.length) {
    const [nr, nc] = cells[nextIdx];
    focusCell(nr, nc);
  }
}

/** Editing a letter un-grades the whole word(s) crossing that cell, since
 *  checkPuzzle() grades at word level, not per letter. */
function clearWordStatusAt(r, c) {
  const acrossEntry = findClueAt(r, c, 'across');
  const downEntry = findClueAt(r, c, 'down');
  [[acrossEntry, 'across'], [downEntry, 'down']].forEach(([entry, dir]) => {
    if (!entry) return;
    wordCells(entry, dir).forEach(([wr, wc]) => {
      const cellEl = document.getElementById(cellId(wr, wc));
      if (cellEl) cellEl.classList.remove('correct', 'incorrect');
    });
  });
}

function attachToolbarEvents() {
  const checkBtn = document.getElementById('checkBtn');
  if (checkBtn) checkBtn.addEventListener('click', () => { if (!locked) checkPuzzle(false); });
}

function allCellCoords() {
  const coords = [];
  for (let r = 0; r < puzzle.height; r++)
    for (let c = 0; c < puzzle.width; c++)
      if (!puzzle.cells[r][c].blocked) coords.push([r, c]);
  return coords;
}

/** Grades whole words rather than individual letters: a word is only marked
 *  correct if every letter in it is right. A wrong word stays red even at
 *  shared intersection cells where the single letter happens to be right,
 *  since the goal is to point at the word to fix, not just one cell. */
function checkPuzzle(silent) {
  if (solved) {
    if (!silent) showToast(`Already solved in ${formatTime(seconds)} — nice work!`);
    return true;
  }

  let allFilled = true, allCorrect = true;

  document.querySelectorAll('.xw-cell').forEach(el => el.classList.remove('correct', 'incorrect'));

  function gradeWord(entry, dir) {
    const cells = wordCells(entry, dir);
    let wordFilled = true, wordCorrect = true;
    for (const [r, c] of cells) {
      const inp = document.getElementById(`input-${r}-${c}`);
      if (!inp.value) wordFilled = false;
      else if (inp.value !== puzzle.cells[r][c].letter) wordCorrect = false;
    }
    if (!wordFilled) { allFilled = false; return; }
    if (!wordCorrect) allCorrect = false;
    cells.forEach(([r, c]) => {
      const cellEl = document.getElementById(cellId(r, c));
      if (!cellEl) return;
      if (wordCorrect) {
        if (!cellEl.classList.contains('incorrect')) cellEl.classList.add('correct');
      } else {
        cellEl.classList.remove('correct');
        cellEl.classList.add('incorrect');
      }
    });
  }

  puzzle.acrossClues.forEach(entry => gradeWord(entry, 'across'));
  puzzle.downClues.forEach(entry => gradeWord(entry, 'down'));

  if (!silent) {
    if (!allFilled) showToast('Keep going — some words are still incomplete.', true);
    else if (allCorrect) onSolved();
    else showToast('Some words are incorrect — look for the red ones.', true);
  }
  return allFilled && allCorrect;
}

function checkIfSolved(silent) {
  if (solved) return;
  const coords = allCellCoords();
  const filled = coords.every(([r, c]) => document.getElementById(`input-${r}-${c}`).value);
  if (filled && checkPuzzle(true)) onSolved();
}

async function onSolved() {
  solved = true;
  stopTimer();
  updateProgressBadge();
  saveProgress();
  lastCompletedAt = new Date().toISOString();
  try {
    await saveResponse(liveDate, { name: playerName || 'Anonymous', seconds, completedAt: lastCompletedAt });
  } catch (e) {
    console.warn('Could not save response to the leaderboard:', e);
  }
  loadResponses(liveDate).then(list => syncResponsesFile(liveDate, list)).catch(() => {});
  updateCheckButtonState();
  refreshLiveLeaderboardPanel();
  await showModal();
}

function updateCheckButtonState() {
  const checkBtn = document.getElementById('checkBtn');
  if (!checkBtn) return;
  if (solved) {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Solved ✓';
  } else {
    checkBtn.disabled = locked;
    checkBtn.textContent = 'Check puzzle';
  }
}

async function showModal() {
  const lb = await leaderboardHtml(liveDate, lastCompletedAt);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="glass modal">
      <div class="modal-emoji">🎉</div>
      <h2>Solved it, ${esc(playerName || 'friend')}!</h2>
      <p>You completed the crossword in ${formatTime(seconds)}.</p>
      ${lb}
      <button class="btn btn-primary" id="closeModalBtn" style="margin-top:18px;">Nice</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('closeModalBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    if (solved || locked) return;
    seconds++;
    const el = document.getElementById('timerEl');
    if (el) el.textContent = formatTime(seconds);
    // Persist elapsed time periodically (not just on keystrokes) so a refresh
    // or pause-without-typing doesn't snap the timer back to a stale value.
    if (seconds % 5 === 0) saveProgress();
  }, 1000);
}

/** Right before the page unloads/backgrounds (refresh, tab close, switching
 *  apps), save the latest timer + answers so nothing is lost or stale. */
function saveProgressIfActive() {
  if (puzzle && !solved) saveProgress();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveProgressIfActive();
});
window.addEventListener('pagehide', saveProgressIfActive);

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function updateProgressBadge() {
  const totalWords = puzzle.acrossClues.length + puzzle.downClues.length;
  const doneWords = [...puzzle.acrossClues.map(e => ['across', e]), ...puzzle.downClues.map(e => ['down', e])]
    .filter(([dir, e]) => isWordFilled(e, dir)).length;
  progressBadge.textContent = `${doneWords} / ${totalWords} words`;
}

function saveProgress() {
  const data = {};
  for (const [r, c] of allCellCoords()) {
    const inp = document.getElementById(`input-${r}-${c}`);
    if (inp.value) data[`${r},${c}`] = inp.value;
  }
  saveProgressForDate(liveDate, { started: true, playerName, answers: data, solved, seconds });
  updateProgressBadge();
}

function restoreProgress() {
  const saved = loadProgressForDate(liveDate);
  if (!saved) { updateProgressBadge(); return; }
  solved = !!saved.solved;
  seconds = saved.seconds || 0;
  const timerEl = document.getElementById('timerEl');
  if (timerEl) timerEl.textContent = formatTime(seconds);
  for (const [key, val] of Object.entries(saved.answers || {})) {
    const [r, c] = key.split(',');
    const inp = document.getElementById(`input-${r}-${c}`);
    if (inp) inp.value = val;
  }
  updateProgressBadge();
  checkIfSolved(true);
}

let toastTimer = null;
function showToast(msg, isErr) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + (isErr ? 'err' : 'ok');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

init();
