/* admin.js — login gate + up-to-5-across/5-down editor + generate & publish by date.
   Puzzles, responses, and the admin password now live in a shared backend
   (see /api/*.js + Vercel KV), so publishing here is visible to every visitor.
*/

const app = document.getElementById('app');
const logoutBtn = document.getElementById('logoutBtn');

let draftSaveTimer = null;

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function init() {
  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    await renderPanel();
    logoutBtn.style.display = '';
  } else {
    renderLogin();
    logoutBtn.style.display = 'none';
  }
}

logoutBtn.addEventListener('click', async () => {
  await logout();
  init();
});

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="glass login-card">
        <div class="brand-mark">CW</div>
        <h1>Admin Login</h1>
        <p class="sub">Sign in to manage the crossword's words &amp; clues.</p>
        <form class="login-form" id="loginForm">
          <div>
            <label class="field-label">Password</label>
            <input type="password" id="pwInput" placeholder="Enter admin password" autocomplete="current-password" autofocus>
          </div>
          <div class="login-error" id="loginError"></div>
          <button type="submit" class="btn btn-primary">Log in</button>
        </form>
        <div class="hint">First time setting this up? The default password is <strong>admin123</strong> until you change it below.</div>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('pwInput').value;
    const err = document.getElementById('loginError');
    err.textContent = '';
    const ok = await verifyPassword(pw);
    if (ok) {
      init();
    } else {
      err.textContent = 'Incorrect password. Try again.';
    }
  });
}

function wordRowsHtml(prefix, count, saved) {
  let html = '';
  for (let i = 0; i < count; i++) {
    const w = saved?.[i]?.word || '';
    const c = saved?.[i]?.clue || '';
    const x = saved?.[i]?.explanation || '';
    html += `
      <div class="word-row">
        <div class="slot-no">#${i + 1}</div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <input type="text" id="${prefix}-word-${i}" placeholder="WORD (optional)" value="${esc(w)}" maxlength="20" style="text-transform:uppercase;">
          <input type="text" id="${prefix}-clue-${i}" placeholder="Clue for this word" value="${esc(c)}">
          <input type="text" id="${prefix}-expl-${i}" placeholder="Explanation (shown when answers are revealed)" value="${esc(x)}">
        </div>
      </div>
    `;
  }
  return html;
}

function todayStr() { return localDateStr(new Date()); }

