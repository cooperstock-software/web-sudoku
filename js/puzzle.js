/*
 * Puzzle model: the squares of one puzzle (9x9 or 6x6) and the rules for entering digits.
 * Ported from cell.pas (TCell) and the non-UI parts of SudokuBase.pas.
 *
 * No DOM in here: the same file runs in the browser, in Electron and under Node (for the tests).
 * Rows, columns, boxes and digits are all 1-based, like the Delphi source (index 0 is unused).
 */
(function (exports) {
  'use strict';

  /** The three solving strategies on the Options dialog (Delphi: Methods). */
  const METHOD = Object.freeze({
    SIMPLE_PROMPT_BACKTRACK: 1,
    SIMPLE_AUTO_BACKTRACK: 2,
    ONLY_BACKTRACK: 3,
  });

  // Convert a row and column number to a box number and box position - both values 1 to n.
  // 9x9: box 1 is the top-left 3x3, box 2 the top-centre, box 3 the top-right, box 4 the
  //      middle-left, etc. Box position is the sequential position 1-9 within the box.
  function rowColToBox9(row, col) {
    let rowPart = Math.floor((row + 2) / 3);   // 1, 2 or 3 for top, middle, bottom rows
    let colPart = Math.floor((col + 2) / 3);   // 1, 2 or 3 for left, middle, right columns
    const boxNum = (rowPart - 1) * 3 + colPart;
    rowPart = (((row - 1) % 3) + 1) * 3 - 2;   // 1, 4 or 7
    colPart = ((col - 1) % 3) + 1;             // 1, 2 or 3
    return { boxNum, boxPos: rowPart + (colPart - 1) };
  }

  // 6x6: boxes are 3 columns x 2 rows. Box 1 is top-left, box 2 is the 3 columns to the
  // right of that, box 3 is the left 3 columns and rows 3-4, etc.
  function rowColToBox6(row, col) {
    let rowPart = Math.floor((row + 1) / 2);   // 1, 2 or 3 for top, middle, bottom row pairs
    let colPart = Math.floor((col + 2) / 3);   // 1 or 2 for left or right 3 columns
    const boxNum = (rowPart - 1) * 2 + colPart;
    rowPart = (((row - 1) % 2) + 1) * 3 - 2;   // 1 or 4
    colPart = ((col - 1) % 3) + 1;             // 1, 2 or 3
    return { boxNum, boxPos: rowPart + (colPart - 1) };
  }

  /** One square of the puzzle (Delphi: TCell). */
  class Cell {
    constructor(puzzle, row, col, boxNum) {
      this.puzzle = puzzle;
      this.row = row;
      this.col = col;
      this.boxNum = boxNum;
      this.resultVisible = false;
      this.digitsVisible = false;
      this.isOriginal = true;   // is the result part of the original puzzle (shown bold)?
      this.resultText = '';
      // possible[d] is true if digit d is still a candidate here (shown bold); false if ruled out (italic)
      this.possible = new Array(puzzle.n + 1).fill(true);
    }

    /** Silver and white boxes alternate, like a chess board. */
    get isWhite() {
      return this.puzzle.n === 9 ? this.boxNum % 2 === 1 : [1, 4, 5].includes(this.boxNum);
    }

    // Flip the visibility of the 1..n digits to isVisible.
    // If changeOther, also flip the result digit to be NOT isVisible.
    changeDigitsVisibility(isVisible, changeOther) {
      this.digitsVisible = isVisible;
      if (changeOther) this.changeResultVisibility(!isVisible, false);
    }

    changeResultVisibility(isVisible, changeOther) {
      this.resultVisible = isVisible;
      if (this.digitsVisible === isVisible && changeOther) this.changeDigitsVisibility(!isVisible, false);
    }

    // Clear everything in this square, leaving both parts not visible, the
    // small digits possible, and the result original.
    clearAll() {
      if (this.digitsVisible) this.changeDigitsVisibility(false, false);
      if (this.resultVisible) this.changeResultVisibility(false, false);
      for (let i = 1; i <= this.puzzle.n; i++) this.possible[i] = true;
      this.isOriginal = true;
      this.resultText = '';
    }

    showDigits() { this.changeDigitsVisibility(true, true); }
    showResult() { this.changeResultVisibility(true, true); }

    setPossible(digit, possible) { this.possible[digit] = possible; }
    isPossible(digit) { return this.possible[digit]; }

    // Set the result to be displayed, with the value key ('' clears it).
    // isOriginal true means it's part of the original entered puzzle; false means it's solved.
    setResult(key, isOriginal) {
      if (!this.resultVisible) this.showResult();

      this.isOriginal = isOriginal && key.length > 0;
      this.resultText = key;

      if (key === '' && this.puzzle.isStarted) this.showDigits();

      if (key.length > 0) this.puzzle.bubbleResult(this.row, this.col, key);
    }

    // The value written to a save file for this square: three spaces if empty, the digit three
    // times if it's an original puzzle digit, or the digit surrounded by two spaces if solved.
    saveValue() {
      if (!this.resultVisible) return '   ';
      const s = this.resultText;
      return this.isOriginal ? s.repeat(3) : ' ' + s + ' ';
    }
  }

  /** One puzzle: n x n squares plus the play state (Delphi: the fields of TSudokuBaseForm). */
  class Puzzle {
    constructor(n) {
      if (n !== 9 && n !== 6) throw new Error('Puzzle size must be 9 or 6');
      this.n = n;
      const toBox = n === 9 ? rowColToBox9 : rowColToBox6;

      const grid = () => Array.from({ length: 10 }, () => new Array(10).fill(null));
      this.cells = grid();     // cells[row][col]
      this.columns = grid();   // columns[col][row]
      this.boxes = grid();     // boxes[boxNum][position within box]

      for (let row = 1; row <= n; row++) {
        for (let col = 1; col <= n; col++) {
          const { boxNum, boxPos } = toBox(row, col);
          const cell = new Cell(this, row, col, boxNum);
          this.cells[row][col] = cell;
          this.columns[col][row] = cell;
          this.boxes[boxNum][boxPos] = cell;
        }
      }

      this.clickedRow = 0;     // the highlighted square, 0 if none
      this.clickedCol = 0;
      this.isStarted = false;  // has Manual Play / Solve been pressed?
      this.pausesDuration = 0; // milliseconds spent pausing or waiting for the user
      this.saveFile = '';      // name of the last loaded / saved file
    }

    /** All squares, row by row. */
    *allCells() {
      for (let row = 1; row <= this.n; row++)
        for (let col = 1; col <= this.n; col++) yield this.cells[row][col];
    }

    /** The array (indexed [first][second]) for scanning rows, columns or boxes. */
    getArrayOfType(type) {
      return type === 'row' ? this.cells : type === 'column' ? this.columns : this.boxes;
    }

    get selectedCell() {
      return this.clickedRow > 0 && this.clickedCol > 0 ? this.cells[this.clickedRow][this.clickedCol] : null;
    }

    select(row, col) {
      this.clickedRow = row;
      this.clickedCol = col;
    }

    // After entering a valid result digit key in square row, col, bubble it out: remove it from
    // the digits that are considered possible in all other squares in its row, column and box.
    bubbleResult(row, col, key) {
      if (key === '') return;
      const digit = parseInt(key, 10);

      for (let i = 1; i <= this.n; i++)
        if (i !== col) this.cells[row][i].setPossible(digit, false);

      for (let i = 1; i <= this.n; i++)
        if (i !== row) this.cells[i][col].setPossible(digit, false);

      const boxNum = this.cells[row][col].boxNum;
      for (let i = 1; i <= this.n; i++) {
        const cell = this.boxes[boxNum][i];
        if (cell.row !== row && cell.col !== col) cell.setPossible(digit, false);
      }
    }

    /**
     * Check whether key is a valid result in the square row, col - i.e. it isn't already present
     * in that square's row, column or box. Returns null if it's allowed, otherwise the message to
     * show the person explaining why not. (Delphi: CheckAllowedResult, whose "verbose" flag
     * decided whether to show this message; callers here show it, or not.)
     */
    allowedProblem(row, col, key) {
      if (key === '') return null;   // clearing is always allowed

      const prefix = 'You cannot put a ' + key + ' in this square, because it already occurs in another ';

      for (let i = 1; i <= this.n; i++) {
        const cell = this.cells[row][i];
        if (i !== col && cell.resultVisible && cell.resultText === key)
          return prefix + 'square in the same row.';
      }

      for (let i = 1; i <= this.n; i++) {
        const cell = this.cells[i][col];
        if (i !== row && cell.resultVisible && cell.resultText === key)
          return prefix + 'square in the same column.';
      }

      const boxNum = this.cells[row][col].boxNum;
      for (let i = 1; i <= this.n; i++) {
        const cell = this.boxes[boxNum][i];
        if (cell.row !== row && cell.col !== col && cell.resultVisible && cell.resultText === key)
          return prefix + 'square in the same ' + (this.n === 9 ? '3 x 3' : '3 x 2') + ' box.';
      }

      return null;
    }

    /** True if no squares of the puzzle have anything in them. */
    isClear() {
      for (const cell of this.allCells()) if (cell.resultVisible) return false;
      return true;
    }

    /** True if every square has a result digit. */
    isSolved() {
      for (const cell of this.allCells())
        if (!(cell.resultVisible && cell.resultText.length > 0)) return false;
      return true;
    }

    /** Clear the whole puzzle back to nothing in it and no selected square. */
    clearAll() {
      for (const cell of this.allCells()) cell.clearAll();
      this.clickedRow = 0;
      this.clickedCol = 0;
      this.isStarted = false;
      this.pausesDuration = 0;
    }

    // Prepare for solving by re-bubbling all results in squares across their rows, down their
    // columns, and in their boxes. Squares without a result are reset to show all digits.
    prepareForSolve() {
      for (const cell of this.allCells()) {
        if (!(cell.resultVisible && cell.resultText.length > 0)) {
          cell.clearAll();
          cell.showDigits();
        }
      }

      for (const cell of this.allCells())
        if (cell.resultVisible && cell.resultText.length > 0)
          this.bubbleResult(cell.row, cell.col, cell.resultText);
    }

    /** The Manual Play button: show the small digits in every square that has no result yet. */
    manualPlay() {
      for (const cell of this.allCells())
        if (!(cell.resultVisible || cell.digitsVisible)) cell.showDigits();

      this.prepareForSolve();   // re-bubble all of the results
      this.isStarted = true;
    }

    /**
     * Remove the result from a square (the Delete / Backspace keys). Before play starts the square
     * just goes blank. During play it goes back to showing small digits, and the digit it held
     * becomes possible again in any square it no longer conflicts with.
     */
    clearResult(row, col) {
      const cell = this.cells[row][col];
      const digit = cell.resultText;
      cell.clearAll();
      if (!this.isStarted) return;

      cell.showDigits();
      for (let i = 1; i <= this.n; i++)
        if (this.allowedProblem(row, col, String(i)) !== null) cell.setPossible(i, false);

      const d = parseInt(digit, 10);
      const restore = (other) => {
        if (other !== cell && other.digitsVisible && !other.possible[d] &&
            this.allowedProblem(other.row, other.col, digit) === null)
          other.setPossible(d, true);
      };
      for (let i = 1; i <= this.n; i++) {
        restore(this.cells[row][i]);
        restore(this.cells[i][col]);
        restore(this.boxes[cell.boxNum][i]);
      }
    }

    /** The text of a .sud save file (same format as the Delphi / C# programs). */
    toSaveText() {
      const border = '+' + '---+'.repeat(this.n);
      let s = '';
      for (let row = 1; row <= this.n; row++) {
        s += border + '\n';
        for (let col = 1; col <= this.n; col++) s += '|' + this.cells[row][col].saveValue();
        s += '|\n';
      }
      return s + border + '\n';
    }

    /**
     * Clear the puzzle and fill it from the text of a .sud file.
     * Returns null on success, or a message describing what went wrong.
     */
    loadFromText(text) {
      this.clearAll();

      const lines = text.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();   // no phantom last line

      let first = true;
      for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
        if (lineNo % 2 === 1) continue;   // skip alternate (border) lines
        const line = lines[lineNo - 1];
        const row = lineNo / 2;

        // Check it is for the right size puzzle - line lengths are either 4 x n, or one higher
        if (first) {
          first = false;
          let lineLen = line.length;
          if (lineLen % 2 === 1) lineLen--;
          const numCells = Math.floor(lineLen / 4);
          if (numCells !== this.n)
            return 'This appears to be a file saved from a ' + numCells + ' x ' + numCells + ' Sudoku, ' +
                   'rather than a ' + this.n + ' x ' + this.n + ' one.\n\nIt cannot be loaded into this puzzle';
        }

        if (row > this.n) return 'The file has more rows than a ' + this.n + ' x ' + this.n + ' puzzle.';

        for (let col = 1; col <= this.n; col++) {
          if (col * 4 > line.length) return 'Line ' + lineNo + ' is too short.';
          const s = line.substr(col * 4 - 3, 3);
          const digit = s[1];
          if (digit === ' ') continue;   // nothing in this square
          if (digit < '1' || digit > String(this.n)) return 'Line ' + lineNo + ' has an invalid digit "' + digit + '".';
          this.cells[row][col].setResult(digit, s[0] !== ' ');
        }
      }
      return null;
    }
  }

  exports.METHOD = METHOD;
  exports.Cell = Cell;
  exports.Puzzle = Puzzle;
  exports.rowColToBox9 = rowColToBox9;
  exports.rowColToBox6 = rowColToBox6;
})(typeof module !== 'undefined' && module.exports ? module.exports : (globalThis.Sudoku = globalThis.Sudoku || {}));
