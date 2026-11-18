// Достижения игрока (по аккаунту). Открываются движком по событиям игры.
export interface Achievement { code: string; icon: string; title: string; desc: string }

export const ACHIEVEMENTS: Achievement[] = [
  { code: 'first_blood', icon: '⚔️', title: 'Первая победа', desc: 'Одолеть врага' },
  { code: 'crit', icon: '🎯', title: 'Рука судьбы', desc: 'Выбросить критический успех' },
  { code: 'survivor', icon: '🌅', title: 'Не сегодня', desc: 'Пережить спасбросок смерти' },
  { code: 'level3', icon: '⭐', title: 'Закалённый', desc: 'Довести героя до 3 уровня' },
  { code: 'level5', icon: '🌟', title: 'Легенда', desc: 'Довести героя до 5 уровня' },
  { code: 'rich', icon: '🪙', title: 'Тугой кошель', desc: 'Скопить 100 золота у одного героя' },
  { code: 'explorer', icon: '🗺️', title: 'Первопроходец', desc: 'Побывать в 5 местах за одну игру' },
  { code: 'quester', icon: '📜', title: 'Слово сдержано', desc: 'Выполнить квест' },
  { code: 'fellowship', icon: '🤝', title: 'Братство', desc: 'Сыграть раунд вдвоём или больше' },
  { code: 'storyteller', icon: '📖', title: 'Сказочник', desc: 'Довести сказку до финала' },
  { code: 'saga', icon: '🏰', title: 'Сага', desc: '30 ходов мастера в одной игре' },
  { code: 'veteran', icon: '🎖️', title: 'Ветеран', desc: 'Герой прошёл 3 приключения' },
];
