import React, { useState, useEffect, useCallback } from 'react';
import tokenTracker from '../services/tokenUsageTracker';

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(cost) {
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
}

export default function TokenUsageBadge() {
  const [usage, setUsage] = useState(tokenTracker.getUsage());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    return tokenTracker.subscribe(setUsage);
  }, []);

  const handleReset = useCallback(() => {
    if (window.confirm('Reset all token usage data?')) {
      tokenTracker.reset();
    }
  }, []);

  if (usage.calls === 0) return null;

  return (
    <div className="relative no-drag">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-elevated border border-border text-gray-400 hover:text-gray-200 hover:border-border-hover transition-colors"
        title="Token Usage"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>{formatNumber(usage.totalTokens)} tokens</span>
        <span className="text-gray-500">·</span>
        <span className="text-amber-400">{formatCost(usage.totalCost)}</span>
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-surface-elevated border border-border rounded-lg shadow-xl z-50 p-3 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-200">Token Usage</span>
            <button
              onClick={handleReset}
              className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
            >
              Reset
            </button>
          </div>

          <div className="space-y-1.5 text-gray-400">
            <div className="flex justify-between">
              <span>Input tokens</span>
              <span className="text-gray-300 font-mono">{formatNumber(usage.totalInputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span>Output tokens</span>
              <span className="text-gray-300 font-mono">{formatNumber(usage.totalOutputTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span>Total tokens</span>
              <span className="text-gray-200 font-mono font-semibold">{formatNumber(usage.totalTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span>LLM calls</span>
              <span className="text-gray-300 font-mono">{usage.calls}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-200">Estimated Cost</span>
              <span className="font-semibold text-amber-400 font-mono">{formatCost(usage.totalCost)}</span>
            </div>
          </div>

          {Object.keys(usage.byAgent).length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">By Agent</span>
              <div className="mt-1 space-y-1">
                {Object.entries(usage.byAgent).map(([agent, data]) => (
                  <div key={agent} className="flex justify-between text-gray-400">
                    <span className="capitalize">{agent}</span>
                    <span className="font-mono text-gray-500">
                      {formatNumber(data.inputTokens + data.outputTokens)} · {formatCost(data.cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
