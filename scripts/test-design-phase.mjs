/**
 * test-design-phase.mjs
 * Full integration test for the UI Designer — DESIGN phase
 *
 * Tests:
 *   1. Unit — parseUIDesignerOutput (2-pass parser: named + unnamed fallback)
 *   2. LLM  — DESIGN phase with real SRS+HLD from workspace
 *             Validates HTML, CSS, JS quality
 *   3. Save — writes generated files to workspace for manual preview
 *
 * Run:  node scripts/test-design-phase.mjs
 *
 * Workspace: C:\Users\levid\OneDrive\Desktop\AI\בית כנסת
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────
const OLLAMA_BASE   = 'http://localhost:11434/v1';
const MODEL         = 'qwen3-coder:30b';
const WORKSPACE     = 'C:/Users/levid/OneDrive/Desktop/AI/בית כנסת';
const SRS_PATH      = `${WORKSPACE}/docs/SRS.md`;
const HLD_PATH      = `${WORKSPACE}/docs/HLD.md`;
const COLORS_PATH   = `${WORKSPACE}/src/theme/colors.json`;
const OUTPUT_DIR    = `${WORKSPACE}/src/components/generated_ui`;
const MAX_TOKENS    = 32000;     // qwen3-coder:30b can handle this
const TIMEOUT_MS    = 600_000;   // 10 minutes — generous for large output

// Expected screens (from SRS)
const EXPECTED_SCREENS = [
  'prayer',       // Prayer Times
  'torah',        // Torah Study Sessions
  'memorial',     // Memorial / Yahrzeits
  'donation',     // Donation
  'announcement', // Announcements
  'admin',        // Admin Login / Dashboard
];

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
  magenta: '\x1b[35m', blue: '\x1b[34m',
};

let passed = 0, failed = 0;
const failures = [];

function ok(label)  { passed++; console.log(`  ${C.green}✓${C.reset} ${C.dim}${label}${C.reset}`); }
function fail(label, detail = '') {
  failed++;
  failures.push({ label, detail });
  console.log(`  ${C.red}✗${C.reset} ${label}${detail ? `\n    ${C.dim}↳ ${detail}${C.reset}` : ''}`);
}
function section(title) { console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`); }
function info(msg)  { console.log(`  ${C.dim}${msg}${C.reset}`); }
function warn(msg)  { console.log(`  ${C.yellow}⚠ ${msg}${C.reset}`); }
function assert(cond, label, detail = '') { cond ? ok(label) : fail(label, detail); }

// ─── Inline parseUIDesignerOutput (mirrors uiDesignerAgent.js exactly) ────────
const BT    = String.fromCharCode(96);
const fence = BT + BT + BT;

function extractBlockContent(text, contentStart, searchEnd) {
  const searchSpace = text.slice(contentStart, searchEnd);
  const lines = searchSpace.split('\n');
  let closingIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === fence) { closingIdx = i; break; }
  }
  return closingIdx === -1 ? searchSpace.trim() : lines.slice(0, closingIdx).join('\n').trim();
}

function parseUIDesignerOutput(text) {
  const result = { components: [], designTokens: null };

  // ── Pass 1: named format  ```(html|css|js|jsx|tsx|javascript|typescript):filename ──
  const langToExt = { html:'html', css:'css', js:'js', jsx:'jsx', tsx:'tsx', javascript:'js', typescript:'ts' };
  const namedPattern = new RegExp(fence + '(' + Object.keys(langToExt).join('|') + '):([^\\n`]+)\\n', 'gi');
  let m;
  const namedOpenings = [];
  while ((m = namedPattern.exec(text)) !== null) {
    const lang = m[1].toLowerCase();
    let filename = m[2].trim();
    if (langToExt[lang] === 'js' && /^(script|main|index)\.js$/.test(filename)) filename = 'app.js';
    namedOpenings.push({ index: m.index, contentStart: m.index + m[0].length, filename });
  }
  for (let o = 0; o < namedOpenings.length; o++) {
    const { contentStart, filename } = namedOpenings[o];
    const searchEnd = o + 1 < namedOpenings.length ? namedOpenings[o + 1].index : text.length;
    const content = extractBlockContent(text, contentStart, searchEnd);
    if (content) result.components.push({ filename, content });
  }

  // ── Pass 2: unnamed fallback ──
  const hasHtml = result.components.some(c => /\.html$/.test(c.filename));
  const hasCss  = result.components.some(c => /\.css$/.test(c.filename));
  const hasJs   = result.components.some(c => /\.(js|jsx|ts|tsx)$/.test(c.filename));

  if (!hasHtml || !hasCss || !hasJs) {
    const fallbackMap = [
      { tag: 'html',             filename: 'index.html',  needed: !hasHtml },
      { tag: 'css',              filename: 'styles.css',  needed: !hasCss },
      { tag: '(?:javascript|js)', filename: 'app.js',     needed: !hasJs },
    ];
    for (const { tag, filename, needed } of fallbackMap) {
      if (!needed) continue;
      const pat = new RegExp(fence + tag + '\\s*\\n', 'i');
      const fm = pat.exec(text);
      if (!fm) continue;
      const contentStart = fm.index + fm[0].length;
      const allFenceStarts = [...text.matchAll(new RegExp(fence + '\\S', 'g'))]
        .map(x => x.index).filter(i => i > fm.index);
      const searchEnd = allFenceStarts.length > 0 ? allFenceStarts[0] : text.length;
      const content = extractBlockContent(text, contentStart, searchEnd);
      if (content && content.length > 50) result.components.push({ filename, content });
    }
  }

  // ── colors.json ──
  const jsonPat = new RegExp(fence + 'json:colors\\.json\\n([\\s\\S]*?)' + fence);
  const jm = text.match(jsonPat);
  if (jm) {
    try { result.designTokens = JSON.parse(jm[1].trim()); } catch (_) {}
  }

  // ── Post-process: fix script.js / main.js / index.js → app.js references in HTML ──
  // When the LLM names the JS block "script.js" or "main.js", the parser renames the FILE to "app.js"
  // but the HTML still has <script src="script.js"> — fix that to keep files consistent.
  const appJsComp = result.components.find(c => c.filename === 'app.js');
  const htmlComp0 = result.components.find(c => /\.html$/.test(c.filename));
  if (appJsComp && htmlComp0) {
    htmlComp0.content = htmlComp0.content
      .replace(/src="script\.js"/gi, 'src="app.js"')
      .replace(/src="main\.js"/gi,   'src="app.js"')
      .replace(/src="index\.js"/gi,  'src="app.js"');
  }

  // ── Pass 3: extract inline <style> / <script> from the HTML file ──
  const htmlComp = result.components.find(c => /\.html$/.test(c.filename));
  if (htmlComp) {
    const hasCssNow = result.components.some(c => /\.css$/.test(c.filename));
    const hasJsNow  = result.components.some(c => /\.(js|jsx|ts|tsx)$/.test(c.filename));

    if (!hasCssNow) {
      const styleMatch = htmlComp.content.match(/<style[^>]*>\s*([\s\S]*?)\s*<\/style>/i);
      if (styleMatch && styleMatch[1].trim().length > 50) {
        result.components.push({ filename: 'styles.css', content: styleMatch[1].trim() });
      }
    }

    if (!hasJsNow) {
      // Inline <script> only — not src= references
      const scriptMatches = [...htmlComp.content.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)];
      for (const sm of scriptMatches) {
        const jsContent = sm[1].trim();
        if (jsContent.length > 50) {
          result.components.push({ filename: 'app.js', content: jsContent });
          break; // first substantial inline script
        }
      }
    }
  }

  return result;
}

// ─── Build the DESIGN phase system prompt ─────────────────────────────────────
function buildDesignSystemPrompt(srs, hld, colors) {
  const tokensStr = colors ? JSON.stringify(colors, null, 2) : '{}';

  return `You are a world-class UI/UX Designer and Frontend Architect with 30+ years of experience.
Your design philosophy:
- **Decisive**: You make all design decisions yourself. Never ask about technical choices.
- **Complete**: You ALWAYS produce ALL 3 files in ONE response. Never stop after HTML.
- **Polished**: Your output looks like a finished product, not a wireframe.

## ⚠️ YOUR TASK: OUTPUT EXACTLY 3 FILES — index.html, styles.css, AND app.js

You MUST generate ALL THREE files in the same response:
1. First: the full index.html
2. Immediately after: the full styles.css
3. Immediately after: the full app.js

**DO NOT stop after index.html. CSS and JS are REQUIRED.**

Pure HTML + CSS + vanilla JavaScript ONLY. No React, no JSX, no frameworks, no CDNs.

### ⚠️ CRITICAL — Output Format (READ CAREFULLY):
You MUST output EXACTLY 3 fenced code blocks using THIS format:

\`\`\`html:index.html
<!DOCTYPE html><!-- ... --></html>
\`\`\`

\`\`\`css:styles.css
/* all styles here */
\`\`\`

\`\`\`js:app.js
// all JavaScript here
\`\`\`

❌ WRONG — DO NOT use these formats:
  \`\`\`html           (no filename tag)
  \`\`\`javascript     (wrong tag — use "js" not "javascript")
  \`\`\`js             (no :filename)
  // index.html     (comment-based filename)
→ The filename after the colon (e.g., "html:index.html") is REQUIRED for the file to be saved.

### Quality Requirements — NON-NEGOTIABLE:

**1. ALL Screens from the SRS must exist in the HTML:**
   - Use \`<section id="screen-name" class="screen">\` for each screen.
   - Default screen: \`display: block\`. Others: \`display: none\` initially.

**2. Navigation that actually works:**
   - Nav buttons use \`data-page="screen-name"\` attribute, NOT href.
   - JS: btn.dataset.page to get the target. Show/hide .screen sections.
   - ✅ CORRECT: navBtn.addEventListener("click", () => { showScreen(navBtn.dataset.page); });
   - ❌ WRONG: getAttribute("href") on buttons.

**3. CSS Custom Properties — NO hardcoded colors:**
   ✅ CORRECT:  background: var(--background);  color: var(--primary);
   ❌ WRONG:    background: #1E293B;  color: #3B82F6;
   → Define ALL design token colors in :root { } at the top of styles.css.

**4. Realistic Hebrew content** matching the synagogue project:
   - Use Hebrew terms: Shacharit/שחרית, Mincha/מנחה, Maariv/מעריב
   - Use Hebrew names and dates in sample data

**5. Working Interactivity:**
   - Tab switching, modal open/close, form validation.
   - All event listeners in app.js using addEventListener (no onclick= in HTML).

**6. Visual Polish:**
   - Sidebar navigation with active state highlighting.
   - Hover states, smooth transitions (0.15s ease), box-shadows.
   - Responsive: sidebar collapses on mobile.

### File Rules:
- index.html: \`<link rel="stylesheet" href="styles.css">\` + \`<script src="app.js"></script>\`
- JS file name MUST be app.js (NOT script.js, NOT main.js).
- Output COMPLETE files — never truncate.

---
## SRS Document:
${srs}

---
## HLD Document:
${hld}

---
## Design Tokens (colors.json):
${tokensStr}

---
## ⚠️ REMINDER — Output ALL 3 files in THIS order, NO stopping after HTML:
1. \`\`\`html:index.html  → THEN
2. \`\`\`css:styles.css   → THEN
3. \`\`\`js:app.js        → DONE`;
}

