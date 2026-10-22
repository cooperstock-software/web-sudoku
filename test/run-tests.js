// Run with:  node test/run-tests.js      (no packages needed)
'use strict';
const assert = require('node:assert/strict');
const { Puzzle, METHOD, rowColToBox9, rowColToBox6 } = require('../js/puzzle.js');
const { fullSolve, Backtrack } = require('../js/solver.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}

// A stand-in for the browser UI: records the messages and answers confirmations with `answer`.
function fakeUi(answer = true) {
  const log = { messages: [], confirms: [], renders: 0, pauses: 0, ticks: 0 };
  let clock = 0;
  return {
    log,
    render() { log.renders++; },
    async message(t) { log.messages.push(t); },
    async confirm(t) { log.confirms.push(t); return answer; },
    async pause() { log.pauses++; },
    async tick() { log.ticks++; },
    now() { return (clock += 10); },
  };
}
const settings = (over = {}) => ({ method: METHOD.SIMPLE_AUTO_BACKTRACK, doSleeps: false,
  reportDuration: false, showAttempts: false, ...over });

// Fill a puzzle from an 81 (or 36) character string, 0 or . for empty
function fill(puzzle, str) {
  let i = 0;
  for (const cell of puzzle.allCells()) {
    const ch = str[i++];
    if (ch !== '0' && ch !== '.') cell.setResult(ch, true);
  }
  return puzzle;
}
const digitsOf = (puzzle) => [...puzzle.allCells()].map((c) => (c.resultVisible ? c.resultText : '0')).join('');

// Is every row, column and box a permutation of 1..n?
function isValidSolution(puzzle) {
  const want = Array.from({ length: puzzle.n }, (_, i) => String(i + 1)).join('');
  const sorted = (cells) => cells.map((c) => c.resultText).sort().join('');
  for (let i = 1; i <= puzzle.n; i++) {
    if (sorted(puzzle.cells[i].slice(1, puzzle.n + 1)) !== want) return false;
    if (sorted(puzzle.columns[i].slice(1, puzzle.n + 1)) !== want) return false;
    if (sorted(puzzle.boxes[i].slice(1, puzzle.n + 1)) !== want) return false;
  }
  return true;
}

const EASY = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const EASY_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const HARD = '000000907000420180000705026100904000050000040000507009920108000034059000507000000';
// "World's hardest" style puzzle, light on givens; forces real backtracking
const HARDEST = '800000000003600000070090200050007000000045700000100030001000068008500010090000400';
// A sparse 6x6 puzzle with exactly one solution (checked with an independent solver)
const SIX = '000056400000201000000030010040005310';
const SIX_SOLUTION = '123456456123231564564231312645645312';

(async () => {
  console.log('Geometry');
  await test('9x9: every box has 9 distinct squares and positions line up', () => {
    const p = new Puzzle(9);
    for (let b = 1; b <= 9; b++) {
      const cells = p.boxes[b].slice(1, 10);
      assert.equal(new Set(cells).size, 9);
      assert.ok(cells.every((c) => c && c.boxNum === b));
    }
    assert.deepEqual(rowColToBox9(1, 1), { boxNum: 1, boxPos: 1 });
    assert.deepEqual(rowColToBox9(9, 9), { boxNum: 9, boxPos: 9 });
    assert.deepEqual(rowColToBox9(5, 4), { boxNum: 5, boxPos: 4 });
  });
  await test('6x6: boxes are 3 wide x 2 high, 6 squares each', () => {
    const p = new Puzzle(6);
    for (let b = 1; b <= 6; b++) {
      const cells = p.boxes[b].slice(1, 7);
      assert.equal(new Set(cells).size, 6);
      assert.ok(cells.every((c) => c && c.boxNum === b));
    }
    assert.deepEqual(rowColToBox6(1, 1), { boxNum: 1, boxPos: 1 });
    assert.deepEqual(rowColToBox6(2, 4), { boxNum: 2, boxPos: 4 });
    assert.deepEqual(rowColToBox6(3, 1), { boxNum: 3, boxPos: 1 });
    assert.deepEqual(rowColToBox6(6, 6), { boxNum: 6, boxPos: 6 });
    assert.equal(p.cells[2][3].boxNum, 1);
    assert.equal(p.cells[3][1].boxNum, 3);
  });
  await test('colours: 9x9 alternates by box, 6x6 uses boxes 1, 4 and 5 for white', () => {
    const p9 = new Puzzle(9);
    assert.equal(p9.cells[1][1].isWhite, true);
    assert.equal(p9.cells[1][4].isWhite, false);
    const p6 = new Puzzle(6);
    const white = [...new Set([...p6.allCells()].filter((c) => c.isWhite).map((c) => c.boxNum))];
    assert.deepEqual(white.sort(), [1, 4, 5]);
  });

  console.log('Entering digits');
  await test('allowedProblem finds row, column and box conflicts with the original messages', () => {
    const p = new Puzzle(9);
    p.cells[1][1].setResult('5', true);
    assert.equal(p.allowedProblem(1, 9, '5'),
      'You cannot put a 5 in this square, because it already occurs in another square in the same row.');
    assert.equal(p.allowedProblem(9, 1, '5'),
      'You cannot put a 5 in this square, because it already occurs in another square in the same column.');
    assert.equal(p.allowedProblem(2, 2, '5'),
      'You cannot put a 5 in this square, because it already occurs in another square in the same 3 x 3 box.');
    assert.equal(p.allowedProblem(4, 4, '5'), null);
    assert.equal(p.allowedProblem(1, 9, ''), null);
    const q = new Puzzle(6);
    q.cells[1][1].setResult('2', true);
    assert.match(q.allowedProblem(2, 3, '2'), /same 3 x 2 box\.$/);
  });
  await test('bubbleResult strikes the digit out of the row, column and box only', () => {
    const p = new Puzzle(9);
    p.manualPlay();
    p.cells[5][5].setResult('7', false);
    assert.equal(p.cells[5][1].isPossible(7), false);
    assert.equal(p.cells[1][5].isPossible(7), false);
    assert.equal(p.cells[4][4].isPossible(7), false);
    assert.equal(p.cells[1][1].isPossible(7), true);
    assert.equal(p.cells[5][1].isPossible(6), true);
  });
  await test('setResult / showDigits / clearAll keep the two halves of a square in step', () => {
    const p = new Puzzle(9);
    const c = p.cells[3][3];
    c.setResult('4', true);
    assert.deepEqual([c.resultVisible, c.digitsVisible, c.isOriginal], [true, false, true]);
    c.clearAll();
    assert.deepEqual([c.resultVisible, c.digitsVisible, c.isOriginal], [false, false, true]);
    c.showDigits();
    assert.deepEqual([c.resultVisible, c.digitsVisible], [false, true]);
    c.setResult('4', false);
    assert.deepEqual([c.resultVisible, c.digitsVisible, c.isOriginal], [true, false, false]);
  });
  await test('Delete before play just blanks the square, so the puzzle can be clear again', () => {
    const p = new Puzzle(9);
    p.cells[1][1].setResult('5', true);
    assert.equal(p.isClear(), false);
    p.clearResult(1, 1);
    assert.equal(p.isClear(), true);
    assert.equal(p.toSaveText(), new Puzzle(9).toSaveText());
  });
  await test('Delete during play restores small digits and re-allows the digit where it no longer conflicts', () => {
    const p = new Puzzle(9);
    p.cells[1][1].setResult('5', true);
    p.manualPlay();
    p.cells[1][2].setResult('3', false);          // a solved digit we will delete
    assert.equal(p.cells[1][9].isPossible(3), false);
    assert.equal(p.cells[2][2].isPossible(3), false);
    p.clearResult(1, 2);
    assert.deepEqual([p.cells[1][2].resultVisible, p.cells[1][2].digitsVisible], [false, true]);
    assert.equal(p.cells[1][2].isPossible(3), true);
    assert.equal(p.cells[1][2].isPossible(5), false);   // still blocked by the 5 in the same row
    assert.equal(p.cells[1][9].isPossible(3), true);
    assert.equal(p.cells[2][2].isPossible(3), true);
    assert.equal(p.cells[1][9].isPossible(5), false);   // other digits untouched
  });

  console.log('Save files');
  await test('save text has the same layout as the Delphi / C# programs', () => {
    const p = new Puzzle(6);
    p.cells[1][1].setResult('1', true);
    p.manualPlay();
    p.cells[1][2].setResult('2', false);
    const lines = p.toSaveText().split('\n');
    assert.equal(lines.length, 14);   // 6 border + 6 rows + closing border + trailing ''
    assert.equal(lines[0], '+---+---+---+---+---+---+');
    assert.equal(lines[1], '|111| 2 |   |   |   |   |');
    assert.equal(lines[13], '');
  });
  await test('save then load reproduces the puzzle exactly, 9x9 and 6x6', () => {
    for (const [n, str] of [[9, EASY], [6, SIX]]) {
      const a = fill(new Puzzle(n), str);
      a.manualPlay();
      const first = [...a.allCells()].find((c) => !c.resultVisible);
      first.setResult(String(n), false);
      const text = a.toSaveText();
      const b = new Puzzle(n);
      assert.equal(b.loadFromText(text), null);
      assert.equal(b.toSaveText(), text);
      assert.equal(b.cells[first.row][first.col].isOriginal, false);
      assert.equal(b.cells[1][1].isOriginal, str[0] !== '0' ? true : b.cells[1][1].isOriginal);
    }
  });
  await test('loading also accepts CRLF line endings', () => {
    const a = fill(new Puzzle(9), EASY);
    const b = new Puzzle(9);
    assert.equal(b.loadFromText(a.toSaveText().replace(/\n/g, '\r\n')), null);
    assert.equal(b.toSaveText(), a.toSaveText());
  });
  await test('loading a 6x6 file into a 9x9 puzzle gives the original warning', () => {
    const text = fill(new Puzzle(6), SIX).toSaveText();
    const msg = new Puzzle(9).loadFromText(text);
    assert.equal(msg, 'This appears to be a file saved from a 6 x 6 Sudoku, rather than a 9 x 9 one.\n\n' +
      'It cannot be loaded into this puzzle');
  });
  await test('a truncated file reports a problem instead of throwing', () => {
    const text = fill(new Puzzle(9), EASY).toSaveText().split('\n').slice(0, 5).join('\n') + '\n|1';
    assert.match(new Puzzle(9).loadFromText(text), /too short/);
  });

  console.log('Solving');
  await test('simple rules alone solve the easy puzzle to the known solution', async () => {
    const p = fill(new Puzzle(9), EASY);
    p.manualPlay();
    const ui = fakeUi();
    await fullSolve({ puzzle: p, settings: settings({ method: METHOD.SIMPLE_PROMPT_BACKTRACK }), ui });
    assert.equal(digitsOf(p), EASY_SOLUTION);
    assert.equal(ui.log.confirms.length, 0);                       // never needed backtracking
    assert.deepEqual(ui.log.messages, ['The puzzle has been successfully solved.']);
  });
  await test('original digits stay bold, solved ones do not', async () => {
    const p = fill(new Puzzle(9), EASY);
    await fullSolve({ puzzle: p, settings: settings(), ui: fakeUi() });
    assert.equal(p.cells[1][1].isOriginal, true);     // the 5
    assert.equal(p.cells[1][3].isOriginal, false);    // solved
  });
  await test('PROMPT method asks before backtracking; saying No leaves it for manual play', async () => {
    const p = fill(new Puzzle(9), HARDEST);
    const ui = fakeUi(false);
    await fullSolve({ puzzle: p, settings: settings({ method: METHOD.SIMPLE_PROMPT_BACKTRACK }), ui });
    assert.equal(ui.log.confirms.length, 1);
    assert.match(ui.log.confirms[0], /^Sorry, the simple solving rules/);
    assert.deepEqual(ui.log.messages, ['You can try solving the rest of it manually.']);
    assert.equal(p.isSolved(), false);
  });
  await test('PROMPT method: saying Yes backtracks to a valid solution that keeps the givens', async () => {
    const p = fill(new Puzzle(9), HARDEST);
    const ui = fakeUi(true);
    await fullSolve({ puzzle: p, settings: settings({ method: METHOD.SIMPLE_PROMPT_BACKTRACK }), ui });
    assert.equal(ui.log.confirms.length, 1);
    assert.equal(p.isSolved(), true);
    assert.ok(isValidSolution(p));
    for (let i = 0; i < 81; i++) if (HARDEST[i] !== '0') assert.equal(digitsOf(p)[i], HARDEST[i]);
  });
  await test('AUTO method backtracks without asking', async () => {
    const p = fill(new Puzzle(9), HARDEST);
    const ui = fakeUi();
    await fullSolve({ puzzle: p, settings: settings({ method: METHOD.SIMPLE_AUTO_BACKTRACK }), ui });
    assert.equal(ui.log.confirms.length, 0);
    assert.ok(p.isSolved() && isValidSolution(p));
  });
  await test('ONLY_BACKTRACK solves directly, including a very sparse puzzle', async () => {
    for (const str of [EASY, HARD, HARDEST]) {
      const p = fill(new Puzzle(9), str);
      const ui = fakeUi();
      await fullSolve({ puzzle: p, settings: settings({ method: METHOD.ONLY_BACKTRACK }), ui });
      assert.ok(p.isSolved() && isValidSolution(p), 'puzzle ' + str.slice(0, 9));
      assert.equal(ui.log.pauses, 0);
    }
  });
  await test('backtracking and the simple rules agree on a uniquely solvable puzzle', async () => {
    const a = fill(new Puzzle(9), EASY);
    await fullSolve({ puzzle: a, settings: settings({ method: METHOD.ONLY_BACKTRACK }), ui: fakeUi() });
    assert.equal(digitsOf(a), EASY_SOLUTION);
  });
  await test('6x6 puzzles solve (simple rules and backtracking)', async () => {
    for (const method of [METHOD.SIMPLE_AUTO_BACKTRACK, METHOD.ONLY_BACKTRACK]) {
      const p = fill(new Puzzle(6), SIX);
      await fullSolve({ puzzle: p, settings: settings({ method }), ui: fakeUi() });
      assert.ok(p.isSolved() && isValidSolution(p), 'method ' + method);
      assert.equal(digitsOf(p), SIX_SOLUTION);
    }
  });
  await test('a puzzle with no solution is reported, not looped on', async () => {
    const q = new Puzzle(9);
    // Row 1 has 1-8 placed; (1,9) can only be 9, but column 9 already holds a 9.
    '12345678'.split('').forEach((d, i) => q.cells[1][i + 1].setResult(d, true));
    q.cells[5][9].setResult('9', true);
    const ui = fakeUi();
    await fullSolve({ puzzle: q, settings: settings({ method: METHOD.ONLY_BACKTRACK }), ui });
    assert.equal(q.isSolved(), false);
    assert.deepEqual(ui.log.messages, ['The backtracking method was not successful.']);
  });
  await test('pauses are taken (and counted) when "short pauses" is on, and left out of the reported time', async () => {
    const p = fill(new Puzzle(9), EASY);
    const ui = fakeUi();
    await fullSolve({ puzzle: p, settings: settings({ doSleeps: true, reportDuration: true,
      method: METHOD.SIMPLE_PROMPT_BACKTRACK }), ui });
    assert.equal(ui.log.pauses, 51);                     // 51 empty squares in the easy puzzle
    assert.equal(p.pausesDuration, 51 * 200);
    assert.match(ui.log.messages[0], /^The puzzle has been successfully solved\.\n\nThat took -?\d+\.\d\d seconds, ignoring any pauses\.$/);
  });
  await test('"show digits being tried" shows attempts, and asks to confirm first', async () => {
    const p = fill(new Puzzle(9), HARDEST);
    const ui = fakeUi(true);
    await fullSolve({ puzzle: p, settings: settings({ method: METHOD.ONLY_BACKTRACK, showAttempts: true }), ui });
    assert.match(ui.log.confirms[0], /^Showing the attempted digits/);
    assert.ok(ui.log.ticks > 100);
    assert.ok(p.isSolved() && isValidSolution(p));
  });
  await test('declining the "show attempts" warning turns that setting off and still solves', async () => {
    const p = fill(new Puzzle(9), HARDEST);
    const ui = fakeUi(false);
    const s = settings({ method: METHOD.ONLY_BACKTRACK, showAttempts: true });
    await fullSolve({ puzzle: p, settings: s, ui });
    assert.equal(s.showAttempts, false);
    assert.equal(ui.log.ticks, 0);
    assert.ok(p.isSolved() && isValidSolution(p));
  });
  await test('solving a puzzle already completed just congratulates', async () => {
    const p = fill(new Puzzle(9), EASY_SOLUTION);
    const ui = fakeUi();
    await fullSolve({ puzzle: p, settings: settings(), ui });
    assert.deepEqual(ui.log.messages, ['The puzzle has been successfully solved.']);
  });
  await test('backtracker speed: the hardest sample puzzle takes well under a few seconds', () => {
    const p = fill(new Puzzle(9), HARDEST);
    const bt = new Backtrack(p);
    bt.setup();
    const t = Date.now();
    assert.equal(bt.solve(), true);
    console.log('         (took ' + (Date.now() - t) + ' ms)');
    assert.ok(Date.now() - t < 5000);
  });

  console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', SOME FAILED' : ''));
})();
