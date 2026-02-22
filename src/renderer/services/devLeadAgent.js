// ─── Dev Lead Agent ──────────────────────────────────────────────────────────
// Phase-based conversational agent for development planning.
// Reads SRS.md, HLD.md, and UI mockup from previous stages,
// produces a detailed work plan with prioritized tasks.

import { ASK_USER_TOOL_INSTRUCTION } from './agentTools';

export const DL_PHASES = {
  LOADING: 'loading',
  DISCOVERY: 'discovery',
  PLANNING: 'planning',
  CONFIRM: 'confirm',
  GENERATION: 'generation',
  DONE: 'done',
};

export const DL_PHASE_LABELS = {
  [DL_PHASES.LOADING]: 'Loading Context',
  [DL_PHASES.DISCOVERY]: 'Requirements Review',
  [DL_PHASES.PLANNING]: 'Planning',
  [DL_PHASES.CONFIRM]: 'Awaiting Approval',
  [DL_PHASES.GENERATION]: 'Generating Work Plan',
  [DL_PHASES.DONE]: 'Complete',
};

const BASE_PERSONA = `You are "The Dev Lead" — a Senior Development Team Lead with over 30 years of experience in software project management, agile methodologies, and technical leadership. You excel at breaking down complex projects into clear, actionable, well-prioritized tasks that any developer can pick up and execute independently.

Your planning philosophy:
- Every task must be self-contained with clear inputs, outputs, and acceptance criteria
- Tasks are ordered by dependency graph — no task should start before its dependencies are done
- Each task includes the specific files to create/modify, technologies to use, and testing requirements
- You think in terms of vertical slices when possible — delivering working increments
- You always consider infrastructure/setup tasks first, then core features, then polish
${ASK_USER_TOOL_INSTRUCTION}`;

