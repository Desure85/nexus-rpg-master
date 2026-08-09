import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { SettingsModal } from './components/SettingsModal';
import { DiceRoller } from './components/DiceRoller';
import { Codex } from './components/Codex';
import { CharacterView } from './components/CharacterView';
import { PromptModal } from './components/PromptModal';
import { SessionSetup, SetupData } from './components/SessionSetup';
import { GameSession, AppSettings, Message, DashboardData, CodexEntry, MechanicConfig } from './types';
import { Send, Loader2, Sparkles, BookOpen, History, Plus, Minus, Settings as SettingsIcon, Menu, X as CloseIcon, LayoutDashboard, MessageSquare, MessageSquarePlus, Dices, Download, Library, HelpCircle, Flag, Skull, Eye, Footprints, ScrollText, Users, Award } from 'lucide-react';
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
    description: 'Счетчик эскалации (от 0 до 20). +1 за каждый провал или Искушение. При достижении 20 происходит КАТАСТРОФА (смерть NPC, потеря важного предмета, появление босса), и пул сбрасывается до 0.'
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
  },
  {
    id: 'loot',
    name: 'Loot & Resources (Лут)',
    enabled: true,
    description: 'Если персонажи побеждают врагов или успешно обыскивают локацию, ОБЯЗАТЕЛЬНО добавляй полезные предметы (зелья лечения, броню, оружие, золото) в массив sceneLoot.'
  },
  {
    id: 'decision_tree',
    name: 'Древо Решений (Decision Tree)',
    enabled: true,
    description: 'В dashboard_json поддерживай массив decisionTree: [{"id": "D1", "choice": "Пощадил врага", "status": "active|resolved", "consequence": "Готовит месть"}]. Фиксируй ключевые выборы игроков: active — влияют на будущее, resolved — завершены. Обновляй статусы при развитии сюжета.'
  },
  {
    id: 'nexus_save',
    name: 'NEXUS SAVE (Сохранение Главы)',
    enabled: true,
    description: 'По команде [SAVE_CHAPTER]: 1) <lore_update> — кристаллизованный Story Archive (до 800 слов: NPC, локации, конфликты, улики); 2) <final_draft> — литературный Final Draft главы (300-600 слов); 3) обнови decisionTree в dashboard_json.'
  },
  {
    id: 'abilities',
    name: 'Уникальные способности (AI-прогрессия)',
    enabled: true,
    description: 'При повышении уровня DM придумывает персонажу НОВУЮ уникальную способность по пути героя. Способность может быть: полезной (бонус/умение), вредной (шрам/проклятие от пережитого), флаворовой (особенность характера без механики) или механической (даёт конкретное правило). Тип отражает судьбу героя — у разных героев разные наборы.'
  },
  {
    id: 'downed',
    name: 'Повержен и Смерть (Death & Downed)',
    enabled: true,
    description: 'Гибкая система выбытия для широкой аудитории:\n- HP 0 → персонаж ПОВЕРЖЕН (НЕ мёртв сразу): опиши падение драматично (Bullet Time), останови ход.\n- Спасбросок Смерти: d20 ([ROLL: 1d20]): 10+ → стабилизация на 1 HP ([HEAL: Имя +1]); 1-9 → умирает в конце СЛЕДУЮЩЕГО хода, если никто не стабилизирует.\n- Стабилизация: союзник в свой ход тратит Жетон или Зелье лечения → [HEAL: Имя +N], персонаж возвращается (с 1 HP). Поверженный сам действовать не может.\n- Сдаться (Fate): поверженный игрок может выбрать «сдаться» → выживает, но получает ПОСТОЯННУЮ curse-способность (шрам/фобия, type: curse в abilities) и выбывает из боя.\n- Стресс 10 → СЛОМЛЕН (не смерть): персонаж теряет контроль до конца сцены и получает curse-способность (безумие/фобия); после сцены приходит в себя, но шрам остаётся.\n- Фатальная ошибка игрока (прыжок в лаву и т.п.) — смерть без спасбросков, честно.'
  }
];

export const SYSTEM_PROMPT = `
# ROLE: Мастер Игры (DM) — Система "Fate & Dragons" (v.5.1 Nexus Prime)

## 1. ФИЛОСОФИЯ: БЕСПРИСТРАСТНЫЙ СУДЬЯ
Ты — логичный, честный и беспристрастный мир. Твоя цель: реагировать на действия игроков максимально реалистично в рамках сеттинга.
**ЗОЛОТЫЕ ПРАВИЛА:**
- **Никакой сюжетной брони (Plot Armor):** Не подыгрывай игрокам и не спасай их от последствий их собственных глупых решений.
- **Никакой искусственной жестокости:** Не пытайся убить их специально. Если они действуют умно и бросок успешен — они побеждают.
- **Кубик — это закон:** Если игрок провалил бросок, последствия должны быть реальными и ощутимыми.
- НИКОГДА не описывай действия, мысли или реакции персонажей за них. Останавливайся в момент выбора или сразу после оглашения последствий.

## 2. АВТОРИТЕТ БРОСКОВ (КРИТИЧЕСКИ ВАЖНО): NO TAG = NO ROLL
Кубики бросает ТОЛЬКО приложение (Dice Roller). Результаты приходят тегами вида:
[ROLL: 1d20 = 14]
[ROLL: Stress Resonance (3d20) = [7, 14, 19] | Stress: +2 (Max used)]
[ROLL: Fate Shift (3d20 + 1d6) = [3, 11, 17] | d6: 5 (Mod: +1)]
ПРАВИЛА:
- Ты НИКОГДА не выдумываешь броски и не пересчитываешь их. Теги [ROLL:] — единственный источник правды.
- Если тега нет — броска не было. Не описывай результат несуществующего броска.
- Стат ВСЕГДА суммируется с итоговым кубиком. Учитывай выбранную позицию (Max/Mid/Min по стрессу).
- Провал (итог ниже сложности) — реальные последствия: урон, стресс, потеря ресурсов, заполнение Часов или рост Doom Pool.

## 3. ПРОТОКОЛ ОТВЕТА
1. Narrative (ТОЛЬКО художественное описание текущей ситуации. ВАЖНО: НЕ ПИШИ заголовки вроде "### Нарратив" или "### Narrative". Просто начинай писать текст. НЕ ВЫВОДИ векторы действий в тексте, они должны быть только в JSON дашборда!).
2. Механические теги [ROLL:] нарратизируются как ПРИЧИНА (мокрая земля, сорвавшийся хват), а не как «повезло/не повезло».

## 4. САМОВОССТАНОВЛЕНИЕ (OMISSION_RECOVERY)
Если ты заметил, что пропустил механику (не учёл [ROLL:] тег, не списал жетон/HP/Doom, забыл последствие):
1. Стоп на полуслове — без «простите», по-деловому.
2. Учти пропущенный тег и его последствия.
3. Кратко перескажи ход с поправкой (1-2 предложения) и продолжай.
Честность механики важнее ровного текста.

## 5. СПЕЦИАЛЬНЫЕ КОМАНДЫ (МЕТА-ГЕЙМИНГ)
- **[CLARIFY]**: Если сообщение игрока начинается с этого тега, это значит, что он задает вопрос о мире, предмете или NPC "вне игры".
  1. Сначала дай подробный ответ в тексте.
  2. ОБЯЗАТЕЛЬНО обнови Кодекс (<codex_json>), добавив туда все новые детали.
  3. НЕ продолжай сюжет активно, пока не ответишь на вопрос. Сосредоточься на уточнении лора.
  4. Если вопрос касается предмета в инвентаре — опиши его свойства. Если NPC — его внешность и статус.
- **[FINALE]**: Вечерний финал. ЛОГИЧЕСКИ подведи сюжет к завершению за 2-4 хода (~10-30 мин реального времени). Сюжет может быть далеко от конца — сжимай естественно: сведи открытые линии к ключевым сценам-мостам, ускорь темп к кульминации (решающий бой/выбор/открытие), затем развяжи конфликты и дай передышку-эпилог. Финал должен ощущаться ЗАВЕРШЁННЫМ для этой партии, без обрубленных нитей (незакрытое — как намёк на будущее, не дыра). Заверши <session_summary> (итоги партии).
- **[SESSION SUMMARY]**: Подведи итоги партии. Выведи <session_summary>...</session_summary>: краткий пересказ приключения + итоги (чего добились герои, награды, XP, судьбы NPC, что запомнилось). Тёплый эпилог в стиле сессии.
- **[SAVE_CHAPTER]**: Игрок нажал "NEXUS SAVE". Твоя задача:
  1. В <lore_update> выведи КРИСТАЛЛИЗОВАННЫЙ Story Archive (до 800 слов): NPC (кто, чего хочет), локации, неразрешённые конфликты, ключевые улики. Сжатая художественная экспозиция, от третьего лица, в стиле сессии.
  2. В теге <final_draft> выведи Final Draft — полное литературное описание главы (синтез диалогов и бросков, 300-600 слов).
  3. В <dashboard_json> добавь/обнови decisionTree: зафиксируй ключевые выборы со статусами ("Пощадил врага" -> status "active", "Сжёг мост" -> status "resolved").

## 6. ЧЕСТНЫЕ ПОСЛЕДСТВИЯ
Мир реагирует строго по логике:
- **Провал броска:** Логичные, жесткие, но честные последствия. Наноси урон (HP), повышай Стресс, лишай ресурсов, вводи новые Угрозы. Враги действуют эффективно и безжалостно.
- **Успех броска:** Игрок получает ровно то, что хотел, без скрытых подвохов.
- **Искушение (Temptation):** Если игрок выбирает действие категории "Искушение", он получает сиюминутную выгоду, но ВСЕГДА платит логичную цену (рост Doom Pool, предательство, осложнение).
- **СМЕРТЬ/ВЫБЫТИЕ:** регулируются механикой «Повержен и Смерть» (см. АКТИВНЫЕ МЕХАНИКИ). Не убивай персонажа мгновенно без правил этой механики. Будь честным арбитром.
`;

