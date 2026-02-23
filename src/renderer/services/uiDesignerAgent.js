// ─── UI Designer Agent ─────────────────────────────────────────────────────────
// Phase-based conversational agent for UI/UX design.
// Reads SRS.md + HLD.md from previous stage, generates standalone HTML + CSS + JS files.

import { ASK_USER_TOOL_INSTRUCTION } from './agentTools';
import log from './logger';

export const UI_PHASES = {
  LOADING: 'loading',
  DISCOVERY: 'discovery',
  DESIGN: 'design',
  REVIEW: 'review',
  DONE: 'done',
};

export const UI_PHASE_LABELS = {
  [UI_PHASES.LOADING]: 'Loading Context',
  [UI_PHASES.DISCOVERY]: 'UI Discovery',
  [UI_PHASES.DESIGN]: 'Designing',
  [UI_PHASES.REVIEW]: 'Review',
  [UI_PHASES.DONE]: 'Complete',
};

// Triple-backtick fence built dynamically to avoid confusing Vite's parser
const F = String.fromCharCode(96, 96, 96); // ```

const BASE_PERSONA =
  'You are a world-class UI/UX Designer and Frontend Architect with 30+ years of experience.\n' +
  'You are an expert in all types of UI: Web applications, Native desktop apps, and Mobile apps.\n' +
  'You have deep knowledge of design systems, accessibility (WCAG), responsive design, color theory,\n' +
  'typography, micro-interactions, and modern UI frameworks.\n\n' +
  'Your design philosophy:\n' +
  '- **Decisive**: You make all design decisions yourself (fonts, spacing, colors, layout). Never ask about technical choices.\n' +
  '- **Complete**: You always produce FULL, working files — never stubs, never placeholders.\n' +
  '- **Polished**: Your output looks like a finished product, not a wireframe.\n' +
  '- Clean, modern, and professional interfaces with consistent spacing and visual hierarchy.\n' +
  '- Accessible color contrast (WCAG AA minimum) and legible font sizes.\n' +
  '- Intuitive navigation patterns appropriate to the app type.\n' +
  '- Attention to micro-details: shadows, borders, transitions, hover states.\n' +
  ASK_USER_TOOL_INSTRUCTION;

// ─── Phase Prompts ─────────────────────────────────────────────────────────────