export const DL_PHASE_PROMPTS = {
  [DL_PHASES.DISCOVERY]: `${BASE_PERSONA}

## Your Current Task: REQUIREMENTS REVIEW

You have been given the project documents from previous phases (SRS.md, HLD.md, and possibly UI mockup files).
Your job is to review everything and clarify any gaps before creating the work plan.

### Instructions:
1. Analyze ALL provided documents thoroughly — SRS, HLD, and UI mockup.
2. Identify the major work areas:
   - **Infrastructure & Setup** — project scaffolding, CI/CD, dev environment
   - **Backend/Core** — data models, APIs, business logic
   - **Frontend/UI** — screens, components, navigation
   - **Integration** — connecting frontend to backend, external APIs
   - **Testing** — unit tests, integration tests, E2E
   - **DevOps** — deployment, monitoring, logging
3. Ask the user targeted questions about:
   - Team size and skill levels
   - Timeline expectations
   - Sprint/iteration length preferences
   - Any specific technical constraints or preferences not in the docs
   - MVP scope vs full scope — what to build first?
4. Ask 2-3 questions at a time, not all at once.
5. When you have enough information, end your response with exactly:
   **[DISCOVERY_COMPLETE]**

### Important:
- Do NOT generate the task list yet.
- Focus on understanding priorities and constraints.
- Note any ambiguities or conflicts between the SRS and HLD.`,

  [DL_PHASES.PLANNING]: `${BASE_PERSONA}

## Your Current Task: PLANNING PHASE

You have reviewed all documents and discussed priorities with the user.
Now present your proposed work plan structure for approval.

### Instructions:
Present a high-level overview of the work plan:

1. **Phases/Milestones** — Break the project into logical phases (e.g., Phase 1: Foundation, Phase 2: Core Features, etc.)
2. **Task Categories** — List the categories you'll use (Setup, Backend, Frontend, Integration, Testing, DevOps)
3. **Estimated Task Count** per category
4. **Suggested Priority Order** — Which phase/category comes first and why
5. **Dependencies** — Key dependency chains between tasks
6. **Risk Areas** — Tasks that are complex or risky and might need extra attention

End your response with exactly:
**[PLANNING_COMPLETE]**
Then ask the user to review and approve or request changes.

### Important:
- This is a SUMMARY for approval, not the full detailed task list yet.
- Be specific about what each phase delivers.
- Explain your prioritization reasoning.`,

  [DL_PHASES.GENERATION]: `${BASE_PERSONA}

## Your Current Task: GENERATE DETAILED WORK PLAN

Generate a complete, detailed work plan as a single JSON object inside a \`\`\`json code block.

### OUTPUT FORMAT — Single JSON object:
\`\`\`json
{
  "projectName": "Project Name",
  "phases": [
    {
      "name": "Phase 1: Setup & Scaffolding",
      "description": "What this phase delivers",
      "tasks": [
        {
          "title": "Create project structure with index.html, styles.css, and app.js",
          "description": "Create the base project files. index.html should include <link> to styles.css and <script> to app.js. Set up the HTML skeleton with a container div, clock display area, theme buttons, and font buttons based on the UI mockup.",
          "category": "setup",
          "priority": "critical",
          "estimatedHours": 3,
          "dependencies": [],
          "acceptanceCriteria": [
            "index.html exists with proper DOCTYPE and meta tags",
            "styles.css is linked in the HTML head",
            "app.js is loaded at the bottom of body",
            "Opening index.html in a browser shows the basic layout"
          ],
          "technicalNotes": "Files: index.html, styles.css, app.js. Use semantic HTML5 elements. No frameworks needed."
        }
      ]
    }
  ]
}
\`\`\`

### CRITICAL RULES FOR EVERY TASK:
1. **title** — MUST be specific and action-oriented. NEVER use generic names like "Task 1" or "Setup". Good: "Implement real-time clock update with setInterval". Bad: "Task 3".
2. **description** — 2-4 sentences. MUST mention specific file names to create/modify and what code to write. A developer reading this should know exactly what to do.
3. **category** — One of: setup, backend, frontend, integration, testing, devops, documentation
4. **priority** — One of: critical, high, medium, low
5. **estimatedHours** — Realistic number (2-8 hours per task)
6. **acceptanceCriteria** — 3-5 testable items. Each must be verifiable (e.g., "Clicking the Dark theme button changes background to #1a1a2e")
7. **technicalNotes** — Mention specific file paths, function names, CSS class names, DOM selectors, or libraries to use.

### TASK QUALITY CHECKLIST:
- Does the title describe a concrete deliverable?
- Does the description mention which files to create or modify?
- Can a developer implement this task without asking questions?
- Are the acceptance criteria testable by looking at the running app?

### Guidelines:
- Tasks should be 2-8 hours each
- First phase: project setup/scaffolding
- Last task in each phase: "Integration Verification" (category: "integration", priority: "critical") — verify all files reference each other correctly and the app runs
- Be specific — mention file names, CSS class names, function names, DOM element IDs
- Reference the UI mockup and SRS when describing visual/functional requirements`,

  [DL_PHASES.DONE]: `${BASE_PERSONA}

## Your Current Task: WORK PLAN REVIEW & MODIFICATIONS

The work plan has been generated and saved. The user can now review individual tasks and request modifications.

### Instructions:
1. Listen to the user's feedback about specific tasks or the overall plan.
2. If the user requests changes, output the UPDATED complete work plan in the same format:

\`\`\`taskplan
{
  ... complete updated JSON ...
}
\`\`\`

3. If the user asks about a specific task, explain it in detail.
4. If the user wants to add/remove/reorder tasks, make the changes and output the full updated plan.
5. Always maintain consistency — update dependencies, order numbers, and summary when changing tasks.

### Important:
- Always output the COMPLETE JSON, not partial updates.
- Keep task IDs stable when possible (don't renumber everything for small changes).
- Update the summary section to reflect any changes.
- If adding tasks, ensure they fit logically into the phase structure.`,
};

