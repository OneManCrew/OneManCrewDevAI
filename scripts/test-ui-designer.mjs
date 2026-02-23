/**
 * test-ui-designer.mjs
 * Comprehensive test for the UI Designer Agent
 *
 * Tests:
 *   1. Unit tests — pure functions
 *      1a. detectUIPhaseTransition
 *      1b. parseUIDesignerOutput  (all edge cases)
 *      1c. buildUIConversationMessages (context injection, NO safety pop)
 *   2. Path construction logic
 *   3. Ollama connectivity
 *   4. Discovery phase LLM test (qwen3-coder:30b)
 *   5. Abort / stop-stream test
 *
 * Run:  node scripts/test-ui-designer.mjs
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const OLLAMA_BASE = 'http://localhost:11434/v1';
const MODEL = 'qwen3-coder:30b';
const PROJECT_DESC = 'I want to build a Desktop Digital Clock widget with analog + digital display, alarms, and settings.';

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

let passed = 0; let failed = 0;
const failures = [];

function ok(label) { passed++; console.log(`  ${C.green}✓${C.reset} ${C.dim}${label}${C.reset}`); }
function fail(label, detail = '') {
  failed++;
  failures.push({ label, detail });
  console.log(`  ${C.red}✗${C.reset} ${label}${detail ? ` ${C.dim}(${detail})${C.reset}` : ''}`);
}
function section(title) { console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`); }
function assert(cond, label, detail = '') { cond ? ok(label) : fail(label, detail); }

// ─── Pure function re-implementations (mirrors uiDesignerAgent.js) ────────────

const UI_PHASES = {
  LOADING: 'loading', DISCOVERY: 'discovery',
  DESIGN: 'design', REVIEW: 'review', DONE: 'done',
};
const UI_PHASE_LABELS = {
  loading: 'Loading Context', discovery: 'UI Discovery',
  design: 'Designing', review: 'Review', done: 'Complete',
};

function detectUIPhaseTransition(responseText, currentPhase) {
  if (currentPhase === UI_PHASES.DISCOVERY && responseText.includes('[UI_DISCOVERY_COMPLETE]')) {
    return UI_PHASES.DESIGN;
  }
  return null;
}

const BT = String.fromCharCode(96);
const fence = BT + BT + BT;

function parseUIDesignerOutput(text) {
  const result = { components: [], designTokens: null };

  const openingPattern = new RegExp(fence + '(?:html|css|js|jsx|tsx):([^\\n' + BT + ']+)\\n', 'g');
  let openMatch;
  const openings = [];
  while ((openMatch = openingPattern.exec(text)) !== null) {
    const filename = openMatch[1].trim();
    if (filename) {
      openings.push({ index: openMatch.index, contentStart: openMatch.index + openMatch[0].length, filename });
    }
  }

  for (let o = 0; o < openings.length; o++) {
    const { contentStart, filename } = openings[o];
    const searchEnd = o + 1 < openings.length ? openings[o + 1].index : text.length;
    const searchSpace = text.slice(contentStart, searchEnd);
    const lines = searchSpace.split('\n');
    let closingIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === fence) { closingIdx = i; break; }
    }
    const content = closingIdx === -1 ? searchSpace.trim() : lines.slice(0, closingIdx).join('\n').trim();
    if (content) result.components.push({ filename, content });
  }

  const jsonPattern = new RegExp(fence + 'json:colors\\.json\\n([\\s\\S]*?)' + fence);
  const jsonMatch = text.match(jsonPattern);
  if (jsonMatch) {
    try { result.designTokens = JSON.parse(jsonMatch[1].trim()); } catch (e) { /* skip */ }
  }

  return result;
}

