import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { SettingsModal } from './components/SettingsModal';
import { DiceRoller } from './components/DiceRoller';
import { Codex } from './components/Codex';
import { CharacterView } from './components/CharacterView';
import { PromptModal } from './components/PromptModal';
import { GameSession, AppSettings, Message, DashboardData, CodexEntry, MechanicConfig } from './types';
import { Send, Loader2, Sparkles, BookOpen, History, Plus, Minus, Settings as SettingsIcon, Menu, X as CloseIcon, LayoutDashboard, MessageSquare, Dices, Download, Library, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

export const DEFAULT_MECHANICS: MechanicConfig[] = [
  {
    id: 'classic',
    name: 'Classic Flow',
    enabled: true,
    description: 'Обычный бросок 1d20 + Mod. Простая проверка навыка.'
  },
  {
    id: 'triple',
    name: 'Stress Resonance (Резонанс Стресса)',
    enabled: true,
    description: 'Бросок 3d20. Сортировка: [Min, Mid, Max].\n- 0-1 Стресс: Берется (Max) + Mod. ВАЖНО: Использование максимума выжигает разум! Увеличь Стресс персонажа на +2.\n- 2-4 Стресс: Берется (Mid) + Mod. Увеличь Стресс на +1.\n- 5+ Стресс: Берется (Min) + Mod. Катарсис: персонаж сбрасывает напряжение. Уменьши Стресс на -2.'
  },
  {
    id: 'shifted',
    name: 'Fate Shift (Сдвиг Судьбы)',
    enabled: true,
    description: 'Stress Resonance + 1d6.\n- 1d6: 1-2 (-1), 3-4 (0), 5-6 (+1).'
  },
  {
    id: 'taint',
    name: 'Chaos Roll (Бросок Хаоса)',
    enabled: true,
    description: 'Бросок 2d20 + Mod. Дубль = +1 к Doom Pool.'
  },
  {
    id: 'threat',
    name: 'Threat Level (Кубик Угрозы)',
    enabled: true,
    description: 'Если в броске указано "Threat dX = -Y" (Кубик Угрозы), ты ДОЛЖЕН вычесть значение Y из итогового результата игрока. Это сопротивление среды или противника.'
  },
  {
    id: 'hp',
    name: 'Здоровье (HP)',
    enabled: true,
    description: 'Отражает физическое состояние. Падение до 0 означает смерть или тяжелую травму.'
  },
  {
    id: 'stress',
    name: 'Стресс (Stress)',
    enabled: true,
    description: 'Ментальное напряжение (от 0 до 10). Влияет на броски Nexus Triple. При достижении 10 персонаж сходит с ума.'
  },
  {
    id: 'tokens',
    name: 'Жетоны (Tokens)',
    enabled: true,
    description: 'Мета-валюта. Игроки могут тратить их на перебросы или сюжетные вмешательства.'
  },
  {
    id: 'condition',
    name: 'Состояние (Condition)',
    enabled: true,
    description: 'Краткое описание текущего статуса персонажа (например, "Истекает кровью", "Вдохновлен").'
  },
  {
    id: 'actions',
    name: 'Векторы действий (Actions)',
    enabled: true,
    description: 'Предлагаемые ИИ варианты действий для игрока. Категории: Профильный, Рискованный, Синергия, Искушение.'
  },
  {
    id: 'threats_dash',
    name: 'Угрозы (Threats)',
    enabled: true,
    description: 'Активные противники или опасности в сцене. Имеют свои HP и особенности.'
  },
  {
    id: 'scene_aspects',
    name: 'Аспекты сцены (Scene Aspects)',
    enabled: true,
    description: 'Важные детали окружения, которые можно использовать или которые мешают.'
  },
  {
    id: 'clocks',
    name: 'Часы (Clocks)',
    enabled: true,
    description: 'Счетчики прогресса для отслеживания надвигающихся событий или длительных задач (например, "Прибытие подкрепления 2/4").'
  },
  {
    id: 'doom_pool',
    name: 'Пул Рока (Doom Pool)',
    enabled: true,
    description: 'Счетчик эскалации (от 0 до 5). Мастер использует его для усложнения сцены или ввода новых угроз.'
  },
  {
    id: 'echoes',
    name: 'Эхо (Echoes)',
    enabled: true,
    description: 'Отголоски прошлых решений, которые влияют на текущую ситуацию.'
  },
  {
    id: 'inventory',
    name: 'Инвентарь (Inventory)',
    enabled: true,
    description: 'Список предметов, которые несет персонаж. Влияет на возможности и векторы действий.'
  },
  {
    id: 'relationships',
    name: 'Отношения (Relationships)',
    enabled: false,
    description: 'Система связей с NPC. Уровень от -10 (Враг) до +10 (Верный союзник). Влияет на сложность убеждения и готовность NPC помогать.'
  },
  {
    id: 'narrative_rights',
    name: 'Narrative Rights (Право на Истину)',
    enabled: true,
    description: 'Раз в 2-4 хода задавай игроку вопрос: "Какую деталь ты заметил?" или "Почему этот NPC тебе знаком?". Это позволяет игроку влиять на лор.'
  },
  {
    id: 'flashbacks',
    name: 'Flashbacks (Флешбэки)',
    enabled: true,
    description: 'Игрок может потратить 1 Жетон, чтобы описать ретро-сцену подготовки, которая помогает в текущей ситуации.'
  },
  {
    id: 'bullet_time',
    name: 'Bullet Time (Эффект Времени)',
    enabled: true,
    description: 'При выпадении "20" на кубике или в финале боя описывай момент сверхдетально, замедляя время.'
  },
  {
    id: 'interludes',
    name: 'Interludes (Интерлюдии)',
    enabled: true,
    description: 'Иногда делай вставки "Тем временем...", показывая события в других местах для нагнетания саспенса.'
  },
  {
    id: 'sensory',
    name: 'Sensory Details (Сенсорика)',
    enabled: true,
    description: 'Описывай запахи, температуру, тактильные ощущения и "гличи" реальности.'
  }
];

export const SYSTEM_PROMPT = `
# ROLE: Мастер Игры (DM) — Система "Fate & Dragons" (v.5.0 Core)

## 1. ФИЛОСОФИЯ: БЕСПРИСТРАСТНЫЙ СУДЬЯ
Ты — логичный, честный и беспристрастный мир. Твоя цель: реагировать на действия игроков максимально реалистично в рамках сеттинга. 
**ЗОЛОТЫЕ ПРАВИЛА:**
- **Никакой сюжетной брони (Plot Armor):** Не подыгрывай игрокам и не спасай их от последствий их собственных глупых решений.
- **Никакой искусственной жестокости:** Не пытайся убить их специально. Если они действуют умно и бросок успешен — они побеждают.
- **Кубик — это закон:** Если игрок провалил бросок, последствия должны быть реальными и ощутимыми.
- НИКОГДА не описывай действия, мысли или реакции персонажей за них. Останавливайся в момент выбора или сразу после оглашения последствий.

## 2. ПРОТОКОЛ ОТВЕТА
1. Narrative (ТОЛЬКО художественное описание текущей ситуации. ВАЖНО: НЕ ПИШИ заголовки вроде "### Нарратив" или "### Narrative". Просто начинай писать текст. НЕ ВЫВОДИ векторы действий в тексте, они должны быть только в JSON дашборда!).

## 3. СПЕЦИАЛЬНЫЕ КОМАНДЫ (МЕТА-ГЕЙМИНГ)
- **[CLARIFY]**: Если сообщение игрока начинается с этого тега, это значит, что он задает вопрос о мире, предмете или NPC "вне игры". 
  1. Сначала дай подробный ответ в тексте.
  2. ОБЯЗАТЕЛЬНО обнови Кодекс (<codex_json>), добавив туда все новые детали.
  3. НЕ продолжай сюжет активно, пока не ответишь на вопрос. Сосредоточься на уточнении лора.
  4. Если вопрос касается предмета в инвентаре — опиши его свойства. Если NPC — его внешность и статус.

## 4. ЧЕСТНЫЕ ПОСЛЕДСТВИЯ
Мир реагирует строго по логике:
- **Провал броска:** Логичные, жесткие, но честные последствия. Наноси урон (HP), повышай Стресс, лишай ресурсов, вводи новые Угрозы. Враги действуют эффективно и безжалостно.
- **Успех броска:** Игрок получает ровно то, что хотел, без скрытых подвохов.
- **Искушение (Temptation):** Если игрок выбирает действие категории "Искушение", он получает сиюминутную выгоду, но ВСЕГДА платит логичную цену (рост Doom Pool, предательство, осложнение).
- **СМЕРТЬ:** Если HP падает до 0 или Стресс достигает 10 — персонаж погибает или сходит с ума. Если игрок совершает фатальную ошибку (например, прыгает в лаву без защиты) — он умирает. Не спасай их искусственно, будь честным арбитром.
`;

export const getTechnicalInstructions = (mechanics: MechanicConfig[]) => `
## ТЕХНИЧЕСКИЙ ПРОТОКОЛ (КРИТИЧЕСКИ ВАЖНО!)
Твой ответ ВСЕГДА должен состоять из двух частей: сначала художественный текст, а затем технические блоки JSON. БЕЗ JSON ИНТЕРФЕЙС ИГРЫ СЛОМАЕТСЯ!

ВАЖНОЕ ПРАВИЛО: НИКОГДА не пиши никакой текст ПОСЛЕ блоков JSON. Твой ответ должен заканчиваться закрывающим тегом (например, </dashboard_json> или </lore_update>). Любой текст после JSON сломает парсер!

1. Дашборд: Оберни в теги <dashboard_json>...</dashboard_json>.
Формат (СТРОГИЙ JSON, никаких стрелочек, комментариев или неэкранированных кавычек внутри значений!):
{
  "characters": [{
    "name": "...", 
    "hp": "X/Y", 
    "stress": 0, 
    "tokens": 0, 
    "condition": "...", 
    "goal": "...", 
    "inventory": ["Предмет 1", "..."],
    "equipment": [{"slot": "Голова", "item": "Шлем"}, {"slot": "Оружие", "item": "Меч"}, {"slot": "Кость духа", "item": "Пусто"}],
    "relationships": [{"target": "NPC", "level": 0, "status": "..."}],
    "actions": [{"category": "Профильный|Рискованный|Синергия|Искушение", "name": "...", "description": "..."}]
  }],
  "threats": [{"name": "...", "hp": "...", "features": ["Броня", "Яд"]}],
  "sceneAspects": ["Темный лес", "Запах гари", "Скользкий пол"],
  "clocks": [{"name": "...", "progress": 0, "total": 4}],
  "doomPool": 0,
  "echoes": ["Звон мечей вдали", "Шепот ветра"],
  "atmosphere": "...",
  "threatLevel": 0,
  "suggestedRoll": {"type": "classic|triple|shifted|taint", "reason": "..."}
}
ВАЖНО: Поля stress, tokens, doomPool, threatLevel, progress, total должны быть ЧИСЛАМИ (не строками, не формулами вроде "7->9"). Поля features, sceneAspects, echoes должны быть МАССИВАМИ СТРОК.
ВАЖНО: Поле equipment содержит экипированные предметы. Слоты динамические. По умолчанию используй стандартные (Голова, Тело, Оружие, Аксессуар), но смело добавляй новые специфичные слоты, если того требует сеттинг (например, "Кость духа", "Киберимплант", "Артефакт"). Если слот пуст, пиши "Пусто".
ВАЖНО: Для каждого персонажа генерируй от 1 до 3 действий (выбирай количество случайно). Категории действий выбирай абсолютно случайно. Разрешается и поощряется дублирование категорий (например, могут выпасть три действия категории "Искушение", если ситуация располагает к этому).
${mechanics.find(m => m.id === 'threat')?.enabled ? 'ВАЖНО: Поле threatLevel (0, 4, 6, 8, 12) отражает текущую опасность сцены. Устанавливай его сам! Если врагов нет, ставь 0. Если есть сильный враг, ставь 8 или 12. Это значение будет автоматически вычитаться из бросков игроков.' : ''}

2. Кодекс: Оберни в теги <codex_json>...</codex_json>.
Используй для фиксации NPC, локаций или предметов. 
ВАЖНО: Если в запросе есть тег [CLARIFY], твой приоритет №1 — обновить Кодекс. Зафиксируй там все детали, которые ты только что описал в тексте. Это твоя внешняя память.
Формат:
[{"name": "...", "type": "npc|location|item|lore", "description": "...", "status": "..."}]

3. Архив (Lore): ОБЯЗАТЕЛЬНО обновляй глобальный архив событий. Если произошло что-то важное, выведи теги <lore_update>...</lore_update> с ПОЛНЫМ обновленным кратким содержанием ВСЕГО сюжета (включая старые события). 
ВАЖНО: Если ты отвечаешь на [CLARIFY], НЕ выводи <lore_update>, так как сюжет не продвинулся.
`;

const INITIAL_DASHBOARD: DashboardData = {
  characters: [],
  threats: [],
  sceneAspects: [],
  clocks: [],
  doomPool: 0,
  echoes: [],
  atmosphere: "Waiting for initialization...",
  threatLevel: 0
};

const CLARIFY_SYSTEM_PROMPT = `
# ROLE: Архивариус и Хранитель Лора
Ты — вспомогательная система уточнения данных. Твоя единственная задача: ответить на конкретный вопрос игрока о мире, предметах, NPC или текущей ситуации.

## ПРАВИЛА ОТВЕТА:
1. КРАТКОСТЬ: Отвечай только на поставленный вопрос. Не продолжай сюжет. Не описывай новые действия.
2. КОНТЕКСТ: Используй предоставленный Кодекс, Дашборд и Историю как единственный источник истины.
3. ФИКСАЦИЯ: Обязательно выведи обновленный <codex_json> с деталями твоего ответа.
4. НИКАКИХ БРОСКОВ: Не предлагай броски и не совершай их.
5. НИКАКОГО НАРРАТИВА: Не пиши художественное продолжение сцены. Только сухие факты или описание лора.
6. DASHBOARD: В блоке <dashboard_json> просто верни ТЕКУЩЕЕ состояние без изменений. Не добавляй новых угроз, не меняй статы.
`;

export default function App() {
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [currentSession, setCurrentSession] = useState<GameSession | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    provider: 'gemini',
    modelUrl: 'http://localhost:1234/v1',
    apiKey: '',
    modelName: 'local-model',
    systemPrompt: SYSTEM_PROMPT,
    fontSize: 16,
    fontFamily: 'sans',
    loggingEnabled: false,
    mechanics: DEFAULT_MECHANICS
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDiceTrayOpen, setIsDiceTrayOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'narrative' | 'dashboard'>('narrative');
  const [rightPanelTab, setRightPanelTab] = useState<'dashboard' | 'lore' | 'codex'>('dashboard');
  const [isBookView, setIsBookView] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRolls, setPendingRolls] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLore, setShowLore] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef<GameSession | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    currentSessionRef.current = currentSession;
    if (ws && ws.readyState === WebSocket.OPEN && currentSession) {
      console.log('Joining room:', currentSession.id);
      ws.send(JSON.stringify({ type: 'join', sessionId: currentSession.id }));
    }
  }, [currentSession, ws]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    
    socket.onopen = () => {
      console.log('WebSocket Connected');
      if (currentSessionRef.current) {
        socket.send(JSON.stringify({ type: 'join', sessionId: currentSessionRef.current.id }));
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const session = currentSessionRef.current;
      
      if (data.type === 'update' && session && data.sessionId === session.id) {
        console.log('Received update for session:', session.id);
        fetchSessions();
        // Refresh current session if it's the one that was updated
        fetch(`/api/sessions/${session.id}`)
          .then(res => res.json())
          .then(data => {
            if (data) {
              setCurrentSession({
                ...data,
                history: JSON.parse(data.history),
                codex: JSON.parse(data.codex)
              });
            }
          });
      }
    };

    socket.onclose = () => {
      console.log('WebSocket Disconnected');
    };

    setWs(socket);
    return () => socket.close();
  }, []); // Only run once on mount

  useEffect(() => {
    if (ws && ws.readyState === WebSocket.OPEN && currentSession) {
      console.log('Joining session room:', currentSession.id);
      ws.send(JSON.stringify({ type: 'join', sessionId: currentSession.id }));
    }
  }, [ws, currentSession?.id]);

  useEffect(() => {
    fetchSessions();
    fetchSettings();
  }, []);

  const fetchSessions = async () => {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    setSessions(data.map((s: any) => ({ 
      ...s, 
      history: JSON.parse(s.history || '[]'),
      codex: JSON.parse(s.codex || '[]')
    })));
  };

  const fetchSettings = async () => {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.modelUrl || data.provider || data.systemPrompt) {
      let loadedMechanics = DEFAULT_MECHANICS;
      if (data.mechanics) {
        try {
          const parsed = JSON.parse(data.mechanics);
          // Merge loaded mechanics with defaults to ensure new mechanics appear
          loadedMechanics = DEFAULT_MECHANICS.map(def => {
            const existing = parsed.find((p: any) => p.id === def.id);
            return existing ? { ...def, ...existing } : def;
          });
        } catch (e) {
          console.error("Failed to parse mechanics from settings", e);
        }
      }

      setSettings({
        provider: data.provider || 'gemini',
        modelUrl: data.modelUrl || 'http://localhost:1234/v1',
        apiKey: data.apiKey || '',
        modelName: data.modelName || 'local-model',
        systemPrompt: data.systemPrompt || SYSTEM_PROMPT,
        fontSize: data.fontSize ? parseInt(data.fontSize) : 16,
        fontFamily: data.fontFamily || 'sans',
        loggingEnabled: data.loggingEnabled === 'true',
        mechanics: loadedMechanics
      });
    }
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    setSettings(newSettings);
    setIsSettingsOpen(false);
  };

  const handleNewSession = async () => {
    const id = crypto.randomUUID();
    const newSession: GameSession = {
      id,
      name: 'New Adventure',
      genre: 'Dark Fantasy',
      setting: 'Nexus Prime',
      style: 'Grimdark',
      snapshot: '',
      history: [],
      lore: '',
      codex: [],
      updated_at: new Date().toISOString()
    };
    setCurrentSession(newSession);
    setSessions([newSession, ...sessions]);
    
    // Save to DB immediately so it appears in sidebar
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newSession,
        history: JSON.stringify([]),
        codex: JSON.stringify([])
      })
    });
  };

  const handleSelectSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) setCurrentSession(session);
  };

  const handleDeleteSession = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    setSessions(sessions.filter(s => s.id !== id));
    if (currentSession?.id === id) setCurrentSession(null);
  };

  const parseDashboard = (text: string): { cleanText: string, dashboard?: DashboardData, codexUpdates?: CodexEntry[], loreUpdate?: string } => {
    let cleanText = text;
    let dashboard: DashboardData | undefined;
    let codexUpdates: CodexEntry[] | undefined;

    const dashMatch = text.match(/<dashboard_json>([\s\S]*?)<\/dashboard_json>/);
    if (dashMatch) {
      try {
        dashboard = JSON.parse(dashMatch[1]);
        cleanText = cleanText.replace(/<dashboard_json>[\s\S]*?<\/dashboard_json>/, '').trim();
      } catch (e) { console.error("Dashboard parse error", e); }
    }

    const codexMatch = text.match(/<codex_json>([\s\S]*?)<\/codex_json>/);
    if (codexMatch) {
      try {
        codexUpdates = JSON.parse(codexMatch[1]);
        cleanText = cleanText.replace(/<codex_json>[\s\S]*?<\/codex_json>/, '').trim();
      } catch (e) { console.error("Codex parse error", e); }
    }

    const loreMatch = text.match(/<lore_update>([\s\S]*?)<\/lore_update>/i);
    if (loreMatch) {
      cleanText = cleanText.replace(/<lore_update>[\s\S]*?<\/lore_update>/i, '').trim();
    }

    // Clean up unwanted headers that the model might still output
    cleanText = cleanText.replace(/^###\s*(Narrative|Нарратив)\s*\n?/i, '').trim();
    cleanText = cleanText.replace(/###\s*(Actions & Rolls|Векторы действий|Действия)[\s\S]*?(?=(<|$))/i, '').trim();

    return { cleanText, dashboard, codexUpdates, loreUpdate: loreMatch ? loreMatch[1].trim() : undefined };
  };

  const saveSession = async (session: GameSession = currentSession!) => {
    if (!session) return;
    setIsSaving(true);
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...session,
          history: JSON.stringify(session.history),
          codex: JSON.stringify(session.codex)
        })
      });
      await fetchSessions();
    } catch (error) {
      console.error("Save Error:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateDashboard = (newData: DashboardData) => {
    if (!currentSession) return;
    const newHistory = [...currentSession.history];
    let lastMsgIndex = -1;
    for (let i = newHistory.length - 1; i >= 0; i--) {
      if (newHistory[i].dashboard !== undefined) {
        lastMsgIndex = i;
        break;
      }
    }
    
    if (lastMsgIndex !== -1) {
      newHistory[lastMsgIndex] = { ...newHistory[lastMsgIndex], dashboard: newData };
    } else {
      newHistory.push({ role: 'system', content: 'Manual Dashboard Update', dashboard: newData });
    }
    
    const updatedSession = { ...currentSession, history: newHistory };
    setCurrentSession(updatedSession);
    saveSession(updatedSession);
  };

  const sendMessage = async (content: string) => {
    if (!currentSession) return;
    
    const lastMsg = currentSession.history[currentSession.history.length - 1];
    const isLastMsgUser = lastMsg?.role === 'user';
    
    if (!content.trim() && Object.keys(pendingRolls).length === 0 && !isLastMsgUser) return;

    let updatedHistory = [...currentSession.history];
    const currentDashboard = currentSession.history.slice().reverse().find(m => m.dashboard)?.dashboard || INITIAL_DASHBOARD;
    
    // If there is new content or pending rolls, we create a new user message
    if (content.trim() || Object.keys(pendingRolls).length > 0) {
      let finalContent = content;
      
      // Process pending rolls (manual GM rolls only)
      if (Object.keys(pendingRolls).length > 0) {
        const rolls = Object.values(pendingRolls);
        finalContent += (finalContent ? '\n\n' : '') + `### GM Rolls:\n${rolls.join('\n')}`;
      }

      const userMsg: Message = { role: 'user', content: finalContent };
      updatedHistory = [...currentSession.history, userMsg];
      
      setCurrentSession({ ...currentSession, history: updatedHistory });
      setInput('');
      setPendingRolls({});
    }

    setIsLoading(true);

    try {
      let aiContent = '';
      let logRequest: any = null;
      
      // Token Optimization: Only send the last 6 messages + Lore + Current State as context
      const contextWindow = updatedHistory.slice(-6);
      const loreContext = currentSession.lore ? `\n\n### ЭХО ПРОШЛОГО (Краткое содержание предыдущих событий):\n${currentSession.lore}\n` : '';
      const codexContext = currentSession.codex.length > 0 ? `\n\n### КОДЕКС (NPC, Локации, Предметы):\n${JSON.stringify(currentSession.codex, null, 2)}\n` : '';
      const dashboardContext = `\n\n### ТЕКУЩЕЕ СОСТОЯНИЕ ИГРЫ (DASHBOARD):\n${JSON.stringify(currentDashboard, null, 2)}\nОБЯЗАТЕЛЬНО используй эти данные как основу для следующего JSON.`;
      
      const activeMechanics = (settings.mechanics || DEFAULT_MECHANICS)
        .filter(m => m.enabled)
        .map(m => `### ${m.name}\n${m.description}`)
        .join('\n\n');
      const mechanicsContext = activeMechanics ? `\n\n## АКТИВНЫЕ МЕХАНИКИ\nПроверки выполняются тобой. Стат всегда суммируется с итоговым кубиком.\n${activeMechanics}` : '';
      
      const isClarify = content.startsWith('[CLARIFY]');
      const basePrompt = isClarify ? CLARIFY_SYSTEM_PROMPT : settings.systemPrompt;

      // Combine game rules, technical requirements, lore, and current state
      const fullSystemPrompt = `${basePrompt}${isClarify ? '' : mechanicsContext}\n\n${getTechnicalInstructions(settings.mechanics || DEFAULT_MECHANICS)}\n${loreContext}${codexContext}${dashboardContext}`;

      if (settings.provider === 'gemini') {
        const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("Gemini API Key not found. Please ensure it is set in the Settings or Secrets panel.");
        }
        const ai = new GoogleGenAI({ apiKey });
        logRequest = [
          { role: 'user', parts: [{ text: fullSystemPrompt }] },
          ...contextWindow.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          }))
        ];
        
        const modelToUse = (settings.modelName && settings.modelName !== 'local-model') 
          ? settings.modelName 
          : "gemini-3-flash-preview";
          
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: logRequest
        });
        aiContent = response.text || '';
      } else {
        const messages = [
          { role: 'system', content: fullSystemPrompt },
          ...contextWindow.map(m => ({ role: m.role, content: m.content }))
        ];
        logRequest = messages;

        // Sanitize URL: remove trailing slash
        const baseUrl = settings.modelUrl.replace(/\/$/, '');
        const url = `${baseUrl}/chat/completions`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        
        if (settings.apiKey) {
          headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: settings.modelName,
              messages,
              temperature: 0.7,
            })
          });

          if (!response.ok) {
            throw new Error(`Local Model Error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          aiContent = data.choices?.[0]?.message?.content;
          
          if (!aiContent) {
            throw new Error("Local model returned empty response or invalid format.");
          }
        } catch (e) {
          if (e instanceof TypeError && e.message === 'Failed to fetch') {
            throw new Error("Network Error: Could not connect to local model. \n1. Check if the model is running.\n2. If using HTTPS (Cloud), your browser may be blocking HTTP (Localhost) requests (Mixed Content).\n3. Ensure CORS is enabled on your local server.");
          }
          throw e;
        }
      }

      // Log if enabled
      if (settings.loggingEnabled) {
        fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: currentSession.id,
            request: logRequest,
            response: aiContent
          })
        }).catch(err => console.error("Logging failed:", err));
      }

      const { cleanText, dashboard: aiDashboard, codexUpdates, loreUpdate } = parseDashboard(aiContent);

      const aiMsg: Message = { 
        role: 'assistant', 
        content: cleanText,
        dashboard: isClarify ? currentDashboard : (aiDashboard || currentDashboard)
      };

      // Merge Codex Updates
      let finalCodex = [...currentSession.codex];
      if (codexUpdates) {
        codexUpdates.forEach(update => {
          const index = finalCodex.findIndex(e => e.name === update.name);
          if (index >= 0) {
            finalCodex[index] = { ...finalCodex[index], ...update };
          } else {
            finalCodex.push({ ...update, id: update.id || crypto.randomUUID() });
          }
        });
      }

      const finalHistory = [...updatedHistory, aiMsg];
      const updatedSession = { 
        ...currentSession, 
        history: finalHistory,
        lore: loreUpdate || currentSession.lore,
        codex: finalCodex,
        updated_at: new Date().toISOString()
      };

      setCurrentSession(updatedSession);
      
      // Save to DB
      await saveSession(updatedSession);
    } catch (error) {
      console.error("AI Error:", error);
      const errorMsg: Message = { 
        role: 'assistant', 
        content: `Nexus Error: ${error instanceof Error ? error.message : "Could not connect to AI provider. Please check your settings."}` 
      };
      setCurrentSession({ ...currentSession, history: [...updatedHistory, errorMsg] });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoll = (result: string) => {
    setInput(prev => prev ? `${prev}\n${result}` : result);
  };

  const exportBook = () => {
    if (!currentSession) return;
    const narrative = currentSession.history
      .filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join('\n\n---\n\n');
    
    const blob = new Blob([`# ${currentSession.name}\n\n${narrative}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.name.replace(/\s+/g, '_')}_Chronicle.md`;
    a.click();
  };

  const currentDashboard = currentSession?.history.slice().reverse().find(m => m.dashboard)?.dashboard || INITIAL_DASHBOARD;

  return (
    <Routes>
      <Route path="/character/:sessionId/:charName" element={<CharacterView />} />
      <Route path="/" element={
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
            handleNewSession();
            setIsSidebarOpen(false);
          }}
          onDeleteSession={handleDeleteSession}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
            setIsSidebarOpen(false);
          }}
        />
      </div>

      <main className="flex-1 flex flex-col relative min-w-0">
        {currentSession ? (
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
                  Story
                </button>
                <button 
                  onClick={() => setMobileView('dashboard')}
                  className={`px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-bold transition-all ${mobileView === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40'}`}
                >
                  Stats
                </button>
              </div>
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-white/60">
                <SettingsIcon size={20} />
              </button>
            </div>

            {/* Narrative Area */}
            <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${mobileView !== 'narrative' ? 'hidden lg:flex' : 'flex'}`}>
              {/* Narrative Header */}
              <div className="px-8 py-4 border-b border-white/5 flex justify-between items-center bg-black/20">
                <div className="flex items-center gap-4">
                  <h2 className="font-display font-bold text-white/80">{currentSession.name}</h2>
                  <div className="h-4 w-px bg-white/10" />
                  <button 
                    onClick={() => setIsBookView(!isBookView)}
                    className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold transition-all ${isBookView ? 'text-emerald-400' : 'text-white/40 hover:text-white'}`}
                  >
                    <Library size={12} /> {isBookView ? 'Book Mode Active' : 'Switch to Book Mode'}
                  </button>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
                    <button 
                      onClick={() => handleSaveSettings({ ...settings, fontSize: Math.max(12, settings.fontSize - 1) })}
                      className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-all"
                      title="Decrease font size"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-[10px] text-white/40 font-mono w-6 text-center">{settings.fontSize}</span>
                    <button 
                      onClick={() => handleSaveSettings({ ...settings, fontSize: Math.min(24, settings.fontSize + 1) })}
                      className="p-1 hover:bg-white/10 rounded text-white/40 hover:text-white transition-all"
                      title="Increase font size"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <button 
                  onClick={exportBook}
                  className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-all flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold"
                >
                  <Download size={14} /> Export
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-8 lg:space-y-12 scroll-smooth">
                <AnimatePresence mode="popLayout">
                  {currentSession.history
                    .filter(msg => !isBookView || msg.role === 'assistant')
                    .map((msg, i) => (
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
                              <span className="text-[8px] uppercase tracking-widest font-bold opacity-60">Incoming Player Action</span>
                              <span>{(msg.content || '').replace(/\[PLAYER ACTION:.*?\]/, '').trim()}</span>
                              <span className="text-[8px] italic opacity-40">— {(msg.content || '').match(/\[PLAYER ACTION: (.*?)\]/)?.[1]}</span>
                            </div>
                          ) : msg.content}
                        </div>
                      ) : (
                        <div 
                          className={`narrative-text space-y-4 ${isBookView ? 'text-white/90' : 'text-white/80'}`}
                          style={{ 
                            fontSize: `${settings.fontSize}px`,
                            fontFamily: settings.fontFamily === 'serif' ? 'serif' : settings.fontFamily === 'mono' ? 'monospace' : 'inherit'
                          }}
                        >
                          {(msg.content || '').split('\n\n').map((p, j) => (
                            <p key={j}>{p}</p>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {isLoading && (
                  <div className="max-w-3xl mx-auto flex items-center gap-3 text-white/40 italic font-serif text-sm lg:text-base">
                    <Loader2 className="animate-spin" size={18} />
                    The Master is weaving the thread...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
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
                            setPendingRolls(prev => ({ ...prev, [charName]: rollResult }));
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
                      placeholder="Describe your action..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 lg:px-6 py-3 lg:py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all resize-none h-20 lg:h-24 text-sm lg:text-base pr-12"
                    />
                    <div className="absolute bottom-3 right-3 lg:bottom-4 lg:right-4 flex gap-2">
                      <button
                        onClick={() => {
                          if (input.trim()) {
                            sendMessage(`[CLARIFY] ${input}`);
                            setInput('');
                          }
                        }}
                        title="Clarify Details (Updates Codex)"
                        disabled={isLoading || !input.trim()}
                        className="p-2 bg-white/5 text-white/40 hover:text-emerald-400 rounded-xl transition-all disabled:opacity-30"
                      >
                        <HelpCircle size={18} />
                      </button>
                      <button
                        onClick={() => setIsDiceTrayOpen(!isDiceTrayOpen)}
                        className={`p-2 rounded-xl transition-all ${isDiceTrayOpen ? 'bg-white text-black' : 'bg-white/5 text-white/40 hover:text-white'}`}
                      >
                        <Dices size={18} />
                      </button>
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
                    {currentSession.history.length === 0 && (
                      <button onClick={() => setInput('START_NEW_STORY [Dark Fantasy, Nexus Prime, Grimdark, A lone wanderer]')} className="vector-btn text-[10px] lg:text-sm text-emerald-400/80 border-emerald-500/20">Initialize Story</button>
                    )}
                    <button 
                      onClick={() => saveSession()} 
                      disabled={isSaving || !currentSession}
                      className="vector-btn text-[10px] lg:text-sm text-amber-400/80 border-amber-500/20 flex items-center gap-2"
                    >
                      {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {isSaving ? 'Saving...' : 'Nexus Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Dashboard Sidebar */}
            <div className={`w-full lg:w-96 border-l border-white/10 bg-black/20 backdrop-blur-sm overflow-hidden flex flex-col min-h-0 ${mobileView !== 'dashboard' ? 'hidden lg:flex' : 'flex'}`}>
              <div className="p-4 border-b border-white/10 flex gap-1">
                <button 
                  onClick={() => setRightPanelTab('dashboard')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <Sparkles size={12} /> Stats
                </button>
                <button 
                  onClick={() => setRightPanelTab('codex')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'codex' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <Library size={12} /> Codex
                </button>
                <button 
                  onClick={() => setRightPanelTab('lore')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'lore' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <History size={12} /> Lore
                </button>
              </div>
              <div className="flex-1 overflow-hidden h-full">
                {rightPanelTab === 'lore' ? (
                  <div className="p-6 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <History size={12} /> Story Archive
                    </h3>
                    <div className="text-sm text-white/60 font-serif leading-relaxed whitespace-pre-wrap">
                      {currentSession.lore || "No lore recorded yet. Use 'Save' command to crystallize the story."}
                    </div>
                  </div>
                ) : rightPanelTab === 'codex' ? (
                  <Codex entries={currentSession.codex} />
                ) : (
                  <Dashboard 
                    data={currentDashboard} 
                    sessionId={currentSession.id}
                    enabledMechanics={settings.mechanics} 
                    onUpdate={handleUpdateDashboard}
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
                "The Nexus Prime awaits your command. Every choice is a thread in the tapestry of reality."
              </p>
            </motion.div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl px-4">
              <button 
                onClick={handleNewSession}
                className="p-6 lg:p-8 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group text-left"
              >
                <Plus className="text-white/40 group-hover:text-white mb-4 transition-colors" size={24} />
                <h3 className="text-white font-bold text-lg lg:text-xl">Begin New Chronicle</h3>
                <p className="text-white/40 text-xs lg:text-sm mt-2">Start a fresh adventure in the Nexus Prime system.</p>
              </button>
              
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-6 lg:p-8 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group text-left"
              >
                <SettingsIcon className="text-white/40 group-hover:text-white mb-4 transition-colors" size={24} />
                <h3 className="text-white font-bold text-lg lg:text-xl">Configure Nexus</h3>
                <p className="text-white/40 text-xs lg:text-sm mt-2">Connect to your local OpenAI-compatible model.</p>
              </button>
            </div>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <SettingsModal 
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
      <PromptModal />
    </div>
    } />
    </Routes>
  );
}
