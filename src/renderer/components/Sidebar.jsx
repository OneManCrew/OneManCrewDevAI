import React from 'react';

const AGENT_ICONS = {
  architect: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
  ),
  ui_designer: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  dev_lead: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  coding: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  bug_fixer: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

const AGENT_COLORS = {
  architect: 'purple',
  ui_designer: 'pink',
  dev_lead: 'emerald',
  coding: 'accent',
  bug_fixer: 'red',
};

export default function Sidebar({ currentView, onNavigate, projectPath, agents = [] }) {
  return (
    <aside className="w-16 bg-surface-card border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
      {/* Project button */}
      <SidebarButton
        isActive={currentView === 'project'}
        onClick={() => onNavigate('project')}
        label="Project"
        icon={
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        }
      />

      {/* Divider */}
      <div className="w-7 h-px bg-border my-1.5" />

      {/* Agent Pipeline */}
      {agents.map((agent) => {
        const isActive = currentView === agent.id;
        const isDisabled = !projectPath;
        const color = AGENT_COLORS[agent.id] || 'accent';

        return (
          <SidebarButton
            key={agent.id}
            isActive={isActive}
            isDisabled={isDisabled}
            onClick={() => !isDisabled && onNavigate(agent.id)}
            label={`${agent.num}. ${agent.label}`}
            color={color}
            icon={
              <div className="relative">
                {AGENT_ICONS[agent.id] || (
                  <span className="text-[10px] font-bold">{agent.num}</span>
                )}
              </div>
            }
            badge={agent.num}
          />
        );
      })}

      <div className="flex-1" />

      {/* Settings */}
      <SidebarButton
        isActive={currentView === 'settings'}
        onClick={() => onNavigate('settings')}
        label="Settings"
        icon={
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      />

      <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center mt-2">
        <span className="text-accent text-xs font-bold">AI</span>
      </div>
    </aside>
  );
}

function SidebarButton({ isActive, isDisabled, onClick, label, icon, color = 'accent', badge }) {
  const colorMap = {
    accent: { active: 'bg-accent/15 text-accent', indicator: 'bg-accent' },
    purple: { active: 'bg-purple-500/15 text-purple-400', indicator: 'bg-purple-400' },
    pink: { active: 'bg-pink-500/15 text-pink-400', indicator: 'bg-pink-400' },
    emerald: { active: 'bg-emerald-500/15 text-emerald-400', indicator: 'bg-emerald-400' },
    red: { active: 'bg-red-500/15 text-red-400', indicator: 'bg-red-400' },
  };
  const c = colorMap[color] || colorMap.accent;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title={isDisabled ? 'Select a project first' : label}
      className={`
        relative w-11 h-11 flex items-center justify-center rounded-xl
        transition-all duration-150 group
        ${isActive
          ? c.active
          : isDisabled
            ? 'text-gray-600 cursor-not-allowed'
            : 'text-gray-500 hover:text-gray-300 hover:bg-surface-elevated'
        }
      `}
    >
      {icon}
      {badge && (
        <span className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center ${
          isActive ? c.indicator + ' text-white' : 'bg-surface-elevated text-gray-500 border border-border'
        }`}>
          {badge}
        </span>
      )}
      {isActive && (
        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 ${c.indicator} rounded-r`} />
      )}
      <span className="absolute left-full ml-2 px-2 py-1 text-xs font-medium bg-surface-elevated border border-border rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
        {label}
      </span>
    </button>
  );
}