const DISCOVERY_PROMPT = BASE_PERSONA + '\n\n' +
  '## Your Current Task: UI DISCOVERY\n\n' +
  'You have been given the SRS.md and HLD.md documents.\n' +
  'Your ONLY job in this phase: identify screens, state your design choices, ask at most 1-2 questions,\n' +
  'then OUTPUT the colors.json block and [UI_DISCOVERY_COMPLETE] — ALL IN YOUR VERY FIRST RESPONSE.\n\n' +

  '### YOUR FIRST RESPONSE MUST FOLLOW THIS EXACT STRUCTURE (in order):\n\n' +
  '**Part 1 — Screens:**\n' +
  'List every navigable VIEW from the SRS (e.g., "Clock", "Alarms", "Settings").\n' +
  '⚠️ SCREENS = views the user switches between, NOT components or CSS states.\n\n' +

  '**Part 2 — Your Design Decisions (state as facts, not questions):**\n' +
  '- "I\'ll use a dark theme: #1E293B background, #3B82F6 primary"\n' +
  '- "Inter font, sidebar navigation, card-based layout"\n\n' +

  '**Part 3 — At most 2 preference questions (OPTIONAL):**\n' +
  'If you want to ask questions, you MUST use the structured questions block below (renders as clickable buttons):\n\n' +
  F + 'questions\n' +
  '[\n' +
  '  { "q": "Dark mode or light mode?", "options": ["Dark", "Light", "Your choice"] },\n' +
  '  { "q": "Any specific brand colors?", "options": ["Use your suggested palette", "Traditional blue/gold", "Modern minimal"] }\n' +
  ']\n' + F + '\n\n' +
  '❌ NEVER ask questions as numbered lists, bullet points, or plain prose text.\n' +
  '❌ NEVER ask about fonts, CSS frameworks, icon libraries, responsiveness, border-radius.\n\n' +

  '**Part 4 — THE colors.json BLOCK (MANDATORY — include in EVERY response):**\n\n' +
  F + 'json:colors.json\n' +
  '{\n' +
  '  "primary": "#3B82F6",\n' +
  '  "primaryHover": "#2563EB",\n' +
  '  "secondary": "#6366F1",\n' +
  '  "accent": "#F59E0B",\n' +
  '  "background": "#0F172A",\n' +
  '  "surface": "#1E293B",\n' +
  '  "surfaceHover": "#334155",\n' +
  '  "text": "#F8FAFC",\n' +
  '  "textMuted": "#94A3B8",\n' +
  '  "border": "#334155",\n' +
  '  "success": "#22C55E",\n' +
  '  "warning": "#F59E0B",\n' +
  '  "error": "#EF4444",\n' +
  '  "info": "#3B82F6"\n' +
  '}\n' + F + '\n\n' +
  'Replace the hex values above with YOUR chosen palette for this specific project.\n\n' +

  '**Part 5 — End with exactly this token (MANDATORY):**\n' +
  '[UI_DISCOVERY_COMPLETE]\n\n' +

  '### IF THE USER REPLIES:\n' +
  'Incorporate their preference, output an UPDATED colors.json block, then [UI_DISCOVERY_COMPLETE] again.\n' +
  'Do NOT ask follow-up questions. One round of user input is the maximum.\n\n' +

  '### IMMEDIATE COMPLETION TRIGGERS:\n' +
  'If the user says "go ahead", "you decide", "whatever looks good", "תתחיל", "תחליט", "יאללה", "סבבה" or anything\n' +
  'indicating trust → output colors.json + [UI_DISCOVERY_COMPLETE] RIGHT NOW without any questions.\n\n' +

  '### ABSOLUTE RULES:\n' +
  '❌ NEVER skip the colors.json block — it is REQUIRED even in the first response\n' +
  '❌ NEVER skip [UI_DISCOVERY_COMPLETE] — it is REQUIRED to advance to design generation\n' +
  '❌ NEVER output any other JSON (no component specs, no animation configs)\n' +
  '❌ NEVER ask about CSS frameworks, icon libraries, border-radius, blur, or responsiveness\n' +
  '❌ NEVER ask more than 1 round of questions\n' +
  '✅ The colors.json block and [UI_DISCOVERY_COMPLETE] MUST appear in your FIRST response';

const DESIGN_PROMPT = BASE_PERSONA + '\n\n' +
  '## Your Current Task: GENERATE THE COMPLETE UI MOCKUP\n\n' +
  'Based on the conversation, the SRS/HLD documents, and the Design Tokens from discovery,\n' +
  'generate a **complete, production-quality, interactive HTML + CSS + JS mockup**.\n\n' +
  '**IMPORTANT: Pure HTML + CSS + vanilla JavaScript ONLY. No React, no JSX, no frameworks, no CDNs.**\n\n' +

  '### ⚠️ CRITICAL — Output Format (READ CAREFULLY):\n\n' +
  'You MUST output EXACTLY 3 fenced code blocks using THIS format:\n\n' +
  F + 'html:index.html\n<!DOCTYPE html><!-- ... --></html>\n' + F + '\n\n' +
  F + 'css:styles.css\n/* all styles here */\n' + F + '\n\n' +
  F + 'js:app.js\n// all JavaScript here\n' + F + '\n\n' +
  '❌ WRONG — DO NOT use these formats:\n' +
  '  ```html           (no filename tag)\n' +
  '  ```javascript     (wrong language tag — use "js" not "javascript")\n' +
  '  ```js             (no :filename)\n' +
  '  // index.html     (comment-based filename)\n' +
  '  /* styles.css */  (comment-based filename)\n' +
  '→ The filename after the colon (e.g., "html:index.html") is REQUIRED for the file to be saved.\n\n' +

  '### Quality Requirements — NON-NEGOTIABLE:\n\n' +
  '**1. ALL Screens from the SRS must exist in the HTML:**\n' +
  '   - Use `<section id="screen-name" class="screen">` for each screen.\n' +
  '   - Default screen is visible (`display: block`); others are `display: none` initially.\n\n' +
  '**2. Navigation that actually works:**\n' +
  '   - Nav buttons use `data-page="screen-name"` attribute, NOT href.\n' +
  '   - JS: `btn.dataset.page` to get the target. Show/hide `.screen` sections.\n' +
  '   - ✅ CORRECT JS pattern:\n' +
  '     `navBtn.addEventListener("click", () => { showScreen(navBtn.dataset.page); });`\n' +
  '   - ❌ WRONG: `getAttribute("href")` on buttons that have no href.\n\n' +
  '**3. CSS Custom Properties — NO hardcoded colors:**\n' +
  '   ✅ CORRECT:  `background: var(--background);  color: var(--primary);`\n' +
  '   ❌ WRONG:    `background: #1E293B;  color: #3B82F6;`\n' +
  '   → Define ALL design token colors in `:root { }` at the top of styles.css.\n\n' +
  '**4. Realistic, domain-specific placeholder content:**\n' +
  '   - Use names, dates, amounts relevant to the project (no "Lorem ipsum").\n' +
  '   - Tables/lists: 3-5 rows of realistic sample data.\n\n' +
  '**5. Working Interactivity:**\n' +
  '   - Tab switching, modal open/close, form validation with error messages.\n' +
  '   - All event listeners in app.js using addEventListener (no onclick= in HTML).\n\n' +
  '**6. Visual Polish:**\n' +
  '   - Sidebar navigation with active state highlighting.\n' +
  '   - Hover states, smooth transitions (0.15s ease), box-shadows, border-radius.\n' +
  '   - Responsive: sidebar collapses on mobile (@media max-width: 768px).\n\n' +
  '### File Rules:\n' +
  '- index.html must include: `<link rel="stylesheet" href="styles.css">` and `<script src="app.js"></script>`\n' +
  '- Filename in JS/HTML must be `app.js` (NOT `script.js`, NOT `main.js`).\n' +
  '- Output COMPLETE files — never truncate or use "// rest of code here".';

