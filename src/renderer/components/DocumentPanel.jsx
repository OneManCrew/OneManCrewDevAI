import React, { useState, useEffect, useCallback } from 'react';
import MarkdownEditorViewer from './MarkdownEditorViewer';
import api from '../services/electronBridge';
import log from '../services/logger';

/**
 * Document panel with tabs for SRS.md and HLD.md.
 * Shows editor+viewer split, Save and Next buttons.
 */
export default function DocumentPanel({ projectPath, onNext, onRequestChange }) {
  const [activeTab, setActiveTab] = useState('srs');
  const [srsContent, setSrsContent] = useState(null);
  const [hldContent, setHldContent] = useState(null);
  const [loading, setLoading] = useState(true);

  const docsPath = projectPath ? projectPath.replace(/[\\/]$/, '') + '/docs' : null;
  const srsPath = docsPath ? docsPath + '/SRS.md' : null;
  const hldPath = docsPath ? docsPath + '/HLD.md' : null;

  // Load docs from disk
  const loadDocs = useCallback(async () => {
    if (!docsPath) return;
    log.info('DocumentPanel', 'loadDocs called', { srsPath, hldPath });
    setLoading(true);
    try {
      const [srs, hld] = await Promise.all([
        api.readFile(srsPath),
        api.readFile(hldPath),
      ]);
      log.info('DocumentPanel', 'loadDocs result', { srsLen: srs?.length || 0, hldLen: hld?.length || 0 });
      setSrsContent(srs || '');
      setHldContent(hld || '');
    } catch (err) {
      log.error('DocumentPanel', 'loadDocs failed', err);
    } finally {
      setLoading(false);
    }
  }, [docsPath, srsPath, hldPath]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Reload docs (called after agent modifies them)
  const reloadDocs = useCallback(async () => {
    log.info('DocumentPanel', 'reloadDocs triggered');
    await loadDocs();
  }, [loadDocs]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-500">Loading documents...</span>
        </div>
      </div>
    );
  }

  const hasDocs = (srsContent !== null && srsContent !== '') || (hldContent !== null && hldContent !== '');

  if (!hasDocs) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-gray-500">No documents generated yet.</p>
          <p className="text-xs text-gray-600 mt-1">Complete the Architect conversation to generate SRS.md and HLD.md.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar + Actions */}
      <div className="shrink-0 flex items-center border-b border-border bg-surface-card/50">
        <div className="flex">
          <button
            onClick={() => setActiveTab('srs')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'srs'
                ? 'border-accent text-accent bg-accent/5'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            SRS.md
          </button>
          <button
            onClick={() => setActiveTab('hld')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'hld'
                ? 'border-accent text-accent bg-accent/5'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            HLD.md
          </button>
        </div>

        <div className="flex-1" />

        {/* Action Buttons */}
        <div className="flex items-center gap-2 px-3">
          <button
            onClick={reloadDocs}
            title="Reload from disk"
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-md hover:bg-surface-elevated"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {onRequestChange && (
            <button
              onClick={onRequestChange}
              className="px-3 py-1.5 text-xs font-medium bg-surface-elevated border border-border rounded-lg
                         text-gray-400 hover:text-gray-200 hover:border-border-hover transition-colors"
            >
              Request Changes
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              className="px-4 py-1.5 text-xs font-semibold bg-accent text-surface rounded-lg
                         hover:bg-accent-hover transition-colors flex items-center gap-1.5"
            >
              Next
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Editor + Viewer */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'srs' && srsContent !== null && (
          <MarkdownEditorViewer
            filePath={srsPath}
            initialContent={srsContent}
            onContentChange={(c) => setSrsContent(c)}
          />
        )}
        {activeTab === 'hld' && hldContent !== null && (
          <MarkdownEditorViewer
            filePath={hldPath}
            initialContent={hldContent}
            onContentChange={(c) => setHldContent(c)}
          />
        )}
      </div>
    </div>
  );
}

// Export a hook to check if docs exist
export async function checkExistingDocs(projectPath) {
  if (!projectPath) return { hasDocs: false, srs: null, hld: null };
  const docsPath = projectPath.replace(/[\\/]$/, '') + '/docs';
  log.info('checkExistingDocs', 'Checking', { docsPath });
  try {
    const [srs, hld] = await Promise.all([
      api.readFile(docsPath + '/SRS.md'),
      api.readFile(docsPath + '/HLD.md'),
    ]);
    log.info('checkExistingDocs', 'Result', { hasDocs: !!(srs || hld), srsLen: srs?.length || 0, hldLen: hld?.length || 0 });
    return {
      hasDocs: !!(srs || hld),
      srs: srs || null,
      hld: hld || null,
    };
  } catch (e) {
    log.error('checkExistingDocs', 'Failed', e);
    return { hasDocs: false, srs: null, hld: null };
  }
}
