# 💻 The Coding Agents (6 Specialists)

> **Six specialist coding agents** that execute tasks from the Dev Lead's workplan in parallel, writing real files and running commands on disk.

## Purpose

The Coding Agents are the **fourth stage** in the pipeline. They receive the structured workplan from the Dev Lead and execute each task by generating production-quality code, writing files to disk, and running shell commands (e.g., `npm install`). An **Orchestrator** manages execution order, parallelism, dependency tracking, and real-time progress. Every task passes through **syntax validation** and a **QualityGate** shadow reviewer before being marked as done.

## Source Files

| File | Role |
|------|------|
| `src/renderer/services/codingAgents.js` | Agent definitions, system prompts, task assignment, file/command/env extraction, orchestrator |
| `src/renderer/services/tokenUsageTracker.js` | Singleton token usage tracker — tracks input/output tokens, estimated cost, persists to `project_knowledge.json` |
| `src/renderer/components/CodingPhase.jsx` | UI component (task board, progress tracking, agent chat modal) |
| `src/renderer/components/TokenUsageBadge.jsx` | TitleBar badge showing total tokens used + estimated cost |

---

## The 6 Specialist Agents

| Agent | ID | Emoji | Description |
|-------|----|-------|-------------|
| **Backend Engineer** | `backend` | ⚙️ | Server-side & API specialist. Node.js, Java, Python, C, C++, C#, Go and all related frameworks. |
| **Frontend Engineer** | `frontend` | 🎨 | UI implementation specialist. HTML, CSS, JavaScript, TypeScript, React, Angular, Vue, Svelte, Tailwind. |
| **DevOps Engineer** | `devops` | 🔧 | Infrastructure & CI/CD specialist. Docker, Kubernetes, Terraform, Ansible, Nginx, cloud platforms. |
| **QA Engineer** | `testing` | 🧪 | Testing & quality specialist. Unit, integration, E2E testing. Jest, Mocha, Cypress, Playwright, Pytest. |
| **Integration Engineer** | `integration` | 🔗 | System integration specialist. API clients, state management, data flow, wiring frontend to backend. |
| **Setup Engineer** | `setup` | 📦 | Installation & packaging specialist. Installers, build tools, project scaffolding, dependency management. |

### Task Assignment Logic

Tasks are assigned to agents via **keyword scoring** in `assignAgentToTask()`:
1. The task's `title`, `description`, `technicalNotes`, and `phaseName` are concatenated and lowercased
2. Each agent's keyword list is matched against the text
3. Multi-word keywords score 3 points, single-word keywords score 1 point
4. The agent with the highest score wins (default fallback: Backend Engineer)

Each agent definition includes a `keywords` array. Examples:
- **Backend:** `api`, `database`, `middleware`, `auth`, `rest`, `graphql`, `orm`, `migration`
- **Frontend:** `component`, `layout`, `css`, `jsx`, `react`, `tailwind`, `responsive`, `animation`
- **DevOps:** `docker`, `kubernetes`, `deploy`, `pipeline`, `terraform`, `nginx`, `ci`, `cd`
- **QA:** `test`, `jest`, `cypress`, `coverage`, `mock`, `assertion`, `tdd`
- **Integration:** `connect`, `wire`, `api client`, `state management`, `redux`, `data flow`
- **Setup:** `install`, `package`, `webpack`, `vite`, `npm`, `scaffold`, `boilerplate`

---

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| **workplan.json** | `{projectPath}/docs/dev-lead/workplan.json` | Structured task plan from Dev Lead |
| **SRS.md** | `{projectPath}/docs/SRS.md` | Software Requirements Specification |
| **HLD.md** | `{projectPath}/docs/HLD.md` | High-Level Design |
| **UI Mockup HTML** | `{projectPath}/docs/ui/index.html` | HTML mockup from UI Designer |
| **User interaction** | Agent Chat Modal | User can respond to `need-input` requests from agents |

### Context Injection (per task)

Each task's system prompt includes the full project context:
```
## Project Context
**Project:** {projectName}

### Software Requirements Specification (SRS)
{srs content}

### High-Level Design (HLD)
{hld content}

### UI Components (React + Tailwind)
{uiComponents content}

### CURRENT PROJECT STATE
{context_summary.json — files, exports, technologies, entities, task summaries}

## Your Current Task
**Task ID:** {task.id}
**Title:** {task.title}
**Description:** {task.description}
**Acceptance Criteria:** {task.acceptanceCriteria}
**Technical Notes:** {task.technicalNotes}
```

