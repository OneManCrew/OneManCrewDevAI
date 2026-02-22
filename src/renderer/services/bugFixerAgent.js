/**
 * Bug Fixer Agent Service
 * A specialist agent that analyzes bug reports from the user, creates structured
 * bug tickets, assigns them to the appropriate coding agent, and orchestrates fixes.
 * All bugs and fixes are documented to disk in real-time.
 */

import { createLLMProvider, getAgentSettings } from './llmProviders.js';
import { AGENT_TYPES, AGENT_DEFINITIONS, assignAgentToTask, executeTask, TaskLogger } from './codingAgents.js';
import { ASK_USER_TOOL_INSTRUCTION } from './agentTools.js';
import api from './electronBridge.js';

// ─── Phases ─────────────────────────────────────────────────────────────────────

export const BF_PHASES = {
  LOADING: 'loading',
  READY: 'ready',
  ANALYZING: 'analyzing',
  FIXING: 'fixing',
  DONE: 'done',
};

export const BF_PHASE_LABELS = {
  [BF_PHASES.LOADING]: 'Loading',
  [BF_PHASES.READY]: 'Ready',
  [BF_PHASES.ANALYZING]: 'Analyzing Bug',
  [BF_PHASES.FIXING]: 'Fixing',
  [BF_PHASES.DONE]: 'Done',
};

// ─── Bug Severity ───────────────────────────────────────────────────────────────

export const BUG_SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

export const BUG_STATUS = {
  OPEN: 'open',
  ANALYZING: 'analyzing',
  IN_PROGRESS: 'in_progress',
  FIXED: 'fixed',
  FAILED: 'failed',
};

// ─── System Prompt ──────────────────────────────────────────────────────────────

