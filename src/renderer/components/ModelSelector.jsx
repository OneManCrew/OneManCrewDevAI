import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchModels } from '../services/llmProviders';

const PROVIDERS = [
  { id: 'ollama', name: 'Ollama' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'anthropic', name: 'Anthropic' },
];

// ─── Shared model cache (persists across component instances) ────────────────
const modelCache = {};

export async function fetchAndCacheModels(providerId, settings) {
  const cacheKey = providerId;
  if (modelCache[cacheKey]) return modelCache[cacheKey];
  const models = await fetchModels(providerId, settings);
  if (models.length > 0) modelCache[cacheKey] = models;
  return models;
}

export function clearModelCache(providerId) {
  if (providerId) delete modelCache[providerId];
  else Object.keys(modelCache).forEach((k) => delete modelCache[k]);
}

// ─── Compact inline model selector (for agent headers) ──────────────────────

export default function ModelSelector({ settings, agentId, onModelChange, accentColor = 'accent' }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const currentProvider = settings?.provider || 'openai';
  const currentModel = settings?.selectedModel || '';

  const loadModels = useCallback(async () => {
    setLoading(true);
    const result = await fetchAndCacheModels(currentProvider, settings);
    setModels(result);
    setLoading(false);
  }, [currentProvider, settings]);

  useEffect(() => {
    if (open) {
      loadModels();
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, loadModels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = search
    ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models;

  const shortModel = currentModel
    ? (currentModel.length > 25 ? currentModel.slice(0, 22) + '...' : currentModel)
    : 'Select model';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-all hover:border-${accentColor}/40 ${
          open ? `border-${accentColor}/40 bg-${accentColor}/5` : 'border-border bg-surface text-gray-500 hover:text-gray-400'
        }`}
        title={currentModel || 'Click to select model'}
      >
        <span className="truncate max-w-[140px]">{shortModel}</span>
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-64 bg-surface-card border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2">
              <select
                value={currentProvider}
                onChange={(e) => {
                  onModelChange(e.target.value, '');
                  clearModelCache(e.target.value);
                }}
                className="input-field text-[10px] py-1 px-1.5 w-24 shrink-0"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="input-field text-[10px] py-1 px-2 flex-1"
              />
              <button
                onClick={() => { clearModelCache(currentProvider); loadModels(); }}
                title="Refresh models"
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
              >
                <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Model list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px] text-gray-500">Loading models...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-[10px] text-gray-500">
                  {models.length === 0 ? 'No models found. Check API key.' : 'No matches.'}
                </p>
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onModelChange(currentProvider, m.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors hover:bg-white/5 flex items-center gap-2 ${
                    m.id === currentModel ? `text-${accentColor} bg-${accentColor}/5` : 'text-gray-400'
                  }`}
                >
                  {m.id === currentModel && (
                    <svg className="w-2.5 h-2.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  )}
                  <span className="truncate">{m.name !== m.id ? `${m.name} (${m.id})` : m.id}</span>
                </button>
              ))
            )}
          </div>

          {/* Manual input */}
          <div className="p-2 border-t border-border">
            <input
              type="text"
              value={currentModel}
              onChange={(e) => onModelChange(currentProvider, e.target.value)}
              placeholder="Or type model ID manually..."
              className="input-field text-[10px] py-1 px-2 font-mono w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
