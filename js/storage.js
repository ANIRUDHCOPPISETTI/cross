/* storage.js — client for the shared backend (see /api/*.js + Vercel KV),
   plus the purely local (per-browser) bits that have no reason to be shared:
   solving progress, remembered player name, admin draft, and the optional
   on-disk data-folder export.

   Puzzles, responses/leaderboard, and the admin password now live server-side
   so every visitor (any browser, any device, incognito included) sees the
   same published puzzle and leaderboard.
*/

function pad2(n) { return n.toString().padStart(2, '0'); }

function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateStr(dt);
}

async function apiFetch(url, opts) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch (e) {
    throw new Error('Network error — could not reach the server.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error page, fall through */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data || {};
}

/* ---------- Admin auth (server-side session cookie) ---------- */

/** Attempts login; the server sets an HttpOnly session cookie on success. */
async function verifyPassword(pw) {
  try {
    await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
    return true;
  } catch (e) {
    return false;
  }
}

async function setPassword(pw) {
  await apiFetch('/api/password', { method: 'POST', body: JSON.stringify({ newPassword: pw }) });
}

async function isLoggedIn() {
  try {
    const data = await apiFetch('/api/login');
    return !!data.loggedIn;
  } catch (e) {
    return false;
  }
}

async function logout() {
  await apiFetch('/api/logout', { method: 'POST' });
}

/* ---------- Puzzle archive (shared across all visitors) ---------- */

async function getPuzzleForDate(dateStr) {
  const data = await apiFetch(`/api/puzzle?date=${encodeURIComponent(dateStr)}`);
  return data.puzzle || null;
}

async function savePuzzleForDate(dateStr, puzzle) {
  await apiFetch('/api/puzzle', { method: 'POST', body: JSON.stringify({ date: dateStr, puzzle }) });
}

async function deletePuzzleForDate(dateStr) {
  await apiFetch(`/api/puzzle?date=${encodeURIComponent(dateStr)}`, { method: 'DELETE' });
}

/** Returns [{date, title, acrossCount, downCount, responseCount}], newest first. */
async function listArchive() {
  const data = await apiFetch('/api/archive');
  return data.archive || [];
}

/* ---------- Responses / leaderboard (shared across all visitors) ---------- */

async function loadResponses(dateStr) {
  const data = await apiFetch(`/api/responses?date=${encodeURIComponent(dateStr)}`);
  return data.responses || [];
}

async function saveResponse(dateStr, entry) {
  await apiFetch('/api/responses', { method: 'POST', body: JSON.stringify({ date: dateStr, entry }) });
}

async function topScores(dateStr, n) {
  const data = await apiFetch(`/api/responses?date=${encodeURIComponent(dateStr)}&top=${n || 5}`);
  return data.responses || [];
}

/* ---------- Admin draft (auto-saved as the admin types, before publishing) ----------
   Local only — just a convenience so a refresh doesn't lose in-progress typing. */

const CW_KEYS = {
  DRAFT: 'cw_draft_v1',
  PROGRESS_PREFIX: 'cw_progress_',
  PLAYER_NAME: 'cw_player_name',
};

function saveDraft(draft) {
  localStorage.setItem(CW_KEYS.DRAFT, JSON.stringify(draft));
}

function loadDraft() {
  const raw = localStorage.getItem(CW_KEYS.DRAFT);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/* ---------- Per-date solving progress ----------
   Local only, and rightly so: each visitor's in-progress answers are their
   own — only the final completion time gets shared (via saveResponse above).
*/

function saveProgressForDate(dateStr, data) {
  localStorage.setItem(CW_KEYS.PROGRESS_PREFIX + dateStr, JSON.stringify(data));
}

function loadProgressForDate(dateStr) {
  const raw = localStorage.getItem(CW_KEYS.PROGRESS_PREFIX + dateStr);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function clearProgressForDate(dateStr) {
  localStorage.removeItem(CW_KEYS.PROGRESS_PREFIX + dateStr);
}

/* ---------- Player name (remembered between visits, local only) ---------- */

function savePlayerName(name) {
  localStorage.setItem(CW_KEYS.PLAYER_NAME, name);
}

function loadPlayerName() {
  return localStorage.getItem(CW_KEYS.PLAYER_NAME) || '';
}

/* ---------- Optional on-disk data folder ----------
   Uses the File System Access API (Chrome/Edge) to mirror each day's puzzle +
   responses into real files on disk: <root>/<date>/quiz.json and
   <root>/<date>/responses.json. Not supported in every browser, so this stays
   a convenience export layered on top of the shared backend, never a
   dependency of it.
*/

const FS_SUPPORTED = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cw_fs_db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** Opens a folder picker and remembers the chosen folder for next time. */
async function connectDataFolder() {
  if (!FS_SUPPORTED) throw new Error('This browser can’t save directly to a folder (try Chrome or Edge). Use the download buttons instead.');
  const handle = await window.showDirectoryPicker({ id: 'crossword-data', mode: 'readwrite' });
  await idbSet('rootDir', handle);
  return handle;
}

/** Returns the previously-connected folder handle, re-requesting permission if needed. */
async function getDataFolderHandle() {
  if (!FS_SUPPORTED) return null;
  const handle = await idbGet('rootDir');
  if (!handle) return null;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return handle;
  if ((await handle.requestPermission(opts)) === 'granted') return handle;
  return null;
}

async function forgetDataFolder() {
  await idbSet('rootDir', null);
}

async function writeJsonFile(rootHandle, dateStr, filename, data) {
  const dateDir = await rootHandle.getDirectoryHandle(dateStr, { create: true });
  const fileHandle = await dateDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/** Best-effort: writes <date>/quiz.json if a folder is connected; silently no-ops otherwise. */
async function syncQuizFile(dateStr, quiz) {
  try {
    const dir = await getDataFolderHandle();
    if (!dir) return false;
    await writeJsonFile(dir, dateStr, 'quiz.json', quiz);
    return true;
  } catch (e) { console.warn('Data folder sync (quiz) failed:', e); return false; }
}

/** Best-effort: writes <date>/responses.json if a folder is connected; silently no-ops otherwise. */
async function syncResponsesFile(dateStr, responses) {
  try {
    const dir = await getDataFolderHandle();
    if (!dir) return false;
    await writeJsonFile(dir, dateStr, 'responses.json', responses);
    return true;
  } catch (e) { console.warn('Data folder sync (responses) failed:', e); return false; }
}

/** Fallback for browsers without folder access: downloads a single JSON file. */
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