// ─── Phase Detection ───────────────────────────────────────────────────────────

export function detectDLPhaseTransition(responseText, currentPhase) {
  if (currentPhase === DL_PHASES.DISCOVERY && responseText.includes('[DISCOVERY_COMPLETE]')) {
    return DL_PHASES.PLANNING;
  }
  if (currentPhase === DL_PHASES.PLANNING && responseText.includes('[PLANNING_COMPLETE]')) {
    return DL_PHASES.CONFIRM;
  }
  return null;
}

/**
 * Check if user message is an approval to proceed from CONFIRM → GENERATION.
 */
export function isDLApproval(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  const approvalPatterns = [
    /^(yes|yep|yeah|yup|sure|ok|okay|approve|approved|confirm|confirmed|go ahead|proceed|looks good|lgtm|אשר|מאושר|בסדר|כן|קדימה|תמשיך|אפשר להמשיך)/,
    /\b(approve|confirm|go ahead|proceed|looks good|lgtm|agreed|accept)\b/,
  ];
  return approvalPatterns.some((p) => p.test(msg));
}

// ─── Workplan Normalizer ─────────────────────────────────────────────────────
// Different LLMs produce different JSON field names. This normalizer converts
// any format to the expected schema used by TaskBoard and CodingPhase.

export function normalizeWorkplan(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const plan = {};

  // Helper: pick first truthy value from an object by multiple candidate keys
  const pick = (obj, ...keys) => { for (const k of keys) { if (obj[k]) return obj[k]; } return undefined; };

  // Normalize header fields
  const hdr = raw['plan-header'] || raw['planHeader'] || {};
  plan.projectName = pick(raw, 'projectName', 'project-name', 'project_name') ||
    pick(hdr, 'projectName', 'project-name', 'project_name') || 'Untitled Project';
  plan.generatedAt = pick(raw, 'generatedAt', 'generated-date', 'generated_date', 'created_date') ||
    pick(hdr, 'generatedAt', 'generated-date', 'generated_date', 'created_date') || new Date().toISOString();

  // Normalize phases
  const rawPhases = raw.phases || [];
  plan.phases = rawPhases.map((p, pi) => {
    const phase = {
      id: pick(p, 'id', 'phase_id', 'phaseId') || `phase-${pi + 1}`,
      name: pick(p, 'name', 'phase-name', 'phase_name') || `Phase ${pi + 1}`,
      description: pick(p, 'description', 'phase-description', 'phase_description') || '',
      order: p.order || pi + 1,
      tasks: [],
    };

    const rawTasks = p.tasks || [];
    phase.tasks = rawTasks.map((t, ti) => {
      // Parse estimated hours from various formats (e.g. "4 hours", "2h", 3)
      let hours = t.estimatedHours || 0;
      const effortStr = t['estimated-effort'] || t['estimated_effort'] || t.duration || '';
      if (!hours && effortStr) {
        const m = String(effortStr).match(/(\d+)/);
        if (m) hours = parseInt(m[1], 10);
      }

      const taskTitle = pick(t, 'title', 'task-name', 'task_name') || `Task ${ti + 1}`;
      const taskDesc = pick(t, 'description', 'task-description', 'task_description') || '';

      return {
        id: String(pick(t, 'id', 'task_id', 'taskId') || `task-${pi + 1}-${ti + 1}`),
        phaseId: phase.id,
        title: taskTitle,
        description: taskDesc,
        category: t.category || guessCategory(taskTitle),
        priority: (t.priority || 'medium').toLowerCase(),
        order: t.order || ti + 1,
        estimatedHours: hours,
        dependencies: (t.dependencies || []).map(String),
        acceptanceCriteria: t.acceptanceCriteria || t.acceptance_criteria || [],
        technicalNotes: t.technicalNotes || t.technical_notes || t.notes || '',
        tags: t.tags || [],
        status: (t.status || 'pending').toLowerCase().replace(/\s+/g, '_').replace('not_started', 'pending'),
      };
    });

    return phase;
  });

  // Build summary
  const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
  const totalHours = plan.phases.reduce((sum, p) =>
    sum + p.tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0), 0);
  const catCounts = {};
  plan.phases.forEach(p => p.tasks.forEach(t => {
    catCounts[t.category] = (catCounts[t.category] || 0) + 1;
  }));

  plan.summary = raw.summary || {
    totalTasks,
    totalEstimatedHours: totalHours,
    criticalPath: [],
    categories: catCounts,
  };

  return plan;
}

