import React, { useState, useEffect, useCallback } from 'react';
import { fetchAndCacheModels, clearModelCache } from './ModelSelector';

const PROVIDERS = [
  { id: 'ollama', name: 'Ollama', description: 'Local models via Ollama', needsKey: false },
  { id: 'openrouter', name: 'OpenRouter', description: 'Multi-provider gateway', needsKey: true },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, o1, etc.', needsKey: true },
  { id: 'gemini', name: 'Gemini', description: 'Google Gemini models', needsKey: true },
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 3.5, Claude 4', needsKey: true },
];

const CONTEXT_SIZES = [
  { value: 4096, label: '4K' },
  { value: 8192, label: '8K' },
  { value: 16384, label: '16K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
  { value: 200000, label: '200K' },
];

export default function SettingsPanel({ settings, onUpdate }) {
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState({});
  const [globalModels, setGlobalModels] = useState([]);
  const [globalModelsLoading, setGlobalModelsLoading] = useState(false);
  const [agentModels, setAgentModels] = useState({}); // { [providerId]: models[] }
  const [agentModelsLoading, setAgentModelsLoading] = useState({});

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  // Fetch models for the global provider
  const fetchGlobalModels = useCallback(async (providerId, settingsObj) => {
    setGlobalModelsLoading(true);
    const models = await fetchAndCacheModels(providerId || settingsObj?.provider, settingsObj || local);
    setGlobalModels(models);
    setGlobalModelsLoading(false);
  }, [local]);

  useEffect(() => {
    if (local?.provider) fetchGlobalModels(local.provider, local);
  }, [local?.provider]);

  // Fetch models for a per-agent provider
  const fetchAgentModelsFor = useCallback(async (providerId) => {
    if (!providerId) return;
    setAgentModelsLoading((prev) => ({ ...prev, [providerId]: true }));
    const models = await fetchAndCacheModels(providerId, local);
    setAgentModels((prev) => ({ ...prev, [providerId]: models }));
    setAgentModelsLoading((prev) => ({ ...prev, [providerId]: false }));
  }, [local]);

  const handleChange = (field, value) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleApiKeyChange = (provider, value) => {
    setLocal((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    await onUpdate(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleShowKey = (provider) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (!local) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-gray-100 mb-1">Settings</h1>
          <p className="text-sm text-gray-500">Configure providers, API keys, and model parameters.</p>
        </div>

        {/* Provider Selection */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            LLM Provider
          </h2>
          <div className="grid gap-2">
            {PROVIDERS.map((p) => {
              const isSelected = local.provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleChange('provider', p.id)}
                  className={`
                    flex items-center gap-4 p-3 rounded-xl border text-left transition-all
                    ${isSelected
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border hover:border-border-hover bg-surface-card'
                    }
                  `}
                >
                  <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center
                    ${isSelected ? 'border-accent' : 'border-gray-600'}
                  `}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isSelected ? 'text-accent' : 'text-gray-300'}`}>
                      {p.name}
                    </p>
                    <p className="text-xs text-gray-500">{p.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Ollama URL (shown only when Ollama is selected) */}
        {local.provider === 'ollama' && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
              Ollama Server URL
            </h2>
            <input
              type="text"
              className="input-field font-mono text-sm"
              value={local.ollamaUrl || ''}
              onChange={(e) => handleChange('ollamaUrl', e.target.value)}
              placeholder="http://localhost:11434"
            />
          </section>
        )}

        {/* API Keys */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            API Keys
          </h2>
          <div className="space-y-3">
            {PROVIDERS.filter((p) => p.needsKey).map((p) => (
              <div key={p.id} className="card">
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-300">{p.name}</span>
                  <button
                    onClick={() => toggleShowKey(p.id)}
                    className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    {showKeys[p.id] ? 'Hide' : 'Show'}
                  </button>
                </label>
                <input
                  type={showKeys[p.id] ? 'text' : 'password'}
                  className="input-field font-mono text-sm"
                  value={local.apiKeys?.[p.id] || ''}
                  onChange={(e) => handleApiKeyChange(p.id, e.target.value)}
                  placeholder={`Enter ${p.name} API key...`}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Context Window */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            Context Window
          </h2>
          <div className="flex flex-wrap gap-2">
            {CONTEXT_SIZES.map((size) => {
              const isSelected = local.contextWindow === size.value;
              return (
                <button
                  key={size.value}
                  onClick={() => handleChange('contextWindow', size.value)}
                  className={`
                    px-4 py-2 rounded-lg text-sm font-mono font-medium transition-all border
                    ${isSelected
                      ? 'bg-accent/15 border-accent/40 text-accent'
                      : 'bg-surface-card border-border text-gray-400 hover:border-border-hover hover:text-gray-300'
                    }
                  `}
                >
                  {size.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Maximum tokens the model will use for context. Larger values use more memory.
          </p>
        </section>

        {/* Model Selection */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            Default Model
            <button
              onClick={() => { clearModelCache(local.provider); fetchGlobalModels(local.provider, local); }}
              title="Refresh model list"
              className="p-1 text-gray-500 hover:text-accent transition-colors"
            >
              <svg className={`w-3.5 h-3.5 ${globalModelsLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </h2>
          <div className="flex gap-2">
            <select
              value={local.selectedModel || ''}
              onChange={(e) => handleChange('selectedModel', e.target.value)}
              className="input-field font-mono text-sm flex-1"
            >
              <option value="">— Select a model —</option>
              {globalModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.name} (${m.id})` : m.id}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            className="input-field font-mono text-sm mt-2"
            value={local.selectedModel || ''}
            onChange={(e) => handleChange('selectedModel', e.target.value)}
            placeholder="Or type model ID manually..."
          />
          <p className="text-xs text-gray-500 mt-1">
            {globalModelsLoading ? 'Loading models...' : `${globalModels.length} models available from ${local.provider || 'provider'}`}
          </p>
        </section>

        {/* Per-Agent Model Overrides */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
            Per-Agent Model Overrides
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Optionally assign a different provider &amp; model to each agent. Leave empty to use the global defaults above.
          </p>
          <div className="space-y-4">
            {[
              { id: 'architect', label: 'Architect', color: 'accent' },
              { id: 'ui_designer', label: 'UI Designer', color: 'pink-400' },
              { id: 'dev_lead', label: 'Dev Lead', color: 'emerald-400' },
              { id: 'coding', label: 'Coding Agents', color: 'blue-400' },
              { id: 'bug_fixer', label: 'Bug Fixer', color: 'red-400' },
            ].map((agent) => {
              const override = local.agentModels?.[agent.id] || {};
              const effectiveProvider = override.provider || local.provider;
              const modelsForAgent = override.provider
                ? (agentModels[override.provider] || [])
                : globalModels;
              const isLoadingAgent = override.provider
                ? agentModelsLoading[override.provider]
                : globalModelsLoading;
              const updateAgent = (field, value) => {
                setLocal((prev) => ({
                  ...prev,
                  agentModels: {
                    ...prev.agentModels,
                    [agent.id]: { ...prev.agentModels?.[agent.id], [field]: value },
                  },
                }));
                setSaved(false);
              };
              return (
                <div key={agent.id} className="card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full bg-${agent.color}`} />
                    <span className="text-sm font-medium text-gray-300">{agent.label}</span>
                    <span className="ml-auto text-[10px] text-gray-500 font-mono">
                      {override.provider ? `${override.provider}` : 'global'}{override.model ? ` / ${override.model}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-2 mb-1">
                    <select
                      value={override.provider || ''}
                      onChange={(e) => {
                        updateAgent('provider', e.target.value);
                        if (e.target.value) fetchAgentModelsFor(e.target.value);
                      }}
                      className="input-field text-xs w-28 shrink-0"
                    >
                      <option value="">Global default</option>
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select
                      value={override.model || ''}
                      onChange={(e) => updateAgent('model', e.target.value)}
                      className="input-field text-xs font-mono flex-1"
                    >
                      <option value="">— {override.provider ? 'Select model' : 'Global default'} —</option>
                      {modelsForAgent.map((m) => (
                        <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.name} (${m.id})` : m.id}</option>
                      ))}
                    </select>
                    {override.provider && (
                      <button
                        onClick={() => { clearModelCache(override.provider); fetchAgentModelsFor(override.provider); }}
                        title="Refresh models"
                        className="p-1 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                      >
                        <svg className={`w-3 h-3 ${isLoadingAgent ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={override.model || ''}
                    onChange={(e) => updateAgent('model', e.target.value)}
                    placeholder="Or type model ID manually..."
                    className="input-field text-[10px] font-mono w-full"
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Save Button */}
        <div className="flex items-center gap-3 pb-8">
          <button onClick={handleSave} className="btn-primary">
            {saved ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            ) : (
              'Save Settings'
            )}
          </button>
          <span className="text-xs text-gray-600">
            Settings are stored locally in your user data folder.
          </span>
        </div>
      </div>
    </div>
  );
}
