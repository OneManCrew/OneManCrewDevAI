import React, { useState } from 'react';

// ─── Structured Question Parser ─────────────────────────────────────────────
// The LLM outputs questions inside a ```questions JSON block.
// Format:
// ```questions
// [
//   { "q": "Question text?", "options": ["Option A", "Option B", "Option C"] },
//   ...
// ]
// ```

/**
 * Extract the ```questions JSON block from assistant text and parse it.
 * Returns: [{ question: string, options: [{ label, value }] }] or null
 */
export function parseQuestions(text) {
  if (!text) return null;

  // Match ```questions ... ``` block (with or without trailing newline)
  const match = text.match(/```questions\s*\n([\s\S]*?)```/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1].trim());
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const questions = raw
      .filter((item) => item && item.q && Array.isArray(item.options) && item.options.length >= 2)
      .map((item) => ({
        question: item.q,
        options: item.options.map((opt) => {
          const str = typeof opt === 'string' ? opt : (opt.label || opt.value || String(opt));
          return {
            label: str.length > 80 ? str.substring(0, 77) + '...' : str,
            value: str,
          };
        }),
      }));

    return questions.length > 0 ? questions : null;
  } catch (e) {
    console.warn('Failed to parse questions JSON block:', e);
    return null;
  }
}

/**
 * Strip the ```questions block from text so it doesn't render as raw JSON in markdown.
 */
export function stripQuestionsBlock(text) {
  if (!text) return text;
  return text.replace(/```questions\s*\n[\s\S]*?```/g, '').trim();
}

/**
 * Backward-compatible single-question parser.
 */
export function parseOptions(text) {
  const qs = parseQuestions(text);
  if (!qs || qs.length === 0) return null;
  return qs[qs.length - 1].options;
}

// ─── Color themes ────────────────────────────────────────────────────────────
const COLORS = {
  accent: {
    card: 'border-accent/20 bg-accent/5',
    qText: 'text-accent',
    btn: 'border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50',
    btnSelected: 'bg-accent/20 border-accent/50 text-accent',
    other: 'border-accent/30 text-accent',
    otherBtn: 'bg-accent text-surface hover:bg-accent-hover',
    submitAll: 'bg-accent text-surface hover:bg-accent-hover',
  },
  pink: {
    card: 'border-pink-500/20 bg-pink-500/5',
    qText: 'text-pink-400',
    btn: 'border-pink-500/30 text-pink-400 hover:bg-pink-500/10 hover:border-pink-500/50',
    btnSelected: 'bg-pink-500/20 border-pink-500/50 text-pink-400',
    other: 'border-pink-500/30 text-pink-400',
    otherBtn: 'bg-pink-500 text-white hover:bg-pink-600',
    submitAll: 'bg-pink-500 text-white hover:bg-pink-600',
  },
  emerald: {
    card: 'border-emerald-500/20 bg-emerald-500/5',
    qText: 'text-emerald-400',
    btn: 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50',
    btnSelected: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
    other: 'border-emerald-500/30 text-emerald-400',
    otherBtn: 'bg-emerald-500 text-white hover:bg-emerald-600',
    submitAll: 'bg-emerald-500 text-white hover:bg-emerald-600',
  },
};

// ─── Single Question Card ────────────────────────────────────────────────────