The **CURRENT PROJECT STATE** section is loaded from `docs/context_summary.json` and includes:
- All files created by previous tasks (path, size)
- Exported functions/classes per file
- Detected technologies (React, Express, Tailwind, etc.)
- Structured entities: functions, components, API routes, environment variables
- LLM-generated 2-sentence summaries per completed task

This ensures the Frontend Engineer knows exactly which API routes the Backend Engineer just built.

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| **Source files** | `{projectPath}/src/**/*` | All generated code files |
| **Task logs** | `{projectPath}/docs/dev-lead/task-logs/{taskId}.log` | Real-time execution log per task |
| **context_summary.json** | `{projectPath}/docs/context_summary.json` | Shared Knowledge Base (auto-updated after each task) |

---

## System Prompt

Each agent receives a system prompt built by `buildAgentSystemPrompt()` that includes:

1. **Agent persona** — Role description with years of experience
2. **Project context** — Full SRS, HLD, and UI mockup
3. **Current task** — ID, title, description, acceptance criteria, technical notes
4. **Tool definitions** — How to write files, run commands, and request user input

## Tools

The coding agents have **three tools**, invoked via fenced code blocks in the LLM output:

### 1. Write File
```
```file:path/to/filename.ext
// Complete file contents here
```​
```
- Writes a file to `{projectPath}/src/{path}`
- Parent directories are created automatically
- Files are written to disk **in real-time** as the LLM streams output (via `IncrementalFileExtractor`)

### 2. Run Shell Command
```
```exec-command
{"command": "npm install express", "description": "Install Express.js framework"}
```​
```
- Executes in the project root directory
- Used for: installing packages, running build commands, any shell operation
- Commands are executed **in real-time** during streaming (via `IncrementalCommandExtractor`)
- Results (exit code, stdout, stderr) are logged to the task log

### 3. Set Environment Variable
```
```set-env-variable
{"key": "DATABASE_URL", "value": "postgresql://localhost:5432/mydb", "description": "PostgreSQL connection string"}
```​
```
- Adds or updates a variable in the project's `.env` file
- If the variable already exists, it is updated; otherwise appended
- For **secrets/credentials** the user must provide: set `value` to `"ASK_USER"` — the system prompts the user to enter it
- For **generated values** (ports, URLs, app names): set the value directly
- Processed in real-time during streaming via `IncrementalEnvVarExtractor`
- Sensitive keys (containing `key`, `secret`, `password`, `token`) are automatically masked in task logs

### 4. Request User Input
```
```need-input
{"question": "Your question here", "options": ["Option A", "Option B"]}
```​
```
- Pauses execution and shows a modal dialog to the user
- `options` array is optional — only for specific choices
- After user responds, the agent receives the answer and continues (up to 5 turns total)
- Only used when truly blocked (not for trivial decisions)

### Rules for Agents
1. Every file must be COMPLETE — no placeholders, no `// TODO`, no `...` abbreviations
2. Include all imports, exports, and dependencies
3. Follow the project's existing code style
4. Use modern best practices
5. Install dependencies BEFORE writing code that uses them
6. Do NOT output explanations outside of code blocks

### Setup Engineer — Mandatory Requirements

When `agentType === 'setup'`, the system prompt includes additional mandatory rules:

1. **HARD RULE — Electron Projects** — For every Electron/Desktop/Standalone project:
   - Must create `main.js` with `BrowserWindow`, `loadFile('index.html')`, and proper lifecycle events
   - Must set `"main": "main.js"` and `"start": "electron ."` in `package.json`
   - Must install `electron` and `electron-builder` (or `@electron-forge/cli`)
   - Must configure the packaging tool in `package.json`
2. **Directory Scaffolding** — Must create ALL project directories from the HLD (`src/`, `public/`, `dist/`, etc.) BEFORE writing files
3. **Complete `package.json` Scripts** — Must include: `dev`, `build`, `package`, `start`, `lint` — all real working commands
4. **HARD RULE — Syntax Validation** — Must run `node --check` on the main entry file before completing the task; if it fails, fix and re-check
5. **README.md** — Must create in project root with: project name, prerequisites, installation, development, building, packaging, project structure, tech stack

