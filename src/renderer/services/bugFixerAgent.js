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
1. Analyze the bug report and understand the root cause
2. Create a structured bug ticket with all necessary details
3. Determine which specialist agent should fix it
4. Provide clear fix instructions

## Project Context
{PROJECT_CONTEXT}

## Available Specialist Agents
- **Backend Engineer** (backend) — Server-side, API, database, business logic
- **Frontend Engineer** (frontend) — UI, components, styles, layouts, interactions
- **DevOps Engineer** (devops) — Infrastructure, CI/CD, Docker, deployment, scripts
- **QA Engineer** (testing) — Tests, test frameworks, coverage, assertions
- **Integration Engineer** (integration) — API clients, state management, data flow, wiring
- **Setup Engineer** (setup) — Package management, build tools, project structure, installers

## Output Format
When the user describes a bug, analyze it and output a structured bug report as a JSON block:

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

## Rules
1. Always output a \`\`\`bug-report\`\`\` JSON block when you identify a bug.
2. You can output multiple bug reports if the user describes multiple issues.
3. Be thorough in your root cause analysis.
4. Assign to the most appropriate specialist agent.
5. Provide clear, actionable fix instructions.
6. If you need more information, ask the user before creating the bug report.
7. After outputting the bug report, briefly explain your analysis to the user.

${ASK_USER_TOOL_INSTRUCTION}`;

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
  const { onProgress, onComplete, onError, onFileWritten, onCommandExecuted } = callbacks;

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
