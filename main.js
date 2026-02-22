const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const fse = require('fs-extra');

// Module-level reference to main window
let mainWindow = null;

// Settings file path (deferred — app.getPath is not available at module load)
let SETTINGS_PATH = null;

function getSettingsPath() {
  if (!SETTINGS_PATH) {
    SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
  }
  return SETTINGS_PATH;
}

// Default settings
const DEFAULT_SETTINGS = {
  contextWindow: 8192,
  provider: 'openai',
  apiKeys: {
    ollama: '',
    openrouter: '',
    openai: '',
    gemini: '',
    anthropic: '',
  },
  ollamaUrl: 'http://localhost:11434',
  selectedModel: '',
  lastProjectPath: '',
};

function loadSettings() {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const data = fs.readFileSync(getSettingsPath(), 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    const dir = path.dirname(getSettingsPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return false;
  }
}

// ─── Command Queue ──────────────────────────────────────────────────────────

class CommandQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  enqueue(command, cwd, shell) {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, cwd, shell, resolve, reject });
      this._processNext();
    });
  }

  _processNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;

    const { command, cwd, shell, resolve, reject } = this.queue.shift();
    const isWin = process.platform === 'win32';
    const shellBin = shell || (isWin ? 'powershell.exe' : '/bin/bash');

    const execOpts = {
      cwd: cwd || undefined,
      env: { ...process.env },
      shell: shellBin,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    };

    // Notify renderer that a queued command started
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shell:output', { type: 'start', command, cwd: cwd || '', queued: true });
    }

    exec(command, execOpts, (error, stdout, stderr) => {
      const code = error ? (error.killed ? -1 : error.code ?? 1) : 0;
      const killed = !!(error && error.killed);

      // Notify renderer that the queued command finished
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (stdout) {
          mainWindow.webContents.send('shell:output', { type: 'stdout', command, data: stdout, queued: true });
        }
        if (stderr) {
          mainWindow.webContents.send('shell:output', { type: 'stderr', command, data: stderr, queued: true });
        }
        mainWindow.webContents.send('shell:output', { type: 'exit', command, code, killed, queued: true });
      }

      // Always resolve (never reject) so the queue keeps moving.
      // The caller can inspect `code` to detect failures.
      resolve({ code, stdout: stdout || '', stderr: stderr || '', killed });

      // Move to next task
      this.running = false;
      this._processNext();
    });
  }
}

const commandQueue = new CommandQueue();

// ─── File Lock Manager ───────────────────────────────────────────────────────

class FileLockManager {
  constructor() {
    this._locks = new Set();
  }

  isLocked(filePath) {
    return this._locks.has(path.resolve(filePath));
  }

  lock(filePath) {
    this._locks.add(path.resolve(filePath));
  }

  unlock(filePath) {
    this._locks.delete(path.resolve(filePath));
  }