---

## Orchestrator (`CodingOrchestrator`)

The orchestrator manages the execution of all tasks:

### Execution Model
1. **`buildExecutionPlan(workplan)`** — Flattens all tasks, assigns agents, sorts by phase order then task order
2. **`buildParallelBatches(executionPlan)`** — Groups tasks into batches:
   - Tasks within the **same phase** run in **parallel**
   - Tasks in **different phases** run **sequentially**
3. **`run()`** — Iterates through batches, executing all tasks in each batch via `Promise.allSettled`

### Per-Task Execution Flow
1. Build system prompt with agent persona + project context + task details + shared knowledge
2. Send to LLM with streaming enabled
3. As tokens stream in:
   - `IncrementalFileExtractor` detects completed ```` ```file:... ``` ```` blocks → writes to disk via `safeWriteFile` (with file locking)
   - `IncrementalCommandExtractor` detects completed ```` ```exec-command ``` ```` blocks → executes via sequential command queue (300s timeout)
   - `IncrementalEnvVarExtractor` detects completed ```` ```set-env-variable ``` ```` blocks → writes to `.env` via IPC (supports `ASK_USER` flow for secrets)
   - `TaskLogger` writes real-time log entries to disk
4. **Syntax Validation** — After each `.js`/`.jsx` file is written, runs `node --check` to validate syntax. If errors found, injects error back to LLM for auto-fix (max 2 retries)
5. If ```` ```need-input ``` ```` is detected → pause, show modal to user, wait for response, continue (up to 5 turns)
6. **QualityGate** — Shadow LLM reviewer verifies code against task requirements + SRS. If it fails, injects feedback to agent for correction (max 2 rounds)
7. On completion → update `context_summary.json` (files, exports, technologies, LLM-generated entity index + summary), mark task as `done`

### Task Statuses
| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `blocked` | Waiting on tasks in a previous batch to complete (shows dependency via `_blockedBy`) |
| `running` | Currently being executed by an agent |
| `waiting` | Agent needs user input (`need-input`) |
| `done` | Successfully completed (passed syntax check + QualityGate) |
| `error` | Failed with an error |

### Stop-on-Failure

When a task fails with an error:
1. All tasks in subsequent batches are marked as `blocked`
2. The `onFailureDecision` callback is invoked, asking the user to **continue** or **stop**
3. If stopped, remaining tasks stay blocked and the orchestrator halts
4. If continued, blocked tasks are unblocked and execution resumes

### Shared Knowledge Base (`context_summary.json`)

After each successful task, the orchestrator updates `docs/context_summary.json` with:
- **Files** — path and size of every file written
- **Exports** — exported functions/classes extracted via regex
- **Technologies** — detected from import patterns (React, Express, Tailwind, etc.)
- **Entities** — LLM-generated structured index: `{ functions, components, apiRoutes, envVars }`
- **Task summaries** — LLM-generated 2-sentence summary per task (files created + API/Props interfaces)

This file is loaded at orchestrator start and injected into every agent's system prompt under `### CURRENT PROJECT STATE`.

### QualityGate (Shadow Reviewer)

Before marking a task as done, a lightweight shadow LLM call reviews the output:
- Receives: task title, description, acceptance criteria, SRS context, file export summaries
- Returns: `{ passed: true/false, feedback: "..." }`
- Pragmatic — only fails for genuinely missing functionality, not style issues
- Max 2 review rounds per task

### Integration Check (Post-Phase Validation)

After **every batch/phase** completes, the orchestrator automatically runs `runIntegrationCheck()` from `agentTools.js`. This tool performs:

1. **HTML import verification** — Scans all candidate `index.html` files and checks that every `<script src="...">` and `<link rel="stylesheet" href="...">` points to a file that **actually exists on disk**
2. **package.json validation** — Verifies `"main"` field points to an existing file, and that `start`, `dev`, `build` scripts exist
3. **Electron-specific** — If Electron is a dependency, verifies `main.js` references a valid `index.html` via `loadFile()`/`loadURL()`

