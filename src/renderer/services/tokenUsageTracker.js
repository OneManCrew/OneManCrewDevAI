/**
 * Centralized Token Usage Tracker.
 * Singleton that tracks input/output tokens across all LLM calls,
 * estimates cost, and persists to project_knowledge.json.
 *
 * Usage:
 *   import tokenTracker from './tokenUsageTracker';
 *   tokenTracker.record({ agent: 'architect', model: 'gpt-4o', inputTokens: 500, outputTokens: 200 });
 *   const usage = tokenTracker.getUsage();
 */

import api from './electronBridge';
import log from './logger';

// Approximate cost per 1K tokens (USD) — conservative estimates
const COST_PER_1K = {
  // OpenAI
  'gpt-4o':           { input: 0.0025, output: 0.01 },
  'gpt-4o-mini':      { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':      { input: 0.01, output: 0.03 },
  'gpt-4':            { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo':    { input: 0.0005, output: 0.0015 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-opus':    { input: 0.015, output: 0.075 },
  'claude-3-haiku':   { input: 0.00025, output: 0.00125 },
  // Gemini
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-1.5-pro':   { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  // Default fallback
  _default:           { input: 0.003, output: 0.015 },
};

function getCostRate(model) {
  if (!model) return COST_PER_1K._default;
  const lower = model.toLowerCase();
  for (const [key, rate] of Object.entries(COST_PER_1K)) {
    if (key === '_default') continue;
    if (lower.includes(key)) return rate;
  }
  return COST_PER_1K._default;
}

// Rough token estimation: ~4 chars per token for English text
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

class TokenUsageTracker {
  constructor() {
    this._usage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      calls: 0,
      byAgent: {},
      history: [],
    };
    this._listeners = new Set();
    this._projectPath = null;
    this._loaded = false;
  }

  /**
   * Initialize tracker for a project — loads persisted data.
   */
  async init(projectPath) {
    this._projectPath = projectPath;
    log.info('TokenTracker', 'init', { projectPath });
    if (!projectPath) return;
    try {
      const knowledgePath = projectPath.replace(/[\\/]$/, '') + '/docs/project_knowledge.json';
      const raw = await api.readFile(knowledgePath);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.tokenUsage) {
          this._usage = {
            totalInputTokens: data.tokenUsage.totalInputTokens || 0,
            totalOutputTokens: data.tokenUsage.totalOutputTokens || 0,
            totalCost: data.tokenUsage.totalCost || 0,
            calls: data.tokenUsage.calls || 0,
            byAgent: data.tokenUsage.byAgent || {},
            history: data.tokenUsage.history || [],
          };
        }
      }
    } catch (e) {
      // No existing data — start fresh
    }
    this._loaded = true;
    this._notify();
  }

  /**
   * Record a single LLM call's token usage.
   * @param {{ agent: string, model: string, inputTokens?: number, outputTokens?: number, inputText?: string, outputText?: string }} entry
   */
  record({ agent, model, inputTokens, outputTokens, inputText, outputText }) {
    const inTok = inputTokens || estimateTokens(inputText);
    const outTok = outputTokens || estimateTokens(outputText);
    log.info('TokenTracker', 'record', { agent, model, inTok, outTok });
    const rate = getCostRate(model);
    const cost = (inTok / 1000) * rate.input + (outTok / 1000) * rate.output;

    this._usage.totalInputTokens += inTok;
    this._usage.totalOutputTokens += outTok;
    this._usage.totalCost += cost;
    this._usage.calls += 1;

    // Per-agent breakdown
    if (agent) {
      if (!this._usage.byAgent[agent]) {
        this._usage.byAgent[agent] = { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      }
      this._usage.byAgent[agent].inputTokens += inTok;
      this._usage.byAgent[agent].outputTokens += outTok;
      this._usage.byAgent[agent].cost += cost;
      this._usage.byAgent[agent].calls += 1;
    }

    // Keep last 100 entries in history
    this._usage.history.push({
      ts: new Date().toISOString(),
      agent: agent || 'unknown',
      model: model || 'unknown',
      inputTokens: inTok,
      outputTokens: outTok,
      cost: Math.round(cost * 1_000_000) / 1_000_000,
    });
    if (this._usage.history.length > 100) {
      this._usage.history = this._usage.history.slice(-100);
    }

    this._notify();
    this._persist();
  }

  /**
   * Get current usage snapshot.
   */
  getUsage() {
    return {
      ...this._usage,
      totalTokens: this._usage.totalInputTokens + this._usage.totalOutputTokens,
    };
  }

  /**
   * Subscribe to usage changes. Returns unsubscribe function.
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Reset all usage data.
   */
  reset() {
    this._usage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      calls: 0,
      byAgent: {},
      history: [],
    };
    this._notify();
    this._persist();
  }

  _notify() {
    const usage = this.getUsage();
    for (const listener of this._listeners) {
      try { listener(usage); } catch (e) { /* ignore */ }
    }
  }

  async _persist() {
    if (!this._projectPath) return;
    try {
      const knowledgePath = this._projectPath.replace(/[\\/]$/, '') + '/docs/project_knowledge.json';
      let existing = {};
      try {
        const raw = await api.readFile(knowledgePath);
        if (raw) existing = JSON.parse(raw);
      } catch (e) { /* new file */ }

      existing.tokenUsage = {
        totalInputTokens: this._usage.totalInputTokens,
        totalOutputTokens: this._usage.totalOutputTokens,
        totalCost: Math.round(this._usage.totalCost * 1_000_000) / 1_000_000,
        calls: this._usage.calls,
        byAgent: this._usage.byAgent,
        history: this._usage.history,
        updatedAt: new Date().toISOString(),
      };

      await api.safeWriteFile(knowledgePath, JSON.stringify(existing, null, 2));
    } catch (e) {
      log.warn('TokenTracker', 'Failed to persist', { message: e.message });
    }
  }
}

// Singleton
const tokenTracker = new TokenUsageTracker();
export default tokenTracker;
export { estimateTokens, getCostRate };
