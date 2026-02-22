/**
 * Modular LLM Provider abstraction layer.
 * Each provider implements: chat(messages, settings, callbacks)
 * callbacks: { onToken, onDone, onError }
 */

import tokenTracker, { estimateTokens } from './tokenUsageTracker';

// ─── Message sanitizer (ensures Anthropic compatibility) ─────────────────────

function sanitizeMessages(messages) {
  // Filter out empty content messages
  let sanitized = messages.filter((m) => m.content && m.content.trim());

  // Separate system from chat messages
  const system = sanitized.filter((m) => m.role === 'system');
  let chat = sanitized.filter((m) => m.role !== 'system');

  // Merge consecutive same-role messages (Anthropic requires alternating roles)
  const merged = [];
  for (const msg of chat) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1] = {
        ...merged[merged.length - 1],
        content: merged[merged.length - 1].content + '\n\n' + msg.content,
      };
    } else {
      merged.push({ ...msg });
    }
  }
  chat = merged;

  // Ensure last message is 'user' (required by Anthropic)
  if (chat.length > 0 && chat[chat.length - 1].role !== 'user') {
    chat.pop();
  }

  // Ensure conversation starts with 'user' (required by Anthropic)
  while (chat.length > 0 && chat[0].role !== 'user') {
    chat.shift();
  }

  return [...system, ...chat];
}

// ─── OpenAI-compatible provider (works for OpenAI, OpenRouter, Ollama) ────────

class OpenAICompatibleProvider {
  constructor(baseUrl, getApiKey) {
    this.baseUrl = baseUrl;
    this.getApiKey = getApiKey;
  }

  async chat(messages, settings, { onToken, onDone, onError, agentId }) {
    const apiKey = this.getApiKey(settings);
    const model = settings.selectedModel || 'gpt-4o';

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: sanitizeMessages(messages),
          max_tokens: settings.contextWindow || 8192,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Provider returned ${response.status}: ${errBody}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || '';
            if (token) {
              fullText += token;
              onToken(token);
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      tokenTracker.record({
        agent: agentId || 'unknown',
        model,
        inputText: messages.map(m => m.content).join('\n'),
        outputText: fullText,
      });
      onDone(fullText);
    } catch (err) {
      onError(err);
    }
  }
}

// ─── Anthropic Provider ───────────────────────────────────────────────────────

class AnthropicProvider {
  async chat(messages, settings, { onToken, onDone, onError, agentId }) {
    const apiKey = settings.apiKeys?.anthropic;
    if (!apiKey) {
      onError(new Error('Anthropic API key is not configured. Go to Settings.'));
      return;
    }

    const model = settings.selectedModel || 'claude-sonnet-4-20250514';

    // Sanitize and extract system message
    const sanitized = sanitizeMessages(messages);
    const systemMsg = sanitized.find((m) => m.role === 'system');
    const chatMessages = sanitized.filter((m) => m.role !== 'system');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: settings.contextWindow || 8192,
          system: systemMsg?.content || '',
          messages: chatMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic returned ${response.status}: ${errBody}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta') {
              const token = parsed.delta?.text || '';
              if (token) {
                fullText += token;
                onToken(token);
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      tokenTracker.record({
        agent: agentId || 'unknown',
        model,
        inputText: messages.map(m => m.content).join('\n'),
        outputText: fullText,
      });
      onDone(fullText);
    } catch (err) {
      onError(err);
    }
  }
}

// ─── Gemini Provider ──────────────────────────────────────────────────────────

class GeminiProvider {
  async chat(messages, settings, { onToken, onDone, onError, agentId }) {
    const apiKey = settings.apiKeys?.gemini;
    if (!apiKey) {
      onError(new Error('Gemini API key is not configured. Go to Settings.'));
      return;
    }

    const model = settings.selectedModel || 'gemini-2.0-flash';

    // Sanitize and convert messages to Gemini format
    const sanitized = sanitizeMessages(messages);
    const systemMsg = sanitized.find((m) => m.role === 'system');
    const chatMessages = sanitized
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: chatMessages,
            systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
            generationConfig: {
              maxOutputTokens: settings.contextWindow || 8192,
            },
          }),
        }
      );

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Gemini returned ${response.status}: ${errBody}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data);
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                fullText += part.text;
                onToken(part.text);
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      tokenTracker.record({
        agent: agentId || 'unknown',
        model,
        inputText: messages.map(m => m.content).join('\n'),
        outputText: fullText,
      });
      onDone(fullText);
    } catch (err) {
      onError(err);
    }
  }
}

// ─── Fetch available models from provider APIs ───────────────────────────────

/**
 * Fetches the list of available model IDs from a given provider.
 * Returns an array of { id, name } objects sorted alphabetically.
 */
export async function fetchModels(providerId, settings) {
  try {
    switch (providerId) {
      case 'ollama': {
        const url = (settings.ollamaUrl || 'http://localhost:11434') + '/api/tags';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        const data = await res.json();
        return (data.models || []).map((m) => ({ id: m.name, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
      }

      case 'openai': {
        const key = settings.apiKeys?.openai;
        if (!key) return [];
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) throw new Error(`OpenAI ${res.status}`);
        const data = await res.json();
        return (data.data || []).map((m) => ({ id: m.id, name: m.id })).sort((a, b) => a.name.localeCompare(b.name));
      }

      case 'openrouter': {
        const key = settings.apiKeys?.openrouter;
        if (!key) return [];
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
        const data = await res.json();
        return (data.data || []).map((m) => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.name.localeCompare(b.name));
      }

      case 'anthropic': {
        const key = settings.apiKeys?.anthropic;
        if (!key) return [];
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}`);
        const data = await res.json();
        return (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id })).sort((a, b) => a.name.localeCompare(b.name));
      }

      case 'gemini': {
        const key = settings.apiKeys?.gemini;
        if (!key) return [];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const data = await res.json();
        return (data.models || [])
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => ({ id: m.name?.replace('models/', ''), name: m.displayName || m.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      default:
        return [];
    }
  } catch (err) {
    console.warn(`Failed to fetch models for ${providerId}:`, err);
    return [];
  }
}

// ─── Per-agent settings helper ────────────────────────────────────────────────

/**
 * Returns a merged settings object for a specific agent.
 * If the agent has a per-agent provider/model override in settings.agentModels,
 * those values replace the global provider/selectedModel.
 * API keys and other global settings are preserved.
 */
export function getAgentSettings(settings, agentId) {
  if (!settings) return settings;
  const override = settings.agentModels?.[agentId];
  if (!override || !override.provider) return settings;
  return {
    ...settings,
    provider: override.provider,
    selectedModel: override.model || '',
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createLLMProvider(settings) {
  const provider = settings?.provider || 'openai';

  switch (provider) {
    case 'ollama':
      return new OpenAICompatibleProvider(
        (settings.ollamaUrl || 'http://localhost:11434') + '/v1',
        () => null
      );

    case 'openrouter':
      return new OpenAICompatibleProvider(
        'https://openrouter.ai/api/v1',
        (s) => s.apiKeys?.openrouter
      );

    case 'openai':
      return new OpenAICompatibleProvider(
        'https://api.openai.com/v1',
        (s) => s.apiKeys?.openai
      );

    case 'anthropic':
      return new AnthropicProvider();

    case 'gemini':
      return new GeminiProvider();

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
