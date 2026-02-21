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
