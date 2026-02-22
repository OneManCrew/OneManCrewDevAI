/**
 * Bridge to Electron APIs with graceful fallback for browser-only mode.
 * When running in a browser (Vite dev server without Electron), provides mock implementations.
 */

const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

const MOCK_SETTINGS = {
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

const api = isElectron() ? window.electronAPI : mockAPI;

export default api;
