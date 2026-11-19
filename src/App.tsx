import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Routes, Route, useParams, useNavigate, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { SettingsModal } from './components/SettingsModal';
import { DiceRoller } from './components/DiceRoller';
import { Codex } from './components/Codex';
import { CharacterView } from './components/CharacterView';
import { PromptModal, customAlert } from './components/PromptModal';
import { SessionSetup, SetupData } from './components/SessionSetup';
import { GameSession, AppSettings, Message, DashboardData, MechanicConfig, stressValue, WorkspaceInfo, CurrentUser } from './types';
import { Send, Loader2, Sparkles, BookOpen, History, Plus, Minus, Settings as SettingsIcon, Menu, X as CloseIcon, LayoutDashboard, MessageSquare, MessageSquarePlus, Dices, Download, Library, HelpCircle, Flag, Skull, Eye, Footprints, ScrollText, Users, Award, Share2, Swords, Feather } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MECHANIC_INFO, levelFromXp, INITIAL_DASHBOARD, TALE_AGES } from '../shared/rules';
import { cleanStreamForDisplay, displayUserContent } from '../shared/parse';
import { api, ApiError, useSessionSocket, characterLink, locationSearch, clearLocationSearch, getSavedWorkspace, saveWorkspace, onUnauthorized, type SocketEvent } from './api';
import { AuthScreen, ResetPasswordScreen } from './components/AuthScreen';
import { WorkspaceModal, type WorkspaceTab } from './components/WorkspaceModal';
import { AdminPanel } from './components/AdminPanel';
import { OraclePanel } from './components/OraclePanel';
import { RichParagraphs, UserContent, renderInline } from './components/RichText';
import { GuideButton } from './components/GuideModal';
import { HallModal } from './components/HallModal';
import { WorldsModal, type WorldStart } from './components/WorldsModal';
import { ACHIEVEMENTS } from '../shared/achievements';
import { TurnSummary, dashboardsBefore } from './components/TurnSummary';
import { SCENARIOS, quickScenario, type Scenario } from '../shared/scenarios';
import { dailyChallenge, DAILY_MODIFIERS } from '../shared/daily';
import { DailyCard, markDailyPlayed } from './components/DailyCard';
import { ActionChips } from './components/ActionChips';
import { DisclaimerFooter } from './components/Disclaimer';
import { customPrompt, customConfirm } from './components/PromptModal';

// В клиент не попадают тексты системного промпта: только id, название и флаг
const DEFAULT_MECHANICS = Object.entries(MECHANIC_INFO).map(([id, m]) => ({ id, name: m.title, enabled: m.on !== false, description: '' }));

const EXTRA_KEY = 'nexus_extra_instructions';
const loadExtraDefault = () => { try { return localStorage.getItem(EXTRA_KEY) || ''; } catch { return ''; } };
const saveExtraDefault = (v: string) => { try { localStorage.setItem(EXTRA_KEY, v); } catch { /* приватный режим */ } };


interface SessionListItem { id: string; name: string; mode?: string; setting?: string; updated_at: string; turns?: number; busy?: boolean }

interface ServerConfig {
  registration: 'open' | 'invite' | 'closed';
  payments: 'none' | 'yookassa' | 'mock';
  llm: { provider: string; forcedByEnv: boolean; keyPresent: boolean };
}

const ResetRoute: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  return <ResetPasswordScreen token={token} onDone={() => { onDone(); navigate('/', { replace: true }); }} />;
};

/** Приглашение мастера в пространство: /invite/:token */
/** Ссылка на мир: открываем каталог миров с этим миром и уходим на главную. */
const WorldLinkRoute: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { worldId } = useParams();
  useEffect(() => { if (worldId) onOpen(worldId); }, [worldId]);
  return <Navigate to="/" replace />;
};

const InviteRoute: React.FC<{ user: CurrentUser | null; registration: ServerConfig['registration']; onAccepted: (wid?: string) => void }> = ({ user, registration, onAccepted }) => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    api<{ workspaceId: string }>(`/api/invites/${token}/accept`, { body: {} })
      .then(r => { onAccepted(r.workspaceId); navigate('/', { replace: true }); })
      .catch(e => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, [user, token]);
  if (!user) return <AuthScreen registration={registration} inviteToken={token} onDone={() => onAccepted()} />;
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-[#0a0502] text-white/60 text-sm">
      {error ? <><p className="text-red-400">{error}</p><button onClick={() => navigate('/')} className="underline">На главную</button></> : <Loader2 className="animate-spin" />}
    </div>
  );
};

const APPEARANCE_KEY = 'nexus_appearance';
const loadAppearance = (): { fontSize: number; fontFamily: 'sans' | 'serif' | 'mono' } => {
  try {
    const a = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
    return { fontSize: Number(a.fontSize) || 16, fontFamily: ['sans', 'serif', 'mono'].includes(a.fontFamily) ? a.fontFamily : 'sans' };
  } catch { return { fontSize: 16, fontFamily: 'sans' }; }
};

const TALE_END_COMMAND = '[TALE_END] Заверши сказку этой главой: счастливый (или светлый) конец.';