function guessCategory(title) {
  const t = title.toLowerCase();
  if (/setup|init|config|scaffold|install|environment|repository/.test(t)) return 'setup';
  if (/test|qa|quality|unit test|integration test/.test(t)) return 'testing';
  if (/deploy|ci|cd|docker|build|package/.test(t)) return 'devops';
  if (/ui|frontend|component|layout|style|css|responsive|design|theme|font|animation/.test(t)) return 'frontend';
  if (/api|backend|server|database|model|endpoint/.test(t)) return 'backend';
  if (/doc|readme|guide/.test(t)) return 'documentation';
  if (/integrat|connect|wire|state/.test(t)) return 'integration';
  return 'frontend';
}

// ─── Incremental Plan Builder (streaming tool-like approach) ─────────────────

/**
 * Parses streaming LLM output for fenced blocks (```plan-header, ```phase, ```task, ```plan-complete)
 * and accumulates them into a workplan. Calls onSave after each new block is captured.
 */
export class IncrementalPlanBuilder {
  constructor({ onTaskAdded, onPhaseAdded, onPlanComplete, onSave }) {
    this.header = null;
    this.phases = [];       // { ...phaseData, tasks: [] }
    this.currentPhaseId = null;
    this.taskCount = 0;
    this.complete = false;
    this.lastParsedLength = 0;  // track how far we've parsed in the stream

    this.onTaskAdded = onTaskAdded || (() => {});
    this.onPhaseAdded = onPhaseAdded || (() => {});
    this.onPlanComplete = onPlanComplete || (() => {});
    this.onSave = onSave || (() => {});
  }

  /**
   * Feed the full accumulated text so far. Extracts any NEW complete blocks
   * since the last call.
   */
  update(fullText) {
    // Only scan new content, but we need context for block boundaries,
    // so re-scan from a safe point (before last parsed, minus some overlap for partial blocks)
    const scanFrom = Math.max(0, this.lastParsedLength - 10);
    const text = fullText.substring(scanFrom);

    // Find all complete fenced blocks in the text
    const blockRegex = /```(plan-header|phase|task|plan-complete)\s*\n?([\s\S]*?)```/g;
    let match;
    while ((match = blockRegex.exec(text)) !== null) {
      const absolutePos = scanFrom + match.index + match[0].length;
      if (absolutePos <= this.lastParsedLength) continue; // already processed

      const blockType = match[1];
      const blockContent = match[2].trim();

      try {
        if (blockType === 'plan-header') {
          this.header = JSON.parse(blockContent);
        } else if (blockType === 'phase') {
          const phase = JSON.parse(blockContent);
          // Check if phase already exists (idempotent)
          if (!this.phases.find(p => p.id === phase.id)) {
            this.phases.push({ ...phase, tasks: [] });
            this.currentPhaseId = phase.id;
            this.onPhaseAdded(phase);
          }
        } else if (blockType === 'task') {
          const task = JSON.parse(blockContent);
          const phaseId = task.phaseId || this.currentPhaseId;
          let phase = this.phases.find(p => p.id === phaseId);
          if (!phase && this.phases.length > 0) {
            phase = this.phases[this.phases.length - 1]; // fallback to last phase
          }
          if (phase && !phase.tasks.find(t => t.id === task.id)) {
            const { phaseId: _, ...taskWithoutPhaseId } = task;
            phase.tasks.push(taskWithoutPhaseId);
            this.taskCount++;
            this.onTaskAdded(task, phase);
          }
        } else if (blockType === 'plan-complete') {
          this.complete = true;
          this.onPlanComplete();
        }

        // Save after each successful block
        this.onSave(this.buildPlan());
      } catch (e) {
        console.warn(`IncrementalPlanBuilder: Failed to parse ${blockType} block:`, e.message);
      }

      this.lastParsedLength = absolutePos;
    }
  }

