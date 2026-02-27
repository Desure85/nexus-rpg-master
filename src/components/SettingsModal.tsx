import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { X, Save, Globe, Key, Cpu, Terminal, Type, Database, Copy, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import { SYSTEM_PROMPT } from '../App';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState<'model' | 'prompt' | 'mechanics' | 'appearance' | 'logs'>('model');
  const [logs, setLogs] = useState<any[]>([]);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab]);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      console.error("Failed to fetch logs", e);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#1a1614] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-display text-xl text-white">Nexus Configuration</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-white/10">
          <button 
            onClick={() => setActiveTab('model')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'model' ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
          >
            Model & Provider
          </button>
          <button 
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'prompt' ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
          >
            System Prompt
          </button>
          <button 
            onClick={() => setActiveTab('mechanics')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'mechanics' ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
          >
            Mechanics
          </button>
          <button 
            onClick={() => setActiveTab('appearance')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'appearance' ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
          >
            Appearance
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'logs' ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
          >
            Logs
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'model' ? (
            <>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Cpu size={12} /> AI Provider
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLocalSettings({ ...localSettings, provider: 'gemini' })}
                    className={`flex-1 py-3 rounded-xl border transition-all text-sm font-bold ${localSettings.provider === 'gemini' ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}
                  >
                    Gemini (Free)
                  </button>
                  <button
                    onClick={() => setLocalSettings({ ...localSettings, provider: 'local' })}
                    className={`flex-1 py-3 rounded-xl border transition-all text-sm font-bold ${localSettings.provider === 'local' ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}
                  >
                    Local Model
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Terminal size={12} /> Debugging
                </label>
                <div className="flex items-center justify-between p-4 bg-black/40 border border-white/10 rounded-xl">
                  <div className="space-y-1">
                    <p className="text-sm text-white font-medium">Enable API Logging</p>
                    <p className="text-[10px] text-white/40">Saves raw requests and responses to the database for debugging.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={localSettings.loggingEnabled}
                      onChange={(e) => setLocalSettings({ ...localSettings, loggingEnabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>
              </div>

              {localSettings.provider === 'local' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Globe size={12} /> Model Endpoint URL
                    </label>
                    <input
                      type="text"
                      value={localSettings.modelUrl}
                      onChange={(e) => setLocalSettings({ ...localSettings, modelUrl: e.target.value })}
                      placeholder="http://localhost:1234/v1"
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
                    />
                    {window.location.protocol === 'https:' && localSettings.modelUrl && localSettings.modelUrl.startsWith('http:') && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-200/80 leading-relaxed">
                        <strong className="text-amber-400 block mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Mixed Content Warning</strong>
                        This app is running on <b>HTTPS</b> (Cloud), but your model is on <b>HTTP</b> (Local). Browsers block this for security.
                        <div className="mt-2 pl-2 border-l-2 border-amber-500/20">
                          <span className="block text-white/60 mb-1">Solution: Use a tunnel like <b>ngrok</b>:</span>
                          <code className="block bg-black/40 p-1.5 rounded text-emerald-400 font-mono select-all">ngrok http 1234</code>
                          <span className="block mt-1">Then paste the https://...ngrok-free.app URL here.</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Key size={12} /> API Key
                    </label>
                    <input
                      type="password"
                      value={localSettings.apiKey}
                      onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
                      placeholder="Optional for local models"
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Cpu size={12} /> Model Name
                    </label>
                    <input
                      type="text"
                      value={localSettings.modelName}
                      onChange={(e) => setLocalSettings({ ...localSettings, modelName: e.target.value })}
                      placeholder="e.g. gpt-3.5-turbo or local-model"
                      className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-all font-mono text-sm"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={async () => {
                        const btn = document.getElementById('test-conn-btn');
                        const status = document.getElementById('test-conn-status');
                        if (btn && status) {
                          btn.setAttribute('disabled', 'true');
                          btn.textContent = 'Testing...';
                          status.textContent = '';
                          status.className = 'text-xs mt-2';
                          
                          try {
                            const baseUrl = localSettings.modelUrl.replace(/\/$/, '');
                            const url = `${baseUrl}/chat/completions`;
                            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                            if (localSettings.apiKey) headers['Authorization'] = `Bearer ${localSettings.apiKey}`;

                            const res = await fetch(url, {
                              method: 'POST',
                              headers,
                              body: JSON.stringify({
                                model: localSettings.modelName,
                                messages: [{ role: 'user', content: 'ping' }],
                                max_tokens: 1
                              })
                            });

                            if (res.ok) {
                              status.textContent = 'Connection Successful! Model responded.';
                              status.className = 'text-xs mt-2 text-emerald-400 font-bold';
                            } else {
                              status.textContent = `Error: ${res.status} ${res.statusText}`;
                              status.className = 'text-xs mt-2 text-red-400 font-bold';
                            }
                          } catch (e) {
                            status.textContent = `Connection Failed: ${e instanceof Error ? e.message : 'Unknown error'}. Check CORS/Mixed Content.`;
                            status.className = 'text-xs mt-2 text-red-400 font-bold';
                          } finally {
                            btn.removeAttribute('disabled');
                            btn.textContent = 'Test Connection';
                          }
                        }
                      }}
                      id="test-conn-btn"
                      className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white transition-all"
                    >
                      Test Connection
                    </button>
                    <p id="test-conn-status" className="text-xs mt-2"></p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <p className="text-xs text-emerald-200/80 leading-relaxed">
                    Gemini API is integrated and uses the platform's built-in key. It's free, fast, and supports massive context windows.
                  </p>
                </div>
              )}
            </>
          ) : activeTab === 'prompt' ? (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex justify-between items-center">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Terminal size={12} /> Base System Instructions
                </label>
                <button 
                  onClick={() => setLocalSettings({ ...localSettings, systemPrompt: SYSTEM_PROMPT })}
                  className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  <RotateCcw size={10} /> Reset to Default
                </button>
              </div>
              <textarea
                value={localSettings.systemPrompt}
                onChange={(e) => setLocalSettings({ ...localSettings, systemPrompt: e.target.value })}
                className="flex-1 w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-white/30 transition-all resize-none min-h-[300px]"
                placeholder="Enter the core rules for the AI Master..."
              />
              <p className="text-[10px] text-white/30 italic">
                This prompt defines the AI's role and game rules. Technical JSON schemas for the dashboard and codex will be appended automatically by the application.
              </p>
            </div>
          ) : activeTab === 'mechanics' ? (
            <div className="space-y-4 h-full flex flex-col overflow-y-auto custom-scrollbar pr-2">
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-2">Game Mechanics</p>
              {(localSettings.mechanics || []).map((mechanic, index) => (
                <div key={mechanic.id} className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={mechanic.enabled}
                        onChange={(e) => {
                          const newMechanics = [...(localSettings.mechanics || [])];
                          newMechanics[index] = { ...newMechanics[index], enabled: e.target.checked };
                          setLocalSettings({ ...localSettings, mechanics: newMechanics });
                        }}
                        className="accent-emerald-500 w-4 h-4"
                      />
                      {mechanic.name}
                    </label>
                  </div>
                  <textarea
                    value={mechanic.description}
                    onChange={(e) => {
                      const newMechanics = [...(localSettings.mechanics || [])];
                      newMechanics[index] = { ...newMechanics[index], description: e.target.value };
                      setLocalSettings({ ...localSettings, mechanics: newMechanics });
                    }}
                    className="w-full p-3 bg-black/60 border border-white/5 rounded-lg text-white/80 font-mono text-[10px] focus:outline-none focus:border-white/20 resize-none min-h-[80px]"
                  />
                </div>
              ))}
            </div>
          ) : activeTab === 'appearance' ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Type size={12} /> Font Family
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['sans', 'serif', 'mono'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setLocalSettings({ ...localSettings, fontFamily: f })}
                      className={`py-3 rounded-xl border transition-all text-xs font-bold capitalize ${localSettings.fontFamily === f ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Type size={12} /> Base Font Size ({localSettings.fontSize}px)
                </label>
                <input
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  value={localSettings.fontSize}
                  onChange={(e) => setLocalSettings({ ...localSettings, fontSize: parseInt(e.target.value) })}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                />
                <div className="flex justify-between text-[10px] text-white/20 uppercase font-bold">
                  <span>Small</span>
                  <span>Normal</span>
                  <span>Large</span>
                </div>
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-2">Preview</p>
                <p 
                  className="leading-relaxed text-white/80"
                  style={{ 
                    fontSize: `${localSettings.fontSize}px`,
                    fontFamily: localSettings.fontFamily === 'serif' ? 'serif' : localSettings.fontFamily === 'mono' ? 'monospace' : 'sans-serif'
                  }}
                >
                  The Nexus hums with a low, rhythmic vibration. You stand at the threshold of reality, where the digital and the organic blur into one.
                </p>
              </div>
            </div>
          ) : activeTab === 'logs' ? (
            <div className="space-y-4 h-full flex flex-col overflow-hidden">
              <div className="flex justify-between items-center">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Database size={12} /> API Logs (Last 100)
                </label>
                <button onClick={fetchLogs} className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 hover:text-emerald-300">
                  Refresh
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
                {logs.length === 0 ? (
                  <div className="text-white/40 text-sm text-center py-10">No logs found. Ensure logging is enabled in Model & Provider.</div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="bg-black/40 p-3 rounded-xl border border-white/10">
                      <div className="text-[10px] text-white/40 mb-2 font-mono">
                        {new Date(log.created_at).toLocaleString()} | Session: {log.session_id}
                      </div>
                      <details className="mb-2 group">
                        <summary className="text-xs text-emerald-400 cursor-pointer font-bold uppercase tracking-wider outline-none flex justify-between items-center">
                          <span>Request</span>
                          <button 
                            onClick={(e) => { e.preventDefault(); handleCopy(log.request, `req-${log.id}`); }}
                            className="text-white/40 hover:text-white flex items-center gap-1 text-[10px]"
                          >
                            {copiedId === `req-${log.id}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                            {copiedId === `req-${log.id}` ? 'Copied' : 'Copy'}
                          </button>
                        </summary>
                        <div className="mt-2 p-2 bg-black/60 rounded-lg overflow-x-auto custom-scrollbar">
                          <pre className="text-[10px] text-white/60 whitespace-pre-wrap font-mono">{log.request}</pre>
                        </div>
                      </details>
                      <details className="group">
                        <summary className="text-xs text-blue-400 cursor-pointer font-bold uppercase tracking-wider outline-none flex justify-between items-center">
                          <span>Response</span>
                          <button 
                            onClick={(e) => { e.preventDefault(); handleCopy(log.response, `res-${log.id}`); }}
                            className="text-white/40 hover:text-white flex items-center gap-1 text-[10px]"
                          >
                            {copiedId === `res-${log.id}` ? <Check size={12} className="text-blue-400" /> : <Copy size={12} />}
                            {copiedId === `res-${log.id}` ? 'Copied' : 'Copy'}
                          </button>
                        </summary>
                        <div className="mt-2 p-2 bg-black/60 rounded-lg overflow-x-auto custom-scrollbar">
                          <pre className="text-[10px] text-white/60 whitespace-pre-wrap font-mono">{log.response}</pre>
                        </div>
                      </details>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-6 bg-black/20 flex gap-3">
          <button
            onClick={() => onSave(localSettings)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl font-semibold hover:bg-white/90 transition-all"
          >
            <Save size={18} />
            Save Config
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 border border-white/10 text-white rounded-xl font-semibold hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
