/**
 * Coding Agents Service
 * Defines 6 specialist coding agents, their system prompts, task assignment logic,
 * and the orchestrator that runs them in parallel without conflicts.
 */

import { createLLMProvider, getAgentSettings } from './llmProviders.js';
import api from './electronBridge.js';

// ─── Agent Type Definitions ─────────────────────────────────────────────────────

export const AGENT_TYPES = {
  BACKEND: 'backend',
  FRONTEND: 'frontend',
  DEVOPS: 'devops',
  TESTING: 'testing',
  INTEGRATION: 'integration',
  SETUP: 'setup',
};

export const AGENT_DEFINITIONS = {
  [AGENT_TYPES.BACKEND]: {
    id: AGENT_TYPES.BACKEND,
    name: 'Backend Engineer',
    emoji: '⚙️',
    color: 'blue',
    shortDesc: 'Server-side & API specialist',
    description: '30+ years of experience in Node.js, Java, Python, C, C++, C#, Go and all related frameworks and libraries.',
    keywords: ['backend', 'server', 'api', 'database', 'db', 'schema', 'model', 'controller', 'route', 'middleware', 'auth', 'rest', 'graphql', 'websocket', 'queue', 'cache', 'orm', 'migration', 'seed', 'endpoint', 'microservice', 'service layer', 'business logic', 'data access', 'repository', 'node', 'express', 'fastify', 'django', 'flask', 'spring', 'dotnet'],
  },
  [AGENT_TYPES.FRONTEND]: {
    id: AGENT_TYPES.FRONTEND,
    name: 'Frontend Engineer',
    emoji: '🎨',
    color: 'pink',
    shortDesc: 'UI implementation specialist',
    description: '30+ years of experience in HTML, CSS, JavaScript, TypeScript, Angular, React, Svelte, Vue, Swing and all UI frameworks.',
    keywords: ['frontend', 'ui', 'ux', 'component', 'page', 'view', 'layout', 'style', 'css', 'html', 'jsx', 'tsx', 'react', 'angular', 'vue', 'svelte', 'tailwind', 'sass', 'responsive', 'animation', 'form', 'modal', 'navigation', 'menu', 'sidebar', 'header', 'footer', 'theme', 'design system', 'widget'],
  },
  [AGENT_TYPES.DEVOPS]: {
    id: AGENT_TYPES.DEVOPS,
    name: 'DevOps Engineer',
    emoji: '🔧',
    color: 'orange',
    shortDesc: 'Infrastructure & CI/CD specialist',
    description: '25+ years of experience in CI/CD, Docker, Kubernetes, scripting, Linux, Windows, and all infrastructure tooling.',
    keywords: ['devops', 'ci', 'cd', 'cicd', 'docker', 'kubernetes', 'k8s', 'deploy', 'deployment', 'pipeline', 'infrastructure', 'terraform', 'ansible', 'nginx', 'apache', 'linux', 'windows', 'script', 'bash', 'powershell', 'monitoring', 'logging', 'env', 'environment', 'config', 'yaml', 'helm', 'cloud', 'aws', 'azure', 'gcp'],
  },
  [AGENT_TYPES.TESTING]: {
    id: AGENT_TYPES.TESTING,
    name: 'QA Engineer',
    emoji: '🧪',
    color: 'green',
    shortDesc: 'Testing & quality specialist',
    description: '35+ years of experience in unit testing, integration testing, E2E testing, and all testing frameworks and methodologies.',
    keywords: ['test', 'testing', 'unit test', 'integration test', 'e2e', 'end-to-end', 'jest', 'mocha', 'cypress', 'playwright', 'selenium', 'pytest', 'junit', 'coverage', 'mock', 'stub', 'fixture', 'assertion', 'qa', 'quality', 'validation', 'verification', 'spec', 'tdd', 'bdd'],
  },
  [AGENT_TYPES.INTEGRATION]: {
    id: AGENT_TYPES.INTEGRATION,
    name: 'Integration Engineer',
    emoji: '🔗',
    color: 'purple',
    shortDesc: 'System integration specialist',
    description: '25+ years of experience connecting backend to frontend, API integration, component wiring, and system interoperability.',
    keywords: ['integration', 'connect', 'wire', 'bridge', 'adapter', 'proxy', 'gateway', 'api client', 'sdk', 'fetch', 'axios', 'http client', 'state management', 'redux', 'zustand', 'context', 'provider', 'hook', 'service layer', 'data flow', 'event bus', 'message broker', 'socket', 'sse', 'polling'],
  },
  [AGENT_TYPES.SETUP]: {
    id: AGENT_TYPES.SETUP,
    name: 'Setup Engineer',
    emoji: '📦',
    color: 'cyan',
    shortDesc: 'Installation & packaging specialist',
    description: '30+ years of experience creating installers, setup scripts, migration tools, rollback mechanisms, and packaging for all platforms.',
    keywords: ['setup', 'install', 'installer', 'package', 'packaging', 'build', 'bundle', 'webpack', 'vite', 'rollup', 'esbuild', 'npm', 'yarn', 'pnpm', 'dependency', 'migration', 'rollback', 'upgrade', 'update', 'version', 'release', 'distribution', 'executable', 'msi', 'dmg', 'deb', 'rpm', 'electron-builder', 'pkg', 'init', 'scaffold', 'boilerplate', 'project structure'],
  },
};

