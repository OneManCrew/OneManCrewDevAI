# 📋 The Dev Lead Agent

> **Senior Development Team Lead** · 30+ years of experience in software project management, agile methodologies, and technical leadership.

## Purpose

The Dev Lead is the **third agent** in the pipeline. It reads all outputs from previous stages (SRS.md, HLD.md, UI mockup), discusses priorities and constraints with the user, and produces a detailed **workplan.json** — a structured task list broken into phases, with dependencies, acceptance criteria, and agent assignments for each task.

## Source Files

| File | Role |
|------|------|
| `src/renderer/services/devLeadAgent.js` | Agent logic, prompts, phase detection, incremental plan builder, output parsing |
| `src/renderer/components/DevLeadChat.jsx` | UI component (chat interface, task board, phase controls) |

## Phases

| # | Phase | Description |
|---|-------|-------------|
| 0 | **LOADING** | Loading SRS.md, HLD.md, and UI mockup from disk |
| 1 | **DISCOVERY** | Review all documents, discuss priorities, timeline, team size, MVP scope |
| 2 | **PLANNING** | Present high-level plan structure (phases, categories, task counts) for approval |
| 3 | **CONFIRM** | Wait for user approval before generating the detailed task list |
| 4 | **GENERATION** | Produce the full detailed workplan with all tasks |
| 5 | **DONE** | Post-generation review — user can request modifications to the plan |

### Phase Transitions

- `LOADING → DISCOVERY` — Automatic when context documents are successfully loaded
- `DISCOVERY → PLANNING` — Triggered when the LLM outputs `[DISCOVERY_COMPLETE]`
- `PLANNING → CONFIRM` — Triggered when the LLM outputs `[PLANNING_COMPLETE]`
- `CONFIRM → GENERATION` — Triggered by user approval (button click or text matching approval patterns)
- `GENERATION → DONE` — Triggered when the task plan is successfully parsed and saved to disk

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| **SRS.md** | `{projectPath}/docs/SRS.md` | Software Requirements Specification from Architect |
| **HLD.md** | `{projectPath}/docs/HLD.md` | High-Level Design from Architect |
| **UI Components** | `{projectPath}/src/components/generated_ui/*.jsx` | React + Tailwind components from UI Designer |
| **Design Tokens** | `{projectPath}/src/theme/colors.json` | Design System color tokens from UI Designer |
| **User conversation** | Direct chat | Priorities, constraints, timeline, feedback |

### Context Injection

All documents are injected into the system prompt:
```
--- SRS.md (from Architect phase) ---
{content}
--- End SRS.md ---

--- HLD.md (from Architect phase) ---
{content}
--- End HLD.md ---

--- UI Components (from UI Designer phase) ---
{React + Tailwind component summaries}
--- End UI Components ---

--- Design Tokens (colors.json) ---
{color palette JSON}
--- End Design Tokens ---
```

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| `workplan.json` | `{projectPath}/docs/dev-lead/workplan.json` | Structured task plan with phases, tasks, dependencies |
| `chat-history.json` | `{projectPath}/docs/dev-lead/chat-history.json` | Persisted chat history for resume support |

### workplan.json Structure

```json
{
  "projectName": "Project Name",
  "generatedAt": "ISO date string",
  "phases": [
    {
      "id": "phase-1",
      "name": "Phase 1: Foundation & Setup",
      "description": "Brief description",
      "order": 1,
      "tasks": [
        {
          "id": "task-1-1",
          "title": "Short descriptive title",
          "description": "What to build, which files, key details",
          "category": "setup|backend|frontend|integration|testing|devops|documentation",
          "priority": "critical|high|medium|low",
          "order": 1,
          "estimatedHours": 4,
          "dependencies": ["task-id"],
          "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
          "technicalNotes": "Implementation hints",
          "tags": ["tag1", "tag2"]
        }
      ]
    }
  ],
  "summary": {
    "totalTasks": 25,
    "totalEstimatedHours": 120,
    "criticalPath": [],
    "categories": { "backend": 8, "frontend": 10, ... }
  }
}
```

