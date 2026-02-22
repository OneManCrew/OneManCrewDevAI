import React from 'react';
import TokenUsageBadge from './TokenUsageBadge';

export default function TitleBar({ projectPath }) {
  const projectName = projectPath ? projectPath.split(/[\\/]/).pop() : null;

  return (
    <div className="drag-region h-[38px] flex items-center px-4 bg-surface border-b border-border shrink-0">
      <div className="flex items-center gap-2 no-drag">
        <div className="w-3 h-3 rounded-full bg-accent" />
        <span className="text-sm font-semibold text-gray-300 tracking-wide">
          OneManCrew
        </span>
        <span className="text-xs text-gray-500 font-mono">.Dev.AI</span>
      </div>
      {projectName && (
        <div className="ml-4 flex items-center gap-1.5 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="font-mono">{projectName}</span>
        </div>
      )}
      <div className="flex-1" />
      <TokenUsageBadge />
    </div>
  );
}