// ─── System Prompts ─────────────────────────────────────────────────────────────

function buildAgentSystemPrompt(agentType, task, projectContext) {
  const def = AGENT_DEFINITIONS[agentType];
  if (!def) return '';

  return `You are a senior ${def.name} with ${def.description}

## Your Role
You are part of a team of specialist coding agents working together to implement a software project. Each agent handles their area of expertise. You must produce production-quality, clean, well-structured code.

## Project Context
${projectContext.projectName ? `**Project:** ${projectContext.projectName}` : ''}
${projectContext.srs ? `\n### Software Requirements Specification (SRS)\n${projectContext.srs}` : ''}
${projectContext.hld ? `\n### High-Level Design (HLD)\n${projectContext.hld}` : ''}
${projectContext.uiComponents ? `\n### UI Components (React + Tailwind)\n${projectContext.uiComponents}` : ''}
${projectContext.contextSummary ? `\n### Shared Context (from completed tasks)\n${projectContext.contextSummary}` : ''}

## Your Current Task
**Task ID:** ${task.id}
**Title:** ${task.title}
**Description:** ${task.description || 'No description provided.'}
${task.acceptanceCriteria ? `**Acceptance Criteria:**\n${Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map(c => `- ${c}`).join('\n') : task.acceptanceCriteria}` : ''}
${task.technicalNotes ? `**Technical Notes:** ${task.technicalNotes}` : ''}

## Tools Available
You have the following tools. Each tool is invoked via a fenced code block with a special tag.

### 1. Write File
Write a file to disk. The file and any parent directories will be created automatically.
\`\`\`file:path/to/filename.ext
// Complete file contents here
\`\`\`

### 2. Run Shell Command
Execute a shell command (e.g. install dependencies, run build tools, create directories).
\`\`\`exec-command
{"command": "npm install express", "description": "Install Express.js framework"}
\`\`\`
The command runs in the project root directory. Use this for:
- Installing packages (npm install, pip install, etc.)
- Running build commands
- Any shell operation needed for the task

### Rules:
1. Output EVERY file needed for this task as a separate \`\`\`file:...\`\`\` block.
2. Each file must be COMPLETE — no placeholders, no "// TODO", no "..." abbreviations.
3. Include all imports, exports, and dependencies.
4. Follow the project's existing code style and conventions.
5. Use modern best practices for the technology stack.
6. Add brief inline comments only where logic is complex.
7. Do NOT output explanations outside of code blocks — only code and tool blocks.
8. Files are written to disk immediately as you output them — the user sees progress in real-time.
9. Use \`\`\`exec-command\`\`\` to install dependencies BEFORE writing code that uses them.

## Requesting User Input
If you are BLOCKED and cannot proceed without user input (e.g. you need the user to install a missing tool like Node.js, choose between options, provide credentials, or approve a critical decision), output a special block:

\`\`\`need-input
{"question": "Your question to the user here", "options": ["Option A", "Option B"]}
\`\`\`

The "options" array is optional — include it only if there are specific choices. After the user responds, you will receive their answer and must continue implementing.

Only use \`\`\`need-input\`\`\` when you are truly blocked. Do NOT use it for trivial decisions you can make yourself.

Begin implementing the task now. Use \`\`\`file:...\`\`\`, \`\`\`exec-command\`\`\`, or \`\`\`need-input\`\`\` blocks.`;
}

// ─── Task Assignment Logic ──────────────────────────────────────────────────────

/**
 * Assigns an agent type to a task based on keyword matching in title, description, and phase name.
 */