## System Prompt (per phase)

### Base Persona (shared across all phases)

```
You are "The Dev Lead" — a Senior Development Team Lead with over 30 years of
experience in software project management, agile methodologies, and technical leadership.

Planning philosophy:
- Every task must be self-contained with clear inputs, outputs, and acceptance criteria
- Tasks are ordered by dependency graph
- Each task includes specific files, technologies, and testing requirements
- Vertical slices when possible — delivering working increments
- Infrastructure/setup first, then core features, then polish
```

### DISCOVERY Phase Prompt

Instructs the agent to:
- Analyze ALL provided documents (SRS, HLD, UI mockup)
- Identify major work areas: Infrastructure, Backend, Frontend, Integration, Testing, DevOps
- Ask targeted questions about: team size, timeline, sprint length, technical constraints, MVP scope
- Output `[DISCOVERY_COMPLETE]` when ready

### PLANNING Phase Prompt

Instructs the agent to present a high-level overview:
1. Phases/Milestones
2. Task Categories with estimated counts
3. Suggested Priority Order with reasoning
4. Dependencies between tasks
5. Risk Areas

Ends with `[PLANNING_COMPLETE]`.

### GENERATION Phase Prompt — Incremental Output

The Dev Lead uses an **incremental output format** to prevent data loss from output truncation. Instead of one giant JSON, it outputs separate fenced blocks:

1. `` ```plan-header `` — `{ "projectName": "...", "generatedAt": "..." }`
2. `` ```phase `` — One block per phase: `{ "id": "phase-1", "name": "...", "order": 1 }`
3. `` ```task `` — One block per task (immediately after its phase)
4. `` ```plan-complete `` — Signals the end of the plan

The `IncrementalPlanBuilder` class parses these blocks in real-time during streaming and saves to disk after each block.

### Mandatory: "Project Skeleton Integration" Task

The Dev Lead **must** add a task titled **"Project Skeleton Integration"** as the **last task in every phase**. This ensures the project actually runs after each phase.

The task must verify:
1. **HTML verification** — Every `<script src="...">` and `<link rel="stylesheet" href="...">` in `index.html` points to a file that exists on disk
2. **Entry point validation** — Main entry point (`index.html`, `main.jsx`, `App.jsx`) exists with correct imports
3. **Electron-specific** — If the project uses Electron, must create/verify a valid `main.js` with correct `loadFile()`/`loadURL()` path, `BrowserWindow` config, and `preload.js`
4. **Smoke test** — Run the project's start/dev command and confirm it launches without errors

This task is always `category: "integration"`, `priority: "critical"`, tagged `["skeleton", "integration", "verification"]`.

### DONE Phase Prompt

Allows modifications. Updated plan is output as a complete `` ```taskplan `` JSON block.

## Tools

| Tool | Type | Description |
|------|------|-------------|
| **Structured Questions** | LLM output format | ```` ```questions [...] ``` ```` — Renders interactive clickable option buttons in the UI |

The Dev Lead does **not** have file-write or shell-exec tools. File operations are handled by the UI component and the `IncrementalPlanBuilder`.

## Key Functions

| Function | Description |
|----------|-------------|
| `detectDLPhaseTransition(responseText, currentPhase)` | Detects `[DISCOVERY_COMPLETE]` or `[PLANNING_COMPLETE]` markers |
| `isDLApproval(userMessage)` | Checks if user message matches approval patterns (English + Hebrew) |
| `buildDLConversationMessages(chatHistory, currentPhase, contextDocs)` | Builds messages array with all context docs injected |
| `parseDevLeadOutput(text)` | Extracts task plan JSON (with truncation recovery) |
| `IncrementalPlanBuilder` | Streaming parser that captures `plan-header`, `phase`, `task`, `plan-complete` blocks in real-time |
| `extractJSONObject(text)` | Character-by-character JSON extraction respecting string escaping |
| `salvageTruncatedJSON(json)` | Attempts to close truncated JSON by finding the last valid structure point |
