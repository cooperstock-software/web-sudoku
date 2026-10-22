/*
 * The solving logic: the two "simple" rules, the backtracking solver, and the Solve button flow.
 * Ported from the solving methods of SudokuBase.pas and from Backtrack.pas (the bitmask version
 * in the C# project).
 *
 * Everything the solver needs from the outside world is passed in as `ctx`:
 *   ctx.puzzle    the Puzzle being solved
 *   ctx.settings  { method, doSleeps, reportDuration, showAttempts }  (may be changed while solving,
 *                 as in the Delphi program)
 *   ctx.ui        { render(), message(text), confirm(text), pause(ms), tick(), now() }
 *                 message / confirm / pause / tick return promises. In the browser they show dialogs,
 *                 wait on timers and repaint; the tests pass in simple stand-ins.
 */
(function (exports) {
  'use strict';

  const { METHOD } = typeof require === 'function' ? require('./puzzle.js') : globalThis.Sudoku;

  // ---------------------------------------------------------------------------------------------
  // The simple solving rules
  // ---------------------------------------------------------------------------------------------

  // Short pause so the person can follow along (the "short pauses" option). The time spent doesn't
  // count towards the reported solving time.
  async function pauseAfterSolving(ctx) {
    if (!ctx.settings.doSleeps) return;
    const ms = 200;
    await ctx.ui.pause(ms);
    ctx.puzzle.pausesDuration += ms;
  }

  // Put digit into a square, highlighting it, and let the person see that.
  async function solveSquare(ctx, cell, digit) {
    ctx.puzzle.select(cell.row, cell.col);
    cell.setResult(String(digit), false);
    ctx.ui.render();
    await pauseAfterSolving(ctx);
  }

  // Work through row/column/box number firstIndex of arr, looking for an unsolved square where
  // the digit only occurs in one of the squares, and if found, solve it.
  // Returns whether or not anything was solved.
  async function solveRowColBox(ctx, arr, firstIndex, digit) {
    const n = ctx.puzzle.n;
    let numOccurrences = 0;
    let occurrenceIndex = 0;

    for (let secondIndex = 1; secondIndex <= n; secondIndex++) {
      const cell = arr[firstIndex][secondIndex];
      if (!cell.digitsVisible) continue;
      if (cell.isPossible(digit)) {
        numOccurrences++;
        if (numOccurrences > 1) break;
        occurrenceIndex = secondIndex;
      }
    }

    if (numOccurrences === 1) {
      await solveSquare(ctx, arr[firstIndex][occurrenceIndex], digit);
      return true;
    }
    return false;
  }

  // For all rows, all columns, and all boxes, look for an unsolved digit in that
  // row/column/box that only occurs once, and solve it. Returns whether any were solved.
  async function solveRowsColsBoxes(ctx) {
    const n = ctx.puzzle.n;
    let solvedAny = false;

    for (const type of ['row', 'column', 'box']) {
      const arr = ctx.puzzle.getArrayOfType(type);
      for (let firstIndex = 1; firstIndex <= n; firstIndex++)
        for (let digit = 1; digit <= n; digit++)
          if (await solveRowColBox(ctx, arr, firstIndex, digit)) solvedAny = true;
    }
    return solvedAny;
  }

  // Solve any squares showing the small digits where only one of those digits is possible.
  // Also reports nonePossible if it hits a square with no possible digits (can occur when the
  // person has marked the wrong ones). Returns { solvedOne, nonePossible }.
  async function solveSingletonSquares(ctx) {
    const n = ctx.puzzle.n;
    let solvedOne = false;

    for (const cell of ctx.puzzle.allCells()) {
      if (!cell.digitsVisible) continue;

      let numVisible = 0;
      let visibleOne = 0;
      for (let i = 1; i <= n; i++) {
        if (cell.isPossible(i)) {
          numVisible++;
          if (numVisible > 1) break;
          visibleOne = i;
        }
      }

      if (numVisible === 1) {
        await solveSquare(ctx, cell, visibleOne);
        solvedOne = true;
      } else if (numVisible === 0) {
        return { solvedOne: false, nonePossible: true };
      }
    }
    return { solvedOne, nonePossible: false };
  }

  // Do the two regular solving steps in a loop, until nothing further can be done.
  // Returns { done, nonePossible }.
  async function mainSolveSteps(ctx) {
    let solvedSomething;
    let done;
    let nonePossible;

    do {
      const singles = await solveSingletonSquares(ctx);
      solvedSomething = singles.solvedOne;
      nonePossible = singles.nonePossible;
      done = ctx.puzzle.isSolved();
      if (done || nonePossible) break;

      if (await solveRowsColsBoxes(ctx)) solvedSomething = true;
      done = ctx.puzzle.isSolved();
      if (done || nonePossible) break;
    } while (solvedSomething);

    return { done, nonePossible };
  }

  // ---------------------------------------------------------------------------------------------
  // Backtracking
  // ---------------------------------------------------------------------------------------------

  /**
   * Recursive backtracking over the squares still empty (Delphi: TBacktrack).
   *
   * rowMasks[i] is a bitmask for row i: bit (d-1) is 1 if digit d already appears in that row.
   * colMasks and boxMasks work the same way for columns and boxes.
   */
  class Backtrack {
    constructor(puzzle) {
      this.puzzle = puzzle;
      this.n = puzzle.n;
      this.board = Array.from({ length: 10 }, () => new Array(10).fill(0));   // 0 for no value
      this.rowMasks = new Array(10).fill(0);
      this.colMasks = new Array(10).fill(0);
      this.boxMasks = new Array(10).fill(0);
    }

    // Set up the Board array of current values from the puzzle, and the masks from that.
    setup() {
      const { puzzle, n, board } = this;
      this.rowMasks.fill(0);
      this.colMasks.fill(0);
      this.boxMasks.fill(0);

      for (const cell of puzzle.allCells()) {
        board[cell.row][cell.col] = 0;
        if (cell.resultVisible && cell.resultText.length > 0) {
          const digit = parseInt(cell.resultText, 10);
          board[cell.row][cell.col] = digit;
          const b = 1 << (digit - 1);
          this.rowMasks[cell.row] |= b;
          this.colMasks[cell.col] |= b;
          this.boxMasks[cell.boxNum] |= b;
        }
      }
      return n;
    }

    // Find the next empty square. Returns [row, col], or null if there isn't one.
    findEmpty() {
      for (let row = 1; row <= this.n; row++)
        for (let col = 1; col <= this.n; col++)
          if (this.board[row][col] === 0) return [row, col];
      return null;
    }

    // Fast version: no display of the digits being tried. Returns true for success.
    solve() {
      const empty = this.findEmpty();
      if (!empty) return true;   // solved

      const [row, col] = empty;
      const box = this.puzzle.cells[row][col].boxNum;

      for (let digit = 1; digit <= this.n; digit++) {
        const b = 1 << (digit - 1);
        if ((this.rowMasks[row] & b) === 0 && (this.colMasks[col] & b) === 0 && (this.boxMasks[box] & b) === 0) {
          this.board[row][col] = digit;
          this.rowMasks[row] |= b;
          this.colMasks[col] |= b;
          this.boxMasks[box] |= b;

          if (this.solve()) return true;

          this.board[row][col] = 0;   // undo
          this.rowMasks[row] &= ~b;
          this.colMasks[col] &= ~b;
          this.boxMasks[box] &= ~b;
        }
      }
      return false;
    }

    // Slow version that shows each digit as it is tried (the "show digits being tried" option).
    async solveShowing(ctx) {
      const empty = this.findEmpty();
      if (!empty) return true;

      const [row, col] = empty;
      const cell = this.puzzle.cells[row][col];
      const box = cell.boxNum;

      for (let digit = 1; digit <= this.n; digit++) {
        const b = 1 << (digit - 1);
        if ((this.rowMasks[row] & b) === 0 && (this.colMasks[col] & b) === 0 && (this.boxMasks[box] & b) === 0) {
          this.board[row][col] = digit;
          cell.setResult(String(digit), false);
          await ctx.ui.tick();   // repaint, and let the browser breathe

          this.rowMasks[row] |= b;
          this.colMasks[col] |= b;
          this.boxMasks[box] |= b;

          if (await this.solveShowing(ctx)) return true;

          this.board[row][col] = 0;   // undo
          cell.setResult('', false);
          await ctx.ui.tick();
          this.rowMasks[row] &= ~b;
          this.colMasks[col] &= ~b;
          this.boxMasks[box] &= ~b;
        }
      }
      return false;
    }

    // Transfer results back to the puzzle from the solved board.
    transferBack() {
      for (const cell of this.puzzle.allCells())
        if (!cell.resultVisible) cell.setResult(String(this.board[cell.row][cell.col]), false);
    }

    // Set up and do the backtracking, and put the results back into the puzzle.
    // Returns true for complete, false (after showing a message) for failure.
    async doAll(ctx) {
      this.setup();

      const ok = ctx.settings.showAttempts ? await this.solveShowing(ctx) : this.solve();
      if (!ok) {
        ctx.ui.render();
        await ctx.ui.message('The backtracking method was not successful.');
        return false;
      }

      this.transferBack();
      ctx.ui.render();
      return true;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The Solve button
  // ---------------------------------------------------------------------------------------------

  // Follow a bunch of steps to solve the puzzle.
  async function fullSolve(ctx) {
    const { puzzle, settings, ui } = ctx;
    const startTime = ui.now();

    puzzle.prepareForSolve();
    ui.render();

    let done = false;
    if (settings.method !== METHOD.ONLY_BACKTRACK) done = (await mainSolveSteps(ctx)).done;

    if (!done) {
      let backtrack = settings.method !== METHOD.SIMPLE_PROMPT_BACKTRACK;
      if (!backtrack) {
        const t = ui.now();
        backtrack = await ui.confirm(
          'Sorry, the simple solving rules in this program were not able to completely solve the puzzle.\n\n' +
          'Would you like to have the program use its backtracking approach of trying all remaining possibilities?');
        puzzle.pausesDuration += ui.now() - t;
      }

      if (backtrack) {
        if (settings.showAttempts) {
          const t = ui.now();
          if (!(await ui.confirm(
            'Showing the attempted digits when using the code for the backtracking ' +
            'approach can make solving it extremely slow!\n\n' +
            'Are you sure you want to show the attempted digits?')))
            settings.showAttempts = false;
          puzzle.pausesDuration += ui.now() - t;
        }

        await new Backtrack(puzzle).doAll(ctx);
      } else {
        await ui.message('You can try solving the rest of it manually.');
        settings.reportDuration = false;
      }
    }

    ui.render();
    if (puzzle.isSolved()) {
      const duration = ui.now() - startTime - puzzle.pausesDuration;
      let message = 'The puzzle has been successfully solved.';
      if (settings.reportDuration) {
        message += '\n\nThat took ' + (duration / 1000).toFixed(2) + ' seconds';
        if (puzzle.pausesDuration > 0) message += ', ignoring any pauses';
        message += '.';
      }
      await ui.message(message);
    }
  }

  exports.fullSolve = fullSolve;
  exports.mainSolveSteps = mainSolveSteps;
  exports.solveSingletonSquares = solveSingletonSquares;
  exports.solveRowsColsBoxes = solveRowsColsBoxes;
  exports.Backtrack = Backtrack;
})(typeof module !== 'undefined' && module.exports ? module.exports : (globalThis.Sudoku = globalThis.Sudoku || {}));
