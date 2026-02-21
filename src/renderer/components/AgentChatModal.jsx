import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AGENT_DEFINITIONS } from '../services/codingAgents';

/**
 * AgentChatModal — A mini-chat overlay that appears when a coding agent
 * needs user input (e.g. "Should I install Node.js?", "Which DB driver?").
 *
 * Props:
 *  - isOpen: boolean
 *  - agentType: string (AGENT_TYPES key)
 *  - taskTitle: string
 *  - question: string (the agent's question to the user)
 *  - onRespond: (userMessage: string) => void
 *  - onDismiss: () => void
 *  - chatHistory: Array<{ role: 'agent'|'user', text: string }>
 */
export default function AgentChatModal({ isOpen, agentType, taskTitle, question, onRespond, onDismiss, chatHistory = [] }) {
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const agentDef = AGENT_DEFINITIONS[agentType] || { emoji: '🤖', name: 'Agent', color: 'blue' };

  const AGENT_COLOR_MAP = {
    blue: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/40', accent: 'bg-blue-500' },
    pink: { bg: 'bg-pink-500/15', text: 'text-pink-400', border: 'border-pink-500/40', accent: 'bg-pink-500' },
    orange: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/40', accent: 'bg-orange-500' },
    green: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/40', accent: 'bg-green-500' },
    purple: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/40', accent: 'bg-purple-500' },
    cyan: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/40', accent: 'bg-cyan-500' },
  };
  const colors = AGENT_COLOR_MAP[agentDef.color] || AGENT_COLOR_MAP.blue;

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, question]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    if (onRespond) onRespond(msg);
  }, [input, onRespond]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className={`w-[480px] max-h-[70vh] flex flex-col rounded-2xl border ${colors.border} bg-surface-card shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b ${colors.border} ${colors.bg} flex items-center gap-3`}>
          <span className="text-xl">{agentDef.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${colors.text}`}>{agentDef.name}</p>
            {taskTitle && (
              <p className="text-[10px] text-gray-500 truncate">Task: {taskTitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${colors.accent} animate-pulse`} />
            <span className="text-[9px] text-gray-500">Waiting for input</span>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 text-gray-500 hover:text-gray-300 rounded-md hover:bg-surface-elevated transition-colors"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px]">
          {/* Initial question */}
          {question && (
            <div className="flex gap-2.5 items-start">
              <div className={`w-6 h-6 rounded-full ${colors.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <span className="text-xs">{agentDef.emoji}</span>
              </div>
              <div className={`flex-1 px-3 py-2 rounded-xl rounded-tl-sm ${colors.bg} border ${colors.border}`}>
                <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{question}</p>
              </div>
            </div>
          )}

          {/* Chat history */}
          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'agent' ? (
                <div className={`w-6 h-6 rounded-full ${colors.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <span className="text-xs">{agentDef.emoji}</span>
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-accent">U</span>
                </div>
              )}
              <div className={`flex-1 px-3 py-2 rounded-xl ${
                msg.role === 'user'
                  ? 'bg-accent/10 border border-accent/20 rounded-tr-sm'
                  : `${colors.bg} border ${colors.border} rounded-tl-sm`
              }`}>
                <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          ))}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-border/50 bg-surface/50">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response..."
              className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-accent text-surface rounded-lg text-xs font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              Send
            </button>
          </div>
          <p className="text-[9px] text-gray-600 mt-1.5">
            The agent is paused and waiting for your response to continue working.
          </p>
        </div>
      </div>
    </div>
  );
}