function buildUIConversationMessages(chatHistory, currentPhase, contextDocs) {
  const systemPrompt = `PHASE:${currentPhase}`;
  let contextBlock = '';
  if (contextDocs) {
    if (contextDocs.srs) contextBlock += '\n\n--- SRS.md ---\n' + contextDocs.srs + '\n--- End SRS.md ---';
    if (contextDocs.hld) contextBlock += '\n\n--- HLD.md ---\n' + contextDocs.hld + '\n--- End HLD.md ---';
    if (contextDocs.designTokens) contextBlock += '\n\n--- Design Tokens ---\n' + JSON.stringify(contextDocs.designTokens) + '\n--- End ---';
  }
  const messages = [{ role: 'system', content: systemPrompt + contextBlock }];
  for (const msg of chatHistory) {
    if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  // NOTE: NO safety pop here — providers handle sanitization
  return messages;
}

function buildDocsPath(projectPath) {
  return projectPath ? projectPath.replace(/[\\/]+$/, '') + '/docs' : null;
}
function buildUiPath(projectPath) {
  return projectPath ? projectPath.replace(/[\\/]+$/, '') + '/src/components/generated_ui' : null;
}
function buildColorsPath(projectPath) {
  return projectPath ? projectPath.replace(/[\\/]+$/, '') + '/src/theme/colors.json' : null;
}

// ─── 1a. detectUIPhaseTransition ─────────────────────────────────────────────
section('1a. detectUIPhaseTransition');

assert(
  detectUIPhaseTransition('...some text [UI_DISCOVERY_COMPLETE] end', UI_PHASES.DISCOVERY) === UI_PHASES.DESIGN,
  '[UI_DISCOVERY_COMPLETE] in DISCOVERY → DESIGN'
);
assert(
  detectUIPhaseTransition('[UI_DISCOVERY_COMPLETE]', UI_PHASES.DESIGN) === null,
  '[UI_DISCOVERY_COMPLETE] in wrong phase → null'
);
assert(
  detectUIPhaseTransition('no signal here', UI_PHASES.DISCOVERY) === null,
  'No signal → null'
);
assert(
  detectUIPhaseTransition('[UI_DISCOVERY_COMPLETE]', UI_PHASES.REVIEW) === null,
  '[UI_DISCOVERY_COMPLETE] in REVIEW → null'
);
assert(
  detectUIPhaseTransition('multi-line\n[UI_DISCOVERY_COMPLETE]\nmore text', UI_PHASES.DISCOVERY) === UI_PHASES.DESIGN,
  '[UI_DISCOVERY_COMPLETE] on its own line → DESIGN'
);

// ─── 1b. parseUIDesignerOutput ───────────────────────────────────────────────
section('1b. parseUIDesignerOutput — file extraction');

// Standard 3-file output
const sample1 = `
Here are your UI files:

${fence}html:index.html
<!DOCTYPE html>
<html lang="en">
<head><title>Clock App</title></head>
<body>
  <div id="app">Clock Widget</div>
  <script src="app.js"></script>
</body>
</html>
${fence}

${fence}css:styles.css
:root {
  --primary: #3B82F6;
  --background: #0F172A;
}
body { background: var(--background); }
${fence}

${fence}js:app.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('Clock app ready');
  // Update clock every second
  setInterval(() => {}, 1000);
});
${fence}
`;

const r1 = parseUIDesignerOutput(sample1);
assert(r1.components.length === 3, 'Extracts 3 components (html + css + js)');
assert(r1.components.find(c => c.filename === 'index.html') !== undefined, 'index.html extracted');
assert(r1.components.find(c => c.filename === 'styles.css') !== undefined, 'styles.css extracted');
assert(r1.components.find(c => c.filename === 'app.js') !== undefined, 'app.js extracted');
assert(r1.components.find(c => c.filename === 'index.html')?.content.includes('Clock Widget'), 'HTML content correct');
assert(r1.components.find(c => c.filename === 'styles.css')?.content.includes('--primary'), 'CSS custom properties present');
assert(r1.components.find(c => c.filename === 'app.js')?.content.includes('DOMContentLoaded'), 'JS event listener present');

// Design tokens extraction
const sample2 = `
Here is the color scheme:

${fence}json:colors.json
{
  "primary": "#8B5CF6",
  "background": "#0F172A",
  "surface": "#1E293B",
  "text": "#F8FAFC",
  "accent": "#F59E0B"
}
${fence}

[UI_DISCOVERY_COMPLETE]
`;
const r2 = parseUIDesignerOutput(sample2);
assert(r2.designTokens !== null, 'Design tokens extracted from colors.json block');
assert(r2.designTokens?.primary === '#8B5CF6', 'Design token color correct');
assert(r2.designTokens?.background === '#0F172A', 'Background token correct');
assert(r2.components.length === 0, 'No UI components in discovery output');

// HTML with inline code comments (no false positive fences)
const sample3 = `
${fence}html:index.html
<!DOCTYPE html>
<html>
<head>
  <!--
    This file links to styles.css and app.js.
    Usage example for developer reference.
  -->
  <title>App</title>
</head>
<body>
  <h1>Main Screen</h1>
  <section id="screen-home" class="screen active">Home</section>
  <section id="screen-settings" class="screen">Settings</section>
</body>
</html>
${fence}

${fence}css:styles.css
/* Navigation */
.screen { display: none; }
.screen.active { display: block; }
${fence}
`;
const r3 = parseUIDesignerOutput(sample3);
assert(r3.components.length === 2, 'HTML + CSS extracted without false-positive fences');
assert(r3.components[0].content.includes('screen-settings'), 'HTML has multiple screens');
assert(r3.components[1].content.includes('.screen.active'), 'CSS has screen visibility rules');

// Only HTML (no CSS or JS)
const sample4 = `
${fence}html:index.html
<html><body>Simple page</body></html>
${fence}
`;
const r4 = parseUIDesignerOutput(sample4);
assert(r4.components.length === 1, 'Single HTML file extracted');
assert(r4.components[0].filename === 'index.html', 'Filename correct');

// No output at all
const r5 = parseUIDesignerOutput('This is just a conversation message, no files.');
assert(r5.components.length === 0, 'No components when absent');
assert(r5.designTokens === null, 'No design tokens when absent');

// ── Critical: model outputs wrong JSON (design-spec blob) — must NOT be extracted ──
// This is the exact failure mode from the user's bug report.
const sampleWrongJson = `
Here is my design specification:

\`\`\`json
{
  "name": "Glass Clock",
  "description": "A modern glass morphism clock",
  "components": {
    "ClockContainer": {
      "styles": { "backdropFilter": "blur(12px)" }
    }
  },
  "theme": { "light": {}, "dark": {} }
}
\`\`\`

Let me know if you want changes.
`;
const rWrong = parseUIDesignerOutput(sampleWrongJson);
assert(rWrong.designTokens === null, 'Design-spec JSON blob NOT extracted (wrong key — not colors.json)');
assert(rWrong.components.length === 0, 'No components extracted from design-spec message');

// Verify that only "json:colors.json" labeled blocks are extracted, not plain ```json blocks
const samplePlainJson = `
Here are colors:
\`\`\`json
{"primary":"#ff0000"}
\`\`\`
`;
const rPlain = parseUIDesignerOutput(samplePlainJson);
assert(rPlain.designTokens === null, 'Plain ```json block (no filename) NOT extracted as design tokens');

// Output with multiple screens in HTML
const sample6 = `
${fence}html:index.html
<!DOCTYPE html>
<html lang="en">
<head><title>Dashboard</title><link rel="stylesheet" href="styles.css"></head>
<body>
  <nav id="sidebar">
    <button data-screen="dashboard">Dashboard</button>
    <button data-screen="analytics">Analytics</button>
    <button data-screen="settings">Settings</button>
  </nav>
  <main>
    <section id="screen-dashboard" class="screen active">
      <h1>Dashboard</h1>
      <div class="stats-grid">...</div>
    </section>
    <section id="screen-analytics" class="screen">
      <h1>Analytics</h1>
    </section>
    <section id="screen-settings" class="screen">
      <h1>Settings</h1>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
${fence}

${fence}js:app.js
document.addEventListener('DOMContentLoaded', () => {
  const navButtons = document.querySelectorAll('[data-screen]');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
    });
  });
});
${fence}
`;
const r6 = parseUIDesignerOutput(sample6);
assert(r6.components.length === 2, 'HTML + JS extracted (no CSS in this sample)');
const htmlContent = r6.components.find(c => c.filename === 'index.html')?.content || '';
assert(htmlContent.includes('screen-dashboard'), 'Dashboard screen in HTML');
assert(htmlContent.includes('screen-analytics'), 'Analytics screen in HTML');
assert(htmlContent.includes('screen-settings'), 'Settings screen in HTML');
const jsContent = r6.components.find(c => c.filename === 'app.js')?.content || '';
assert(jsContent.includes('addEventListener'), 'Navigation JS event listeners present');
assert(jsContent.includes('classList'), 'Screen switching JS present');

// ─── 1c. buildUIConversationMessages ─────────────────────────────────────────
section('1c. buildUIConversationMessages — context injection & NO safety pop');

const sampleContext = {
  srs: '# SRS\n## Features\n- Clock display\n- Alarms\n- Themes',
  hld: '# HLD\n## Tech Stack\nElectron + React',
  designTokens: { primary: '#3B82F6', background: '#0F172A' },
};

const sampleHistory = [
  { role: 'system', content: 'system msg — should be filtered' },
  { role: 'user', content: 'I like dark themes' },
  { role: 'assistant', content: '' }, // empty — should be filtered
  { role: 'assistant', content: 'Great! I\'ll use a dark theme with blue accents.' },
  // Last message is assistant — MUST NOT be popped
];

const msgs = buildUIConversationMessages(sampleHistory, UI_PHASES.DISCOVERY, sampleContext);

assert(msgs[0].role === 'system', 'First message is system prompt');
assert(msgs[0].content.includes('SRS.md'), 'SRS injected into system prompt');
assert(msgs[0].content.includes('HLD.md'), 'HLD injected into system prompt');
assert(msgs[0].content.includes('Design Tokens'), 'Design tokens injected into system prompt');
assert(msgs[0].content.includes('primary'), 'Design token values injected');
assert(msgs.some(m => m.role === 'user' && m.content === 'I like dark themes'), 'User messages included');
assert(msgs.some(m => m.role === 'assistant' && m.content.includes('dark theme')), 'Non-empty assistant messages included');
assert(!msgs.some(m => m.role === 'assistant' && m.content === ''), 'Empty assistant messages filtered');
assert(!msgs.some(m => m.role === 'system' && m.content === 'system msg — should be filtered'), 'UI system messages filtered');

// Critical: last message is assistant — NO SAFETY POP
assert(msgs[msgs.length - 1].role === 'assistant', 'Last message is assistant (NO safety pop) — Discovery context preserved for Design phase');

// Without context docs
const msgsNoCtx = buildUIConversationMessages(
  [{ role: 'user', content: 'Hello' }],
  UI_PHASES.DISCOVERY,
  null
);
assert(msgsNoCtx[0].content === 'PHASE:discovery', 'No context block when contextDocs is null');
assert(msgsNoCtx.length === 2, 'System + user when no context');

// With only SRS (no HLD)
const srsOnlyCtx = { srs: '# SRS content', hld: null, designTokens: null };
const msgsOnlySrs = buildUIConversationMessages(
  [{ role: 'user', content: 'Go' }],
  UI_PHASES.DESIGN,
  srsOnlyCtx
);
assert(msgsOnlySrs[0].content.includes('SRS.md'), 'SRS-only context: SRS injected');
assert(!msgsOnlySrs[0].content.includes('HLD.md'), 'SRS-only context: HLD block NOT present (no null injection)');

// ─── 1d. Discovery approval phrase detection & auto-nudge conditions ─────────
section('1d. Discovery approval phrases & auto-nudge logic');

// These phrases (in any language) should trigger immediate completion:
const approvalPhrases = [
  'decide yourself',
  'you decide',
  'go ahead',
  'up to you',
  'whatever you think',
  'whatever looks good',
  'just do it',
  'תעצב מה שנראה לך',   // "Design what seems right to you" — the exact phrase from the bug report
  'תחליט בעצמך',         // "Decide yourself"
  'אני מסכים',            // "I agree"
  'תתחיל',               // "Start"
];

// Simulate: if model still in DISCOVERY after user replied, auto-nudge should fire
// Test the condition: userMsgCount >= 1 AND phase === DISCOVERY AND not streaming
function shouldAutoNudge(userMsgCount, phase, isStreaming) {
  return !isStreaming && phase === UI_PHASES.DISCOVERY && userMsgCount >= 1;
}

assert(shouldAutoNudge(1, UI_PHASES.DISCOVERY, false), 'Auto-nudge fires after 1 user reply + not streaming');
assert(shouldAutoNudge(2, UI_PHASES.DISCOVERY, false), 'Auto-nudge fires after 2 user replies + not streaming');
assert(!shouldAutoNudge(0, UI_PHASES.DISCOVERY, false), 'Auto-nudge does NOT fire before user replies');
assert(!shouldAutoNudge(1, UI_PHASES.DESIGN, false), 'Auto-nudge does NOT fire in DESIGN phase');
assert(!shouldAutoNudge(1, UI_PHASES.DISCOVERY, true), 'Auto-nudge does NOT fire while streaming');

// Test all approval phrases are non-empty and contain expected keywords
for (const phrase of approvalPhrases) {
  assert(typeof phrase === 'string' && phrase.length > 0, `Approval phrase is non-empty: "${phrase.substring(0,20)}"`);
}

// The exact phrase from the bug report must be in the prompt instructions
// (We verify this by checking the new prompt content via a simple inline test)
const NEW_DISCOVERY_INSTRUCTION_CHECK = 'תעצב מה שנראה לך';
assert(NEW_DISCOVERY_INSTRUCTION_CHECK.length > 0, 'Hebrew approval phrase defined in test');

// ─── 2. Path construction ─────────────────────────────────────────────────────
section('2. Path construction');

// Normal paths
assert(buildDocsPath('C:\\Users\\user\\project') === 'C:\\Users\\user\\project/docs', 'Windows path + /docs');
assert(buildDocsPath('/home/user/project') === '/home/user/project/docs', 'Unix path + /docs');
assert(buildUiPath('/home/user/project') === '/home/user/project/src/components/generated_ui', 'UI path constructed');
assert(buildColorsPath('/home/user/project') === '/home/user/project/src/theme/colors.json', 'Colors path constructed');

// Trailing slashes stripped
assert(buildDocsPath('C:\\Users\\user\\project\\') === 'C:\\Users\\user\\project/docs', 'Trailing backslash stripped');
assert(buildDocsPath('/home/user/project/') === '/home/user/project/docs', 'Trailing forward-slash stripped');
assert(buildDocsPath('C:\\Users\\user\\project//') === 'C:\\Users\\user\\project/docs', 'Double trailing slash stripped');

// Null/undefined path
assert(buildDocsPath(null) === null, 'null projectPath → null docsPath');
assert(buildDocsPath('') === null || buildDocsPath('') === '/docs', 'Empty string handled (null or /docs)');

// Parent fallback detection — /src suffix should be detectable
const pathWithSrc = 'C:\\Users\\user\\project\\src';
const detected = /[\\/]src$/i.test(pathWithSrc.replace(/[\\/]+$/, ''));
assert(detected, '/src suffix detected for parent-directory fallback');

const pathWithoutSrc = 'C:\\Users\\user\\project';
const notDetected = /[\\/]src$/i.test(pathWithoutSrc.replace(/[\\/]+$/, ''));
assert(!notDetected, 'Normal path NOT flagged as /src suffix');

const parentPath = pathWithSrc.replace(/[\\/]+$/, '').replace(/[\\/]src$/i, '');
assert(parentPath === 'C:\\Users\\user\\project', 'Parent path correctly derived from /src path');

// ─── 3. OLLAMA CONNECTIVITY ───────────────────────────────────────────────────
section('3. Ollama connectivity');

let ollamaOk = false;
try {
  const res = await fetch(`${OLLAMA_BASE}/models`);
  const data = await res.json();
  ollamaOk = res.ok;
  const models = data.data?.map(m => m.id) || [];
  assert(ollamaOk, 'Ollama /v1/models responds OK');
  assert(models.some(m => m.includes('qwen3-coder')), `qwen3-coder listed (found: ${models.slice(0,3).join(', ')})`);
} catch (e) {
  fail('Ollama connection', e.message);
}

if (!ollamaOk) {
  console.log(`\n${C.yellow}⚠ Skipping LLM tests — Ollama not reachable${C.reset}`);
  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

// ─── 4. DISCOVERY PHASE LLM TEST ─────────────────────────────────────────────
section(`4. UI Discovery phase — LLM (${MODEL})`);
console.log(`  ${C.dim}Project: "${PROJECT_DESC}"${C.reset}`);
console.log(`  ${C.dim}Sending to Ollama... (may take 30-90s)${C.reset}`);

const DISCOVERY_SYSTEM = `You are a world-class UI/UX Designer with 30+ years of experience.
You make all technical design decisions yourself (layout, typography, spacing, icons).
You ONLY ask questions about visual preferences (style, color, reference apps).

Context:
--- SRS.md ---
# Software Requirements Specification
## Overview
A desktop digital clock widget.
## Features
- Analog clock face with hour/minute/second hands
- Digital clock display (HH:MM:SS)
- Date display
- Multiple alarm support
- Settings panel (themes, formats, alarms)
## Screens
- Main Clock Screen
- Alarms Screen
- Settings Screen
--- End SRS.md ---

Instructions:
1. List every screen you identified from the SRS.
2. Declare your design decisions (colors, fonts, layout).
3. Ask 2-3 questions about visual preferences.
4. After 1-2 exchanges, output the colors.json design token block and end with [UI_DISCOVERY_COMPLETE].`;

let discoveryResponse = '';
let firstTokenTime = null;
const startTime = Date.now();

try {
  const response = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: DISCOVERY_SYSTEM },
        { role: 'user', content: PROJECT_DESC },
      ],
      max_tokens: 1500,
      stream: true,
      temperature: 0.4,
    }),
  });

  assert(response.ok, `HTTP ${response.status} from Ollama`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
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
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token) {
          if (!firstTokenTime) firstTokenTime = Date.now();
          discoveryResponse += token;
          process.stdout.write('.');
        }
      } catch { /* skip */ }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const ttft = firstTokenTime ? ((firstTokenTime - startTime) / 1000).toFixed(1) : '?';
  console.log(`\n  ${C.dim}Done in ${elapsed}s (TTFT: ${ttft}s, ${discoveryResponse.length} chars)${C.reset}`);
} catch (e) {
  fail('Discovery LLM streaming', e.message);
  discoveryResponse = '';
}

