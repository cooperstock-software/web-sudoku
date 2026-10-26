/*
 * The user interface: builds the 9x9 and 6x6 windows at the same pixel positions as the Delphi /
 * C# forms, draws the puzzle model into them, and handles mouse, keyboard, dialogs, and Save / Load.
 * (Delphi: the event handlers of SudokuBase.pas, cell.pas and Options.pas.)
 *
 * Runs unchanged in a browser and inside Electron. No DOM access happens in puzzle.js or solver.js.
 */
(function () {
  'use strict';

  const { Puzzle, METHOD, fullSolve } = globalThis.Sudoku;

  // ---------------------------------------------------------------------------------------------
  // Settings (Delphi: Globals + sudoku.ini; here kept in the browser's localStorage)
  // ---------------------------------------------------------------------------------------------

  const SETTINGS_KEY = 'sudoku.settings';

  const settings = {
    method: METHOD.SIMPLE_PROMPT_BACKTRACK,
    showSmallDigits: true,
    doSleeps: true,
    reportDuration: false,
    showAttempts: false,
  };

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if ([1, 2, 3].includes(saved.method)) settings.method = saved.method;
      for (const key of ['showSmallDigits', 'doSleeps', 'reportDuration', 'showAttempts'])
        if (typeof saved[key] === 'boolean') settings[key] = saved[key];
    } catch (e) { /* no storage, or unreadable: keep the defaults */ }
  }

  function writeSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* storage unavailable: settings last until the page closes */ }
  }

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------

  function el(tag, className, parent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function place(e, left, top, width, height) {
    e.style.left = left + 'px';
    e.style.top = top + 'px';
    if (width !== undefined) e.style.width = width + 'px';
    if (height !== undefined) e.style.height = height + 'px';
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // "&Save" -> "<u>S</u>ave": the Windows accelerator-key notation used in the original forms.
  // Returns { html, key } where key is the accelerator letter, lower case.
  function accel(text) {
    const i = text.indexOf('&');
    if (i < 0) return { html: escapeHtml(text), key: '' };
    return {
      html: escapeHtml(text.slice(0, i)) + '<u>' + escapeHtml(text[i + 1]) + '</u>' + escapeHtml(text.slice(i + 2)),
      key: text[i + 1].toLowerCase(),
    };
  }

  let audioContext = null;
  function beep() {
    try {
      audioContext = audioContext || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.09);
    } catch (e) { /* no audio: silently do nothing */ }
  }

  // ---------------------------------------------------------------------------------------------
  // Dialogs: message boxes and the Options dialog, shown over the puzzle
  // ---------------------------------------------------------------------------------------------

  const overlay = document.getElementById('overlay');
  let dialogKeyHandler = null;   // set while a dialog is open

  // Shrink a dialog (never enlarge) so that it fits in a small window.
  function fitDialog(dlg) {
    const wrapper = dlg.parentElement;
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    const s = Math.min(1, (window.innerWidth - 16) / w, (window.innerHeight - 16) / h);
    if (s < 1) {
      dlg.style.position = 'absolute';
      dlg.style.left = '0';
      dlg.style.top = '0';
      dlg.style.transform = 'scale(' + s + ')';
      wrapper.style.width = Math.floor(w * s) + 'px';
      wrapper.style.height = Math.floor(h * s) + 'px';
      wrapper.style.position = 'relative';
    }
  }

  // Show a dialog. build(dlg, finish) fills in the dialog, and returns a key handler
  // (or nothing). Resolves with whatever value is passed to finish().
  function showDialog(build) {
    return new Promise((resolve) => {
      overlay.textContent = '';
      const wrapper = el('div', 'dlgwrap', overlay);
      const dlg = el('div', 'dlg', wrapper);
      const finish = (value) => {
        dialogKeyHandler = null;
        overlay.hidden = true;
        overlay.textContent = '';
        resolve(value);
      };
      dialogKeyHandler = build(dlg, finish) || null;
      overlay.hidden = false;   // (an element can only take focus once it is displayed)
      fitDialog(dlg);
      if (dlg.focusTarget) dlg.focusTarget.focus();
    });
  }

  // Delphi: ShowMessage(text) and MessageDlg(text, mtConfirmation, [mbYes, mbNo], 0) = mrYes
  function messageBox(text, yesNo) {
    return showDialog((dlg, finish) => {
      dlg.classList.add('msgbox');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      el('div', 'title', dlg).textContent = 'Sudoku';
      el('div', 'body', dlg).textContent = text;
      const buttons = el('div', 'buttons', dlg);

      let yes;
      if (yesNo) {
        yes = el('button', 'btn default', buttons);
        yes.innerHTML = '<u>Y</u>es';
        yes.onclick = () => finish(true);
        const no = el('button', 'btn', buttons);
        no.innerHTML = '<u>N</u>o';
        no.onclick = () => finish(false);
      } else {
        yes = el('button', 'btn default', buttons);
        yes.textContent = 'OK';
        yes.onclick = () => finish(true);
      }
      dlg.focusTarget = yes;

      return (e) => {
        const k = e.key.toLowerCase();
        if (yesNo) {
          if (k === 'y') { finish(true); return true; }
          if (k === 'n' || k === 'escape') { finish(false); return true; }
        } else if (k === 'escape') { finish(true); return true; }
        return false;   // Enter / Space act on the focused button
      };
    });
  }

  const showMessage = (text) => messageBox(text, false);
  const confirmBox = (text) => messageBox(text, true);

  // The Options dialog (Delphi: Options.dfm). Resolves true if saved.
  function showOptions() {
    return showDialog((dlg, finish) => {
      dlg.classList.add('optdlg');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      el('div', 'title', dlg).textContent = 'Options';
      const form = el('div', 'optform', dlg);
      const accelerators = {};   // letter -> function to run

      const addOption = (parent, type, name, text, left, top, checked) => {
        const label = el('label', 'opt', parent);
        place(label, left, top, undefined, 26);
        const input = el('input', '', label);
        input.type = type;
        input.name = name;
        input.checked = checked;
        const span = el('span', '', label);
        const a = accel(text);
        span.innerHTML = a.html;
        accelerators[a.key] = () => {
          input.focus();
          if (type === 'radio') input.checked = true; else input.checked = !input.checked;
        };
        return input;
      };

      const sleeps = addOption(form, 'checkbox', 'sleeps', '&Do short pauses after solving squares', 20, 18, settings.doSleeps);
      const report = addOption(form, 'checkbox', 'report', '&Report the time taken to solve the puzzle, ignoring pauses', 20, 46, settings.reportDuration);
      const small = addOption(form, 'checkbox', 'small', 'S&how small helper digits in each square during Manual Play or Simple Solving', 20, 74, settings.showSmallDigits);

      const group = el('fieldset', '', form);
      place(group, 12, 114, 619, 114);
      el('legend', '', group).textContent = 'Solving Method to Use';
      const methods = [
        addOption(group, 'radio', 'method', 'S&imple solving rules, plus prompt to use fast backtracking approach if needed', 12, 5, settings.method === 1),
        addOption(group, 'radio', 'method', 'Si&mple solving rules, automatically use fast backtracking approach if needed', 12, 32, settings.method === 2),
        addOption(group, 'radio', 'method', '&Only use fast backtracking approach', 12, 59, settings.method === 3),
      ];

      const attempts = addOption(form, 'checkbox', 'attempts', 'In fast backtracking &approach, show digits being tried', 20, 234, settings.showAttempts);

      const save = () => {
        settings.doSleeps = sleeps.checked;
        settings.reportDuration = report.checked;
        settings.showSmallDigits = small.checked;
        settings.showAttempts = attempts.checked;
        settings.method = methods.findIndex((m) => m.checked) + 1 || METHOD.SIMPLE_PROMPT_BACKTRACK;
        writeSettings();
        finish(true);
      };

      const saveButton = el('button', 'btn default', form);
      saveButton.innerHTML = accel('&Save').html;
      place(saveButton, 20, 275, 75, 28);
      saveButton.onclick = save;
      accelerators.s = save;

      const cancelButton = el('button', 'btn', form);
      cancelButton.innerHTML = accel('&Cancel').html;
      place(cancelButton, 128, 275, 75, 28);
      cancelButton.onclick = () => finish(false);
      accelerators.c = () => finish(false);

      dlg.focusTarget = methods[settings.method - 1];

      return (e) => {
        const k = e.key.toLowerCase();
        if (k === 'escape') { finish(false); return true; }
        if (k === 'enter' && document.activeElement !== cancelButton) { save(); return true; }
        if (e.altKey && accelerators[k]) { accelerators[k](); return true; }
        return false;
      };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // One puzzle window: 9x9 or 6x6
  // ---------------------------------------------------------------------------------------------

  // Left position of each column (and top of each row in the 9x9), and the 6x6's row tops - 1-based
  const POSITIONS = [0, 10, 76, 142, 209, 275, 341, 408, 474, 540];
  const Y_POSITIONS_6 = [0, 10, 76, 143, 209, 276, 342];

  // Position of each small digit within a square: [left, top]; the 6x6's second row is a bit lower.
  const DIGIT_LEFT = [0, 4, 26, 47, 3, 25, 46, 3, 25, 46];
  const DIGIT_TOP_9 = [0, 2, 2, 2, 22, 22, 22, 41, 41, 41];
  const DIGIT_TOP_6 = [0, 2, 2, 2, 35, 35, 35];

  // Window and control geometry from the .dfm / designer files: [left, top, width, height]
  const LAYOUTS = {
    9: {
      title: 'Sudoku', width: 615, height: 716, shape: 599, other: 'Switch to 6x6 Sudoku',
      buttons: {
        manual: [9, 628, 98, 30], solve: [122, 628, 94, 30], load: [285, 628, 92, 30], save: [397, 628, 92, 30],
        clear: [9, 672, 98, 30], options: [122, 672, 94, 30], switch: [285, 672, 206, 30], help: [512, 627, 94, 31],
      },
    },
    6: {
      title: 'Sudoku 6x6', width: 423, height: 571, shape: 402, other: 'Switch to 9x9 Sudoku',
      buttons: {
        manual: [9, 439, 98, 32], solve: [122, 439, 94, 32], load: [9, 479, 92, 32], save: [122, 479, 92, 30],
        clear: [316, 439, 94, 30], options: [316, 478, 94, 30], switch: [9, 527, 206, 30], help: [319, 530, 94, 31],
      },
    },
  };

  const BUTTON_TEXT = {
    manual: '&Manual Play', solve: '&Solve', load: '&Load', save: 'S&ave',
    clear: '&Clear', options: '&Options', switch: 'S&witch to {other}', help: '&Help',
  };

  const SELECTED_COLOR = '#c0dcc0';

  class PuzzleWindow {
    constructor(n, app) {
      this.n = n;
      this.app = app;
      this.puzzle = new Puzzle(n);
      const layout = LAYOUTS[n];
      this.layout = layout;

      // scaler (sized to the scaled window) > form (fixed pixel size, scaled with a transform)
      this.scaler = el('div', 'scaler');
      this.form = el('div', 'form', this.scaler);
      this.form.style.width = layout.width + 'px';
      this.form.style.height = layout.height + 'px';

      const shape = el('div', 'shape', this.form);
      place(shape, 8, 8, layout.shape, layout.shape);

      // the squares
      this.views = [];
      for (const cell of this.puzzle.allCells()) this.views.push(this.makeCellView(cell));

      // the buttons
      this.buttons = {};
      this.accelerators = {};
      for (const name of Object.keys(layout.buttons)) {
        const b = el('button', 'btn', this.form);
        b.type = 'button';
        const text = BUTTON_TEXT[name].replace('{other}', n === 9 ? '6x6 Sudoku' : '9x9 Sudoku');
        const a = accel(text);
        b.innerHTML = a.html;
        b.dataset.action = name;
        place(b, ...layout.buttons[name]);
        this.buttons[name] = b;
        this.accelerators[a.key] = b;
      }

      this.form.addEventListener('click', (e) => this.onClick(e));
      this.form.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    }

    makeCellView(cell) {
      const n = this.n;
      const root = el('div', 'cell', this.form);
      root.dataset.row = cell.row;
      root.dataset.col = cell.col;
      place(root, POSITIONS[cell.col], n === 9 ? POSITIONS[cell.row] : Y_POSITIONS_6[cell.row]);

      const digitTops = n === 9 ? DIGIT_TOP_9 : DIGIT_TOP_6;
      const digits = [null];
      for (let i = 1; i <= n; i++) {
        const d = el('div', 'd', root);
        d.textContent = String(i);
        d.dataset.digit = i;
        place(d, DIGIT_LEFT[i], digitTops[i]);
        digits.push(d);
      }
      const result = el('div', 'result', root);
      return { cell, root, digits, result, signature: '' };
    }

    // Bring the display in line with the model. Only squares that changed touch the DOM.
    render() {
      const p = this.puzzle;
      for (const v of this.views) {
        const c = v.cell;
        const selected = c.row === p.clickedRow && c.col === p.clickedCol;
        const showDigits = c.digitsVisible && settings.showSmallDigits;
        let sig = (selected ? 'S' : '-') + (c.resultVisible ? 'R' + (c.isOriginal ? 'o' : 's') + c.resultText : '-') +
                  (showDigits ? 'D' : '-');
        if (showDigits) for (let i = 1; i <= this.n; i++) sig += c.possible[i] ? 'p' : 'i';
        if (sig === v.signature) continue;
        v.signature = sig;

        v.root.style.background = selected ? SELECTED_COLOR : c.isWhite ? '#ffffff' : '#c0c0c0';
        v.result.style.display = c.resultVisible ? '' : 'none';
        v.result.textContent = c.resultVisible ? c.resultText : '';
        v.result.classList.toggle('orig', c.isOriginal);
        for (let i = 1; i <= this.n; i++) {
          const d = v.digits[i];
          d.style.display = showDigits ? '' : 'none';
          d.classList.toggle('imp', !c.possible[i]);
        }
      }
    }

    // ---- mouse (Delphi: the OnClick / OnDblClick handlers in cell.pas) ----

    cellOf(target) {
      const root = target.closest('.cell');
      return root ? this.puzzle.cells[+root.dataset.row][+root.dataset.col] : null;
    }

    onClick(e) {
      if (this.app.busy) return;
      const cell = this.cellOf(e.target);
      if (!cell) return;
      const small = e.target.closest('.d');

      if (small) {
        const digit = +small.dataset.digit;
        if (e.detail >= 2) {
          // The second click of a double-click: put the digit's state back as it was before the
          // first click, since the double-click means something else (see onDoubleClick).
          if (this.toggledDigit === digit && this.toggledCell === cell) cell.setPossible(digit, this.wasPossible);
          this.toggledDigit = 0;
        } else {
          // Single click on a small digit: if it's possible make it not possible, and if it's not
          // possible make it possible (if it's allowed!).
          const possible = cell.isPossible(digit);
          this.toggledDigit = 0;
          const problem = possible ? null : this.puzzle.allowedProblem(cell.row, cell.col, String(digit));
          if (problem === null) {
            this.toggledCell = cell;
            this.toggledDigit = digit;
            this.wasPossible = possible;
            cell.setPossible(digit, !possible);
          } else {
            this.select(cell);
            this.render();
            this.app.showMessage(problem);
            return;
          }
        }
      }

      this.select(cell);
      this.render();
    }

    onDoubleClick(e) {
      if (this.app.busy) return;
      const cell = this.cellOf(e.target);
      if (!cell) return;

      if (e.target.closest('.d')) {
        // Double-click on a small digit: if it's allowed, make it the (solved) result.
        const digit = e.target.closest('.d').dataset.digit;
        const problem = this.puzzle.allowedProblem(cell.row, cell.col, digit);
        if (problem === null) {
          cell.setResult(digit, false);
          this.select(cell);
          this.render();
          if (this.puzzle.isSolved()) this.app.showMessage('You have solved the puzzle!');
          return;
        }
        this.select(cell);
        this.render();
        this.app.showMessage(problem);
      } else if (e.target.closest('.result') && cell.resultVisible && !cell.isOriginal) {
        // Double-click on a solved (not bold) result: go back to the small digits, showing
        // as not possible any that can't go in this square.
        cell.resultText = '';
        cell.showDigits();
        for (let i = 1; i <= this.n; i++)
          if (cell.isPossible(i) && this.puzzle.allowedProblem(cell.row, cell.col, String(i)) !== null)
            cell.setPossible(i, false);
        this.render();
      }
    }

    select(cell) {
      this.puzzle.select(cell.row, cell.col);
    }

    // ---- keyboard (Delphi: OnShortCut and OnKeyPress of the form) ----

    // Returns true if the key was used.
    onKey(e) {
      const p = this.puzzle;
      const n = this.n;
      const key = e.key;

      const navigation = ['Tab', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'End', 'Home'];
      if (navigation.includes(key)) {
        // The first press just selects the top left square
        if (!p.selectedCell) { p.select(1, 1); this.render(); return true; }

        let row = p.clickedRow;
        let col = p.clickedCol;
        let ok = true;
        switch (key) {
          case 'Tab':
            if (!e.shiftKey) {
              if (++col > n) { col = 1; if (++row > n) row = 1; }
            } else if (--col < 1) {
              col = n;
              if (--row < 1) row = n;
            }
            break;
          case 'ArrowDown': if (row < n) row++; else ok = false; break;
          case 'ArrowUp': if (row > 1) row--; else ok = false; break;
          case 'ArrowRight': if (col < n) col++; else ok = false; break;
          case 'ArrowLeft': if (col > 1) col--; else ok = false; break;
          case 'PageDown': row = n; break;
          case 'PageUp': row = 1; break;
          case 'End': col = n; break;
          case 'Home': col = 1; break;
        }
        if (ok) { p.select(row, col); this.render(); } else beep();
        return true;
      }

      if (key === 'Delete' || key === 'Backspace') {
        const cell = p.selectedCell;
        if (!cell) return true;
        if (p.isStarted) {
          if (!cell.resultVisible) return true;           // only small digits showing; nothing to clear
          if (cell.isOriginal) { beep(); return true; }   // can't change original values once started
        }
        p.clearResult(cell.row, cell.col);
        this.render();
        return true;
      }

      if (key.length === 1 && key >= '1' && key <= String(n)) {
        const cell = p.selectedCell;
        if (!cell) return true;

        if (p.isStarted && cell.resultVisible && cell.isOriginal) { beep(); return true; }

        const problem = p.allowedProblem(cell.row, cell.col, key);
        if (problem !== null) {
          this.app.showMessage(problem);
          return true;
        }
        cell.setResult(key, !(p.isStarted || cell.digitsVisible));
        this.render();
        if (p.isSolved()) this.app.showMessage('You have solved the puzzle!');
        return true;
      }

      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The application: the two windows, the buttons, Save / Load, and the solver hooks
  // ---------------------------------------------------------------------------------------------

  const app = {
    busy: false,           // true while solving, or while a file is being read / written
    settings,
    windows: {},
    current: null,
    showMessage,
    confirm: confirmBox,
    showOptions,
  };

  const stage = document.getElementById('stage');

  function show(n) {
    for (const w of Object.values(app.windows)) w.scaler.hidden = w.n !== n;
    app.current = app.windows[n];
    document.title = app.current.layout.title;
    app.current.render();
    layout();
  }

  // Scale the fixed-size window to fit the browser window (never smaller than a readable size
  // is a matter for the person's window; it simply scales).
  function layout() {
    const w = app.current;
    if (!w) return;
    const scale = Math.min(2, window.innerWidth / w.layout.width, window.innerHeight / w.layout.height);
    w.scaler.style.width = Math.floor(w.layout.width * scale) + 'px';
    w.scaler.style.height = Math.floor(w.layout.height * scale) + 'px';
    w.form.style.transform = 'scale(' + scale + ')';
    app.scale = scale;
  }

  // ---- hooks for the solver ----

  let lastYield = 0;
  const solverUi = {
    render: () => app.current.render(),
    message: (text) => showMessage(text),
    confirm: (text) => confirmBox(text),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Called very often when showing the attempted digits: repaint and let the browser breathe,
    // but only a few times a second.
    tick: async () => {
      const t = performance.now();
      if (t - lastYield > 30) {
        app.current.render();
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    },
    now: () => performance.now(),
  };

  async function runBusy(fn) {
    app.busy = true;
    document.body.classList.add('busy');
    try {
      await fn();
    } finally {
      document.body.classList.remove('busy');
      app.busy = false;
      app.current.render();
    }
  }

  // ---- Save and Load ----

  const SUD_TYPES = [{ description: 'Sudoku Files (*.sud)', accept: { 'text/plain': ['.sud'] } }];

  // Latin-1 is what the Delphi program wrote; the file only holds ASCII anyway.
  const decodeLatin1 = (buffer) => new TextDecoder('iso-8859-1').decode(buffer);

  function encodeLatin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  }

  async function saveFile(w) {
    const p = w.puzzle;
    const name = p.saveFile || 'save.sud';
    const bytes = encodeLatin1(p.toSaveText());

    try {
      if (typeof window.showSaveFilePicker === 'function') {
        let handle;
        try {
          handle = await window.showSaveFilePicker({ suggestedName: name, types: SUD_TYPES });
        } catch (err) {
          if (err && err.name === 'AbortError') return;   // the person cancelled
          throw err;
        }
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        p.saveFile = handle.name;
      } else {
        // No file picker in this browser: download the file instead.
        const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        p.saveFile = name;
      }
    } catch (err) {
      await showMessage('Unable to write to file ' + name + '.\nError: ' + (err && err.message ? err.message : err));
    }
  }

  // Ask for a file with the standard open dialog. Resolves with a File, or null if cancelled.
  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sud,text/plain';
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  // Clear the puzzle and load the file into it.
  async function loadFile(w, file) {
    const p = w.puzzle;
    let text;
    try {
      text = decodeLatin1(await file.arrayBuffer());
    } catch (err) {
      await showMessage('Error reading file ' + file.name + ' ' + (err && err.message ? err.message : err));
      return;
    }

    const problem = p.loadFromText(text);
    w.render();
    if (problem !== null) {
      await showMessage(problem);
      return;
    }
    p.saveFile = file.name;   // for later re-saves
  }

  async function loadButton(w) {
    const file = await pickFile();
    if (!file) return;
    if (!w.puzzle.isClear() &&
        !(await confirmBox('Is it OK to clear whatever is currently displayed, before Loading a puzzle?'))) return;
    await runBusy(() => loadFile(w, file));
  }

  // ---- the buttons ----

  const actions = {
    manual(w) {
      w.puzzle.manualPlay();
      w.render();
    },

    async solve(w) {
      const p = w.puzzle;
      if (!p.isStarted) p.manualPlay();
      await runBusy(() => fullSolve({ puzzle: p, settings, ui: solverUi }));
    },

    load: (w) => loadButton(w),
    save: (w) => runBusy(() => saveFile(w)),

    async clear(w) {
      if (!w.puzzle.isClear() &&
          !(await confirmBox('There are already results in the puzzle. Are you sure you want to clear it?'))) return;
      w.puzzle.clearAll();
      w.render();
    },

    async options() {
      await showOptions();
      app.current.render();   // the "small helper digits" setting may have changed
    },

    async switch(w) {
      if (!w.puzzle.isClear() &&
          !(await confirmBox('There are already results in the puzzle. Are you sure you want to switch to the other size?')))
        return;
      show(w.n === 9 ? 6 : 9);
    },

    help() {
      window.open('sudoku.pdf', '_blank');
    },
  };

  async function runAction(name) {
    if (app.busy || !overlay.hidden) return;
    await actions[name](app.current);
  }

  // ---------------------------------------------------------------------------------------------
  // Start up
  // ---------------------------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    // A dialog is open: it gets the keys.
    if (!overlay.hidden) {
      const dlg = overlay.querySelector('.dlg');
      // If focus was lost (e.g. the person clicked the dimmed background), put it back in the dialog.
      if (dlg && dlg.focusTarget && !dlg.contains(document.activeElement)) {
        dlg.focusTarget.focus();
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!(dialogKeyHandler && dialogKeyHandler(e))) dlg.focusTarget.click();
          return;
        }
      }
      if (dialogKeyHandler && dialogKeyHandler(e)) e.preventDefault();
      return;
    }
    if (app.busy || !app.current) return;

    // Alt+letter presses the button with that underlined letter
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      const b = app.current.accelerators[e.key.toLowerCase()];
      if (b) { e.preventDefault(); runAction(b.dataset.action); }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser shortcuts alone

    if (app.current.onKey(e)) e.preventDefault();
  });

  stage.addEventListener('click', (e) => {
    const button = e.target.closest('.btn');
    if (button && button.dataset.action) runAction(button.dataset.action);
  });

  // Dropping a .sud file onto the window loads it
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || app.busy || !overlay.hidden) return;
    const w = app.current;
    if (!w.puzzle.isClear() &&
        !(await confirmBox('Is it OK to clear whatever is currently displayed, before Loading a puzzle?'))) return;
    await runBusy(() => loadFile(w, file));
  });

  // Clicking the dimmed background of a dialog shouldn't take the keyboard focus away from it.
  overlay.addEventListener('mousedown', (e) => {
    if (!e.target.closest('input, button, label')) e.preventDefault();
  });

  window.addEventListener('resize', layout);

  readSettings();
  for (const n of [9, 6]) {
    app.windows[n] = new PuzzleWindow(n, app);
    stage.appendChild(app.windows[n].scaler);
  }
  show(9);

  globalThis.SudokuApp = app;   // handy for the tests and for poking at in the console
})();