function QuestionCard({ question, options, index, onAnswer, answered, locked, disabled, accentColor, onClear }) {
  const [showOther, setShowOther] = useState(false);
  const [otherText, setOtherText] = useState('');
  const c = COLORS[accentColor] || COLORS.accent;

  const handleSelect = (value) => {
    if (disabled || locked) return;
    onAnswer(index, value);
  };

  const handleOtherSubmit = () => {
    if (!otherText.trim() || disabled || locked) return;
    onAnswer(index, otherText.trim());
    setShowOther(false);
  };

  const handleClear = () => {
    if (disabled || locked) return;
    if (onClear) onClear(index);
    setShowOther(false);
    setOtherText('');
  };

  return (
    <div className={`rounded-xl border p-3 ${c.card}`}>
      <p className={`text-xs font-semibold mb-2 ${c.qText}`}>
        {question}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt.value)}
            disabled={disabled || locked}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 text-left ${
              answered === opt.value
                ? c.btnSelected
                : answered && locked
                  ? 'border-border text-gray-600 cursor-not-allowed opacity-40'
                  : answered
                    ? `${c.btn} opacity-60`
                    : c.btn
            } ${!locked && !disabled ? 'cursor-pointer' : ''}`}
          >
            <span className="opacity-50 mr-1">{i + 1}.</span>
            {opt.label}
          </button>
        ))}

        {!locked && !showOther && (
          <button
            onClick={() => setShowOther(true)}
            disabled={disabled}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed transition-all duration-150 ${
              disabled ? 'border-border text-gray-600 cursor-not-allowed' : `${c.other} hover:bg-surface-elevated cursor-pointer`
            }`}
          >
            Other...
          </button>
        )}
      </div>

      {showOther && !locked && (
        <div className="flex gap-1.5 mt-2">
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleOtherSubmit(); }}
            placeholder="Type your answer..."
            autoFocus
            className="flex-1 px-2.5 py-1.5 text-xs bg-surface border border-border rounded-lg text-gray-300 placeholder-gray-600 focus:border-accent/50 focus:outline-none"
          />
          <button
            onClick={handleOtherSubmit}
            disabled={!otherText.trim()}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              otherText.trim() ? c.otherBtn : 'bg-surface-elevated text-gray-600 cursor-not-allowed'
            }`}
          >
            Send
          </button>
          <button
            onClick={() => { setShowOther(false); setOtherText(''); }}
            className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 rounded-lg hover:bg-surface-elevated transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {answered && !locked && (
        <div className="mt-1.5 flex items-center gap-1">
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[10px] text-green-400 font-medium">{answered}</span>
          <button
            onClick={handleClear}
            className="ml-1 text-[10px] text-gray-500 hover:text-gray-300 underline transition-colors"
          >
            Change
          </button>
        </div>
      )}

      {answered && locked && (
        <div className="mt-1.5 flex items-center gap-1">
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[10px] text-green-400 font-medium">{answered}</span>
        </div>
      )}
    </div>
  );
}

// ─── Multi-Question Reply ────────────────────────────────────────────────────

export default function MultiQuestionReply({ questions, onSubmit, disabled = false, accentColor = 'accent' }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  if (!questions || questions.length === 0) return null;

  const c = COLORS[accentColor] || COLORS.accent;
  const allAnswered = questions.every((_, i) => answers[i]);

  const handleAnswer = (index, value) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const handleClear = (index) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleSubmitAll = () => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    if (questions.length === 1) {
      onSubmit(answers[0]);
    } else {
      const response = questions.map((q, i) =>
        `${i + 1}. ${q.question}\n   → ${answers[i]}`
      ).join('\n\n');
      onSubmit(response);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {questions.map((q, i) => (
        <QuestionCard
          key={i}
          question={q.question}
          options={q.options}
          index={i}
          onAnswer={handleAnswer}
          onClear={handleClear}
          answered={answers[i] || null}
          locked={submitted}
          disabled={disabled || submitted}
          accentColor={accentColor}
        />
      ))}

      {!submitted && (
        <button
          onClick={handleSubmitAll}
          disabled={!allAnswered}
          className={`w-full py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
            allAnswered
              ? `${c.submitAll} shadow-lg`
              : 'bg-surface-elevated text-gray-600 border border-border cursor-not-allowed'
          }`}
        >
          {allAnswered
            ? questions.length === 1 ? 'Send Answer' : `Submit All ${questions.length} Answers`
            : questions.length === 1 ? 'Select an option' : `Answer all questions (${Object.keys(answers).length}/${questions.length})`
          }
        </button>
      )}
    </div>
  );
}
