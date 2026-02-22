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

The user has approved your plan structure. Now generate the complete, detailed task list.

### IMPORTANT — Incremental Output Format:
You MUST output the work plan as **separate blocks**, NOT as one giant JSON.
The system will capture each block and save it to disk immediately. This prevents data loss from output truncation.

**Step 1:** Output the plan header:
\`\`\`plan-header
{
  "projectName": "Project Name",
  "generatedAt": "ISO date string"
}
\`\`\`

**Step 2:** For EACH phase, output a phase block:
\`\`\`phase
{
  "id": "phase-1",
  "name": "Phase 1: Foundation & Setup",
  "description": "Brief description of this phase",
  "order": 1
}
\`\`\`

**Step 3:** Immediately after each phase block, output each task in that phase as a separate block:
\`\`\`task
{
  "id": "task-1-1",
  "phaseId": "phase-1",
  "title": "Short descriptive title",
  "description": "What to build, which files to create/modify, key details.",
  "category": "setup|backend|frontend|integration|testing|devops|documentation",
  "priority": "critical|high|medium|low",
  "order": 1,
  "estimatedHours": 4,
  "dependencies": [],
  "acceptanceCriteria": [
    "Criterion 1",
    "Criterion 2"
  ],
  "technicalNotes": "Implementation hints, file paths, libraries.",
  "tags": ["tag1", "tag2"]
}
\`\`\`

**Step 4:** After ALL phases and tasks, output:
\`\`\`plan-complete
\`\`\`

### Example flow:
You can add brief commentary between blocks. The system only captures the fenced blocks.

\`\`\`plan-header
{ "projectName": "My App", "generatedAt": "2025-01-01T00:00:00Z" }
\`\`\`

Starting with the foundation phase...

\`\`\`phase
{ "id": "phase-1", "name": "Phase 1: Setup", "description": "Project scaffolding", "order": 1 }
\`\`\`

\`\`\`task
{ "id": "task-1-1", "phaseId": "phase-1", "title": "Initialize project", "description": "Create project structure and install dependencies.", "category": "setup", "priority": "critical", "order": 1, "estimatedHours": 2, "dependencies": [], "acceptanceCriteria": ["npm install works", "Project runs"], "technicalNotes": "Use npm init, install express.", "tags": ["setup"] }
\`\`\`

...more tasks...

\`\`\`plan-complete
\`\`\`

### Task Requirements:
1. Every task MUST have ALL fields filled in — no empty or placeholder values.
2. **title** — Clear, action-oriented (e.g., "Create user authentication API endpoints")
3. **description** — 2-4 sentences. What to build, which files, key details. No code snippets.
4. **dependencies** — Array of task IDs that must be completed first
5. **acceptanceCriteria** — 3-5 short, testable one-line items
6. **technicalNotes** — 1-3 sentences. Key hints only, no code blocks.
7. **estimatedHours** — Realistic estimate for a mid-level developer
8. **tags** — 2-4 relevant tags

### Guidelines:
- Tasks should be 2-8 hours each (split larger tasks)
- Group related tasks into logical phases
- First phase should always be project setup/scaffolding
- Include testing tasks alongside feature tasks
- Be specific in technicalNotes — mention file paths, function names, libraries

### MANDATORY — "Project Skeleton Integration" Task:
You MUST add a task titled **"Project Skeleton Integration"** as the **LAST task in EVERY phase**. This task ensures the project actually runs after each phase.

This task must include the following in its description and acceptanceCriteria:
1. **HTML verification**: Run a check (e.g. read the index.html file) to verify that every \`<script src="...">\` and \`<link rel="stylesheet" href="...">\` tag in the HTML points to a file that **actually exists on disk**. List the expected files explicitly.
2. **Entry point validation**: Verify the main entry point file (e.g. \`index.html\`, \`main.jsx\`, \`App.jsx\`) exists and imports/references are correct.
3. **Electron-specific** (if the project uses Electron): The task MUST include creating or verifying a valid \`main.js\` (Electron main process) that:
   - Points to the correct \`index.html\` path via \`mainWindow.loadFile()\` or \`mainWindow.loadURL()\`
   - Has proper \`BrowserWindow\` configuration
   - Includes a valid \`preload.js\` path if needed
4. **Smoke test**: Run the project's start/dev command and confirm it launches without errors.

Example acceptanceCriteria for this task:
- "All <script> and <link> tags in index.html reference files that exist on disk"
- "Running \`npm run dev\` starts the application without errors"
- "main.js loads the correct index.html path" (Electron only)
- "No 404 errors for static assets in the browser console"

Set this task's category to \`"integration"\`, priority to \`"critical"\`, and tag it with \`["skeleton", "integration", "verification"]\`.`,

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

  // Find the start of the JSON object — look for { after a fence or standalone
  // The text may contain nested ``` inside JSON string values, so regex-based
  // fence extraction is unreliable. Instead, find the first '{' that is followed
  // by "phases" somewhere, and use string-aware brace tracking.
  const jsonContent = extractJSONObject(text);
  if (!jsonContent) return result;

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

  result.taskPlanRaw = jsonContent;
  return result;
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
      contextBlock += `\n\n--- UI Components (React + Tailwind, from UI Designer phase) ---\n${contextDocs.uiComponents}\n--- End UI Components ---`;
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
