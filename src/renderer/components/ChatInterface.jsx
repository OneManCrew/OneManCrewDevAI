import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createLLMProvider, getAgentSettings } from '../services/llmProviders';
import {
  PHASES, PHASE_LABELS,
  detectPhaseTransition, isApproval,
  buildConversationMessages, parseArchitectOutput, saveArchitectDocs, updateContextSummary,
} from '../services/architectAgent';
import api from '../services/electronBridge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import GenerationProgress from './GenerationProgress';
import DocumentPanel, { checkExistingDocs } from './DocumentPanel';
import MultiQuestionReply, { parseQuestions, stripQuestionsBlock } from './QuickReply';
import ModelSelector from './ModelSelector';
import { notifyAgentComplete, notifyAgentError, notifyUserAttentionNeeded } from '../services/notificationService';
import log from '../services/logger';

// ─── Phase colors ──────────────────────────────────────────────────────────────
const PHASE_COLORS = {
  [PHASES.DISCOVERY]: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400' },
  [PHASES.ANALYSIS]: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  [PHASES.CONFIRM]: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400' },
  [PHASES.GENERATION]: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
  [PHASES.DONE]: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
};

const PHASE_ORDER = [PHASES.DISCOVERY, PHASES.ANALYSIS, PHASES.CONFIRM, PHASES.GENERATION, PHASES.DONE];

// ─── View modes ────────────────────────────────────────────────────────────────
const VIEW = { CHAT: 'chat', DOCS: 'docs', SPLIT: 'split' };