  /**
   * Build the final workplan.json structure from accumulated data.
   */
  buildPlan() {
    const totalTasks = this.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const totalHours = this.phases.reduce((sum, p) =>
      sum + p.tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0), 0);

    return {
      projectName: this.header?.projectName || 'Untitled Project',
      generatedAt: this.header?.generatedAt || new Date().toISOString(),
      phases: this.phases,
      summary: {
        totalTasks,
        totalEstimatedHours: totalHours,
        criticalPath: [],
        categories: this.phases.reduce((cats, p) => {
          for (const t of p.tasks) {
            cats[t.category] = (cats[t.category] || 0) + 1;
          }
          return cats;
        }, {}),
      },
    };
  }

  hasContent() {
    return this.taskCount > 0 || this.phases.length > 0;
  }
}

// ─── Output Parser (legacy fallback for single-JSON output) ──────────────────

export function parseDevLeadOutput(text) {
  const result = { taskPlan: null, truncated: false };

  // Strategy 1: Extract JSON object from text
  const jsonContent = extractJSONObject(text);
  if (jsonContent) {
    // Try parsing as-is first
    try {
      const parsed = JSON.parse(jsonContent);
      if (parsed && (parsed.phases || parsed.tasks)) {
        result.taskPlan = parsed;
        return result;
      }
    } catch (e) { /* try salvaging */ }

    // Salvage truncated JSON: close open brackets/braces
    const salvaged = salvageTruncatedJSON(jsonContent);
    if (salvaged) {
      try {
        const parsed = JSON.parse(salvaged);
        if (parsed && (parsed.phases || parsed.tasks)) {
          result.taskPlan = parsed;
          result.truncated = true;
          return result;
        }
      } catch (e) {
        console.warn('Failed to parse even after salvage:', e.message?.substring(0, 100));
      }
    }
  }

  // Strategy 2: Parse markdown-formatted work plan (local models often output this)
  const mdPlan = parseMarkdownWorkplan(text);
  if (mdPlan && mdPlan.phases && mdPlan.phases.length > 0) {
    result.taskPlan = mdPlan;
    return result;
  }

  if (jsonContent) result.taskPlanRaw = jsonContent;
  return result;
}

/**
 * Parses a markdown-formatted work plan into the expected JSON schema.
 * Handles formats like:
 *   ### Phase 1: Name
 *   #### Task 1.1: Title
 *   **Description:** ...
 *   **Duration:** 2 days
 *   **Dependencies:** Task 1.1
 *   **Deliverables:** / **Status:**
 */