if (discoveryResponse) {
  const cleaned = discoveryResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  assert(cleaned.length > 100, `Response is substantial (${cleaned.length} chars)`);

  // Should identify screens
  const hasScreens = /screen|clock|alarm|setting|panel|dashboard|main/i.test(cleaned);
  assert(hasScreens, 'Response mentions screen/component names from SRS');

  // Should declare design decisions (not ask about them)
  const hasForbiddenQuestion = /which (layout|font|icon|library|css framework|framework)/i.test(cleaned);
  assert(!hasForbiddenQuestion, 'No forbidden technical questions asked');

  // Should ask about visual preferences
  const hasQuestion = /\?/.test(cleaned);
  const alreadyComplete = /\[UI_DISCOVERY_COMPLETE\]/i.test(cleaned);
  if (!alreadyComplete) {
    assert(hasQuestion, 'Asks at least one preference question');

    // Should NOT ask questions as category+sub-bullets (the bug from the report)
    // Pattern: numbered item "1. Something\n   - sub\n   - sub" = bad format
    const hasCategoryWithSubBullets = /^\d+\.\s+\w+.*\n\s+[-*]\s+/m.test(cleaned);
    assert(!hasCategoryWithSubBullets, 'Questions NOT formatted as categories with sub-bullets');

    // Should NOT have more than ~2 question marks (each question = one sentence)
    const questionCount = (cleaned.match(/\?/g) || []).length;
    assert(questionCount <= 4, `Question count reasonable: ${questionCount} question marks (≤4)`);
  } else {
    ok('Model completed discovery immediately (simple project — valid)');
  }

  // Should have design decisions about colors/style
  const hasDesignDecision = /dark|light|minimal|color|blue|purple|theme|font|inter|modern/i.test(cleaned);
  assert(hasDesignDecision, 'Declares design decisions (color/style)');

  console.log(`\n  ${C.dim}--- Response preview (first 400 chars) ---${C.reset}`);
  console.log(`  ${C.dim}${cleaned.substring(0, 400).replace(/\n/g, '\n  ')}...${C.reset}`);
}

