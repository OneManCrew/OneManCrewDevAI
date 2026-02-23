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
import { notifyAgentComplete, notifyAgentError } from '../services/notificationService';
import log from '../services/logger';

// ─── Phase colors ──────────────────────────────────────────────────────────────
const PHASE_COLORS = {
  [UI_PHASES.LOADING]:   { bg: 'bg-gray-500/15',  text: 'text-gray-400',  dot: 'bg-gray-400' },
  [UI_PHASES.DISCOVERY]: { bg: 'bg-cyan-500/15',  text: 'text-cyan-400',  dot: 'bg-cyan-400' },
  [UI_PHASES.DESIGN]:    { bg: 'bg-pink-500/15',  text: 'text-pink-400',  dot: 'bg-pink-400' },
  [UI_PHASES.REVIEW]:    { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  [UI_PHASES.DONE]:      { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
};

const PHASE_ORDER = [UI_PHASES.DISCOVERY, UI_PHASES.DESIGN, UI_PHASES.REVIEW, UI_PHASES.DONE];

export default function UIDesignerChat({ projectPath, settings, onUpdateSettings, onBack, onNext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(UI_PHASES.LOADING);
  const [tokenCount, setTokenCount] = useState(0);
  const [estimatedDesignTokens, setEstimatedDesignTokens] = useState(12000);
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
  const phaseRef = useRef(phase);
  const abortControllerRef = useRef(null);
  // Tracks the latest contextDocs synchronously so sendToLLM's closure always reads current value
  const contextDocsRef = useRef(contextDocs);
  // Tracks whether we already sent a discovery nudge (so we don't loop forever)
  const discoveryNudgeSentRef = useRef(false);

  messagesRef.current = messages;
  phaseRef.current = phase;
  contextDocsRef.current = contextDocs;

  // ─── Path construction ───────────────────────────────────────────────────────
  const docsPath  = projectPath ? projectPath.replace(/[\\/]+$/, '') + '/docs' : null;
  const uiPath    = projectPath ? projectPath.replace(/[\\/]+$/, '') + '/src/components/generated_ui' : null;
  const themePath = projectPath ? projectPath.replace(/[\\/]+$/, '') + '/src/theme' : null;
  const colorsPath = themePath ? themePath + '/colors.json' : null;

  // ─── Reset all state when projectPath changes ────────────────────────────────
  const prevPathRef = useRef(projectPath);
  const pathStableRef = useRef(true);
  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== projectPath) {
      log.info('UIDesignerChat', 'Project path changed — resetting state');
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
          if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
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

  // ─── Restore chat history on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || historyLoaded) return;
    (async () => {
      try {
        const raw = await api.readFile(chatHistoryPath);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.messages && saved.messages.length > 0) {
            log.info('UIDesignerChat', 'History restored', { messageCount: saved.messages.length, phase: saved.phase });
            setMessages(saved.messages);
            if (saved.phase) setPhase(saved.phase);
            if (saved.hasUI) setHasUI(true);
            // Re-read actual file contents (don't rely on saved contextDocs)
            if (docsPath) {
              try {
                const [srs, hld] = await Promise.all([
                  api.readFile(docsPath + '/SRS.md').catch(() => null),
                  api.readFile(docsPath + '/HLD.md').catch(() => null),
                ]);
                if (srs || hld) setContextDocs({ srs, hld });
              } catch (e) { /* docs may not exist yet */ }
            }
            setHistoryLoaded(true);
            return;
          }
        }
      } catch (e) {
        log.warn('UIDesignerChat', 'Failed to restore chat history', { error: e.message });
      }
      setHistoryLoaded(true);
    })();
  }, [chatHistoryPath, historyLoaded]);

  // ─── Persist chat history on every change ───────────────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || !historyLoaded || messages.length === 0) return;
    if (!pathStableRef.current) return;
    const timer = setTimeout(async () => {
      if (!pathStableRef.current) return;
      try {
        const data = JSON.stringify({ messages, phase, hasUI }, null, 2);
        await api.writeFile(chatHistoryPath, data);
      } catch (e) {
        log.warn('UIDesignerChat', 'Failed to persist chat history', { error: e.message });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, phase, hasUI, chatHistoryPath, historyLoaded]);

  // ─── Load context docs (SRS + HLD) and check for existing UI ──────────────
  useEffect(() => {
    if (!docsPath || historyLoaded === false) return;
    // Skip if we already restored from chat history
    if (messages.length > 0) return;
    log.info('UIDesignerChat', 'Loading context docs', { docsPath });
    (async () => {
      try {
        let [srsExists, hldExists] = await Promise.all([
          api.exists(docsPath + '/SRS.md'),
          api.exists(docsPath + '/HLD.md'),
        ]);

        let effectiveDocsPath = docsPath;

        // ── Fallback: if projectPath ends with /src (common user error), try parent ──
        if (!srsExists && !hldExists) {
          const normalised = (projectPath || '').replace(/[\\/]+$/, '');
          if (/[\\/]src$/i.test(normalised)) {
            const parentPath = normalised.replace(/[\\/]src$/i, '');
            const fallbackPath = parentPath + '/docs';
            log.info('UIDesignerChat', 'Trying parent-directory fallback', { fallbackPath });
            const [fSrs, fHld] = await Promise.all([
              api.exists(fallbackPath + '/SRS.md'),
              api.exists(fallbackPath + '/HLD.md'),
            ]);
            if (fSrs || fHld) {
              effectiveDocsPath = fallbackPath;
              srsExists = fSrs;
              hldExists = fHld;
              log.info('UIDesignerChat', 'Docs found at parent path', { fallbackPath });
              addMessage('system', `⚠️ Docs found at ${fallbackPath} — workspace was set to a subdirectory. Consider re-selecting the project root.`);
            }
          }
        }

        if (!srsExists && !hldExists) {
          log.warn('UIDesignerChat', 'No docs found', { docsPath });
          setError(`No SRS.md or HLD.md found in ${docsPath}. Complete the Architect phase first.`);
          setPhase(UI_PHASES.LOADING); // stay in loading so user can retry
          return;
        }

        const [srs, hld] = await Promise.all([
          srsExists ? api.readFile(effectiveDocsPath + '/SRS.md') : Promise.resolve(null),
          hldExists ? api.readFile(effectiveDocsPath + '/HLD.md') : Promise.resolve(null),
        ]);

        // Load existing design tokens if available
        let designTokens = null;
        if (colorsPath) {
          try {
            const colorsRaw = await api.readFile(colorsPath);
            if (colorsRaw) designTokens = JSON.parse(colorsRaw);
          } catch (e) { /* no tokens yet */ }
        }

        const ctx = { srs: srs || null, hld: hld || null, designTokens };
        setContextDocs(ctx);
        contextDocsRef.current = ctx;
        log.info('UIDesignerChat', 'Context docs loaded', { srsLen: srs?.length, hldLen: hld?.length, hasTokens: !!designTokens });

        // Check for existing generated UI components (resume support)
        const uiDirExists = uiPath ? await api.exists(uiPath) : false;
        let existingComponents = [];
        if (uiDirExists) {
          try {
            const entries = await api.readDir(uiPath);
            existingComponents = (entries || []).filter(e => !e.isDirectory && /\.(html|css|js|jsx|tsx)$/.test(e.name));
          } catch (e) { /* ignore */ }
        }

        if (existingComponents.length > 0) {
          setHasUI(true);
          setPhase(UI_PHASES.REVIEW);
          addMessage('system', `Existing UI components found (${existingComponents.length} files in src/components/generated_ui/). You can review, request changes, or approve.`);
        } else {
          setPhase(UI_PHASES.DISCOVERY);
          addMessage('system', `SRS and HLD loaded (${(srs || '').length + (hld || '').length} chars total). Starting UI design discussion.`);
        }
      } catch (err) {
        log.error('UIDesignerChat', 'Failed to load context docs', err);
        setError('Failed to load context documents: ' + err.message);
      }
    })();
  }, [docsPath, historyLoaded]);

  // ─── Message helpers ─────────────────────────────────────────────────────────
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

  // ─── Save design tokens ──────────────────────────────────────────────────────
  const saveDesignTokens = useCallback(async (tokens) => {
    if (!colorsPath || !tokens) return;
    try {
      await api.safeWriteFile(colorsPath, JSON.stringify(tokens, null, 2));
      setContextDocs(prev => {
        const updated = { ...prev, designTokens: tokens };
        contextDocsRef.current = updated;
        return updated;
      });
      addMessage('system', 'Design tokens saved to src/theme/colors.json.');
      log.info('UIDesignerChat', 'Design tokens saved', { path: colorsPath });
    } catch (err) {
      log.error('UIDesignerChat', 'Failed to save design tokens', err);
    }
  }, [colorsPath, addMessage]);

  // ─── Save UI component files ─────────────────────────────────────────────────
  const saveComponents = useCallback(async (components) => {
    if (!uiPath || !components || components.length === 0) return 0;
    let saved = 0;
    for (const comp of components) {
      try {
        const filePath = uiPath + '/' + comp.filename;
        await api.safeWriteFile(filePath, comp.content);
        saved++;
        log.info('UIDesignerChat', `Saved component: ${comp.filename}`, { chars: comp.content.length });
      } catch (err) {
        log.error('UIDesignerChat', `Failed to save component: ${comp.filename}`, err);
      }
    }
    if (saved > 0) setHasUI(true);
    return saved;
  }, [uiPath]);

  // ─── Preview ─────────────────────────────────────────────────────────────────
  const previewComponents = useCallback(async () => {
    if (!uiPath) return;
    try {
      const indexPath = uiPath + '/index.html';
      const exists = await api.exists(indexPath);
      if (exists) {
        await api.openPreview(indexPath);
      } else {
        addMessage('system', '⚠️ index.html not found. Generate the UI mockup first.');
      }
    } catch (err) {
      log.error('UIDesignerChat', 'Failed to open preview', err);
    }
  }, [uiPath, addMessage]);

  const handleOpenPreview = useCallback(() => previewComponents(), [previewComponents]);

  // ─── Live Preview (Vite dev server) ─────────────────────────────────────────
  const [viteUrl, setViteUrl] = useState(null);

  useEffect(() => {
    if (!hasUI) return;
    let cancelled = false;
    const check = async () => {
      try {
        const url = await api.detectViteServer();
        // Ignore port 5173 (OneManCrew IDE) — only accept other ports
        if (!cancelled && url && !url.includes(':5173')) setViteUrl(url);
        else if (!cancelled) setViteUrl(null);
      } catch (e) { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [hasUI]);

  const handleOpenLivePreview = useCallback(async () => {
    if (viteUrl) {
      await api.openPreviewUrl(viteUrl);
    } else {
      const url = await api.detectViteServer();
      if (url && !url.includes(':5173')) {
        setViteUrl(url);
        await api.openPreviewUrl(url);
      } else {
        await previewComponents();
      }
    }
  }, [viteUrl, previewComponents]);

  // ─── Stop streaming ──────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      log.info('UIDesignerChat', 'Stopping stream');
      abortControllerRef.current.abort();
    }
  }, []);

  // ─── Skip to Design (escape hatch) ──────────────────────────────────────────
  const handleForceDesign = useCallback(() => {
    if (isStreaming) return;
    setPhase(UI_PHASES.DESIGN);
    addMessage('system', `Phase: ${UI_PHASE_LABELS[UI_PHASES.DISCOVERY]} → ${UI_PHASE_LABELS[UI_PHASES.DESIGN]} (forced)`);
    // Use the latest contextDocs from the ref (not stale closure)
    _sendToLLMInternal(
      'Discovery is complete. Generate the full UI mockup now based on everything we discussed.',
      UI_PHASES.DESIGN,
      { showUserMsg: false }
    );
  }, [isStreaming]);

  // ─── Core LLM send ───────────────────────────────────────────────────────────
  // Internal implementation — uses refs to avoid stale closure issues.
  const _sendToLLMInternal = useCallback(async (userMessage, currentPhase, { showUserMsg = true } = {}) => {
    log.info('UIDesignerChat.sendToLLM', 'CALLED', { phase: currentPhase, showUserMsg, msgLen: userMessage.length });
    setError(null);
    if (showUserMsg) addMessage('user', userMessage);

    const allMessages = [...messagesRef.current];
    allMessages.push({ role: 'user', content: userMessage });
    // Always read contextDocs from the ref for freshest value
    const conversationMessages = buildUIConversationMessages(allMessages, currentPhase, contextDocsRef.current);
    const totalChars = conversationMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    // Create AbortController for stop-stream support
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsStreaming(true);
    if (currentPhase === UI_PHASES.DESIGN) {
      setTokenCount(0);
      setEstimatedDesignTokens(Math.max(10000, Math.round(totalChars / 4) + 6000));
    } else if (currentPhase === UI_PHASES.REVIEW || currentPhase === UI_PHASES.DONE) {
      setTokenCount(0);
    }
    addMessage('assistant', '');

    try {
      const provider = createLLMProvider(agentSettings);
      let fullResponse = '';
      let tokenCount_ = 0;

      await provider.chat(conversationMessages, agentSettings, {
        signal: abortController.signal,
        onToken: (token) => {
          fullResponse += token;
          tokenCount_++;
          updateLastAssistant(fullResponse);
          if (currentPhase === UI_PHASES.DESIGN || currentPhase === UI_PHASES.REVIEW || currentPhase === UI_PHASES.DONE) {
            setTokenCount((c) => c + 1);
          }
        },
        onDone: async (finalText) => {
          log.info('UIDesignerChat.sendToLLM', 'onDone', { finalLen: finalText?.length, tokens: tokenCount_ });
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);

          // Phase transition: DISCOVERY → DESIGN
          const nextPhase = detectUIPhaseTransition(fullResponse, currentPhase);
          if (nextPhase) {
            setPhase(nextPhase);
            addMessage('system', `Phase: ${UI_PHASE_LABELS[currentPhase]} → ${UI_PHASE_LABELS[nextPhase]}`);
            if (nextPhase === UI_PHASES.DESIGN) {
              // Auto-trigger design generation — use sendToLLM (not a separate function)
              // to ensure fresh contextDocs (design tokens just saved above)
              setTimeout(() => _sendToLLMInternal(
                'Design tokens are set. Now generate the complete UI mockup: index.html, styles.css, and app.js. Include ALL screens from the SRS.',
                UI_PHASES.DESIGN,
                { showUserMsg: false }
              ), 500);
            }
          }

          // Extract and save design tokens (typically during DISCOVERY)
          const output = parseUIDesignerOutput(fullResponse);
          if (output.designTokens) {
            await saveDesignTokens(output.designTokens);
          }

          // ── Force transition: if tokens saved + nudge already sent → don't wait for [UI_DISCOVERY_COMPLETE] ──
          // This breaks the infinite loop: model saves tokens but keeps forgetting the completion token.
          // After the first nudge, if it still saved tokens, we trust that's good enough.
          if (currentPhase === UI_PHASES.DISCOVERY && !nextPhase && output.designTokens && discoveryNudgeSentRef.current) {
            log.info('UIDesignerChat', 'Forcing DISCOVERY→DESIGN (tokens saved after nudge)');
            discoveryNudgeSentRef.current = false;
            setPhase(UI_PHASES.DESIGN);
            addMessage('system', `Phase: ${UI_PHASE_LABELS[UI_PHASES.DISCOVERY]} → ${UI_PHASE_LABELS[UI_PHASES.DESIGN]}`);
            setTimeout(() => _sendToLLMInternal(
              'Design tokens are set. Now generate the complete UI mockup: index.html, styles.css, and app.js. Include ALL screens from the SRS.',
              UI_PHASES.DESIGN,
              { showUserMsg: false }
            ), 500);
            return; // skip further processing
          }

          // ── Auto-nudge: if discovery stalls (no [UI_DISCOVERY_COMPLETE] emitted) ──
          // Fires after ANY DISCOVERY response — regardless of user message count.
          // (The initial trigger is sent with showUserMsg:false so it never adds to
          //  messagesRef, meaning the old userMsgCount >= 1 check never fired.)
          // Delay is 5 seconds so the user can read and optionally reply first.
          // The check inside the timeout guards against double-nudge if user already replied.
          if (currentPhase === UI_PHASES.DISCOVERY && !nextPhase) {
            const discoveryMsgCount = messagesRef.current.filter(m => m.role === 'assistant' && m.content).length;
            setTimeout(() => {
              // Only fire if we're still in DISCOVERY and no stream is running
              if (!abortControllerRef.current && phaseRef.current === UI_PHASES.DISCOVERY) {
                log.info('UIDesignerChat', 'Auto-nudging discovery completion', { discoveryMsgCount });
                discoveryNudgeSentRef.current = true; // mark nudge sent (prevents infinite loop)
                addMessage('system', '⏩ Completing discovery...');
                _sendToLLMInternal(
                  'IMPORTANT: You forgot to include the colors.json block and [UI_DISCOVERY_COMPLETE] in your previous response. ' +
                  'Output ONLY the colors.json fenced block now, then [UI_DISCOVERY_COMPLETE]. No other text.',
                  UI_PHASES.DISCOVERY,
                  { showUserMsg: false }
                );
              }
            }, 5000);
          }

          // Save component files (during DESIGN, REVIEW, DONE)
          if ([UI_PHASES.DESIGN, UI_PHASES.REVIEW, UI_PHASES.DONE].includes(currentPhase) && output.components.length > 0) {
            const savedCount = await saveComponents(output.components);
            const names = output.components.map(c => c.filename).join(', ');
            if (currentPhase === UI_PHASES.DESIGN) {
              setPhase(UI_PHASES.REVIEW);
              setTokenCount(0);
              addMessage('system', `✅ UI mockup generated! ${savedCount} files saved to src/components/generated_ui/ (${names}). Open Preview to review.`);
            } else {
              addMessage('system', `✅ UI updated. ${savedCount} file(s) saved (${names}).`);
            }
          }
        },
        onError: (err) => {
          log.error('UIDesignerChat.sendToLLM', 'onError', { message: err.message });
          setError(err.message || 'An error occurred.');
          notifyAgentError('UI Designer', err.message);
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        log.error('UIDesignerChat.sendToLLM', 'CATCH', { message: err.message });
        setError(err.message || 'Failed to connect to the LLM provider.');
        notifyAgentError('UI Designer', err.message);
      } else {
        log.info('UIDesignerChat.sendToLLM', 'Stream stopped by user');
      }
    } finally {
      log.info('UIDesignerChat.sendToLLM', 'FINALLY — setIsStreaming(false)');
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [agentSettings, addMessage, updateLastAssistant, saveComponents, saveDesignTokens]);

  // Public API — forwarded to internal implementation
  const sendToLLM = _sendToLLMInternal;

  // ─── Quick reply handler ─────────────────────────────────────────────────────
  const handleQuickReply = async (value) => {
    if (isStreaming) return;
    setInput('');
    await sendToLLM(value, phase);
  };

  // ─── Handle user send ────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage = input.trim();
    setInput('');
    await sendToLLM(userMessage, phase);
  };

  // ─── Approve design ──────────────────────────────────────────────────────────
  const handleApprove = () => {
    if (isStreaming) return;
    setPhase(UI_PHASES.DONE);
    addMessage('system', '✅ UI design approved! You can still request changes or proceed to the next phase.');
    notifyAgentComplete('UI Designer');
  };

  // ─── Reset agent ────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (isStreaming) return;
    if (!confirm('Reset the UI Designer? This will delete the UI mockup and chat history.')) return;
    abortControllerRef.current?.abort();
    discoveryNudgeSentRef.current = false;
    try {
      if (uiPath) {
        try {
          const entries = await api.readDir(uiPath);
          for (const entry of (entries || [])) {
            if (!entry.isDirectory && /\.(html|css|js|jsx|tsx)$/.test(entry.name)) {
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
  const assistantMsgCount = messages.filter(m => m.role === 'assistant' && m.content).length;

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
            <p className="text-[10px] text-gray-500">Senior UX/UI Expert · 30+ years</p>
          </div>

          <div className="flex-1" />

          {/* Live Preview button (Vite detected) */}
          {hasUI && viteUrl && (
            <button onClick={handleOpenLivePreview}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 hover:bg-green-500/30 hover:text-green-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Open Live Preview
            </button>
          )}
          {/* Fallback Preview button */}
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

        {!messages.some(m => m.role === 'user' || m.role === 'assistant') && phase !== UI_PHASES.LOADING && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-11 h-11 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-300 mb-1">UI Designer Ready</h3>
            <p className="text-xs text-gray-500 max-w-sm mb-4">
              I've read the SRS and HLD. I'll design a complete UI mockup — all screens, navigation, and interactions.
            </p>
            <button
              onClick={() => sendToLLM('Analyze the SRS and HLD. List every navigable screen you identified. State your design decisions for colors, typography, and layout. Then ask at most 2 short questions about visual preferences.', phase, { showUserMsg: false })}
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

      {/* Generation Progress — show during DESIGN and REVIEW/DONE streaming */}
      {(phase === UI_PHASES.DESIGN || ((phase === UI_PHASES.REVIEW || phase === UI_PHASES.DONE) && isStreaming)) && (
        <GenerationProgress
          isGenerating={isStreaming}
          tokenCount={tokenCount}
          estimatedTokens={phase === UI_PHASES.DESIGN ? estimatedDesignTokens : 5000}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          <div className="flex items-start gap-2">
            <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Recovery actions */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => { setError(null); setHistoryLoaded(false); }}
              className="px-2.5 py-1 text-[10px] bg-red-500/20 border border-red-500/30 rounded text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="px-2.5 py-1 text-[10px] bg-surface-elevated border border-border rounded text-gray-400 hover:text-gray-200 transition-colors"
              >
                ← Back to Architect
              </button>
            )}
          </div>
        </div>
      )}

      {/* Skip to Design — shown in DISCOVERY after ≥1 assistant reply */}
      {phase === UI_PHASES.DISCOVERY && !isStreaming && assistantMsgCount >= 1 && (
        <div className="mx-4 mb-1 flex justify-end">
          <button
            onClick={handleForceDesign}
            title="Skip remaining discovery questions and start generating the UI mockup"
            className="text-[10px] text-gray-600 hover:text-pink-400 transition-colors underline underline-offset-2"
          >
            Skip to Design →
          </button>
        </div>
      )}

      {/* Approval Buttons (REVIEW phase) */}
      {phase === UI_PHASES.REVIEW && !isStreaming && (
        <div className="mx-4 mb-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-300 mb-2 font-medium">UI mockup saved to src/components/generated_ui/. Approve the design?</p>
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

      {/* Done: Next phase */}
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
          {/* Stop button — visible while streaming */}
          {isStreaming && (
            <button
              onClick={handleStop}
              title="Stop generation"
              className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          )}
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
      <div className="max-w-[90%]">
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