function parseMarkdownWorkplan(text) {
  // Check if this looks like a markdown work plan (has phase/task headers)
  if (!text.match(/###?\s+(?:Phase|Task)\s/i)) return null;

  const lines = text.split('\n');
  const plan = { projectName: '', phases: [] };

  // Try to extract project title from **Project Title:** or first # heading
  const titleMatch = text.match(/\*\*Project\s+Title:\*\*\s*(.+)/i) || text.match(/^#\s+(.+)/m);
  if (titleMatch) plan.projectName = titleMatch[1].trim();

  let currentPhase = null;
  let currentTask = null;
  let collectingField = null; // which multi-line field we're collecting (e.g. 'deliverables')

  function flushTask() {
    if (currentTask && currentPhase) {
      currentPhase.tasks.push(currentTask);
      currentTask = null;
    }
    collectingField = null;
  }

  function flushPhase() {
    flushTask();
    if (currentPhase) {
      plan.phases.push(currentPhase);
      currentPhase = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Phase header: ### Phase 1: Name  or  ## Phase 1: Name
    const phaseMatch = trimmed.match(/^#{2,3}\s+Phase\s*\d*[:.]\s*(.+)/i);
    if (phaseMatch) {
      flushPhase();
      currentPhase = {
        name: phaseMatch[1].trim(),
        description: '',
        tasks: [],
      };
      collectingField = null;
      continue;
    }

    // Task header: #### Task 1.1: Title  or  #### Task 1.1 — Title
    const taskMatch = trimmed.match(/^#{3,4}\s+Task\s*[\d.]+[:.—\-]\s*(.+)/i);
    if (taskMatch) {
      flushTask();
      currentTask = {
        title: taskMatch[1].trim(),
        description: '',
        dependencies: [],
        acceptanceCriteria: [],
        technicalNotes: '',
        estimatedHours: 0,
      };
      collectingField = null;
      continue;
    }

    if (!currentTask && !currentPhase) continue;

    // Field extraction from **Key:** Value lines
    const fieldMatch = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)/);
    if (fieldMatch) {
      const key = fieldMatch[1].toLowerCase().trim();
      const val = fieldMatch[2].trim();

      if (currentTask) {
        if (key === 'description') {
          currentTask.description = val;
          collectingField = null;
        } else if (key === 'duration' || key === 'estimated duration' || key === 'time') {
          const hourMatch = val.match(/(\d+)\s*(?:hour|hr)/i);
          const dayMatch = val.match(/(\d+(?:\.\d+)?)\s*day/i);
          if (hourMatch) currentTask.estimatedHours = parseInt(hourMatch[1], 10);
          else if (dayMatch) currentTask.estimatedHours = Math.round(parseFloat(dayMatch[1]) * 8);
          collectingField = null;
        } else if (key === 'dependencies' || key === 'depends on') {
          if (val && val.toLowerCase() !== 'none') {
            currentTask.dependencies = val.split(/[,;]/).map(d => d.trim()).filter(Boolean);
          }
          collectingField = null;
        } else if (key === 'deliverables' || key === 'acceptance criteria') {
          collectingField = 'deliverables';
          if (val) currentTask.acceptanceCriteria.push(val);
        } else if (key === 'status') {
          collectingField = null;
        } else if (key === 'technical notes' || key === 'notes') {
          currentTask.technicalNotes = val;
          collectingField = null;
        }
      } else if (currentPhase) {
        if (key === 'phase description' || key === 'description') {
          currentPhase.description = val;
        }
      }
      continue;
    }

    // Collect bullet items for deliverables/acceptance criteria
    if (collectingField === 'deliverables' && currentTask) {
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (bulletMatch) {
        currentTask.acceptanceCriteria.push(bulletMatch[1].trim());
        continue;
      }
      // Non-bullet, non-field line ends the collection
      if (trimmed) collectingField = null;
    }
  }

  // Flush remaining
  flushPhase();

  if (plan.phases.length === 0) return null;
  return plan;
}

/**
 * Extract the main JSON object from text, handling nested ``` inside JSON strings.
 * Scans character-by-character, respecting JSON string escaping, to find the
 * complete (or truncated) top-level { ... } object that contains "phases".
 */
function extractJSONObject(text) {
  // Find candidate start positions — { characters that could be the plan root
  let startIdx = -1;

  // Prefer { right after a ```taskplan or ```json fence
  const fenceMatch = text.match(/```(?:taskplan|json)\s*\n/);
  if (fenceMatch) {
    const afterFence = fenceMatch.index + fenceMatch[0].length;
    const nextBrace = text.indexOf('{', afterFence);
    if (nextBrace !== -1 && nextBrace - afterFence < 20) startIdx = nextBrace;
  }

  // Fallback: find first { before "phases"
  if (startIdx === -1) {
    const phasesIdx = text.indexOf('"phases"');
    if (phasesIdx === -1) return null;
    // Search backwards from "phases" to find the opening {
    for (let i = phasesIdx; i >= 0; i--) {
      if (text[i] === '{') { startIdx = i; break; }
    }
  }

  if (startIdx === -1) return null;

  // Now scan from startIdx, tracking brace depth while respecting JSON strings
  let depth = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    // Outside string
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  if (endIdx > startIdx) {
    // Complete JSON object found
    return text.substring(startIdx, endIdx);
  }

  // Truncated — return everything from start to end of text
  if (depth > 0) {
    return text.substring(startIdx);
  }

  return null;
}

/**
 * Attempt to close truncated JSON by removing the last incomplete value
 * and closing all open brackets/braces.
 */
function salvageTruncatedJSON(json) {
  // Remove trailing incomplete string/value: find last complete property
  // Strategy: progressively trim from the end until we find a valid close point
  let trimmed = json;

  // Remove any trailing incomplete string literal
  // Find the last complete JSON structure point (after a }, ], or complete value)
  const lastGoodPoints = [];
  let inString = false;
  let escape = false;
  let depth = { brace: 0, bracket: 0 };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth.brace++;
    else if (ch === '}') { depth.brace--; lastGoodPoints.push({ pos: i + 1, ...{ ...depth } }); }
    else if (ch === '[') depth.bracket++;
    else if (ch === ']') { depth.bracket--; lastGoodPoints.push({ pos: i + 1, ...{ ...depth } }); }
  }

  // Find the last point where we had a complete } or ] and try closing from there
  for (let i = lastGoodPoints.length - 1; i >= 0; i--) {
    const point = lastGoodPoints[i];
    let attempt = trimmed.substring(0, point.pos);

    // Count remaining open brackets/braces from this point
    let openBraces = 0, openBrackets = 0;
    let inStr = false, esc = false;
    for (let j = 0; j < attempt.length; j++) {
      const c = attempt[j];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') openBraces++;
      else if (c === '}') openBraces--;
      else if (c === '[') openBrackets++;
      else if (c === ']') openBrackets--;
    }

    // Close remaining open structures
    let closing = '';
    for (let j = 0; j < openBrackets; j++) closing += ']';
    for (let j = 0; j < openBraces; j++) closing += '}';

    attempt += closing;

    try {
      JSON.parse(attempt);
      return attempt;
    } catch (e) { /* try next point */ }
  }

  return null;
}

// ─── Conversation Builder ──────────────────────────────────────────────────────

export function buildDLConversationMessages(chatHistory, currentPhase, contextDocs) {
  const systemPrompt = DL_PHASE_PROMPTS[currentPhase] || DL_PHASE_PROMPTS[DL_PHASES.DISCOVERY];

  // Build context from all previous stage outputs
  let contextBlock = '';
  if (contextDocs) {
    if (contextDocs.srs) {
      contextBlock += `\n\n--- SRS.md (from Architect phase) ---\n${contextDocs.srs}\n--- End SRS.md ---`;
    }
    if (contextDocs.hld) {
      contextBlock += `\n\n--- HLD.md (from Architect phase) ---\n${contextDocs.hld}\n--- End HLD.md ---`;
    }
    if (contextDocs.uiComponents) {
      contextBlock += `\n\n--- UI Mockup (HTML + CSS + JS, from UI Designer phase) ---\n${contextDocs.uiComponents}\n--- End UI Mockup ---`;
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt + contextBlock },
  ];

  // Add conversation history (skip system messages and empty assistant placeholders)
  for (const msg of chatHistory) {
    if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Safety: ensure last message is 'user' (required by Anthropic)
  if (messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    messages.pop();
  }

  return messages;
}