export default function App() {
  const [authState, setAuthState] = useState<'loading' | 'anon' | 'ready'>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(getSavedWorkspace());
  const [wsModal, setWsModal] = useState<WorkspaceTab | null>(null);
  const [adminView, setAdminView] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [turnErrorCode, setTurnErrorCode] = useState<string | null>(null);
  const [oracleStatus, setOracleStatus] = useState<{ state: 'idle' | 'generating' | 'error'; error?: string; tick: number }>({ state: 'idle', tick: 0 });
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [currentSession, setCurrentSession] = useState<GameSession | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupPreset, setSetupPreset] = useState<{ mode: 'short' | 'campaign' | 'tale'; multiplayer: boolean }>({ mode: 'short', multiplayer: false });
  const [settings, setSettings] = useState<AppSettings>(() => ({
    provider: 'gemini',
    modelUrl: '',
    apiKey: '',
    modelName: '',
    extraInstructions: loadExtraDefault(),
    loggingEnabled: false,
    idlePlayerAction: 'random',
    mechanics: DEFAULT_MECHANICS,
    ...loadAppearance(),
  }));
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [canEditGlobal, setCanEditGlobal] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDiceTrayOpen, setIsDiceTrayOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'narrative' | 'dashboard'>('narrative');
  const [isBookView, setIsBookView] = useState(false);
  const [confirmFinale, setConfirmFinale] = useState(false);
  const [pendingRolls, setPendingRolls] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [travelEvent, setTravelEvent] = useState<{ type: 'encounter' | 'discovery' | 'safe', locationName: string } | null>(null);
  const [pendingClaims, setPendingClaims] = useState<any[]>([]);
  const seenClaims = useRef(new Set<string>());
  const claimsPrimed = useRef(false);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [gmActionInputs, setGmActionInputs] = useState<Record<string, string>>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [showTaleBook, setShowTaleBook] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'dashboard' | 'lore' | 'codex' | 'players'>('dashboard');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentSession?.id || null;

  const [hallOpen, setHallOpen] = useState(false);
  const [worldsOpen, setWorldsOpen] = useState<{ openId?: string } | null>(null);
  const isTale = currentSession?.mode === 'tale';
  const dashBefore = useMemo(() => dashboardsBefore(currentSession?.history || []), [currentSession?.history]);
  const taleFinished = !!currentSession?.config?.tale?.finished;

  // Механики/промпт текущей сессии (снимок при создании) поверх глобальных настроек
  const effectiveSettings: AppSettings = {
    ...settings,
    mechanics: currentSession?.config?.mechanics || settings.mechanics,
    // пожелания мастеру: у открытой сессии — свои, иначе — личные по умолчанию для новых игр
    extraInstructions: currentSession ? (currentSession.config?.extraInstructions || '') : settings.extraInstructions,
    idlePlayerAction: currentSession?.config?.idlePlayerAction || settings.idlePlayerAction,
  };

  const reportError = (e: unknown, prefix = 'Ошибка') => {
    const msg = e instanceof Error ? e.message : String(e);
    void customAlert(`${prefix}: ${msg}`);
  };

  // ------------------------------ загрузка ------------------------------
  const workspace = workspaces.find(w => w.id === workspaceId) || workspaces[0] || null;
  const workspaceIdRef = useRef<string | null>(null);
  workspaceIdRef.current = workspace?.id || null;

  const showToast = (text: string) => { setToast(text); setTimeout(() => setToast(null), 5000); };

  /** Кто я и в каких пространствах. */
  const loadMe = async (preferWs?: string) => {
    try {
      const me = await api<{ user: CurrentUser; workspaces: WorkspaceInfo[] }>('/api/auth/me');
      setUser(me.user);
      setWorkspaces(me.workspaces);
      const wanted = preferWs || workspaceIdRef.current || getSavedWorkspace();
      const ws = me.workspaces.find(w => w.id === wanted) || me.workspaces[0];
      if (ws) { setWorkspaceId(ws.id); saveWorkspace(ws.id); }
      setAuthState('ready');
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setUser(null); setAuthState('anon'); }
      else { console.error('me', e); setAuthState('anon'); }
      return null;
    }
  };

  const switchWorkspace = (id: string) => {
    setWorkspaceId(id);
    saveWorkspace(id);
    setCurrentSession(null);
    setAdminView(false);
    localStorage.removeItem('nexus_last_session');
  };

  const fetchSessions = async (wid = workspaceIdRef.current) => {
    if (!wid) return;
    try { setSessions(await api<SessionListItem[]>(`/api/workspaces/${wid}/sessions`)); } catch (e) { console.error('sessions', e); }
  };

  const logout = async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    setUser(null);
    setWorkspaces([]);
    setCurrentSession(null);
    setSessions([]);
    setIsSettingsOpen(false);
    setAuthState('anon');
  };

  const loadSessionById = async (id: string) => {
    const data = await api<GameSession>(`/api/sessions/${id}`);
    if (currentIdRef.current === id || currentIdRef.current === null) {
      setCurrentSession(data);
      if (!data.busy) { setIsLoading(false); setStreamingText(null); }
    }
    return data;
  };

  const fetchSettings = async () => {
    try {
      const data = await api<any>('/api/settings');
      setCanEditGlobal(!!data.canEdit);
      setSettings(prev => ({
        ...prev,
        provider: data.provider || prev.provider,
        modelUrl: data.modelUrl ?? '',
        apiKey: data.apiKey ?? '',
        modelName: data.modelName ?? '',
        openRouterApiKey: data.openRouterApiKey ?? '',
        openRouterModel: data.openRouterModel ?? '',
        loggingEnabled: !!data.loggingEnabled,
        idlePlayerAction: data.idlePlayerAction || 'random',
        mechanics: Array.isArray(data.mechanics) ? data.mechanics : DEFAULT_MECHANICS,
      }));
    } catch (e) { console.error('settings', e); }
    try { setServerConfig(await api<ServerConfig>('/api/config')); } catch (e) { console.error('config', e); }
    if (workspaceIdRef.current) loadMe(workspaceIdRef.current).catch(() => undefined);
  };

  useEffect(() => {
    onUnauthorized(() => { setUser(null); setAuthState('anon'); });
    api<ServerConfig>('/api/config').then(setServerConfig).catch(() => undefined);
    loadMe();
    return () => onUnauthorized(null);
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    fetchSettings();
    // возврат с оплаты: перепроверяем платёж и показываем результат
    const params = new URLSearchParams(locationSearch());
    const pid = params.get('payment');
    if (pid && workspaceIdRef.current) {
      clearLocationSearch();
      api<any>(`/api/workspaces/${workspaceIdRef.current}/payments/${pid}/refresh`, { body: {} })
        .then(p => { showToast(p.status === 'succeeded' ? `Оплата прошла: +${p.credits} кредитов` : p.status === 'pending' ? 'Платёж ещё обрабатывается — баланс обновится автоматически' : 'Оплата не завершена'); loadMe(); })
        .catch(() => undefined);
    }
  }, [authState]);

  useEffect(() => {
    if (authState !== 'ready' || !workspace?.id) return;
    fetchSessions(workspace.id);
    // восстановить последнюю открытую сессию
    const last = localStorage.getItem('nexus_last_session');
    if (last && !currentSession) loadSessionById(last).catch(() => localStorage.removeItem('nexus_last_session'));
  }, [authState, workspace?.id]);

  useEffect(() => {
    if (currentSession?.id) localStorage.setItem('nexus_last_session', currentSession.id);
  }, [currentSession?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentSession?.history.length, streamingText === null]);

  // ------------------------------ живые события ------------------------------
  const onSocketEvent = (e: SocketEvent) => {
    const id = currentIdRef.current;
    if (!id || e.sessionId !== id) return;
    switch (e.type) {
      case 'joined':
      case 'busy':
        setIsLoading(e.busy);
        if (!e.busy) setStreamingText(null);
        break;
      case 'turn_start':
        setTurnError(null);
        setStreamingText('');
        break;
      case 'delta':
        setStreamingText(prev => (prev ?? '') + e.text);
        break;
      case 'achievement':
        for (const code of e.codes) {
          const a = ACHIEVEMENTS.find(x => x.code === code);
          if (a) showToast(`${a.icon} Достижение: «${a.title}» — ${a.desc}`);
        }
        break;
      case 'turn_end':
        setStreamingText(null);
        if (e.sessionSummary) setSessionSummary(e.sessionSummary);
        if (e.taleFinished) setShowTaleBook(true);
        break;
      case 'turn_error':
        setStreamingText(null);
        setTurnError(e.error);
        setTurnErrorCode(e.code || null);
        if (e.code === 'insufficient_credits') loadMe();
        break;
      case 'update':
        loadSessionById(id).catch(() => undefined);
        fetchSessions();
        break;
      case 'claims_changed':
      case 'actions_changed':
        fetchPanels();
        break;
      case 'oracle':
        setOracleStatus(prev => ({ state: e.status === 'generating' ? 'generating' : e.status === 'error' ? 'error' : 'idle', error: e.error, tick: prev.tick + 1 }));
        if (e.status === 'error' && currentSession?.isOwner) showToast('Таблицы оракула не обновились — мастер использует стандартные. Можно перегенерировать в панели оракула.');
        break;
      case 'level_up':
        showToast(`Новый уровень: ${(e as any).leveled.join(', ')}. Способности появятся в следующем ходе.`);
        break;
      case 'deleted':
        setCurrentSession(null);
        fetchSessions();
        break;
    }
  };
  useSessionSocket(currentSession?.id, onSocketEvent, () => { if (currentIdRef.current) loadSessionById(currentIdRef.current).catch(() => undefined); fetchPanels(); });

  // ------------------------------ настройки ------------------------------
  const updateAppearance = (patch: Partial<Pick<AppSettings, 'fontSize' | 'fontFamily'>>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ fontSize: next.fontSize, fontFamily: next.fontFamily }));
      return next;
    });
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    updateAppearance({ fontSize: newSettings.fontSize, fontFamily: newSettings.fontFamily });
    try {
      if (canEditGlobal) {
        const { extraInstructions: _personal, ...globalPart } = newSettings;
        await api('/api/settings', { body: globalPart });
      }
      if (currentSession?.isOwner) {
        const updated = await api<GameSession>(`/api/sessions/${currentSession.id}`, {
          method: 'PATCH',
          body: { config: { mechanics: newSettings.mechanics, extraInstructions: newSettings.extraInstructions || '', idlePlayerAction: newSettings.idlePlayerAction } },
        });
        setCurrentSession(updated);
      }
      saveExtraDefault(newSettings.extraInstructions || '');
      setSettings(prev => ({ ...prev, extraInstructions: newSettings.extraInstructions || '' }));
      await fetchSettings();
      setIsSettingsOpen(false);
    } catch (e) {
      reportError(e, 'Не удалось сохранить настройки');
    }
  };

  // ------------------------------ сессии ------------------------------
  const handleNewSession = (preset?: { mode: 'short' | 'campaign' | 'tale'; multiplayer: boolean }) => {
    setSetupPreset(preset || { mode: 'short', multiplayer: false });
    setIsSettingUp(true);
  };

  const handleSelectSession = async (id: string) => {
    setStreamingText(null);
    setTurnError(null);
    setIsLoading(false);
    setPendingRolls({});
    currentIdRef.current = id;
    try { await loadSessionById(id); } catch (e) { reportError(e, 'Не удалось открыть сессию'); }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSession?.id === id) { setCurrentSession(null); localStorage.removeItem('nexus_last_session'); }
    } catch (e) { reportError(e, 'Не удалось удалить'); }
  };

  const fetchPanels = async () => {
    const id = currentIdRef.current;
    if (!id) return;
    try {
      const [c, a] = await Promise.all([api(`/api/sessions/${id}/claims`), api(`/api/sessions/${id}/pending`)]);
      const list: any[] = Array.isArray(c) ? c : [];
      // новая заявка — мастер должен заметить её сразу, даже если панель «Игроки» закрыта
      const fresh = list.filter(x => x.status === 'pending' && !seenClaims.current.has(x.id));
      list.forEach(x => seenClaims.current.add(x.id));
      if (fresh.length && claimsPrimed.current) {
        showToast(`🙋 ${fresh[0].player_name} хочет играть за ${fresh[0].char_name} — подтвердите во вкладке «Игроки»`);
        setRightPanelTab('players');
      }
      claimsPrimed.current = true;
      setPendingClaims(list);
      setPendingActions(Array.isArray(a) ? a : []);
    } catch (e) { console.error('Panels fetch error', e); }
  };

  useEffect(() => {
    setPendingClaims([]);
    setPendingActions([]);
    claimsPrimed.current = false;
    if (currentSession?.id) fetchPanels();
  }, [currentSession?.id]);

  const sessionPost = async (path: string, body?: unknown) => {
    if (!currentSession) throw new Error('Нет активной сессии');
    return api<any>(`/api/sessions/${currentSession.id}${path}`, { method: 'POST', body: body ?? {} });
  };

  /** Ошибки игровых сервисов приходят с человекочитаемым тегом — показываем его */
  const serviceCall = async (path: string, body: unknown, tagPrefix: string) => {
    try {
      return await sessionPost(path, body);
    } catch (e) {
      showToast((e instanceof Error ? e.message : 'Ошибка').replace(new RegExp(`^\\[${tagPrefix}: |\\]$`, 'g'), ''));
      return null;
    }
  };

  const approveClaim = (cid: string) => sessionPost(`/claims/${cid}/approve`).then(fetchPanels).catch(e => reportError(e));
  const rejectClaim = (cid: string) => sessionPost(`/claims/${cid}/reject`).then(fetchPanels).catch(e => reportError(e));
  const releaseClaim = (cid: string) => sessionPost(`/claims/${cid}/release`).then(fetchPanels).catch(e => reportError(e));
  const removeAction = (aid: string) => api(`/api/sessions/${currentSession!.id}/actions/${aid}`, { method: 'DELETE' }).then(fetchPanels).catch(e => reportError(e));

  const setAutoApprove = async (value: boolean) => {
    if (!currentSession) return;
    try {
      setCurrentSession(await api<GameSession>(`/api/sessions/${currentSession.id}`, { method: 'PATCH', body: { config: { autoApprove: value } } }));
    } catch (e) { reportError(e); }
  };

  const copyInvite = async (charName: string) => {
    if (!currentSession) return;
    const link = characterLink(currentSession.id, charName);
    try { await navigator.clipboard.writeText(link); } catch { await customPrompt('Скопируйте ссылку для игрока:', link); }
    setCopiedLink(charName);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const handleSearchLocation = async () => {
    const loc = currentDashboard.locations?.find((l: any) => l.id === currentDashboard.currentLocationId);
    const data = await serviceCall('/search', { target: 'location', dangerLevel: loc?.dangerLevel || 1 }, 'LOOT');
    if (data) sendMessage(`[SEARCH] ${data.tag || ''}\nПерсонажи обыскивают локацию (${loc?.name || 'текущую'}). Опиши находки (они уже лежат в sceneLoot) коротко и атмосферно.`);
  };

  const handleSearchBody = async (threatName: string) => {
    const data = await serviceCall('/search', { target: 'body', targetName: threatName, dangerLevel: 1 }, 'LOOT');
    if (data) sendMessage(`[SEARCH BODY] ${data.tag || ''}\nПерсонажи обыскивают тело ${threatName}. Опиши находки (они уже в sceneLoot).`);
  };

  const handleParty = (charName: string, status: string) => serviceCall('/party', { charName, status }, 'PARTY');
  const handleClaimBase = (name: string) => serviceCall('/base/claim', { name }, 'BASE');
  const handleUpgradeBase = async (building: string) => newsToast((await serviceCall('/base-upgrade', { building }, 'BASE'))?.tag);
  const handleTrain = async (charName: string) => newsToast((await serviceCall('/train', { charName }, 'TRAIN'))?.tag);
  const handleHire = async (charName: string, tier: string) => newsToast((await serviceCall('/expedition', { charName, tier }, 'EXPEDITION'))?.tag);

  const handleClaimExpeditions = async () => {
    const d = await serviceCall('/expeditions/claim', {}, 'EXPEDITION');
    if (d?.tag) showToast(`${d.tag.replace(/^\[EXPEDITION: |\]$/g, '')}. Мастер расскажет об этом в следующем ходе.`);
    else if (d) showToast('Наёмники ещё в пути');
  };

  const handleAcceptQuest = (title: string) =>
    sendMessage(`[ACCEPT QUEST] Партия принимает квест «${title}». Статус квеста движок уже отметил — начни сцену.`);

  // Хозяйственные действия не тратят отдельный ход ИИ: числа меняет движок, мастер расскажет в следующем ходе
  const newsToast = (tag?: string) => { if (tag) showToast(`${tag.replace(/^\[[A-Z ]+: |\]$/g, '')}. Мастер вплетёт это в следующий ход.`); };

  const handleCarouse = async (charName: string) => {
    const d = await serviceCall('/carouse', { charName }, 'CAROUSE');
    newsToast(d?.tag);
  };

  const handleEconomy = async (action: string, charName: string, item?: string) => {
    const data = await serviceCall('/economy', { action, charName, item }, 'ECONOMY');
    newsToast(data?.tag);
  };

  const submitGmAction = async (charName: string) => {
    if (!gmActionInputs[charName]?.trim()) return;
    try {
      await sessionPost('/gm-action', { charName, action: gmActionInputs[charName].trim() });
      setGmActionInputs(prev => ({ ...prev, [charName]: '' }));
      fetchPanels();
    } catch (e) { reportError(e); }
  };

  const confirmRound = async () => {
    if (!currentSession || pendingActions.length === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      await sessionPost('/commit');
      setIsLoading(true);
      setTurnError(null);
    } catch (e) {
      reportError(e, 'Не удалось подтвердить ход');
    } finally {
      setIsConfirming(false);
    }
  };

  // Idle: пассивный доход и «живой мир», пока героев не было (только кампании)
  useEffect(() => {
    if (!currentSession?.isOwner || currentSession.mode !== 'campaign') return;
    let cancelled = false;
    (async () => {
      try {
        const id = currentSession.id;
        const idle = await api<any>(`/api/sessions/${id}/idle`, { method: 'POST', body: {} });
        const exp = await api<any>(`/api/sessions/${id}/expeditions/claim`, { method: 'POST', body: {} });
        // Вести копятся на сервере и уйдут мастеру вместе со следующим ходом — без отдельного платного вызова ИИ
        const parts = [idle?.idleGold > 0 ? `+${idle.idleGold} золота за ${idle.hours} ч` : '', exp?.claimed?.length ? `вернулись наёмники (${exp.claimed.length})` : '', idle?.newsTag ? 'мир не стоял на месте' : ''].filter(Boolean);
        if (!cancelled && parts.length) showToast(`Пока вас не было: ${parts.join(', ')}. Подробности — в следующем ходе.`);
      } catch (e) { console.error('Idle error', e); }
    })();
    return () => { cancelled = true; };
  }, [currentSession?.id]);

  const handleUpdateDashboard = (newData: DashboardData) => {
    if (!currentSession) return;
    // оптимистично показываем правку, сервер синхронизирует числа движка
    const newHistory = [...currentSession.history];
    let idx = -1;
    for (let i = newHistory.length - 1; i >= 0; i--) if (newHistory[i].dashboard) { idx = i; break; }
    if (idx >= 0) newHistory[idx] = { ...newHistory[idx], dashboard: newData };
    else newHistory.push({ role: 'system', content: 'Manual Dashboard Update', dashboard: newData });
    setCurrentSession({ ...currentSession, history: newHistory });
    sessionPost('/dashboard', { dashboard: newData }).catch(e => reportError(e, 'Правка не сохранилась'));
  };

  const generateIdea = async (prompt: string): Promise<string> => {
    const data = await api<{ text: string }>('/api/generate', { body: { prompt, workspaceId: workspace?.id } });
    return data.text || '';
  };

  /** Готовый сценарий: без формы и без лишних запросов к ИИ — сразу в игру. */
  const startScenario = (sc: Scenario) => handleStartAdventure({
    title: sc.title,
    setting: sc.setting,
    plotHook: sc.plotHook,
    style: sc.style,
    mode: sc.mode,
    characters: sc.heroes.slice(0, sc.mode === 'tale' ? 1 : 1).map((h, k) => ({ id: String(k), name: h.name, concept: h.concept, gender: h.gender, archetype: h.archetype })),
    tale: sc.tale,
  } as SetupData);

  const startDaily = (key: string) => {
    const dc = dailyChallenge(key);
    const h = dc.scenario.heroes[0];
    markDailyPlayed(key);
    return handleStartAdventure({
      title: `${dc.scenario.title} · испытание дня`,
      setting: dc.scenario.setting,
      plotHook: dc.plotHook,
      style: dc.scenario.style,
      mode: 'short',
      daily: key,
      characters: [{ id: '0', name: h.name, concept: h.concept, gender: h.gender, archetype: h.archetype }],
    } as SetupData);
  };

  const startWorld = (w: WorldStart) => {
    setWorldsOpen(null);
    return handleStartAdventure({
      title: w.title,
      setting: '',
      plotHook: '',
      style: w.mode === 'tale' ? 'fairytale' : 'balanced',
      mode: w.mode,
      worldId: w.worldId,
      scenarioId: w.scenarioId,
      characters: w.characters.map((h, k) => ({ id: String(k), name: h.name, concept: h.concept, gender: h.gender, archetype: h.archetype })),
    } as SetupData);
  };

  const handleStartAdventure = async (setup: SetupData) => {
    try {
      const created = await api<GameSession>('/api/sessions', {
        body: {
          workspaceId: workspace?.id,
          setup,
          config: {
            mechanics: settings.mechanics,
            extraInstructions: settings.extraInstructions?.trim() || undefined,
            idlePlayerAction: settings.idlePlayerAction,
            autoApprove: setup.autoApprove,
          },
        },
      });
      currentIdRef.current = created.id;
      setCurrentSession(created);
      setIsSettingUp(false);
      setIsLoading(true);
      setTurnError(null);
      setStreamingText(null);
      if (setup.multiplayer) { setRightPanelTab('players'); }
      fetchSessions();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'insufficient_credits' || e.code === 'plan_limit')) {
        if (await customConfirm(`${e.message}\n\nОткрыть баланс пространства?`)) setWsModal('billing');
        return;
      }
      reportError(e, 'Не удалось начать игру');
    }
  };

  /** Ход мастера: сервер сам добавит проверки встречи/состояния, вызовет ИИ и разошлёт ответ всем. */
  const sendMessage = async (content: string) => {
    const session = currentSession;
    if (!session) return;
    const rolls = Object.values(pendingRolls) as string[];
    const lastIsUser = session.history[session.history.length - 1]?.role === 'user';
    if (!content.trim() && rolls.length === 0 && !lastIsUser) return;
    const optimistic = [content.trim(), rolls.length ? `### GM Rolls:\n${rolls.join('\n')}` : ''].filter(Boolean).join('\n\n');
    if (optimistic) setCurrentSession({ ...session, history: [...session.history, { role: 'user', content: optimistic }] });
    setInput('');
    setPendingRolls({});
    setTurnError(null);
    setIsLoading(true);
    try {
      await api(`/api/sessions/${session.id}/turn`, { body: { content, rolls } });
    } catch (e) {
      setIsLoading(false);
      setTurnError(e instanceof Error ? e.message : 'Ошибка');
      loadSessionById(session.id).catch(() => undefined);
    }
  };

  const handleRoll = (result: string) => {
    setInput(prev => prev ? `${prev}\n${result}` : result);
  };

  const downloadEveningStory = () => {
    if (!currentSession) return;
    const d = currentDashboard;
    const date = new Date().toLocaleDateString('ru-RU');
    const parts: string[] = [];
    parts.push(`# ${currentSession.name}`);
    parts.push('');
    parts.push(`*Сеттинг:* ${currentSession.setting || '—'}`);
    parts.push(`*Стиль:* ${currentSession.style || '—'}`);
    parts.push(`*Формат:* ${currentSession.mode === 'campaign' ? '🗺️ Кампания' : '⚡ Партия на вечер'}`);
    parts.push(`*Дата:* ${date}`);
    parts.push('');
    if (sessionSummary) {
      parts.push(`## Итоги вечера`);
      parts.push('');
      parts.push(sessionSummary);
      parts.push('');
    }
    if (currentSession.archive) {
      parts.push(`## Хроника`);
      parts.push('');
      parts.push(currentSession.archive);
      parts.push('');
    }
    if (currentSession.lore) {
      parts.push(`## Архив мира`);
      parts.push('');
      parts.push(currentSession.lore);
      parts.push('');
    }
    if (d.characters && d.characters.length > 0) {
      parts.push(`## Персонажи к концу вечера`);
      parts.push('');
      for (const c of d.characters) {
        parts.push(`### ${c.name}`);
        parts.push(`- Уровень: ${levelFromXp(Number((c as any).xp || 0))} (${(c as any).xp || 0} XP)`);
        parts.push(`- HP: ${c.hp} · Стресс: ${c.stress} · Золото: ${(c as any).gold ?? 0}`);
        if ((c as any).abilities?.length) parts.push(`- Способности: ${(c as any).abilities.map((a: any) => a.name).join(', ')}`);
        parts.push('');
      }
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.name.replace(/\s+/g, '_')}_История_вечера.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEveningStoryPDF = () => {
    if (!currentSession) return;
    const d = currentDashboard;
    const date = new Date().toLocaleDateString('ru-RU');
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const md = (s: string) => esc(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
    const sections: string[] = [];
    const section = (title: string, body: string) => sections.push(`<h2>${title}</h2><div class="body">${md(body)}</div>`);
    if (sessionSummary) section('Итоги вечера', sessionSummary);
    if (currentSession.archive) section('Хроника', currentSession.archive);
    if (currentSession.lore) section('Архив мира', currentSession.lore);
    if (d.characters && d.characters.length > 0) {
      const chars = d.characters.map((c: any) => `
        <div class="char">
          <h3>${esc(c.name)}</h3>
          <p class="char-line">Уровень ${levelFromXp(Number(c.xp || 0))} (${c.xp || 0} XP) · HP ${c.hp} · Стресс ${c.stress} · Золото ${c.gold ?? 0}</p>
          ${c.abilities?.length ? `<p class="char-line"><em>Способности:</em> ${c.abilities.map((a: any) => a.name).join(', ')}</p>` : ''}
        </div>`).join('');
      sections.push(`<h2>Персонажи к концу вечера</h2>${chars}`);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(currentSession.name)} — история вечера</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 760px; margin: 48px auto; padding: 0 32px; color: #2a2118; background: #faf6ec; line-height: 1.65; }
  h1 { font-size: 2.1em; color: #4a2c0a; border-bottom: 2px solid #b8860b; padding-bottom: 10px; margin-bottom: 6px; }
  .meta { color: #7a6a50; font-style: italic; margin-top: 0; }
  h2 { color: #8b6914; margin-top: 34px; border-bottom: 1px solid #d8c9a8; padding-bottom: 5px; font-size: 1.3em; }
  h3 { color: #5a3a10; margin-bottom: 4px; }
  .body { text-align: justify; }
  .body strong { color: #4a2c0a; }
  .char { margin: 14px 0; }
  .char-line { margin: 3px 0; color: #5a4a33; font-size: 0.95em; }
  @media print { body { background: #fff; } }
</style></head><body>
  <h1>${esc(currentSession.name)}</h1>
  <p class="meta">${esc(currentSession.setting || '')} · ${esc(currentSession.style || '')} · ${currentSession.mode === 'campaign' ? 'Кампания' : 'Партия на вечер'} · ${date}</p>
  ${sections.join('\n')}
</body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (win) { win.focus(); win.print(); }
      setTimeout(() => document.body.removeChild(iframe), 60000);
    };
    iframe.srcdoc = html;
  };

  const exportBook = () => {
    if (!currentSession) return;
    
    const dashboard = currentSession.history.slice().reverse().find(m => m.dashboard)?.dashboard || INITIAL_DASHBOARD;
    
    let content = `# ${currentSession.name}\n\n`;
    content += `**Genre:** ${currentSession.genre}\n`;
    content += `**Setting:** ${currentSession.setting}\n`;
    content += `**Style:** ${currentSession.style}\n\n`;
    
    content += `## 🌍 LORE & WORLD\n${currentSession.lore || 'Архив пока пуст.'}\n\n`;
    
    if (currentSession.codex.length > 0) {
      content += `## 📖 CODEX\n\n`;
      const types = ['npc', 'location', 'item', 'lore'];
      types.forEach(type => {
        const entries = currentSession.codex.filter(e => e.type === type);
        if (entries.length > 0) {
          const icons: Record<string, string> = { npc: '👥', location: '📍', item: '⚔️', lore: '📜' };
          content += `### ${icons[type] || ''} ${type.toUpperCase()}S\n`;
          entries.forEach(e => {
            content += `**${e.name}**\n${e.description}\n*Status: ${e.status || 'Unknown'}*\n\n`;
          });
        }
      });
    }
    
    content += `## 🛡️ PARTY STATUS\n\n`;
    dashboard.characters.forEach(c => {
      content += `### 👤 ${c.name}\n`;
      content += `- ❤️ **HP:** ${c.hp}\n`;
      content += `- 🧠 **Stress:** ${c.stress}/10\n`;
      content += `- 🪙 **Tokens:** ${c.tokens}\n`;
      content += `- 🩹 **Condition:** ${c.condition}\n`;
      if (c.equipment && c.equipment.length > 0) {
        content += `- 🎒 **Equipment:**\n`;
        c.equipment.forEach(e => {
          const itemName = typeof e.item === 'object' ? e.item?.name : e.item;
          const bonus = typeof e.item === 'object' ? e.item?.bonus : null;
          if (itemName) content += `  - *${e.slot}:* ${itemName}${bonus ? ` (${bonus})` : ''}\n`;
        });
      }
      content += `\n---\n\n`;
    });
    
    content += `## 📜 THE CHRONICLE\n\n`;
    currentSession.history.forEach(m => {
      if (m.role === 'assistant') {
        content += `${m.content}\n\n---\n\n`;
      } else if (m.role === 'user') {
        content += `> **Player:** ${m.content}\n\n`;
      }
    });
    
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.name.replace(/\s+/g, '_')}_Chronicle.md`;
    a.click();
  };

  const exportSkillFormat = async () => {
    if (!currentSession) return;
    try {
      const data = await api<any>(`/api/sessions/${currentSession.id}/export`);
      if (data.status !== 'ok') throw new Error(data.error || 'export failed');
      const download = (name: string, content: string, type: string) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      };
      download(`${currentSession.id}.session.json`, JSON.stringify(data.session_json, null, 2), 'application/json');
      download(`${currentSession.id}.archive.md`, data.archive_md || '# Story Archive\n\n(пусто)', 'text/markdown');
      download(`${currentSession.id}.timeline.md`, data.timeline_md || '(пусто)', 'text/markdown');
    } catch (e) {
      console.error("Skill export error:", e);
      void customAlert(`Экспорт не удался: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    }
  };

  const taleText = () => {
    if (!currentSession) return '';
    if (currentSession.archive) return currentSession.archive;
    const chapters = currentSession.history.filter(m => m.role === 'assistant').map(m => m.content);
    return [`# ${currentSession.name}`, ...chapters].join('\n\n');
  };

  const downloadTale = () => {
    if (!currentSession) return;
    const blob = new Blob([taleText()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentSession.config?.tale?.title || currentSession.name).replace(/[\\/:*?"<>|\s]+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printTale = () => {
    if (!currentSession) return;
    const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts = taleText().split('\n\n');
    const title = (parts[0] || '').replace(/^#\s*/, '');
    const body = parts.slice(1).map(p => /^\*.*\*$/.test(p.trim()) ? `<p class="moral">${esc(p.replace(/^\*|\*$/g, ''))}</p>` : `<p>${esc(p)}</p>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:Georgia,'Times New Roman',serif;max-width:680px;margin:48px auto;padding:0 32px;color:#2a2118;background:#fffaf0;line-height:1.75;font-size:17px}
      h1{text-align:center;color:#6b3e0a;font-size:2em;margin-bottom:1.5em}
      p{text-indent:1.5em;margin:0 0 .8em}
      p.moral{text-align:center;font-style:italic;text-indent:0;margin-top:2em;color:#6b5a40}
      @media print{body{background:#fff}}
    </style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 60000);
    };
    iframe.srcdoc = html;
  };

  const currentDashboard = currentSession?.history.slice().reverse().find(m => m.dashboard)?.dashboard || INITIAL_DASHBOARD;

  const createWorkspace = async () => {
    const name = await customPrompt('Название нового пространства (клуб, семья, команда):');
    if (!name?.trim()) return;
    try {
      const ws = await api<WorkspaceInfo>('/api/workspaces', { body: { name: name.trim() } });
      await loadMe(ws.id);
      switchWorkspace(ws.id);
    } catch (e) { reportError(e); }
  };

  const gate = (node: React.ReactNode) =>
    authState === 'loading' ? (
      <div className="h-[100dvh] flex items-center justify-center bg-[#0a0502]"><Loader2 className="animate-spin text-white/40" /></div>
    ) : authState === 'anon' ? (
      <AuthScreen registration={serverConfig?.registration || 'open'} onDone={() => loadMe()} />
    ) : node;

  return (
    <Routes>
      <Route path="/character/:sessionId/:charName" element={<><CharacterView /><PromptModal /></>} />
      <Route path="/invite/:token" element={authState === 'loading' ? gate(null) : <InviteRoute user={user} registration={serverConfig?.registration || 'open'} onAccepted={(wid) => loadMe(wid)} />} />
      <Route path="/reset/:token" element={<ResetRoute onDone={() => loadMe()} />} />
      <Route path="/world/:worldId" element={gate(<WorldLinkRoute onOpen={id => setWorldsOpen({ openId: id })} />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
      <Route path="/" element={gate(
        <div className="flex h-screen h-[100dvh] bg-[#0a0502] overflow-hidden relative">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Responsive */}
      <div className={`fixed inset-y-0 left-0 z-50 lg:relative lg:translate-x-0 transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar 
          sessions={sessions}
          currentSessionId={currentSession?.id || null}
          onSelectSession={(id) => {
            handleSelectSession(id);
            setIsSidebarOpen(false);
          }}
          onNewSession={() => {
            // на главный экран: там быстрая игра, готовые сценарии и выбор режима
            currentIdRef.current = null;
            setCurrentSession(null);
            setStreamingText(null);
            setTurnError(null);
            setIsSettingUp(false);
            setIsSidebarOpen(false);
          }}
          onDeleteSession={handleDeleteSession}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
            setIsSidebarOpen(false);
          }}
          user={user}
          workspaces={workspaces}
          workspace={workspace}
          onSwitchWorkspace={(id) => { switchWorkspace(id); setIsSidebarOpen(false); }}
          onCreateWorkspace={createWorkspace}
          onOpenWorkspace={(tab) => { setWsModal(tab || 'members'); setIsSidebarOpen(false); }}
          onOpenAdmin={() => { setAdminView(true); setCurrentSession(null); setIsSettingUp(false); setIsSidebarOpen(false); }}
        />
      </div>

      <main className="flex-1 flex flex-col relative min-w-0">
        {adminView && user?.isSuperadmin ? (
          <AdminPanel settings={settings} serverLlm={serverConfig?.llm || null} onBack={() => setAdminView(false)} onSettingsSaved={fetchSettings} />
        ) : isSettingUp ? (
          <div className="flex-1 flex items-center justify-center p-4 bg-[#0a0502] overflow-y-auto">
            <SessionSetup
              preset={setupPreset}
              taleAges={TALE_AGES}
              onStart={handleStartAdventure}
              onCancel={() => setIsSettingUp(false)}
              onGenerate={generateIdea}
            />
          </div>
        ) : currentSession ? (
          <div className="flex h-full flex-col lg:flex-row">
            {/* Mobile Header */}
            <div className="lg:hidden flex items-center justify-between p-4 border-b border-white/10 bg-black/40 backdrop-blur-md">
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-white/60">
                <Menu size={20} />
              </button>
              <div className="flex bg-white/5 rounded-lg p-1">
                <button 
                  onClick={() => setMobileView('narrative')}
                  className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold transition-all ${mobileView === 'narrative' ? 'bg-white/10 text-white' : 'text-white/40'}`}
                >
                  История
                </button>
                <button 
                  onClick={() => setMobileView('dashboard')}
                  className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold transition-all ${mobileView === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40'}`}
                >
                  Сцена
                </button>
              </div>
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-white/60">
                <SettingsIcon size={20} />
              </button>
            </div>

            {/* Narrative Area */}
            <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${mobileView !== 'narrative' ? 'hidden lg:flex' : 'flex'}`}>
              {/* Narrative Header */}
              <div className="px-4 lg:px-8 py-3 lg:py-4 border-b border-white/5 flex justify-between items-center gap-4 bg-black/20 overflow-x-auto">
                <div className="flex items-center gap-4 shrink-0">
                  <h2 className="font-display font-bold text-white/80 truncate max-w-[40vw] lg:max-w-xs" title={currentSession.name}>{currentSession.name}</h2>
                  {currentSession.config?.daily && (() => {
                    const m = DAILY_MODIFIERS.find(x => x.id === currentSession.config!.daily!.modifier);
                    return m ? <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/25 text-[10px] text-amber-200" title={`Испытание дня: ${m.desc}`}>{m.icon} {m.title}</span> : null;
                  })()}
                  {!isTale && (
                    <>
                      <div className="h-4 w-px bg-white/10" />
                      <button
                        onClick={() => setIsBookView(!isBookView)}
                        className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold transition-all ${isBookView ? 'text-emerald-400' : 'text-white/40 hover:text-white'}`}
                      >
                        <Library size={12} /> {isBookView ? 'Режим книги' : 'Книга'}
                      </button>
                    </>
                  )}
                  <div className="h-4 w-px bg-white/10" />
                  <div className="relative group/dl">
                    <button
                      onClick={isTale ? downloadTale : exportBook}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-white transition-all"
                      title={isTale ? 'Скачать сказку (Markdown)' : 'Скачать книгу (Markdown)'}
                    >
                      <Download size={12} /> Скачать
                    </button>
                    {!isTale && (
                      <div className="absolute left-0 top-full pt-2 hidden group-hover/dl:block group-focus-within/dl:block z-30">
                        <div className="bg-neutral-900 border border-white/10 rounded-xl p-1 shadow-2xl w-60">
                          <button onClick={exportBook} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-white/80">📖 Книга — история в Markdown</button>
                          <button onClick={exportSkillFormat} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-white/80">🗂️ Архив сессии — JSON + летопись</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="hidden sm:flex items-center gap-1 bg-white/5 rounded-lg p-0.5" title="Размер текста">
                    <span className="pl-1.5 text-[10px] font-serif text-white/40">Aa</span>
                    <button
                      onClick={() => updateAppearance({ fontSize: Math.max(12, settings.fontSize - 1) })}
                      className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-all"
                      title="Меньше шрифт"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-[10px] text-white/40 font-mono w-6 text-center">{settings.fontSize}</span>
                    <button
                      onClick={() => updateAppearance({ fontSize: Math.min(24, settings.fontSize + 1) })}
                      className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-all"
                      title="Больше шрифт"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <GuideButton audience="gm" label="" className="shrink-0 p-1.5 rounded-lg text-white/40 hover:text-amber-300 hover:bg-white/5" />
                <span className="shrink-0 hidden 2xl:inline text-[10px] uppercase tracking-widest font-bold text-white/30">
                  {isTale
                    ? `📖 Глава ${currentSession.history.filter(m => m.role === 'assistant').length} из ${currentSession.config?.tale?.chapters ?? '?'}`
                    : currentSession.mode === 'campaign' ? '🗺️ Кампания' : '⚡ Партия на вечер'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-8 lg:space-y-12 scroll-smooth">
                <AnimatePresence mode="popLayout">
                  {currentSession.history
                    .map((msg, i) => ({ msg, i }))
                    .filter(({ msg }) => msg.role !== 'system' && (!isBookView || msg.role === 'assistant'))
                    .map(({ msg, i }) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`max-w-3xl mx-auto w-full ${msg.role === 'user' ? 'text-right' : ''}`}
                    >
                      {msg.role === 'user' ? (
                        <div 
                          className={`inline-block px-4 lg:px-6 py-2 lg:py-3 border rounded-2xl font-medium ${
                            (msg.content || '').includes('[PLAYER ACTION:') 
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                              : 'bg-white/10 border-white/20 text-white/90'
                          }`}
                          style={{ 
                            fontSize: `${settings.fontSize}px`,
                            fontFamily: settings.fontFamily === 'serif' ? 'serif' : settings.fontFamily === 'mono' ? 'monospace' : 'inherit'
                          }}
                        >
                          {(msg.content || '').includes('[PLAYER ACTION:') ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-[8px] uppercase tracking-widest font-bold opacity-60">Ход игрока</span>
                              <span className="whitespace-pre-wrap"><UserContent text={(msg.content || '').replace(/\[PLAYER ACTION:.*?\]/, '').trim()} /></span>
                              <span className="text-[8px] italic opacity-40">— {(msg.content || '').match(/\[PLAYER ACTION: (.*?)\]/)?.[1]}</span>
                            </div>
                          ) : <span className="whitespace-pre-wrap"><UserContent text={displayUserContent(msg.content)} /></span>}
                        </div>
                      ) : (
                        <div 
                          className={`narrative-text space-y-4 ${isBookView || isTale ? 'text-white/90' : 'text-white/80'} ${isTale ? 'font-serif leading-relaxed' : ''}`}
                          style={{ 
                            fontSize: `${settings.fontSize}px`,
                            fontFamily: settings.fontFamily === 'serif' ? 'serif' : settings.fontFamily === 'mono' ? 'monospace' : 'inherit'
                          }}
                        >
                          <RichParagraphs text={msg.content || ''} />
                          {!isTale && !isBookView && i > 0 && <TurnSummary prev={dashBefore[i]} next={msg.dashboard} />}
                          {isTale && msg.choices && msg.choices.length > 0 && i === currentSession.history.length - 1 && !taleFinished && (
                            <div className="pt-4 flex flex-col gap-2 not-italic">
                              <span className="text-[10px] uppercase tracking-widest font-bold text-amber-400/70 font-sans">Что дальше?</span>
                              {msg.choices.map((c, k) => (
                                <button
                                  key={k}
                                  onClick={() => sendMessage(`[TALE_CHOICE] ${c}`)}
                                  disabled={isLoading || !currentSession.isOwner}
                                  className="text-left px-4 py-3 bg-amber-400/5 border border-amber-400/20 rounded-xl text-amber-100 hover:bg-amber-400/15 disabled:opacity-40 transition-all font-sans text-sm"
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {streamingText !== null && (
                  <div className="max-w-3xl mx-auto w-full">
                    <div className="narrative-text text-white/80" style={{ fontSize: `${settings.fontSize}px`, fontFamily: settings.fontFamily === 'serif' ? 'serif' : settings.fontFamily === 'mono' ? 'monospace' : 'inherit' }}>
                      <p className="whitespace-pre-wrap">
                        {renderInline(cleanStreamForDisplay(streamingText))}
                        <span className="inline-block w-1.5 h-4 bg-white/50 animate-pulse ml-0.5 align-middle rounded-sm" />
                      </p>
                    </div>
                  </div>
                )}
                {isLoading && !streamingText && (
                  <div className="max-w-3xl mx-auto flex items-center gap-3 text-white/40 italic font-serif text-sm lg:text-base">
                    <Loader2 className="animate-spin" size={18} />
                    {isTale ? 'Сказочник подбирает слова...' : 'Мастер плетёт нить судьбы...'}
                  </div>
                )}
                {turnError && !isLoading && (
                  <div className="max-w-3xl mx-auto p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm text-red-200 flex flex-col gap-3">
                    <span><b>Мастер не смог ответить.</b> {turnError}</span>
                    {currentSession.isOwner && (
                      <div className="flex gap-2">
                        {turnErrorCode === 'insufficient_credits' && (
                          <button onClick={() => setWsModal('billing')} className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg text-xs font-bold uppercase tracking-widest text-emerald-300">Пополнить</button>
                        )}
                        <button onClick={() => sendMessage('')} className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs font-bold uppercase tracking-widest">Повторить</button>
                        <button onClick={() => setTurnError(null)} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold uppercase tracking-widest">Скрыть</button>
                      </div>
                    )}
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              {!currentSession.isOwner ? (
                <div className="p-4 lg:p-6 text-center text-xs text-white/40 border-t border-white/5">
                  Вы смотрите чужую сессию. Чтобы играть, откройте ссылку персонажа от мастера.
                </div>
              ) : isTale ? (
                <div className="p-4 lg:p-8 bg-gradient-to-t from-[#0a0502] via-[#0a0502] to-transparent">
                  <div className="max-w-3xl mx-auto space-y-3">
                    {taleFinished ? (
                      <div className="p-4 bg-amber-400/5 border border-amber-400/20 rounded-2xl text-center space-y-3">
                        <p className="text-amber-200 font-serif">Сказка окончена. «{currentSession.config?.tale?.title || currentSession.name}»</p>
                        <div className="flex gap-2 justify-center flex-wrap">
                          <button onClick={() => setShowTaleBook(true)} className="px-4 py-2 bg-amber-400 text-black rounded-xl text-xs font-bold uppercase tracking-widest">Читать книгу</button>
                          <button onClick={downloadTale} className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest">Скачать</button>
                          <button onClick={printTale} className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest">Печать / PDF</button>
                          <button onClick={() => handleNewSession({ mode: 'tale', multiplayer: false })} className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest">Новая сказка</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (input.trim()) sendMessage(`[TALE_CHOICE] ${input.trim()}`);
                              }
                            }}
                            placeholder="Свой вариант: что сделают герои?"
                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 lg:px-6 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-amber-400/40 transition-all resize-none h-16 lg:h-20 text-sm lg:text-base pr-14"
                          />
                          <button
                            onClick={() => input.trim() && sendMessage(`[TALE_CHOICE] ${input.trim()}`)}
                            disabled={isLoading || !input.trim()}
                            className="absolute bottom-3 right-3 p-2 bg-amber-400 text-black rounded-xl hover:bg-amber-300 disabled:opacity-40 transition-all"
                            title="Продолжить сказку"
                          >
                            <Send size={18} />
                          </button>
                        </div>
                        <div className="flex justify-between items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-white/30">Выберите вариант выше или напишите свой. Друзья могут предлагать ходы со своих устройств (вкладка «Игроки»).</span>
                          <button
                            onClick={() => sendMessage(TALE_END_COMMAND)}
                            disabled={isLoading || currentSession.history.filter(m => m.role === 'assistant').length === 0}
                            className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-amber-300 disabled:opacity-40"
                          >
                            🌙 Закончить сказку
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
              <div className="p-4 lg:p-8 bg-gradient-to-t from-[#0a0502] via-[#0a0502] to-transparent">
                <div className="max-w-3xl mx-auto space-y-4">
                  <AnimatePresence>
                    {isDiceTrayOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="mb-4"
                      >
                        <DiceRoller 
                          onRoll={handleRoll} 
                          onClose={() => setIsDiceTrayOpen(false)}
                          suggested={currentDashboard.suggestedRoll}
                          characters={currentDashboard.characters}
                          pendingRolls={pendingRolls}
                          threatLevel={currentDashboard.threatLevel}
                          enabledMechanics={settings.mechanics}
                          onRollComplete={(charName, rollResult) => {
                            setPendingRolls(prev => {
                              const newRolls = { ...prev, [charName]: rollResult };
                              
                              // Auto-close if all ACTIVE characters have acted
                              const activeChars = currentDashboard.characters.filter(c => {
                                const isDead = c.hp === '0' || stressValue(c.stress) >= 10 || c.condition?.toLowerCase().includes('мертв');
                                return !isDead;
                              });

                              if (activeChars.length > 0 && Object.keys(newRolls).length >= activeChars.length) {
                                setTimeout(() => setIsDiceTrayOpen(false), 1500);
                              }
                              return newRolls;
                            });
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {Object.keys(pendingRolls).length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="flex flex-col gap-2 mb-2"
                      >
                        {Object.entries(pendingRolls).map(([char, roll]) => (
                          <div key={char} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80">
                            <span className="truncate mr-2" dangerouslySetInnerHTML={{ __html: (roll as string).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }} />
                            <button 
                              onClick={() => {
                                const newRolls = { ...pendingRolls };
                                delete newRolls[char];
                                setPendingRolls(newRolls);
                              }}
                              className="text-red-400 hover:text-red-300 p-1"
                            >
                              <CloseIcon size={12} />
                            </button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <ActionChips
                    dashboard={currentDashboard}
                    skip={pendingClaims.filter(c => c.status === 'approved').map(c => c.char_name)}
                    disabled={isLoading}
                    onPick={text => { setInput(prev => prev.trim() ? `${prev.trim()}\n${text}` : text); setTimeout(() => (document.querySelector('textarea[data-gm-input]') as HTMLTextAreaElement | null)?.focus(), 0); }}
                  />

                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <button
                        onClick={() => {
                          if (confirmFinale) {
                            sendMessage(`[FINALE] Вечерний финал. ЛОГИЧЕСКИ подведи сюжет к завершению за 2-4 хода (~10-30 мин). Если сюжет далеко от конца — сжимай естественно: сведи открытые линии ключевыми сценами-мостами, ускорь к кульминации (решающий бой/выбор/открытие), развяжи конфликты, дай эпилог-передышку. Финал должен ощущаться ЗАВЕРШЁННЫМ для этой партии. Заверши <session_summary> (итоги партии).`);
                            setConfirmFinale(false);
                          } else {
                            setConfirmFinale(true);
                            setTimeout(() => setConfirmFinale(false), 8000);
                          }
                        }}
                        title="Вечерний финал (логическое завершение за 2-4 хода)"
                        disabled={isLoading}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all disabled:opacity-30 ${confirmFinale ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-white/50 hover:text-amber-400'}`}
                      >
                        <Flag size={15} /> <span className="hidden sm:inline">{confirmFinale ? 'Точно? Нажмите ещё раз' : 'Финал вечера'}</span>
                      </button>
                      <button
                        onClick={() => sendMessage(`[SESSION SUMMARY] Подведи итоги партии: <session_summary> — краткий пересказ приключения и итоги (чего добились герои, награды, XP, судьбы NPC, что запомнилось). Тёплый эпилог в стиле сессии.`)}
                        title="Итоги партии"
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white/5 text-white/50 hover:text-emerald-400 rounded-lg transition-all disabled:opacity-30"
                      >
                        <Award size={15} /> <span className="hidden sm:inline">Итоги</span>
                      </button>
                      <button
                        onClick={() => {
                          if (input.trim()) {
                            sendMessage(`[CLARIFY] ${input}`);
                            setInput('');
                          }
                        }}
                        title="Уточнить детали (обновит Кодекс)"
                        disabled={isLoading || !input.trim()}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white/5 text-white/50 hover:text-emerald-400 rounded-lg transition-all disabled:opacity-30"
                      >
                        <HelpCircle size={15} /> <span className="hidden sm:inline">Уточнить</span>
                      </button>
                      <button
                        onClick={() => setIsDiceTrayOpen(!isDiceTrayOpen)}
                        title="Кубики: бросок за героя"
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all ${isDiceTrayOpen ? 'bg-white text-black' : 'bg-white/5 text-white/50 hover:text-white'}`}
                      >
                        <Dices size={15} /> <span className="hidden sm:inline">Кубики</span>
                      </button>
                  </div>
                  <div className="relative">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage(input);
                        }
                      }}
                      data-gm-input placeholder="Опишите действие героев..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 lg:px-6 py-3 lg:py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all resize-none h-20 lg:h-24 text-sm lg:text-base pr-12"
                    />
                    <div className="absolute bottom-3 right-3 lg:bottom-4 lg:right-4 flex gap-2">
                      <button
                        onClick={() => sendMessage(input)}
                        disabled={isLoading || (!input.trim() && Object.keys(pendingRolls).length === 0 && currentSession.history[currentSession.history.length - 1]?.role !== 'user')}
                        className="p-2 bg-white text-black rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        <Send size={18} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button 
                      onClick={() => {
                        sendMessage(`[SAVE_CHAPTER] Сохрани главу (NEXUS SAVE). Твоя задача:
1. <lore_update> — кристаллизованный Story Archive до 800 слов (NPC: кто и чего хочет, локации, неразрешённые конфликты, ключевые улики; от третьего лица, в стиле сессии).
2. <final_draft> — литературный Final Draft главы (300-600 слов): синтез диалогов и бросков.
3. Обнови decisionTree в <dashboard_json>: зафиксируй ключевые выборы игроков со статусами active/resolved.`);
                      }} 
                      disabled={!currentSession || isLoading}
                      title="Мастер запишет летопись, черновик главы и древо решений"
                      className="vector-btn text-[10px] lg:text-sm text-amber-400/80 border-amber-500/20 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {isLoading ? 'Сохраняем главу…' : 'Сохранить главу'}
                    </button>
                  </div>
                </div>
              </div>
              )}
              <DisclaimerFooter audience="gm" className="px-4 pb-2 -mt-2" />
            </div>

            {/* Dashboard Sidebar */}
            <div className={`w-full lg:w-96 border-l border-white/10 bg-black/20 backdrop-blur-sm overflow-hidden flex flex-col min-h-0 ${mobileView !== 'dashboard' ? 'hidden lg:flex' : 'flex'}`}>
              <div className="p-4 border-b border-white/10 flex gap-1">
                {!isTale && (
                  <>
                    <button
                      onClick={() => setRightPanelTab('dashboard')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                    >
                      <Sparkles size={12} /> Сцена
                    </button>
                    <button
                      onClick={() => setRightPanelTab('codex')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'codex' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                    >
                      <Library size={12} /> Кодекс
                    </button>
                  </>
                )}
                <button
                  onClick={() => setRightPanelTab('lore')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'lore' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <History size={12} /> {isTale ? 'Книга' : 'Летопись'}
                </button>
                <button 
                  onClick={() => setRightPanelTab('players')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'players' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <Users size={12} /> Игроки
                  {(pendingClaims.some((c: any) => c.status === 'pending') || pendingActions.length > 0) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              </div>
              <div className="flex-1 overflow-hidden h-full">
                {(rightPanelTab === 'players' || (isTale && rightPanelTab !== 'lore')) ? (
                  <div className="p-4 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Share2 size={12} /> Пригласить друзей
                    </h3>
                    <p className="text-[11px] text-white/40 leading-relaxed">
                      Отправьте другу ссылку на его героя — он откроет её с телефона, назовётся и {currentSession.config?.autoApprove ? 'сразу начнёт играть' : 'после вашего одобрения начнёт играть'}.
                    </p>
                    {(currentDashboard.characters || []).length === 0 ? (
                      <p className="text-xs text-white/30 italic">Герои появятся после первого ответа мастера.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(currentDashboard.characters || []).map(ch => {
                          const owner = pendingClaims.find((c: any) => c.char_name === ch.name && c.status === 'approved');
                          return (
                            <div key={ch.name} className="flex items-center gap-2 p-2 bg-white/5 border border-white/10 rounded-lg">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-white font-medium truncate">{ch.name}</p>
                                <p className="text-[10px] text-white/40 truncate">{owner ? `играет: ${owner.player_name}` : 'свободен'}</p>
                              </div>
                              {owner && (
                                <button onClick={() => releaseClaim(owner.id)} className="px-2 py-1 text-[9px] uppercase tracking-widest font-bold text-red-400/70 hover:text-red-400" title="Освободить персонажа">
                                  Освободить
                                </button>
                              )}
                              <button onClick={() => copyInvite(ch.name)} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded-md text-[9px] uppercase tracking-widest font-bold text-white">
                                {copiedLink === ch.name ? 'Скопировано' : 'Ссылка'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                      <input type="checkbox" className="accent-emerald-500" checked={!!currentSession.config?.autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
                      Пускать игроков без подтверждения
                    </label>

                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2 pt-4 border-t border-white/10">
                      <Users size={12} /> Заявки игроков
                    </h3>
                    {pendingClaims.filter((c: any) => c.status === 'pending').length === 0 ? (
                      <p className="text-xs text-white/30 italic">Нет ожидающих заявок.</p>
                    ) : (
                      <div className="space-y-2">
                        {pendingClaims.filter((c: any) => c.status === 'pending').map((c: any) => (
                          <div key={c.id} className="p-3 bg-white/5 border border-amber-500/20 rounded-xl">
                            <p className="text-sm text-white font-medium">
                              Игрок «<span className="text-amber-400">{c.player_name}</span>» хочет <span className="text-emerald-400">{c.char_name}</span>
                            </p>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => approveClaim(c.id)} className="flex-1 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/30 transition-all">Принять</button>
                              <button onClick={() => rejectClaim(c.id)} className="flex-1 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/30 transition-all">Отклонить</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2 pt-4 border-t border-white/10">
                      <MessageSquarePlus size={12} /> Действия игроков
                    </h3>
                    {pendingActions.length === 0 ? (
                      <p className="text-xs text-white/30 italic">Нет действий. Игроки ещё думают.</p>
                    ) : (
                      <div className="space-y-2">
                        {pendingActions.map((a: any) => (
                          <div key={a.id} className="p-3 bg-white/5 border border-white/10 rounded-xl group">
                            <p className="text-[9px] uppercase tracking-widest text-amber-400/70 font-bold">
                              {a.char_name}{a.player_name ? ` · ${a.player_name}` : ''}
                            </p>
                            <p className="text-xs text-white/80 mt-1 leading-relaxed whitespace-pre-wrap"><UserContent text={a.action_text} /></p>
                            <button onClick={() => removeAction(a.id)} className="mt-2 text-[9px] uppercase tracking-widest font-bold text-red-400/60 hover:text-red-400 transition-all">Удалить</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {settings.idlePlayerAction === 'gm' && (() => {
                      const acted = new Set(pendingActions.map((a: any) => a.char_name));
                      const idle = pendingClaims.filter((c: any) => c.status === 'approved' && !acted.has(c.char_name));
                      if (idle.length === 0) return null;
                      return (
                        <div className="pt-4 border-t border-white/10 space-y-2">
                          <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                            <Users size={12} /> Играет ГМ (не прислали)
                          </h3>
                          {idle.map((c: any) => (
                            <div key={c.id} className="space-y-1">
                              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">{c.char_name}</p>
                              <div className="flex gap-1">
                                <input
                                  value={gmActionInputs[c.char_name] || ''}
                                  onChange={(e) => setGmActionInputs(prev => ({ ...prev, [c.char_name]: e.target.value }))}
                                  placeholder={`Ход за ${c.char_name}...`}
                                  className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all"
                                />
                                <button
                                  onClick={() => submitGmAction(c.char_name)}
                                  disabled={!gmActionInputs[c.char_name]?.trim()}
                                  className="px-2.5 py-1.5 bg-white/10 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 disabled:opacity-40 transition-all"
                                >
                                  OK
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    <button
                      onClick={confirmRound}
                      disabled={isConfirming || isLoading || pendingActions.length === 0}
                      className="w-full py-3 bg-amber-400 text-black rounded-xl font-bold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs uppercase tracking-widest"
                    >
                      {isConfirming ? 'Отправляем...' : `Подтвердить ход (${pendingActions.length})`}
                    </button>
                    <p className="text-[9px] text-white/30 italic text-center">
                      {settings.idlePlayerAction === 'skip'
                        ? 'Не успевшие — не действуют в этом ходу'
                        : settings.idlePlayerAction === 'gm'
                          ? 'Не успевшие — играет ГМ (соло-плей)'
                          : 'Не успевшие — действуют случайно'}
                    </p>
                  </div>
                ) : rightPanelTab === 'lore' && isTale ? (
                  <div className="p-6 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-amber-400/70 font-bold flex items-center gap-2">
                      <BookOpen size={12} /> {taleFinished ? 'Книга сказки' : 'Сказка пока пишется'}
                    </h3>
                    {taleFinished ? (
                      <>
                        <div className="text-sm text-white/70 font-serif leading-relaxed whitespace-pre-wrap">{currentSession.archive}</div>
                        <div className="flex gap-2">
                          <button onClick={downloadTale} className="flex-1 py-2 bg-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white">Скачать</button>
                          <button onClick={printTale} className="flex-1 py-2 bg-white/10 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white">Печать</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-white/40">Возраст: {TALE_AGES.find(a => a.id === currentSession.config?.tale?.age)?.name || '—'} · Глав: {currentSession.config?.tale?.chapters ?? '—'}{currentSession.config?.tale?.moral ? ` · Мораль: «${currentSession.config.tale.moral}»` : ''}</p>
                        <p className="text-[10px] uppercase tracking-widest text-white/30 font-bold pt-2">Память сказочника</p>
                        <div className="text-sm text-white/60 font-serif leading-relaxed whitespace-pre-wrap">{currentSession.lore || 'Пока пусто.'}</div>
                      </>
                    )}
                    {currentSession.isOwner && !taleFinished && (
                      <div className="pt-4 border-t border-white/10"><OraclePanel sessionId={currentSession.id} status={oracleStatus} /></div>
                    )}
                  </div>
                ) : rightPanelTab === 'lore' ? (
                  <div className="p-6 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <History size={12} /> Архив истории
                    </h3>
                    <div className="text-sm text-white/60 font-serif leading-relaxed whitespace-pre-wrap">
                      {currentSession.lore || "Архив пока пуст. Нажмите «Сохранить главу» — мастер запишет летопись."}
                    </div>
                    {currentSession.isOwner && (
                      <div className="pt-4 border-t border-white/10"><OraclePanel sessionId={currentSession.id} status={oracleStatus} /></div>
                    )}
                    {currentSession.archive && (
                      <>
                        <h3 className="text-[10px] uppercase tracking-widest text-amber-400/70 font-bold flex items-center gap-2 pt-4 border-t border-white/10">
                          <ScrollText size={12} /> Черновики глав
                        </h3>
                        <div className="text-sm text-white/70 font-serif leading-relaxed whitespace-pre-wrap">
                          {currentSession.archive}
                        </div>
                      </>
                    )}
                  </div>
                ) : rightPanelTab === 'codex' ? (
                  <Codex entries={currentSession.codex} />
                ) : (
                  <Dashboard 
                    data={currentDashboard} 
                    sessionId={currentSession.id}
                    currency={currentSession.config?.world?.currency}
                    enabledMechanics={settings.mechanics} 
                    onUpdate={handleUpdateDashboard}
                    onSearch={(kind, name) => kind === 'body' ? handleSearchBody(name || '') : handleSearchLocation()}
                    onEconomy={(action, charName, item) => handleEconomy(action, charName, item)}
                    onParty={(charName, status) => handleParty(charName, status)}
                    isCampaign={currentSession.mode === 'campaign'}
                    onClaimBase={(name) => handleClaimBase(name)}
                    onUpgradeBase={(building) => handleUpgradeBase(building)}
                    onTrain={(charName) => handleTrain(charName)}
                    onHire={(charName, tier) => handleHire(charName, tier)}
                    onClaimExpeditions={() => handleClaimExpeditions()}
                    onAcceptQuest={(title) => handleAcceptQuest(title)}
                    onCarouse={(charName) => handleCarouse(charName)}
                    onTravel={async (locId) => {
                      if (!currentSession) return;
                      try {
                        const r = await api<{ type: 'encounter' | 'discovery' | 'safe'; locationName: string }>(`/api/sessions/${currentSession.id}/travel`, { body: { locationId: locId } });
                        setIsLoading(true);
                        setTravelEvent(r);
                        setTimeout(() => setTravelEvent(null), 2500);
                      } catch (e) { reportError(e, 'Путешествие'); }
                    }}
                    onExplore={async (locId) => {
                      if (!currentSession) return;
                      try {
                        await api(`/api/sessions/${currentSession.id}/explore`, { body: { locationId: locId } });
                        setIsLoading(true);
                      } catch (e) { reportError(e, 'Исследование'); }
                    }}
                    onUseItem={async (charName, item) => {
                      if (!currentSession) return;
                      try {
                        const r = await api<{ tag: string }>(`/api/sessions/${currentSession.id}/use`, { body: { charName, item } });
                        showToast(r.tag.replace(/^\[ITEM USED: |\]$/g, ''));
                      } catch (e) { reportError(e, 'Не получилось'); }
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 text-center space-y-8">
            {/* Mobile Menu Button for Empty State */}
            <div className="lg:hidden absolute top-4 left-4">
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-white/60">
                <Menu size={24} />
              </button>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4"
            >
              <h2 className="font-display text-3xl lg:text-5xl font-bold text-white tracking-tighter">Fate & Dragons</h2>
              <p className="text-white/40 max-w-md mx-auto font-serif text-base lg:text-lg italic px-4">
                Онлайн-НРИ с ИИ-мастером: соло, с друзьями или сказка на ночь.
              </p>
            </motion.div>
            <DisclaimerFooter audience="gm" className="max-w-md px-4" />
            
            {serverConfig && !serverConfig.llm.keyPresent && (
              <div className="max-w-xl mx-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/80">
                ИИ-провайдер «{serverConfig.llm.provider}» не настроен: нет ключа на сервере. {user?.isSuperadmin ? 'Откройте Администрирование → ИИ платформы.' : 'Подключите свой ключ ИИ в настройках пространства или попросите администратора.'}
              </div>
            )}

            <DailyCard disabled={isLoading} onStart={startDaily} />

            <button
              onClick={() => startScenario(quickScenario())}
              disabled={isLoading}
              className="group px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold text-lg shadow-lg shadow-orange-900/30 hover:scale-[1.02] active:scale-[0.99] transition-all disabled:opacity-50 flex items-center gap-3"
              title="Случайный готовый сценарий и герой — сразу в игру"
            >
              ⚡ Быстрая игра
              <span className="text-xs font-semibold text-black/60 group-hover:text-black/80">готовый сюжет, 1 клик</span>
            </button>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl px-4">
              <button
                onClick={() => handleNewSession({ mode: 'short', multiplayer: false })}
                className="p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group text-left"
              >
                <Swords className="text-emerald-400/70 group-hover:text-emerald-300 mb-4 transition-colors" size={24} />
                <h3 className="text-white font-bold text-lg">Соло-приключение</h3>
                <p className="text-white/40 text-xs mt-2">Вы и ИИ-мастер. Ведите одного героя или целую партию сами.</p>
              </button>
              <button
                onClick={() => handleNewSession({ mode: 'short', multiplayer: true })}
                className="p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group text-left"
              >
                <Users className="text-sky-400/70 group-hover:text-sky-300 mb-4 transition-colors" size={24} />
                <h3 className="text-white font-bold text-lg">Игра с друзьями</h3>
                <p className="text-white/40 text-xs mt-2">Каждый играет своим героем с телефона, вы подтверждаете ходы раунда.</p>
              </button>
              <button
                onClick={() => handleNewSession({ mode: 'tale', multiplayer: false })}
                className="p-6 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group text-left"
              >
                <Feather className="text-amber-400/70 group-hover:text-amber-300 mb-4 transition-colors" size={24} />
                <h3 className="text-white font-bold text-lg">Сказка</h3>
                <p className="text-white/40 text-xs mt-2">Интерактивная сказка с выборами — для детей или взрослых. В конце получается книга.</p>
              </button>
            </div>
            <button onClick={() => setWorldsOpen({})} className="w-full max-w-4xl mx-4 px-5 py-4 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-left flex items-center gap-4 transition-all">
              <span className="text-3xl">🌍</span>
              <span className="min-w-0">
                <span className="block text-white font-bold">Миры</span>
                <span className="block text-xs text-white/45">Создайте свой мир с лором, местами и завязками — играйте сами или поделитесь ссылкой. Или сыграйте в мир из каталога.</span>
              </span>
            </button>
            <div className="w-full max-w-4xl px-4 text-left space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest font-bold text-white/40">Готовые сценарии</h3>
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                {SCENARIOS.map(sc => (
                  <button
                    key={sc.id}
                    onClick={() => startScenario(sc)}
                    disabled={isLoading}
                    className="snap-start shrink-0 w-56 p-4 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-all text-left disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{sc.icon}</span>
                      <span className="text-[9px] uppercase tracking-wider font-bold text-white/30">{sc.mode === 'tale' ? 'сказка' : sc.mode === 'campaign' ? 'кампания' : 'на вечер'}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-white">{sc.title}</p>
                    <p className="mt-1 text-[11px] text-white/45 leading-snug">{sc.teaser}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <button onClick={() => setWorldsOpen({})} className="text-xs text-amber-300/80 hover:text-amber-200 flex items-center gap-2">🌍 Миры</button>
              <button onClick={() => setHallOpen(true)} className="text-xs text-amber-300/80 hover:text-amber-200 flex items-center gap-2">🎖️ Зал героев</button>
              <GuideButton audience="gm" className="text-xs text-amber-300/80 hover:text-amber-200 flex items-center gap-2" />
              <button onClick={() => setIsSettingsOpen(true)} className="text-xs text-white/40 hover:text-white flex items-center gap-2">
                <SettingsIcon size={14} /> Настройки
              </button>
            </div>
          </div>
        )}
      </main>

      {hallOpen && <HallModal onClose={() => setHallOpen(false)} />}
      {worldsOpen && <WorldsModal openId={worldsOpen.openId} workspaceId={workspace?.id} maxHeroes={workspace?.limits?.maxHeroes || 4} onClose={() => setWorldsOpen(null)} onPlay={startWorld} />}
      {isSettingsOpen && (
        <SettingsModal
          settings={effectiveSettings}
          sessionName={currentSession?.isOwner ? currentSession.name : undefined}
          user={user}
          onSave={handleSaveSettings}
          onLogout={logout}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
      
      <AnimatePresence>
        {travelEvent && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="flex flex-col items-center gap-6"
            >
              <div className="text-white/40 uppercase tracking-widest text-sm font-bold">
                В пути: {travelEvent.locationName}
              </div>
              
              <div className="relative w-32 h-32 flex items-center justify-center">
                {/* Spinning dashed circle */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border-2 border-dashed border-white/20"
                />
                
                {/* Icon based on event type */}
                {travelEvent.type === 'encounter' && <Skull size={48} className="text-red-500 animate-pulse" />}
                {travelEvent.type === 'discovery' && <Eye size={48} className="text-emerald-500 animate-pulse" />}
                {travelEvent.type === 'safe' && <Footprints size={48} className="text-white/60" />}
              </div>
              
              <div className="text-2xl font-serif text-white text-center">
                {travelEvent.type === 'encounter' && "Interception!"}
                {travelEvent.type === 'discovery' && "New Discovery"}
                {travelEvent.type === 'safe' && "Safe Passage"}
              </div>
              
              <div className="text-white/60 text-sm max-w-xs text-center">
                {travelEvent.type === 'encounter' && "Something blocks your path. Prepare yourself."}
                {travelEvent.type === 'discovery' && "Вы замечаете что-то в стороне от тропы…"}
                {travelEvent.type === 'safe' && "The journey is uneventful. For now."}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PromptModal />

      {wsModal && workspace && user && (
        <WorkspaceModal
          workspace={workspace}
          user={user}
          initialTab={wsModal}
          onChanged={() => loadMe(workspace.id)}
          onClose={() => { setWsModal(null); loadMe(workspace.id); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 bg-emerald-600 text-white rounded-xl shadow-2xl text-sm font-medium">{toast}</div>
      )}

      {showTaleBook && currentSession && isTale && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setShowTaleBook(false)}>
          <div className="bg-[#fffaf0] text-[#2a2118] rounded-2xl p-6 lg:p-10 max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {taleText().split('\n\n').map((p, i) => i === 0
              ? <h2 key={i} className="text-2xl lg:text-3xl font-serif font-bold text-center text-[#6b3e0a] mb-6">{p.replace(/^#\s*/, '')}</h2>
              : <p key={i} className={`font-serif leading-relaxed mb-3 ${/^\*.*\*$/.test(p.trim()) ? 'text-center italic text-[#6b5a40] mt-6' : 'indent-6'}`}>{p.replace(/^\*|\*$/g, '')}</p>)}
            <div className="mt-8 flex gap-2 justify-center flex-wrap">
              <button onClick={downloadTale} className="px-4 py-2 bg-[#6b3e0a] text-white rounded-xl text-xs font-bold uppercase tracking-widest">Скачать</button>
              <button onClick={printTale} className="px-4 py-2 bg-[#6b3e0a]/80 text-white rounded-xl text-xs font-bold uppercase tracking-widest">Печать / PDF</button>
              <button onClick={() => setShowTaleBook(false)} className="px-4 py-2 bg-black/10 rounded-xl text-xs font-bold uppercase tracking-widest">Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {sessionSummary && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setSessionSummary(null)}>
          <div className="bg-[#14100d] border border-amber-500/20 rounded-2xl p-6 lg:p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-display font-bold text-amber-400 flex items-center gap-2">
                <Award size={20} /> Итоги партии
              </h2>
              <button onClick={() => setSessionSummary(null)} className="text-white/40 hover:text-white"><CloseIcon size={20} /></button>
            </div>
            <div className="text-sm text-white/80 font-serif leading-relaxed whitespace-pre-wrap">
              {sessionSummary}
            </div>
            <div className="mt-6 flex gap-2 justify-center flex-wrap">
              <button
                onClick={downloadEveningStory}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl font-bold transition-all text-xs uppercase tracking-widest text-white"
                title="Скачать историю вечера в Markdown"
              >
                Историю (MD)
              </button>
              <button
                onClick={downloadEveningStoryPDF}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl font-bold transition-all text-xs uppercase tracking-widest text-white"
                title="Открыть красивую историю и сохранить как PDF"
              >
                Историю (PDF)
              </button>
              <button
                onClick={() => setSessionSummary(null)}
                className="px-6 py-2.5 bg-amber-400 text-black rounded-xl font-bold hover:bg-amber-300 transition-all text-xs uppercase tracking-widest"
              >
                Отлично сыграно
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    )} />
    </Routes>
  );
}