async function renderPanel() {
  const draft = loadDraft();
  const defaultDate = draft?.date || todayStr();

  app.innerHTML = `
    <div class="glass" style="padding:22px; margin-bottom:20px;">
      <div class="settings-row" style="align-items:flex-end;">
        <div style="flex:2; min-width:260px;">
          <label class="field-label">Puzzle title</label>
          <input type="text" id="puzzleTitle" placeholder="e.g. Friday Fun Crossword" style="font-size:16px; font-weight:600;">
        </div>
        <div style="flex:1; min-width:180px;">
          <label class="field-label">Goes live on</label>
          <input type="text" id="puzzleDate" placeholder="YYYY-MM-DD">
        </div>
      </div>
      <div class="hint" style="margin-top:12px;">This puzzle becomes the live, solvable crossword for everyone at 8:40 AM on the date above. At 8:35 AM the previous day's puzzle locks, and at 8:40 AM its answers + explanations are revealed automatically.</div>
      <details class="change-pw">
        <summary>Change admin password</summary>
        <div class="pw-form">
          <input type="password" id="newPw1" placeholder="New password">
          <input type="password" id="newPw2" placeholder="Confirm new password">
          <button class="btn btn-ghost" id="savePwBtn" type="button">Update password</button>
        </div>
        <div class="login-error" id="pwMsg"></div>
      </details>
    </div>

    <div class="glass" style="padding:18px 22px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:600; font-size:13.5px;">📁 Local data folder</div>
        <div class="hint" style="margin-top:4px;" id="folderStatus">Not connected — publishing will offer a download instead.</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" id="connectFolderBtn" type="button">Connect folder</button>
        <button class="btn btn-ghost" id="disconnectFolderBtn" type="button" style="display:none;">Disconnect</button>
      </div>
    </div>

    <div class="error-banner" id="errorBanner"></div>

    <div class="admin-grid">
      <div class="glass word-col">
        <h3>Across <span class="count-badge">up to 5</span></h3>
        <div class="dir-desc">Laid out horizontally. Leave any row blank if you have fewer than 5.</div>
        <div id="acrossRows"></div>
      </div>
      <div class="glass word-col">
        <h3>Down <span class="count-badge">up to 5</span></h3>
        <div class="dir-desc">Laid out vertically. Leave any row blank if you have fewer than 5.</div>
        <div id="downRows"></div>
      </div>
    </div>

    <div class="form-actions">
      <div class="badge" id="statusBadge">Loading…</div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-ghost" id="previewBtn" type="button">Preview layout</button>
        <button class="btn btn-primary" id="publishBtn" type="button">Generate &amp; Publish</button>
      </div>
    </div>

    <div class="glass preview-section" id="previewSection" style="display:none;">
      <h3>Live Preview</h3>
      <div id="previewGrid"></div>
      <div class="preview-note">This is how the auto-generated grid will look. Publish to make it live for everyone on the selected date.</div>
    </div>

    <div class="glass preview-section" id="archiveSection">
      <h3>Scheduled / Past Puzzles</h3>
      <div id="archiveList"><div class="hint">Loading…</div></div>
    </div>
  `;

  document.getElementById('puzzleDate').value = defaultDate;
  await loadFormForDate(defaultDate, draft);
  await renderArchiveList();
  await updateStatusBadge(defaultDate);

  document.getElementById('puzzleDate').addEventListener('change', async (e) => {
    const d = e.target.value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    await loadFormForDate(d, null);
    await updateStatusBadge(d);
  });

  attachAutosave();

  document.getElementById('savePwBtn').addEventListener('click', async () => {
    const p1 = document.getElementById('newPw1').value;
    const p2 = document.getElementById('newPw2').value;
    const msg = document.getElementById('pwMsg');
    msg.style.color = '';
    if (p1.length < 4) { msg.textContent = 'Password must be at least 4 characters.'; return; }
    if (p1 !== p2) { msg.textContent = 'Passwords do not match.'; return; }
    try {
      await setPassword(p1);
      msg.style.color = 'var(--ok)';
      msg.textContent = 'Password updated.';
      document.getElementById('newPw1').value = '';
      document.getElementById('newPw2').value = '';
    } catch (e) {
      msg.style.color = 'var(--danger)';
      msg.textContent = e.message || 'Could not update password.';
    }
  });

  document.getElementById('previewBtn').addEventListener('click', () => generate(false));
  document.getElementById('publishBtn').addEventListener('click', () => generate(true));

  refreshFolderStatus();
  document.getElementById('connectFolderBtn').addEventListener('click', async () => {
    try {
      const handle = await connectDataFolder();
      showToast(`Connected to "${handle.name}" — publishing will now also save quiz.json + responses.json there.`);
      refreshFolderStatus();
    } catch (e) {
      if (e.name !== 'AbortError') showToast(e.message || 'Could not connect to a folder.', true);
    }
  });
  document.getElementById('disconnectFolderBtn').addEventListener('click', async () => {
    await forgetDataFolder();
    refreshFolderStatus();
    showToast('Folder disconnected.');
  });
}

async function refreshFolderStatus() {
  const statusEl = document.getElementById('folderStatus');
  const connectBtn = document.getElementById('connectFolderBtn');
  const disconnectBtn = document.getElementById('disconnectFolderBtn');
  if (!statusEl) return;
  if (!FS_SUPPORTED) {
    statusEl.textContent = "This browser can't save directly to a folder (try Chrome or Edge) — publishing will offer a download instead.";
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'none';
    return;
  }
  const handle = await getDataFolderHandle();
  if (handle) {
    statusEl.textContent = `Connected to "${handle.name}" — each publish writes <date>/quiz.json and <date>/responses.json there.`;
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';
  } else {
    statusEl.textContent = 'Not connected — publishing will offer a download instead.';
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
  }
}

async function loadFormForDate(dateStr, draft) {
  let existing = null;
  try { existing = await getPuzzleForDate(dateStr); } catch (e) { existing = null; }
  const across = existing?.acrossClues?.map(c => ({ word: c.answer, clue: c.clue, explanation: c.explanation })) || draft?.across || [];
  const down = existing?.downClues?.map(c => ({ word: c.answer, clue: c.clue, explanation: c.explanation })) || draft?.down || [];
  const title = existing?.title || draft?.title || '';

  document.getElementById('acrossRows').innerHTML = wordRowsHtml('across', 5, across);
  document.getElementById('downRows').innerHTML = wordRowsHtml('down', 5, down);
  document.getElementById('puzzleTitle').value = title;

  for (const prefix of ['across', 'down']) {
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`${prefix}-word-${i}`);
      el.addEventListener('input', () => {
        const pos = el.selectionStart;
        el.value = el.value.toUpperCase();
        el.setSelectionRange(pos, pos);
      });
    }
  }
  attachAutosave();
}

function attachAutosave() {
  const inputs = app.querySelectorAll('#acrossRows input, #downRows input, #puzzleTitle, #puzzleDate');
  inputs.forEach(el => {
    el.oninput = () => {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(saveCurrentDraft, 400);
    };
  });
}

