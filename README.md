# Sudoku – browser and Electron version

One web app that runs both in an ordinary browser and as an Electron desktop app. It is a port of
your updated C# project (`SudokuClaude`): the same 9x9 and 6x6 windows at the same pixel layout, the
same rules, messages and solving methods (simple rules, simple + backtracking, backtracking only),
and the same `.sud` file format, so files saved by the C# or Delphi programs load here and vice versa.

There is no build step and nothing to install for the browser version.

## Run in a browser

Open `index.html` (double-click it, or drag it onto a browser window). That's it.
Or serve the folder, e.g. `python3 -m http.server` and visit http://localhost:8000.

## Run as an Electron app

```
npm install
npm start
```

Package it (Windows portable .exe, macOS app, Linux AppImage) with `npm run dist`; the results go in `dist/`.

## Tests

```
npm test
```

runs the logic tests (`test/run-tests.js`, plain Node, no dependencies): square/box geometry,
the "you cannot put a N in this square" messages, Delete/Backspace, save/load round trips, and
solving easy, hard and very hard puzzles with all three methods, for both sizes.

## How to use it

Same as the Windows version:

| Do this | To |
|---|---|
| Click a square, type 1–9 (1–6) | Enter a digit. Before Manual Play / Solve it is an original (bold) digit |
| Delete or Backspace | Clear the square (original digits are protected once play has started) |
| Arrow keys, Tab / Shift+Tab, Home, End, PgUp, PgDn | Move the selection |
| Single-click a small digit | Toggle it between possible (bold) and ruled out (italic) |
| Double-click a small digit | Make it the answer for that square |
| Double-click a solved (non-bold) answer | Go back to the small digits |
| Alt + underlined letter | Press that button (Alt+M Manual Play, Alt+S Solve, Alt+L Load, Alt+A Save, Alt+C Clear, Alt+W Switch, Alt+O Options, Alt+H Help) |

You can also drop a `.sud` file onto the window to load it. The window scales to fit.

## What differs from the C# version

* **No C DLL.** The backtracking is the bitmask version in JavaScript (`js/solver.js`); on a hard
  puzzle it takes a fraction of a second. The `Backtrack_C` / `BacktrackBase` split isn't needed.
* **Load / Save use the browser's file dialogs.** Chromium-based browsers and Electron show a real
  Save As dialog; browsers without the File System Access API download the file instead. A browser
  can't know a file's folder, so the name (not the path) is remembered for the next Save.
* **Settings** (the Options dialog) are kept in the browser's local storage instead of `sudoku.ini`.
* **Delete / Backspace** during play puts the small digits back and re-allows the removed digit in
  squares it no longer conflicts with. (The C# version's `SetResult("")` left an empty result showing
  and the old digit still struck out in other squares.)
* A double-click on a small digit leaves its possible/impossible state unchanged, as in Delphi
  (the browser delivers click, click, dblclick, so no replay trick is needed).
* The unused "Stepping" mode is omitted.
* Message boxes are in-page dialogs: Enter / Esc, and Y / N for the Yes/No ones.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css` | The page and its look |
| `js/puzzle.js` | The model: squares, rows/columns/boxes, rules, save/load text (no DOM) |
| `js/solver.js` | Simple solving rules, backtracking, and the Solve button flow (no DOM) |
| `js/ui.js` | Windows, mouse/keyboard, dialogs, Save/Load, Options |
| `main.js`, `package.json` | Electron shell |
| `sudoku.pdf` | The Help file |
| `icon.png`, `icon-256.png`, `sudoku.ico` | Icons |
