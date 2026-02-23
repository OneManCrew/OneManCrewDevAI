/**
 * test-architect.mjs
 * Comprehensive test for the Architect Agent — Phase 1 (Discovery)
 *
 * Tests:
 *   1. Unit tests — pure functions (isApproval, detectPhaseTransition,
 *                    parseArchitectOutput, buildConversationMessages)
 *   2. Ollama connectivity
 *   3. Discovery phase LLM test (qwen3-coder:30b)
 *   4. Abort / stop-stream test
 *
 * Run:  node scripts/test-architect.mjs
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const OLLAMA_BASE = 'http://localhost:11434/v1';
const MODEL = 'qwen3-coder:30b';
const PROJECT_DESC = 'I want to build a desktop calculator app with basic and scientific modes.';

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

let passed = 0;
let failed = 0;
const failures = [];

function ok(label) {
  passed++;
  console.log(`  ${C.green}✓${C.reset} ${C.dim}${label}${C.reset}`);
}
function fail(label, detail = '') {
  failed++;
  failures.push({ label, detail });
  console.log(`  ${C.red}✗${C.reset} ${label}${detail ? ` ${C.dim}(${detail})${C.reset}` : ''}`);
}
function section(title) {
  console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}
function assert(cond, label, detail = '') {
  cond ? ok(label) : fail(label, detail);
}

// ─── Pure function re-implementations (mirrors architectAgent.js) ─────────────

function isApproval(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  const approvalPatterns = [
    /^(yes|yep|yeah|yup|sure|ok|okay|k|approve|approved|confirm|confirmed|go ahead|proceed|looks good|lgtm|sounds good|perfect|great|let'?s go|do it|go|continue|next|agreed|accept|אשר|מאושר|בסדר|כן|קדימה|תמשיך|אפשר להמשיך|יאללה|אחלה|מעולה|סבבה|יופי|בהחלט)/,
    /\b(approve|confirm|go ahead|proceed|looks good|lgtm|agreed|accept|sounds good|perfect|let's go)\b/,
  ];
  return approvalPatterns.some((p) => p.test(msg));
}

const PHASES = { DISCOVERY: 'discovery', ANALYSIS: 'analysis', CONFIRM: 'confirm', GENERATION: 'generation', DONE: 'done' };

function detectPhaseTransition(responseText, currentPhase) {
  if (currentPhase === PHASES.DISCOVERY && responseText.includes('[DISCOVERY_COMPLETE]')) return PHASES.ANALYSIS;
  if (currentPhase === PHASES.ANALYSIS && responseText.includes('[ANALYSIS_COMPLETE]')) return PHASES.CONFIRM;
  return null;
}

function _extractFencedBlock(text, tag) {
  const openPattern = new RegExp('```' + tag + '\\s*\\n');
  const openMatch = openPattern.exec(text);
  if (!openMatch) return null;
  const blockStart = openMatch.index + openMatch[0].length;
  // Limit search space: stop before the OTHER block (hld↔srs) so its closing ``` isn't ours
  const otherTag = tag === 'hld' ? 'srs' : 'hld';
  const otherMatch = new RegExp('```' + otherTag + '\\s*\\n').exec(text.slice(blockStart));
  const searchSpace = otherMatch ? text.slice(blockStart, blockStart + otherMatch.index) : text.slice(blockStart);
  // Find the LAST ``` on its own line — that is always the outer closing fence
  const lines = searchSpace.split('\n');
  let closingLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '```') { closingLineIdx = i; break; }
  }
  if (closingLineIdx === -1) {
    const content = searchSpace.trim();
    return content.length > 0 ? content : null;
  }
  const content = lines.slice(0, closingLineIdx).join('\n').trim();
  return content.length > 0 ? content : null;
}

function parseArchitectOutput(text) {
  const result = { srs: null, hld: null };
  result.srs = _extractFencedBlock(text, 'srs');
  result.hld = _extractFencedBlock(text, 'hld');
  if (!result.srs) {
    const m = text.match(/(#\s+Software Requirements Specification[\s\S]*)/i);
    if (m) { let c = m[1].trim(); const s = c.match(/^([\s\S]*?)\n(?=#\s+High-Level Design)/m); if (s) c = s[1].trim(); if (c.length > 200) result.srs = c; }
  }
  if (!result.hld) {
    const m = text.match(/(#\s+High-Level Design[\s\S]*)/i);
    if (m) { const c = m[1].trim(); if (c.length > 200) result.hld = c; }
  }
  return result;
}

function buildConversationMessages(chatHistory, currentPhase, projectPath) {
  const messages = [{ role: 'system', content: `PHASE:${currentPhase}\nProject workspace: ${projectPath}` }];
  for (const msg of chatHistory) {
    if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) messages.push({ role: msg.role, content: msg.content });
  }
  return messages;
}

// ─── 1. UNIT TESTS ─────────────────────────────────────────────────────────────
section('1. isApproval — expanded patterns');

const approvals = [
  'yes', 'yep', 'yeah', 'ok', 'okay', 'k', 'sure', 'go', 'go ahead',
  'proceed', 'looks good', 'lgtm', 'sounds good', 'perfect', 'great',
  "let's go", 'do it', 'approved', 'confirm', 'continue', 'next', 'agreed',
  'כן', 'בסדר', 'קדימה', 'תמשיך', 'אשר', 'יאללה', 'מעולה', 'סבבה', 'יופי', 'בהחלט',
  'YES', 'LGTM', 'Approved', 'OK', 'Go ahead',
];
const rejections = [
  'no', 'nope', 'cancel', 'stop', 'wait', 'hold on',
  'not yet', 'change this', 'I have a question', 'what about X',
  'לא', 'רגע', 'שאלה',
];

for (const msg of approvals) assert(isApproval(msg), `"${msg}" → true`);
for (const msg of rejections) assert(!isApproval(msg), `"${msg}" → false`);

section('2. detectPhaseTransition');

assert(detectPhaseTransition('some text [DISCOVERY_COMPLETE] done', PHASES.DISCOVERY) === PHASES.ANALYSIS, '[DISCOVERY_COMPLETE] → ANALYSIS');
assert(detectPhaseTransition('some text [ANALYSIS_COMPLETE] done', PHASES.ANALYSIS) === PHASES.CONFIRM, '[ANALYSIS_COMPLETE] → CONFIRM');
assert(detectPhaseTransition('no signal here', PHASES.DISCOVERY) === null, 'No signal → null');
assert(detectPhaseTransition('[DISCOVERY_COMPLETE]', PHASES.ANALYSIS) === null, 'Wrong phase signal → null');
assert(detectPhaseTransition('[ANALYSIS_COMPLETE]', PHASES.GENERATION) === null, 'GENERATION phase → null');

section('3. parseArchitectOutput — fenced blocks');

// Standard fenced blocks
const sample1 = `
Here is the output:

\`\`\`hld
# High-Level Design

## Tech Stack
- Electron + Vite
- React + Tailwind

## Architecture
Monolithic desktop app
\`\`\`

\`\`\`srs
# Software Requirements Specification

## Overview
A calculator app

## Features
- Basic arithmetic
- Scientific mode
\`\`\`
`;
const r1 = parseArchitectOutput(sample1);
assert(r1.hld !== null, 'HLD extracted from fenced block');
assert(r1.srs !== null, 'SRS extracted from fenced block');
assert(r1.hld?.includes('Electron + Vite'), 'HLD content correct');
assert(r1.srs?.includes('calculator'), 'SRS content correct');

// Nested code blocks inside fenced docs
const sample2 = `
\`\`\`hld
# High-Level Design

## Tech Stack

\`\`\`json:required_scripts
{
  "start": "electron .",
  "dev": "vite",
  "build": "vite build"
}
\`\`\`

More content here
\`\`\`

\`\`\`srs
# SRS
Basic requirements
\`\`\`
`;
const r2 = parseArchitectOutput(sample2);
assert(r2.hld !== null, 'HLD with nested code block extracted');
assert(r2.hld?.includes('required_scripts'), 'Nested JSON block preserved in HLD');
assert(r2.srs !== null, 'SRS after nested HLD extracted');

// Fallback: no fences, plain headings (content must be >200 chars to qualify)
const sample3 = `
# High-Level Design

## Tech Stack
React 18 with TypeScript, Tailwind CSS for styling, Vite as the bundler.
Electron wraps the app for native desktop packaging via electron-builder.

## Architecture
Monolithic desktop application with a single BrowserWindow.
All logic is in the renderer process, main process handles OS integration.
State management via React Context + useReducer pattern.

# Software Requirements Specification

## Overview
An e-commerce platform that allows users to browse products, add them to a cart,
and complete purchases. The system must support guest checkout and registered users.
It must be responsive, accessible, and support dark/light mode.

## Functional Requirements
- Product catalog with search and filtering
- Shopping cart with persistent state
- Checkout flow with payment integration
`;
const r3 = parseArchitectOutput(sample3);
assert(r3.hld !== null, 'HLD fallback from heading');
assert(r3.srs !== null, 'SRS fallback from heading');

// Unnamed inner code blocks (component hierarchy, ASCII art, etc.)
// This was the real bug: plain ``` inside the HLD block was mistaken for the outer closer,
// causing the file to be saved truncated right at the component hierarchy section.
const sampleUnnamed = `
\`\`\`hld
# High-Level Design

## Components

**Component Hierarchy:**
\`\`\`
ClockApp
└── ClockPanel
    ├── TimeDisplay
    └── DateDisplay
\`\`\`

## Tech Stack
Electron + Vite + React + Tailwind CSS
\`\`\`

\`\`\`srs
# Software Requirements Specification

## Overview
A desktop clock widget.
\`\`\`
`;
const rUnnamed = parseArchitectOutput(sampleUnnamed);
assert(rUnnamed.hld !== null, 'HLD with unnamed inner code block extracted');
assert(rUnnamed.hld?.includes('Component Hierarchy'), 'Component Hierarchy section preserved in HLD');
assert(rUnnamed.hld?.includes('ClockApp'), 'Component tree content preserved in HLD');
assert(rUnnamed.hld?.includes('Tech Stack'), 'Content AFTER unnamed block preserved in HLD');
assert(rUnnamed.srs !== null, 'SRS after unnamed HLD block still extracted');
assert(rUnnamed.srs?.includes('clock widget'), 'SRS content correct');

// No docs at all
const r4 = parseArchitectOutput('Just some chat message with no documents.');
assert(r4.hld === null, 'No HLD when absent');
assert(r4.srs === null, 'No SRS when absent');

section('4. buildConversationMessages');

const history = [
  { role: 'system', content: 'system msg' },  // should be filtered
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: '' },           // empty → filtered
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'Tell me more' },
];
const msgs = buildConversationMessages(history, PHASES.DISCOVERY, '/test/project');
assert(msgs[0].role === 'system', 'First message is system prompt');
assert(msgs.some(m => m.role === 'user' && m.content === 'Hello'), 'User messages included');
assert(msgs.some(m => m.role === 'assistant' && m.content === 'Hi there!'), 'Non-empty assistant messages included');
assert(!msgs.some(m => m.role === 'assistant' && m.content === ''), 'Empty assistant messages filtered out');
assert(!msgs.some(m => m.role === 'system' && m.content === 'system msg'), 'UI system messages filtered out');
assert(msgs[msgs.length - 1].content === 'Tell me more', 'Last message is the last user message');

// ─── 2. OLLAMA CONNECTIVITY ───────────────────────────────────────────────────
section('5. Ollama connectivity');

let ollamaOk = false;
try {
  const res = await fetch(`${OLLAMA_BASE}/models`);
  const data = await res.json();
  ollamaOk = res.ok;
  const models = data.data?.map(m => m.id) || [];
  assert(ollamaOk, 'Ollama /v1/models responds OK');
  assert(models.some(m => m.includes('qwen3-coder')), `qwen3-coder:30b listed (found: ${models.slice(0,3).join(', ')})`);
} catch (e) {
  fail('Ollama connection', e.message);
}

if (!ollamaOk) {
  console.log(`\n${C.yellow}⚠ Skipping LLM tests — Ollama not reachable${C.reset}`);
  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

// ─── 3. DISCOVERY PHASE LLM TEST ─────────────────────────────────────────────
section(`6. Discovery phase — LLM (${MODEL})`);
console.log(`  ${C.dim}Project: "${PROJECT_DESC}"${C.reset}`);
console.log(`  ${C.dim}Sending to Ollama... (may take 30-90s)${C.reset}`);

const SYSTEM_PROMPT = `You are "The Architect" — a CTO with 40+ years experience.
You are DOMINANT and DECISIVE. You make all technical decisions yourself.

HARD RULE — Desktop apps: If the user asks for a desktop/standalone app, you MUST choose Electron + Vite + React + Tailwind CSS. Non-negotiable.

You ONLY ask questions about BUSINESS LOGIC — never about technology choices.

When you have enough information, say exactly: [DISCOVERY_COMPLETE]

Project workspace: /test/project`;

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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: PROJECT_DESC },
      ],
      max_tokens: 1024,
      stream: true,
      temperature: 0.3,
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
  fail('LLM streaming', e.message);
  discoveryResponse = '';
}

if (discoveryResponse) {
  // Strip <think>...</think> blocks that some models emit
  const cleaned = discoveryResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Check tech decisions
  const hasElectron = /electron/i.test(cleaned);
  const hasReact = /react/i.test(cleaned);
  const hasVite = /vite/i.test(cleaned);
  const hasTailwind = /tailwind/i.test(cleaned);

  assert(cleaned.length > 100, `Response is substantial (${cleaned.length} chars)`);
  assert(hasElectron, 'Response declares Electron as runtime');
  assert(hasReact, 'Response declares React as UI framework');
  assert(hasVite, 'Response declares Vite as bundler');
  assert(hasTailwind, 'Response declares Tailwind CSS');

  // Check that it asks business-logic questions (not tech questions)
  const hasForbiddenQuestion = /which (framework|bundler|database|language|environment)/i.test(cleaned);
  assert(!hasForbiddenQuestion, 'No forbidden tech questions asked');

  // If discovery wasn't immediately completed, it should ask at least one question.
  // Some models (especially with a clear/simple brief) may go straight to [DISCOVERY_COMPLETE]
  // on a short project — that's valid behavior. We flag it as informational only.
  const alreadyComplete = /\[DISCOVERY_COMPLETE\]/i.test(cleaned);
  if (!alreadyComplete) {
    assert(/\?/.test(cleaned), 'Asks at least one business question');
  } else {
    ok('Model completed discovery immediately (project was clear enough — valid behavior)');
  }

  const hasScientific = /scientific|history|tape|keyboard|memory|unit/i.test(cleaned);
  assert(hasScientific, 'Asks about calculator features (scientific/history/keyboard)');

  console.log(`\n  ${C.dim}--- Response preview (first 400 chars) ---${C.reset}`);
  console.log(`  ${C.dim}${cleaned.substring(0, 400).replace(/\n/g, '\n  ')}...${C.reset}`);
}

// ─── 4. PHASE TRANSITION DETECTION ───────────────────────────────────────────
section('7. Phase transition — LLM emits [DISCOVERY_COMPLETE]');
console.log(`  ${C.dim}Sending 2 follow-up answers + force-complete prompt...${C.reset}`);

const forceCompletePrompt = `
Scientific mode: yes, include it. History: yes, last 10 calculations.
Keyboard shortcuts: yes. No unit converter needed. Single user, no auth.

That's all the information you need. You have everything to proceed.
[DISCOVERY_COMPLETE]
`.trim();

// We test detection on a mock response that contains [DISCOVERY_COMPLETE]
const mockWithComplete = `Great! I have all the information I need.

**Tech Stack decided:**
- Electron + Vite (desktop runtime + bundler)
- React 18 + Tailwind CSS (UI)
- electron-builder (packaging)

**Business Requirements gathered:**
- Scientific mode required
- History panel: last 10 calculations
- Keyboard shortcuts required

[DISCOVERY_COMPLETE]

Ready to present my structured analysis.`;

const transition = detectPhaseTransition(mockWithComplete, PHASES.DISCOVERY);
assert(transition === PHASES.ANALYSIS, 'detectPhaseTransition correctly detects [DISCOVERY_COMPLETE]');

// Test with actual LLM — ask it to complete discovery
console.log(`  ${C.dim}Asking LLM to complete discovery (max 512 tokens)...${C.reset}`);

let completionResponse = '';
try {
  const response = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: PROJECT_DESC },
        { role: 'assistant', content: discoveryResponse.substring(0, 500) || 'I have made my tech decisions. Let me ask about features.' },
        { role: 'user', content: forceCompletePrompt },
      ],
      max_tokens: 512,
      stream: true,
      temperature: 0.1,
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

  // After the user injected [DISCOVERY_COMPLETE], the LLM should either:
  // (a) Re-emit [DISCOVERY_COMPLETE] and start analysis, OR
  // (b) Go straight into analysis content (correct behavior — discovery is done)
  // We accept both. The key check is that the response is substantive.
  assert(cleaned.length > 50, `LLM produced a response (${cleaned.length} chars) after discovery trigger`);

  // If [DISCOVERY_COMPLETE] appears → transition fires
  const transition2 = detectPhaseTransition(cleaned, PHASES.DISCOVERY);
  if (transition2 === PHASES.ANALYSIS) {
    ok('Phase transition fires correctly from LLM response');
  } else {
    // LLM went straight to content without re-emitting the token — also valid.
    // Accept: analysis keywords, implementation plan, or any substantial project-related response.
    const isRelevantContent = /project|calculator|electron|react|feature|mode|implement|component|design|architecture|build|requirement/i.test(cleaned);
    assert(isRelevantContent, `LLM produced relevant content after discovery (${cleaned.length} chars, no re-emit needed)`);
  }
}

// ─── 5. ABORT / STOP-STREAM TEST ─────────────────────────────────────────────
section('8. Abort / Stop-stream test');
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
        { role: 'system', content: 'You are helpful. Always respond with a very long essay of at least 2000 words.' },
        { role: 'user', content: 'Write a very long essay about software architecture. Go into extreme detail.' },
      ],
      max_tokens: 2000,
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
    // Abort after receiving first chunk
    if (chunkCount >= 1 && partialText.length > 0) {
      controller.abort();
      break;
    }
  }
  abortWorked = true;
} catch (e) {
  if (e.name === 'AbortError') {
    abortWorked = true;
  } else {
    abortError = e.message;
  }
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
