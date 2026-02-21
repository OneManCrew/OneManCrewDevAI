import React, { useState, useEffect, useRef } from 'react';

/**
 * Progress bar shown during document generation.
 * Estimates progress based on token count and elapsed time.
 */
export default function GenerationProgress({ isGenerating, tokenCount, estimatedTokens = 4000 }) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (isGenerating) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isGenerating]);

  if (!isGenerating && tokenCount === 0) return null;

  const progress = Math.min((tokenCount / estimatedTokens) * 100, 98);
  const isDone = !isGenerating && tokenCount > 0;
  const displayProgress = isDone ? 100 : progress;

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  // Estimate remaining time based on current rate
  const tokensPerSecond = elapsed > 0 ? tokenCount / elapsed : 0;
  const remainingTokens = estimatedTokens - tokenCount;
  const estimatedRemaining = tokensPerSecond > 0 ? Math.ceil(remainingTokens / tokensPerSecond) : null;

  return (
    <div className="mx-6 mb-3">
      <div className="p-3 bg-surface-card border border-border rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isGenerating ? (
              <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className="text-xs font-medium text-gray-300">
              {isDone ? 'Generation Complete' : 'Generating Documents...'}
            </span>
          </div>
          <span className="text-xs text-gray-500 font-mono">
            {formatTime(elapsed)}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-2 bg-surface rounded-full overflow-hidden mb-1.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isDone ? 'bg-green-500' : 'bg-gradient-to-r from-purple-500 to-accent'
            }`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-[10px] text-gray-500">
          <span>{tokenCount.toLocaleString()} tokens generated</span>
          {isGenerating && estimatedRemaining !== null && estimatedRemaining > 0 && (
            <span>~{formatTime(estimatedRemaining)} remaining</span>
          )}
          {isDone && (
            <span className="text-green-500">Done</span>
          )}
        </div>
      </div>
    </div>
  );
}