const REVIEW_PROMPT = BASE_PERSONA + '\n\n' +
  '## Your Current Task: UI REVIEW & MODIFICATIONS\n\n' +
  'The UI files (index.html, styles.css, app.js) have been generated and saved.\n' +
  'The user is reviewing them in the preview window and may request changes.\n\n' +
  '### Instructions:\n' +
  '1. Listen to the user\'s feedback carefully.\n' +
  '2. When making changes, output ONLY the file(s) that need changing, COMPLETE:\n\n' +
  F + 'html:index.html\n<!DOCTYPE html>\n<!-- COMPLETE updated HTML -->\n' + F + '\n\n' +
  F + 'css:styles.css\n/* COMPLETE updated CSS */\n' + F + '\n\n' +
  F + 'js:app.js\n// COMPLETE updated JS\n' + F + '\n\n' +
  '3. If the user asks a question (not a change), respond conversationally — no code blocks needed.\n' +
  '4. If asked to re-generate everything, output all 3 files.\n' +
  '5. Be proactive — suggest improvements you notice while making requested changes.\n\n' +
  '### Rules:\n' +
  '- Output the FULL file, not just the changed section.\n' +
  '- Maintain all existing functionality when modifying.\n' +
  '- Keep the design cohesive.\n' +
  '- No external CDN, framework, or library. Pure HTML + CSS + JS only.';

const DONE_PROMPT = BASE_PERSONA + '\n\n' +
  '## Your Current Task: FINALIZATION\n\n' +
  'The UI design has been approved. You can still make final adjustments if requested.\n' +
  'Follow the same output format as the Review phase. Pure HTML + CSS + JS, no frameworks.\n\n' +
  F + 'html:index.html\n<!-- Complete updated HTML if changes needed -->\n' + F + '\n\n' +
  F + 'css:styles.css\n/* Complete updated CSS if changes needed */\n' + F + '\n\n' +
  F + 'js:app.js\n// Complete updated JS if changes needed\n' + F;

export const UI_PHASE_PROMPTS = {
  [UI_PHASES.DISCOVERY]: DISCOVERY_PROMPT,
  [UI_PHASES.DESIGN]: DESIGN_PROMPT,
  [UI_PHASES.REVIEW]: REVIEW_PROMPT,
  [UI_PHASES.DONE]: DONE_PROMPT,
};

// ─── Phase Detection ───────────────────────────────────────────────────────────

/**
 * Detect phase transitions from LLM response text.
 */
export function detectUIPhaseTransition(responseText, currentPhase) {
  if (currentPhase === UI_PHASES.DISCOVERY && responseText.includes('[UI_DISCOVERY_COMPLETE]')) {
    return UI_PHASES.DESIGN;
  }
  return null;
}

