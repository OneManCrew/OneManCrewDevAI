import React, { useState, useMemo } from 'react';

// ─── Category config ─────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  setup: { bg: 'bg-slate-500/15', text: 'text-slate-400', dot: 'bg-slate-400' },
  backend: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400' },
  frontend: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
  integration: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  testing: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  devops: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
  documentation: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400' },
};

const PRIORITY_COLORS = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  low: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ─── TaskBoard Component ─────────────────────────────────────────────────────

export default function TaskBoard({ taskPlan, onRequestChange }) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [viewMode, setViewMode] = useState('phases'); // 'phases' | 'list' | 'board'

  if (!taskPlan || !taskPlan.phases) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        No work plan generated yet.
      </div>
    );
  }

  const { phases, summary } = taskPlan;

  // Flatten all tasks for list/board views
  const allTasks = useMemo(() => {
    const tasks = [];
    for (const phase of phases) {
      for (const task of phase.tasks || []) {
        tasks.push({ ...task, phaseName: phase.name, phaseId: phase.id });
      }
    }
    return tasks;
  }, [phases]);

  // Apply filters
  const filteredTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      return true;
    });
  }, [allTasks, filterCategory, filterPriority]);

  // Get unique categories from tasks
  const categories = useMemo(() => {
    const cats = new Set(allTasks.map((t) => t.category).filter(Boolean));
    return ['all', ...Array.from(cats).sort()];
  }, [allTasks]);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border bg-surface-card/50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">{taskPlan.projectName || 'Work Plan'}</h2>
            {summary && (
              <p className="text-[10px] text-gray-500 mt-0.5">
                {summary.totalTasks} tasks · ~{summary.totalEstimatedHours}h estimated
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {['phases', 'list'].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  viewMode === mode
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-elevated'
                }`}
              >
                {mode === 'phases' ? 'By Phase' : 'All Tasks'}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-2 py-1 text-[10px] bg-surface border border-border rounded-md text-gray-300 focus:outline-none focus:border-emerald-500/50"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-2 py-1 text-[10px] bg-surface border border-border rounded-md text-gray-300 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          {(filterCategory !== 'all' || filterPriority !== 'all') && (
            <button
              onClick={() => { setFilterCategory('all'); setFilterPriority('all'); }}
              className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear filters
            </button>
          )}
          <span className="text-[10px] text-gray-600 self-center ml-auto">
            {filteredTasks.length} of {allTasks.length} tasks
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedTask ? (
          <TaskDetail task={selectedTask} onBack={() => setSelectedTask(null)} onRequestChange={onRequestChange} />
        ) : viewMode === 'phases' ? (
          <PhaseView phases={phases} filteredTasks={filteredTasks} onSelectTask={setSelectedTask} />
        ) : (
          <ListView tasks={filteredTasks} onSelectTask={setSelectedTask} />
        )}
      </div>

      {/* Summary bar */}
      {summary && !selectedTask && (
        <div className="shrink-0 px-4 py-2 border-t border-border bg-surface-card/30">
          <div className="flex gap-3 flex-wrap">
            {Object.entries(summary.categories || {}).map(([cat, count]) => {
              if (count === 0) return null;
              const cc = CATEGORY_COLORS[cat] || CATEGORY_COLORS.setup;
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                    filterCategory === cat ? cc.bg + ' ' + cc.text : 'text-gray-500 hover:text-gray-400'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${cc.dot}`} />
                  {cat}: {count}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Phase View ──────────────────────────────────────────────────────────────

function PhaseView({ phases, filteredTasks, onSelectTask }) {
  const filteredIds = new Set(filteredTasks.map((t) => t.id));

  return (
    <div className="p-4 space-y-4">
      {phases.map((phase) => {
        const phaseTasks = (phase.tasks || []).filter((t) => filteredIds.has(t.id));
        if (phaseTasks.length === 0) return null;

        return (
          <div key={phase.id} className="space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold text-gray-300">{phase.name}</h3>
              <span className="text-[10px] text-gray-600">({phaseTasks.length} tasks)</span>
            </div>
            {phase.description && (
              <p className="text-[10px] text-gray-500 mb-2 -mt-1">{phase.description}</p>
            )}
            {phaseTasks.map((task) => (
              <TaskCard key={task.id} task={task} onClick={() => onSelectTask({ ...task, phaseName: phase.name })} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function ListView({ tasks, onSelectTask }) {
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.order || 0) - (b.order || 0);
    });
  }, [tasks]);

  return (
    <div className="p-4 space-y-1.5">
      {sorted.map((task) => (
        <TaskCard key={task.id} task={task} showPhase onClick={() => onSelectTask(task)} />
      ))}
    </div>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({ task, onClick, showPhase = false }) {
  const cc = CATEGORY_COLORS[task.category] || CATEGORY_COLORS.setup;
  const pc = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2.5 rounded-lg border border-border bg-surface-card/50 hover:bg-surface-elevated hover:border-border-hover transition-all duration-150 group"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[9px] font-mono ${pc.text}`}>{task.id}</span>
            {showPhase && task.phaseName && (
              <span className="text-[9px] text-gray-600 truncate">· {task.phaseName}</span>
            )}
          </div>
          <p className="text-xs font-medium text-gray-200 group-hover:text-white transition-colors leading-snug">
            {task.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cc.bg} ${cc.text}`}>
              {task.category}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${pc.bg} ${pc.text}`}>
              {task.priority}
            </span>
            {task.estimatedHours && (
              <span className="text-[9px] text-gray-600">~{task.estimatedHours}h</span>
            )}
            {task.dependencies && task.dependencies.length > 0 && (
              <span className="text-[9px] text-gray-600">
                ← {task.dependencies.length} dep{task.dependencies.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ─── Task Detail ─────────────────────────────────────────────────────────────

function TaskDetail({ task, onBack, onRequestChange }) {
  const cc = CATEGORY_COLORS[task.category] || CATEGORY_COLORS.setup;
  const pc = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

  return (
    <div className="p-4 space-y-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to list
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[10px] font-mono ${pc.text}`}>{task.id}</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cc.bg} ${cc.text}`}>{task.category}</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${pc.bg} ${pc.text}`}>{task.priority}</span>
          {task.estimatedHours && (
            <span className="text-[10px] text-gray-500">~{task.estimatedHours}h</span>
          )}
        </div>
        <h2 className="text-sm font-semibold text-gray-200">{task.title}</h2>
        {task.phaseName && (
          <p className="text-[10px] text-gray-500 mt-0.5">{task.phaseName}</p>
        )}
      </div>

      {/* Description */}
      <Section title="Description">
        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
      </Section>

      {/* Technical Notes */}
      {task.technicalNotes && (
        <Section title="Technical Notes">
          <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-mono bg-surface rounded-lg p-2.5 border border-border">
            {task.technicalNotes}
          </p>
        </Section>
      )}

      {/* Acceptance Criteria */}
      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <Section title="Acceptance Criteria">
          <ul className="space-y-1">
            {task.acceptanceCriteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                <div className="w-4 h-4 rounded border border-border shrink-0 mt-0.5 flex items-center justify-center">
                  <span className="text-[8px] text-gray-600">{i + 1}</span>
                </div>
                {criterion}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Dependencies */}
      {task.dependencies && task.dependencies.length > 0 && (
        <Section title="Dependencies">
          <div className="flex flex-wrap gap-1">
            {task.dependencies.map((dep) => (
              <span key={dep} className="px-2 py-0.5 text-[10px] font-mono bg-surface border border-border rounded text-gray-400">
                {dep}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Request change button */}
      {onRequestChange && (
        <button
          onClick={() => onRequestChange(task)}
          className="w-full py-2 text-xs font-medium text-gray-400 border border-border rounded-lg hover:border-border-hover hover:text-gray-300 transition-colors"
        >
          Request changes to this task...
        </button>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{title}</h3>
      {children}
    </div>
  );
}
