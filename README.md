<div align="center">

# 🤖 OneManCrew Dev AI

### Your AI-Powered Software Development Team

**One developer. Five AI agents. Full project delivery.**

[![Electron](https://img.shields.io/badge/Electron-30-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

*OneManCrew Dev AI is a desktop application that orchestrates multiple AI agents to take a software project from idea to implementation — architecture, UI design, task planning, code generation, and bug fixing — all from a single interface.*

</div>

---

## ✨ What It Does

OneManCrew Dev AI replaces an entire development team with a pipeline of specialized AI agents. You describe what you want to build, and the agents collaborate to deliver it:

| Stage | Agent | What It Does |
|-------|-------|-------------|
| 1 | **🏗️ Architect** | Interviews you about requirements, generates SRS & HLD documents |
| 2 | **🎨 UI Designer** | Creates HTML/CSS mockups based on the architecture docs |
| 3 | **📋 Dev Lead** | Breaks the project into phases, tasks, and assigns specialist agents |
| 4 | **💻 Coding Agents** | 6 specialist agents (Backend, Frontend, DevOps, QA, Integration, Setup) execute tasks in parallel |
| 5 | **🐛 Bug Fixer** | Analyzes the codebase, identifies bugs, and dispatches fixes to the right specialist |

Each agent has its own chat interface where you can interact, guide, and override decisions. The entire pipeline produces real files on disk — ready to run.

---

## 🎬 How It Works

```mermaid
flowchart TD
    A[💡 You describe your idea] --> B[🏗️ Architect\nSRS + HLD]
    B --> C[🎨 UI Designer\nHTML/CSS Mockup]
    C --> D[📋 Dev Lead\nWork Plan + Tasks]
    D --> E[💻 Coding Agents x6\nParallel Execution]
    E --> F[🐛 Bug Fixer\nQA + Auto-Fixes]
    F --> G[✅ Your project is ready]
```

### 💻 The 6 Specialist Coding Agents

The Dev Lead assigns each task to the most appropriate specialist. These agents work **in parallel** — multiple tasks execute simultaneously for maximum speed.

| Agent | Specialty | Expertise |
|-------|-----------|-----------|
| ⚙️ **Backend Engineer** | Server-side & API | Node.js, Python, Java, Go, C#, REST, GraphQL, databases, ORMs, middleware, microservices |
| 🎨 **Frontend Engineer** | UI Implementation | React, Angular, Vue, Svelte, HTML/CSS, Tailwind, responsive design, animations, components |
| 🔧 **DevOps Engineer** | Infrastructure & CI/CD | Docker, Kubernetes, CI/CD pipelines, Nginx, cloud (AWS/Azure/GCP), scripting, monitoring |
| 🧪 **QA Engineer** | Testing & Quality | Unit tests, E2E tests, Jest, Playwright, Cypress, pytest, coverage, TDD/BDD |
| 🔗 **Integration Engineer** | System Wiring | API clients, state management (Redux/Zustand), data flow, WebSockets, service layers |
| 📦 **Setup Engineer** | Packaging & Config | Build tools (Vite/Webpack), installers, project scaffolding, dependency management, electron-builder |

Each agent receives a tailored system prompt with 25-35 years of domain expertise, ensuring high-quality, production-ready code output.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ — [Download](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/)
- **An LLM API key** — supports OpenAI, Anthropic, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint

### Installation

```bash
# Clone the repository
git clone https://github.com/OneManCrew/OneManCrewDevAI.git
cd OneManCrewDevAI

# Install dependencies
npm install

# Start in development mode
npm run dev
```

The app will open automatically. On first launch:

1. Click the **⚙️ Settings** gear icon in the sidebar
2. Select your **LLM Provider** (OpenAI, Anthropic, Gemini, OpenRouter, or Custom)
3. Enter your **API Key**
4. Choose your preferred **model**
5. Click **Save**

### Production Build

```bash
# Build the renderer
npm run build

# Run the production app
npm start
```

---

## 🔧 Configuration

### LLM Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 | Recommended for best results |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus | Excellent for code generation |
| **Google Gemini** | Gemini Pro, Gemini Flash | Good balance of speed and quality |
| **OpenRouter** | 100+ models | Access to all major providers via one API |
| **Custom** | Any OpenAI-compatible API | Self-hosted models (Ollama, LM Studio, etc.) |

### Per-Agent Model Overrides

Each agent can use a different model. For example:
- **Architect** → Claude 3 Opus (deep reasoning)
- **Coding Agents** → GPT-4o (fast code generation)
- **Bug Fixer** → Claude 3.5 Sonnet (careful analysis)

Configure this in **Settings → Per-Agent Model Overrides**.

---

## 📁 Project Structure

```
OneManCrewDevAI/
├── main.js                          # Electron main process
├── preload.js                       # Secure IPC bridge
├── package.json
├── vite.config.js                   # Vite bundler config
├── tailwind.config.js               # Tailwind CSS config
├── scripts/
│   └── launch-electron.js           # Electron launcher script
└── src/renderer/
    ├── App.jsx                      # Main app component & routing
    ├── main.jsx                     # React entry point
    ├── components/
    │   ├── ChatInterface.jsx        # 🏗️ Architect agent chat
    │   ├── UIDesignerChat.jsx       # 🎨 UI Designer agent chat
    │   ├── DevLeadChat.jsx          # 📋 Dev Lead agent chat
    │   ├── CodingPhase.jsx          # 💻 Coding orchestration & task board
    │   ├── BugFixerChat.jsx         # 🐛 Bug Fixer agent chat + console
    │   ├── TaskBoard.jsx            # Visual task board (phases/list/board)
    │   ├── SettingsPanel.jsx        # LLM provider & model configuration
    │   ├── ProjectSelection.jsx     # Workspace/project selector
    │   ├── Sidebar.jsx              # Navigation sidebar
    │   ├── DocumentPanel.jsx        # SRS/HLD document viewer
    │   ├── ModelSelector.jsx        # Per-chat model selector
    │   └── ...                      # Supporting UI components
    ├── services/
    │   ├── architectAgent.js        # Architect agent logic & prompts
    │   ├── devLeadAgent.js          # Dev Lead agent & incremental plan builder
    │   ├── uiDesignerAgent.js       # UI Designer agent logic
    │   ├── codingAgents.js          # 6 specialist coding agents + orchestrator
    │   ├── bugFixerAgent.js         # Bug analysis & fix execution
    │   ├── llmProviders.js          # Multi-provider LLM abstraction
    │   ├── electronBridge.js        # Electron API bridge (with browser fallback)
    │   ├── notificationService.js   # Desktop notifications
    │   └── agentTools.js            # Shared agent tool definitions
    └── styles/
        └── index.css                # Tailwind + custom styles
```

### Generated Project Output

When you run the pipeline on a project, it generates:

```
your-project/
└── docs/
    ├── SRS.md                       # Software Requirements Specification
    ├── HLD.md                       # High-Level Design document
    ├── ui/
    │   ├── index.html               # UI mockup
    │   └── styles.css               # UI styles
    └── dev-lead/
        ├── workplan.json            # Full task breakdown
        ├── coding-status.json       # Task execution status
        ├── chat-history.json        # Dev Lead conversation
        └── task-logs/               # Per-task execution logs
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | Electron 30 |
| **Frontend** | React 18 + Vite 5 |
| **Styling** | Tailwind CSS 3.4 |
| **Markdown** | react-markdown + remark-gfm |
| **IPC** | Electron contextBridge (secure) |
| **LLM Integration** | Native fetch with streaming support |

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Development Tips

- Run `npm run dev` for hot-reload development
- The app uses Vite HMR for instant UI updates
- Electron main process changes require a restart
- All agent prompts are in `src/renderer/services/*Agent.js`

---

## 📋 Roadmap

- [ ] Multi-language support
- [ ] Git integration (auto-commit generated code)
- [ ] Agent memory across sessions
- [ ] Plugin system for custom agents
- [ ] Project templates
- [ ] Automated testing pipeline
- [ ] VS Code extension

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ by [OneManCrew](https://github.com/OneManCrew)**

*Because one developer with AI is all you need.*

</div>
