/* generator.js
   Takes 5 Across + 5 Down { word, clue } entries and auto-builds a crossword
   layout by searching for letter intersections between across/down words
   (since their orientation is fixed by the admin), running many randomized
   placement attempts, and keeping the best (most interlocking, most compact)
   result. Produces a numbered grid + clue lists ready to render.
*/

function cleanWord(w) {
  return (w || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function cwKey(r, c) { return r + ',' + c; }

function runAttempt(acrossWords, downWords) {
  // idx preserves each word's original position in the admin's input list
  // (separately per direction), so numbering can later follow input order
  // instead of wherever the layout search happens to place it.
  const pool = [
    ...acrossWords.map((w, idx) => ({ ...w, dir: 'across', idx })),
    ...downWords.map((w, idx) => ({ ...w, dir: 'down', idx })),
  ];
  // Longest first (more letters = more intersection chances), shuffle ties.
  pool.sort((a, b) => b.word.length - a.word.length || Math.random() - 0.5);

  const occupied = new Map(); // "r,c" -> letter
  const placements = [];

  function canPlace(word, dir, row, col) {
    const len = word.length;
    for (let i = 0; i < len; i++) {
      const r = dir === 'across' ? row : row + i;
      const c = dir === 'across' ? col + i : col;
      const existing = occupied.get(cwKey(r, c));
      if (existing !== undefined) {
        if (existing !== word[i]) return false;
      } else {
        if (dir === 'across') {
          if (occupied.has(cwKey(r - 1, c)) || occupied.has(cwKey(r + 1, c))) return false;
        } else {
          if (occupied.has(cwKey(r, c - 1)) || occupied.has(cwKey(r, c + 1))) return false;
        }
      }
    }
    if (dir === 'across') {
      if (occupied.has(cwKey(row, col - 1))) return false;
      if (occupied.has(cwKey(row, col + len))) return false;
    } else {
      if (occupied.has(cwKey(row - 1, col))) return false;
      if (occupied.has(cwKey(row + len, col))) return false;
    }
    return true;
  }

  function intersectionScore(word, dir, row, col) {
    let score = 0;
    for (let i = 0; i < word.length; i++) {
      const r = dir === 'across' ? row : row + i;
      const c = dir === 'across' ? col + i : col;
      if (occupied.has(cwKey(r, c))) score++;
    }
    return score;
  }

  function place(entry, row, col) {
    for (let i = 0; i < entry.word.length; i++) {
      const r = entry.dir === 'across' ? row : row + i;
      const c = entry.dir === 'across' ? col + i : col;
      occupied.set(cwKey(r, c), entry.word[i]);
    }
    placements.push({ ...entry, row, col });
  }

  function findCandidates(word, dir, placedOpposite) {
    const cands = [];
    for (const p of placedOpposite) {
      for (let i = 0; i < word.length; i++) {
        for (let j = 0; j < p.word.length; j++) {
          if (word[i] !== p.word[j]) continue;
          let row, col;
          if (dir === 'across') {
            row = p.row + j;
            col = p.col - i;
          } else {
            row = p.row - i;
            col = p.col + j;
          }
          if (canPlace(word, dir, row, col)) {
            cands.push({ row, col, score: intersectionScore(word, dir, row, col) });
          }
        }
      }
    }
    return cands;
  }

  const first = pool.shift();
  place(first, 0, 0);
  let remaining = pool;
  let progress = true;

  while (remaining.length > 0 && progress) {
    progress = false;
    let best = null;
    for (const w of remaining) {
      const placedOpposite = placements.filter(p => p.dir !== w.dir);
      if (placedOpposite.length === 0) continue;
      const cands = findCandidates(w.word, w.dir, placedOpposite);
      for (const c of cands) {
        if (!best || c.score > best.score) best = { w, row: c.row, col: c.col, score: c.score };
      }
    }
    if (best) {
      place(best.w, best.row, best.col);
      remaining = remaining.filter(x => x !== best.w);
      progress = true;
    }
  }

  // Fallback: anything left couldn't interlock — park it below, still solvable,
  // just visually separate from the main cluster.
  let offsetRow = 200;
  for (const w of remaining) {
    place(w, offsetRow, 0);
    offsetRow += 2;
  }

  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of occupied.keys()) {
    const [r, c] = k.split(',').map(Number);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  const area = (maxR - minR + 1) * (maxC - minC + 1);

  return { placements, occupied, disconnected: remaining.length, area, minR, minC, maxR, maxC };
}

/** Builds the width x height cell grid from an "r,c" -> letter map, with an
 *  (originR, originC) offset so auto-mode (trimmed to its bounding box) and
 *  manual mode (fixed at the admin's chosen size, origin 0,0) can share it. */
function buildCellsGrid(width, height, occupied, originR, originC) {
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ letter: null, blocked: true, acrossNumber: null, downNumber: null }))
  );
  for (const [k, letter] of occupied.entries()) {
    const [r, c] = k.split(',').map(Number);
    const rr = r - originR, cc = c - originC;
    if (rr < 0 || rr >= height || cc < 0 || cc >= width) continue;
    cells[rr][cc] = { letter, blocked: false, acrossNumber: null, downNumber: null };
  }
  return cells;
}

