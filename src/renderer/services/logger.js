/**
 * Unified Logger — writes to both browser console AND a file on disk via IPC.
 * 
 * Usage:
 *   import log from './logger';
 *   log.info('MyModule', 'Something happened', { key: 'value' });
 *   log.error('MyModule', 'Failed', error);
 *   log.warn('MyModule', 'Watch out');
 *   log.debug('MyModule', 'Verbose detail');
 * 
 * Log file: {projectPath}/docs/debug.log (set via log.setProjectPath)
 * Each line: [ISO timestamp] [LEVEL] [MODULE] message | {json data}
 */

import api from './electronBridge';

let _projectPath = null;
let _buffer = [];        // buffer entries before projectPath is set
let _flushTimer = null;
const MAX_BUFFER = 200;

function _timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

function _formatLine(level, module, message, data) {
  let line = `[${_timestamp()}] [${level}] [${module}] ${message}`;
  if (data !== undefined && data !== null) {
    try {
      const serialized = data instanceof Error
        ? `${data.message}\n${data.stack}`
        : JSON.stringify(data, null, 0);
      line += ` | ${serialized}`;
    } catch {
      line += ` | [unserializable]`;
    }
  }
  return line;
}

async function _flushToFile() {
  if (!_projectPath || _buffer.length === 0) return;
  const logPath = _projectPath.replace(/[\\/]$/, '') + '/docs/debug.log';
  const chunk = _buffer.splice(0, _buffer.length).join('\n') + '\n';
  try {
    // Append to log file — use safeWriteFile with append flag via a special IPC
    // Fallback: read existing + append + write
    const existing = await api.readFile(logPath).catch(() => '');
    const writer = api.safeWriteFile || api.writeFile;
    await writer(logPath, existing + chunk);
  } catch (e) {
    // If file write fails, at least keep console logs
    console.warn('[Logger] Failed to write log file:', e.message);
  }
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    _flushToFile();
  }, 1000); // flush every 1 second
}

function _log(level, module, message, data) {
  const line = _formatLine(level, module, message, data);

  // Console output (color-coded)
  switch (level) {
    case 'ERROR': console.error(`🔴 ${line}`); break;
    case 'WARN':  console.warn(`🟡 ${line}`);  break;
    case 'INFO':  console.log(`🔵 ${line}`);   break;
    case 'DEBUG': console.log(`⚪ ${line}`);    break;
  }

  // Buffer for file write
  _buffer.push(line);
  if (_buffer.length > MAX_BUFFER) {
    _buffer = _buffer.slice(-MAX_BUFFER); // keep last N entries
  }
  _scheduleFlush();
}

const log = {
  setProjectPath(projectPath) {
    _projectPath = projectPath;
    _log('INFO', 'Logger', `Project path set: ${projectPath}`);
    _flushToFile(); // flush any buffered entries
  },

  info:  (module, message, data) => _log('INFO',  module, message, data),
  warn:  (module, message, data) => _log('WARN',  module, message, data),
  error: (module, message, data) => _log('ERROR', module, message, data),
  debug: (module, message, data) => _log('DEBUG', module, message, data),

  /** Force flush all buffered entries to disk immediately */
  async flush() {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    await _flushToFile();
  },
};

export default log;
