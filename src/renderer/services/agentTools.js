import api from './electronBridge.js';
import log from './logger.js';

// ─── Integration Check Tool ─────────────────────────────────────────────────────
// Scans the project's main HTML file (or Electron main.js) and verifies that
// all referenced imports (JS/CSS) actually exist on disk, and that package.json
// contains the required main script entry.

/**
 * Runs an integration check on the project.
 * Returns { passed: boolean, issues: string[] }
 *
 * Checks:
 * 1. Finds main HTML file(s) and verifies all <script src> and <link href> point to real files
 * 2. If Electron project: verifies main.js exists and references a valid index.html
 * 3. Verifies package.json has a "main" field pointing to an existing file
 * 4. Verifies package.json has start/dev/build scripts
 */
export async function runIntegrationCheck(projectPath) {
  log.info('agentTools', 'runIntegrationCheck started', { projectPath });
  const issues = [];
  const p = projectPath.replace(/[\\/]$/, '');

  // ─── 1. Read package.json ───────────────────────────────────────────
  let pkgJson = null;
  try {
    const raw = await api.readFile(p + '/package.json');
    if (raw) {
      pkgJson = JSON.parse(raw);
    } else {
      issues.push('MISSING: package.json not found in project root');
    }
  } catch (e) {
    issues.push('INVALID: package.json exists but is not valid JSON');
  }

  if (pkgJson) {
    // Check "main" field
    if (pkgJson.main) {
      const mainExists = await api.exists(p + '/' + pkgJson.main);
      if (!mainExists) {
        issues.push(`MISSING_FILE: package.json "main" points to "${pkgJson.main}" but file does not exist on disk`);
      }
    }

    // Check required scripts
    const requiredScripts = ['start', 'dev', 'build'];
    const scripts = pkgJson.scripts || {};
    for (const s of requiredScripts) {
      if (!scripts[s]) {
        issues.push(`MISSING_SCRIPT: package.json is missing "${s}" script`);
      }
    }
  }

  // ─── 2. Find and scan HTML files ────────────────────────────────────
  const htmlCandidates = [
    'index.html',
    'src/index.html',
    'public/index.html',
    'renderer/index.html',
    'src/renderer/index.html',
  ];

  let htmlFound = false;
  for (const htmlRel of htmlCandidates) {
    const htmlPath = p + '/' + htmlRel;
    const htmlContent = await api.readFile(htmlPath);
    if (!htmlContent) continue;
    htmlFound = true;

    // Extract <script src="..."> references
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = scriptRegex.exec(htmlContent)) !== null) {
      const src = m[1];
      // Skip external URLs and Vite/bundler dev URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) continue;
      // Resolve relative to HTML file's directory
      const htmlDir = htmlRel.includes('/') ? htmlRel.substring(0, htmlRel.lastIndexOf('/')) : '';
      const resolvedPath = src.startsWith('/') ? src.substring(1) : (htmlDir ? htmlDir + '/' + src : src);
      const fileExists = await api.exists(p + '/' + resolvedPath);
      if (!fileExists) {
        issues.push(`BROKEN_IMPORT: ${htmlRel} references <script src="${src}"> but file "${resolvedPath}" does not exist on disk`);
      }
    }

    // Extract <link rel="stylesheet" href="..."> references
    const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((m = linkRegex.exec(htmlContent)) !== null) {
      const tag = m[0];
      const href = m[1];
      // Only check stylesheets
      if (!tag.includes('stylesheet') && !href.endsWith('.css')) continue;
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) continue;
      const htmlDir = htmlRel.includes('/') ? htmlRel.substring(0, htmlRel.lastIndexOf('/')) : '';
      const resolvedPath = href.startsWith('/') ? href.substring(1) : (htmlDir ? htmlDir + '/' + href : href);
      const fileExists = await api.exists(p + '/' + resolvedPath);
      if (!fileExists) {
        issues.push(`BROKEN_IMPORT: ${htmlRel} references <link href="${href}"> but file "${resolvedPath}" does not exist on disk`);
      }
    }
  }

  if (!htmlFound) {
    // Not necessarily an error — some projects don't have HTML (pure backend, etc.)
    // But if package.json references electron, it's a problem
    if (pkgJson && (pkgJson.dependencies?.electron || pkgJson.devDependencies?.electron || pkgJson.main?.endsWith('.js'))) {
      issues.push('MISSING: No index.html found — Electron apps require an HTML entry point');
    }
  }

  // ─── 3. Electron-specific: check main.js → index.html reference ────
  if (pkgJson && (pkgJson.dependencies?.electron || pkgJson.devDependencies?.electron)) {
    const mainFile = pkgJson.main || 'main.js';
    const mainContent = await api.readFile(p + '/' + mainFile);
    if (mainContent) {
      // Check if main.js references an HTML file that exists
      const loadMatch = mainContent.match(/loadFile\s*\(\s*(?:path\.join\s*\([^)]*,\s*)?['"]([^'"]+)['"]/);
      const loadUrlMatch = mainContent.match(/loadURL\s*\(\s*['"]file:\/\/([^'"]+)['"]/);
      const htmlRef = loadMatch?.[1] || loadUrlMatch?.[1];
      if (htmlRef) {
        const htmlExists = await api.exists(p + '/' + htmlRef);
        if (!htmlExists) {
          issues.push(`BROKEN_ELECTRON: main.js references "${htmlRef}" via loadFile/loadURL but the file does not exist on disk`);
        }
      }
    } else if (mainFile !== 'main.js') {
      // Already reported above via package.json main check
    }
  }

  log.info('agentTools', 'runIntegrationCheck done', { passed: issues.length === 0, issueCount: issues.length });
  return {
    passed: issues.length === 0,
    issues,
  };
}

// ─── Shared Agent Tool Instructions ──────────────────────────────────────────
// All agents use this standardized instruction block for asking structured questions.
// The LLM outputs a ```questions JSON block which the UI parses reliably.

export const ASK_USER_TOOL_INSTRUCTION = `
### CRITICAL — Structured Questions Tool:
When you need to ask the user a question that has predefined choices/options, you MUST output a structured JSON block using the following format. This is how the UI renders interactive clickable buttons for the user.

\`\`\`questions
[
  {
    "q": "Your question text here?",
    "options": ["Option A", "Option B", "Option C"]
  }
]
\`\`\`

Rules:
1. ALWAYS use this \`\`\`questions block for ANY question with predefined options — never use numbered lists or bullet points for options.
2. You can include multiple questions in one block — each as a separate object in the array.
3. Each question MUST have at least 2 options.
4. Keep option text concise (under 80 characters). Put details in the message text above the block.
5. The questions block should be at the END of your message, after any explanatory text.
6. For open-ended questions with no predefined options, just ask normally without the block.

Example with multiple questions:

I've analyzed the project. Before proceeding, I need to understand your preferences:

**Deployment:** The SRS mentions cloud hosting but doesn't specify the provider.

**Database:** You'll need persistent storage for user data.

\`\`\`questions
[
  {
    "q": "Which cloud provider do you prefer for deployment?",
    "options": ["AWS", "Google Cloud", "Azure", "Self-hosted", "No preference"]
  },
  {
    "q": "What type of database fits your needs?",
    "options": ["PostgreSQL (relational)", "MongoDB (document)", "SQLite (embedded)", "Let me decide later"]
  }
]
\`\`\`
`;