function saveCurrentDraft() {
  const { across, down } = collectWords();
  saveDraft({
    date: document.getElementById('puzzleDate').value.trim() || todayStr(),
    title: document.getElementById('puzzleTitle').value.trim(),
    across,
    down,
  });
}

async function updateStatusBadge(dateStr) {
  const badge = document.getElementById('statusBadge');
  let existing = null;
  try { existing = await getPuzzleForDate(dateStr); } catch (e) {
    badge.textContent = `Could not reach the server: ${e.message}`;
    return;
  }
  badge.textContent = existing
    ? `A puzzle is already published for ${dateStr} — publishing again will replace it.`
    : `No puzzle published yet for ${dateStr}.`;
}

async function renderArchiveList() {
  const el = document.getElementById('archiveList');
  let items = [];
  try {
    items = await listArchive();
  } catch (e) {
    el.innerHTML = `<div class="hint">Could not load the archive — ${esc(e.message)}</div>`;
    return;
  }
  if (items.length === 0) {
    el.innerHTML = `<div class="hint">No puzzles published yet.</div>`;
    return;
  }
  el.innerHTML = items.map(it => `
    <div class="archive-row">
      <div>
        <strong>${esc(it.date)}</strong> — ${esc(it.title || 'Untitled')}
        <div class="hint" style="margin-top:2px;">${it.acrossCount + it.downCount} words · ${it.responseCount} response${it.responseCount === 1 ? '' : 's'}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" data-files="${it.date}" type="button">Files</button>
        <button class="btn btn-ghost" data-edit="${it.date}" type="button">Edit</button>
        <button class="btn btn-danger" data-del="${it.date}" type="button">Delete</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = btn.dataset.edit;
      document.getElementById('puzzleDate').value = d;
      await loadFormForDate(d, null);
      await updateStatusBadge(d);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = btn.dataset.del;
      if (!confirm(`Delete the puzzle published for ${d}? This can't be undone.`)) return;
      try {
        await deletePuzzleForDate(d);
        await renderArchiveList();
        await updateStatusBadge(document.getElementById('puzzleDate').value.trim());
      } catch (e) {
        showToast(e.message || 'Delete failed.', true);
      }
    });
  });
  el.querySelectorAll('[data-files]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = btn.dataset.files;
      let p, responses;
      try {
        [p, responses] = await Promise.all([getPuzzleForDate(d), loadResponses(d)]);
      } catch (e) {
        showToast(e.message || 'Could not load files.', true);
        return;
      }
      if (FS_SUPPORTED && (await getDataFolderHandle())) {
        await syncQuizFile(d, p);
        await syncResponsesFile(d, responses);
        showToast(`Saved ${d}/quiz.json and ${d}/responses.json to your data folder.`);
      } else {
        downloadJson(`${d}_quiz.json`, p);
        downloadJson(`${d}_responses.json`, responses);
      }
    });
  });
}

function collectWords() {
  const across = [];
  const down = [];
  for (let i = 0; i < 5; i++) {
    across.push({
      word: document.getElementById(`across-word-${i}`).value.trim(),
      clue: document.getElementById(`across-clue-${i}`).value.trim(),
      explanation: document.getElementById(`across-expl-${i}`).value.trim(),
    });
    down.push({
      word: document.getElementById(`down-word-${i}`).value.trim(),
      clue: document.getElementById(`down-clue-${i}`).value.trim(),
      explanation: document.getElementById(`down-expl-${i}`).value.trim(),
    });
  }
  return { across, down };
}

/** Keep only rows that actually have a word; flag inconsistent partials (word with no clue, etc). */
function filterAndValidate(rows, label) {
  const filled = rows.filter(r => r.word || r.clue || r.explanation);
  for (const r of filled) {
    if (!r.word) return { error: `A ${label} row has a clue/explanation but no word — add the word or clear the row.` };
    if (!/^[A-Za-z]+$/.test(r.word)) return { error: `"${r.word}" is invalid — words must contain letters only, no spaces or numbers.` };
    if (r.word.length < 2) return { error: `"${r.word}" is too short — use words with at least 2 letters.` };
    if (r.word.length > 20) return { error: `"${r.word}" is too long — words can be at most 20 letters.` };
    if (!r.clue) return { error: `Please add a clue for "${r.word}".` };
  }
  return { rows: rows.filter(r => r.word) };
}

