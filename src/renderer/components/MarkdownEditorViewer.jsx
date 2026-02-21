import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import api from '../services/electronBridge';

/**
 * Split-pane Markdown Editor + Live Preview.
 * - Left: code editor (textarea)
 * - Right: rendered markdown preview
 * - Changes auto-save to file and refresh preview in real-time
 */
export default function MarkdownEditorViewer({ filePath, initialContent, onContentChange, readOnly = false }) {
  const [content, setContent] = useState(initialContent || '');
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef(null);
  const editorRef = useRef(null);

  // Sync when initialContent changes externally
  useEffect(() => {
    if (initialContent !== undefined && initialContent !== null) {
      setContent(initialContent);
      setSaved(true);
    }
  }, [initialContent]);

  // Auto-save with debounce
  const debouncedSave = useCallback((newContent) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!filePath) return;
      setSaving(true);
      try {
        await api.writeFile(filePath, newContent);
        setSaved(true);
      } catch (err) {
        console.error('Auto-save failed:', err);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [filePath]);

  const handleChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    setSaved(false);
    onContentChange?.(newContent);
    debouncedSave(newContent);
  };

  const handleManualSave = async () => {
    if (!filePath || saving) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    try {
      await api.writeFile(filePath, content);
      setSaved(true);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // Handle Tab key in editor
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      setSaved(false);
      onContentChange?.(newContent);
      debouncedSave(newContent);
      // Restore cursor position
      requestAnimationFrame(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 2;
      });
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleManualSave();
    }
  };

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-card/50">
        <span className="text-sm font-mono font-medium text-gray-300">{fileName}</span>
        <div className="flex-1" />
        {saving && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <div className="w-2 h-2 border border-gray-500 border-t-transparent rounded-full animate-spin" />
            Saving...
          </span>
        )}
        {!saving && saved && (
          <span className="text-xs text-green-500">Saved</span>
        )}
        {!saving && !saved && (
          <span className="text-xs text-amber-500">Unsaved</span>
        )}
        <button
          onClick={handleManualSave}
          disabled={saving || saved || readOnly}
          className="px-2.5 py-1 text-xs font-medium bg-surface-elevated border border-border rounded-md
                     text-gray-400 hover:text-gray-200 hover:border-border-hover transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>

      {/* Split Pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        {!readOnly && (
          <div className="w-1/2 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-600 font-semibold bg-surface border-b border-border">
              Editor
            </div>
            <textarea
              ref={editorRef}
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className="flex-1 w-full p-4 bg-surface text-gray-300 font-mono text-[13px] leading-relaxed
                         resize-none focus:outline-none placeholder-gray-600"
              placeholder="Start writing markdown..."
            />
          </div>
        )}

        {/* Preview */}
        <div className={readOnly ? 'w-full flex flex-col' : 'w-1/2 flex flex-col'}>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-600 font-semibold bg-surface border-b border-border">
            Preview
          </div>
          <div className="flex-1 overflow-y-auto p-5 bg-surface-card/30 markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