const BUG_ANALYZER_PROMPT = `You are a senior Bug Fixer & QA Specialist with 30+ years of experience in debugging, root cause analysis, and software quality assurance across all technology stacks.

## Your Role
You are the final stage in a software development pipeline. The user will describe bugs, issues, or problems they found in the generated code. Your job is to:
1. **Build a File Map** — ALWAYS scan the full project directory tree FIRST, before any analysis
2. **Check path mismatches** — Compare every path referenced in code against the actual file map on disk
3. Perform a **Root Cause Analysis** — explain WHY the bug happened before fixing it
4. Create a structured bug ticket with all necessary details
5. Determine which specialist agent should fix it
6. Provide clear fix instructions

## Project Context
{PROJECT_CONTEXT}

## Available Tools

### 1. Read Directory (Recursive) — "File Map" (uses \`read_directory_recursive\` / \`fs:readDirRecursive\` IPC)
Before analyzing ANY bug, your **very first action** MUST be to scan the full project directory. This gives you the real "File Map" — the ground truth of what actually exists on disk.
\`\`\`read-directory
{"path": ".", "maxDepth": 4}
\`\`\`
- \`path\` is relative to the project root. Use \`"."\` for the full project.
- \`maxDepth\` controls how deep to scan (default: 4).
- The system will return the full file tree (ignores \`node_modules\`, \`.git\`, \`dist\`). Use it to verify that paths referenced in code actually exist on disk.
- **You MUST use this tool as your FIRST action in every conversation, before any analysis.** This prevents misdiagnosis caused by incorrect path assumptions.
- Think of this as running \`ls -R\` on the project — you need to SEE the real file layout before you can diagnose anything.

### 2. Read File
To inspect a specific file's contents:
\`\`\`read-file
{"path": "src/index.html"}
\`\`\`

### 3. Execute Command (Queued)
Run a shell command in the project directory to gather diagnostic information (e.g., check if a dependency is installed, verify a build output, test a script):
\`\`\`exec-command
{"command": "node --check main.js", "description": "Verify main.js has no syntax errors"}
\`\`\`
Use this for:
- Running \`node --check\` to validate JavaScript files
- Running \`npm ls <package>\` to check if a dependency is installed
- Running \`cat package.json | grep main\` to inspect config values
- Any diagnostic command that helps you understand the bug

Commands run via a sequential queue with a 5-minute timeout. Use this tool **during diagnosis** to gather facts, not just in fix instructions.

## Available Specialist Agents
- **Backend Engineer** (backend) — Server-side, API, database, business logic
- **Frontend Engineer** (frontend) — UI, components, styles, layouts, interactions
- **DevOps Engineer** (devops) — Infrastructure, CI/CD, Docker, deployment, scripts
- **QA Engineer** (testing) — Tests, test frameworks, coverage, assertions
- **Integration Engineer** (integration) — API clients, state management, data flow, wiring
- **Setup Engineer** (setup) — Package management, build tools, project structure, installers

## MANDATORY — Root Cause Analysis Step
Before outputting any \`\`\`bug-report\`\`\` block, you MUST first output a **Root Cause Analysis** section in your response. This section must:
1. **State the symptom** — What the user sees (e.g., "The app shows a blank white screen")
2. **Trace the cause** — Walk through the chain of events that leads to the bug (e.g., "index.html references bundle.js at /dist/bundle.js, but the file was actually generated at /build/bundle.js")
3. **Identify the root cause** — The fundamental reason (e.g., "The Vite config outputs to /build but the HTML template still uses the old /dist path from the webpack era")
4. **Explain the fix approach** — What needs to change and why

Format it as:
### 🔍 Root Cause Analysis
**Symptom:** ...
**Trace:** ...
**Root Cause:** ...
**Fix Approach:** ...

## Output Format
After the Root Cause Analysis, output a structured bug report as a JSON block:

\`\`\`bug-report
{
  "title": "Short descriptive title",
  "severity": "critical|high|medium|low",
  "description": "Detailed description of the bug",
  "rootCause": "Your analysis of what's causing the bug",
  "affectedFiles": ["path/to/file1.js", "path/to/file2.js"],
  "assignedAgent": "backend|frontend|devops|testing|integration|setup",
  "fixInstructions": "Detailed step-by-step instructions for the fixing agent",
  "fixTask": {
    "title": "Fix: Short title",
    "description": "What needs to be changed to fix this bug",
    "acceptanceCriteria": ["The button should respond to clicks", "Controls should work as expected"]
  }
}
\`\`\`

## Auto-Install Permissions
You are authorized to include the following install commands in your fix instructions without asking the user:
- \`npm install --save-dev electron-builder\` — if the project uses Electron and is missing a packaging/installer tool
- \`npm install --save-dev electron\` — if Electron is referenced but not installed
- Any missing \`devDependency\` listed in the HLD or package.json that was not installed during the coding phase

When you detect a missing installer or build tool, include an \`exec-command\` block in your fix instructions so the coding agent installs it automatically.

## Path-Mismatch Diagnosis Protocol
**CRITICAL — CSS / Electron / "not working" bugs:** Before you even THINK about looking at code content, you MUST:
1. Scan the directory tree (\`read-directory\`)
2. Read the HTML file (\`read-file\`)
3. Compare every path in the HTML against the File Map

When the user reports that **CSS is not working**, **JS is not loading**, **styles are missing**, **the page is blank**, **Electron shows a white screen**, or any similar symptom:
1. **Do NOT assume the problem is inside the CSS/JS file itself.** The #1 cause is a **path mismatch** — the HTML references a path that doesn't match the actual file location on disk.
2. **Read the HTML file** using \`\`\`read-file\`\`\` and extract every \`<script src="...">\` and \`<link href="...">\` tag.
3. **Compare each path** against the File Map you scanned. Check:
   - Does the referenced file exist at that exact path?
   - Is the path relative or absolute? Does it resolve correctly from the HTML file's location?
   - Is the file in \`src/\` but the HTML references \`dist/\`? Or vice versa?
   - Is the file extension correct? (e.g., \`.css\` vs \`.scss\`, \`.js\` vs \`.jsx\`)
4. **Only after confirming all paths are correct**, look inside the CSS/JS file for content errors.
5. In your Root Cause Analysis, always include the **expected path** (from HTML) vs **actual path** (from File Map).

This protocol applies to ANY "not working" / "not loading" / "missing" complaint — always check paths first, content second.

## Rules
1. **ALWAYS scan the directory tree first** using \`\`\`read-directory\`\`\` as your VERY FIRST action — before any analysis or diagnosis.
2. **ALWAYS check path mismatches** before looking at file content. The File Map is your source of truth.
3. **ALWAYS output a Root Cause Analysis** before any \`\`\`bug-report\`\`\` block.
4. Always output a \`\`\`bug-report\`\`\` JSON block when you identify a bug.
5. You can output multiple bug reports if the user describes multiple issues.
6. Be thorough in your root cause analysis — trace the actual file paths on disk.
7. Assign to the most appropriate specialist agent.
8. Provide clear, actionable fix instructions.
9. If you need more information, ask the user before creating the bug report.
10. After outputting the bug report, briefly explain your analysis to the user.
11. When path mismatches are the issue, always show: **HTML says:** \`path/in/html\` → **Disk has:** \`actual/path/on/disk\`.

${ASK_USER_TOOL_INSTRUCTION}`;

