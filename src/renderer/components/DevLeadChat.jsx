import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createLLMProvider, getAgentSettings } from '../services/llmProviders';
import {
  DL_PHASES, DL_PHASE_LABELS,
  detectDLPhaseTransition, isDLApproval, parseDevLeadOutput,
  buildDLConversationMessages, IncrementalPlanBuilder, normalizeWorkplan,
} from '../services/devLeadAgent';
import api from '../services/electronBridge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import GenerationProgress from './GenerationProgress';
import TaskBoard from './TaskBoard';
import MultiQuestionReply, { parseQuestions, stripQuestionsBlock } from './QuickReply';
import ModelSelector from './ModelSelector';
import { notifyAgentComplete, notifyAgentError } from '../services/notificationService';

// ─── Phase colors ──────────────────────────────────────────────────────────────
const PHASE_COLORS = {
  [DL_PHASES.LOADING]: { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400' },
  [DL_PHASES.DISCOVERY]: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  [DL_PHASES.PLANNING]: { bg: 'bg-teal-500/15', text: 'text-teal-400', dot: 'bg-teal-400' },
  [DL_PHASES.CONFIRM]: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  [DL_PHASES.GENERATION]: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
  [DL_PHASES.DONE]: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
};

const PHASE_ORDER = [DL_PHASES.LOADING, DL_PHASES.DISCOVERY, DL_PHASES.PLANNING, DL_PHASES.CONFIRM, DL_PHASES.GENERATION, DL_PHASES.DONE];

const VIEW = { CHAT: 'chat', SPLIT: 'split', TASKS: 'tasks' };

export default function DevLeadChat({ projectPath, settings, onUpdateSettings, onBack, onNext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(DL_PHASES.LOADING);
  const [tokenCount, setTokenCount] = useState(0);
  const [contextDocs, setContextDocs] = useState(null);
  const [taskPlan, setTaskPlan] = useState(null);
  const [view, setView] = useState(VIEW.CHAT);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [needsResume, setNeedsResume] = useState(false);
  const [readyForNext, setReadyForNext] = useState(false);
  const agentSettings = React.useMemo(() => getAgentSettings(settings, 'dev_lead'), [settings]);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const docsPath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/docs' : null;
  const devLeadPath = docsPath ? docsPath + '/dev-lead' : null;
  const taskPlanPath = devLeadPath ? devLeadPath + '/workplan.json' : null;
  const chatHistoryPath = devLeadPath ? devLeadPath + '/chat-history.json' : null;

  // ─── Reset all state when projectPath changes (workspace switch) ──────
  const prevPathRef = useRef(projectPath);
  const pathStableRef = useRef(true); // false during workspace transition
  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== projectPath) {
      pathStableRef.current = false;
      setMessages([]);
      setInput('');
      setIsStreaming(false);
      setError(null);
      setPhase(DL_PHASES.LOADING);
      setTokenCount(0);
      setContextDocs(null);
      setTaskPlan(null);
      setView(VIEW.CHAT);
      setHistoryLoaded(false);
      setAutoScroll(true);
      setIsAtBottom(true);
      setNeedsResume(false);
      setReadyForNext(false);
      // Mark stable after React flushes the reset
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
            // Re-read actual file contents (saved contextDocs are booleans, not content)
            if (docsPath) {
              try {
                const [srs, hld] = await Promise.all([
                  api.readFile(docsPath + '/SRS.md'),
                  api.readFile(docsPath + '/HLD.md'),
                ]);
                // Load generated UI components
                let uiComponents = '';
                const uiDir = projectPath.replace(/[\\/]$/, '') + '/src/components/generated_ui';
                try {
                  const uiExists = await api.exists(uiDir);
                  if (uiExists) {
                    const entries = await api.readDir(uiDir);
                    const uiFiles = (entries || []).filter(e => !e.isDirectory && /\.(jsx|tsx|html|css|js)$/.test(e.name));
                    const contents = await Promise.all(uiFiles.map(f => api.readFile(f.path)));
                    uiComponents = uiFiles.map((f, i) => `// --- ${f.name} ---\n${contents[i] || ''}`).join('\n\n');
                  }
                } catch (e) { /* ignore */ }
                setContextDocs({ srs, hld, uiComponents });
              } catch (e) { /* docs may not exist yet */ }
            }
            // Load task plan if exists
            let hasPlan = false;
            if (taskPlanPath) {
              try {
                const planRaw = await api.readFile(taskPlanPath);
                if (planRaw && planRaw.trim().length > 2) {
                  setTaskPlan(normalizeWorkplan(JSON.parse(planRaw)));
                  hasPlan = true;
                  if (saved.phase === DL_PHASES.DONE) setView(VIEW.SPLIT);
                }
              } catch (e) { /* no plan yet */ }
            }
            // Resume: if chat progressed past DISCOVERY but no workplan exists, flag for auto-resume
            if (!hasPlan && saved.messages.some(m => m.role === 'assistant' && m.content)) {
              if ([DL_PHASES.DONE, DL_PHASES.GENERATION, DL_PHASES.CONFIRM, DL_PHASES.PLANNING].includes(saved.phase)) {
                setPhase(DL_PHASES.GENERATION);
                setNeedsResume(true);
              }
            }
            setHistoryLoaded(true);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to restore dev lead chat history:', e);
      }
      setHistoryLoaded(true);
    })();
  }, [chatHistoryPath, historyLoaded]);

  // ─── Auto-resume generation if workplan is missing ─────────────────────
  useEffect(() => {
    if (!needsResume || !contextDocs || isStreaming) return;
    setNeedsResume(false);
    addMessage('system', 'No work plan file found. Resuming generation from chat history...');
    setTimeout(() => triggerGeneration(), 800);
  }, [needsResume, contextDocs, isStreaming]);

  // ─── Persist chat history on every change ───────────────────────────
  useEffect(() => {
    if (!chatHistoryPath || !historyLoaded || messages.length === 0) return;
    if (!pathStableRef.current) return; // skip writes during workspace transition
    const timer = setTimeout(async () => {
      if (!pathStableRef.current) return;
      try {
        const data = JSON.stringify({ messages, phase, contextDocs: contextDocs ? { srs: !!contextDocs.srs, hld: !!contextDocs.hld, uiComponents: !!contextDocs.uiComponents } : null }, null, 2);
        await api.writeFile(chatHistoryPath, data);
      } catch (e) {
        console.warn('Failed to persist dev lead chat history:', e);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, phase, chatHistoryPath, historyLoaded]);

  // ─── Load context docs (SRS + HLD + UI) ────────────────────────────────
  useEffect(() => {
    if (!docsPath || historyLoaded === false) return;
    if (messages.length > 0) return; // already restored from history
    (async () => {
      try {
        const [srs, hld] = await Promise.all([
          api.readFile(docsPath + '/SRS.md'),
          api.readFile(docsPath + '/HLD.md'),
        ]);

        if (!srs && !hld) {
          setError('No SRS.md or HLD.md found. Complete the Architect phase first.');
          return;
        }

        // Load generated UI components
        let uiComponents = '';
        const uiDir = projectPath.replace(/[\\/]$/, '') + '/src/components/generated_ui';
        try {
          const uiExists = await api.exists(uiDir);
          if (uiExists) {
            const entries = await api.readDir(uiDir);
            const uiFiles = (entries || []).filter(e => !e.isDirectory && /\.(jsx|tsx|html|css|js)$/.test(e.name));
            const contents = await Promise.all(uiFiles.map(f => api.readFile(f.path)));
            uiComponents = uiFiles.map((f, i) => `// --- ${f.name} ---\n${contents[i] || ''}`).join('\n\n');
          }
        } catch (e) { /* ignore */ }

        setContextDocs({ srs, hld, uiComponents });

        // Check for existing work plan
        if (taskPlanPath) {
          try {
            const planRaw = await api.readFile(taskPlanPath);
            if (planRaw) {
              setTaskPlan(normalizeWorkplan(JSON.parse(planRaw)));
              setPhase(DL_PHASES.DONE);
              setView(VIEW.SPLIT);
              addMessage('system', 'Existing work plan found. You can review tasks, request changes, or approve.');
              return;
            }
          } catch (e) { /* no plan yet */ }
        }

        setPhase(DL_PHASES.DISCOVERY);
        const loadedItems = [];
        if (srs) loadedItems.push('SRS.md');
        if (hld) loadedItems.push('HLD.md');
        if (uiComponents) loadedItems.push('UI Mockup');
        addMessage('system', `Loaded: ${loadedItems.join(', ')}. Starting requirements review.`);
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

  // ─── Save task plan to file ─────────────────────────────────────────────
  const saveTaskPlan = useCallback(async (plan) => {
    if (!devLeadPath || !plan) return;
    try {
      const normalized = normalizeWorkplan(plan);
      setTaskPlan(normalized);
      await api.writeFile(taskPlanPath, JSON.stringify(normalized, null, 2));
    } catch (err) {
      console.error('Failed to save task plan:', err);
    }
  }, [devLeadPath, taskPlanPath]);

  // ─── Core LLM send ─────────────────────────────────────────────────────
  const sendToLLM = useCallback(async (userMessage, currentPhase, { showUserMsg = true } = {}) => {
    setError(null);
    if (showUserMsg) addMessage('user', userMessage);

    const allMessages = [...messagesRef.current];
    // Always include the user message in the LLM conversation, even if not shown in UI
    allMessages.push({ role: 'user', content: userMessage });
    const conversationMessages = buildDLConversationMessages(allMessages, currentPhase, contextDocs);

    setIsStreaming(true);
    if (currentPhase === DL_PHASES.GENERATION) setTokenCount(0);
    addMessage('assistant', '');

    try {
      const provider = createLLMProvider(agentSettings);
      let fullResponse = '';

      await provider.chat(conversationMessages, agentSettings, {
        onToken: (token) => {
          fullResponse += token;
          updateLastAssistant(fullResponse);
          if (currentPhase === DL_PHASES.GENERATION) {
            setTokenCount((c) => c + 1);
          }
        },
        onDone: async (finalText) => {
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);

          // Phase transitions
          const nextPhase = detectDLPhaseTransition(fullResponse, currentPhase);
          if (nextPhase) {
            setPhase(nextPhase);
            addMessage('system', `Phase: ${DL_PHASE_LABELS[currentPhase]} → ${DL_PHASE_LABELS[nextPhase]}`);

            // Auto-continue to next phase
            if (nextPhase === DL_PHASES.PLANNING) {
              setTimeout(() => sendToLLM('Continue to the planning phase. Build the detailed task plan based on everything we discussed.', nextPhase, { showUserMsg: false }), 800);
            } else if (nextPhase === DL_PHASES.CONFIRM) {
              // Wait for user approval
            }
          }

          // Extract and save task plan (try in any phase — LLM may output plan early)
          const output = parseDevLeadOutput(fullResponse);
          if (output.taskPlan) {
            await saveTaskPlan(output.taskPlan);
            if (currentPhase !== DL_PHASES.DONE) {
              setPhase(DL_PHASES.DONE);
              setView(VIEW.SPLIT);
              addMessage('system', `Work plan generated! ${output.taskPlan.summary?.totalTasks || '?'} tasks across ${output.taskPlan.phases?.length || '?'} phases. Review in the Task Board.`);
            } else {
              addMessage('system', 'Work plan updated.');
            }
          }
        },
        onError: (err) => {
          setError(err.message || 'An error occurred.');
          notifyAgentError('Dev Lead', err.message);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to connect to the LLM provider.');
      notifyAgentError('Dev Lead', err.message);
    } finally {
      setIsStreaming(false);
    }
  }, [projectPath, agentSettings, contextDocs, addMessage, updateLastAssistant, saveTaskPlan]);

  // ─── Auto-trigger generation ────────────────────────────────────────────
  const triggerGeneration = useCallback(async (initialUserMessage) => {
    const history = [...messagesRef.current];
    // If called with an initial user message (e.g. skipping discovery), inject it
    if (initialUserMessage) {
      history.push({ role: 'user', content: initialUserMessage });
    }
    const conversationMessages = buildDLConversationMessages(history, DL_PHASES.GENERATION, contextDocs);
    setIsStreaming(true);
    setTokenCount(0);
    addMessage('assistant', '');

    // Incremental builder: saves each phase/task to disk as it streams in
    const builder = new IncrementalPlanBuilder({
      onPhaseAdded: (phase) => {
        addMessage('system', `📋 Phase: ${phase.name}`);
      },
      onTaskAdded: (task, phase) => {
        setTokenCount((c) => c); // trigger re-render for progress
      },
      onPlanComplete: () => {
        // handled in onDone
      },
      onSave: async (plan) => {
        try {
          await saveTaskPlan(plan);
        } catch (e) { /* ignore intermediate save errors */ }
      },
    });

    try {
      const provider = createLLMProvider(agentSettings);
      let fullResponse = '';
      await provider.chat(conversationMessages, agentSettings, {
        onToken: (token) => {
          fullResponse += token;
          updateLastAssistant(fullResponse);
          setTokenCount((c) => c + 1);
          // Feed streaming text to incremental builder
          builder.update(fullResponse);
        },
        onDone: async (finalText) => {
          fullResponse = finalText || fullResponse;
          updateLastAssistant(fullResponse);
          // Final parse pass
          builder.update(fullResponse);

          if (builder.hasContent()) {
            // Incremental approach succeeded
            const plan = builder.buildPlan();
            await saveTaskPlan(plan);
            setPhase(DL_PHASES.DONE);
            setView(VIEW.SPLIT);
            const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
            if (builder.complete) {
              addMessage('system', `Work plan generated! ${totalTasks} tasks across ${plan.phases.length} phases. Review in the Task Board.`);
            } else {
              addMessage('system', `Work plan partially generated (output may have been truncated). Saved ${totalTasks} tasks across ${plan.phases.length} phases. You can ask the agent to continue adding more tasks.`);
            }
            notifyAgentComplete('Dev Lead');
          } else {
            // Fallback: try legacy single-JSON parser
            const output = parseDevLeadOutput(fullResponse);
            if (output.taskPlan) {
              await saveTaskPlan(output.taskPlan);
              setPhase(DL_PHASES.DONE);
              setView(VIEW.SPLIT);
              const totalTasks = output.taskPlan.phases?.reduce((sum, p) => sum + (p.tasks?.length || 0), 0) || '?';
              addMessage('system', `Work plan generated! ${totalTasks} tasks across ${output.taskPlan.phases?.length || '?'} phases. Review in the Task Board.`);
            } else {
              console.warn('Dev Lead: Could not parse task plan. Raw length:', fullResponse.length);
              if (devLeadPath) {
                try { await api.writeFile(devLeadPath + '/workplan-raw.md', fullResponse); } catch (e) { /* ignore */ }
              }
              addMessage('system', 'Work plan text generated but could not be parsed. The raw output has been saved. You can ask the agent to reformat it.');
            }
          }
        },
        onError: (err) => {
          setError(err.message || 'Error during generation.');
          notifyAgentError('Dev Lead', err.message);
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to generate work plan.');
      notifyAgentError('Dev Lead', err.message);
    } finally {
      setIsStreaming(false);
    }
  }, [agentSettings, contextDocs, addMessage, updateLastAssistant, saveTaskPlan]);

  // ─── Quick reply handler ────────────────────────────────────────────────
  const handleQuickReply = async (value) => {
    if (isStreaming) return;
    setInput('');
    await sendToLLM(value, phase);
  };

  // ─── Handle user send ──────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage = input.trim();
    setInput('');

    // Check for approval in CONFIRM phase
    if (phase === DL_PHASES.CONFIRM && isDLApproval(userMessage)) {
      addMessage('user', userMessage);
      setPhase(DL_PHASES.GENERATION);
      addMessage('system', `Phase: ${DL_PHASE_LABELS[DL_PHASES.CONFIRM]} → ${DL_PHASE_LABELS[DL_PHASES.GENERATION]}`);
      setTimeout(() => triggerGeneration(), 500);
      return;
    }

    await sendToLLM(userMessage, phase);
  };

  // ─── Task change request from TaskBoard ─────────────────────────────────
  const handleTaskChangeRequest = (task) => {
    setView(VIEW.SPLIT);
    setInput(`I'd like to change task ${task.id} ("${task.title}"): `);
    inputRef.current?.focus();
  };

  // ─── Reset agent ────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (isStreaming) return;
    if (!confirm('Reset the Dev Lead agent? This will delete the work plan and chat history.')) return;
    try {
      if (taskPlanPath) await api.writeFile(taskPlanPath, '').catch(() => {});
      if (chatHistoryPath) await api.writeFile(chatHistoryPath, '').catch(() => {});
    } catch (e) { /* ignore */ }
    setMessages([]);
    setPhase(DL_PHASES.DISCOVERY);
    setTokenCount(0);
    setTaskPlan(null);
    setView(VIEW.CHAT);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const getPlaceholder = () => {
    switch (phase) {
      case DL_PHASES.LOADING: return 'Loading context...';
      case DL_PHASES.DISCOVERY: return 'Answer questions about your project priorities...';
      case DL_PHASES.PLANNING: return 'Review the plan and provide feedback...';
      case DL_PHASES.CONFIRM: return 'Type "approve" to generate the work plan, or request changes...';
      case DL_PHASES.GENERATION: return 'Generating work plan...';
      case DL_PHASES.DONE: return 'Request changes to tasks or ask questions...';
      default: return 'Type a message...';
    }
  };

  const phaseColor = PHASE_COLORS[phase] || PHASE_COLORS[DL_PHASES.DISCOVERY];
  const showChat = view === VIEW.CHAT || view === VIEW.SPLIT;
  const showTasks = view === VIEW.TASKS || view === VIEW.SPLIT;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-card/50">
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button onClick={onBack} title="Back to UI Designer"
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-md hover:bg-surface-elevated transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-200 leading-tight">The Dev Lead</p>
            <p className="text-[10px] text-gray-500">Senior Team Lead &middot; 30+ years</p>
          </div>

          <div className="flex-1" />

          {/* View toggle */}
          {taskPlan && (
            <div className="flex gap-0.5 bg-surface rounded-lg p-0.5 border border-border">
              {[
                { id: VIEW.CHAT, label: 'Chat' },
                { id: VIEW.SPLIT, label: 'Split' },
                { id: VIEW.TASKS, label: 'Tasks' },
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${
                    view === v.id
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {/* Phase Badge */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${phaseColor.bg} ${phaseColor.text}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${phaseColor.dot} ${phase !== DL_PHASES.DONE ? 'animate-pulse' : ''}`} />
            {DL_PHASE_LABELS[phase]}
          </div>
          <ModelSelector
            settings={agentSettings}
            agentId="dev_lead"
            accentColor="emerald-400"
            onModelChange={(provider, model) => {
              const newSettings = {
                ...settings,
                agentModels: { ...settings.agentModels, dev_lead: { provider, model } },
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
                i < currentIdx ? 'bg-emerald-400' : i === currentIdx ? 'bg-emerald-400/50' : 'bg-border'
              }`} />
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Panel */}
        {showChat && (
          <div className={`flex flex-col ${showTasks ? 'w-1/2 border-r border-border' : 'w-full'}`}>
            {/* Messages */}
            <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative">
              {messages.length === 0 && phase === DL_PHASES.LOADING && (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-xs text-gray-500">Loading project documents...</p>
                </div>
              )}

              {!messages.some(m => m.role === 'user' || m.role === 'assistant') && phase !== DL_PHASES.LOADING && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-1">Dev Lead Ready</h3>
                  <p className="text-xs text-gray-500 max-w-sm mb-4">
                    I've reviewed all project documents. I'll build a detailed work plan with prioritized tasks.
                  </p>
                  <button
                    onClick={() => {
                      // Skip discovery — go straight to generation if we have all context
                      if (contextDocs && (contextDocs.srs || contextDocs.hld)) {
                        setPhase(DL_PHASES.GENERATION);
                        addMessage('system', 'All project documents loaded. Generating work plan...');
                        const kickoff = 'Generate the complete detailed work plan based on all the project documents (SRS, HLD, and UI mockup). Output it using the incremental format with plan-header, phase, task, and plan-complete blocks.';
                        setTimeout(() => triggerGeneration(kickoff), 500);
                      } else {
                        sendToLLM('Start working. Review the project documents and create a work plan.', phase, { showUserMsg: false });
                      }
                    }}
                    disabled={isStreaming}
                    className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                  className="sticky bottom-2 left-full -ml-10 w-8 h-8 rounded-full bg-surface-elevated border border-border shadow-lg flex items-center justify-center text-gray-400 hover:text-emerald-400 hover:border-emerald-400/50 transition-all z-10">
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
                  className="w-3 h-3 rounded accent-emerald-400 cursor-pointer"
                />
                <span className="text-[10px] text-gray-500">Auto-scroll</span>
              </label>
            )}

            {/* Streaming indicator (non-generation phases) */}
            {isStreaming && phase !== DL_PHASES.GENERATION && (
              <div className="mx-6 mb-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                  <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-emerald-300 font-medium">
                    {phase === DL_PHASES.DISCOVERY ? 'Analyzing project...' :
                     phase === DL_PHASES.PLANNING ? 'Building plan...' :
                     'Working...'}
                  </span>
                  <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden ml-2">
                    <div className="h-full bg-emerald-400/40 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Generation Progress */}
            {(phase === DL_PHASES.GENERATION || (phase === DL_PHASES.DONE && tokenCount > 0)) && (
              <GenerationProgress
                isGenerating={phase === DL_PHASES.GENERATION && isStreaming}
                tokenCount={tokenCount}
                estimatedTokens={12000}
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

            {/* Approval Buttons (CONFIRM phase) */}
            {phase === DL_PHASES.CONFIRM && !isStreaming && (
              <div className="mx-4 mb-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <p className="text-xs text-amber-300 mb-2 font-medium">Review the plan above. Approve to generate the detailed work plan?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      addMessage('user', 'Approved. Generate the detailed work plan.');
                      setPhase(DL_PHASES.GENERATION);
                      addMessage('system', `Phase: ${DL_PHASE_LABELS[DL_PHASES.CONFIRM]} → ${DL_PHASE_LABELS[DL_PHASES.GENERATION]}`);
                      setTimeout(() => triggerGeneration(), 500);
                    }}
                    className="px-4 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors"
                  >
                    Approve & Generate
                  </button>
                </div>
              </div>
            )}

            {/* Done: Next Phase */}
            {phase === DL_PHASES.DONE && !isStreaming && (
              <div className="mx-4 mb-2 p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                <p className="text-xs text-green-300 mb-2 font-medium">
                  Work plan ready! {taskPlan?.summary?.totalTasks || ''} tasks across {taskPlan?.phases?.length || ''} phases.
                </p>
                <div className="flex gap-2 flex-wrap">
                  {!showTasks && (
                    <button onClick={() => setView(VIEW.SPLIT)}
                      className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30 transition-colors">
                      View Task Board
                    </button>
                  )}
                  {onNext && !readyForNext && (
                    <button onClick={() => { setReadyForNext(true); addMessage('system', 'User approved — ready to proceed to code implementation.'); }}
                      className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30 transition-colors flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Approve & Proceed to Implementation
                    </button>
                  )}
                  {onNext && readyForNext && (
                    <button onClick={onNext}
                      className="px-4 py-1.5 bg-accent text-surface rounded-lg text-xs font-semibold hover:bg-accent-hover transition-colors flex items-center gap-1.5 animate-pulse">
                      Start Code Implementation
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                </div>
                {onNext && !readyForNext && (
                  <p className="text-[10px] text-gray-500 mt-2">
                    Review the task board and approve when ready. The next phase will assign tasks to coding agents.
                  </p>
                )}
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
                  disabled={isStreaming || phase === DL_PHASES.GENERATION || phase === DL_PHASES.LOADING}
                  className="input-field resize-none min-h-[38px] max-h-[160px] py-2 text-sm disabled:opacity-50"
                  style={{ height: 'auto', overflow: 'hidden' }}
                  onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming || phase === DL_PHASES.GENERATION || phase === DL_PHASES.LOADING}
                  className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                    input.trim() && !isStreaming ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-surface-elevated text-gray-600 cursor-not-allowed'
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

        {/* Task Board Panel */}
        {showTasks && (
          <div className={showChat ? 'w-1/2' : 'w-full'}>
            <TaskBoard
              taskPlan={taskPlan}
              onRequestChange={handleTaskChangeRequest}
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
        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
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
          isUser ? 'bg-emerald-500/15 text-gray-200 rounded-br-md' : 'bg-surface-elevated border border-border text-gray-300 rounded-bl-md'
        }`}>
          {!content && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
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
              prose-code:text-[11px] prose-code:bg-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-emerald-400
              prose-pre:bg-surface prose-pre:rounded-lg prose-pre:p-2 prose-pre:my-2
              prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
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
            accentColor="emerald"
          />
        )}
      </div>
    </div>
  );
}