**Auto-Fix Flow:**
- If the check **passes** → continue to next phase
- If the check **fails** → the orchestrator automatically creates a synthetic fix task (assigned to Setup Engineer, priority: critical) with all issues listed, and executes it immediately via the same `executeTask()` infrastructure — **no user interaction required**
- After the fix, a **re-check** runs to verify the issues are resolved
- The `onIntegrationCheck` callback notifies the UI of results

Issue types detected: `BROKEN_IMPORT`, `MISSING_FILE`, `MISSING_SCRIPT`, `MISSING`, `BROKEN_ELECTRON`, `INVALID`

### Syntax Validation

After every `.js`/`.jsx` file write:
1. Runs `node --check {filePath}` to validate syntax
2. If errors found, injects error message back to LLM: `"The file X has a syntax error: Y. Please fix..."`
3. Max 2 retry attempts before reporting error to user

### Safe File Writes

All file writes go through `safeWriteFile` IPC handler in `main.js`:
- `FileLockManager` prevents concurrent writes to the same file
- Lock-and-retry with 50ms interval, 30s timeout
- Atomic writes via `fs-extra.outputFile`

### Command Queue + Timeout

All shell commands execute through a sequential `CommandQueue` in `main.js`:
- One command at a time to prevent conflicts
- **300-second timeout** per command
- On timeout: kills the entire process tree (`taskkill /T /F` on Windows, `SIGKILL` on Linux/Mac)
- Queue always advances — never blocks permanently

## Key Functions

| Function | Description |
|----------|-------------|
| `assignAgentToTask(task, phaseName)` | Keyword-based agent assignment scoring |
| `buildAgentSystemPrompt(agentType, task, projectContext)` | Builds system prompt with persona + context + shared knowledge |
| `buildExecutionPlan(workplan)` | Flatten tasks, assign agents, sort by order |
| `buildParallelBatches(executionPlan)` | Group into sequential phase batches |
| `executeTask(task, projectContext, settings, callbacks, projectPath)` | Run a single task through the LLM with real-time file/command processing, syntax validation, and QualityGate |
| `_runQualityGate(task, projectContext, allFiles, settings)` | Shadow LLM reviewer — verifies code against task requirements |
| `_validateSyntax(filePath, projectPath)` | Runs `node --check` on JS/JSX files |
| `_extractContextFromFiles(files)` | Extracts exports and technologies from file contents via regex |
| `_buildTaskSummary(task, files, exports, tech, commands)` | Deterministic natural-language task summary (fallback) |
| `IncrementalFileExtractor.update(fullOutput)` | Streaming file block detection |
| `IncrementalCommandExtractor.update(fullOutput)` | Streaming command block detection |
| `IncrementalEnvVarExtractor.update(fullOutput)` | Streaming env variable block detection |
| `extractEnvVarsFromOutput(output)` | Parse all `set-env-variable` blocks from LLM output |
| `TaskLogger` | Per-task real-time disk logger (includes `qualityGate`, `envVarSet`, `blocked`, `failureDecision` methods) |
| `CodingOrchestrator` | Main orchestrator: batch execution, Stop-on-Failure, shared knowledge updates |
| `CodingOrchestrator._generateLLMSummary()` | LLM-generated 2-sentence task summary (files + API/Props) |
| `CodingOrchestrator._generateEntityIndex()` | LLM-generated structured entity extraction (functions, components, API routes, env vars) |
| `CodingOrchestrator._runIntegrationCheck(batchIdx)` | Post-phase integration check with auto-fix dispatch |
| `CodingOrchestrator._updateContextSummary()` | Merges task results into `context_summary.json` |
| `runIntegrationCheck(projectPath)` | Scans HTML imports, package.json main/scripts, Electron loadFile — returns `{ passed, issues[] }` |

---

## Token Usage Tracker

All LLM calls across all agents are tracked by a centralized `tokenUsageTracker.js` singleton:

- **Automatic** — Hooked into all 3 LLM providers (OpenAI, Anthropic, Gemini) at the provider level
- **Per-agent breakdown** — Tracks input/output tokens and estimated cost per agent
- **Cost estimation** — Approximate cost tables for GPT-4o, Claude, Gemini models (fallback for unknown models)
- **Persistence** — Saves to `{projectPath}/docs/project_knowledge.json` after every call
- **UI** — `TokenUsageBadge` component in the TitleBar shows total tokens + estimated cost, expandable to per-agent breakdown
- **Reset** — User can reset all usage data from the badge dropdown