export default function ChatInterface({ projectPath, settings, onUpdateSettings, onOpenProject, onNext }) {
  log.info('ChatInterface', 'Component render', { projectPath, provider: settings?.provider });
  if (projectPath) log.setProjectPath(projectPath);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(PHASES.DISCOVERY);
  const [view, setView] = useState(VIEW.CHAT);
  const [tokenCount, setTokenCount] = useState(0);
  const [docsReady, setDocsReady] = useState(false);
  const [docsVersion, setDocsVersion] = useState(0);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [estimatedGenerationTokens, setEstimatedGenerationTokens] = useState(15000);
  const agentSettings = React.useMemo(() => getAgentSettings(settings, 'architect'), [settings]);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(messages);
  const phaseRef = useRef(phase);
  const abortControllerRef = useRef(null);
  messagesRef.current = messages;
  phaseRef.current = phase;

  // ─── Reset all state when projectPath changes (workspace switch) ──────
  const prevPathRef = useRef(projectPath);
  const pathStableRef = useRef(true);
  const pendingFollowUpKeyRef = useRef(null); // tracks which doc key ('srs'|'hld') the auto-follow-up is fetching
  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== projectPath) {
      log.info('ChatInterface', 'Project path changed — resetting state', { from: prevPathRef.current, to: projectPath });
      pathStableRef.current = false;
      setMessages([]);
      setInput('');
      setIsStreaming(false);
      setError(null);
      setPhase(PHASES.DISCOVERY);
      setView(VIEW.CHAT);
      setTokenCount(0);
      setDocsReady(false);
      setResumeChecked(false);
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
      // Also scroll any nested scrollable containers to their bottom
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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const chatHistoryPath = projectPath ? projectPath.replace(/[\/\\]$/, '') + '/docs/architect-chat.json' : null;

  // ─── Restore chat history on mount ──────────────────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || historyLoaded) return;
    log.info('ChatInterface', 'Restoring chat history', { chatHistoryPath });
    (async () => {
      try {
        const raw = await api.readFile(chatHistoryPath);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.messages && saved.messages.length > 0) {
            log.info('ChatInterface', 'History restored', { messageCount: saved.messages.length, phase: saved.phase, docsReady: saved.docsReady });
            setMessages(saved.messages);
            if (saved.phase) setPhase(saved.phase);
            if (saved.docsReady) setDocsReady(true);
            if (saved.phase === PHASES.DONE || saved.docsReady) setView(VIEW.SPLIT);
            setResumeChecked(true);
            setHistoryLoaded(true);
            return;
          }
        }
        log.info('ChatInterface', 'No history found or empty');
      } catch (e) {
        log.error('ChatInterface', 'Failed to restore chat history', e);
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
        const data = JSON.stringify({ messages, phase, docsReady }, null, 2);
        await api.writeFile(chatHistoryPath, data);
      } catch (e) {
        console.warn('Failed to persist architect chat history:', e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, phase, docsReady, chatHistoryPath, historyLoaded]);

  // ─── Check for existing docs on mount (resume support) ───────────────────
  useEffect(() => {
    if (!projectPath || resumeChecked) return;
    log.info('ChatInterface', 'Checking for existing docs', { projectPath });
    (async () => {
      const { hasDocs, srs, hld } = await checkExistingDocs(projectPath);
      log.info('ChatInterface', 'Existing docs check result', { hasDocs, srsLen: srs?.length || 0, hldLen: hld?.length || 0 });
      if (hasDocs) {
        setDocsReady(true);
        setPhase(PHASES.DONE);
        setView(VIEW.SPLIT);
        const summary = [];
        if (srs) summary.push(`SRS.md (${srs.length} chars)`);
        if (hld) summary.push(`HLD.md (${hld.length} chars)`);
        addMessage('system', `Existing documents found: ${summary.join(', ')}. You can review, edit, or ask the Architect to make changes.`);
      }
      setResumeChecked(true);
    })();
  }, [projectPath, resumeChecked]);

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

  // ─── Core LLM send ──────────────────────────────────────────────────────
  const sendToLLM = useCallback(async (userMessage, currentPhase, { showUserMsg = true } = {}) => {
    log.info('sendToLLM', 'CALLED', { phase: currentPhase, showUserMsg, msgLen: userMessage.length, provider: agentSettings?.provider, model: agentSettings?.selectedModel });
    setError(null);
    if (showUserMsg) addMessage('user', userMessage);

    const allMessages = [...messagesRef.current];
    // Always include the user message in the LLM conversation, even if not shown in UI
    allMessages.push({ role: 'user', content: userMessage });
    const conversationMessages = buildConversationMessages(allMessages, currentPhase, projectPath);
    const totalChars = conversationMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    log.info('sendToLLM', 'Conversation built', { messageCount: conversationMessages.length, totalChars, lastRole: conversationMessages[conversationMessages.length - 1]?.role });

    // Create an AbortController so the user can stop the stream mid-way
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsStreaming(true);
    if (currentPhase === PHASES.GENERATION) {
      setTokenCount(0);
      // Estimate output tokens from context size (rough: 1 token ≈ 4 chars, add 5k buffer for docs)
      setEstimatedGenerationTokens(Math.max(12000, Math.round(totalChars / 4) + 5000));
    }
    addMessage('assistant', '');

    try {
      const provider = createLLMProvider(agentSettings);
      log.info('sendToLLM', 'Provider created, calling chat()', { providerType: provider.constructor.name });
      let fullResponse = '';
      let tokenCount_ = 0;

      await provider.chat(conversationMessages, agentSettings, {
        signal: abortController.signal,
        onToken: (token) => {
          fullResponse += token;
          tokenCount_++;
          if (tokenCount_ === 1) log.info('sendToLLM', 'First token received', { tokenLen: token.length });
          if (tokenCount_ % 100 === 0) log.debug('sendToLLM', `Token progress: ${tokenCount_} tokens, ${fullResponse.length} chars`);
          updateLastAssistant(fullResponse);
          if (currentPhase === PHASES.GENERATION) {
            setTokenCount((c) => c + 1);
          }
        },
        onDone: async (finalText) => {
          log.info('sendToLLM', 'onDone fired', { finalTextLen: finalText?.length, fullResponseLen: fullResponse.length, totalTokens: tokenCount_ });
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);

          // Phase transitions
          const nextPhase = detectPhaseTransition(fullResponse, currentPhase);
          if (nextPhase) {
            setPhase(nextPhase);
            addMessage('system', `Phase: ${PHASE_LABELS[currentPhase]} → ${PHASE_LABELS[nextPhase]}`);
            if (nextPhase === PHASES.ANALYSIS) {
              // Use sendToLLM with a silent trigger message — avoids duplicate code
              // and ensures Anthropic-compatible conversation (ends with user role)
              setTimeout(() => sendToLLM(
                'Discovery is complete. Present your full structured analysis now.',
                PHASES.ANALYSIS,
                { showUserMsg: false }
              ), 500);
            }
          }

          // ─── Save docs helper (shared by GENERATION and DONE) ───
          // onlyKeys: optional array like ['hld'] to save only specific docs (used by auto-follow-up)
          const _handleDocSave = async (docs, phase, { onlyKeys = null, isFollowUp = false } = {}) => {
            if (!docs.srs && !docs.hld) return;
            const { saved, errors } = await saveArchitectDocs(projectPath, docs, { onlyKeys });
            setDocsReady(true);
            setDocsVersion(v => v + 1);
            if (phase === PHASES.GENERATION) {
              setPhase(PHASES.DONE);
              setView(VIEW.SPLIT);
              setTokenCount(0);
              notifyAgentComplete('Architect');
            }
            if (saved.length > 0) {
              addMessage('system', `[ARCHITECT] Infrastructure plan secured to disk: ${saved.join(', ')}`);
              // Update the shared knowledge base so downstream agents have context
              await updateContextSummary(projectPath, docs).catch(() => {});
            }
            if (errors.length > 0) {
              addMessage('system', `⚠️ Save errors: ${errors.join('; ')}`);
            }

            // Auto-follow-up: if only one doc was produced AND this is NOT already a follow-up
            if (!isFollowUp) {
              const missingSRS = !docs.srs;
              const missingHLD = !docs.hld;
              if (missingSRS || missingHLD) {
                const missingDoc = missingSRS ? 'SRS' : 'HLD';
                const missingKey = missingSRS ? 'srs' : 'hld';
                const missingFence = missingSRS ? '```srs' : '```hld';
                log.info('sendToLLM', `autoFollowUp — Missing ${missingDoc}`);
                addMessage('system', `⏳ ${missingDoc} was not included — requesting it automatically...`);
                pendingFollowUpKeyRef.current = missingKey;
                setTokenCount(0);
                setTimeout(() => {
                  sendToLLM(
                    `IMPORTANT: You did NOT produce the ${missingDoc} document in your previous response. I need it NOW.\n\n` +
                    `DO NOT output an SRS document. DO NOT use \`\`\`srs fences.\n` +
                    `You MUST output ONLY the ${missingDoc} document, wrapped in:\n\n` +
                    `${missingFence}\n# ${missingDoc === 'HLD' ? 'High-Level Design (HLD)' : 'Software Requirements Specification (SRS)'}\n... complete content ...\n\`\`\`\n\n` +
                    `Start your response with ${missingFence} immediately. No other text before it.`,
                    PHASES.DONE,
                    { showUserMsg: false }
                  );
                }, 500);
              }
            }
          };

          // Generation: extract and save docs
          if (currentPhase === PHASES.GENERATION) {
            const docs = parseArchitectOutput(fullResponse);
            if (docs.srs || docs.hld) {
              await _handleDocSave(docs, PHASES.GENERATION);
            }
          }

          // Post-generation edits: if DONE and agent responds with doc fences, update files
          if (currentPhase === PHASES.DONE) {
            log.info('sendToLLM', 'DONE phase onDone', { responseLen: fullResponse.length });
            const docs = parseArchitectOutput(fullResponse);
            if (docs.srs || docs.hld) {
              const followUpKey = pendingFollowUpKeyRef.current;
              if (followUpKey) {
                pendingFollowUpKeyRef.current = null;
                log.info('sendToLLM', `Follow-up save — only saving: ${followUpKey}`);
                await _handleDocSave(docs, PHASES.DONE, { onlyKeys: [followUpKey], isFollowUp: true });
              } else {
                await _handleDocSave(docs, PHASES.DONE);
              }
            }
          }
        },
        onError: (err) => {
          log.error('sendToLLM', 'onError fired', { message: err.message, stack: err.stack });
          setError(err.message || 'An error occurred.');
          notifyAgentError('Architect', err.message);
        },
      });
    } catch (err) {
      // AbortError means user clicked Stop — not a real error, keep what was generated
      if (err.name !== 'AbortError') {
        log.error('sendToLLM', 'CATCH block — provider.chat threw', { message: err.message, stack: err.stack });
        setError(err.message || 'Failed to connect to the LLM provider.');
        notifyAgentError('Architect', err.message);
      } else {
        log.info('sendToLLM', 'Stream stopped by user');
      }
    } finally {
      log.info('sendToLLM', 'FINALLY — setIsStreaming(false)');
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [projectPath, agentSettings, addMessage, updateLastAssistant]);

  // ─── Stop streaming ──────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      log.info('handleStop', 'Aborting stream');
      abortControllerRef.current.abort();
    }
  }, []);

  // ─── Force phase advance (escape hatch when LLM forgets [DISCOVERY_COMPLETE]) ──
  const handleForceAnalysis = useCallback(() => {
    if (isStreaming) return;
    setPhase(PHASES.ANALYSIS);
    addMessage('system', `Phase: ${PHASE_LABELS[PHASES.DISCOVERY]} → ${PHASE_LABELS[PHASES.ANALYSIS]} (forced)`);
    sendToLLM(
      'Discovery is complete. Present your full structured analysis now.',
      PHASES.ANALYSIS,
      { showUserMsg: false }
    );
  }, [isStreaming, addMessage, sendToLLM]);

  // ─── Quick reply handler (from option buttons) ─────────────────────────
  const handleQuickReply = async (value) => {
    if (isStreaming) return;
    if (!projectPath) { setError('Select a project workspace first.'); return; }
    setInput('');

    if (phase === PHASES.CONFIRM) {
      if (isApproval(value)) {
        setPhase(PHASES.GENERATION);
        addMessage('system', `Phase: ${PHASE_LABELS[PHASES.CONFIRM]} → ${PHASE_LABELS[PHASES.GENERATION]}`);
        await sendToLLM('The user has approved the analysis. Please proceed to generate the full SRS.md and HLD.md documents now.', PHASES.GENERATION);
      } else {
        setPhase(PHASES.DISCOVERY);
        addMessage('system', 'Returning to Discovery with your feedback.');
        await sendToLLM(value, PHASES.DISCOVERY);
      }
      return;
    }

    if (phase === PHASES.DONE) {
      await sendToLLM(value, PHASES.DONE);
      return;
    }

    await sendToLLM(value, phase);
  };

  // ─── Handle user send ────────────────────────────────────────────────────
  const handleSend = async () => {
    log.info('handleSend', 'Called', { inputLen: input.trim().length, isStreaming, phase, projectPath: !!projectPath });
    if (!input.trim() || isStreaming) { log.warn('handleSend', 'Blocked', { emptyInput: !input.trim(), isStreaming }); return; }
    if (!projectPath) { setError('Select a project workspace first.'); return; }

    const userMessage = input.trim();
    setInput('');

    // CONFIRM phase: approval or feedback
    if (phase === PHASES.CONFIRM) {
      if (isApproval(userMessage)) {
        setPhase(PHASES.GENERATION);
        addMessage('system', `Phase: ${PHASE_LABELS[PHASES.CONFIRM]} → ${PHASE_LABELS[PHASES.GENERATION]}`);
        await sendToLLM('The user has approved the analysis. Please proceed to generate the full SRS.md and HLD.md documents now.', PHASES.GENERATION);
      } else {
        setPhase(PHASES.DISCOVERY);
        addMessage('system', 'Returning to Discovery with your feedback.');
        await sendToLLM(userMessage, PHASES.DISCOVERY);
      }
      return;
    }

    // DONE phase: post-generation dialogue — user can request changes to docs
    if (phase === PHASES.DONE) {
      await sendToLLM(userMessage, PHASES.DONE);
      return;
    }

    await sendToLLM(userMessage, phase);
  };

  // ─── Approval handlers ───────────────────────────────────────────────────
  const handleApprove = async () => {
    log.info('handleApprove', 'Called', { isStreaming, phase });
    if (isStreaming) return;
    setPhase(PHASES.GENERATION);
    addMessage('system', `Phase: ${PHASE_LABELS[PHASES.CONFIRM]} → ${PHASE_LABELS[PHASES.GENERATION]}`);
    await sendToLLM('The user has approved the analysis. Please proceed to generate the full SRS.md and HLD.md documents now.', PHASES.GENERATION);
  };

  const handleRequestChanges = () => {
    if (isStreaming) return;
    setPhase(PHASES.DISCOVERY);
    addMessage('system', 'Returning to Discovery. Describe what you\'d like to change.');
    inputRef.current?.focus();
  };

  // ─── Doc panel: request change via chat ──────────────────────────────────
  const handleDocRequestChange = () => {
    setView(VIEW.SPLIT);
    inputRef.current?.focus();
  };

  // ─── Reset agent ────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (isStreaming) return;
    if (!confirm('Reset the Architect agent? This will delete SRS.md, HLD.md, and chat history.')) return;
    // Stop any in-progress stream first
    abortControllerRef.current?.abort();
    const docsPath = projectPath.replace(/[\\/]$/, '') + '/docs';
    await Promise.allSettled([
      api.writeFile(docsPath + '/SRS.md', ''),
      api.writeFile(docsPath + '/HLD.md', ''),
      api.writeFile(chatHistoryPath, ''),
    ]);
    setMessages([]);
    setPhase(PHASES.DISCOVERY);
    setView(VIEW.CHAT);
    setTokenCount(0);
    setDocsReady(false);
    setDocsVersion(0);
    setEstimatedGenerationTokens(15000);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const getPlaceholder = () => {
    switch (phase) {
      case PHASES.DISCOVERY: return 'Describe your project or answer the Architect\'s questions...';
      case PHASES.ANALYSIS: return 'Waiting for analysis...';
      case PHASES.CONFIRM: return 'Type feedback or use the buttons below...';
      case PHASES.GENERATION: return 'Generating documents...';
      case PHASES.DONE: return 'Ask the Architect to modify the documents, or click Next...';
      default: return 'Type a message...';
    }
  };

  // ─── No workspace ────────────────────────────────────────────────────────
  if (!projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-surface-elevated border border-border flex items-center justify-center mb-4 mx-auto">
            <svg className="w-7 h-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-300 mb-2">No Workspace Selected</h2>
          <p className="text-sm text-gray-500 mb-4">Select a project directory to start chatting with the Architect agent.</p>
          <button onClick={onOpenProject} className="btn-primary">Select Workspace</button>
        </div>
      </div>
    );
  }

  const phaseColor = PHASE_COLORS[phase] || PHASE_COLORS[PHASES.DISCOVERY];
  const showDocs = (view === VIEW.DOCS || view === VIEW.SPLIT) && docsReady;
  const showChat = view === VIEW.CHAT || view === VIEW.SPLIT;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-card/50">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-200 leading-tight">The Architect</p>
            <p className="text-[10px] text-gray-500">Senior Software Architect</p>
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-surface rounded-lg border border-border p-0.5 ml-auto">
            {[
              { id: VIEW.CHAT, label: 'Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
              { id: VIEW.SPLIT, label: 'Split', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7' },
              { id: VIEW.DOCS, label: 'Docs', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                disabled={v.id !== VIEW.CHAT && !docsReady}
                title={v.label}
                className={`p-1.5 rounded-md transition-colors ${
                  view === v.id ? 'bg-surface-elevated text-accent' : 'text-gray-500 hover:text-gray-300'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={v.icon} />
                </svg>
              </button>
            ))}
          </div>

          {/* Phase Badge */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${phaseColor.bg} ${phaseColor.text}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${phaseColor.dot} ${phase !== PHASES.DONE ? 'animate-pulse' : ''}`} />
            {PHASE_LABELS[phase]}
          </div>
          <ModelSelector
            settings={agentSettings}
            agentId="architect"
            accentColor="accent"
            onModelChange={(provider, model) => {
              const newSettings = {
                ...settings,
                agentModels: { ...settings.agentModels, architect: { provider, model } },
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
                i < currentIdx ? 'bg-accent' : i === currentIdx ? 'bg-accent/50' : 'bg-border'
              }`} />
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Panel */}
        {showChat && (
          <div className={`flex flex-col overflow-hidden ${showDocs ? 'w-1/2 border-r border-border' : 'w-full'}`}>
            {/* Messages */}
            <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-11 h-11 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-1">Ready to Architect</h3>
                  <p className="text-xs text-gray-500 max-w-sm mb-4">
                    I'll ask questions about your project, analyze requirements, and generate
                    <span className="text-accent"> SRS.md</span> &amp;
                    <span className="text-accent"> HLD.md</span>.
                  </p>
                  <button
                    onClick={() => sendToLLM('Start working. Introduce yourself and begin asking me about my project.', phase, { showUserMsg: false })}
                    disabled={isStreaming || !projectPath}
                    className="px-5 py-2.5 bg-accent text-surface rounded-xl text-sm font-semibold hover:bg-accent-hover transition-all duration-200 shadow-lg shadow-accent/20 hover:shadow-accent/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                  className="sticky bottom-2 left-full -ml-10 w-8 h-8 rounded-full bg-surface-elevated border border-border shadow-lg flex items-center justify-center text-gray-400 hover:text-accent hover:border-accent/50 transition-all z-10">
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
                  className="w-3 h-3 rounded accent-accent cursor-pointer"
                />
                <span className="text-[10px] text-gray-500">Auto-scroll</span>
              </label>
            )}

            {/* Generation Progress */}
            {(phase === PHASES.GENERATION || (phase === PHASES.DONE && tokenCount > 0)) && (
              <GenerationProgress
                isGenerating={phase === PHASES.GENERATION && isStreaming}
                tokenCount={tokenCount}
                estimatedTokens={estimatedGenerationTokens}
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

            {/* Force Analysis — shown in DISCOVERY after ≥2 assistant replies if user is stuck */}
            {phase === PHASES.DISCOVERY && !isStreaming && messages.filter(m => m.role === 'assistant' && m.content).length >= 2 && (
              <div className="mx-4 mb-1 flex justify-end">
                <button
                  onClick={handleForceAnalysis}
                  title="Skip remaining discovery questions and jump straight to analysis"
                  className="text-[10px] text-gray-600 hover:text-amber-400 transition-colors underline underline-offset-2"
                >
                  Skip to Analysis →
                </button>
              </div>
            )}

            {/* Approval Buttons */}
            {phase === PHASES.CONFIRM && !isStreaming && (
              <div className="mx-4 mb-2 p-3 bg-orange-500/5 border border-orange-500/20 rounded-xl">
                <p className="text-xs text-orange-300 mb-2 font-medium">Review the analysis. Approve?</p>
                <div className="flex gap-2">
                  <button onClick={handleApprove}
                    className="px-4 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors">
                    Approve &amp; Generate
                  </button>
                  <button onClick={handleRequestChanges}
                    className="px-4 py-1.5 bg-surface-elevated text-gray-400 border border-border rounded-lg text-xs font-medium hover:border-border-hover transition-colors">
                    Request Changes
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
                  disabled={isStreaming || phase === PHASES.GENERATION}
                  className="input-field resize-none min-h-[38px] max-h-[160px] py-2 text-sm disabled:opacity-50"
                  style={{ height: 'auto', overflow: 'hidden' }}
                  onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
                />
                {/* Stop button — only visible while streaming */}
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
                  disabled={!input.trim() || isStreaming || phase === PHASES.GENERATION}
                  className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                    input.trim() && !isStreaming ? 'bg-accent text-surface hover:bg-accent-hover' : 'bg-surface-elevated text-gray-600 cursor-not-allowed'
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
        )}

        {/* Document Panel */}
        {showDocs && (
          <div className={showChat ? 'w-1/2' : 'w-full'}>
            <DocumentPanel
              key={`docs-${docsVersion}`}
              projectPath={projectPath}
              onRequestChange={handleDocRequestChange}
              onNext={onNext}
            />
          </div>
        )}
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
        <span className="text-[10px] text-accent bg-accent/10 border border-accent/20 px-2.5 py-1 rounded-full font-medium">
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
          isUser ? 'bg-accent/15 text-gray-200 rounded-br-md' : 'bg-surface-elevated border border-border text-gray-300 rounded-bl-md'
        }`}>
          {!content && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
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
              prose-code:text-[11px] prose-code:bg-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-accent
              prose-pre:bg-surface prose-pre:rounded-lg prose-pre:p-2 prose-pre:my-2
              prose-a:text-accent prose-a:no-underline hover:prose-a:underline
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
            accentColor="accent"
          />
        )}
      </div>
    </div>
  );
}
