import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createLLMProvider, getAgentSettings } from '../services/llmProviders';
import {
  BF_PHASES, BUG_STATUS, BUG_SEVERITY,
  parseBugReports, stripBugReportBlocks, buildBugFixerMessages, buildCheckupMessage,
  executeBugFix, saveBugs, loadBugs, saveBugChatHistory, loadBugChatHistory,
  parseToolBlocks,
} from '../services/bugFixerAgent';
import { AGENT_DEFINITIONS } from '../services/codingAgents';
import api from '../services/electronBridge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ModelSelector from './ModelSelector';
import { notifyAgentComplete, notifyAgentError } from '../services/notificationService';

// ─── Severity colors ────────────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  [BUG_SEVERITY.CRITICAL]: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-400' },
  [BUG_SEVERITY.HIGH]: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  [BUG_SEVERITY.MEDIUM]: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  [BUG_SEVERITY.LOW]: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
};

const STATUS_LABELS = {
  [BUG_STATUS.OPEN]: { label: 'Open', color: 'text-gray-400', bg: 'bg-gray-500/15' },
  [BUG_STATUS.ANALYZING]: { label: 'Analyzing', color: 'text-amber-400', bg: 'bg-amber-500/15' },
  [BUG_STATUS.IN_PROGRESS]: { label: 'Fixing', color: 'text-accent', bg: 'bg-accent/15' },
  [BUG_STATUS.FIXED]: { label: 'Fixed', color: 'text-green-400', bg: 'bg-green-500/15' },
  [BUG_STATUS.FAILED]: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/15' },
};

const LOG_COLORS = {
  info: 'text-gray-400',
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  file: 'text-cyan-400',
  command: 'text-purple-400',
  bug: 'text-red-400',
  fix: 'text-accent',
};

// ─── Bug Card ───────────────────────────────────────────────────────────────────