// ─── Tool Block Parser ──────────────────────────────────────────────────────────

/**
 * Parses ```read-directory, ```read-file, and ```exec-command tool blocks from the LLM output.
 * Returns array of { type, path?, maxDepth?, command?, description? }.
 */
export function parseToolBlocks(output) {
  const tools = [];
  const dirRegex = /```read-directory\s*\n([\s\S]*?)```/g;
  const fileRegex = /```read-file\s*\n([\s\S]*?)```/g;
  const cmdRegex = /```exec-command\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = dirRegex.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      tools.push({ type: 'read-directory', path: parsed.path || '.', maxDepth: parsed.maxDepth || 4 });
    } catch {
      // If not valid JSON, treat as plain path
      const p = match[1].trim();
      if (p) tools.push({ type: 'read-directory', path: p, maxDepth: 4 });
    }
  }

  while ((match = fileRegex.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.path) tools.push({ type: 'read-file', path: parsed.path });
    } catch {
      const p = match[1].trim();
      if (p) tools.push({ type: 'read-file', path: p });
    }
  }

  while ((match = cmdRegex.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.command) tools.push({ type: 'exec-command', command: parsed.command, description: parsed.description || '' });
    } catch {
      const cmd = match[1].trim();
      if (cmd) tools.push({ type: 'exec-command', command: cmd, description: '' });
    }
  }

  return tools;
}

// ─── Bug Report Parser ──────────────────────────────────────────────────────────

export function parseBugReports(output) {
  const bugs = [];
  const regex = /```bug-report\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.title) {
        bugs.push({
          id: 'bug-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
          title: parsed.title,
          severity: parsed.severity || BUG_SEVERITY.MEDIUM,
          description: parsed.description || '',
          rootCause: parsed.rootCause || '',
          affectedFiles: parsed.affectedFiles || [],
          assignedAgent: parsed.assignedAgent || AGENT_TYPES.BACKEND,
          fixInstructions: parsed.fixInstructions || '',
          fixTask: parsed.fixTask || { title: parsed.title, description: parsed.description },
          status: BUG_STATUS.OPEN,
          createdAt: new Date().toISOString(),
          fixResult: null,
        });
      }
    } catch (e) {
      console.warn('[bugFixerAgent] Failed to parse bug report:', e);
    }
  }
  return bugs;
}

export function stripBugReportBlocks(output) {
  return output.replace(/```bug-report\n[\s\S]*?```/g, '').trim();
}

// ─── Build Conversation Messages ────────────────────────────────────────────────

