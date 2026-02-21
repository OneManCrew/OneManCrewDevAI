import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ProjectSelection from './components/ProjectSelection';
import ChatInterface from './components/ChatInterface';
import UIDesignerChat from './components/UIDesignerChat';
import DevLeadChat from './components/DevLeadChat';
import CodingPhase from './components/CodingPhase';
import BugFixerChat from './components/BugFixerChat';
import SettingsPanel from './components/SettingsPanel';
import TitleBar from './components/TitleBar';
import api from './services/electronBridge';
import AgentChatModal from './components/AgentChatModal';

const VIEWS = {
  PROJECT: 'project',
  ARCHITECT: 'architect',
  UI_DESIGNER: 'ui_designer',
  DEV_LEAD: 'dev_lead',
  CODING: 'coding',
  BUG_FIXER: 'bug_fixer',
  SETTINGS: 'settings',
};

// Agent pipeline stages
const AGENTS = [
  { id: VIEWS.ARCHITECT, label: 'Architect', num: 1 },
  { id: VIEWS.UI_DESIGNER, label: 'UI Designer', num: 2 },
  { id: VIEWS.DEV_LEAD, label: 'Dev Lead', num: 3 },
  { id: VIEWS.CODING, label: 'Coding', num: 4 },
  { id: VIEWS.BUG_FIXER, label: 'Bug Fixer', num: 5 },
];

export default function App() {
  const [currentView, setCurrentView] = useState(VIEWS.PROJECT);
  const [projectPath, setProjectPath] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [agentChat, setAgentChat] = useState(null);
  const agentChatResolveRef = useRef(null);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const loaded = await api.loadSettings();
        setSettings(loaded);
        if (loaded.lastProjectPath) {
          const exists = await api.exists(loaded.lastProjectPath);
          if (exists) setProjectPath(loaded.lastProjectPath);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // Persist settings on change
  const updateSettings = useCallback(
    async (newSettings) => {
      setSettings(newSettings);
      await api.saveSettings(newSettings);
    },
    []
  );

  // ─── Agent Chat (global overlay) ─────────────────────────────────────
  const handleAgentChat = useCallback((task, question, options) => {
    return new Promise((resolve) => {
      agentChatResolveRef.current = resolve;
      setAgentChat({ task, question, options, chatHistory: [] });
      setCurrentView(VIEWS.CODING);
    });
  }, []);

  const handleAgentChatRespond = useCallback((userMessage) => {
    if (!agentChat) return;
    setAgentChat(prev => ({
      ...prev,
      chatHistory: [...(prev?.chatHistory || []), { role: 'user', text: userMessage }],
    }));
    if (agentChatResolveRef.current) {
      agentChatResolveRef.current(userMessage);
      agentChatResolveRef.current = null;
    }
    setTimeout(() => setAgentChat(null), 500);
  }, [agentChat]);

  const handleAgentChatDismiss = useCallback(() => {
    if (agentChatResolveRef.current) {
      agentChatResolveRef.current('');
      agentChatResolveRef.current = null;
    }
    setAgentChat(null);
  }, []);

  // Handle project selection — force full agent remount by clearing projectPath first
  const handleProjectSelect = useCallback(
    async (dirPath) => {
      const normalised = dirPath.replace(/[\\/]+$/, '');
      setProjectPath(null);                       // unmount all agents
      await new Promise(r => setTimeout(r, 50));  // let React flush
      setProjectPath(normalised);                 // remount with new path
      if (settings) {
        await updateSettings({ ...settings, lastProjectPath: normalised });
      }
      setCurrentView(VIEWS.ARCHITECT);
    },
    [settings, updateSettings]
  );

  if (!settingsLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TitleBar projectPath={projectPath} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
          projectPath={projectPath}
          agents={AGENTS}
        />

        <main className="flex-1 overflow-hidden relative">
          {/* Project & Settings: mount/unmount normally (no persistent state needed) */}
          {currentView === VIEWS.PROJECT && (
            <ProjectSelection
              projectPath={projectPath}
              onSelect={handleProjectSelect}
            />
          )}
          {currentView === VIEWS.SETTINGS && (
            <SettingsPanel
              settings={settings}
              onUpdate={updateSettings}
            />
          )}

          {/* Agent components: always mounted (hidden via CSS) to preserve conversation state */}
          {/* key={projectPath} forces full remount when workspace changes */}
          {projectPath && (
            <React.Fragment key={projectPath}>
              <div className={`h-full ${currentView === VIEWS.ARCHITECT ? '' : 'hidden'}`}>
                <ChatInterface
                  projectPath={projectPath}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  onOpenProject={() => setCurrentView(VIEWS.PROJECT)}
                  onNext={() => setCurrentView(VIEWS.UI_DESIGNER)}
                />
              </div>
              <div className={`h-full ${currentView === VIEWS.UI_DESIGNER ? '' : 'hidden'}`}>
                <UIDesignerChat
                  projectPath={projectPath}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  onBack={() => setCurrentView(VIEWS.ARCHITECT)}
                  onNext={() => setCurrentView(VIEWS.DEV_LEAD)}
                />
              </div>
              <div className={`h-full ${currentView === VIEWS.DEV_LEAD ? '' : 'hidden'}`}>
                <DevLeadChat
                  projectPath={projectPath}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  onBack={() => setCurrentView(VIEWS.UI_DESIGNER)}
                  onNext={() => setCurrentView(VIEWS.CODING)}
                />
              </div>
              <div className={`h-full ${currentView === VIEWS.CODING ? '' : 'hidden'}`}>
                <CodingPhase
                  projectPath={projectPath}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  onBack={() => setCurrentView(VIEWS.DEV_LEAD)}
                  onNext={() => setCurrentView(VIEWS.BUG_FIXER)}
                  onAgentChat={handleAgentChat}
                />
              </div>
              <div className={`h-full ${currentView === VIEWS.BUG_FIXER ? '' : 'hidden'}`}>
                <BugFixerChat
                  projectPath={projectPath}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                  onBack={() => setCurrentView(VIEWS.CODING)}
                />
              </div>
            </React.Fragment>
          )}
        </main>
      </div>

      {/* Global Agent Chat Modal — rendered outside hidden wrappers */}
      {agentChat && (
        <AgentChatModal
          isOpen={true}
          agentType={agentChat.task?.assignedAgent}
          taskTitle={agentChat.task?.title}
          question={agentChat.question}
          chatHistory={agentChat.chatHistory}
          onRespond={handleAgentChatRespond}
          onDismiss={handleAgentChatDismiss}
        />
      )}
    </div>
  );
}
