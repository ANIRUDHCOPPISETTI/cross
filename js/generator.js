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
  const pool = [
    ...acrossWords.map(w => ({ ...w, dir: 'across' })),
    ...downWords.map(w => ({ ...w, dir: 'down' })),
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

function buildPuzzleFromResult(result, title) {
  const { placements, occupied, minR, minC, maxR, maxC } = result;
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;

  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ letter: null, blocked: true, number: null }))
  );

  for (const [k, letter] of occupied.entries()) {
    const [r, c] = k.split(',').map(Number);
    cells[r - minR][c - minC] = { letter, blocked: false, number: null };
  }

  let num = 1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (cells[r][c].blocked) continue;
      const startsAcross = (c === 0 || cells[r][c - 1].blocked) && (c + 1 < width && !cells[r][c + 1].blocked);
      const startsDown = (r === 0 || cells[r - 1][c].blocked) && (r + 1 < height && !cells[r + 1][c].blocked);
      if (startsAcross || startsDown) {
        cells[r][c].number = num++;
      }
    }
  }

  const acrossClues = [];
  const downClues = [];
  for (const p of placements) {
    const r = p.row - minR;
    const c = p.col - minC;
    const number = cells[r][c].number;
    const entry = { number, clue: p.clue, explanation: p.explanation || '', answer: p.word, row: r, col: c, length: p.word.length };
    if (p.dir === 'across') acrossClues.push(entry); else downClues.push(entry);
  }
  acrossClues.sort((a, b) => a.number - b.number);
  downClues.sort((a, b) => a.number - b.number);

  return {
    title: title || 'Daily Crossword',
    createdAt: new Date().toISOString(),
    width,
    height,
    cells,
    acrossClues,
    downClues,
    disconnected: result.disconnected,
  };
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