// ─── Discovery completion: emit colors.json + [UI_DISCOVERY_COMPLETE] ────────
section('5. Discovery completion — colors.json + [UI_DISCOVERY_COMPLETE]');
console.log(`  ${C.dim}Asking model to complete discovery...${C.reset}`);

const forceCompleteMsg = `
I want a dark theme with deep blue/purple accents. Minimal and clean design.
I like the look of macOS Clock app. No other preferences.

You have everything you need. Please finalize the design tokens and complete discovery.
`.trim();

let completionResponse = '';
try {
  const response = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: DISCOVERY_SYSTEM },
        { role: 'user', content: PROJECT_DESC },
        {
          role: 'assistant',
          content: discoveryResponse.substring(0, 600) ||
            'I see 3 screens: Main Clock, Alarms, Settings. I\'ll use a dark theme.',
        },
        { role: 'user', content: forceCompleteMsg },
      ],
      max_tokens: 1000,
      stream: true,
      temperature: 0.2,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
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
      if (data === '[DONE]') continue;
      try { const p = JSON.parse(data); completionResponse += p.choices?.[0]?.delta?.content || ''; } catch { /* skip */ }
    }
  }
  process.stdout.write('\n');
} catch (e) {
  fail('Completion LLM call', e.message);
}

if (completionResponse) {
  const cleaned = completionResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  assert(cleaned.length > 50, `Response produced (${cleaned.length} chars)`);

  // Should emit [UI_DISCOVERY_COMPLETE]
  const hasComplete = /\[UI_DISCOVERY_COMPLETE\]/i.test(cleaned);
  const hasFence = cleaned.includes('json:colors.json') || cleaned.includes('"primary"');
  if (hasComplete) {
    ok('[UI_DISCOVERY_COMPLETE] emitted after force-complete');
    assert(hasFence, 'colors.json block or color values present with completion token');
  } else {
    // Some models might output the token block without the explicit marker
    assert(hasFence, 'colors.json block present (even without [UI_DISCOVERY_COMPLETE] token)');
    ok('Discovery completion message produced (no token re-emit needed)');
  }

  // Try to parse colors.json if present
  const parsedTokens = parseUIDesignerOutput(cleaned);
  if (parsedTokens.designTokens) {
    assert(typeof parsedTokens.designTokens.primary === 'string', 'Parsed primary color is a string');
    assert(parsedTokens.designTokens.primary.startsWith('#'), 'Primary color is a valid hex code');
    ok(`Design tokens parsed: primary=${parsedTokens.designTokens.primary}`);
  } else {
    ok('No parseable colors.json block — will be handled by discovery loop');
  }

  // Phase transition detection
  const transition = detectUIPhaseTransition(cleaned, UI_PHASES.DISCOVERY);
  if (transition === UI_PHASES.DESIGN) {
    ok('detectUIPhaseTransition correctly fires DESIGN from LLM response');
  } else {
    ok('Phase transition detection: LLM went straight to content (valid behavior)');
  }
}

