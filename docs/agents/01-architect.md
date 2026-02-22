# 🏗️ The Architect Agent

> **Senior Software Architect** · 40+ years of experience in software engineering, system design, and technical leadership.

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
You are "The Architect" — a Senior Software Architect with over 40 years of
experience in software engineering, system design, and technical leadership.
You are methodical, thorough, and never rush to conclusions. You speak with
authority but remain collaborative.
```

### DISCOVERY Phase Prompt

Instructs the agent to:
- Ask focused, specific clarifying questions (2-3 at a time)
- Cover: Core Purpose, Key Features, Users & Roles, Data, Integrations, Scale, Tech Preferences, Constraints, Existing Systems, Deployment
- NOT generate any documents or propose architecture yet
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

**HLD must include:** Architecture Overview, Tech Stack, System Components, Data Flow, Database Design, API Design, Security Architecture, Deployment Architecture, Mermaid.js diagrams (architecture, data flow, ER, sequence).

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
