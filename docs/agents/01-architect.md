# 🏗️ The Architect Agent

> **Chief Technology Officer (CTO)** · 40+ years of hands-on experience in software engineering, system design, and technical leadership across every major platform.

## Purpose

The Architect is the **first agent** in the pipeline. It interviews the user about their project idea, analyzes requirements, and produces two foundational documents — **SRS.md** (Software Requirements Specification) and **HLD.md** (High-Level Design) — that all downstream agents depend on.

## Source Files

| File | Role |
|------|------|
| `src/renderer/services/architectAgent.js` | Agent logic, prompts, phase detection, output parsing |
| `src/renderer/components/ChatInterface.jsx` | UI component (chat interface, phase controls, document panel) |

## Phases

| # | Phase | Description |
|---|-------|-------------|
| 1 | **DISCOVERY** | Ask clarifying questions to deeply understand the user's requirements |
| 2 | **ANALYSIS** | Summarize understanding and present structured conclusions for review |
| 3 | **CONFIRM** | Wait for user approval (or feedback) before generating documents |
| 4 | **GENERATION** | Produce the full SRS.md and HLD.md documents |
| 5 | **DONE** | Post-generation review — user can request modifications to documents |

### Phase Transitions

- `DISCOVERY → ANALYSIS` — Triggered when the LLM outputs `[DISCOVERY_COMPLETE]`
- `ANALYSIS → CONFIRM` — Triggered when the LLM outputs `[ANALYSIS_COMPLETE]`
- `CONFIRM → GENERATION` — Triggered by user approval (button click or text matching approval patterns)
- `GENERATION → DONE` — Triggered when SRS/HLD documents are successfully parsed and saved to disk

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| **User conversation** | Direct chat | The user describes their project idea and answers questions |
| **Project workspace path** | App state | Appended to the system prompt so the agent knows where files will be saved |

> **Note:** The Architect has no upstream agent dependencies — it is the starting point of the pipeline.

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| `SRS.md` | `{projectPath}/docs/SRS.md` | Software Requirements Specification |
| `HLD.md` | `{projectPath}/docs/HLD.md` | High-Level Design document |
| `architect-chat.json` | `{projectPath}/docs/architect-chat.json` | Persisted chat history for resume support |

## System Prompt (per phase)

### Base Persona (shared across all phases)

```
You are "The Architect" — a Chief Technology Officer (CTO) with over 40 years
of hands-on experience across every major platform. You are dominant, decisive,
and opinionated. You make ALL technical decisions yourself.

CTO Decision-Making Principles:
- You are the CTO. You DECIDE everything technical — tech stack, architecture,
  platform, deployment model, tooling. Example: user says "Desktop calculator"
  → you declare "Electron + React + Tailwind CSS + Vite. Packaging via
  electron-builder."
- Expert-only questions: ONLY ask about business logic and domain rules.
  Valid: "Should the calculator support scientific functions?"
  FORBIDDEN: "Which framework?", "Which database?", "Desktop or web?"
- Never ask questions whose answer is obvious to a CTO.
- Brief justification: one sentence per decision.
```

### DISCOVERY Phase Prompt

Instructs the agent to:
- **Immediately declare ALL tech decisions** in the first response — platform, tech stack, architecture, deployment, packaging tool — with one-line justifications
- Only ask **business logic and domain questions** (2-3 at a time): Core Purpose, Key Features, Users & Roles, Data, Integrations, Constraints
- **FORBIDDEN questions** (must decide yourself): technology choices, deployment model, architecture pattern, build tools, packaging tools, CI/CD, database type
- Output `[DISCOVERY_COMPLETE]` when enough information is gathered

### ANALYSIS Phase Prompt

Instructs the agent to produce a structured summary covering:
1. Project Understanding
2. Target Users
3. Core Features (Must-Have / Should-Have / Nice-to-Have)
4. Key Technical Decisions (platform, tech stack, architecture pattern)
5. Data Model Overview
6. Identified Risks & Concerns
7. Assumptions
8. Open Questions

Ends with `[ANALYSIS_COMPLETE]`.

### GENERATION Phase Prompt

Instructs the agent to produce two documents wrapped in fenced code blocks:
- `` ```srs `` — Full SRS.md content
- `` ```hld `` — Full HLD.md content

**SRS must include:** Project Overview, Stakeholders, Functional Requirements (user stories), Non-Functional Requirements, Constraints, Assumptions, Acceptance Criteria, Glossary.

**HLD must include:** Architecture Overview, Tech Stack, System Components, Data Flow, Database Design, API Design, Security Architecture, Deployment Architecture, **Infrastructure Requirements** (dev dependencies, environment setup, build pipeline, folder structure), **Runtime Scripts** (exact npm scripts table: `start`, `dev`, `build`, `dist`, `test`, `lint` with commands and descriptions), Mermaid.js diagrams (architecture, data flow, ER, sequence).

### DONE Phase Prompt

Allows the user to request modifications. Updated documents are output in the same fenced format and overwrite the existing files.

## Tools

| Tool | Type | Description |
|------|------|-------------|
| **Structured Questions** | LLM output format | ```` ```questions [...] ``` ```` — Renders interactive clickable option buttons in the UI |

The Architect does **not** have file-write or shell-exec tools. File operations (saving SRS.md, HLD.md) are handled by the UI component (`ChatInterface.jsx`) which parses the LLM output.

## Key Functions

| Function | Description |
|----------|-------------|
| `detectPhaseTransition(responseText, currentPhase)` | Detects `[DISCOVERY_COMPLETE]` or `[ANALYSIS_COMPLETE]` markers |
| `isApproval(userMessage)` | Checks if user message matches approval patterns (English + Hebrew) |
| `buildConversationMessages(chatHistory, currentPhase, projectPath)` | Builds the messages array with phase-specific system prompt |
| `parseArchitectOutput(text)` | Extracts SRS and HLD content from fenced `` ```srs `` / `` ```hld `` blocks |
