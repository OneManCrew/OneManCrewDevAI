import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createLLMProvider, getAgentSettings } from '../services/llmProviders';
import {
  UI_PHASES, UI_PHASE_LABELS,
  detectUIPhaseTransition, parseUIDesignerOutput,
  buildUIConversationMessages,
} from '../services/uiDesignerAgent';
import api from '../services/electronBridge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import GenerationProgress from './GenerationProgress';
import MultiQuestionReply, { parseQuestions, stripQuestionsBlock } from './QuickReply';
import ModelSelector from './ModelSelector';
import { notifyAgentComplete, notifyAgentError, notifyUserAttentionNeeded } from '../services/notificationService';

// ─── Phase colors ──────────────────────────────────────────────────────────────
const PHASE_COLORS = {
  [UI_PHASES.LOADING]: { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400' },
  [UI_PHASES.DISCOVERY]: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  [UI_PHASES.DESIGN]: { bg: 'bg-pink-500/15', text: 'text-pink-400', dot: 'bg-pink-400' },
  [UI_PHASES.REVIEW]: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  [UI_PHASES.DONE]: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
};

const PHASE_ORDER = [UI_PHASES.DISCOVERY, UI_PHASES.DESIGN, UI_PHASES.REVIEW, UI_PHASES.DONE];

export default function UIDesignerChat({ projectPath, settings, onUpdateSettings, onBack, onNext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(UI_PHASES.LOADING);
  const [tokenCount, setTokenCount] = useState(0);
  const [contextDocs, setContextDocs] = useState(null);
  const [hasUI, setHasUI] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const agentSettings = React.useMemo(() => getAgentSettings(settings, 'ui_designer'), [settings]);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const docsPath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/docs' : null;
  const uiPath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/src/components/generated_ui' : null;
  const themePath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/src/theme' : null;
  const colorsPath = themePath ? themePath + '/colors.json' : null;

  // ─── Reset all state when projectPath changes (workspace switch) ──────
  const prevPathRef = useRef(projectPath);
  const pathStableRef = useRef(true);
  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== projectPath) {
      pathStableRef.current = false;
      setMessages([]);
      setInput('');
      setIsStreaming(false);
      setError(null);
      setPhase(UI_PHASES.LOADING);
      setTokenCount(0);
      setContextDocs(null);
      setHasUI(false);
      setHistoryLoaded(false);
      setAutoScroll(true);
      setIsAtBottom(true);
      setTimeout(() => { pathStableRef.current = true; }, 100);
    }
    prevPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      if (chatContainerRef.current) {
        chatContainerRef.current.querySelectorAll('*').forEach((el) => {
          if (el.scrollHeight > el.clientHeight + 4) {
            el.scrollTop = el.scrollHeight;
          }
        });
      }
    }
  }, [messages, autoScroll]);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const chatHistoryPath = docsPath ? docsPath + '/ui/designer-chat.json' : null;

  // ─── Restore chat history on mount ──────────────────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || historyLoaded) return;
    (async () => {
      try {
        const raw = await api.readFile(chatHistoryPath);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.messages && saved.messages.length > 0) {
            setMessages(saved.messages);
            if (saved.phase) setPhase(saved.phase);
            if (saved.hasUI) setHasUI(true);
            // Re-read actual file contents (don't rely on saved contextDocs)
            if (docsPath) {
              try {
                const [srs, hld] = await Promise.all([
                  api.readFile(docsPath + '/SRS.md'),
                  api.readFile(docsPath + '/HLD.md'),
                ]);
                setContextDocs({ srs, hld });
              } catch (e) { /* docs may not exist yet */ }
            }
            setHistoryLoaded(true);
            // Note: no preview window for React components
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to restore designer chat history:', e);
      }
      setHistoryLoaded(true);
    })();
  }, [chatHistoryPath, historyLoaded]);

  // ─── Persist chat history on every change ───────────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || !historyLoaded || messages.length === 0) return;
    if (!pathStableRef.current) return;
    const timer = setTimeout(async () => {
      if (!pathStableRef.current) return;
      try {
        const data = JSON.stringify({ messages, phase, hasUI, contextDocs: contextDocs ? { srs: !!contextDocs.srs, hld: !!contextDocs.hld } : null }, null, 2);
        await api.writeFile(chatHistoryPath, data);
      } catch (e) {
        console.warn('Failed to persist designer chat history:', e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, phase, hasUI, chatHistoryPath, historyLoaded]);

  // ─── Load context docs (SRS + HLD) and check for existing UI ─────────────
  useEffect(() => {
    if (!docsPath || historyLoaded === false) return;
    // Skip if we already restored from chat history
    if (messages.length > 0) return;
    (async () => {
      try {
        const [srsExists, hldExists] = await Promise.all([
          api.exists(docsPath + '/SRS.md'),
          api.exists(docsPath + '/HLD.md'),
        ]);

        if (!srsExists && !hldExists) {
          setError(`No SRS.md or HLD.md found in ${docsPath}. Complete the Architect phase first.`);
          return;
        }

        const [srs, hld] = await Promise.all([
          srsExists ? api.readFile(docsPath + '/SRS.md') : Promise.resolve(null),
          hldExists ? api.readFile(docsPath + '/HLD.md') : Promise.resolve(null),
        ]);

        // Load existing design tokens if available
        let designTokens = null;
        if (colorsPath) {
          try {
            const colorsRaw = await api.readFile(colorsPath);
            if (colorsRaw) designTokens = JSON.parse(colorsRaw);
          } catch (e) { /* no tokens yet */ }
        }

        setContextDocs({ srs: srs || null, hld: hld || null, designTokens });

        // Check for existing generated UI components (resume support)
        const uiDirExists = uiPath ? await api.exists(uiPath) : false;
        let existingComponents = [];
        if (uiDirExists) {
          try {
            const entries = await api.readDir(uiPath);
            existingComponents = (entries || []).filter(e => !e.isDirectory && (e.name.endsWith('.jsx') || e.name.endsWith('.tsx')));
          } catch (e) { /* ignore */ }
        }

        if (existingComponents.length > 0) {
          setHasUI(true);
          setPhase(UI_PHASES.REVIEW);
          addMessage('system', `Existing UI components found (${existingComponents.length} files in src/components/generated_ui/). You can review them, request changes, or approve.`);
        } else {
          setPhase(UI_PHASES.DISCOVERY);
          addMessage('system', 'SRS and HLD loaded. Starting UI design discussion.');
        }
      } catch (err) {
        setError('Failed to load context documents: ' + err.message);
      }
    })();
  }, [docsPath, historyLoaded]);

  // ─── Message helpers ─────────────────────────────────────────────────────
  const addMessage = useCallback((role, content, meta = {}) => {
    setMessages((prev) => [...prev, {
      id: Date.now() + Math.random(), role, content, timestamp: new Date(), ...meta,
    }]);
  }, []);

  const updateLastAssistant = useCallback((content) => {
    setMessages((prev) => {
      const updated = [...prev];
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].role === 'assistant') {
          updated[i] = { ...updated[i], content };
          break;
        }
      }
      return updated;
    });
  }, []);

  // ─── Save design tokens ───────────────────────────────────────
  const saveDesignTokens = useCallback(async (tokens) => {
    if (!colorsPath || !tokens) return;
    try {
      await api.safeWriteFile(colorsPath, JSON.stringify(tokens, null, 2));
      setContextDocs(prev => ({ ...prev, designTokens: tokens }));
      addMessage('system', 'Design tokens saved to src/theme/colors.json.');
    } catch (err) {
      console.error('Failed to save design tokens:', err);
    }
  }, [colorsPath, addMessage]);

  // ─── Save UI component files ─────────────────────────────────────
  const saveComponents = useCallback(async (components) => {
    if (!uiPath || !components || components.length === 0) return;
    try {
      for (const comp of components) {
        const filePath = uiPath + '/' + comp.filename;
        await api.safeWriteFile(filePath, comp.content);
      }
      setHasUI(true);
    } catch (err) {
      console.error('Failed to save UI components:', err);
    }
  }, [uiPath]);

  // ─── Smart Preview ─────────────────────────────────────────────────
  const previewComponents = useCallback(async () => {
    if (!uiPath || !projectPath) return;
    const base = projectPath.replace(/[\\/]$/, '');

    // Strategy 1: Check if target project has a running Vite dev server
    // Common ports: 5173, 5174, 3000, 3001
    const devPorts = [5173, 5174, 3000, 3001];
    for (const port of devPorts) {
      try {
        const result = await api.execCommand({ command: `node -e "const h=require('http');h.get('http://localhost:${port}',(r)=>{process.exit(r.statusCode<400?0:1)}).on('error',()=>process.exit(1))"`, cwd: base });
        if (result.code === 0) {
          await api.openPreviewUrl(`http://localhost:${port}`);
          return;
        }
      } catch (e) { /* port not available */ }
    }

    // Strategy 2: Generate a standalone HTML wrapper with Tailwind CDN
    // that renders the first component (AppShell or first file) inline
    try {
      const entries = await api.readDir(uiPath);
      const jsxFiles = (entries || []).filter(e => !e.isDirectory && (e.name.endsWith('.jsx') || e.name.endsWith('.tsx')));
      if (jsxFiles.length === 0) return;

      // Read all component contents
      const components = [];
      for (const f of jsxFiles) {
        const content = await api.readFile(f.path);
        if (content) components.push({ name: f.name, content });
      }

      // Build a preview HTML that shows the component code in a styled viewer
      const componentList = components.map(c =>
        `<div class="mb-6"><h2 class="text-lg font-semibold text-gray-200 mb-2 flex items-center gap-2"><span class="text-pink-400">●</span> ${c.name}</h2><pre class="bg-gray-900 rounded-lg p-4 overflow-x-auto text-sm text-gray-300 border border-gray-700"><code>${c.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre></div>`
      ).join('\n');

      const previewHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Components Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script>tailwindcss.config={darkMode:'class'}<\/script>
</head>
<body class="bg-gray-950 text-gray-100 p-8 font-sans">
  <div class="max-w-4xl mx-auto">
    <div class="mb-8 pb-4 border-b border-gray-800">
      <h1 class="text-2xl font-bold text-white">Generated UI Components</h1>
      <p class="text-sm text-gray-400 mt-1">${components.length} component(s) in src/components/generated_ui/</p>
      <p class="text-xs text-gray-500 mt-2">To see a live interactive preview, start a Vite dev server in your target project and import these components.</p>
    </div>
    ${componentList}
  </div>
</body>
</html>`;

      const previewPath = base + '/docs/ui/_preview.html';
      await api.writeFile(previewPath, previewHtml);
      await api.openPreview(previewPath);
    } catch (err) {
      console.error('Failed to generate preview:', err);
    }
  }, [uiPath, projectPath]);

  const handleOpenPreview = useCallback(async () => {
    await previewComponents();
  }, [previewComponents]);

  // ─── Core LLM send ──────────────────────────────────────────────────────
  const sendToLLM = useCallback(async (userMessage, currentPhase, { showUserMsg = true } = {}) => {
    setError(null);
    if (showUserMsg) addMessage('user', userMessage);

    const allMessages = [...messagesRef.current];
    if (showUserMsg) allMessages.push({ role: 'user', content: userMessage });
    const conversationMessages = buildUIConversationMessages(allMessages, currentPhase, contextDocs);

    setIsStreaming(true);
    if (currentPhase === UI_PHASES.DESIGN) setTokenCount(0);
    addMessage('assistant', '');

    try {
      const provider = createLLMProvider(agentSettings);
      let fullResponse = '';

      await provider.chat(conversationMessages, agentSettings, {
        onToken: (token) => {
          fullResponse += token;
          updateLastAssistant(fullResponse);
          if (currentPhase === UI_PHASES.DESIGN) {
            setTokenCount((c) => c + 1);
          }
        },
        onDone: async (finalText) => {
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);

          // Phase transitions
          const nextPhase = detectUIPhaseTransition(fullResponse, currentPhase);
          if (nextPhase) {
            setPhase(nextPhase);
            addMessage('system', `Phase: ${UI_PHASE_LABELS[currentPhase]} → ${UI_PHASE_LABELS[nextPhase]}`);

            // Auto-trigger design generation
            if (nextPhase === UI_PHASES.DESIGN) {
              setTimeout(() => triggerDesign(), 500);
            }
          }

          // Extract and save design tokens + UI component files
          const output = parseUIDesignerOutput(fullResponse);

          // Save design tokens if present (typically during DISCOVERY)
          if (output.designTokens) {
            await saveDesignTokens(output.designTokens);
          }

          // Save component files
          if ((currentPhase === UI_PHASES.DESIGN || currentPhase === UI_PHASES.REVIEW || currentPhase === UI_PHASES.DONE) && output.components.length > 0) {
            await saveComponents(output.components);
            const names = output.components.map(c => c.filename).join(', ');
            if (currentPhase === UI_PHASES.DESIGN) {
              setPhase(UI_PHASES.REVIEW);
              addMessage('system', `UI components generated! ${output.components.length} files saved to src/components/generated_ui/ (${names}). Review and provide feedback.`);
            } else {
              addMessage('system', `UI updated. ${output.components.length} component(s) saved (${names}).`);
            }
          }
        },
        onError: (err) => {
          setError(err.message || 'An error occurred.');
          notifyAgentError('UI Designer', err.message);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to connect to the LLM provider.');
      notifyAgentError('UI Designer', err.message);
    } finally {
      setIsStreaming(false);
    }
  }, [projectPath, agentSettings, contextDocs, addMessage, updateLastAssistant, saveComponents, saveDesignTokens]);

  // ─── Auto-trigger design generation ──────────────────────────────────────
  const triggerDesign = useCallback(async () => {
    const conversationMessages = buildUIConversationMessages(messagesRef.current, UI_PHASES.DESIGN, contextDocs);
    setIsStreaming(true);
    setTokenCount(0);
    addMessage('assistant', '');

    try {
      const provider = createLLMProvider(agentSettings);
      let fullResponse = '';
      await provider.chat(conversationMessages, agentSettings, {
        onToken: (token) => {
          fullResponse += token;
          updateLastAssistant(fullResponse);
          setTokenCount((c) => c + 1);
        },
        onDone: async (finalText) => {
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);

          const output = parseUIDesignerOutput(fullResponse);
          if (output.designTokens) {
            await saveDesignTokens(output.designTokens);
          }
          if (output.components.length > 0) {
            await saveComponents(output.components);
            const names = output.components.map(c => c.filename).join(', ');
            setPhase(UI_PHASES.REVIEW);
            addMessage('system', `UI components generated! ${output.components.length} files saved (${names}).`);
          }
        },
        onError: (err) => setError(err.message || 'Error during design generation.'),
      });
    } catch (err) {
      setError(err.message || 'Failed to generate design.');
    } finally {
      setIsStreaming(false);
    }
  }, [agentSettings, contextDocs, addMessage, updateLastAssistant, saveComponents, saveDesignTokens]);

  // ─── Quick reply handler (from option buttons) ─────────────────────────
  const handleQuickReply = async (value) => {
    if (isStreaming) return;
    setInput('');
    await sendToLLM(value, phase);
  };

  // ─── Handle user send ────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage = input.trim();
    setInput('');
    await sendToLLM(userMessage, phase);
  };

  // ─── Approve design ──────────────────────────────────────────────────────
  const handleApprove = () => {
    if (isStreaming) return;
    setPhase(UI_PHASES.DONE);
    addMessage('system', 'UI design approved! You can still request changes or proceed to the next phase.');
    notifyAgentComplete('UI Designer');
  };

  // ─── Reset agent ────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (isStreaming) return;
    if (!confirm('Reset the UI Designer agent? This will delete the UI mockup and chat history.')) return;
    try {
      // Delete generated UI component files
      if (uiPath) {
        try {
          const entries = await api.readDir(uiPath);
          for (const entry of (entries || [])) {
            if (!entry.isDirectory && (entry.name.endsWith('.jsx') || entry.name.endsWith('.tsx'))) {
              await api.writeFile(entry.path, '').catch(() => {});
            }
          }
        } catch (e) { /* ignore */ }
      }
      if (chatHistoryPath) await api.writeFile(chatHistoryPath, '').catch(() => {});
    } catch (e) { /* ignore */ }
    setMessages([]);
    setPhase(UI_PHASES.DISCOVERY);
    setTokenCount(0);
    setHasUI(false);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const getPlaceholder = () => {
    switch (phase) {
      case UI_PHASES.LOADING: return 'Loading context...';
      case UI_PHASES.DISCOVERY: return 'Describe your UI preferences or answer questions...';
      case UI_PHASES.DESIGN: return 'Generating UI mockup...';
      case UI_PHASES.REVIEW: return 'Describe changes you want to the UI...';
      case UI_PHASES.DONE: return 'Request final adjustments or click Next...';
      default: return 'Type a message...';
    }
  };

  const phaseColor = PHASE_COLORS[phase] || PHASE_COLORS[UI_PHASES.DISCOVERY];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-card/50">
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button onClick={onBack} title="Back to Architect"
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-md hover:bg-surface-elevated transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="w-7 h-7 rounded-lg bg-pink-500/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-200 leading-tight">The UI Designer</p>
            <p className="text-[10px] text-gray-500">Senior UX/UI Expert &middot; 30+ years</p>
          </div>

          <div className="flex-1" />

          {/* Preview button */}
          {hasUI && (
            <button onClick={handleOpenPreview}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-surface-elevated border border-border rounded-lg text-gray-400 hover:text-gray-200 hover:border-border-hover transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Preview
            </button>
          )}

          {/* Phase Badge */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${phaseColor.bg} ${phaseColor.text}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${phaseColor.dot} ${phase !== UI_PHASES.DONE ? 'animate-pulse' : ''}`} />
            {UI_PHASE_LABELS[phase]}
          </div>
          <ModelSelector
            settings={agentSettings}
            agentId="ui_designer"
            accentColor="pink-400"
            onModelChange={(provider, model) => {
              const newSettings = {
                ...settings,
                agentModels: { ...settings.agentModels, ui_designer: { provider, model } },
              };
              onUpdateSettings(newSettings);
            }}
          />

          {/* Reset button */}
          <button
            onClick={handleReset}
            disabled={isStreaming || messages.length === 0}
            title="Reset — delete all outputs and start over"
            className="p-1.5 text-gray-600 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="flex gap-0.5 mt-2">
          {PHASE_ORDER.map((p, i) => {
            const currentIdx = PHASE_ORDER.indexOf(phase);
            return (
              <div key={p} className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${
                i < currentIdx ? 'bg-pink-400' : i === currentIdx ? 'bg-pink-400/50' : 'bg-border'
              }`} />
            );
          })}
        </div>
      </div>

      {/* Messages */}
      <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative">
        {messages.length === 0 && phase === UI_PHASES.LOADING && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-pink-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-gray-500">Loading SRS and HLD documents...</p>
          </div>
        )}

        {!messages.some(m => m.role === 'user' || m.role === 'assistant') && phase !== UI_PHASES.LOADING && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-11 h-11 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-300 mb-1">UI Designer Ready</h3>
            <p className="text-xs text-gray-500 max-w-sm mb-4">
              I've read the SRS and HLD. I'll design a complete UI mockup based on your project requirements.
            </p>
            <button
              onClick={() => sendToLLM('Start working. Introduce yourself and begin analyzing the project documents to design the UI.', phase, { showUserMsg: false })}
              disabled={isStreaming}
              className="px-5 py-2.5 bg-pink-500 text-white rounded-xl text-sm font-semibold hover:bg-pink-600 transition-all duration-200 shadow-lg shadow-pink-500/20 hover:shadow-pink-500/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Start Working
            </button>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLastAssistant = msg.role === 'assistant' && msg.content &&
            !messages.slice(idx + 1).some((m) => m.role === 'assistant' && m.content);
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLastAssistant={isLastAssistant}
              onQuickReply={handleQuickReply}
              isStreaming={isStreaming}
            />
          );
        })}
        <div ref={messagesEndRef} />
        {!isAtBottom && (
          <button onClick={scrollToBottom} title="Scroll to bottom"
            className="sticky bottom-2 left-full -ml-10 w-8 h-8 rounded-full bg-surface-elevated border border-border shadow-lg flex items-center justify-center text-gray-400 hover:text-pink-400 hover:border-pink-400/50 transition-all z-10">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Auto-scroll toggle */}
      {messages.length > 0 && (
        <label className="flex items-center gap-1.5 px-4 py-1 border-t border-border/50 cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-3 h-3 rounded accent-pink-400 cursor-pointer"
          />
          <span className="text-[10px] text-gray-500">Auto-scroll</span>
        </label>
      )}

      {/* Generation Progress */}
      {(phase === UI_PHASES.DESIGN) && (
        <GenerationProgress
          isGenerating={isStreaming}
          tokenCount={tokenCount}
          estimatedTokens={8000}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Approval Buttons (REVIEW phase) */}
      {phase === UI_PHASES.REVIEW && !isStreaming && (
        <div className="mx-4 mb-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-300 mb-2 font-medium">Components saved to src/components/generated_ui/. Approve the design?</p>
          <div className="flex gap-2">
            <button onClick={handleApprove}
              className="px-4 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors">
              Approve Design
            </button>
            <button onClick={handleOpenPreview}
              className="px-4 py-1.5 bg-surface-elevated text-gray-400 border border-border rounded-lg text-xs font-medium hover:border-border-hover transition-colors">
              Preview
            </button>
          </div>
        </div>
      )}

      {/* Done: Save & Next */}
      {phase === UI_PHASES.DONE && !isStreaming && (
        <div className="mx-4 mb-2 p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
          <p className="text-xs text-green-300 mb-2 font-medium">UI design approved! Proceed to the next phase?</p>
          <div className="flex gap-2">
            {onNext && (
              <button onClick={onNext}
                className="px-4 py-1.5 bg-accent text-surface rounded-lg text-xs font-semibold hover:bg-accent-hover transition-colors flex items-center gap-1.5">
                Next Phase
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <button onClick={handleOpenPreview}
              className="px-4 py-1.5 bg-surface-elevated text-gray-400 border border-border rounded-lg text-xs font-medium hover:border-border-hover transition-colors">
              Preview
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-surface-card/30">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            rows={1}
            disabled={isStreaming || phase === UI_PHASES.DESIGN || phase === UI_PHASES.LOADING}
            className="input-field resize-none min-h-[38px] max-h-[160px] py-2 text-sm disabled:opacity-50"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || phase === UI_PHASES.DESIGN || phase === UI_PHASES.LOADING}
            className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
              input.trim() && !isStreaming ? 'bg-pink-500 text-white hover:bg-pink-600' : 'bg-surface-elevated text-gray-600 cursor-not-allowed'
            }`}
          >
            {isStreaming ? (
              <div className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, isLastAssistant = false, onQuickReply, isStreaming = false }) {
  const { role, content } = message;

  if (role === 'system') {
    return (
      <div className="flex justify-center my-1.5">
        <span className="text-[10px] text-pink-400 bg-pink-500/10 border border-pink-500/20 px-2.5 py-1 rounded-full font-medium">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';
  const questions = isLastAssistant && !isStreaming && content ? parseQuestions(content) : null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%]`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser ? 'bg-pink-500/15 text-gray-200 rounded-br-md' : 'bg-surface-elevated border border-border text-gray-300 rounded-bl-md'
        }`}>
          {!content && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {content && isUser && (
            <div className="whitespace-pre-wrap break-words text-[12px]">{content}</div>
          )}
          {content && !isUser && (
            <div className="prose prose-invert prose-xs max-w-none break-words
              prose-headings:text-gray-200 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
              prose-h1:text-sm prose-h2:text-[13px] prose-h3:text-xs
              prose-p:text-[12px] prose-p:leading-relaxed prose-p:my-1.5 prose-p:text-gray-300
              prose-li:text-[12px] prose-li:text-gray-300 prose-li:my-0.5
              prose-strong:text-gray-200 prose-em:text-gray-300
              prose-code:text-[11px] prose-code:bg-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-pink-400
              prose-pre:bg-surface prose-pre:rounded-lg prose-pre:p-2 prose-pre:my-2
              prose-a:text-pink-400 prose-a:no-underline hover:prose-a:underline
              prose-hr:border-border prose-hr:my-3
              prose-ul:my-1 prose-ol:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{questions ? stripQuestionsBlock(content) : content}</ReactMarkdown>
            </div>
          )}
        </div>
        {questions && onQuickReply && (
          <MultiQuestionReply
            questions={questions}
            onSubmit={onQuickReply}
            disabled={isStreaming}
            accentColor="pink"
          />
        )}
      </div>
    </div>
  );
}