  /**
   * Wait until the file is no longer locked, then acquire the lock.
   * Retries every `intervalMs` up to `maxWaitMs`. Rejects on timeout.
   */
  async acquire(filePath, { maxWaitMs = 30_000, intervalMs = 50 } = {}) {
    const resolved = path.resolve(filePath);
    const start = Date.now();

    while (this._locks.has(resolved)) {
      if (Date.now() - start > maxWaitMs) {
        throw new Error(`FileLockManager: timeout waiting for lock on ${resolved}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    this._locks.add(resolved);
  }
}

const fileLockManager = new FileLockManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  // Graceful show
  mainWindow.once('ready-to-show', () => {
    console.log('[main] ready-to-show fired, showing window');
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  });

  // Load from Vite dev server or built files
  const startUrl = process.env.ELECTRON_START_URL;
  console.log('[main] ELECTRON_START_URL:', startUrl || '(not set)');

  if (startUrl) {
    mainWindow.loadURL(startUrl).catch((err) => {
      console.error('[main] Failed to load URL:', err);
      // Fallback: show window anyway with error
      mainWindow.show();
    });
  } else {
    const filePath = path.join(__dirname, 'dist', 'renderer', 'index.html');
    console.log('[main] Loading file:', filePath);
    mainWindow.loadFile(filePath).catch((err) => {
      console.error('[main] Failed to load file:', err);
      mainWindow.show();
    });
  }

  // Safety net: show window after 5 seconds regardless
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('[main] Safety timeout: forcing window show');
      mainWindow.show();
    }
  }, 5000);

  // Track focus state
  mainWindow.on('focus', () => { mainWindow._isFocused = true; });
  mainWindow.on('blur', () => { mainWindow._isFocused = false; });
  mainWindow._isFocused = true;

  return mainWindow;
}

// ─── Preview Window Management ────────────────────────────────────────────────

let previewWindow = null;

function _ensurePreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;

  previewWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'UI Preview',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  previewWindow.on('closed', () => {
    previewWindow = null;
  });

  return previewWindow;
}

function openPreviewWindow(htmlFilePath) {
  const win = _ensurePreviewWindow();
  win.loadFile(htmlFilePath);
  win.focus();
}

function openPreviewUrl(url) {
  const win = _ensurePreviewWindow();
  win.loadURL(url);
  win.focus();
}

function reloadPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.reload();
  }
}

function closePreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
    previewWindow = null;
  }
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // Select directory dialog
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Settings CRUD
  ipcMain.handle('settings:load', () => loadSettings());
  ipcMain.handle('settings:save', (_event, settings) => saveSettings(settings));

  // File system operations
  ipcMain.handle('fs:readDir', (_event, dirPath) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:readFile', (_event, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:writeFile', (_event, filePath, content) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      console.error('fs:writeFile error:', err);
      return false;
    }
  });

  ipcMain.handle('fs:exists', (_event, targetPath) => {
    return fs.existsSync(targetPath);
  });

  // Preview window
  ipcMain.handle('preview:open', (_event, htmlFilePath) => {
    openPreviewWindow(htmlFilePath);
    return true;
  });

  ipcMain.handle('preview:openUrl', (_event, url) => {
    openPreviewUrl(url);
    return true;
  });

  ipcMain.handle('preview:reload', () => {
    reloadPreviewWindow();
    return true;
  });

  ipcMain.handle('preview:close', () => {
    closePreviewWindow();
    return true;
  });

  // Notification
  ipcMain.handle('notification:show', (_event, { title, body, silent }) => {
    try {
      if (!Notification.isSupported()) return false;
      const notif = new Notification({
        title: title || 'OneManCrew.Dev.AI',
        body: body || '',
        silent: silent === true,
        icon: path.join(__dirname, 'assets', 'icon.png'),
      });
      notif.on('click', () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          const win = wins[0];
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      });
      notif.show();
      return true;
    } catch (err) {
      console.error('notification:show error:', err);
      return false;
    }
  });

  // Check if main window is focused
  ipcMain.handle('window:isFocused', () => {
    const wins = BrowserWindow.getAllWindows();
    return wins.some(w => !w.isDestroyed() && w.isFocused());
  });

  // Flash taskbar when attention needed
  ipcMain.handle('window:flashFrame', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0 && !wins[0].isDestroyed()) {
      wins[0].flashFrame(true);
    }
    return true;
  });

  // Create directory
  ipcMain.handle('fs:mkdir', (_event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (err) {
      console.error('fs:mkdir error:', err);
      return false;
    }
  });

  // Execute shell command
  // Returns { code, stdout, stderr } after the process finishes.
  // Timeout: 120 seconds max.
  // Streams stdout/stderr lines to renderer via 'shell:output' event.
  ipcMain.handle('shell:exec', (_event, { command, cwd, shell }) => {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const shellBin = shell || (isWin ? 'powershell.exe' : '/bin/bash');
      const shellArgs = isWin
        ? ['-NoProfile', '-NonInteractive', '-Command', command]
        : ['-c', command];

      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn(shellBin, shellArgs, {
        cwd: cwd || undefined,
        env: { ...process.env },
        windowsHide: true,
      });

      // Send start event
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shell:output', { type: 'start', command, cwd: cwd || '' });
      }

      // Timeout safety
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, 120_000);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', { type: 'stdout', command, data: text });
        }
      });
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', { type: 'stderr', command, data: text });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', { type: 'error', command, data: err.message });
        }
        resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, killed: false });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shell:output', { type: 'exit', command, code: code ?? -1, killed });
        }
        resolve({ code: code ?? -1, stdout, stderr, killed });
      });
    });
  });

  // Execute shell command via sequential queue (prevents parallel conflicts)
  ipcMain.handle('execute-command-queued', (_event, { command, cwd, shell }) => {
    return commandQueue.enqueue(command, cwd, shell);
  });

  // Safe file write — acquires a per-file lock, waits if busy, writes atomically via fs-extra
  ipcMain.handle('safe-write-file', async (_event, filePath, content) => {
    try {
      await fileLockManager.acquire(filePath);
      try {
        await fse.outputFile(filePath, content, 'utf-8');
        return true;
      } finally {
        fileLockManager.unlock(filePath);
      }
    } catch (err) {
      console.error('safe-write-file error:', err);
      return false;
    }
  });

  // Get app info
  ipcMain.handle('app:getInfo', () => ({
    name: 'OneManCrew.Dev.AI',
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
    versions: {
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
    },
  }));
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