export function buildBugFixerMessages(chatHistory, projectContext) {
  const contextStr = [
    projectContext.projectName ? `**Project:** ${projectContext.projectName}` : '',
    projectContext.srs ? `### SRS\n${projectContext.srs.substring(0, 2000)}` : '',
    projectContext.hld ? `### HLD\n${projectContext.hld.substring(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n');

  const systemPrompt = BUG_ANALYZER_PROMPT.replace('{PROJECT_CONTEXT}', contextStr || 'No project context available.');

  const messages = [{ role: 'system', content: systemPrompt }];

  for (const msg of chatHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

// ─── Checkup Message Builder ────────────────────────────────────────────────────

/**
 * Builds a user message that instructs the bug analyzer to perform an automatic
 * checkup of the generated build against the workplan and SRS requirements.
 */
export function buildCheckupMessage(projectContext, workplan, fileList) {
  const parts = [
    '## Automatic Build Checkup',
    '',
    'Please perform a thorough checkup of the generated project. Compare what was built against the original requirements and workplan.',
    '',
  ];

  if (workplan?.phases?.length) {
    parts.push('### Workplan Tasks');
    for (const phase of workplan.phases) {
      parts.push(`**Phase: ${phase.name || phase.id}**`);
      for (const task of (phase.tasks || [])) {
        parts.push(`- [Task] ${task.title}: ${task.description || ''}`);
        if (task.acceptanceCriteria?.length) {
          task.acceptanceCriteria.forEach(c => parts.push(`  - Criteria: ${c}`));
        }
      }
    }
    parts.push('');
  }

  if (fileList?.length) {
    parts.push('### Generated Files');
    parts.push(fileList.map(f => `- ${f}`).join('\n'));
    parts.push('');
  }

  parts.push('### Instructions');
  parts.push('1. Check if all planned tasks/features were actually implemented');
  parts.push('2. Look for missing files, incomplete implementations, or broken integrations');
  parts.push('3. Verify that acceptance criteria are met');
  parts.push('4. Check for common issues: missing event handlers, broken imports, missing dependencies');
  parts.push('5. For each issue found, create a bug-report block');
  parts.push('6. If everything looks good, say so clearly');
  parts.push('');
  parts.push('Be thorough and systematic. Check every task in the workplan.');

  return parts.join('\n');
}

// ─── Bug Fix Executor ───────────────────────────────────────────────────────────

/**
 * Executes a bug fix by sending the fix task to the appropriate coding agent.
 * Uses the same executeTask infrastructure as the coding phase.
 */
export async function executeBugFix(bug, projectContext, settings, projectPath, callbacks = {}) {
  const { onProgress, onComplete, onError, onFileWritten, onCommandExecuted, onNeedInput } = callbacks;

  // Build a task object compatible with executeTask
  const task = {
    id: bug.id,
    title: bug.fixTask?.title || `Fix: ${bug.title}`,
    description: [
      bug.fixTask?.description || bug.description,
      '',
      '## Root Cause',
      bug.rootCause,
      '',
      '## Fix Instructions',
      bug.fixInstructions,
      '',
      '## Affected Files',
      (bug.affectedFiles || []).map(f => `- ${f}`).join('\n'),
      '',
      '## Acceptance Criteria',
      (bug.fixTask?.acceptanceCriteria || []).map(c => `- ${c}`).join('\n'),
    ].join('\n'),
    assignedAgent: bug.assignedAgent || AGENT_TYPES.BACKEND,
    acceptanceCriteria: bug.fixTask?.acceptanceCriteria || [],
    technicalNotes: bug.fixInstructions,
  };

  // Create logger for this bug fix
  const logger = new TaskLogger(projectPath, bug.id);
  logger.start(task);

  try {
    const result = await executeTask(task, projectContext, settings, {
      onProgress,
      onComplete: (data) => {
        logger.complete(data.files || [], data.commands || []);
        if (onComplete) onComplete(data);
      },
      onError: (err) => {
        logger.error(err.message || 'Unknown error');
        if (onError) onError(err);
      },
      onFileWritten: (file) => {
        logger.fileWritten(file);
        if (onFileWritten) onFileWritten(file);
      },
      onCommandExecuted: (cmd, res) => {
        logger.commandExecuted(cmd, res);
        if (onCommandExecuted) onCommandExecuted(cmd, res);
      },
      onNeedInput: onNeedInput || null,
    }, projectPath);

    return result;
  } catch (err) {
    logger.error(err.message || 'Unknown error');
    throw err;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────────

export async function saveBugs(projectPath, bugs) {
  if (!projectPath) return;
  const filePath = projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/bugs.json';
  try {
    await api.writeFile(filePath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      bugs: bugs.map(b => ({
        ...b,
        fixResult: b.fixResult ? {
          files: (b.fixResult.files || []).map(f => ({ path: f.path })),
          commands: (b.fixResult.commands || []).map(c => ({ command: c.command, description: c.description, code: c.result?.code })),
        } : null,
      })),
    }, null, 2));
  } catch (e) {
    console.warn('[bugFixerAgent] Failed to save bugs:', e);
  }
}

export async function loadBugs(projectPath) {
  if (!projectPath) return [];
  const filePath = projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/bugs.json';
  try {
    const raw = await api.readFile(filePath);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data.bugs || [];
  } catch {
    return [];
  }
}

export async function saveBugChatHistory(projectPath, history) {
  if (!projectPath) return;
  const filePath = projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/bug-chat-history.json';
  try {
    await api.writeFile(filePath, JSON.stringify(history, null, 2));
  } catch (e) {
    console.warn('[bugFixerAgent] Failed to save chat history:', e);
  }
}

export async function loadBugChatHistory(projectPath) {
  if (!projectPath) return [];
  const filePath = projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/bug-chat-history.json';
  try {
    const raw = await api.readFile(filePath);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