export function assignAgentToTask(task, phaseName = '') {
  const text = `${task.title || ''} ${task.description || ''} ${task.technicalNotes || ''} ${phaseName}`.toLowerCase();

  // Score each agent type
  const scores = {};
  for (const [type, def] of Object.entries(AGENT_DEFINITIONS)) {
    scores[type] = 0;
    for (const kw of def.keywords) {
      if (text.includes(kw)) {
        scores[type] += kw.includes(' ') ? 3 : 1; // Multi-word keywords score higher
      }
    }
  }

  // Find the highest scoring agent
  let bestType = AGENT_TYPES.BACKEND; // default fallback
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

/**
 * Takes a workplan and assigns agents to all tasks, returning an enriched task list.
 * Also determines execution order respecting dependencies.
 */
export function buildExecutionPlan(workplan) {
  if (!workplan || !workplan.phases) return [];

  const allTasks = [];

  for (const phase of workplan.phases) {
    for (const task of (phase.tasks || [])) {
      const agentType = assignAgentToTask(task, phase.name || '');
      allTasks.push({
        ...task,
        phaseName: phase.name || `Phase ${phase.id}`,
        phaseId: phase.id,
        phaseOrder: phase.order || 0,
        assignedAgent: agentType,
        status: 'pending', // pending | running | done | error
        progress: 0,
        output: null,
        files: [],
        error: null,
      });
    }
  }

  // Sort by phase order, then task order within phase
  allTasks.sort((a, b) => {
    if (a.phaseOrder !== b.phaseOrder) return a.phaseOrder - b.phaseOrder;
    return (a.order || 0) - (b.order || 0);
  });

  return allTasks;
}

/**
 * Groups tasks into parallel execution batches.
 * Tasks within the same phase can run in parallel if they don't share the same agent type
 * (to avoid file conflicts). Tasks in different phases run sequentially.
 */
export function buildParallelBatches(executionPlan) {
  const batches = [];
  let currentPhaseOrder = -1;
  let currentBatch = [];

  for (const task of executionPlan) {
    if (task.phaseOrder !== currentPhaseOrder) {
      // New phase — flush current batch and start new one
      if (currentBatch.length > 0) batches.push(currentBatch);
      currentBatch = [task];
      currentPhaseOrder = task.phaseOrder;
    } else {
      // Same phase — add to current batch (will run in parallel)
      currentBatch.push(task);
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  return batches;
}

// ─── File Extraction from LLM Output ────────────────────────────────────────────

/**
 * Extracts file blocks from agent output.
 * Looks for ```file:path/to/file.ext ... ``` blocks.
 */
export function extractFilesFromOutput(output) {
  const files = [];
  const regex = /```file:([^\n`]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(output)) !== null) {
    const filePath = match[1].trim();
    const content = match[2];
    if (filePath && content) {
      files.push({ path: filePath, content });
    }
  }

  return files;
}

/**
 * Detects if the agent output contains a need-input block.
 * Returns { question, options } or null.
 */
