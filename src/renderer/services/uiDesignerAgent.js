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
  'You have been given the SRS.md and HLD.md documents. Your job: identify screens, state design decisions, ask at most 2 short questions, then immediately produce the design tokens and complete.\n\n' +

  '### STEP 1 — Your FIRST response must contain ALL of this:\n' +
  '1. **Screens identified** — list every navigable VIEW from the SRS by name (e.g., "Clock", "Alarms", "Settings").\n' +
  '   ⚠️ SCREENS = views the user switches between. NOT CSS effects, NOT animation objects, NOT wrapper components.\n' +
  '2. **Your design decisions** — state them as facts, not questions:\n' +
  '   - Color scheme: "I\'ll use a dark theme with #1E293B background and #3B82F6 primary"\n' +
  '   - Typography: "Inter font, 64px for time display, 16px for labels"\n' +
  '   - Layout: "centered card layout with fixed sidebar navigation"\n' +
  '3. **EXACTLY 1-2 short questions** about visual preferences (see format below).\n\n' +

  '### QUESTION FORMAT — READ THIS CAREFULLY:\n' +
  '✅ CORRECT — one plain sentence per question:\n' +
  '   "Do you prefer dark mode or light mode?"\n' +
  '   "Any brand colors or reference apps you like the look of?"\n\n' +
  '❌ WRONG — categories with sub-bullets:\n' +
  '   "1. Visual Style\\n   - What color scheme?\\n   - What aesthetic?"\n' +
  '   "2. Layout\\n   - Single line or separate?\\n   - Where should toggle go?"\n\n' +
  '→ Ask questions as flat sentences. No headers. No bullet sub-lists. Maximum 2 sentences total.\n\n' +

  '### STEP 2 — After the user\'s FIRST reply, IMMEDIATELY complete discovery:\n' +
  'Do NOT ask follow-up questions. Incorporate their input into the colors, then output:\n\n' +
  '**a. The design token file (MANDATORY):**\n\n' +
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
  'Customize every color to match the user\'s preference (dark/light, brand color, style).\n\n' +
  '**b. End the response with exactly: [UI_DISCOVERY_COMPLETE]**\n\n' +

  '### IMMEDIATE COMPLETION TRIGGERS:\n' +
  'If the user says ANY of these (in any language), output colors.json + [UI_DISCOVERY_COMPLETE] RIGHT NOW:\n' +
  '- "decide yourself" / "you decide" / "go ahead" / "up to you"\n' +
  '- "whatever you think" / "whatever looks good" / "just do it"\n' +
  '- "תעצב מה שנראה לך" / "תחליט בעצמך" / "תתחיל" / "אני מסכים"\n' +
  '- Any response indicating they have no preference or trust your judgment\n' +
  '→ These mean FULL APPROVAL. Do NOT ask more questions. Complete immediately.\n\n' +

  '### ABSOLUTE RULES:\n' +
  '❌ NEVER output any JSON except the `colors.json` block above\n' +
  '❌ NEVER output design specs, component objects, animation configs, or style guides as JSON\n' +
  '❌ NEVER ask about: CSS framework, icon library, font family, responsiveness, blur levels, border-radius, shadow intensity\n' +
  '❌ NEVER ask more than 1 round of questions\n' +
  '✅ The colors.json block and [UI_DISCOVERY_COMPLETE] are MANDATORY — discovery is not complete without them';