// ─── HTML Validators ──────────────────────────────────────────────────────────
// Common class names used by LLMs for main content sections
const SCREEN_CLASS_PATTERN = /class="[^"]*\b(?:screen|page|view|panel)\b/i;
const SCREEN_CLASS_COUNT_RE = /class="[^"]*\b(?:screen|page|view|panel)\b/gi;

function validateHTML(html) {
  const results = {};
  results.hasDoctype        = /<!DOCTYPE\s+html/i.test(html);
  results.hasLangAttr       = /<html[^>]*lang=/i.test(html);
  results.hasStylesLink     = /href=["']styles\.css["']/i.test(html);
  results.hasAppJsScript    = /src=["']app\.js["']/i.test(html);
  results.noScriptJsRef     = !/src=["']script\.js["']/i.test(html);
  // Accept screen, page, view, panel as valid content-section class names
  results.hasScreenSections = /<(?:section|div|article)[^>]+(?:class="[^"]*\b(?:screen|page|view|panel)\b|id="[^"]*(?:prayer|torah|memorial|donation|announcement|admin))/i.test(html);
  results.hasNav            = /<nav\b|class="[^"]*(?:nav|sidebar)/i.test(html);
  results.hasDataPage       = /data-page=/i.test(html);
  // Count elements with any common screen-class name
  results.screenCount       = (html.match(SCREEN_CLASS_COUNT_RE) || []).length;
  // Fallback: count sections with IDs that match expected screens (even without class)
  if (results.screenCount === 0) {
    results.screenCount = EXPECTED_SCREENS.filter(s =>
      new RegExp(`id=["'][^"']*${s}[^"']*["']`, 'i').test(html)
    ).length;
  }

  // Check each expected screen is present
  results.foundScreens = EXPECTED_SCREENS.filter(s =>
    new RegExp(`id=["'][^"']*${s}[^"']*["']|data-page=["'][^"']*${s}[^"']*["']`, 'i').test(html)
  );
  results.missingScreens = EXPECTED_SCREENS.filter(s => !results.foundScreens.includes(s));

  // Check for Hebrew content
  results.hasHebrewContent  = /[\u0590-\u05FF]/.test(html);
  results.hasPrayerContent  = /shacharit|שחרית|mincha|מנחה|maariv|מעריב/i.test(html);

  return results;
}

