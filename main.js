// Electron main process: opens index.html in a window. Everything else is the same web page
// that runs in an ordinary browser.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 330,
    minHeight: 400,
    title: 'Sudoku',
    icon: path.join(__dirname, 'icon-256.png'),
    backgroundColor: '#dcdcdc',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));

  // The Help button opens sudoku.pdf in its own window (Chromium's built-in PDF viewer);
  // any other link goes to the person's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://') && url.toLowerCase().endsWith('.pdf')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 900, height: 800, autoHideMenuBar: true, title: 'Sudoku Help' },
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Never navigate away from the game itself.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