/** Numbers by the admin's input order: all Across clues get 1..N (in the order
 *  they were typed/placed), then all Down clues continue N+1..M — regardless
 *  of where either ends up in the grid. Assembles the final puzzle object —
 *  shared by both the auto-layout search and manual placement. */
function finalizePuzzle(cells, width, height, placements, originR, originC, title, disconnected) {
  const acrossPlacements = placements.filter(p => p.dir === 'across').sort((a, b) => a.idx - b.idx);
  const downPlacements = placements.filter(p => p.dir === 'down').sort((a, b) => a.idx - b.idx);

  let num = 1;
  const acrossClues = [];
  for (const p of acrossPlacements) {
    const r = p.row - originR;
    const c = p.col - originC;
    cells[r][c].acrossNumber = num;
    acrossClues.push({ number: num, clue: p.clue, explanation: p.explanation || '', answer: p.word, row: r, col: c, length: p.word.length });
    num++;
  }
  const downClues = [];
  for (const p of downPlacements) {
    const r = p.row - originR;
    const c = p.col - originC;
    cells[r][c].downNumber = num;
    downClues.push({ number: num, clue: p.clue, explanation: p.explanation || '', answer: p.word, row: r, col: c, length: p.word.length });
    num++;
  }

  return {
    title: title || 'Daily Crossword',
    createdAt: new Date().toISOString(),
    width,
    height,
    cells,
    acrossClues,
    downClues,
    disconnected,
  };
}

function buildPuzzleFromResult(result, title) {
  const { placements, occupied, minR, minC, maxR, maxC } = result;
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const cells = buildCellsGrid(width, height, occupied, minR, minC);
  return finalizePuzzle(cells, width, height, placements, minR, minC, title, result.disconnected);
}

/**
 * Builds a puzzle from admin-chosen placements (manual mode) — no layout
 * search, no trimming: the grid is exactly the chosen width/height, and every
 * word sits exactly where the admin clicked.
 *
 * acrossRows / downRows: [{ word, clue, explanation, row, col } | null] —
 * null entries (not yet placed) are skipped.
 */
function buildManualCrossword(acrossRows, downRows, width, height, title) {
  const clean = (rows, dir) => rows
    .map((w, idx) => w && { ...w, word: cleanWord(w.word), clue: (w.clue || '').trim(), explanation: (w.explanation || '').trim(), dir, idx })
    .filter(Boolean);

  const across = clean(acrossRows, 'across');
  const down = clean(downRows, 'down');

  if (across.length === 0 || down.length === 0) {
    throw new Error('Place at least one Across word and one Down word on the grid.');
  }

  const occupied = new Map();
  const placements = [];
  for (const p of [...across, ...down]) {
    for (let i = 0; i < p.word.length; i++) {
      const r = p.dir === 'across' ? p.row : p.row + i;
      const c = p.dir === 'across' ? p.col + i : p.col;
      if (r < 0 || r >= height || c < 0 || c >= width) {
        throw new Error(`"${p.word}" doesn't fit on the grid — move it or enlarge the grid.`);
      }
      const key = cwKey(r, c);
      const existing = occupied.get(key);
      if (existing !== undefined && existing !== p.word[i]) {
        throw new Error(`"${p.word}" conflicts with another word at row ${r + 1}, column ${c + 1}.`);
      }
      occupied.set(key, p.word[i]);
    }
    placements.push(p);
  }

  const cells = buildCellsGrid(width, height, occupied, 0, 0);
  return finalizePuzzle(cells, width, height, placements, 0, 0, title, 0);
}

/**
 * Public entry point.
 * acrossWords / downWords: [{ word, clue, explanation }] — any count >= 1 each is fine,
 * up to 5. Rows the admin left empty should already be filtered out by the caller.
 */
function generateCrossword(acrossWords, downWords, title) {
  const across = acrossWords.map(w => ({ word: cleanWord(w.word), clue: (w.clue || '').trim(), explanation: (w.explanation || '').trim() }));
  const down = downWords.map(w => ({ word: cleanWord(w.word), clue: (w.clue || '').trim(), explanation: (w.explanation || '').trim() }));

  if (across.length === 0 || down.length === 0) {
    throw new Error('Add at least one Across word and one Down word.');
  }
  if (across.some(w => !w.word) || down.some(w => !w.word)) {
    throw new Error('Words must contain letters only (A-Z).');
  }

  const ATTEMPTS = 300;
  let best = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    const result = runAttempt(across, down);
    if (
      !best ||
      result.disconnected < best.disconnected ||
      (result.disconnected === best.disconnected && result.area < best.area)
    ) {
      best = result;
    }
    if (best.disconnected === 0 && i > 40) break; // good enough, stop early
  }

  return buildPuzzleFromResult(best, title);
}