// ─── Output Parser ─────────────────────────────────────────────────────────────

/**
 * Extracts UI files from agent output.
 *
 * Pass 1 — Strict named format (preferred):
 *   ```html:index.html  ```css:styles.css  ```js:app.js
 *   Also handles ```javascript:app.js and case-insensitive language tags.
 *
 * Pass 2 — Fallback for unnamed blocks (common model mistake):
 *   ```html   → index.html
 *   ```css    → styles.css
 *   ```javascript / ```js → app.js
 *   Only used if Pass 1 didn't find the file.
 *
 * Also extracts json:colors.json for design tokens.
 * Returns { components: [{ filename, content }], designTokens }
 */
export function parseUIDesignerOutput(text) {
  const result = { components: [], designTokens: null };

  const BT = String.fromCharCode(96); // backtick
  const fence = BT + BT + BT;

  /**
   * Extract content of a fenced block starting at contentStart.
   * searchEnd limits the search space (start of next block or end of text).
   */
  function extractBlockContent(contentStart, searchEnd) {
    const searchSpace = text.slice(contentStart, searchEnd);
    const lines = searchSpace.split('\n');
    let closingIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === fence) { closingIdx = i; break; }
    }
    return closingIdx === -1
      ? searchSpace.trim()
      : lines.slice(0, closingIdx).join('\n').trim();
  }

  // ── Pass 1: Named format  ```(html|css|js|jsx|tsx|javascript|typescript):filename ──
  // Language aliases map to canonical extensions
  const langToExt = { html: 'html', css: 'css', js: 'js', jsx: 'jsx', tsx: 'tsx', javascript: 'js', typescript: 'ts' };
  const namedPattern = new RegExp(fence + '(' + Object.keys(langToExt).join('|') + '):([^\\n' + BT + ']+)\\n', 'gi');
  let openMatch;
  const namedOpenings = [];

  while ((openMatch = namedPattern.exec(text)) !== null) {
    const lang = openMatch[1].toLowerCase();
    let filename = openMatch[2].trim();
    // If model wrote ```js:script.js but we need app.js — normalize common JS filenames
    if (langToExt[lang] === 'js' && /^(script|main|index)\.js$/.test(filename)) {
      filename = 'app.js';
    }
    namedOpenings.push({
      index: openMatch.index,
      contentStart: openMatch.index + openMatch[0].length,
      filename,
      lang,
    });
  }

  for (let o = 0; o < namedOpenings.length; o++) {
    const { contentStart, filename } = namedOpenings[o];
    const searchEnd = o + 1 < namedOpenings.length ? namedOpenings[o + 1].index : text.length;
    const content = extractBlockContent(contentStart, searchEnd);
    if (content) result.components.push({ filename, content });
  }

  // ── Pass 2: Unnamed fallback  ```html / ```css / ```javascript ──
  // Only runs if Pass 1 didn't find all 3 main files.
  const hasHtml = result.components.some(c => /\.html$/.test(c.filename));
  const hasCss  = result.components.some(c => /\.css$/.test(c.filename));
  const hasJs   = result.components.some(c => /\.(js|jsx|ts|tsx)$/.test(c.filename));

  if (!hasHtml || !hasCss || !hasJs) {
    const fallbackMap = [
      { tag: 'html', filename: 'index.html', needed: !hasHtml },
      { tag: 'css', filename: 'styles.css', needed: !hasCss },
      { tag: '(?:javascript|js)', filename: 'app.js', needed: !hasJs },
    ];

    for (const { tag, filename, needed } of fallbackMap) {
      if (!needed) continue;
      const pat = new RegExp(fence + tag + '\\s*\\n', 'i');
      const m = pat.exec(text);
      if (!m) continue;
      const contentStart = m.index + m[0].length;
      // Find the next fence opening after our start to limit the search space
      const allFenceStarts = [...text.matchAll(new RegExp(fence + '\\S', 'g'))]
        .map(x => x.index)
        .filter(i => i > m.index);
      const searchEnd = allFenceStarts.length > 0 ? allFenceStarts[0] : text.length;
      const content = extractBlockContent(contentStart, searchEnd);
      if (content && content.length > 50) {
        log.info('parseUIDesignerOutput', `Fallback extraction: ${filename} (unnamed block)`, { chars: content.length });
        result.components.push({ filename, content });
      }
    }
  }

  // Extract json:colors.json design token block (special case)
  const jsonPattern = new RegExp(fence + 'json:colors\\.json\\n([\\s\\S]*?)' + fence);
  const jsonMatch = text.match(jsonPattern);
  if (jsonMatch) {
    try {
      result.designTokens = JSON.parse(jsonMatch[1].trim());
    } catch (e) {
      log.warn('parseUIDesignerOutput', 'Failed to parse colors.json', { error: e.message });
    }
  }

  // ── Fallback: extract colors from prose if model forgot the json:colors.json block ──
  // Matches lines like: "Primary: #3B82F6" or "primary: #3B82F6" or "- primary (#3B82F6)"
  // Builds a minimal design token object so design generation can still proceed.
  if (!result.designTokens) {
    const colorLines = text.match(/#([0-9A-Fa-f]{6})\b/g);
    if (colorLines && colorLines.length >= 3) {
      // Try to extract labelled hex values
      const labelledPattern = /\b(primary|secondary|accent|background|surface|text|border|success|warning|error|info)\b[^\n#]*#([0-9A-Fa-f]{6})/gi;
      const found = {};
      let m;
      while ((m = labelledPattern.exec(text)) !== null) {
        const key = m[1].toLowerCase();
        if (!found[key]) found[key] = '#' + m[2];
      }
      if (Object.keys(found).length >= 2) {
        // Fill in defaults for any missing keys
        const defaults = {
          primary: '#3B82F6', primaryHover: '#2563EB', secondary: '#6366F1',
          accent: '#F59E0B', background: '#0F172A', surface: '#1E293B',
          surfaceHover: '#334155', text: '#F8FAFC', textMuted: '#94A3B8',
          border: '#334155', success: '#22C55E', warning: '#F59E0B',
          error: '#EF4444', info: '#3B82F6',
        };
        result.designTokens = { ...defaults, ...found };
        log.info('parseUIDesignerOutput', 'Built design tokens from prose (fallback)', { keys: Object.keys(found) });
      }
    }
  }

  log.info('parseUIDesignerOutput', 'Parsed output', {
    componentCount: result.components.length,
    filenames: result.components.map(c => c.filename),
    hasDesignTokens: !!result.designTokens,
    tokenSource: result.designTokens ? 'found' : 'none',
  });

  return result;
}

// ─── Conversation Builder ──────────────────────────────────────────────────────

/**
 * Build the messages array for the LLM.
 *
 * Injects SRS, HLD, and Design Tokens as context in the system prompt.
 * NOTE: Role alternation (ensuring last msg is 'user') is handled inside
 * each provider's sanitizeMessages — we do NOT strip the last assistant
 * message here, as that would lose critical Discovery context for Design generation.
 */
export function buildUIConversationMessages(chatHistory, currentPhase, contextDocs) {
  const systemPrompt = UI_PHASE_PROMPTS[currentPhase] || UI_PHASE_PROMPTS[UI_PHASES.DISCOVERY];

  // Build context block from SRS + HLD + Design Tokens
  let contextBlock = '';
  if (contextDocs) {
    if (contextDocs.srs) {
      contextBlock += '\n\n--- SRS.md (from Architect phase) ---\n' + contextDocs.srs + '\n--- End SRS.md ---';
    }
    if (contextDocs.hld) {
      contextBlock += '\n\n--- HLD.md (from Architect phase) ---\n' + contextDocs.hld + '\n--- End HLD.md ---';
    }
    if (contextDocs.designTokens) {
      contextBlock += '\n\n--- Design Tokens (colors.json) ---\n' +
        JSON.stringify(contextDocs.designTokens, null, 2) +
        '\n--- End Design Tokens ---';
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt + contextBlock },
  ];

  // Add conversation history (skip system messages and empty assistant placeholders)
  for (const msg of chatHistory) {
    if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // NOTE: Do NOT pop the last assistant message here.
  // Role alternation is the responsibility of each provider's sanitizeMessages().
  // Removing the last assistant message here would lose the Discovery context
  // when transitioning to the Design phase.

  log.debug('buildUIConversationMessages', 'Built messages', {
    phase: currentPhase,
    messageCount: messages.length,
    lastRole: messages[messages.length - 1]?.role,
    hasContext: !!contextDocs?.srs || !!contextDocs?.hld,
  });

  return messages;
}
