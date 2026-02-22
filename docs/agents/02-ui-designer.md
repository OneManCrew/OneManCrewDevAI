# 🎨 The UI Designer Agent

> **World-class UI/UX Designer & Frontend Architect** · 30+ years of experience in all types of UI: Web, Desktop, and Mobile.

## Purpose

The UI Designer is the **second agent** in the pipeline. It reads the SRS.md and HLD.md produced by the Architect, discusses design preferences with the user, creates a **Design System** (color tokens), and generates a complete set of **React functional components styled with Tailwind CSS** — production-quality, interactive UI components using Lucide React icons and Framer Motion animations.

## Source Files

| File | Role |
|------|------|
| `src/renderer/services/uiDesignerAgent.js` | Agent logic, prompts, phase detection, output parsing |
| `src/renderer/components/UIDesignerChat.jsx` | UI component (chat interface, preview controls, phase management) |

## Phases

| # | Phase | Description |
|---|-------|-------------|
| 0 | **LOADING** | Loading SRS.md, HLD.md, and existing design tokens from disk |
| 1 | **DISCOVERY** | Discuss UI preferences, visual style, color scheme, navigation; **create `colors.json` design tokens** |
| 2 | **DESIGN** | Generate complete React + Tailwind components using the Design System |
| 3 | **REVIEW** | User reviews components via smart preview and requests changes |
| 4 | **DONE** | Design approved — user can still request final adjustments |

### Phase Transitions

- `LOADING → DISCOVERY` — Automatic when SRS/HLD are successfully loaded
- `DISCOVERY → DESIGN` — Triggered when the LLM outputs `[UI_DISCOVERY_COMPLETE]` (must include `colors.json` block)
- `DESIGN → REVIEW` — Triggered when React components are successfully parsed and saved to disk
- `REVIEW → DONE` — Triggered by user clicking "Approve" button

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| **SRS.md** | `{projectPath}/docs/SRS.md` | Software Requirements Specification from Architect |
| **HLD.md** | `{projectPath}/docs/HLD.md` | High-Level Design from Architect |
| **colors.json** | `{projectPath}/src/theme/colors.json` | Design tokens (loaded if exists from previous session) |
| **User conversation** | Direct chat | Design preferences, feedback, change requests |

### Context Injection

The SRS, HLD, and design tokens are injected into the system prompt:
```
--- SRS.md (from Architect phase) ---
{content}
--- End SRS.md ---

--- HLD.md (from Architect phase) ---
{content}
--- End HLD.md ---

--- Design Tokens (colors.json) ---
{ "primary": "#3B82F6", "secondary": "#6366F1", ... }
--- End Design Tokens ---
```

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| `colors.json` | `{projectPath}/src/theme/colors.json` | Design tokens (created during DISCOVERY) |
| `*.jsx` | `{projectPath}/src/components/generated_ui/*.jsx` | React functional components with Tailwind CSS |
| `designer-chat.json` | `{projectPath}/docs/ui/designer-chat.json` | Persisted chat history for resume support |
| `_preview.html` | `{projectPath}/docs/ui/_preview.html` | Generated preview HTML (fallback when no Vite dev server) |

## Design System

The UI Designer enforces a consistent Design System across all generated components:

### Standard Libraries (mandatory)

| Library | Usage |
|---------|-------|
| **Tailwind CSS** | All styling via utility classes |
| **Lucide React** | All icons (`import { Home, Settings } from 'lucide-react'`) |
| **Framer Motion** | Animations (`import { motion, AnimatePresence } from 'framer-motion'`) |

### Design Tokens (`colors.json`)

Created during the DISCOVERY phase based on user preferences. Example:
```json
{
  "primary": "#3B82F6",
  "primaryHover": "#2563EB",
  "secondary": "#6366F1",
  "accent": "#F59E0B",
  "background": "#0F172A",
  "surface": "#1E293B",
  "text": "#F8FAFC",
  "textMuted": "#94A3B8",
  "border": "#334155",
  "success": "#22C55E",
  "warning": "#F59E0B",
  "error": "#EF4444"
}
```

Every component must `import colors from '../theme/colors.json'` and use these values for consistent styling.

## System Prompt (per phase)

### Base Persona (shared across all phases)

```
You are a world-class UI/UX Designer and Frontend Architect with 30+ years of experience.
Expert in: design systems, accessibility (WCAG), responsive design, color theory,
typography, micro-interactions, and modern UI frameworks.

Design philosophy:
- Clean, modern, and professional interfaces
- Consistent spacing and visual hierarchy
- Accessible color contrast and font sizes
- Intuitive navigation and user flows
- Mobile-first responsive design when applicable
- Attention to micro-details: shadows, borders, transitions, hover states
```

### DISCOVERY Phase Prompt

Instructs the agent to:
- Analyze SRS and HLD to identify all screens, components, and user flows
- Ask targeted questions about: visual style, color scheme, target platform, reference apps, UI framework preferences
- Ask 2-3 questions at a time
- **Create `colors.json` design tokens** (mandatory before completing discovery)
- Output `[UI_DISCOVERY_COMPLETE]` when ready to design

### DESIGN Phase Prompt

Instructs the agent to produce React components as separate fenced code blocks:
- `` ```jsx:ComponentName.jsx `` — One block per component

**Standard Libraries:** Tailwind CSS, Lucide React (icons), Framer Motion (animations)

**Design requirements:**
1. Complete, production-quality React functional components
2. ALL screens/pages from the SRS as separate components
3. React hooks for interactivity (useState, useEffect, useCallback)
4. Tailwind CSS utility classes for all styling
5. Lucide React icons throughout — never raw SVGs or emoji
6. Framer Motion for page transitions, modal enter/exit, hover effects, list animations
7. Import and use `colors.json` design tokens in every component
8. `export default function ComponentName()` pattern
9. Realistic placeholder content (contextually appropriate)
10. Responsive design with Tailwind breakpoints

### REVIEW Phase Prompt

User reviews components via smart preview. Changes are output as complete updated component files using the same `jsx:ComponentName.jsx` format. Must continue using Lucide, Framer Motion, and design tokens.

### DONE Phase Prompt

Final adjustments if requested, same output format as Review phase.

## Smart Preview

The preview system uses a two-strategy approach:

1. **Vite Dev Server** — Probes ports 5173, 5174, 3000, 3001. If a dev server is running, opens the preview window pointing to the URL via `api.openPreviewUrl()`
2. **Fallback HTML Viewer** — Generates a styled HTML page with Tailwind CDN that displays all component source code, saved to `docs/ui/_preview.html` and opened via `api.openPreview()`

## Tools

| Tool | Type | Description |
|------|------|-------------|
| **Structured Questions** | LLM output format | ```` ```questions [...] ``` ```` — Renders interactive clickable option buttons in the UI |
| **Preview Window** | Electron API | `api.openPreview(htmlPath)` / `api.openPreviewUrl(url)` — Opens preview in a separate Electron window |

The UI Designer does **not** have file-write or shell-exec tools. File operations (saving components, design tokens) are handled by `UIDesignerChat.jsx` which parses the LLM output.

## Key Functions

| Function | Description |
|----------|-------------|
| `detectUIPhaseTransition(responseText, currentPhase)` | Detects `[UI_DISCOVERY_COMPLETE]` marker |
| `parseUIDesignerOutput(text)` | Extracts `jsx:ComponentName.jsx` blocks and `json:colors.json` design token blocks |
| `buildUIConversationMessages(chatHistory, currentPhase, contextDocs)` | Builds messages array with SRS/HLD/design tokens injected into system prompt |