function BugCard({ bug, isExpanded, onToggle, onFix }) {
  const sev = SEVERITY_COLORS[bug.severity] || SEVERITY_COLORS[BUG_SEVERITY.MEDIUM];
  const st = STATUS_LABELS[bug.status] || STATUS_LABELS[BUG_STATUS.OPEN];
  const agentDef = AGENT_DEFINITIONS[bug.assignedAgent];

  return (
    <div className={`rounded-lg border transition-all duration-300 ${sev.border} ${sev.bg}`}>
      <div
        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
        onClick={onToggle}
      >
        {/* Status icon */}
        {bug.status === BUG_STATUS.FIXED ? (
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : bug.status === BUG_STATUS.IN_PROGRESS ? (
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        ) : bug.status === BUG_STATUS.FAILED ? (
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <div className={`w-3 h-3 rounded-full shrink-0 ${sev.dot}`} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-gray-300 truncate">{bug.title}</span>
            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${sev.bg} ${sev.text}`}>
              {bug.severity}
            </span>
            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${st.bg} ${st.color}`}>
              {st.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {agentDef && (
              <span className="text-[9px] text-gray-500">
                {agentDef.emoji} {agentDef.name}
              </span>
            )}
            {bug.fixResult?.files?.length > 0 && (
              <span className="text-[9px] text-gray-500">📄 {bug.fixResult.files.length} files</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {bug.status === BUG_STATUS.OPEN && (
            <button
              onClick={(e) => { e.stopPropagation(); onFix(bug); }}
              className="px-2 py-1 text-[9px] font-semibold bg-accent/20 text-accent border border-accent/30 rounded-md hover:bg-accent/30 transition-colors"
            >
              Fix Now
            </button>
          )}
          <svg className={`w-3 h-3 text-gray-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-border/30 space-y-2">
          {bug.description && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Description</p>
              <p className="text-[10px] text-gray-400">{bug.description}</p>
            </div>
          )}
          {bug.rootCause && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Root Cause</p>
              <p className="text-[10px] text-gray-400">{bug.rootCause}</p>
            </div>
          )}
          {bug.affectedFiles?.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Affected Files</p>
              <div className="space-y-0.5">
                {bug.affectedFiles.map((f, i) => (
                  <p key={i} className="text-[9px] text-gray-400 font-mono">📄 {f}</p>
                ))}
              </div>
            </div>
          )}
          {bug.fixInstructions && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Fix Instructions</p>
              <p className="text-[10px] text-gray-400">{bug.fixInstructions}</p>
            </div>
          )}
          {bug.fixResult?.files?.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-green-400 uppercase tracking-wider mb-0.5">Files Modified</p>
              <div className="space-y-0.5">
                {bug.fixResult.files.map((f, i) => (
                  <p key={i} className="text-[9px] text-green-400 font-mono">✓ {f.path}</p>
                ))}
              </div>
            </div>
          )}
          {bug.fixResult?.commands?.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-purple-400 uppercase tracking-wider mb-0.5">Commands Run</p>
              <div className="space-y-0.5">
                {bug.fixResult.commands.map((c, i) => (
                  <p key={i} className={`text-[9px] font-mono ${c.result?.code === 0 ? 'text-purple-400' : 'text-red-400'}`}>
                    {c.result?.code === 0 ? '✓' : '✗'} {c.command}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

const VIEW = { CHAT: 'chat', BUGS: 'bugs' };

export default function BugFixerChat({ projectPath, settings, onUpdateSettings, onBack }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(BF_PHASES.LOADING);
  const [bugs, setBugs] = useState([]);
  const [expandedBug, setExpandedBug] = useState(null);
  const [fixingBugId, setFixingBugId] = useState(null);
  const [fixProgress, setFixProgress] = useState(0);
  const [view, setView] = useState(VIEW.CHAT);
  const [projectContext, setProjectContext] = useState(null);
  const [workplan, setWorkplan] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [logMessages, setLogMessages] = useState([]);

  const agentSettings = React.useMemo(() => getAgentSettings(settings, 'bug_fixer'), [settings]);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const logEndRef = useRef(null);
  const logContainerRef = useRef(null);
  const inputRef = useRef(null);

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
      setPhase(BF_PHASES.LOADING);
      setBugs([]);
      setExpandedBug(null);
      setFixingBugId(null);
      setFixProgress(0);
      setView(VIEW.CHAT);
      setProjectContext(null);
      setWorkplan(null);
      setHistoryLoaded(false);
      setIsAtBottom(true);
      setLogMessages([]);
      setTimeout(() => { pathStableRef.current = true; }, 100);
    }
    prevPathRef.current = projectPath;
  }, [projectPath]);

  // ─── Console auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logMessages]);

  // ─── Chat auto-scroll ─────────────────────────────────────────────────
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAtBottom]);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
  }, []);

  // ─── Log helper ────────────────────────────────────────────────────────
  const addLog = useCallback((msg, type = 'info') => {
    setLogMessages(prev => [...prev, { id: Date.now() + Math.random(), msg, type, time: new Date() }]);
  }, []);

  // ─── Subscribe to real-time shell output from all background commands ──
  useEffect(() => {
    const unsubscribe = api.onShellOutput((event) => {
      const ts = { id: Date.now() + Math.random(), time: new Date() };
      switch (event.type) {
        case 'start':
          setLogMessages(prev => [...prev, { ...ts, msg: `$ ${event.command}`, type: 'command' }]);
          break;
        case 'stdout': {
          const lines = (event.data || '').split('\n').filter(l => l.trim());
          if (lines.length > 0) {
            setLogMessages(prev => [
              ...prev,
              ...lines.map((line, i) => ({ id: ts.id + i, time: ts.time, msg: line, type: 'info' })),
            ]);
          }
          break;
        }
        case 'stderr': {
          const errLines = (event.data || '').split('\n').filter(l => l.trim());
          if (errLines.length > 0) {
            setLogMessages(prev => [
              ...prev,
              ...errLines.map((line, i) => ({ id: ts.id + i, time: ts.time, msg: line, type: 'warning' })),
            ]);
          }
          break;
        }
        case 'exit':
          setLogMessages(prev => [...prev, {
            ...ts,
            msg: `exit ${event.code}${event.killed ? ' (killed)' : ''}`,
            type: event.code === 0 ? 'success' : 'error',
          }]);
          break;
        case 'error':
          setLogMessages(prev => [...prev, { ...ts, msg: `ERROR: ${event.data}`, type: 'error' }]);
          break;
      }
    });
    return () => unsubscribe();
  }, []);

  // ─── Load context, bugs, and chat history on mount ─────────────────────
  useEffect(() => {
    if (!projectPath) return;
    (async () => {
      try {
        const docsPath = projectPath.replace(/[\\/]$/, '') + '/docs';

        // Load project context
        const [srs, hld, wpRaw] = await Promise.all([
          api.readFile(docsPath + '/SRS.md'),
          api.readFile(docsPath + '/HLD.md'),
          api.readFile(docsPath + '/dev-lead/workplan.json'),
        ]);
        setProjectContext({
          projectName: '',
          srs: srs || '',
          hld: hld || '',
        });

        // Parse workplan
        if (wpRaw) {
          try {
            setWorkplan(JSON.parse(wpRaw));
            addLog('Workplan loaded', 'success');
          } catch { addLog('Failed to parse workplan', 'warning'); }
        }

        // Load saved bugs
        const savedBugs = await loadBugs(projectPath);
        if (savedBugs.length > 0) {
          setBugs(savedBugs);
          addLog(`Loaded ${savedBugs.length} saved bug(s)`, 'info');
        }

        // Load chat history
        const savedHistory = await loadBugChatHistory(projectPath);
        if (savedHistory.length > 0) {
          setMessages(savedHistory);
        }

        setHistoryLoaded(true);
        setPhase(BF_PHASES.READY);
        addLog('Bug Fixer ready', 'success');
      } catch (err) {
        setError('Failed to load project context: ' + err.message);
        addLog('Failed to load context: ' + err.message, 'error');
        setPhase(BF_PHASES.READY);
      }
    })();
  }, [projectPath, addLog]);

  // ─── Save chat history when messages change ────────────────────────────
  useEffect(() => {
    if (historyLoaded && messages.length > 0 && pathStableRef.current) {
      saveBugChatHistory(projectPath, messages);
    }
  }, [messages, historyLoaded, projectPath]);

  // ─── Execute tool blocks (read-directory, read-file) from LLM output ──
  const executeToolBlocks = useCallback(async (output) => {
    const tools = parseToolBlocks(output);
    if (tools.length === 0) return null;

    const results = [];
    for (const tool of tools) {
      try {
        if (tool.type === 'read-directory') {
          const targetPath = tool.path === '.' ? projectPath : projectPath.replace(/[\\/]$/, '') + '/' + tool.path;
          addLog(`📂 Scanning directory: ${tool.path} (depth: ${tool.maxDepth || 4})`, 'info');
          const entries = await api.readDirRecursive(targetPath, tool.maxDepth || 4);
          const tree = entries.map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`).join('\n');
          results.push(`## Directory Listing: ${tool.path}\n\`\`\`\n${tree || '(empty)'}\n\`\`\``);
          addLog(`  Found ${entries.length} entries`, 'success');
        } else if (tool.type === 'read-file') {
          const filePath = projectPath.replace(/[\\/]$/, '') + '/' + tool.path;
          addLog(`📄 Reading file: ${tool.path}`, 'info');
          const content = await api.readFile(filePath);
          if (content !== null) {
            // Limit to 3000 chars to avoid context overflow
            const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n... (truncated)' : content;
            results.push(`## File: ${tool.path}\n\`\`\`\n${truncated}\n\`\`\``);
            addLog(`  Read ${content.length} chars`, 'success');
          } else {
            results.push(`## File: ${tool.path}\n**File not found on disk.**`);
            addLog(`  File not found: ${tool.path}`, 'warning');
          }
        }
      } catch (e) {
        results.push(`## Tool Error (${tool.type}): ${e.message}`);
        addLog(`Tool error: ${e.message}`, 'error');
      }
    }
    return results.join('\n\n');
  }, [projectPath, addLog]);

  // ─── Core: send a message (user or auto-generated) to the LLM ─────────
  const sendMessageCore = useCallback(async (userContent, isCheckup = false) => {
    if (isStreaming || !projectContext) return;

    const userMsg = { role: 'user', content: userContent };
    let conversationMessages = [...messages, userMsg];
    setMessages(conversationMessages);
    setInput('');
    setIsStreaming(true);
    setError(null);
    setPhase(BF_PHASES.ANALYZING);
    addLog(isCheckup ? 'Starting automatic checkup...' : 'Analyzing bug report...', 'info');

    const MAX_TOOL_ROUNDS = 3;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const llmMessages = buildBugFixerMessages(conversationMessages, projectContext);
        const provider = createLLMProvider(agentSettings);

        let fullResponse = '';

        await new Promise((resolve, reject) => {
          provider.chat(llmMessages, agentSettings, {
            agentId: 'bug_fixer',
            onToken: (token) => {
              fullResponse += token;
              setMessages([...conversationMessages, { role: 'assistant', content: fullResponse }]);
            },
            onDone: (finalText) => {
              fullResponse = finalText || fullResponse;
              resolve(fullResponse);
            },
            onError: (err) => reject(err),
          });
        });

        // Check for tool blocks that need execution
        const toolResults = await executeToolBlocks(fullResponse);

        // Update conversation with assistant response
        conversationMessages = [...conversationMessages, { role: 'assistant', content: fullResponse }];

        if (toolResults && round < MAX_TOOL_ROUNDS) {
          // Inject tool results as a system-like user message and loop
          addLog('Feeding tool results back to Bug Fixer...', 'info');
          const toolMsg = { role: 'user', content: `Here are the results of your tool requests:\n\n${toolResults}\n\nNow continue your analysis with this information. Remember to perform a Root Cause Analysis before creating any bug reports.` };
          conversationMessages = [...conversationMessages, toolMsg];
          setMessages(conversationMessages);
          continue;
        }

        // No more tools needed — finalize
        // Parse bug reports from the response
        const newBugs = parseBugReports(fullResponse);
        if (newBugs.length > 0) {
          const updatedBugs = [...bugs, ...newBugs];
          setBugs(updatedBugs);
          await saveBugs(projectPath, updatedBugs);
          addLog(`Found ${newBugs.length} bug(s)`, 'bug');
          newBugs.forEach(b => addLog(`  🐛 ${b.title} [${b.severity}] → ${AGENT_DEFINITIONS[b.assignedAgent]?.name || b.assignedAgent}`, 'bug'));
        } else {
          addLog('No bugs found in response', 'success');
        }

        break; // Done
      }

      // Store final messages
      setMessages(conversationMessages);
      setPhase(BF_PHASES.READY);
      addLog('Analysis complete', 'success');
    } catch (err) {
      setError(err.message || 'Failed to analyze bug');
      addLog('Error: ' + (err.message || 'Unknown'), 'error');
      notifyAgentError('Bug Fixer', err.message);
      setPhase(BF_PHASES.READY);
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, messages, projectContext, agentSettings, bugs, projectPath, addLog, executeToolBlocks]);

  // ─── Send user message ─────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim()) return;
    await sendMessageCore(input.trim());
  }, [input, sendMessageCore]);

  // ─── Start Checkup ────────────────────────────────────────────────────
  const startCheckup = useCallback(async () => {
    if (isStreaming || !projectContext) return;

    addLog('Gathering project files for checkup...', 'info');

    // Gather list of generated files
    let fileList = [];
    try {
      const srcPath = projectPath.replace(/[\\/]$/, '') + '/src';
      const srcExists = await api.exists(srcPath);
      if (srcExists) {
        const entries = await api.readDir(srcPath);
        fileList = (entries || []).filter(e => !e.isDirectory).map(e => 'src/' + e.name);
        addLog(`Found ${fileList.length} files in src/`, 'info');
      }
    } catch (e) {
      addLog('Could not read src/ directory: ' + e.message, 'warning');
    }

    const checkupMsg = buildCheckupMessage(projectContext, workplan, fileList);
    await sendMessageCore(checkupMsg, true);
  }, [isStreaming, projectContext, projectPath, workplan, sendMessageCore, addLog]);

  // ─── Fix a bug ────────────────────────────────────────────────────────
  const fixBug = useCallback(async (bug) => {
    if (fixingBugId || !projectContext) return;

    setFixingBugId(bug.id);
    setFixProgress(0);
    setPhase(BF_PHASES.FIXING);
    addLog(`Fixing: ${bug.title}...`, 'fix');

    // Update bug status
    const updatedBugs = bugs.map(b =>
      b.id === bug.id ? { ...b, status: BUG_STATUS.IN_PROGRESS } : b
    );
    setBugs(updatedBugs);
    await saveBugs(projectPath, updatedBugs);

    try {
      await executeBugFix(bug, projectContext, settings, projectPath, {
        onProgress: (pct) => setFixProgress(pct),
        onComplete: (data) => {
          const fixed = updatedBugs.map(b =>
            b.id === bug.id ? {
              ...b,
              status: BUG_STATUS.FIXED,
              fixResult: { files: data.files || [], commands: data.commands || [] },
              fixedAt: new Date().toISOString(),
            } : b
          );
          setBugs(fixed);
          saveBugs(projectPath, fixed);

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ **Bug Fixed: ${bug.title}**\n\n${data.files?.length || 0} files modified, ${data.commands?.length || 0} commands executed.\n\nThe fix has been applied and written to disk.`,
          }]);

          addLog(`✅ Fixed: ${bug.title}`, 'success');
          (data.files || []).forEach(f => addLog(`  📄 ${f.path}`, 'file'));
          (data.commands || []).forEach(c => addLog(`  ⚡ [exit ${c.result?.code ?? '?'}] ${c.command}`, 'command'));

          notifyAgentComplete('Bug Fixer');
        },
        onError: (err) => {
          const failed = updatedBugs.map(b =>
            b.id === bug.id ? { ...b, status: BUG_STATUS.FAILED, error: err.message } : b
          );
          setBugs(failed);
          saveBugs(projectPath, failed);

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `❌ **Fix Failed: ${bug.title}**\n\n${err.message}\n\nYou can try describing the issue in more detail and I'll create a new fix task.`,
          }]);

          addLog(`❌ Fix failed: ${bug.title} — ${err.message}`, 'error');
          notifyAgentError('Bug Fixer', err.message);
        },
        onFileWritten: (file) => {
          addLog(`📄 Written: ${file.path}`, 'file');
          setBugs(prev => prev.map(b => {
            if (b.id !== bug.id) return b;
            const files = [...(b.fixResult?.files || []), file];
            return { ...b, fixResult: { ...b.fixResult, files } };
          }));
        },
        onCommandExecuted: (cmd, res) => {
          addLog(`⚡ ${cmd.command} → exit ${res.code}`, res.code === 0 ? 'command' : 'error');
          setBugs(prev => prev.map(b => {
            if (b.id !== bug.id) return b;
            const commands = [...(b.fixResult?.commands || []), { ...cmd, result: res }];
            return { ...b, fixResult: { ...b.fixResult, commands } };
          }));
        },
      });
    } catch (err) {
      setError(err.message);
      addLog('Error: ' + err.message, 'error');
    } finally {
      setFixingBugId(null);
      setFixProgress(0);
      setPhase(BF_PHASES.READY);
    }
  }, [fixingBugId, projectContext, settings, projectPath, bugs, addLog]);

  // ─── Reset ────────────────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    if (isStreaming || fixingBugId) return;
    if (!window.confirm('Reset all bug reports and chat history?')) return;
    setMessages([]);
    setBugs([]);
    setError(null);
    setLogMessages([]);
    setPhase(BF_PHASES.READY);
    await saveBugChatHistory(projectPath, []);
    await saveBugs(projectPath, []);
  }, [isStreaming, fixingBugId, projectPath]);

  // ─── Key handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Stats ────────────────────────────────────────────────────────────
  const bugStats = {
    total: bugs.length,
    open: bugs.filter(b => b.status === BUG_STATUS.OPEN).length,
    fixing: bugs.filter(b => b.status === BUG_STATUS.IN_PROGRESS).length,
    fixed: bugs.filter(b => b.status === BUG_STATUS.FIXED).length,
    failed: bugs.filter(b => b.status === BUG_STATUS.FAILED).length,
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-card/50">
        <div className="flex items-center gap-3">
          <button onClick={onBack} title="Back to Coding"
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-md hover:bg-surface-elevated transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-200 leading-tight">Bug Fixer</p>
            <p className="text-[10px] text-gray-500">
              {bugStats.total > 0
                ? `${bugStats.total} bug${bugStats.total > 1 ? 's' : ''} · ${bugStats.fixed} fixed · ${bugStats.open} open`
                : 'Describe bugs and I\'ll fix them'
              }
            </p>
          </div>

          <div className="flex-1" />

          {/* Start Checkup button */}
          <button
            onClick={startCheckup}
            disabled={isStreaming || fixingBugId || !projectContext}
            title="Automatically check the build against the workplan"
            className="px-3 py-1.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start Checkup
          </button>

          {/* View toggle */}
          <div className="flex bg-surface rounded-lg p-0.5 border border-border/50">
            <button
              onClick={() => setView(VIEW.CHAT)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                view === VIEW.CHAT ? 'bg-red-500/15 text-red-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setView(VIEW.BUGS)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors flex items-center gap-1 ${
                view === VIEW.BUGS ? 'bg-red-500/15 text-red-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Bugs
              {bugStats.total > 0 && (
                <span className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 text-[8px] font-bold flex items-center justify-center">
                  {bugStats.total}
                </span>
              )}
            </button>
          </div>

          <ModelSelector
            settings={agentSettings}
            agentId="bug_fixer"
            accentColor="red"
            onModelChange={(provider, model) => {
              const newSettings = {
                ...settings,
                agentModels: { ...settings.agentModels, bug_fixer: { provider, model } },
              };
              onUpdateSettings(newSettings);
            }}
          />

          {/* Reset button */}
          <button
            onClick={handleReset}
            disabled={isStreaming || fixingBugId || (messages.length === 0 && bugs.length === 0)}
            title="Reset bug fixer"
            className="p-1.5 text-gray-500 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Fix progress bar */}
      {fixingBugId && (
        <div className="shrink-0 px-4 py-1.5 bg-accent/5 border-b border-accent/20">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-accent font-medium">Fixing bug...</span>
            <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${fixProgress}%` }} />
            </div>
            <span className="text-[9px] text-gray-500">{fixProgress}%</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main content — split layout: left=console, right=chat/bugs */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Console panel */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col bg-surface/50">
          <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Console</span>
            <div className="flex-1" />
            <span className="text-[9px] text-gray-600">{logMessages.length} entries</span>
          </div>
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 font-mono"
          >
            {logMessages.length === 0 && (
              <p className="text-[9px] text-gray-600 italic">Waiting for activity...</p>
            )}
            {logMessages.map((log) => (
              <div key={log.id} className="flex gap-1.5 items-start">
                <span className="text-[8px] text-gray-700 shrink-0 mt-px">
                  {log.time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`text-[9px] leading-tight ${LOG_COLORS[log.type] || LOG_COLORS.info}`}>
                  {log.msg}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Right: Chat or Bugs view */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Chat view */}
          {view === VIEW.CHAT && (
            <>
              <div
                ref={chatContainerRef}
                onScroll={handleChatScroll}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3 relative"
              >
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mb-3">
                      <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-1">Bug Fixer Agent</h3>
                    <p className="text-xs text-gray-500 max-w-sm">
                      Describe any bugs or issues you found in the generated code. I'll analyze them,
                      create bug tickets, and assign them to the right specialist agent for fixing.
                    </p>
                    <p className="text-xs text-amber-400 mt-3 max-w-sm">
                      Or click <strong>Start Checkup</strong> to automatically verify the build against the workplan.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 max-w-sm">
                      {[
                        'The Start button doesn\'t respond to clicks',
                        'Keyboard controls are not working',
                        'The app crashes on startup',
                        'Styles are broken on mobile',
                      ].map((example, i) => (
                        <button
                          key={i}
                          onClick={() => setInput(example)}
                          className="px-3 py-2 text-[10px] text-gray-400 bg-surface-card/50 border border-border/50 rounded-lg hover:bg-surface-elevated hover:text-gray-300 transition-colors text-left"
                        >
                          "{example}"
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-red-500/15 border border-red-500/20 text-gray-200'
                        : 'bg-surface-card border border-border text-gray-300'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-invert prose-xs max-w-none text-[12px] leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {stripBugReportBlocks(msg.content)}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isStreaming && (
                  <div className="flex items-center gap-2 text-[10px] text-red-400">
                    <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    Analyzing...
                  </div>
                )}

                <div ref={messagesEndRef} />

                {/* Scroll-to-bottom button */}
                {!isAtBottom && (
                  <button onClick={scrollToBottom} title="Scroll to bottom"
                    className="sticky bottom-2 left-full -ml-10 w-8 h-8 rounded-full bg-surface-elevated border border-border shadow-lg flex items-center justify-center text-gray-400 hover:text-red-400 hover:border-red-400/50 transition-all z-10">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 px-4 py-3 border-t border-border bg-surface-card/30">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe the bug or issue..."
                    rows={2}
                    className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || isStreaming}
                    className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed self-end"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Bugs view */}
          {view === VIEW.BUGS && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* Stats bar */}
              {bugStats.total > 0 && (
                <div className="flex items-center gap-3 px-3 py-2 bg-surface-card/50 rounded-lg border border-border/50">
                  <span className="text-[10px] text-gray-500">
                    <span className="font-bold text-gray-300">{bugStats.total}</span> total
                  </span>
                  {bugStats.open > 0 && (
                    <span className="text-[10px] text-gray-400">
                      <span className="font-bold">{bugStats.open}</span> open
                    </span>
                  )}
                  {bugStats.fixing > 0 && (
                    <span className="text-[10px] text-accent">
                      <span className="font-bold">{bugStats.fixing}</span> fixing
                    </span>
                  )}
                  {bugStats.fixed > 0 && (
                    <span className="text-[10px] text-green-400">
                      <span className="font-bold">{bugStats.fixed}</span> fixed
                    </span>
                  )}
                  {bugStats.failed > 0 && (
                    <span className="text-[10px] text-red-400">
                      <span className="font-bold">{bugStats.failed}</span> failed
                    </span>
                  )}
                </div>
              )}

              {/* Bug list */}
              {bugs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-1">No Bugs Yet</h3>
                  <p className="text-xs text-gray-500">Switch to the Chat tab and describe any issues you found, or click Start Checkup.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {bugs.map(bug => (
                    <BugCard
                      key={bug.id}
                      bug={bug}
                      isExpanded={expandedBug === bug.id}
                      onToggle={() => setExpandedBug(expandedBug === bug.id ? null : bug.id)}
                      onFix={fixBug}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
