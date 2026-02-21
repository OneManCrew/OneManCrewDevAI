import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createLLMProvider, getAgentSettings } from '../services/llmProviders';
import {
  AGENT_TYPES, AGENT_DEFINITIONS,
  buildExecutionPlan, buildParallelBatches,
  extractFilesFromOutput, executeTask,
  CodingOrchestrator,
} from '../services/codingAgents';
import api from '../services/electronBridge';
import ModelSelector from './ModelSelector';
import { notifyAgentNeedsInput, notifyAgentComplete, notifyAgentError } from '../services/notificationService';

// ─── Agent color map ────────────────────────────────────────────────────────────

const AGENT_COLORS = {
  [AGENT_TYPES.BACKEND]:     { bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/30',   bar: 'bg-blue-500',   dot: 'bg-blue-400' },
  [AGENT_TYPES.FRONTEND]:    { bg: 'bg-pink-500/15',   text: 'text-pink-400',   border: 'border-pink-500/30',   bar: 'bg-pink-500',   dot: 'bg-pink-400' },
  [AGENT_TYPES.DEVOPS]:      { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', bar: 'bg-orange-500', dot: 'bg-orange-400' },
  [AGENT_TYPES.TESTING]:     { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/30',  bar: 'bg-green-500',  dot: 'bg-green-400' },
  [AGENT_TYPES.INTEGRATION]: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', bar: 'bg-purple-500', dot: 'bg-purple-400' },
  [AGENT_TYPES.SETUP]:       { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   border: 'border-cyan-500/30',   bar: 'bg-cyan-500',   dot: 'bg-cyan-400' },
};

// ─── Status icons ───────────────────────────────────────────────────────────────

function StatusIcon({ status }) {
  if (status === 'done') return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
  if (status === 'error') return (
    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
  if (status === 'running') return (
    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
  );
  if (status === 'waiting') return (
    <svg className="w-4 h-4 text-amber-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
    </svg>
  );
  return <div className="w-4 h-4 rounded-full border-2 border-gray-600" />;
}

// ─── Task Row ───────────────────────────────────────────────────────────────────

function TaskRow({ task }) {
  const [expanded, setExpanded] = useState(false);
  const agentDef = AGENT_DEFINITIONS[task.assignedAgent];
  const colors = AGENT_COLORS[task.assignedAgent] || AGENT_COLORS[AGENT_TYPES.BACKEND];
  const hasDetails = (task.files?.length > 0) || (task.commands?.length > 0) || task.error;

  return (
    <div className={`rounded-lg border transition-all duration-500 ${
      task.status === 'running' ? `${colors.bg} ${colors.border} shadow-sm` :
      task.status === 'waiting' ? 'bg-amber-500/10 border-amber-500/30 shadow-sm' :
      task.status === 'done' ? 'bg-green-500/5 border-green-500/20' :
      task.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
      'bg-surface-card/30 border-border/50'
    }`}>
      {/* Header — always visible, clickable */}
      <div
        className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none"
        onClick={() => hasDetails && setExpanded(prev => !prev)}
      >
        <StatusIcon status={task.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-gray-300 truncate">{task.title}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${colors.bg} ${colors.text}`}>
              {agentDef?.emoji} {agentDef?.name?.split(' ')[0]}
            </span>
          </div>
          {task.status === 'running' && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <span className="text-[9px] text-gray-500 w-8 text-right">{task.progress}%</span>
            </div>
          )}
          {task.status === 'waiting' && (
            <p className="text-[9px] text-amber-400 mt-0.5 animate-pulse">Waiting for your input...</p>
          )}
          {task.status === 'error' && !expanded && (
            <p className="text-[9px] text-red-400 mt-0.5 truncate">{task.error}</p>
          )}
          {/* Summary badges when collapsed */}
          {!expanded && (task.status === 'running' || task.status === 'done' || task.status === 'error') && (
            <div className="mt-1 flex items-center gap-2">
              {task.files?.length > 0 && (
                <span className="text-[9px] text-gray-500">📄 {task.files.length} file{task.files.length > 1 ? 's' : ''}</span>
              )}
              {task.commands?.length > 0 && (
                <span className="text-[9px] text-gray-500">⚡ {task.commands.length} cmd{task.commands.length > 1 ? 's' : ''}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-gray-600">{task.id}</span>
          {hasDetails && (
            <svg className={`w-3 h-3 text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-border/30 space-y-2">
          {/* Files list */}
          {task.files && task.files.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Files ({task.files.length})
              </p>
              <div className="space-y-0.5">
                {task.files.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className={`text-[9px] ${task.status === 'done' ? 'text-green-400' : colors.text}`}>📄</span>
                    <span className="text-[9px] text-gray-400 font-mono truncate">{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commands list */}
          {task.commands && task.commands.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Commands ({task.commands.length})
              </p>
              <div className="space-y-1">
                {task.commands.map((c, i) => (
                  <div key={`cmd-${i}`} className="flex items-start gap-1.5">
                    <span className={`text-[9px] mt-px ${c.result?.code === 0 ? 'text-purple-400' : 'text-red-400'}`}>
                      {c.result?.code === 0 ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0">
                      <span className="text-[9px] text-gray-400 font-mono break-all">{c.command}</span>
                      {c.description && c.description !== c.command && (
                        <span className="text-[9px] text-gray-600 ml-1">— {c.description}</span>
                      )}
                      {c.result?.code !== 0 && c.result?.code != null && (
                        <span className="text-[9px] text-red-400 ml-1">(exit {c.result.code})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error details */}
          {task.error && (
            <div>
              <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wider mb-1">Error</p>
              <p className="text-[9px] text-red-400/80 font-mono break-all">{task.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agent Summary Card ─────────────────────────────────────────────────────────

function AgentCard({ agentType, tasks }) {
  const def = AGENT_DEFINITIONS[agentType];
  const colors = AGENT_COLORS[agentType];
  if (!def || !colors) return null;

  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const errors = tasks.filter(t => t.status === 'error').length;
  const isActive = running > 0;

  return (
    <div className={`rounded-xl border p-3 transition-all duration-500 ${
      isActive ? `${colors.bg} ${colors.border} shadow-lg shadow-${def.color}-500/5` : 'bg-surface-card/50 border-border/50'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{def.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${isActive ? colors.text : 'text-gray-400'}`}>{def.name}</p>
          <p className="text-[9px] text-gray-500">{def.shortDesc}</p>
        </div>
        {isActive && (
          <div className={`w-2 h-2 rounded-full ${colors.dot} animate-pulse`} />
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
            style={{ width: total > 0 ? `${((done + errors) / total) * 100}%` : '0%' }}
          />
        </div>
        <span className="text-[9px] text-gray-500">{done}/{total}</span>
      </div>

      {errors > 0 && (
        <p className="text-[9px] text-red-400 mt-1">{errors} failed</p>
      )}
    </div>
  );
}

// ─── Overall Progress Bar ───────────────────────────────────────────────────────

function OverallProgress({ tasks }) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const errors = tasks.filter(t => t.status === 'error').length;
  const pending = total - done - running - errors;
  const percent = total > 0 ? Math.round(((done + errors) / total) * 100) : 0;

  return (
    <div className="px-4 py-3 border-b border-border bg-surface-card/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-300">Overall Progress</span>
          {running > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-accent/15 text-accent rounded-full animate-pulse">
              {running} agent{running > 1 ? 's' : ''} working
            </span>
          )}
        </div>
        <span className="text-xs font-bold text-accent">{percent}%</span>
      </div>

      <div className="h-2.5 bg-surface rounded-full overflow-hidden flex">
        {done > 0 && (
          <div
            className="h-full bg-green-500 transition-all duration-700 ease-out"
            style={{ width: `${(done / total) * 100}%` }}
          />
        )}
        {running > 0 && (
          <div
            className="h-full bg-accent/70 transition-all duration-700 ease-out animate-pulse"
            style={{ width: `${(running / total) * 100}%` }}
          />
        )}
        {errors > 0 && (
          <div
            className="h-full bg-red-500 transition-all duration-700 ease-out"
            style={{ width: `${(errors / total) * 100}%` }}
          />
        )}
      </div>

      <div className="flex gap-4 mt-2">
        <span className="text-[9px] text-gray-500">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 align-middle" />
          Done: {done}
        </span>
        <span className="text-[9px] text-gray-500">
          <span className="inline-block w-2 h-2 rounded-full bg-accent/70 mr-1 align-middle" />
          Running: {running}
        </span>
        <span className="text-[9px] text-gray-500">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-600 mr-1 align-middle" />
          Pending: {pending}
        </span>
        {errors > 0 && (
          <span className="text-[9px] text-red-400">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" />
            Errors: {errors}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Completion Screen ──────────────────────────────────────────────────────────

function CompletionScreen({ tasks, files, projectPath, onNext }) {
  const done = tasks.filter(t => t.status === 'done').length;
  const errors = tasks.filter(t => t.status === 'error').length;
  const allGood = errors === 0;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
        allGood ? 'bg-green-500/15' : 'bg-amber-500/15'
      }`}>
        {allGood ? (
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        )}
      </div>

      <h2 className={`text-lg font-bold mb-2 ${allGood ? 'text-green-400' : 'text-amber-400'}`}>
        {allGood ? 'Implementation Complete!' : 'Implementation Finished with Errors'}
      </h2>

      <p className="text-xs text-gray-400 mb-4 max-w-md">
        {allGood
          ? `All ${done} tasks completed successfully. ${files.length} files generated and saved to your project folder.`
          : `${done} tasks completed, ${errors} failed. ${files.length} files generated. Check errors and retry failed tasks.`
        }
      </p>

      <div className="flex flex-wrap gap-2 justify-center mb-6 max-w-lg">
        {files.slice(0, 20).map((f, i) => (
          <span key={i} className="text-[9px] px-2 py-1 bg-surface-elevated border border-border rounded-lg text-gray-400">
            {f.path}
          </span>
        ))}
        {files.length > 20 && (
          <span className="text-[9px] px-2 py-1 text-gray-500">+{files.length - 20} more</span>
        )}
      </div>

      {projectPath && (
        <p className="text-[10px] text-gray-500 mb-4">
          Files saved to: <span className="text-accent">{projectPath}/src</span>
        </p>
      )}

      {onNext && (
        <button
          onClick={onNext}
          className="mt-2 px-5 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition-all flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Next: Bug Fixer
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Main CodingPhase Component ─────────────────────────────────────────────────

export default function CodingPhase({ projectPath, settings, onUpdateSettings, onBack, onNext, onAgentChat }) {
  const [tasks, setTasks] = useState([]);
  const [batches, setBatches] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [allFiles, setAllFiles] = useState([]);
  const [error, setError] = useState(null);
  const [workplan, setWorkplan] = useState(null);
  const [projectContext, setProjectContext] = useState(null);
  const [logMessages, setLogMessages] = useState([]);
  const orchestratorRef = useRef(null);
  const logEndRef = useRef(null);

  const agentSettings = React.useMemo(() => getAgentSettings(settings, 'coding'), [settings]);

  // ─── Reset all state when projectPath changes (workspace switch) ──────
  const prevPathRef = useRef(projectPath);
  useEffect(() => {
    if (prevPathRef.current && prevPathRef.current !== projectPath) {
      setTasks([]);
      setBatches([]);
      setIsRunning(false);
      setIsComplete(false);
      setAllFiles([]);
      setError(null);
      setWorkplan(null);
      setProjectContext(null);
      setLogMessages([]);
      if (orchestratorRef.current) {
        orchestratorRef.current.cancel?.();
        orchestratorRef.current = null;
      }
    }
    prevPathRef.current = projectPath;
  }, [projectPath]);

  // ─── Status persistence ─────────────────────────────────────────────────
  const statusFilePath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/coding-status.json' : '';

  const saveTaskStatus = useCallback((taskList) => {
    if (!statusFilePath) return;
    try {
      const logsDir = 'docs/dev-lead/task-logs/';
      const data = taskList.map(t => ({
        id: t.id,
        status: t.status || 'pending',
        progress: t.status === 'done' ? 100 : 0,
        error: t.error || null,
        logFile: logsDir + (t.id || '').replace(/[^a-zA-Z0-9._-]/g, '_') + '.log',
        files: (t.files || []).map(f => ({ path: f.path })),
        commands: (t.commands || []).map(c => ({ command: c.command, description: c.description, code: c.result?.code })),
      }));
      api.writeFile(statusFilePath, JSON.stringify({ updatedAt: new Date().toISOString(), tasks: data }, null, 2));
    } catch (e) {
      console.warn('[CodingPhase] Failed to save task status:', e);
    }
  }, [statusFilePath]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logMessages]);

  const addLog = useCallback((msg, type = 'info') => {
    setLogMessages(prev => [...prev, { id: Date.now() + Math.random(), msg, type, time: new Date() }]);
  }, []);

  // ─── Load workplan and context on mount ─────────────────────────────────
  useEffect(() => {
    if (!projectPath) return;
    (async () => {
      try {
        const docsPath = projectPath.replace(/[\\/]$/, '') + '/docs';
        const devLeadPath = docsPath + '/dev-lead';

        // Load workplan
        const wpPath = devLeadPath + '/workplan.json';
        const wpExists = await api.exists(wpPath);
        if (!wpExists) {
          setError(`No workplan.json found in ${devLeadPath}. Complete the Dev Lead phase first.`);
          return;
        }
        const planRaw = await api.readFile(wpPath);
        if (!planRaw) {
          setError(`workplan.json exists but is empty in ${devLeadPath}. Re-run the Dev Lead phase.`);
          return;
        }
        const plan = JSON.parse(planRaw);
        setWorkplan(plan);

        // Load project context
        const [srs, hld, uiHtml, uiCss] = await Promise.all([
          api.readFile(docsPath + '/SRS.md'),
          api.readFile(docsPath + '/HLD.md'),
          api.readFile(docsPath + '/ui/index.html'),
          api.readFile(docsPath + '/ui/styles.css'),
        ]);

        setProjectContext({
          projectName: plan.projectName || '',
          srs: srs || '',
          hld: hld || '',
          uiHtml: uiHtml || '',
          uiCss: uiCss || '',
        });

        // Build execution plan
        const execPlan = buildExecutionPlan(plan);
        const execBatches = buildParallelBatches(execPlan);

        // Restore saved statuses if available
        const statusPath = projectPath.replace(/[\\/]$/, '') + '/docs/dev-lead/coding-status.json';
        const savedRaw = await api.readFile(statusPath);
        let restoredCount = 0;
        if (savedRaw) {
          try {
            const saved = JSON.parse(savedRaw);
            if (saved.tasks && Array.isArray(saved.tasks)) {
              const statusMap = {};
              for (const st of saved.tasks) statusMap[st.id] = st;
              for (const task of execPlan) {
                const st = statusMap[task.id];
                if (st && (st.status === 'done' || st.status === 'error')) {
                  task.status = st.status;
                  task.progress = st.progress || 0;
                  task.error = st.error || null;
                  task.files = (st.files || []).map(f => ({ path: f.path, content: '' }));
                  task.commands = (st.commands || []).map(c => ({ command: c.command, description: c.description, result: { code: c.code } }));
                  restoredCount++;
                }
              }
            }
          } catch (e) {
            console.warn('[CodingPhase] Failed to parse saved status:', e);
          }
        }

        setTasks(execPlan);
        setBatches(execBatches);

        // Check if all tasks were already completed
        const allDone = execPlan.length > 0 && execPlan.every(t => t.status === 'done' || t.status === 'error');
        if (allDone) {
          setIsComplete(true);
          const doneFiles = execPlan.flatMap(t => t.files || []);
          setAllFiles(doneFiles);
        }

        addLog(`Loaded workplan: ${execPlan.length} tasks across ${plan.phases?.length || 0} phases`);
        if (restoredCount > 0) {
          addLog(`Restored ${restoredCount} completed task${restoredCount > 1 ? 's' : ''} from previous run`, 'success');
        }
        addLog(`Execution plan: ${execBatches.length} sequential batches`);

        // Show agent assignment summary
        const agentCounts = {};
        for (const t of execPlan) {
          agentCounts[t.assignedAgent] = (agentCounts[t.assignedAgent] || 0) + 1;
        }
        for (const [agent, count] of Object.entries(agentCounts)) {
          const def = AGENT_DEFINITIONS[agent];
          addLog(`${def?.emoji || '?'} ${def?.name || agent}: ${count} task${count > 1 ? 's' : ''}`);
        }
      } catch (err) {
        setError('Failed to load workplan: ' + err.message);
      }
    })();
  }, [projectPath]);

  // ─── Start execution ──────────────────────────────────────────────────────
  const startExecution = useCallback(async () => {
    if (!workplan || !projectContext || isRunning) return;
    setIsRunning(true);
    setIsComplete(false);
    setError(null);
    setAllFiles([]);
    addLog('Starting code implementation...');

    // Reset task statuses
    setTasks(prev => prev.map(t => ({ ...t, status: 'pending', progress: 0, output: null, files: [], error: null })));

    const orchestrator = new CodingOrchestrator({
      workplan,
      projectContext,
      settings,
      projectPath,
      onTaskUpdate: (updatedTask, allTasks) => {
        setTasks(allTasks.map(t => ({ ...t, files: t.files ? [...t.files] : [], commands: t.commands ? [...t.commands] : [] })));
        if (updatedTask.status === 'running' && updatedTask.progress === 0) {
          const def = AGENT_DEFINITIONS[updatedTask.assignedAgent];
          addLog(`${def?.emoji || '?'} ${def?.name || 'Agent'} started: ${updatedTask.title}`, 'start');
        }
        if (updatedTask.status === 'waiting') {
          const def = AGENT_DEFINITIONS[updatedTask.assignedAgent];
          addLog(`⏸ ${def?.name || 'Agent'} waiting for input: ${updatedTask.title}`, 'warning');
        }
        if (updatedTask.status === 'done') {
          const def = AGENT_DEFINITIONS[updatedTask.assignedAgent];
          addLog(`${def?.emoji || '✓'} ${def?.name || 'Agent'} completed: ${updatedTask.title} (${updatedTask.files?.length || 0} files)`, 'success');
          saveTaskStatus(allTasks);
        }
        if (updatedTask.status === 'error') {
          addLog(`✗ Failed: ${updatedTask.title} — ${updatedTask.error}`, 'error');
          notifyAgentError(AGENT_DEFINITIONS[updatedTask.assignedAgent]?.name || 'Agent', updatedTask.error);
          saveTaskStatus(allTasks);
        }
      },
      onBatchComplete: (batchIdx, totalBatches) => {
        addLog(`Batch ${batchIdx + 1}/${totalBatches} complete`);
      },
      onNeedInput: (task, question, options) => {
        const def = AGENT_DEFINITIONS[task.assignedAgent];
        notifyAgentNeedsInput(def?.name || 'Agent', question);
        if (onAgentChat) {
          return onAgentChat(task, question, options);
        }
        return Promise.resolve('');
      },
      onFileWritten: (task, file) => {
        const def = AGENT_DEFINITIONS[task.assignedAgent];
        addLog(`📄 ${def?.emoji || ''} Wrote: ${file.path}`, 'file');
        setAllFiles(prev => [...prev, file]);
      },
      onCommandExecuted: (task, cmd, result) => {
        const def = AGENT_DEFINITIONS[task.assignedAgent];
        const ok = result.code === 0;
        addLog(
          `${ok ? '⚡' : '⚠️'} ${def?.emoji || ''} ${cmd.description || cmd.command}${ok ? '' : ` (exit ${result.code})`}`,
          ok ? 'command' : 'error'
        );
      },
      onAllComplete: (files, finalTasks) => {
        setAllFiles(files);
        setIsComplete(true);
        setIsRunning(false);
        addLog(`All tasks complete! ${files.length} files written to disk.`, 'success');
        notifyAgentComplete('Code Implementation');
        saveTaskStatus(finalTasks);
      },
      onError: (err) => {
        setError(err.message);
        setIsRunning(false);
        addLog(`Orchestrator error: ${err.message}`, 'error');
        notifyAgentError('Code Implementation', err.message);
      },
    });

    orchestratorRef.current = orchestrator;
    await orchestrator.run();
  }, [workplan, projectContext, settings, isRunning, projectPath, addLog]);

  // ─── Cancel ───────────────────────────────────────────────────────────────
  const cancelExecution = useCallback(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.cancel();
      addLog('Cancelling...', 'error');
    }
  }, [addLog]);

  // ─── Group tasks by agent ─────────────────────────────────────────────────
  const tasksByAgent = {};
  for (const t of tasks) {
    if (!tasksByAgent[t.assignedAgent]) tasksByAgent[t.assignedAgent] = [];
    tasksByAgent[t.assignedAgent].push(t);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-card/50">
        <div className="flex items-center gap-3">
          <button onClick={onBack} title="Back to Dev Lead"
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-md hover:bg-surface-elevated transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-200 leading-tight">Code Implementation</p>
            <p className="text-[10px] text-gray-500">6 Specialist Agents &middot; Parallel Execution</p>
          </div>

          <div className="flex-1" />

          <ModelSelector
            settings={agentSettings}
            agentId="coding"
            accentColor="accent"
            onModelChange={(provider, model) => {
              const newSettings = {
                ...settings,
                agentModels: { ...settings.agentModels, coding: { provider, model } },
              };
              onUpdateSettings(newSettings);
            }}
          />

          {!isRunning && !isComplete && tasks.length > 0 && (
            <button onClick={startExecution}
              className="px-4 py-1.5 bg-accent text-surface rounded-lg text-xs font-semibold hover:bg-accent-hover transition-all flex items-center gap-1.5 shadow-lg shadow-accent/20">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              Start Implementation
            </button>
          )}

          {isRunning && (
            <button onClick={cancelExecution}
              className="px-4 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Overall Progress */}
      {tasks.length > 0 && <OverallProgress tasks={tasks} />}

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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Agent Cards + Task List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Completion screen */}
          {isComplete && <CompletionScreen tasks={tasks} files={allFiles} projectPath={projectPath} onNext={onNext} />}

          {/* Agent summary cards */}
          {!isComplete && Object.keys(tasksByAgent).length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Agents</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {Object.entries(tasksByAgent).map(([agentType, agentTasks]) => (
                  <AgentCard key={agentType} agentType={agentType} tasks={agentTasks} />
                ))}
              </div>
            </div>
          )}

          {/* Task list — sectioned by status */}
          {!isComplete && tasks.length > 0 && (() => {
            const inProgress = tasks.filter(t => t.status === 'running' || t.status === 'waiting');
            const completed = tasks.filter(t => t.status === 'done');
            const errored = tasks.filter(t => t.status === 'error');
            const pending = tasks.filter(t => t.status === 'pending' || !t.status);
            return (
              <div className="space-y-4">
                {/* In Progress section */}
                {inProgress.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                      <span className="text-[10px] font-semibold text-accent uppercase tracking-wider">
                        In Progress ({inProgress.length})
                      </span>
                      <div className="flex-1 h-px bg-accent/20" />
                    </div>
                    <div className="space-y-1.5">
                      {inProgress.map(task => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed section */}
                {completed.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">
                        Completed ({completed.length})
                      </span>
                      <div className="flex-1 h-px bg-green-500/20" />
                    </div>
                    <div className="space-y-1.5">
                      {completed.map(task => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Errored section */}
                {errored.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">
                        Failed ({errored.length})
                      </span>
                      <div className="flex-1 h-px bg-red-500/20" />
                    </div>
                    <div className="space-y-1.5">
                      {errored.map(task => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Pending section — grouped by batch */}
                {pending.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full border border-gray-600" />
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        Pending ({pending.length})
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="space-y-1.5">
                      {pending.map(task => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Empty state */}
          {tasks.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-300 mb-1">Loading Work Plan...</h3>
              <p className="text-xs text-gray-500">Reading tasks from the Dev Lead's work plan.</p>
            </div>
          )}
        </div>

        {/* Right: Activity Log */}
        <div className="w-72 border-l border-border flex flex-col bg-surface-card/20">
          <div className="px-3 py-2 border-b border-border/50">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Activity Log</h3>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {logMessages.map(log => (
              <div key={log.id} className="flex gap-2 items-start">
                <span className="text-[8px] text-gray-600 shrink-0 mt-0.5 w-12">
                  {log.time.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`text-[10px] leading-tight ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'success' ? 'text-green-400' :
                  log.type === 'start' ? 'text-accent' :
                  log.type === 'warning' ? 'text-amber-400' :
                  log.type === 'file' ? 'text-cyan-400' :
                  log.type === 'command' ? 'text-purple-400' :
                  'text-gray-400'
                }`}>
                  {log.msg}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