function validateCSS(css) {
  const results = {};
  results.hasRoot           = /:root\s*\{/.test(css);
  results.hasVarPrimary     = /var\(--primary/.test(css);
  results.hasVarBackground  = /var\(--background/.test(css);
  results.hasVarText        = /var\(--text/.test(css);
  results.hasTransitions    = /transition/.test(css);
  results.hasMediaQuery     = /@media/.test(css);
  results.hasFlexOrGrid     = /display\s*:\s*(flex|grid)/.test(css);

  // Count hardcoded hex colors (should be minimal — ideally 0)
  const hexMatches = css.match(/#[0-9A-Fa-f]{3,6}\b/g) || [];
  // Allow hex in :root definitions (design token declarations), flag elsewhere
  const cssWithoutRoot = css.replace(/:root\s*\{[^}]*\}/s, '');
  const hardcodedHex   = (cssWithoutRoot.match(/#[0-9A-Fa-f]{3,6}\b/g) || []);
  results.hardcodedHexCount = hardcodedHex.length;
  results.hardcodedHexSample = hardcodedHex.slice(0, 5);

  results.usesVariables = results.hasVarPrimary && results.hasVarBackground;

  return results;
}

function validateJS(js) {
  const results = {};
  results.hasAddEventListener = /addEventListener/.test(js);
  // Accept both dataset.page and getAttribute('data-page') — they're equivalent
  results.usesDataPage        = /dataset\.page|dataset\[['"]page['"]\]|getAttribute\(['"]data-page['"]\)/.test(js);
  // Accept .screen, .page, .view, .panel as valid screen switching class names
  results.hasScreenNav        = /\.(?:screen|page|view|panel)\b/.test(js) || /(?:screen|page|view|panel)/i.test(js);
  results.noHrefNav           = !/getAttribute\(['"]href['"]\)/.test(js);
  results.hasNoOnclick        = !/\.onclick\s*=(?!=)/.test(js);
  results.hasDOMContentLoaded = /DOMContentLoaded|window\.onload/.test(js);
  // Accept showScreen, showPage, showSection, showView, switchTo, navigateTo, activePage, currentPage, etc.
  results.hasShowScreen       = /show(?:Screen|Page|Section|View|Panel)|switch(?:Screen|Page|To)|navigate(?:To)?|active(?:Page|Screen)|current(?:Page|Screen)|\.page\b/.test(js);

  // Check for inline event handlers (bad pattern)
  const hasInlineOnclick = /\.onclick\s*=\s*function/.test(js);
  results.usesModernEvents = !hasInlineOnclick;

  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. UNIT TESTS — parseUIDesignerOutput (2-pass parser)
// ═════════════════════════════════════════════════════════════════════════════

section('1. parseUIDesignerOutput — named format (Pass 1)');

// Standard named blocks
const sample1 = `
${fence}html:index.html
<!DOCTYPE html><html><body><section id="prayer" class="screen">Prayer</section></body></html>
${fence}

${fence}css:styles.css
:root { --primary: #3B82F6; --background: #0F172A; }
body { background: var(--background); color: var(--primary); }
${fence}

${fence}js:app.js
document.addEventListener('DOMContentLoaded', () => { console.log('ready'); });
${fence}
`;
const r1 = parseUIDesignerOutput(sample1);
assert(r1.components.length === 3, 'Extracts 3 named files');
assert(r1.components.some(c => c.filename === 'index.html'), 'index.html extracted');
assert(r1.components.some(c => c.filename === 'styles.css'), 'styles.css extracted');
assert(r1.components.some(c => c.filename === 'app.js'),     'app.js extracted');

// script.js → app.js WITH HTML reference fix
const sampleScriptJsHtml = `
${fence}html:index.html
<!DOCTYPE html><html><head></head><body><section id="prayer" class="screen">Prayer</section>
<script src="script.js"></script></body></html>
${fence}
${fence}css:styles.css
body { background: var(--background); }
${fence}
${fence}js:script.js
document.addEventListener('DOMContentLoaded', () => {});
${fence}
`;
const rScriptHtml = parseUIDesignerOutput(sampleScriptJsHtml);
assert(rScriptHtml.components.find(c => c.filename === 'app.js'), 'script.js block → normalized to app.js');
assert(!rScriptHtml.components.find(c => c.filename === 'index.html')?.content.includes('src="script.js"'),
  'HTML: script.js reference → updated to app.js (post-process)');

// javascript:app.js alias
const sampleJsAlias = `
${fence}javascript:app.js
console.log('hi');
${fence}
`;
const rAlias = parseUIDesignerOutput(sampleJsAlias);
assert(rAlias.components[0]?.filename === 'app.js', 'javascript:app.js → app.js');

// script.js → normalized to app.js
const sampleScriptJs = `
${fence}js:script.js
console.log('hi');
${fence}
`;
const rNorm = parseUIDesignerOutput(sampleScriptJs);
assert(rNorm.components[0]?.filename === 'app.js', 'script.js → normalized to app.js');

// main.js → normalized to app.js
const sampleMainJs = `${fence}js:main.js\nconsole.log('hi');\n${fence}`;
assert(parseUIDesignerOutput(sampleMainJs).components[0]?.filename === 'app.js', 'main.js → app.js');

section('2. parseUIDesignerOutput — unnamed fallback (Pass 2)');

// Model outputs ```html / ```css / ```javascript (common mistake)
const sampleUnnamed = `
${fence}html
<!DOCTYPE html><html lang="he"><head><link rel="stylesheet" href="styles.css"></head><body><section id="prayer" class="screen">Prayer Times content here</section><script src="app.js"></script></body></html>
${fence}

${fence}css
:root { --primary: #1e3a8c; --background: #f3f4f6; --text: #1f2937; }
body { background: var(--background); color: var(--text); font-family: system-ui; display: flex; }
.screen { display: none; } .screen.active { display: block; }
${fence}

${fence}javascript
document.addEventListener('DOMContentLoaded', () => {
  const btns = document.querySelectorAll('[data-page]');
  btns.forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.page)));
  function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.style.display = 'none'); document.getElementById(id).style.display = 'block'; }
});
${fence}
`;
const r2 = parseUIDesignerOutput(sampleUnnamed);
assert(r2.components.some(c => c.filename === 'index.html'), 'Unnamed ```html → index.html');
assert(r2.components.some(c => c.filename === 'styles.css'), 'Unnamed ```css → styles.css');
assert(r2.components.some(c => c.filename === 'app.js'),     'Unnamed ```javascript → app.js');
assert(r2.components.every(c => c.content.length > 10),      'All unnamed files have content');

// Mixed: named HTML, unnamed CSS + JS
const sampleMixed = `
${fence}html:index.html
<!DOCTYPE html><html lang="he"><head><link rel="stylesheet" href="styles.css"></head><body><section id="home" class="screen">Home screen content for the app</section><script src="app.js"></script></body></html>
${fence}

${fence}css
:root { --primary: #3B82F6; --background: #0F172A; --text: #F8FAFC; }
body { background: var(--background); color: var(--text); font-family: system-ui, sans-serif; display: flex; flex-direction: column; }
.screen { display: none; } .screen.active { display: block; padding: 1rem; }
${fence}

${fence}js
document.addEventListener('DOMContentLoaded', () => {
  const navBtns = document.querySelectorAll('[data-page]');
  navBtns.forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.page)));
  function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.style.display = 'none'); document.getElementById(id).style.display = 'block'; }
});
${fence}
`;
const rMixed = parseUIDesignerOutput(sampleMixed);
assert(rMixed.components.some(c => c.filename === 'index.html'), 'Mixed: named html extracted');
assert(rMixed.components.some(c => c.filename === 'styles.css'), 'Mixed: unnamed css → styles.css');
assert(rMixed.components.some(c => c.filename === 'app.js'),     'Mixed: unnamed js → app.js');

// Unnamed fallback doesn't fire when Pass 1 already found the file
const sampleNoDouble = `
${fence}html:index.html
<html><body>Named HTML</body></html>
${fence}

${fence}html
<html><body>Should NOT appear</body></html>
${fence}
`;
const rNoDouble = parseUIDesignerOutput(sampleNoDouble);
const htmlFiles = rNoDouble.components.filter(c => c.filename === 'index.html');
assert(htmlFiles.length === 1, 'No duplicate index.html when Pass 1 already found it');
assert(htmlFiles[0].content.includes('Named HTML'), 'Named version takes precedence');

// Unnamed block too short → ignored (garbage / empty block protection)
const sampleShort = `${fence}html\n<h1>hi</h1>\n${fence}`;
const rShort = parseUIDesignerOutput(sampleShort);
assert(rShort.components.length === 0, 'Unnamed block < 50 chars → ignored (no false positive)');

section('2b. parseUIDesignerOutput — Pass 3: inline <style>/<script> extraction');

// LLM produced one big HTML file with inline CSS + JS
const sampleSingleFile = `
${fence}html
<!DOCTYPE html>
<html lang="he">
<head>
  <meta charset="UTF-8">
  <title>בית כנסת</title>
  <style>
    :root { --primary: #1e3a8c; --background: #f3f4f6; --text: #1f2937; }
    body { background: var(--background); color: var(--text); display: flex; font-family: system-ui; }
    .screen { display: none; } .screen.active { display: block; }
    .sidebar { background: var(--primary); } nav button { color: white; }
    @media (max-width: 768px) { .sidebar { display: none; } }
  </style>
</head>
<body>
  <nav class="sidebar"><button data-page="prayer">תפילה</button></nav>
  <section id="prayer" class="screen active">שחרית מנחה מעריב</section>
  <section id="admin" class="screen">כניסה לניהול</section>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const btns = document.querySelectorAll('[data-page]');
      btns.forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.page)));
      function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
        document.getElementById(id).style.display = 'block';
      }
    });
  </script>
</body>
</html>
${fence}
`;
const rSingle = parseUIDesignerOutput(sampleSingleFile);
assert(rSingle.components.some(c => c.filename === 'index.html'), 'Single-file: HTML extracted');
assert(rSingle.components.some(c => c.filename === 'styles.css'), 'Single-file: CSS extracted from inline <style>');
assert(rSingle.components.some(c => c.filename === 'app.js'),     'Single-file: JS extracted from inline <script>');
const singleCss = rSingle.components.find(c => c.filename === 'styles.css');
const singleJs  = rSingle.components.find(c => c.filename === 'app.js');
assert(singleCss?.content.includes('var(--primary)'),    'Single-file: extracted CSS uses CSS variables');
assert(singleJs?.content.includes('dataset.page'),       'Single-file: extracted JS uses dataset.page navigation');
assert(rSingle.components.every(c => c.content.length > 50), 'Single-file: all 3 extracted files have content > 50 chars');

section('3. parseUIDesignerOutput — colors.json + fallback extraction');

// Proper colors.json block
const sampleColors = `${fence}json:colors.json\n{"primary":"#1e3a8c","background":"#f3f4f6"}\n${fence}`;
const rColors = parseUIDesignerOutput(sampleColors);
assert(rColors.designTokens?.primary === '#1e3a8c',    'colors.json block parsed');
assert(rColors.designTokens?.background === '#f3f4f6', 'colors.json background correct');

// Fallback: prose colors
const sampleProseColors = `
Design decisions: primary: #1e3a8c for headings, background: #f3f4f6 for main area.
Accent: #d4af37 for gold highlights, error: #ef4444 for alerts.
`;
const rProse = parseUIDesignerOutput(sampleProseColors);
if (rProse.designTokens) {
  assert(rProse.designTokens.primary   === '#1e3a8c', 'Prose fallback: primary extracted');
  assert(rProse.designTokens.accent    === '#d4af37', 'Prose fallback: accent extracted');
  ok('Prose color fallback activated (≥2 labelled keys found)');
} else {
  warn('Prose fallback not triggered — may need more labelled keys');
}

section('4. HTML / CSS / JS Validators (unit)');

// Valid HTML
const goodHtml = `<!DOCTYPE html><html lang="he"><head><link rel="stylesheet" href="styles.css"></head>
<body>
<nav class="sidebar"><button data-page="prayer">Prayer</button></nav>
<section id="prayer" class="screen">Prayer Times</section>
<section id="admin" class="screen" style="display:none">Admin</section>
<script src="app.js"></script></body></html>`;
const hv = validateHTML(goodHtml);
assert(hv.hasDoctype,          'HTML: has DOCTYPE');
assert(hv.hasStylesLink,       'HTML: links styles.css');
assert(hv.hasAppJsScript,      'HTML: links app.js');
assert(hv.noScriptJsRef,       'HTML: no script.js reference');
assert(hv.hasScreenSections,   'HTML: has .screen sections');
assert(hv.hasDataPage,         'HTML: nav uses data-page');

// Valid CSS
const goodCss = `:root { --primary: #1e3a8c; --primaryHover: #2563EB; --background: #f3f4f6; --text: #1f2937; --surface: #1E293B; }
body { background: var(--background); color: var(--text); display: flex; font-family: system-ui, sans-serif; transition: all 0.15s ease; }
.sidebar { background: var(--surface); } .btn-primary { background: var(--primary); color: white; }
.btn-primary:hover { background: var(--primaryHover); }
@media (max-width: 768px) { .sidebar { display: none; } }`;
const cv = validateCSS(goodCss);
assert(cv.hasRoot,              'CSS: has :root {}');
assert(cv.hasVarPrimary,        'CSS: uses var(--primary)');
assert(cv.hasVarBackground,     'CSS: uses var(--background)');
assert(cv.hasMediaQuery,        'CSS: has responsive @media');
assert(cv.hardcodedHexCount === 0, `CSS: no hardcoded hex outside :root (found: ${cv.hardcodedHexCount})`);

// Valid JS
const goodJs = `document.addEventListener('DOMContentLoaded', () => {
  const navBtns = document.querySelectorAll('[data-page]');
  navBtns.forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.page)));
  function showScreen(name) { document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(name).style.display = 'block'; }
});`;
const jv = validateJS(goodJs);
assert(jv.hasAddEventListener, 'JS: uses addEventListener');
assert(jv.usesDataPage,        'JS: reads btn.dataset.page');
assert(jv.noHrefNav,           'JS: no getAttribute(href) for navigation');
assert(jv.hasDOMContentLoaded, 'JS: waits for DOMContentLoaded');

// ═════════════════════════════════════════════════════════════════════════════
// 5. Ollama connectivity check
// ═════════════════════════════════════════════════════════════════════════════
section('5. Ollama connectivity');

let ollamaOk = false;
try {
  const res = await fetch(`${OLLAMA_BASE}/models`, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();
  ollamaOk = res.ok;
  const models = data.data?.map(m => m.id) || [];
  assert(ollamaOk, 'Ollama /v1/models responds OK');
  assert(models.some(m => m.includes('qwen3-coder')), `qwen3-coder available (found: ${models.slice(0,3).join(', ')})`);
} catch (e) {
  fail('Ollama connection', e.message);
}

if (!ollamaOk) {
  warn('Skipping LLM tests — Ollama not reachable');
  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. Load workspace documents
// ═════════════════════════════════════════════════════════════════════════════
section('6. Workspace documents');

let srs, hld, colors;
try {
  srs    = await readFile(SRS_PATH,    'utf-8');
  hld    = await readFile(HLD_PATH,    'utf-8');
  colors = JSON.parse(await readFile(COLORS_PATH, 'utf-8'));
  assert(srs.length  > 500,  `SRS.md loaded (${srs.length} chars)`);
  assert(hld.length  > 500,  `HLD.md loaded (${hld.length} chars)`);
  assert(!!colors.primary,   `colors.json loaded (primary: ${colors.primary})`);
} catch (e) {
  fail('Failed to load workspace docs', e.message);
  printSummary();
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. LLM DESIGN PHASE — Generate HTML + CSS + JS
// ═════════════════════════════════════════════════════════════════════════════
section(`7. LLM DESIGN PHASE — ${MODEL}`);

const systemPrompt  = buildDesignSystemPrompt(srs, hld, colors);
const designTrigger = 'Generate ALL 3 files now: first ```html:index.html (complete), then ```css:styles.css (complete), then ```js:app.js (complete). All screens from SRS in Hebrew. Do NOT stop after the HTML — output all 3 files in sequence.';

info(`System prompt: ${systemPrompt.length} chars`);
info(`Sending to Ollama (max ${MAX_TOKENS} tokens, timeout ${TIMEOUT_MS/1000}s)...`);
info('This will take 3–8 minutes. Progress dots:');
process.stdout.write('  ');

let designResponse = '';
let firstTokenTime = null;
const startTime = Date.now();
let tokenCount = 0;

try {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    warn('\nTimeout reached — aborting stream');
    controller.abort();
  }, TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: designTrigger },
      ],
      max_tokens: MAX_TOKENS,
      stream: true,
      temperature: 0.2,       // lower = more deterministic, less hallucination
      options: { num_ctx: 32768 },  // ensure large context for long system prompt + output
    }),
    signal: controller.signal,
  });

  assert(response.ok, `HTTP ${response.status} from Ollama`);

  const reader  = response.body.getReader();
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
          designResponse += token;
          tokenCount++;
          if (tokenCount % 200 === 0) process.stdout.write('.');
        }
      } catch { /* skip malformed */ }
    }
  }

  clearTimeout(timeoutId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const ttft    = firstTokenTime ? ((firstTokenTime - startTime) / 1000).toFixed(1) : '?';
  console.log(`\n  ${C.dim}✓ Stream complete: ${elapsed}s (TTFT: ${ttft}s, ${tokenCount} tokens, ${designResponse.length} chars)${C.reset}`);

} catch (e) {
  if (e.name === 'AbortError') {
    warn('Stream aborted (timeout) — testing partial response');
  } else {
    fail('LLM streaming error', e.message);
    printSummary();
    process.exit(1);
  }
}

// Strip <think>...</think> blocks (qwen3-coder reasoning)
const cleaned = designResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
info(`Response after think-strip: ${cleaned.length} chars`);

// Save raw response for debugging (always, so we can inspect on failure)
try {
  await mkdir(OUTPUT_DIR.replace(/\\/g, '/'), { recursive: true });
  await writeFile(`${OUTPUT_DIR.replace(/\\/g, '/')}/raw-response.txt`, cleaned, 'utf-8');
  info(`Raw response saved → ${OUTPUT_DIR}/raw-response.txt`);
} catch (_) { /* non-fatal */ }

// ─── Parse the response ───────────────────────────────────────────────────────
section('8. Parse LLM output — file extraction');

const parsedOutput = parseUIDesignerOutput(cleaned);
const { components } = parsedOutput;

assert(components.length >= 3,
  `Extracted ≥3 files (got ${components.length})`,
  components.length < 3 ? `Found: ${components.map(c=>c.filename).join(', ') || 'none'}` : '');

const htmlFile = components.find(c => /\.html$/.test(c.filename));
const cssFile  = components.find(c => /\.css$/.test(c.filename));
const jsFile   = components.find(c => /\.(js|jsx|ts|tsx)$/.test(c.filename));

if (htmlFile) info(`  index.html source: ${htmlFile.content.includes('<style') ? 'single-file HTML (inline CSS+JS)' : 'standalone HTML (external files)'}`);

assert(!!htmlFile, `HTML file extracted (${htmlFile?.filename || 'missing'})`, !htmlFile ? 'index.html not found' : '');
assert(!!cssFile,  `CSS file extracted (${cssFile?.filename  || 'missing'})`,  !cssFile  ? 'styles.css not found — not in fenced block or inline <style>' : '');
assert(!!jsFile,   `JS file extracted (${jsFile?.filename   || 'missing'})`,   !jsFile   ? 'app.js not found — not in fenced block or inline <script>' : '');

if (!htmlFile) {
  warn('No HTML file found — cannot continue validation. Raw response preview:');
  console.log(cleaned.substring(0, 600));
  printSummary();
  process.exit(1);
}

if (!cssFile) warn('CSS file missing — CSS validation will be skipped (LLM generated standalone HTML without CSS block)');
if (!jsFile)  warn('JS file missing — JS validation will be skipped (LLM generated standalone HTML without JS block)');

// Show sizes
info(`index.html: ${htmlFile.content.length} chars${cssFile ? ` | styles.css: ${cssFile.content.length} chars` : ' | styles.css: MISSING'}${jsFile ? ` | app.js: ${jsFile.content.length} chars` : ' | app.js: MISSING'}`);
assert(htmlFile.content.length > 2000, `HTML is substantial (${htmlFile.content.length} chars > 2000)`);
if (cssFile) assert(cssFile.content.length  > 500,  `CSS is substantial (${cssFile.content.length} chars > 500)`);
if (jsFile)  assert(jsFile.content.length   > 300,  `JS is substantial (${jsFile.content.length} chars > 300)`);

// ─── HTML Validation ──────────────────────────────────────────────────────────
section('9. HTML validation');

const hv2 = validateHTML(htmlFile.content);
assert(hv2.hasDoctype,        'HTML: has <!DOCTYPE html>');
assert(hv2.hasLangAttr,       'HTML: has lang attribute on <html>');
assert(hv2.hasStylesLink,     'HTML: links href="styles.css"');
assert(hv2.hasAppJsScript,    'HTML: links src="app.js"');
assert(hv2.noScriptJsRef,     'HTML: no broken script.js reference');
assert(hv2.hasScreenSections, 'HTML: has <section class="screen"> elements');
assert(hv2.hasNav,            'HTML: has sidebar or nav element');
assert(hv2.hasDataPage,       'HTML: nav uses data-page attribute');
assert(hv2.screenCount >= EXPECTED_SCREENS.length,
  `HTML: ≥${EXPECTED_SCREENS.length} screen sections (found ${hv2.screenCount})`,
  `Need sections for: ${EXPECTED_SCREENS.join(', ')}`);

if (hv2.missingScreens.length > 0) {
  fail(`HTML: all expected screens present`, `Missing: ${hv2.missingScreens.join(', ')}`);
} else {
  ok(`HTML: all ${EXPECTED_SCREENS.length} expected screen patterns found`);
}
if (hv2.hasHebrewContent) {
  ok('HTML: contains Hebrew Unicode characters (RTL content)');
} else {
  warn('HTML: no Hebrew Unicode — content may be transliterated (שחרית etc.) or English only');
}
if (hv2.hasPrayerContent) {
  ok('HTML: contains prayer-specific terms (Shacharit/Mincha/Maariv or Hebrew equivalents)');
} else {
  warn('HTML: no specific prayer terms (שחרית/מנחה/מעריב/Shacharit) — prayer screen may use generic title');
}

// ─── CSS Validation ───────────────────────────────────────────────────────────
let cv2;
if (cssFile) {
  section('10. CSS validation');
  cv2 = validateCSS(cssFile.content);
  assert(cv2.hasRoot,         'CSS: :root { } block defined');
  assert(cv2.usesVariables,   'CSS: uses var(--primary) and var(--background)');
  assert(cv2.hasVarText,      'CSS: uses var(--text)');
  assert(cv2.hasTransitions,  'CSS: has transition animations');
  assert(cv2.hasMediaQuery,   'CSS: has responsive @media queries');
  assert(cv2.hasFlexOrGrid,   'CSS: uses flexbox or grid layout');
  if (cv2.hardcodedHexCount === 0) {
    ok('CSS: zero hardcoded hex colors outside :root (perfect)');
  } else if (cv2.hardcodedHexCount <= 3) {
    warn(`CSS: ${cv2.hardcodedHexCount} hardcoded hex outside :root (acceptable — ${cv2.hardcodedHexSample.join(', ')})`);
  } else {
    fail('CSS: too many hardcoded hex colors outside :root',
      `${cv2.hardcodedHexCount} found: ${cv2.hardcodedHexSample.join(', ')} ...`);
  }
} else {
  section('10. CSS validation — SKIPPED (no CSS file extracted)');
  warn('CSS not available — LLM did not output a separate CSS file or inline <style>');
}

// ─── JS Validation ────────────────────────────────────────────────────────────
let jv2;
if (jsFile) {
  section('11. JavaScript validation');
  jv2 = validateJS(jsFile.content);
  assert(jv2.hasAddEventListener, 'JS: uses addEventListener (not onclick=)');
  assert(jv2.usesDataPage,        'JS: reads btn.dataset.page for navigation');
  assert(jv2.noHrefNav,           'JS: no getAttribute("href") on nav buttons');
  assert(jv2.hasDOMContentLoaded, 'JS: waits for DOMContentLoaded or window.onload');
  assert(jv2.hasShowScreen || jv2.hasScreenNav,
    'JS: has screen switching function (showScreen / navigateTo / .screen class)');
  assert(jv2.usesModernEvents,    'JS: no .onclick = function assignment (uses addEventListener)');
} else {
  section('11. JavaScript validation — SKIPPED (no JS file extracted)');
  warn('JS not available — LLM did not output a separate JS file or inline <script>');
}

// ─── Cross-file consistency ────────────────────────────────────────────────────
section('12. Cross-file consistency');

// JS references match HTML section IDs
const htmlSectionIds = [...htmlFile.content.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert(htmlSectionIds.length >= EXPECTED_SCREENS.length,
  `HTML has ≥${EXPECTED_SCREENS.length} id= attributes (found ${htmlSectionIds.length})`);
info(`HTML section IDs: ${htmlSectionIds.filter(id => EXPECTED_SCREENS.some(s => id.toLowerCase().includes(s))).join(', ')}`);

// CSS defines the main section class that HTML uses
if (cssFile) {
  const sectionClass = cssFile.content.includes('.screen') ? '.screen'
    : cssFile.content.includes('.page') ? '.page'
    : cssFile.content.includes('.view') ? '.view'
    : cssFile.content.includes('.panel') ? '.panel'
    : null;
  if (sectionClass) {
    ok(`CSS: defines section class "${sectionClass}" (used for screen switching)`);
  } else {
    fail('CSS: no screen-section class found (.screen / .page / .view / .panel)');
  }
} else {
  info('Cross-file CSS class check skipped (no CSS file)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 13. Save files to workspace
// ═════════════════════════════════════════════════════════════════════════════
section('13. Save generated files to workspace');

const outputPath = OUTPUT_DIR.replace(/\\/g, '/');

try {
  await mkdir(outputPath, { recursive: true });
  info(`Output directory: ${outputPath}`);

  const filesToSave = [
    htmlFile && { filename: htmlFile.filename, content: htmlFile.content },
    cssFile  && { filename: cssFile.filename,  content: cssFile.content  },
    jsFile   && { filename: jsFile.filename,   content: jsFile.content   },
  ].filter(Boolean);

  for (const { filename, content } of filesToSave) {
    const fullPath = `${outputPath}/${filename}`;
    await writeFile(fullPath, content, 'utf-8');
    ok(`Saved ${filename} (${content.length} chars) → ${fullPath}`);
  }

  // Write a test report
  const report = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    workspace: WORKSPACE,
    elapsed_s: ((Date.now() - startTime) / 1000).toFixed(1),
    tokens: tokenCount,
    files: filesToSave.map(f => ({ filename: f.filename, chars: f.content.length })),
    validation: {
      html: {
        screens_found: hv2.foundScreens,
        screens_missing: hv2.missingScreens,
        has_data_page: hv2.hasDataPage,
        has_hebrew: hv2.hasHebrewContent,
      },
      css: cv2 ? {
        uses_variables: cv2.usesVariables,
        hardcoded_hex_count: cv2.hardcodedHexCount,
        has_media_query: cv2.hasMediaQuery,
      } : { skipped: 'no CSS file extracted' },
      js: jv2 ? {
        uses_dataset_page: jv2.usesDataPage,
        no_href_nav: jv2.noHrefNav,
        has_screen_nav: jv2.hasScreenNav || jv2.hasShowScreen,
      } : { skipped: 'no JS file extracted' },
    },
  };
  await writeFile(`${outputPath}/test-report.json`, JSON.stringify(report, null, 2), 'utf-8');
  ok('test-report.json saved');

  console.log(`\n  ${C.bold}${C.magenta}📂 Preview files at:${C.reset}`);
  console.log(`  ${C.blue}${outputPath}/index.html${C.reset}`);

} catch (e) {
  fail('Failed to save files', e.message);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function printSummary() {
  console.log(`\n${C.bold}══════════════════════════════════════${C.reset}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`${C.bold}${C.green}✓ All ${total} tests passed${C.reset}`);
  } else {
    console.log(`${C.bold}${C.green}${passed} passed${C.reset} · ${C.bold}${C.red}${failed} failed${C.reset} (${total} total)`);
    console.log(`\n${C.red}Failures:${C.reset}`);
    for (const { label, detail } of failures) {
      console.log(`  ${C.red}✗${C.reset} ${label}${detail ? `\n    ${C.dim}↳ ${detail}${C.reset}` : ''}`);
    }
  }
  console.log('');
}

printSummary();
process.exit(failed > 0 ? 1 : 0);
