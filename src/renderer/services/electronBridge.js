/**
 * Bridge to Electron APIs with graceful fallback for browser-only mode.
 * When running in a browser (Vite dev server without Electron), provides mock implementations.
 */

const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

const MOCK_SETTINGS = {
  contextWindow: 8192,
  maxOutputTokens: 16384,
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

const mockAPI = {
  selectDirectory: async () => {
    // In browser mode, prompt user for a path string
    return window.prompt('Enter project directory path (browser mock):') || null;
  },
  loadSettings: async () => {
    const stored = localStorage.getItem('omc-settings');
    return stored ? { ...MOCK_SETTINGS, ...JSON.parse(stored) } : { ...MOCK_SETTINGS };
  },
  saveSettings: async (settings) => {
    localStorage.setItem('omc-settings', JSON.stringify(settings));
    return true;
  },
  readDir: async () => [],
  readDirRecursive: async () => { console.log('[mock] readDirRecursive'); return []; },
  readFile: async () => null,
  writeFile: async () => true,
  exists: async () => false,
  mkdir: async (dirPath) => { console.log('[mock] mkdir:', dirPath); return true; },
  execCommand: async ({ command, cwd }) => {
    console.log(`[mock] execCommand: ${command} (cwd: ${cwd || 'N/A'})`);
    return { code: 0, stdout: '[mock] command executed', stderr: '', killed: false };
  },
  execCommandQueued: async ({ command, cwd }) => {
    console.log(`[mock] execCommandQueued: ${command} (cwd: ${cwd || 'N/A'})`);
    return { code: 0, stdout: '[mock] queued command executed', stderr: '', killed: false };
  },
  safeWriteFile: async (filePath, content) => {
    console.log(`[mock] safeWriteFile: ${filePath} (${content?.length || 0} bytes)`);
    return true;
  },
  openPreview: async (htmlFilePath) => {
    console.log('[mock] openPreview:', htmlFilePath);
    return true;
  },
  openPreviewUrl: async (url) => {
    console.log('[mock] openPreviewUrl:', url);
    window.open(url, '_blank');
    return true;
  },
  reloadPreview: async () => true,
  closePreview: async () => true,
  readEnv: async () => {
    console.log('[mock] readEnv');
    return {};
  },
  setEnvVar: async (projectPath, key, value) => {
    console.log(`[mock] setEnvVar: ${key}=${value}`);
    return true;
  },
  detectViteServer: async () => {
    // In browser mode, try to probe common ports via fetch
    for (const port of [5173, 5174, 3000, 3001]) {
      try {
        const res = await fetch(`http://localhost:${port}`, { mode: 'no-cors', signal: AbortSignal.timeout(1500) });
        return `http://localhost:${port}`;
      } catch (e) { /* next */ }
    }
    return null;
  },
  showNotification: async ({ title, body }) => {
    console.log(`[mock notification] ${title}: ${body}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') new Notification(title, { body });
    }
    return true;
  },
  isWindowFocused: async () => document.hasFocus(),
  flashFrame: async () => { console.log('[mock] flashFrame'); return true; },
  onShellOutput: (callback) => {
    // No-op in browser mode
    return () => {};
  },
  getAppInfo: async () => ({
    name: 'OneManCrew.Dev.AI',
    version: '1.0.0-browser',
    userDataPath: 'N/A',
    versions: { node: 'N/A', chrome: navigator.userAgent, electron: 'N/A' },
  }),
};

const rawApi = isElectron() ? window.electronAPI : mockAPI;

// ─── Logging wrapper: logs every API call to console ────────────────────────
// Cannot use Proxy because Electron's contextBridge freezes properties.
// Instead, build a plain object that delegates to rawApi with logging.
const SKIP_LOG = new Set(['isWindowFocused']); // too noisy
// onShellOutput is synchronous (returns unsubscribe fn), must not be wrapped as async
const SYNC_FNS = new Set(['onShellOutput']);

function _summarizeResult(result) {
  if (typeof result === 'string') return `string(${result.length})`;
  if (result === true) return 'true';
  if (result === false) return 'false';
  if (result === null || result === undefined) return 'null';
  if (Array.isArray(result)) return `array(${result.length})`;
  if (typeof result === 'object') { try { return `object(${Object.keys(result).length} keys)`; } catch { return 'object'; } }
  return String(result);
}

function _wrapAsync(name, fn) {
  return async function (...args) {
    const argSummary = args.map(a => {
      if (typeof a === 'string') return a.length > 120 ? a.substring(0, 120) + '...' : a;
      try { return JSON.stringify(a)?.substring(0, 80); } catch { return '[unserializable]'; }
    });
    console.log(`🔧 [api.${name}] called`, argSummary);
    try {
      const result = await fn(...args);
      console.log(`✅ [api.${name}] result:`, _summarizeResult(result));
      return result;
    } catch (err) {
      console.error(`❌ [api.${name}] error:`, err.message);
      throw err;
    }
  };
}

// Enumerate all properties — works on both plain objects and frozen contextBridge objects
const allKeys = new Set([
  ...Object.keys(rawApi),
  ...Object.getOwnPropertyNames(rawApi),
]);

const api = {};
for (const key of allKeys) {
  const val = rawApi[key];
  if (typeof val !== 'function' || SKIP_LOG.has(key) || SYNC_FNS.has(key)) {
    api[key] = val;
  } else {
    api[key] = _wrapAsync(key, val);
  }
}

export default api;