export function detectNeedInput(output) {
  const match = output.match(/```need-input\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return {
      question: parsed.question || 'The agent needs your input to continue.',
      options: Array.isArray(parsed.options) ? parsed.options : [],
    };
  } catch {
    // If JSON parse fails, treat the whole block as the question
    return { question: match[1].trim(), options: [] };
  }
}

// ─── Incremental File Extractor ─────────────────────────────────────────────────

/**
 * Tracks which ```file:... blocks have been fully closed (```) during streaming.
 * Each time a new complete block is detected, calls onFile(filePath, content).
 */
export class IncrementalFileExtractor {
  constructor() {
    this._processedCount = 0;
  }

  /**
   * Feed the full accumulated output so far. Detects newly completed file blocks.
   * Returns array of newly found files: [{ path, content }]
   */
  update(fullOutput) {
    const regex = /```file:([^\n`]+)\n([\s\S]*?)```/g;
    const allMatches = [];
    let match;
    while ((match = regex.exec(fullOutput)) !== null) {
      allMatches.push({ path: match[1].trim(), content: match[2] });
    }

    // Only return files we haven't processed yet
    const newFiles = allMatches.slice(this._processedCount);
    this._processedCount = allMatches.length;
    return newFiles;
  }
}

/**
 * Extracts exec-command blocks from output.
 * Returns [{ command, description }]
 */
export function extractCommandsFromOutput(output) {
  const commands = [];
  const regex = /```exec-command\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.command) {
        commands.push({
          command: parsed.command,
          description: parsed.description || parsed.command,
        });
      }
    } catch {
      // If not valid JSON, treat the whole block as a command string
      const cmd = match[1].trim();
      if (cmd) commands.push({ command: cmd, description: cmd });
    }
  }
  return commands;
}

/**
 * Incremental command extractor — same pattern as IncrementalFileExtractor.
 */
export class IncrementalCommandExtractor {
  constructor() {
    this._processedCount = 0;
  }

  update(fullOutput) {
    const all = extractCommandsFromOutput(fullOutput);
    const newCmds = all.slice(this._processedCount);
    this._processedCount = all.length;
    return newCmds;
  }
}

// ─── Post-Write Syntax Validation ────────────────────────────────────────────

const SYNTAX_CHECK_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

/**
 * Runs `node -c <file>` to check for syntax errors in JS/JSX files.
 * Returns { valid: true } or { valid: false, error: string }.
 */
async function _validateSyntax(fullPath, projectPath) {
  const ext = fullPath.substring(fullPath.lastIndexOf('.')).toLowerCase();
  if (!SYNTAX_CHECK_EXTENSIONS.includes(ext)) return { valid: true };

  try {
    const result = await api.execCommand({
      command: `node -c "${fullPath.replace(/\\/g, '/')}"`,
      cwd: projectPath || undefined,
    });
    if (result.code === 0) return { valid: true };
    return { valid: false, error: (result.stderr || '').trim().substring(0, 500) };
  } catch (e) {
    // If node -c itself fails to run, don't block — treat as valid
    console.warn('[codingAgents] Syntax check failed to execute:', e);
    return { valid: true };
  }
}

// ─── Task Executor ──────────────────────────────────────────────────────────────

/**
 * Runs a single LLM call for a task. Returns the full response text.
 * Calls onStreamUpdate(fullResponse) on every token so callers can do incremental parsing.
 */
async function _runLLMCall(messages, settings, callbacks = {}) {
  const { onToken, onProgress, onStreamUpdate } = callbacks;
  const agentSettings = getAgentSettings(settings, 'coding');
  const provider = createLLMProvider(agentSettings);

  let fullResponse = '';
  let tokenCount = 0;

  return new Promise((resolve, reject) => {
    provider.chat(messages, agentSettings, {
      onToken: (token) => {
        fullResponse += token;
        tokenCount++;
        if (onToken) onToken(token, tokenCount);
        const estimatedProgress = Math.min(95, Math.round((tokenCount / 4000) * 100));
        if (onProgress) onProgress(estimatedProgress);
        if (onStreamUpdate) onStreamUpdate(fullResponse);
      },
      onDone: (finalText) => {
        fullResponse = finalText || fullResponse;
        if (onStreamUpdate) onStreamUpdate(fullResponse);
        resolve({ rawOutput: fullResponse, tokenCount });
      },
      onError: (err) => {
        reject(err);
      },
    });
  });
}

/**
 * Executes a single task by sending it to the LLM.
 * Writes files to disk and executes commands IN REAL-TIME as the agent streams output.
 *
 * callbacks:
 *   onToken, onProgress, onComplete, onError
 *   onNeedInput(question, options) => Promise<string>
 *   onFileWritten(file) — called each time a file is written to disk
 *   onCommandExecuted(cmd, result) — called each time a command finishes
 *
 * @param {string} projectPath — root path where files are saved (files go to projectPath/src/...)
 */
export async function executeTask(task, projectContext, settings, callbacks = {}, projectPath = '') {
  const { onToken, onProgress, onComplete, onError, onNeedInput, onFileWritten, onCommandExecuted, onCommandQueued, onSyntaxError, onSyntaxRetry } = callbacks;
  const agentType = task.assignedAgent || AGENT_TYPES.BACKEND;

  const systemPrompt = buildAgentSystemPrompt(agentType, task, projectContext);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Implement the task "${task.title}" now. Use \`\`\`file:...\`\`\`, \`\`\`exec-command\`\`\`, or \`\`\`need-input\`\`\` blocks.` },
  ];

  const MAX_TURNS = 5;
  let allOutput = '';
  const allFiles = [];
  const allCommands = [];
  let syntaxErrors = []; // Collects syntax errors per turn for auto-retry

  // Incremental extractors for real-time processing
  const fileExtractor = new IncrementalFileExtractor();
  const cmdExtractor = new IncrementalCommandExtractor();

  const srcBase = projectPath ? projectPath.replace(/[\\/]$/, '') + '/src' : '';

  // Serialized queue to prevent concurrent processStream races
  let _processingChain = Promise.resolve();

  function enqueueProcessing(fullOutput) {
    _processingChain = _processingChain.then(() => _processStream(fullOutput)).catch(() => {});
  }

  async function drainQueue() {
    await _processingChain;
  }

  // Process newly detected files and commands from streaming output
  async function _processStream(fullOutput) {
    // Write new files to disk
    const newFiles = fileExtractor.update(fullOutput);
    for (const file of newFiles) {
      allFiles.push(file);
      if (srcBase) {
        try {
          const fullPath = srcBase + '/' + file.path;
          await api.safeWriteFile(fullPath, file.content);
          if (onFileWritten) onFileWritten(file);
          // Post-write syntax validation for JS/JSX files
          const validation = await _validateSyntax(fullPath, projectPath);
          if (!validation.valid) {
            console.warn(`[codingAgents] Syntax error in ${file.path}:`, validation.error);
            syntaxErrors.push({ file, error: validation.error });
            if (onSyntaxError) onSyntaxError(file, validation.error);
          }
        } catch (e) {
          console.warn(`[codingAgents] Failed to write ${file.path}:`, e);
        }
      }
    }

    // Execute new commands via sequential queue
    const newCmds = cmdExtractor.update(fullOutput);
    for (const cmd of newCmds) {
      allCommands.push(cmd);
      try {
        if (onCommandQueued) onCommandQueued(cmd);
        // 5-minute timeout — if the queued command doesn't return, release with error
        const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;
        const result = await Promise.race([
          api.execCommandQueued({
            command: cmd.command,
            cwd: projectPath || undefined,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Queue timeout: command did not complete within 5 minutes — ${cmd.command}`)), QUEUE_TIMEOUT_MS)
          ),
        ]);
        if (onCommandExecuted) onCommandExecuted(cmd, result);
      } catch (e) {
        console.warn(`[codingAgents] Command failed: ${cmd.command}`, e);
        if (onCommandExecuted) onCommandExecuted(cmd, { code: -1, stdout: '', stderr: e.message, killed: false });
      }
    }
  }

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { rawOutput, tokenCount } = await _runLLMCall(messages, settings, {
        onToken,
        onProgress,
        onStreamUpdate: (fullOutput) => {
          enqueueProcessing(fullOutput);
        },
      });

      allOutput += rawOutput;
      messages.push({ role: 'assistant', content: rawOutput });

      // Show post-processing state
      if (onProgress) onProgress(97);

      // Final pass — enqueue + drain to catch anything missed and await all pending ops
      enqueueProcessing(allOutput);
      await drainQueue();

      // Check for syntax errors — if any, inject fix prompt and re-run
      if (syntaxErrors.length > 0) {
        const errorSummary = syntaxErrors.map(e =>
          `- **${e.file.path}**: ${e.error}`
        ).join('\n');
        const fixPrompt = `The code you just wrote has syntax errors. Please fix them and output the full corrected file(s) again using \`\`\`file:...\`\`\` blocks.\n\nSyntax errors found:\n${errorSummary}`;
        messages.push({ role: 'user', content: fixPrompt });
        if (onSyntaxRetry) onSyntaxRetry(syntaxErrors);
        syntaxErrors = []; // Reset for next turn
        continue;
      }

      // Check if agent needs user input
      const needInput = detectNeedInput(rawOutput);
      if (needInput && onNeedInput) {
        const userResponse = await onNeedInput(needInput.question, needInput.options);
        if (userResponse) {
          messages.push({ role: 'user', content: `User response: ${userResponse}\n\nPlease continue implementing. Use \`\`\`file:...\`\`\`, \`\`\`exec-command\`\`\`, or \`\`\`need-input\`\`\` blocks.` });
          continue;
        }
      }

      // Done — no syntax errors, no need-input
      if (onProgress) onProgress(100);
      if (onComplete) onComplete({ files: allFiles, commands: allCommands, rawOutput: allOutput, tokenCount });
      return { rawOutput: allOutput };
    }

    // Exhausted turns
    if (onProgress) onProgress(100);
    if (onComplete) onComplete({ files: allFiles, commands: allCommands, rawOutput: allOutput, tokenCount: 0 });
    return { rawOutput: allOutput };
  } catch (err) {
    if (onError) onError(err);
    return { error: err.message };
  }
}

// ─── Task Logger ────────────────────────────────────────────────────────────────

/**
 * Writes a real-time execution log per task to disk.
 * Log file: {projectPath}/docs/dev-lead/task-logs/{taskId}.log
 * Each entry is appended immediately so the log is always up-to-date.
 */
export class TaskLogger {
  constructor(projectPath, taskId) {
    this._buffer = '';
    this._writing = false;
    this._logPath = projectPath
      ? projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/task-logs/' + taskId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.log'
      : '';
  }

  _ts() {
    return new Date().toISOString();
  }

  async _flush(line) {
    if (!this._logPath) return;
    this._buffer += line + '\n';
    if (this._writing) return;
    this._writing = true;
    try {
      const content = this._buffer;
      this._buffer = '';
      // Read existing, append, write back (simple append via full rewrite)
      const existing = await api.readFile(this._logPath) || '';
      await api.writeFile(this._logPath, existing + content);
    } catch (e) {
      console.warn(`[TaskLogger] write failed:`, e);
    } finally {
      this._writing = false;
      // If more lines were buffered while writing, flush again
      if (this._buffer.length > 0) {
        const remaining = this._buffer;
        this._buffer = '';
        const existing = await api.readFile(this._logPath) || '';
        await api.writeFile(this._logPath, existing + remaining).catch(() => {});
      }
    }
  }

  start(task) {
    const agentDef = AGENT_DEFINITIONS[task.assignedAgent];
    this._flush(`════════════════════════════════════════════════════════════`);
    this._flush(`TASK: ${task.title}`);
    this._flush(`ID: ${task.id}`);
    this._flush(`Agent: ${agentDef?.emoji || ''} ${agentDef?.name || task.assignedAgent}`);
    this._flush(`Started: ${this._ts()}`);
    this._flush(`Description: ${task.description || 'N/A'}`);
    this._flush(`════════════════════════════════════════════════════════════`);
  }

  fileWritten(file) {
    this._flush(`[${this._ts()}] 📄 FILE WRITTEN: ${file.path} (${file.content?.length || 0} bytes)`);
  }

  syntaxError(file, error) {
    this._flush(`[${this._ts()}] 🚨 SYNTAX ERROR: ${file.path}`);
    this._flush(`   ${error}`);
  }

  syntaxRetry(errors) {
    this._flush(`[${this._ts()}] 🔄 SYNTAX FIX RETRY: Sending ${errors.length} error(s) back to agent for correction`);
    for (const e of errors) {
      this._flush(`   - ${e.file.path}: ${e.error.substring(0, 200)}`);
    }
  }

  commandQueued(cmd) {
    this._flush(`[${this._ts()}] [QUEUE] Task is waiting for terminal access...`);
    this._flush(`   Command: ${cmd.command}`);
    if (cmd.description && cmd.description !== cmd.command) {
      this._flush(`   Description: ${cmd.description}`);
    }
  }

  commandExecuted(cmd, result) {
    const ok = result.code === 0;
    this._flush(`[${this._ts()}] ⚡ COMMAND: ${cmd.command}`);
    if (cmd.description && cmd.description !== cmd.command) {
      this._flush(`   Description: ${cmd.description}`);
    }
    this._flush(`   Exit code: ${result.code}${result.killed ? ' (KILLED - timeout)' : ''}`);
    if (result.stdout?.trim()) {
      this._flush(`   stdout: ${result.stdout.trim().substring(0, 500)}`);
    }
    if (result.stderr?.trim()) {
      this._flush(`   stderr: ${result.stderr.trim().substring(0, 500)}`);
    }
    this._flush(`   Result: ${ok ? 'SUCCESS' : 'FAILED'}`);
  }

  needInput(question, options) {
    this._flush(`[${this._ts()}] ⏸ NEED INPUT: ${question}`);
    if (options?.length) {
      this._flush(`   Options: ${options.join(', ')}`);
    }
  }

  userResponse(response) {
    this._flush(`[${this._ts()}] 💬 USER RESPONSE: ${response}`);
  }

  progress(pct) {
    // Only log milestone progress to avoid spam
    if (pct === 25 || pct === 50 || pct === 75 || pct === 97 || pct === 100) {
      this._flush(`[${this._ts()}] ⏳ PROGRESS: ${pct}%`);
    }
  }

  complete(files, commands) {
    this._flush(`────────────────────────────────────────────────────────────`);
    this._flush(`[${this._ts()}] ✅ TASK COMPLETED`);
    this._flush(`   Files written: ${files.length}`);
    files.forEach(f => this._flush(`     - ${f.path}`));
    this._flush(`   Commands executed: ${commands.length}`);
    commands.forEach(c => this._flush(`     - [exit ${c.result?.code ?? '?'}] ${c.command}`));
    this._flush(`────────────────────────────────────────────────────────────\n`);
  }

  error(err) {
    this._flush(`────────────────────────────────────────────────────────────`);
    this._flush(`[${this._ts()}] ❌ TASK FAILED`);
    this._flush(`   Error: ${err}`);
    this._flush(`────────────────────────────────────────────────────────────\n`);
  }
}

// ─── Shared Context Summary ──────────────────────────────────────────────────

const TECH_PATTERNS = [
  { pattern: /\bimport\b.*\bfrom\s+['"]react['"]/, tech: 'React' },
  { pattern: /\bimport\b.*\bfrom\s+['"]next/, tech: 'Next.js' },
  { pattern: /\bimport\b.*\bfrom\s+['"]express['"]/, tech: 'Express.js' },
  { pattern: /\bimport\b.*\bfrom\s+['"]fastify['"]/, tech: 'Fastify' },
  { pattern: /\btailwind/, tech: 'Tailwind CSS' },
  { pattern: /\bimport\b.*\bfrom\s+['"]mongoose['"]/, tech: 'Mongoose' },
  { pattern: /\bimport\b.*\bfrom\s+['"]prisma/, tech: 'Prisma' },
  { pattern: /\bimport\b.*\bfrom\s+['"]socket\.io/, tech: 'Socket.IO' },
  { pattern: /\bimport\b.*\bfrom\s+['"]vue['"]/, tech: 'Vue.js' },
  { pattern: /\bimport\b.*\bfrom\s+['"]svelte/, tech: 'Svelte' },
  { pattern: /\bimport\b.*\bfrom\s+['"]@angular/, tech: 'Angular' },
  { pattern: /\bimport\b.*\bfrom\s+['"]typescript/, tech: 'TypeScript' },
  { pattern: /\bimport\b.*\bfrom\s+['"]zod['"]/, tech: 'Zod' },
  { pattern: /\bimport\b.*\bfrom\s+['"]@trpc/, tech: 'tRPC' },
];

/**
 * Extracts exported function/class names and detects technologies from file content.
 */
function _extractContextFromFiles(files) {
  const exports = [];
  const techSet = new Set();

  for (const file of files) {
    if (!file.content) continue;

    // Extract exported symbols
    const exportMatches = file.content.matchAll(
      /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
    );
    for (const m of exportMatches) {
      exports.push({ name: m[1], file: file.path });
    }

    // Detect technologies
    for (const { pattern, tech } of TECH_PATTERNS) {
      if (pattern.test(file.content)) techSet.add(tech);
    }

    // Detect by file extension
    if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) techSet.add('TypeScript');
    if (file.path.endsWith('.jsx') || file.path.endsWith('.tsx')) techSet.add('React');
    if (file.path.endsWith('.vue')) techSet.add('Vue.js');
    if (file.path.endsWith('.svelte')) techSet.add('Svelte');
  }

  return { exports, technologies: [...techSet] };
}

/**
 * Builds a concise natural-language summary of what a task produced.
 */
function _buildTaskSummary(task, files, exports, technologies, commands) {
  const parts = [];

  // Sentence 1: what was built
  if (files.length > 0) {
    const names = files.slice(0, 5).map(f => f.path.split('/').pop()).join(', ');
    parts.push(`Created ${files.length} file(s): ${names}${files.length > 5 ? '...' : ''}.`);
  }

  // Sentence 2: key exports and tech
  const exportNames = exports.slice(0, 6).map(e => e.name);
  if (exportNames.length > 0 || technologies.length > 0) {
    let s = '';
    if (exportNames.length > 0) s += `Key exports: ${exportNames.join(', ')}${exports.length > 6 ? '...' : ''}`;
    if (technologies.length > 0) s += `${s ? '. ' : ''}Using ${technologies.join(', ')}`;
    parts.push(s + '.');
  }

  // Sentence 3: installed packages
  const installs = (commands || []).filter(c => c.command && /npm install|yarn add|pip install/.test(c.command));
  if (installs.length > 0) {
    const pkgs = installs.map(c => c.command.replace(/^(npm install|yarn add|pip install)\s+/i, '').trim()).join(', ');
    parts.push(`Installed: ${pkgs}.`);
  }

  return parts.join(' ') || `Completed task: ${task.title}.`;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

/**
 * The main orchestrator that runs all tasks through the agent pipeline.
 * Executes batches sequentially, tasks within a batch in parallel.
 */
export class CodingOrchestrator {
  constructor({ workplan, projectContext, settings, projectPath, onTaskUpdate, onBatchComplete, onAllComplete, onError, onNeedInput, onFileWritten, onCommandExecuted }) {
    this.workplan = workplan;
    this.projectContext = projectContext;
    this.settings = settings;
    this.projectPath = projectPath || '';
    this.onTaskUpdate = onTaskUpdate || (() => {});
    this.onBatchComplete = onBatchComplete || (() => {});
    this.onAllComplete = onAllComplete || (() => {});
    this.onError = onError || (() => {});
    this.onNeedInput = onNeedInput || null;
    this.onFileWritten = onFileWritten || null;
    this.onCommandExecuted = onCommandExecuted || null;

    this.executionPlan = buildExecutionPlan(workplan);
    this.batches = buildParallelBatches(this.executionPlan);
    this.isRunning = false;
    this.isCancelled = false;
    this.completedTasks = 0;
    this.totalTasks = this.executionPlan.length;
    this.allFiles = [];
    this._contextSummaryPath = this.projectPath
      ? this.projectPath.replace(/[\\/]$/, '') + '/docs/context_summary.json'
      : '';
  }

  getExecutionPlan() {
    return this.executionPlan;
  }

  getBatches() {
    return this.batches;
  }

  cancel() {
    this.isCancelled = true;
  }

  async run() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isCancelled = false;

    // Load existing context summary into projectContext for injection into prompts
    try {
      if (this._contextSummaryPath) {
        const raw = await api.readFile(this._contextSummaryPath);
        if (raw) {
          const summary = JSON.parse(raw);
          this.projectContext = {
            ...this.projectContext,
            contextSummary: JSON.stringify(summary, null, 2),
          };
        }
      }
    } catch (e) { /* no existing summary */ }

    try {
      for (let batchIdx = 0; batchIdx < this.batches.length; batchIdx++) {
        if (this.isCancelled) break;

        const batch = this.batches[batchIdx];

        // Mark all tasks in batch as running
        for (const task of batch) {
          task.status = 'running';
          task.progress = 0;
          this.onTaskUpdate(task, this.executionPlan);
        }

        // Execute all tasks in batch in parallel
        const promises = batch.map((task) => this._executeTask(task));
        await Promise.allSettled(promises);

        this.onBatchComplete(batchIdx, this.batches.length);
      }

      this.onAllComplete(this.allFiles, this.executionPlan);
    } catch (err) {
      this.onError(err);
    } finally {
      this.isRunning = false;
    }
  }

  async _executeTask(task) {
    task.files = [];
    task.commands = [];
    let lastReportedProgress = -1;

    // Create per-task logger that writes to disk in real-time
    const logger = new TaskLogger(this.projectPath, task.id);
    logger.start(task);

    try {
      await executeTask(task, this.projectContext, this.settings, {
        onToken: (token, count) => {
          // Update task in place
        },
        onProgress: (progress) => {
          const rounded = Math.round(progress);
          if (rounded === lastReportedProgress) return;
          lastReportedProgress = rounded;
          task.progress = rounded;
          logger.progress(rounded);
          this.onTaskUpdate(task, this.executionPlan);
        },
        onComplete: async ({ files, commands, rawOutput, tokenCount }) => {
          task.status = 'done';
          task.progress = 100;
          task.output = rawOutput;
          task.files = files;
          task.commands = commands || [];
          this.completedTasks++;
          this.allFiles.push(...files);
          logger.complete(files, commands || []);
          this.onTaskUpdate(task, this.executionPlan);
          // Update shared context summary
          await this._updateContextSummary(task, files);
        },
        onError: (err) => {
          task.status = 'error';
          task.error = err.message || 'Unknown error';
          task.progress = 0;
          this.completedTasks++;
          logger.error(err.message || 'Unknown error');
          this.onTaskUpdate(task, this.executionPlan);
        },
        onNeedInput: this.onNeedInput
          ? async (question, options) => {
              task.status = 'waiting';
              logger.needInput(question, options);
              this.onTaskUpdate(task, this.executionPlan);
              const response = await this.onNeedInput(task, question, options);
              logger.userResponse(response || '(dismissed)');
              return response;
            }
          : null,
        onFileWritten: (file) => {
          if (!task.files.includes(file)) task.files.push(file);
          logger.fileWritten(file);
          this.onTaskUpdate(task, this.executionPlan);
          if (this.onFileWritten) this.onFileWritten(task, file);
        },
        onSyntaxError: (file, error) => {
          logger.syntaxError(file, error);
          this.onTaskUpdate(task, this.executionPlan);
        },
        onSyntaxRetry: (errors) => {
          logger.syntaxRetry(errors);
          this.onTaskUpdate(task, this.executionPlan);
        },
        onCommandQueued: (cmd) => {
          logger.commandQueued(cmd);
          this.onTaskUpdate(task, this.executionPlan);
        },
        onCommandExecuted: (cmd, result) => {
          task.commands.push({ ...cmd, result });
          logger.commandExecuted(cmd, result);
          this.onTaskUpdate(task, this.executionPlan);
          if (this.onCommandExecuted) this.onCommandExecuted(task, cmd, result);
        },
      }, this.projectPath);
    } catch (err) {
      task.status = 'error';
      task.error = err.message || 'Unknown error';
      this.completedTasks++;
      logger.error(err.message || 'Unknown error');
      this.onTaskUpdate(task, this.executionPlan);
    }
  }

  /**
   * Updates docs/context_summary.json with newly created files, exports, and technologies.
   * Merges with existing summary so all agents share cumulative knowledge.
   */
  async _updateContextSummary(task, files) {
    if (!this._contextSummaryPath || files.length === 0) return;
    try {
      // Load existing summary
      let summary = { files: [], exports: [], technologies: [], completedTasks: [] };
      try {
        const raw = await api.readFile(this._contextSummaryPath);
        if (raw) summary = { ...summary, ...JSON.parse(raw) };
      } catch (e) { /* first time */ }

      // Extract context from newly written files
      const { exports: newExports, technologies: newTech } = _extractContextFromFiles(files);

      // Merge files (deduplicate by path)
      const existingPaths = new Set(summary.files.map(f => f.path));
      for (const file of files) {
        if (!existingPaths.has(file.path)) {
          summary.files.push({ path: file.path, size: file.content?.length || 0 });
          existingPaths.add(file.path);
        }
      }

      // Merge exports (deduplicate by name+file)
      const existingExports = new Set(summary.exports.map(e => `${e.name}@${e.file}`));
      for (const exp of newExports) {
        const key = `${exp.name}@${exp.file}`;
        if (!existingExports.has(key)) {
          summary.exports.push(exp);
          existingExports.add(key);
        }
      }

      // Merge technologies
      const techSet = new Set([...summary.technologies, ...newTech]);
      summary.technologies = [...techSet];

      // Build natural-language summary
      const taskSummary = _buildTaskSummary(task, files, newExports, newTech, task.commands);

      // Track completed task
      summary.completedTasks.push({
        id: task.id,
        title: task.title,
        agent: task.assignedAgent,
        filesWritten: files.map(f => f.path),
        summary: taskSummary,
      });

      summary.updatedAt = new Date().toISOString();

      // Write back
      await api.safeWriteFile(this._contextSummaryPath, JSON.stringify(summary, null, 2));

      // Update projectContext so subsequent tasks in this run get the latest
      this.projectContext = {
        ...this.projectContext,
        contextSummary: JSON.stringify(summary, null, 2),
      };
    } catch (e) {
      console.warn('[CodingOrchestrator] Failed to update context summary:', e);
    }
  }
}