const DESIGN_PROMPT = BASE_PERSONA + '\n\n' +
  '## Your Current Task: GENERATE THE COMPLETE UI MOCKUP\n\n' +
  'Based on the conversation, the SRS/HLD documents, and the Design Tokens from discovery,\n' +
  'generate a **complete, production-quality, interactive HTML + CSS + JS mockup**.\n\n' +
  '**IMPORTANT: Pure HTML + CSS + vanilla JavaScript ONLY. No React, no JSX, no frameworks, no CDNs.**\n\n' +
  '### Output Format — 3 files, each in its own fenced block:\n\n' +
  F + 'html:index.html\n<!DOCTYPE html>\n<!-- COMPLETE HTML -->\n' + F + '\n\n' +
  F + 'css:styles.css\n/* COMPLETE CSS */\n' + F + '\n\n' +
  F + 'js:app.js\n// COMPLETE JS\n' + F + '\n\n' +
  '### Quality Requirements — NON-NEGOTIABLE:\n\n' +
  '**1. ALL Screens Must Be Present:**\n' +
  '   - Identify every screen from the SRS and implement ALL of them in the HTML.\n' +
  '   - Use `<section id="screen-name" class="screen">` for each screen.\n' +
  '   - Default screen is visible; others are `display: none` initially.\n' +
  '   - JS must handle navigation between ALL screens.\n\n' +
  '**2. Real Navigation:**\n' +
  '   - Add a sidebar, navbar, or tab bar appropriate to the app type.\n' +
  '   - Clicking navigation items switches the visible screen (pure JS, no page reload).\n' +
  '   - Active state is highlighted in the nav.\n\n' +
  '**3. Visual Polish — Look Like a Finished App:**\n' +
  '   - Use the design token colors via CSS custom properties.\n' +
  '   - Use Inter or system-ui as the font family.\n' +
  '   - Add hover states, focus states, and smooth transitions (0.15s ease).\n' +
  '   - Use CSS Grid and Flexbox for layouts — NO tables for layout.\n' +
  '   - Add box shadows, border radius, and appropriate spacing.\n' +
  '   - Include a realistic app header with title/logo area.\n\n' +
  '**4. Realistic Content:**\n' +
  '   - Use contextually appropriate placeholder content — NOT "Lorem ipsum".\n' +
  '   - Use domain-specific terms from the SRS (e.g., for a clock app: "12:34:56", "Set Alarm").\n' +
  '   - Tables/lists should have 3-5 rows of realistic sample data.\n\n' +
  '**5. Working Interactivity (vanilla JS):**\n' +
  '   - Screen navigation (show/hide screens).\n' +
  '   - Modal open/close (if the app has modals).\n' +
  '   - Tab switching within screens.\n' +
  '   - Form validation feedback (show error messages on invalid input).\n' +
  '   - Button click feedback (active/loading state).\n\n' +
  '**6. CSS Variables from Design Tokens:**\n' +
  '   `:root { --primary: ...; --background: ...; --surface: ...; --text: ...; ... }`\n' +
  '   Use ONLY var(--token-name) for colors — no hardcoded hex values in CSS.\n\n' +
  '**7. SVG Icons:**\n' +
  '   - Use inline SVG for icons. No icon font CDN.\n' +
  '   - Common icons: hamburger menu (3 lines), close (×), settings (⚙), search (🔍 shape).\n\n' +
  '**8. Responsive:**\n' +
  '   - Add media queries at `@media (max-width: 768px)` minimum.\n' +
  '   - Sidebar collapses to top nav on mobile.\n\n' +
  '### File Rules:\n' +
  '- index.html links to styles.css and app.js (relative paths, no CDN).\n' +
  '- styles.css defines ALL styles — no style attributes in HTML except debugging.\n' +
  '- app.js uses `addEventListener` — no onclick= in HTML.\n' +
  '- Output COMPLETE files, not snippets.';

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
 * Looks for fenced code blocks tagged html:, css:, js:, jsx:, tsx: with filenames.
 * Also extracts json:colors.json for design tokens.
 *
 * For each named file block (e.g., ```html:index.html), finds the LAST ``` on its
 * own line within the block's search space — same strategy as _extractFencedBlock
 * in architectAgent.js — to correctly handle any internal code comments with ```.
 *
 * Returns { components: [{ filename, content }], designTokens }
 */
export function parseUIDesignerOutput(text) {
  const result = { components: [], designTokens: null };

  // Extract html/css/js/jsx/tsx file blocks using tag:filename format
  // Strategy: find each opening fence, then find the LAST ``` before the next opening fence
  const BT = String.fromCharCode(96); // backtick
  const fence = BT + BT + BT;

  // Find all opening fences with filename tags
  const openingPattern = new RegExp(fence + '(?:html|css|js|jsx|tsx):([^\\n' + BT + ']+)\\n', 'g');
  let openMatch;
  const openings = []; // { index, filenameEnd, filename }

  while ((openMatch = openingPattern.exec(text)) !== null) {
    const filename = openMatch[1].trim();
    if (filename) {
      openings.push({
        index: openMatch.index,
        contentStart: openMatch.index + openMatch[0].length,
        filename,
      });
    }
  }

  for (let o = 0; o < openings.length; o++) {
    const { contentStart, filename } = openings[o];
    // Search space ends at start of next opening fence (if any), or end of text
    const searchEnd = o + 1 < openings.length ? openings[o + 1].index : text.length;
    const searchSpace = text.slice(contentStart, searchEnd);

    // Find the LAST ``` on its own line in the search space — that is the closing fence
    const lines = searchSpace.split('\n');
    let closingIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === fence) { closingIdx = i; break; }
    }

    const content = closingIdx === -1
      ? searchSpace.trim()
      : lines.slice(0, closingIdx).join('\n').trim();

    if (content) {
      result.components.push({ filename, content });
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

  log.info('parseUIDesignerOutput', 'Parsed output', {
    componentCount: result.components.length,
    filenames: result.components.map(c => c.filename),
    hasDesignTokens: !!result.designTokens,
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