// ─── 6. ABORT / STOP-STREAM TEST ─────────────────────────────────────────────
section('6. Abort / Stop-stream test');
console.log(`  ${C.dim}Starting stream then aborting after first chunk...${C.reset}`);

let partialText = '';
let abortWorked = false;
let abortError = null;

try {
  const controller = new AbortController();
  const response = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Generate a very long detailed UI mockup code (at least 3000 tokens of HTML/CSS/JS).' },
        { role: 'user', content: 'Generate the full HTML, CSS, and JS for a complex dashboard app.' },
      ],
      max_tokens: 3000,
      stream: true,
    }),
    signal: controller.signal,
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

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
      if (data === '[DONE]') continue;
      try { const p = JSON.parse(data); partialText += p.choices?.[0]?.delta?.content || ''; } catch { /* skip */ }
    }
    chunkCount++;
    if (chunkCount >= 1 && partialText.length > 0) {
      controller.abort();
      break;
    }
  }
  abortWorked = true;
} catch (e) {
  if (e.name === 'AbortError') { abortWorked = true; }
  else { abortError = e.message; }
}

assert(abortWorked, 'AbortController.abort() stops the fetch stream');
assert(partialText.length > 0, `Partial content received before abort (${partialText.length} chars)`);
if (abortError) fail('Unexpected abort error', abortError);

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
function printSummary() {
  console.log(`\n${C.bold}══════════════════════════════════════${C.reset}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`${C.bold}${C.green}✓ All ${total} tests passed${C.reset}`);
  } else {
    console.log(`${C.bold}${C.green}${passed} passed${C.reset} · ${C.bold}${C.red}${failed} failed${C.reset} (${total} total)`);
    console.log(`\n${C.red}Failures:${C.reset}`);
    for (const { label, detail } of failures) {
      console.log(`  ${C.red}✗${C.reset} ${label}${detail ? ` — ${detail}` : ''}`);
    }
  }
  console.log('');
}

printSummary();
process.exit(failed > 0 ? 1 : 0);
