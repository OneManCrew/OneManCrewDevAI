const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // File System
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  exists: (targetPath) => ipcRenderer.invoke('fs:exists', targetPath),

  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  execCommand: (opts) => ipcRenderer.invoke('shell:exec', opts),
  execCommandQueued: (opts) => ipcRenderer.invoke('execute-command-queued', opts),
  safeWriteFile: (filePath, content) => ipcRenderer.invoke('safe-write-file', filePath, content),

  // Preview Window
  openPreview: (htmlFilePath) => ipcRenderer.invoke('preview:open', htmlFilePath),
  reloadPreview: () => ipcRenderer.invoke('preview:reload'),
  closePreview: () => ipcRenderer.invoke('preview:close'),

  // Notifications
  showNotification: (opts) => ipcRenderer.invoke('notification:show', opts),
  isWindowFocused: () => ipcRenderer.invoke('window:isFocused'),
  flashFrame: () => ipcRenderer.invoke('window:flashFrame'),

  // Shell output streaming
  onShellOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('shell:output', handler);
    return () => ipcRenderer.removeListener('shell:output', handler);
  },

  // App Info
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
});
