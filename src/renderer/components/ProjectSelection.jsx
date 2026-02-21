import React, { useState, useEffect } from 'react';
import api from '../services/electronBridge';

export default function ProjectSelection({ projectPath, onSelect }) {
  const [recentProjects, setRecentProjects] = useState([]);
  const [dirContents, setDirContents] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load directory contents when project is selected
  useEffect(() => {
    if (!projectPath) return;
    (async () => {
      try {
        const entries = await api.readDir(projectPath);
        setDirContents(entries.slice(0, 20));
      } catch {
        setDirContents([]);
      }
    })();
  }, [projectPath]);

  const handleBrowse = async () => {
    setLoading(true);
    try {
      const dir = await api.selectDirectory();
      if (dir) {
        onSelect(dir);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-5">
            <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-100 mb-2">
            Select Your Workspace
          </h1>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Choose a project directory to set the context for the AI agents.
            All generated documents will be saved within this workspace.
          </p>
        </div>

        {/* Current Selection */}
        {projectPath && (
          <div className="card mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">
                  {projectPath.split(/[\\/]/).pop()}
                </p>
                <p className="text-xs text-gray-500 font-mono truncate">
                  {projectPath}
                </p>
              </div>
            </div>

            {/* Directory contents preview */}
            {dirContents.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">
                  Contents
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {dirContents.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                    >
                      {entry.isDirectory ? (
                        <svg className="w-3.5 h-3.5 text-accent/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className="text-gray-400 truncate">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleBrowse}
            disabled={loading}
            className="btn-primary text-base px-8 py-3 flex items-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-surface border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            )}
            {projectPath ? 'Change Workspace' : 'Browse for Workspace'}
          </button>

          {!projectPath && (
            <p className="text-xs text-gray-600">
              You can also drag & drop a folder here
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