async function generate(publish) {
  const banner = document.getElementById('errorBanner');
  banner.classList.remove('show');
  banner.style.color = '';
  banner.style.background = '';
  banner.style.borderColor = '';

  const { across, down } = collectWords();
  const acrossResult = filterAndValidate(across, 'Across');
  if (acrossResult.error) { banner.textContent = acrossResult.error; banner.classList.add('show'); return; }
  const downResult = filterAndValidate(down, 'Down');
  if (downResult.error) { banner.textContent = downResult.error; banner.classList.add('show'); return; }

  if (acrossResult.rows.length === 0 || downResult.rows.length === 0) {
    banner.textContent = 'Add at least one Across word and one Down word.';
    banner.classList.add('show');
    return;
  }

  const dateStr = document.getElementById('puzzleDate').value.trim() || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    banner.textContent = 'Please enter the publish date as YYYY-MM-DD.';
    banner.classList.add('show');
    return;
  }

  const title = document.getElementById('puzzleTitle').value.trim() || 'Daily Crossword';

  let puzzle;
  try {
    puzzle = generateCrossword(acrossResult.rows, downResult.rows, title);
  } catch (e) {
    banner.textContent = e.message || 'Could not generate the crossword from these words.';
    banner.classList.add('show');
    return;
  }

  puzzle.date = dateStr;

  if (puzzle.disconnected > 0) {
    banner.textContent = `Heads up: ${puzzle.disconnected} word(s) couldn't be interlocked with the others (no shared letters found) and were placed separately below the main grid. Try adjusting a word or two for better overlap.`;
    banner.classList.add('show');
  }

  renderPreview(puzzle);

  if (publish) {
    try {
      await savePuzzleForDate(dateStr, puzzle);
      await updateStatusBadge(dateStr);
      await renderArchiveList();
      await publishFiles(dateStr, puzzle);
    } catch (e) {
      showToast(e.message || 'Publish failed — are you still logged in?', true);
    }
  }
}

/** After publishing: mirror quiz.json (+ responses.json, if any exist yet) to the
 *  connected folder, or offer a one-click download of the same files. */
async function publishFiles(dateStr, puzzle) {
  const responses = await loadResponses(dateStr).catch(() => []);
  if (FS_SUPPORTED && (await getDataFolderHandle())) {
    const okQuiz = await syncQuizFile(dateStr, puzzle);
    await syncResponsesFile(dateStr, responses);
    showToast(okQuiz ? `Published for ${dateStr} — live for everyone, and saved to your data folder.` : `Published for ${dateStr}, but saving to the folder failed — check console.`, !okQuiz);
  } else {
    showToast(`Puzzle published for ${dateStr} — live for everyone now!`);
    offerDownload(dateStr, puzzle, responses);
  }
}

function offerDownload(dateStr, puzzle, responses) {
  const banner = document.getElementById('errorBanner');
  banner.classList.remove('show');
  banner.innerHTML = `
    <span>Puzzle published for ${esc(dateStr)}. No data folder connected — </span>
    <button class="btn btn-ghost" id="dlQuizBtn" type="button" style="padding:4px 12px; font-size:12px;">Download quiz.json</button>
    <button class="btn btn-ghost" id="dlRespBtn" type="button" style="padding:4px 12px; font-size:12px;">Download responses.json</button>
  `;
  banner.style.color = 'var(--text-1)';
  banner.style.background = '#fafafd';
  banner.style.borderColor = 'var(--panel-border)';
  banner.classList.add('show');
  document.getElementById('dlQuizBtn').addEventListener('click', () => downloadJson(`${dateStr}_quiz.json`, puzzle));
  document.getElementById('dlRespBtn').addEventListener('click', () => downloadJson(`${dateStr}_responses.json`, responses));
}

function renderPreview(puzzle) {
  const section = document.getElementById('previewSection');
  const gridEl = document.getElementById('previewGrid');
  section.style.display = '';

  const cellSize = puzzle.width > 14 ? 28 : 34;
  let html = `<div class="xw-grid" style="grid-template-columns: repeat(${puzzle.width}, ${cellSize}px);">`;
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      const cell = puzzle.cells[r][c];
      if (cell.blocked) {
        html += `<div class="xw-cell blocked" style="width:${cellSize}px;height:${cellSize}px;"></div>`;
      } else {
        const numLabel = [cell.acrossNumber, cell.downNumber].filter(n => n != null).join(',');
        html += `<div class="xw-cell" style="width:${cellSize}px;height:${cellSize}px;">
          ${numLabel ? `<span class="num">${numLabel}</span>` : ''}
          <span style="font-family:'Outfit',sans-serif; font-weight:700; font-size:${cellSize * 0.42}px;">${cell.letter}</span>
        </div>`;
      }
    }
  }
  html += `</div>`;
  gridEl.innerHTML = html;
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let toastTimer = null;
function showToast(msg, isErr) {
  let t = document.querySelector('.toast');
  if (t) t.remove();
  t = document.createElement('div');
  t.className = 'toast ' + (isErr ? 'err' : 'ok');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

init();