export const getTechnicalInstructions = (mechanics: MechanicConfig[]) => {
  const isEnabled = (id: string) => mechanics.find(m => m.id === id)?.enabled ?? false;
  
  const disabledMechanics = mechanics.filter(m => !m.enabled).map(m => m.name);
  const disabledWarning = disabledMechanics.length > 0 
    ? `\n\n## ОТКЛЮЧЕННЫЕ МЕХАНИКИ\nСТРОГО ЗАПРЕЩЕНО использовать следующие механики: ${disabledMechanics.join(', ')}. Не упоминай их и не добавляй их параметры в JSON.` 
    : '';

  const charFields = [
    `"name": "..."`,
    isEnabled('hp') ? `"hp": "X/Y"` : null,
    isEnabled('stress') ? `"stress": "X/Y" (или число)` : null,
    isEnabled('tokens') ? `"tokens": 0` : null,
    `"gold": 0`,
    `"xp": 0`,
    isEnabled('abilities') ? `"abilities": [{"name": "Название способности", "desc": "Описание", "effect": "Механика или «—» для флаворовой", "type": "boon|curse|flavor|mechanical"}]` : null,
    isEnabled('condition') ? `"condition": "..."` : null,
    `"goal": "..."`,
    isEnabled('inventory') ? `"inventory": ["Предмет 1", "..."]` : null,
    isEnabled('equipment') ? `"equipment": [{"slot": "head|body|main-hand|off-hand|accessory", "item": {"name": "...", "description": "...", "bonus": "+1 Armor|Fire Resistance|...", "rarity": "common|uncommon|rare|epic|legendary"}}]` : null,
    isEnabled('relationships') ? `"relationships": [{"target": "NPC", "level": 0, "status": "..."}]` : null,
    isEnabled('actions') ? `"actions": [{"category": "Профильный|Рискованный|Синергия|Искушение", "name": "...", "description": "..."}]` : null
  ].filter(Boolean).join(',\n    ');

  const dashFields = [
    `"characters": [{\n    ${charFields}\n  }]`,
    isEnabled('threats_dash') ? `"threats": [{"name": "...", "hp": "...", "features": ["Броня", "Яд"]}]` : null,
    isEnabled('scene_aspects') ? `"sceneAspects": ["Темный лес", "Запах гари", "Скользкий пол"]` : null,
    isEnabled('loot') ? `"sceneLoot": ["Лечебное зелье (Восстанавливает 5 HP)", "Ржавый меч"]` : null,
    `"locations": [{"id": "uuid", "name": "...", "description": "...", "dangerLevel": 1, "status": "visited|known|locked", "type": "city|village|outpost|fortress|tavern|temple|wilderness|ruins|dungeon", "services": ["market", "tavern", "inn", "smith", "healer", "questboard", "library", "stables", "barracks", "dock"], "coordinates": {"x": 50, "y": 50}, "connections": ["other_loc_id"]}]`,
    `"currentLocationId": "uuid"`,
    isEnabled('clocks') ? `"clocks": [{"name": "...", "progress": 0, "total": 4}]` : null,
    isEnabled('doom_pool') ? `"doomPool": 0` : null,
    isEnabled('echoes') ? `"echoes": ["Звон мечей вдали", "Шепот ветра"]` : null,
    `"atmosphere": "..."`,
    isEnabled('threat') ? `"threatLevel": 0` : null,
    isEnabled('decision_tree') ? `"decisionTree": [{"id": "D1", "choice": "...", "status": "active|resolved", "consequence": "..."}]` : null,
    `"suggestedRoll": {"type": "classic|triple|shifted|taint", "reason": "..."}`
  ].filter(Boolean).join(',\n  ');

  return `
## ТЕХНИЧЕСКИЙ ПРОТОКОЛ (КРИТИЧЕСКИ ВАЖНО!)
Твой ответ ВСЕГДА должен состоять из двух частей: сначала художественный текст, а затем технические блоки JSON. БЕЗ JSON ИНТЕРФЕЙС ИГРЫ СЛОМАЕТСЯ!

### ПРАВИЛА СНАРЯЖЕНИЯ (EQUIPMENT):
- Каждый предмет в слоте (head, body, main-hand, off-hand, accessory) должен иметь поле **bonus**.
- Бонус должен быть конкретным (например, "+1 к защите", "Иммунитет к огню", "Урон +2").
- Ты ОБЯЗАН учитывать эти бонусы при описании результатов действий персонажа. Если у игрока есть "Щит (+1 к защите)", он должен реже получать урон или получать его в меньшем объеме.

ВАЖНОЕ ПРАВИЛО: НИКОГДА не пиши никакой текст ПОСЛЕ блоков JSON. Твой ответ должен заканчиваться закрывающим тегом (например, </dashboard_json> или </lore_update>). Любой текст после JSON сломает парсер!${disabledWarning}

1. Дашборд: Оберни в теги <dashboard_json>...</dashboard_json>.
Формат (СТРОГИЙ JSON, никаких стрелочек, комментариев или неэкранированных кавычек внутри значений!):
{
  ${dashFields}
}
ВАЖНО: Поля tokens, doomPool, threatLevel, progress, total, gold (если они есть) должны быть ЧИСЛАМИ. Поле stress может быть ЧИСЛОМ или СТРОКОЙ вида "X/Y" (где Y - максимум). Поля features, sceneAspects, sceneLoot, echoes должны быть МАССИВАМИ СТРОК.
ВАЖНО: Поле gold — числовой кошелёк персонажа. Золото из лута добавляй СЮДА (числом), а не в inventory. У каждого персонажа свой кошелёк.
АВТОРИТЕТ ЧИСЕЛ (STATE AUTHORITY): Числами персонажей (HP, стресс, жетоны, золото, XP) владеет ДВИЖОК. Каждый ход приходит тег [STATE: ...] с текущими значениями. Изменения чисел — ТОЛЬКО тегами в тексте ответа (не в dashboard_json — их всё равно перезапишет движок):
[DAMAGE: Имя -N] урон · [HEAL: Имя +N] лечение · [STRESS: Имя +N] · [GOLD: Имя +N] · [XP: Имя +N] · [TOKEN: Имя -1].
В dashboard_json числа пиши как в [STATE].
РОСТЕР ПАРТИИ: персонажи со статусом 🏠 (base) — на базе: отдыхают, НЕ участвуют в текущих сценах и боях (упоминай их присутствие на базе, но не вводи в действие). В партии (⚔️) — действуют.
ПРОГРЕССИЯ: Поле xp — опыт (золото = XP: получил золото — добавь столько же XP). Уровень = floor(sqrt(xp/50))+1 (уровень 1: 0 XP, 2: 50, 3: 200, 4: 450). При повышении уровня увеличь max HP персонажа на +2.
АВТОСКЕЙЛ: Угрозы должны соответствовать уровню партии: HP врага ≈ 8 + уровень×3 + dangerLevel×2, особенностей ≈ 1 + уровень/2. Не делай врагов ни «мясом», ни «имбой».
УНИКАЛЬНЫЕ СПОСОБНОСТИ (ПРОГРЕССИЯ): при повышении уровня персонажа ТЫ ОБЯЗАН придумать НОВУЮ уникальную способность (НЕ из фиксированного списка!): имя + описание + механика. Тип способности отражает ПУТЬ героя и может быть ЛЮБЫМ:
- boon (полезная): бонус/умение, которое герой развил («Тень доков: +2 к скрытности в портах»)
- curse (вредная): шрам/проклятие от пережитого («Обожжённая рука: -1 к рукопашной», «Боится огня: -2 на проверки рядом с пламенем»)
- flavor (бесполезная/особенность): черта характера без механики («Знает все песни доков», «Всегда находит кошек»)
- mechanical (дающая механику): конкретное правило («1 раз за бой: игнорирует один удар», «На стресс 5+: Nexus берет Min+1»)
Путь героя не всегда восхождение: получивший много урона копит шрамы (curse), мастер чего-то — бонусы (boon), эксцентрик — особенности (flavor). У разных героев — разные наборы, повторы запрещены. Добавляй в abilities (поле type; старые не удаляй).
${isEnabled('equipment') ? 'ВАЖНО: Поле equipment содержит экипированные предметы. Слоты динамические. По умолчанию используй стандартные (Голова, Тело, Оружие, Аксессуар), но смело добавляй новые специфичные слоты, если того требует сеттинг (например, "Кость духа", "Киберимплант", "Артефакт"). Если слот пуст, пиши "Пусто".\n' : ''}${isEnabled('actions') ? 'ВАЖНО: Для каждого персонажа генерируй от 1 до 3 действий (выбирай количество случайно). Категории действий выбирай абсолютно случайно. Разрешается и поощряется дублирование категорий (например, могут выпасть три действия категории "Искушение", если ситуация располагает к этому).\n' : ''}${isEnabled('doom_pool') ? 'ВАЖНО: Поле doomPool (0-20) отражает уровень эскалации. Увеличивай его на +1 за каждый провал игрока или выбор действия "Искушение". ЕСЛИ doomPool ДОСТИГАЕТ 20, ТЫ ОБЯЗАН СБРОСИТЬ ЕГО ДО 0 И ОПИСАТЬ КАТАСТРОФУ (внезапная смерть союзника, поломка оружия, появление босса, потеря важного предмета). Не копи doomPool вечно, используй его для драматичных поворотов!\n' : ''}${isEnabled('loot') ? 'ВАЖНО: Поле sceneLoot используется для добычи. Если персонажи побеждают врагов или успешно обыскивают локацию, ОБЯЗАТЕЛЬНО добавляй полезные предметы (зелья лечения, броню, оружие, золото) в массив sceneLoot. НЕ добавляй их сразу в инвентарь персонажа! Вместо этого сгенерируй для персонажа действие (Action) категории "Loot" с названием "Подобрать [Предмет]". Только когда игрок выберет это действие, ты переместишь предмет из sceneLoot в inventory.\n' : ''}
ВАЖНО: Поле locations содержит список ИЗВЕСТНЫХ локаций. 
- status="visited": Локация уже посещена и безопасна для перемещения.
- status="known": О локации известно, но персонажи там не были. Перемещение возможно.
- status="locked": Проход в локацию закрыт (нужен ключ, ремонт моста, зачистка врагов). Перемещение НЕВОЗМОЖНО, пока игроки не выполнят соответствующее действие.
Если персонажи узнают о новом месте (особенно при действии EXPLORE), добавь его (сгенерируй уникальный id) со статусом "known".
ПРИ ДОБАВЛЕНИИ НОВОЙ ЛОКАЦИИ:
1. Укажи coordinates: {x, y} (0-100). Новая локация должна быть рядом с текущей (сдвиг на 10-20 единиц). Избегай наложений.
2. Укажи connections: [id_текущей_локации]. Также добавь id новой локации в connections текущей локации. Это создаст связь на карте.
Если они прибывают в локацию, обнови ее описание, установи status="visited" и ОБЯЗАТЕЛЬНО установи currentLocationId равным id этой локации.
ОБЯЗАТЕЛЬНО соблюдай выбранный СТИЛЬ ИГРЫ при генерации dangerLevel (1-5). Не делай все локации сложными (4-5), если стиль не Combat Heavy! Чередуй уровни опасности.
ТИП И СЕРВИСЫ ЛОКАЦИЙ: у каждой локации указывай type (city/village/outpost/fortress/tavern/temple/wilderness/ruins/dungeon) и services из списка: market, tavern, inn, smith, healer, questboard, library, stables, barracks, dock.
- city (город): market, tavern, inn, smith, healer, questboard, library, stables, barracks, dock (если приморский)
- village (деревня): market (малый рынок), tavern, inn, smith, healer
- outpost/fortress (застава/крепость): barracks, stables, smith
- tavern (придорожный трактир): tavern, inn, stables
- temple (храм): healer, library
- wilderness/ruins/dungeon: services: [] (никаких сервисов!)
Торговля, отдых и лечение доступны ТОЛЬКО в локации с соответствующим сервисом — аутентичность месту.
2. Кодекс: Оберни в теги <codex_json>...</codex_json>.
Используй для фиксации NPC, локаций или предметов. 
ВАЖНО: Если в запросе есть тег [CLARIFY], твой приоритет №1 — обновить Кодекс. Зафиксируй там все детали, которые ты только что описал в тексте. Это твоя внешняя память.
Формат:
[{"name": "...", "type": "npc|location|item|lore", "description": "...", "status": "..."}]

3. Архив (Lore): ОБЯЗАТЕЛЬНО обновляй глобальный архив событий. Если произошло что-то важное, выведи теги <lore_update>...</lore_update> с ПОЛНЫМ обновленным кратким содержанием ВСЕГО сюжета (включая старые события). 
ВАЖНО: Если ты отвечаешь на [CLARIFY], НЕ выводи <lore_update>, так как сюжет не продвинулся.

4. Final Draft (только для [SAVE_CHAPTER]): Если в сообщении игрока был тег [SAVE_CHAPTER], выведи <final_draft>...</final_draft> — литературное описание главы (300-600 слов), синтез диалогов и бросков в стиле сессии. НИЧЕГО не пиши после закрывающего тега.

5. Session Summary (только для [SESSION SUMMARY]): Если в сообщении был тег [SESSION SUMMARY], выведи <session_summary>...</session_summary> — итоги партии (пересказ + награды + судьбы героев). НИЧЕГО не пиши после закрывающего тега.
`;
};

const levelFromXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp || 0) / 50)) + 1;

const INITIAL_DASHBOARD: DashboardData = {
  characters: [],
  threats: [],
  sceneAspects: [],
  clocks: [],
  doomPool: 0,
  echoes: [],
  atmosphere: "Waiting for initialization...",
  decisionTree: [],
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
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    provider: 'gemini',
    modelUrl: 'http://localhost:1234/v1',
    apiKey: '',
    modelName: 'local-model',
    systemPrompt: SYSTEM_PROMPT,
    fontSize: 16,
    fontFamily: 'sans',
    loggingEnabled: false,
    idlePlayerAction: 'random',
    mechanics: DEFAULT_MECHANICS
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDiceTrayOpen, setIsDiceTrayOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'narrative' | 'dashboard'>('narrative');
  const [isBookView, setIsBookView] = useState(false);
  const [confirmFinale, setConfirmFinale] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRolls, setPendingRolls] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [showLore, setShowLore] = useState(false);
  const [travelEvent, setTravelEvent] = useState<{ type: 'encounter' | 'discovery' | 'safe', locationName: string } | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [pendingClaims, setPendingClaims] = useState<any[]>([]);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [gmActionInputs, setGmActionInputs] = useState<Record<string, string>>({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<'dashboard' | 'lore' | 'codex' | 'players'>('dashboard');
  
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
      
      if (data.type === 'claims_changed' || data.type === 'actions_changed') {
        fetchPanels();
      }
      
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
        idlePlayerAction: data.idlePlayerAction || 'random',
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

  const handleNewSession = () => {
    setIsSettingUp(true);
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

  const parseDashboard = (text: string, currentDashboard: DashboardData): { cleanText: string, dashboard?: DashboardData, codexUpdates?: CodexEntry[], loreUpdate?: string, finalDraft?: string, sessionSummary?: string } => {
    let cleanText = text;
    let dashboard: DashboardData | undefined;
    let codexUpdates: CodexEntry[] | undefined;

    const dashMatch = text.match(/<dashboard_json>([\s\S]*?)<\/dashboard_json>/);
    if (dashMatch) {
      try {
        const parsed = JSON.parse(dashMatch[1]);
        let mergedCharacters = [...(currentDashboard.characters || [])];
        if (parsed.characters) {
          parsed.characters.forEach((parsedChar: any) => {
            const index = mergedCharacters.findIndex(c => c.name === parsedChar.name);
            if (index >= 0) {
              const currentChar = mergedCharacters[index];
              // Merge equipment by slot name to prevent AI from dropping custom slots
              let mergedEquipment = [...(currentChar.equipment || [])];
              if (parsedChar.equipment && Array.isArray(parsedChar.equipment)) {
                parsedChar.equipment.forEach((parsedEq: any) => {
                  const eqIndex = mergedEquipment.findIndex(e => e.slot === parsedEq.slot);
                  if (eqIndex >= 0) {
                    mergedEquipment[eqIndex] = { ...mergedEquipment[eqIndex], ...parsedEq };
                  } else {
                    mergedEquipment.push(parsedEq);
                  }
                });
              }

              // Merge relationships by target name
              let mergedRelationships = [...(currentChar.relationships || [])];
              if (parsedChar.relationships && Array.isArray(parsedChar.relationships)) {
                parsedChar.relationships.forEach((parsedRel: any) => {
                  const relIndex = mergedRelationships.findIndex(r => r.target === parsedRel.target);
                  if (relIndex >= 0) {
                    mergedRelationships[relIndex] = { ...mergedRelationships[relIndex], ...parsedRel };
                  } else {
                    mergedRelationships.push(parsedRel);
                  }
                });
              }

              mergedCharacters[index] = {
                ...currentChar,
                ...parsedChar,
                inventory: parsedChar.inventory || currentChar.inventory || [],
                equipment: mergedEquipment,
                relationships: mergedRelationships,
                actions: parsedChar.actions || currentChar.actions || []
              };
            } else {
              mergedCharacters.push(parsedChar);
            }
          });
        }

        // Merge locations
        let mergedLocations = [...(currentDashboard.locations || [])];
        if (parsed.locations) {
          parsed.locations.forEach((parsedLoc: any) => {
            const index = mergedLocations.findIndex(l => l.id === parsedLoc.id || l.name === parsedLoc.name);
            if (index >= 0) {
              mergedLocations[index] = { ...mergedLocations[index], ...parsedLoc };
            } else {
              mergedLocations.push(parsedLoc);
            }
          });
        }

        // Merge with current dashboard to prevent dropping arrays if AI omits them
        dashboard = {
          ...currentDashboard,
          ...parsed,
          characters: mergedCharacters,
          threats: parsed.threats || currentDashboard.threats || [],
          sceneAspects: parsed.sceneAspects || currentDashboard.sceneAspects || [],
          sceneLoot: parsed.sceneLoot || currentDashboard.sceneLoot || [],
          locations: mergedLocations,
          currentLocationId: parsed.currentLocationId || currentDashboard.currentLocationId,
          clocks: parsed.clocks || currentDashboard.clocks || [],
          echoes: parsed.echoes || currentDashboard.echoes || [],
          decisionTree: parsed.decisionTree || currentDashboard.decisionTree || [],
        };
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

    const finalDraftMatch = text.match(/<final_draft>([\s\S]*?)<\/final_draft>/i);
    if (finalDraftMatch) {
      cleanText = cleanText.replace(/<final_draft>[\s\S]*?<\/final_draft>/i, '').trim();
    }

    const sessionSummaryMatch = text.match(/<session_summary>([\s\S]*?)<\/session_summary>/i);
    if (sessionSummaryMatch) {
      cleanText = cleanText.replace(/<session_summary>[\s\S]*?<\/session_summary>/i, '').trim();
    }

    // Clean up unwanted headers that the model might still output
    cleanText = cleanText.replace(/^###\s*(Narrative|Нарратив)\s*\n?/i, '').trim();
    cleanText = cleanText.replace(/###\s*(Actions & Rolls|Векторы действий|Действия)[\s\S]*?(?=(<|$))/i, '').trim();

    return { cleanText, dashboard, codexUpdates, loreUpdate: loreMatch ? loreMatch[1].trim() : undefined, finalDraft: finalDraftMatch ? finalDraftMatch[1].trim() : undefined, sessionSummary: sessionSummaryMatch ? sessionSummaryMatch[1].trim() : undefined };
  };

  const parseStateTags = (text: string): { clean: string; changes: any[] } => {
    const changes: any[] = [];
    const clean = text
      .replace(/\[DAMAGE:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'hp', name: name.trim(), delta: -Math.abs(parseInt(d)) }); return ''; })
      .replace(/\[HEAL:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'hp', name: name.trim(), delta: Math.abs(parseInt(d)) }); return ''; })
      .replace(/\[STRESS:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'stress', name: name.trim(), delta: parseInt(d) }); return ''; })
      .replace(/\[GOLD:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'gold', name: name.trim(), delta: parseInt(d) }); return ''; })
      .replace(/\[XP:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'xp', name: name.trim(), delta: parseInt(d) }); return ''; })
      .replace(/\[TOKEN:\s*([^\]\d+-]+?)\s*([+-]?\d+)\]/gi, (m, name, d) => { changes.push({ field: 'tokens', name: name.trim(), delta: parseInt(d) }); return ''; });
    return { clean, changes };
  };

  const saveSession = async (session: GameSession = currentSession!) => {
    if (!session) return;
    setIsSaving(true);
    try {
      const lastDashboard = session.history.slice().reverse().find(m => m.dashboard)?.dashboard;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...session,
          history: JSON.stringify(session.history),
          codex: JSON.stringify(session.codex),
          decision_tree: lastDashboard?.decisionTree && lastDashboard.decisionTree.length > 0 ? JSON.stringify(lastDashboard.decisionTree) : null
        })
      });
      await fetchSessions();
    } catch (error) {
      console.error("Save Error:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchPanels = async () => {
    if (!currentSession) return;
    try {
      const [c, a] = await Promise.all([
        fetch(`/api/sessions/${currentSession.id}/claims`).then(r => r.json()),
        fetch(`/api/sessions/${currentSession.id}/pending`).then(r => r.json())
      ]);
      setPendingClaims(Array.isArray(c) ? c : []);
      setPendingActions(Array.isArray(a) ? a : []);
    } catch (e) { console.error("Panels fetch error", e); }
  };

  const approveClaim = async (id: string) => {
    await fetch(`/api/claims/${id}/approve`, { method: 'POST' });
    fetchPanels();
  };
  const rejectClaim = async (id: string) => {
    await fetch(`/api/claims/${id}/reject`, { method: 'POST' });
    fetchPanels();
  };
  const removeAction = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'DELETE' });
    fetchPanels();
  };
  const handleSearchLocation = async () => {
    if (!currentSession) return;
    const loc = currentDashboard.locations?.find((l: any) => l.id === currentDashboard.currentLocationId);
    const danger = loc?.dangerLevel || 1;
    try {
      const res = await fetch(`/api/sessions/${currentSession.id}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'location', dangerLevel: danger })
      });
      const data = await res.json();
      sendMessage(`[SEARCH] ${data.tag || ''}\nПерсонажи обыскивают локацию (${loc?.name || 'текущую'}). Опиши, что они нашли, и добавь найденное в sceneLoot или в inventory персонажей.`);
    } catch (e) { console.error("Search error", e); }
  };

  const handleSearchBody = async (threatName: string) => {
    if (!currentSession) return;
    try {
      const res = await fetch(`/api/sessions/${currentSession.id}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'body', targetName: threatName, dangerLevel: 1 })
      });
      const data = await res.json();
      sendMessage(`[SEARCH BODY] ${data.tag || ''}\nПерсонажи обыскивают тело ${threatName}. Опиши, что нашли, добавь в sceneLoot или inventory.`);
    } catch (e) { console.error("Search body error", e); }
  };

  const handleParty = async (charName: string, status: string) => {
    if (!currentSession) return;
    try {
      await fetch(`/api/sessions/${currentSession.id}/party`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charName, status })
      });
    } catch (e) { console.error("Party error", e); }
  };

  const handleEconomy = async (action: string, charName: string, item?: string) => {
    if (!currentSession) return;
    try {
      const res = await fetch(`/api/sessions/${currentSession.id}/economy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, charName, item })
      });
      const data = await res.json();
      if (!res.ok) {
        alert((data.tag || data.error || 'Ошибка').replace(/^\[ECONOMY: |\]$/g, ''));
        return;
      }
      sendMessage(`[ECONOMY] ${data.tag || ''} — опиши это коротко и атмосферно (1-2 предложения).`);
    } catch (e) {
      console.error("Economy error", e);
      alert('Не удалось выполнить действие экономики');
    }
  };

  const submitGmAction = async (charName: string) => {
    if (!currentSession || !gmActionInputs[charName]?.trim()) return;
    try {
      await fetch(`/api/sessions/${currentSession.id}/gm-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charName, action: gmActionInputs[charName].trim() })
      });
      setGmActionInputs(prev => ({ ...prev, [charName]: '' }));
      fetchPanels();
    } catch (e) { console.error("GM action error", e); }
  };
  const confirmRound = async () => {
    if (!currentSession || pendingActions.length === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/sessions/${currentSession.id}/commit`, { method: 'POST' });
      const data = await res.json();
      const idleRule = settings.idlePlayerAction === 'skip'
        ? 'Персонажи, чьи игроки не прислали действие, в этом ходу не действуют (просто упомяни их присутствие).'
        : settings.idlePlayerAction === 'gm'
          ? 'ГМ играет за персонажей без действий игроков — их ходы уже добавлены в [PLAYER ACTION].'
          : 'Персонажи, чьи игроки не прислали действие, действуют случайно/реактивно по обстоятельствам — коротко опиши их поведение.';
      sendMessage(`[ROUND] Игроки прислали действия (сообщения [PLAYER ACTION] выше). Обработай ВСЕ действия сразу и дай сцену-ответ каждому. ${idleRule}`);
    } catch (e) {
      console.error("Commit error", e);
      alert(`Не удалось подтвердить ход: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    } finally {
      setIsConfirming(false);
    }
  };

  useEffect(() => {
    if (currentSession) fetchPanels();
  }, [currentSession?.id]);

  // Idle: пассивный доход, пока игрока не было (только для кампаний)
  useEffect(() => {
    if (!currentSession || currentSession.mode === 'short') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${currentSession.id}/idle`, { method: 'POST' });
        const data = await res.json();
        if (!cancelled && data?.idleGold > 0 && data.tag) {
          sendMessage(`[IDLE] ${data.tag} — опиши коротко и атмосферно (2-3 предложения), что произошло в городе, пока героев не было.`);
        }
      } catch (e) { console.error("Idle error", e); }
    })();
    return () => { cancelled = true; };
  }, [currentSession?.id]);

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

  const generateIdea = async (prompt: string): Promise<string> => {
    if (settings.provider === 'gemini') {
      const customKey = settings.apiKey?.trim();
      if (customKey) {
        console.log("generateIdea: Using custom Gemini API key ending in:", customKey.slice(-4));
      } else {
        console.log("generateIdea: Using platform default Gemini API key");
      }
      const apiKey = customKey || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key required. Please check your settings.");
      
      const ai = new GoogleGenAI({ apiKey });
      // Use gemini-3-flash-preview as the robust default
      const modelToUse = (settings.modelName && settings.modelName !== 'local-model') 
        ? settings.modelName 
        : 'gemini-3-flash-preview';

      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            systemInstruction: "Ты креативный помощник для настольных ролевых игр. Отвечай кратко, емко и атмосферно. Не используй markdown форматирование, если не просят.",
          }
        });
        return response.text || '';
      } catch (error) {
        console.error("Gemini Generation Error:", error);
        throw error;
      }
    } else if (settings.provider === 'openrouter') {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openRouterApiKey || ''}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Nexus Prime RPG'
        },
        body: JSON.stringify({
          model: settings.openRouterModel || 'anthropic/claude-3.5-sonnet',
          messages: [
            { role: 'system', content: "Ты креативный помощник для НРИ. Отвечай кратко и атмосферно." },
            { role: 'user', content: prompt }
          ],
          temperature: 0.9
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`OpenRouter Error: ${data.error?.message || response.statusText}`);
      return data.choices?.[0]?.message?.content || '';
    } else if (settings.provider === 'opencode') {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: "Ты креативный помощник для настольных ролевых игр. Отвечай кратко, емко и атмосферно.",
          prompt,
          model: settings.modelName
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(`OpenCode Error: ${data.error || response.statusText}`);
      }
      const data = await response.json();
      return data.text || '';
    } else {
      const baseUrl = settings.modelUrl.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: settings.modelName,
          messages: [
            { role: 'system', content: "Ты креативный помощник для НРИ. Отвечай кратко и атмосферно." },
            { role: 'user', content: prompt }
          ],
          temperature: 0.9
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }
  };

  const handleStartAdventure = async (setup: SetupData) => {
    const newSession: GameSession = {
      id: crypto.randomUUID(),
      name: setup.setting.split(' ')[0] || 'New Adventure',
      genre: 'Custom',
      setting: setup.setting,
      style: setup.style,
      mode: setup.mode || 'short',
      snapshot: '',
      history: [],
      lore: `Сеттинг: ${setup.setting}\nЗавязка: ${setup.plotHook}\nСтиль: ${setup.style}`,
      archive: '',
      codex: [],
      updated_at: new Date().toISOString()
    };
    
    setSessions([newSession, ...sessions]);
    setCurrentSession(newSession);
    setIsSettingUp(false);

    let styleInstruction = "";
    if (setup.style === 'narrative') {
      styleInstruction = "ФОКУС: Нарратив и исследование. Бои должны быть редкими (10-15% времени), но значимыми. Уделяй внимание загадкам, социальному взаимодействию и атмосфере.";
    } else if (setup.style === 'combat') {
      styleInstruction = "ФОКУС: Тактические сражения. Бои частые и сложные (80% времени). Детально описывай действия врагов и используй механики угроз.";
    } else {
      styleInstruction = "ФОКУС: Сбалансированное приключение (50/50). Чередуй боевые сцены с исследованием и социальными энкаунтерами.";
    }

    const prompt = `[SYSTEM COMMAND: GAME START]
Мы начинаем новую кампанию!
Сеттинг: ${setup.setting}
Завязка: ${setup.plotHook}
${styleInstruction}

Персонажи:
${setup.characters.map(c => `- ${c.name} (${c.gender === 'Ж' ? 'Женщина' : 'Мужчина'}): ${c.concept}`).join('\n')}

Твоя задача:
1. Опиши атмосферную стартовую сцену, в которой находятся персонажи. Задай настроение и опиши первую угрозу или интригу.
2. Сгенерируй начальный <dashboard_json>, включив туда всех персонажей (заполни им базовые hp, stress, tokens, и добавь по 1-2 стартовых предмета в inventory/equipment исходя из их концепта).
3. Сгенерируй <codex_json> с описанием стартовой локации.`;

    await saveSession(newSession);
    await sendMessage(prompt, newSession);
  };

  const sendMessage = async (content: string, sessionOverride?: GameSession) => {
    const targetSession = sessionOverride || currentSession;
    if (!targetSession) return;
    
    const lastMsg = targetSession.history[targetSession.history.length - 1];
    const isLastMsgUser = lastMsg?.role === 'user';
    
    if (!content.trim() && Object.keys(pendingRolls).length === 0 && !isLastMsgUser) return;

    let updatedHistory = [...targetSession.history];
    const currentDashboard = targetSession.history.slice().reverse().find(m => m.dashboard)?.dashboard || INITIAL_DASHBOARD;
    
    // If there is new content or pending rolls, we create a new user message
    if (content.trim() || Object.keys(pendingRolls).length > 0) {
      let finalContent = content;
      
      // Process pending rolls (manual GM rolls only)
      if (Object.keys(pendingRolls).length > 0) {
        const rolls = Object.values(pendingRolls);
        finalContent += (finalContent ? '\n\n' : '') + `### GM Rolls:\n${rolls.join('\n')}`;
      }

      // Real escalation check (server-side d6, заменяет «мысленный бросок» LLM)
      const isMeta = /^\[(CLARIFY|SAVE_CHAPTER|FINALE|SESSION|ROUND|TRAVEL|EXPLORE|SEARCH|ECONOMY|IDLE|LEVEL)/.test(content.trim());
      if (!isMeta) {
        try {
          const ec = await fetch(`/api/sessions/${targetSession.id}/encounter-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style: targetSession.style || 'balanced', playerFailed: false })
          }).then(r => r.json());
          if (ec.tag) finalContent = (finalContent ? finalContent + '\n\n' : '') + ec.tag;
        } catch (e) { console.error("Encounter check error", e); }
        try {
          const st = await fetch(`/api/sessions/${targetSession.id}/state`).then(r => r.json());
          if (st.tag && st.tag !== '[STATE: ]') finalContent = (finalContent ? finalContent + '\n\n' : '') + st.tag;
        } catch (e) { console.error("State fetch error", e); }
      }

      const userMsg: Message = { role: 'user', content: finalContent };
      updatedHistory = [...targetSession.history, userMsg];
      
      setCurrentSession({ ...targetSession, history: updatedHistory });
      setInput('');
      setPendingRolls({});
    }

    setIsLoading(true);

    try {
      let aiContent = '';
      let logRequest: any = null;
      
      // Token Optimization: Only send the last 6 messages + Lore + Current State as context
      const contextWindow = updatedHistory.slice(-6);
      const loreContext = targetSession.lore ? `\n\n### ЭХО ПРОШЛОГО (Краткое содержание предыдущих событий):\n${targetSession.lore}\n` : '';
      const codexContext = targetSession.codex.length > 0 ? `\n\n### КОДЕКС (NPC, Локации, Предметы):\n${JSON.stringify(targetSession.codex, null, 2)}\n` : '';
      // Filter out disabled mechanics from currentDashboard so AI doesn't see them
      const isEnabled = (id: string) => (settings.mechanics || DEFAULT_MECHANICS).find(m => m.id === id)?.enabled ?? false;
      const filteredDashboard = { ...currentDashboard };
      if (!isEnabled('threats_dash')) delete filteredDashboard.threats;
      if (!isEnabled('scene_aspects')) delete filteredDashboard.sceneAspects;
      if (!isEnabled('loot')) delete filteredDashboard.sceneLoot;
      if (!isEnabled('clocks')) delete filteredDashboard.clocks;
      if (!isEnabled('doom_pool')) delete filteredDashboard.doomPool;
      if (!isEnabled('echoes')) delete filteredDashboard.echoes;
      if (!isEnabled('decision_tree')) delete filteredDashboard.decisionTree;
      if (!isEnabled('threat')) delete filteredDashboard.threatLevel;
      
      filteredDashboard.characters = filteredDashboard.characters.map(char => {
        const filteredChar = { ...char };
        if (!isEnabled('hp')) delete filteredChar.hp;
        if (!isEnabled('stress')) delete filteredChar.stress;
        if (!isEnabled('tokens')) delete filteredChar.tokens;
        if (!isEnabled('condition')) delete filteredChar.condition;
        if (!isEnabled('inventory')) delete filteredChar.inventory;
        if (!isEnabled('equipment')) delete filteredChar.equipment;
        if (!isEnabled('relationships')) delete filteredChar.relationships;
        if (!isEnabled('actions')) delete filteredChar.actions;
        return filteredChar;
      });

      const dashboardContext = `\n\n### ТЕКУЩЕЕ СОСТОЯНИЕ ИГРЫ (DASHBOARD):\n${JSON.stringify(filteredDashboard, null, 2)}\nОБЯЗАТЕЛЬНО используй эти данные как основу для следующего JSON.`;
      
      const activeMechanics = (settings.mechanics || DEFAULT_MECHANICS)
        .filter(m => m.enabled)
        .map(m => `### ${m.name}\n${m.description}`)
        .join('\n\n');
      const mechanicsContext = activeMechanics ? `\n\n## АКТИВНЫЕ МЕХАНИКИ\nПроверки выполняются тобой. Стат всегда суммируется с итоговым кубиком.\n${activeMechanics}` : '';
      
      const isClarify = content.startsWith('[CLARIFY]');
      const basePrompt = isClarify ? CLARIFY_SYSTEM_PROMPT : settings.systemPrompt;

      const getStyleInstruction = (style: string) => {
        switch (style) {
          case 'narrative': return `
\n\n### СТИЛЬ ИГРЫ: NARRATIVE FOCUS
- Приоритет: История, атмосфера, загадки. Бои редкие (10-15%).
- ТЕМП: Медленный. ПОСЛЕ КАЖДОЙ ОПАСНОЙ СЦЕНЫ ОБЯЗАТЕЛЬНО ДАВАЙ ПЕРЕДЫШКУ (Safe Haven).
- ЛИМИТЫ: Максимум 1 активная Угроза и 1 Часы одновременно.
- ЛОКАЦИИ: Уровень опасности (dangerLevel) ПРЕИМУЩЕСТВЕННО 1-2. Редко 3 (только кульминация).
- МЕХАНИКА ЭСКАЛАЦИИ (ВАЖНО): Ты можешь добавить новую Угрозу или Часы ТОЛЬКО если:
  1. Текущих Угроз/Часов меньше лимита.
  2. Игрок ПРОВАЛИЛ бросок.
  3. Ты мысленно бросил 1d6 и выпало 6.
  В остальных случаях - ТОЛЬКО развивай текущую ситуацию, не вводя новых врагов.`;

          case 'combat': return `
\n\n### СТИЛЬ ИГРЫ: COMBAT HEAVY
- Приоритет: Тактика, выживание. Бои частые (80%).
- ТЕМП: Высокий, адреналиновый.
- ЛИМИТЫ: Максимум 3 активные Угрозы и 3 Часов одновременно.
- ЛОКАЦИИ: Уровень опасности (dangerLevel) высокий (3-5). Безопасные зоны редки.
- МЕХАНИКА ЭСКАЛАЦИИ (ВАЖНО): Ты можешь добавить новую Угрозу или Часы, если:
  1. Текущих Угроз/Часов меньше лимита.
  2. Ты мысленно бросил 1d6 и выпало 3+.`;

          case 'fairytale': return `
\n\n### СТИЛЬ ИГРЫ: СКАЗКА ДЛЯ ДЕТЕЙ (FAIRY TALE)
- Приоритет: Добрая, волшебная атмосфера. Фокус на дружбе, чудесах, загадках и помощи другим.
- ТЕМП: Спокойный, увлекательный. НИКАКОЙ ЖЕСТОКОСТИ, крови, мрака или психологического хоррора.
- ВРАГИ И УГРОЗЫ: Враги должны быть комичными, заблудшими или просто вредными (например, тролль, который не пускает на мост, пока ему не отгадают загадку, или воришка-гоблин). Конфликты решаются хитростью, добротой или волшебством, а не убийствами.
- ЛИМИТЫ: Максимум 1 простая Угроза или Часы одновременно (например, "Успеть до заката").
- ЛОКАЦИИ: Уровень опасности (dangerLevel) 1. Локации яркие, сказочные (Пряничный домик, Говорящий лес).
- МЕХАНИКА ЭСКАЛАЦИИ: Добавляй новые препятствия только как веселые испытания или головоломки.`;

          default: return `
\n\n### СТИЛЬ ИГРЫ: BALANCED
- Приоритет: Баланс сюжета и экшена (50/50).
- ТЕМП: Ритмичный. Напряжение -> Разрядка. ПОСЛЕ БОЯ ОБЯЗАТЕЛЬНО ДАЙ ОТДОХНУТЬ.
- ЛИМИТЫ: Максимум 2 активные Угрозы и 2 Часов одновременно.
- ЛОКАЦИИ: Уровень опасности (dangerLevel) должен ЧЕРЕДОВАТЬСЯ: 1-2 (Безопасно/Исследование) -> 3-4 (Опасно/Бой). Не делай подряд две локации уровня 4-5!
- МЕХАНИКА ЭСКАЛАЦИИ (ВАЖНО): Ты можешь добавить новую Угрозу или Часы ТОЛЬКО если:
  1. Текущих Угроз/Часов меньше лимита.
  2. Ты мысленно бросил 1d6 и выпало 5+ (или 4+ если игрок провалил бросок).
  НЕ добавляй угрозы просто так, если лимит не исчерпан.`;
        }
      };

      const styleContext = targetSession.style ? getStyleInstruction(targetSession.style) : '';

      // Combine game rules, technical requirements, lore, and current state
      const fullSystemPrompt = `${basePrompt}${isClarify ? '' : mechanicsContext}${styleContext}\n\n${getTechnicalInstructions(settings.mechanics || DEFAULT_MECHANICS)}\n${loreContext}${codexContext}${dashboardContext}`;

      if (settings.provider === 'gemini') {
        const customKey = settings.apiKey?.trim();
        if (customKey) {
          console.log("sendMessage: Using custom Gemini API key ending in:", customKey.slice(-4));
        } else {
          console.log("sendMessage: Using platform default Gemini API key");
        }
        const apiKey = customKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("Gemini API Key not found. Please ensure it is set in the Settings or Secrets panel.");
        }
        const ai = new GoogleGenAI({ apiKey });
        
        // Convert history to Gemini format (user/model) and merge consecutive messages of the same role
        const contents: { role: string, parts: { text: string }[] }[] = [];
        for (const m of contextWindow) {
          const role = m.role === 'user' ? 'user' : 'model';
          if (contents.length > 0 && contents[contents.length - 1].role === role) {
            contents[contents.length - 1].parts[0].text += '\n\n' + m.content;
          } else {
            contents.push({ role, parts: [{ text: m.content }] });
          }
        }
        
        logRequest = {
          systemInstruction: fullSystemPrompt,
          contents
        };
        
        const modelToUse = (settings.modelName && settings.modelName !== 'local-model') 
          ? settings.modelName 
          : "gemini-3-flash-preview";
          
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents,
          config: {
            systemInstruction: fullSystemPrompt
          }
        });
        aiContent = response.text || '';
      } else if (settings.provider === 'openrouter') {
        const messages = [
          { role: 'system', content: fullSystemPrompt },
          ...contextWindow.map(m => ({ role: m.role, content: m.content }))
        ];
        logRequest = messages;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openRouterApiKey || ''}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Nexus Prime RPG'
          },
          body: JSON.stringify({
            model: settings.openRouterModel || 'anthropic/claude-3.5-sonnet',
            messages,
            temperature: 0.7,
          })
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(`OpenRouter Error: ${data.error?.message || response.statusText}`);
        }

        const data = await response.json();
        aiContent = data.choices?.[0]?.message?.content;
        
        if (!aiContent) {
          throw new Error("OpenRouter returned empty response or invalid format.");
        }
      } else if (settings.provider === 'opencode') {
        const promptText = contextWindow.map(m => `${m.role === 'user' ? 'Игрок' : 'Мастер'}: ${m.content}`).join('\n\n');
        logRequest = { system: fullSystemPrompt, prompt: promptText };
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: fullSystemPrompt, prompt: promptText, model: settings.modelName, stream: true })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(`OpenCode Error: ${data.error || response.statusText}`);
        }
        if (!response.body) throw new Error("OpenCode: пустой стрим");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let acc = '';
        let streamDone = false;
        setStreamingText('');
        while (!streamDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') { streamDone = true; break; }
            try {
              const ev = JSON.parse(payload);
              if (ev.delta) { acc += ev.delta; setStreamingText(acc); }
            } catch { /* ignore keep-alive */ }
          }
        }
        setStreamingText(null);
        aiContent = acc;
        if (!aiContent) {
          throw new Error("OpenCode returned empty response.");
        }
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
            sessionId: targetSession.id,
            request: logRequest,
            response: aiContent
          })
        }).catch(err => console.error("Logging failed:", err));
      }

      const { clean: cleanAi, changes: stateChanges } = parseStateTags(aiContent);
      const { cleanText, dashboard: aiDashboard, codexUpdates, loreUpdate, finalDraft, sessionSummary } = parseDashboard(cleanAi, currentDashboard);

      // State Authority: применяем теги изменений + перезаписываем числа движковыми значениями
      let authoritativeDashboard = aiDashboard;
      try {
        const stRes = await fetch(`/api/sessions/${targetSession.id}/state/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: stateChanges, dashboard: aiDashboard || undefined })
        });
        const st = await stRes.json();
        if (st.dashboard) authoritativeDashboard = st.dashboard;
      } catch (e) { console.error("State apply error", e); }

      const aiMsg: Message = { 
        role: 'assistant', 
        content: cleanText,
        dashboard: isClarify ? currentDashboard : (authoritativeDashboard || currentDashboard)
      };

      // Merge Codex Updates
      let finalCodex = [...targetSession.codex];
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
      if (sessionSummary) setSessionSummary(sessionSummary);
      const archiveAdd = (finalDraft ? finalDraft : '') + (finalDraft && sessionSummary ? '\n\n---\n\n' : '') + (sessionSummary ? `# Итоги партии\n\n${sessionSummary}` : '');
      const updatedSession = { 
        ...targetSession, 
        history: finalHistory,
        lore: loreUpdate || targetSession.lore,
        archive: archiveAdd ? `${targetSession.archive ? targetSession.archive + '\n\n---\n\n' : ''}${archiveAdd}` : targetSession.archive,
        codex: finalCodex,
        updated_at: new Date().toISOString()
      };

      setCurrentSession(updatedSession);
      
      // Save to DB
      await saveSession(updatedSession);

      // Detect level-ups → DM придумывает уникальные способности
      const leveled: string[] = [];
      const prevChars = currentDashboard.characters || [];
      const newChars = (authoritativeDashboard?.characters || []);
      for (const nc of newChars) {
        const prev = prevChars.find((c: any) => c.name === nc.name);
        if (prev && levelFromXp(Number(nc.xp || 0)) > levelFromXp(Number(prev.xp || 0))) {
          leveled.push(`${nc.name} → уровень ${levelFromXp(Number(nc.xp || 0))}`);
        }
      }
      if (leveled.length > 0) {
        sendMessage(`[LEVEL UP] ${leveled.join(', ')}. Для КАЖДОГО придумай УНИКАЛЬНУЮ способность, отражающую путь героя. Тип — любой: boon (бонус), curse (шрам/проклятие от пережитого), flavor (особенность без механики) или mechanical (конкретное правило). Добавь в abilities (с полем type) в dashboard_json.`);
      }
    } catch (error) {
      console.error("AI Error:", error);
      const errorMsg: Message = { 
        role: 'assistant', 
        content: `Nexus Error: ${error instanceof Error ? error.message : "Could not connect to AI provider. Please check your settings."}` 
      };
      setCurrentSession({ ...targetSession, history: [...updatedHistory, errorMsg] });
    } finally {
      setIsLoading(false);
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
    
    content += `## 🌍 LORE & WORLD\n${currentSession.lore || 'No lore recorded yet.'}\n\n`;
    
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
      const res = await fetch(`/api/sessions/${currentSession.id}/export`);
      const data = await res.json();
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
      alert(`Экспорт не удался: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    }
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
        {isSettingUp ? (
          <div className="flex-1 flex items-center justify-center p-4 bg-[#0a0502] overflow-y-auto">
            <SessionSetup 
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
                  <button 
                    onClick={exportBook}
                    className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-white transition-all"
                    title="Export Adventure as Markdown"
                  >
                    <Download size={12} /> Export
                  </button>
                  <div className="h-4 w-px bg-white/10" />
                  <button 
                    onClick={exportSkillFormat}
                    className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-emerald-400/80 hover:text-emerald-300 transition-all"
                    title="Export to skill format (session.json + archive.md + timeline.md)"
                  >
                    <ScrollText size={12} /> Nexus Export
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
                {streamingText !== null && (
                  <div className="max-w-3xl mx-auto w-full">
                    <div className="narrative-text text-white/80" style={{ fontSize: `${settings.fontSize}px`, fontFamily: settings.fontFamily === 'serif' ? 'serif' : settings.fontFamily === 'mono' ? 'monospace' : 'inherit' }}>
                      <p>
                        {streamingText}
                        <span className="inline-block w-1.5 h-4 bg-white/50 animate-pulse ml-0.5 align-middle rounded-sm" />
                      </p>
                    </div>
                  </div>
                )}
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
                            setPendingRolls(prev => {
                              const newRolls = { ...prev, [charName]: rollResult };
                              
                              // Auto-close if all ACTIVE characters have acted
                              const activeChars = currentDashboard.characters.filter(c => {
                                const isDead = c.hp === '0' || c.stress >= 10 || c.condition?.toLowerCase().includes('мертв');
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
                        className={`p-2 rounded-xl transition-all disabled:opacity-30 ${confirmFinale ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-white/40 hover:text-amber-400'}`}
                      >
                        <Flag size={18} />
                      </button>
                      <button
                        onClick={() => sendMessage(`[SESSION SUMMARY] Подведи итоги партии: <session_summary> — краткий пересказ приключения и итоги (чего добились герои, награды, XP, судьбы NPC, что запомнилось). Тёплый эпилог в стиле сессии.`)}
                        title="Итоги партии"
                        disabled={isLoading}
                        className="p-2 bg-white/5 text-white/40 hover:text-emerald-400 rounded-xl transition-all disabled:opacity-30"
                      >
                        <Award size={18} />
                      </button>
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
                      onClick={() => {
                        saveSession();
                        sendMessage(`[SAVE_CHAPTER] Сохрани главу (NEXUS SAVE). Твоя задача:
1. <lore_update> — кристаллизованный Story Archive до 800 слов (NPC: кто и чего хочет, локации, неразрешённые конфликты, ключевые улики; от третьего лица, в стиле сессии).
2. <final_draft> — литературный Final Draft главы (300-600 слов): синтез диалогов и бросков.
3. Обнови decisionTree в <dashboard_json>: зафиксируй ключевые выборы игроков со статусами active/resolved.`);
                      }} 
                      disabled={isSaving || !currentSession || isLoading}
                      title="NEXUS SAVE: кристаллизует Story Archive + Final Draft + Древо Решений"
                      className="vector-btn text-[10px] lg:text-sm text-amber-400/80 border-amber-500/20 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {isLoading ? 'Crystallizing...' : 'Nexus Save'}
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
                <button 
                  onClick={() => setRightPanelTab('players')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] uppercase tracking-widest font-bold transition-all ${rightPanelTab === 'players' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
                >
                  <Users size={12} /> Players
                  {(pendingClaims.some((c: any) => c.status === 'pending') || pendingActions.length > 0) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              </div>
              <div className="flex-1 overflow-hidden h-full">
                {rightPanelTab === 'players' ? (
                  <div className="p-4 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
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
                            <p className="text-xs text-white/80 mt-1 leading-relaxed">{a.action_text}</p>
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
                ) : rightPanelTab === 'lore' ? (
                  <div className="p-6 space-y-4 overflow-y-auto h-full">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <History size={12} /> Story Archive
                    </h3>
                    <div className="text-sm text-white/60 font-serif leading-relaxed whitespace-pre-wrap">
                      {currentSession.lore || "No lore recorded yet. Use 'Nexus Save' to crystallize the story."}
                    </div>
                    {currentSession.archive && (
                      <>
                        <h3 className="text-[10px] uppercase tracking-widest text-amber-400/70 font-bold flex items-center gap-2 pt-4 border-t border-white/10">
                          <ScrollText size={12} /> Final Drafts (NEXUS SAVE)
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
                    enabledMechanics={settings.mechanics} 
                    onUpdate={handleUpdateDashboard}
                    onSearch={(kind, name) => kind === 'body' ? handleSearchBody(name || '') : handleSearchLocation()}
                    onEconomy={(action, charName, item) => handleEconomy(action, charName, item)}
                    onParty={(charName, status) => handleParty(charName, status)}
                    onTravel={(locId) => {
                      const loc = currentDashboard.locations?.find(l => l.id === locId);
                      if (loc) {
                        const roll = Math.random();
                        let type: 'encounter' | 'discovery' | 'safe' = 'safe';
                        let prompt = "";
                        
                        if (roll < 0.3) {
                          type = 'encounter';
                          prompt = `[TRAVEL ENCOUNTER] The party attempts to travel to ${loc.name}, but they are interrupted on the road! 
1. Generate a random encounter, obstacle, or event fitting the current setting and genre.
2. DO NOT let them arrive at ${loc.name} yet. They must deal with this first.
3. Ask how they respond to the situation.`;
                        } else if (roll < 0.6) {
                          type = 'discovery';
                          prompt = `[TRAVEL DISCOVERY] While traveling to ${loc.name}, the party discovers something hidden off the beaten path!
1. Describe the journey and the discovery of a NEW location or landmark.
2. Add this new location to the 'locations' JSON array with:
   - status='known'
   - dangerLevel (1-5, based on Game Style)
   - coordinates (x,y near current)
   - connections (link to current and/or ${loc.id})
3. Describe their arrival at ${loc.name}.`;
                        } else {
                          type = 'safe';
                          prompt = `[TRAVEL ACTION] The party travels safely to ${loc.name}. 
1. Describe the scenery and atmosphere of the journey based on the setting.
2. Describe their arrival at ${loc.name} and what they see first.`;
                        }

                        setTravelEvent({ type, locationName: loc.name });
                        
                        const sessionToUse = currentSession;
                        setTimeout(() => {
                          setTravelEvent(null);
                          sendMessage(prompt, sessionToUse);
                        }, 2500);
                      }
                    }}
                    onExplore={(locId) => {
                      const loc = currentDashboard.locations?.find(l => l.id === locId);
                      if (loc) {
                        sendMessage(`[EXPLORE ACTION] The party explores ${loc.name}. 
1. Describe what they find.
2. REVEAL 1-2 NEW LOCATIONS. Add them to 'locations' JSON with:
   - id: UUID
   - name: "..."
   - description: "..."
   - dangerLevel: (1-5, MUST match Game Style!)
   - status: 'known'
   - coordinates: {x: ..., y: ...} (offset from current)
   - connections: ["${loc.id}"]
3. Ensure dangerLevel is set correctly!`);
                      }
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
                Traveling to {travelEvent.locationName}
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
                {travelEvent.type === 'discovery' && "You notice something off the beaten path..."}
                {travelEvent.type === 'safe' && "The journey is uneventful. For now."}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PromptModal />

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
    } />
    </Routes>
  );
}
