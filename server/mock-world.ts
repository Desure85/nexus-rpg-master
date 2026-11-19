// Тестовый «конструктор миров»: детерминированный черновик по описанию (для мока и офлайн-демо).
import { genreOf } from "../shared/genre";

export function mockWorldReply(idea: string) {
  const g = genreOf(idea);
  const word = (idea.match(/[А-ЯЁ][а-яё]{3,}/)?.[0]) || "Туман";
  const title = `Земли: ${word}`;
  const world = {
    title, icon: "🗺️", genre: g,
    description: `Мир по вашему описанию: ${idea.slice(0, 140)}`,
    setting: idea.slice(0, 600),
    core: `Главный конфликт: древняя сила «${word}» пробуждается, и у каждого в краю своя цена за молчание. ${idea.slice(0, 400)}`,
    tone: "Атмосферно и таинственно, без лишней жестокости",
    currency: g === "cyber" || g === "space" ? "кредиты" : g === "post" ? "крышки" : "монеты",
    cards: [
      { kind: "npc", name: "Хранительница Велена", keys: ["хранительница", "Велена"], text: "Седая женщина с ключами от архива. Знает, откуда пришла беда, но молчит из страха." },
      { kind: "faction", name: "Братство Пепла", keys: ["братство", "пепел"], text: "Тайный орден, который хочет ускорить пробуждение силы ради власти." },
      { kind: "place", name: "Старый архив", keys: ["архив"], text: "Полузатопленное здание, где хранятся записи о прошлом пробуждении." },
      { kind: "item", name: "Компас без стрелки", keys: ["компас"], text: "Указывает не на север, а на того, кто лжёт." },
      { kind: "lore", name: `Легенда о ${word}`, keys: [word.toLowerCase()], text: "Сто лет назад сила уже просыпалась — и половина края забыла свои имена.", always: true },
      { kind: "npc", name: "Капитан Орм", keys: ["капитан", "Орм"], text: "Начальник стражи, честный, но в долгу у Братства." },
      { kind: "npc", name: "Мальчишка Тимка", keys: ["Тимка", "мальчишк"], text: "Беспризорник, видел то, чего не должен был." },
      { kind: "faction", name: "Гильдия торговцев", keys: ["гильдия", "торговц"], text: "Держит рынок и закрывает глаза на всё, что приносит доход." },
    ],
    locations: [
      { id: "town", name: "Город на холме", description: "Шумный рынок и узкие улицы", services: ["market", "tavern", "inn", "healer"], dangerLevel: 1, connections: ["archive", "woods"] },
      { id: "archive", name: "Старый архив", description: "Сырость и шорох страниц", services: ["library"], dangerLevel: 2, connections: ["town"] },
      { id: "woods", name: "Чёрный лес", description: "Тропы, где теряют дорогу", services: [], dangerLevel: 3, connections: ["town", "ruins"] },
      { id: "ruins", name: "Руины храма", description: "Здесь всё началось", services: [], dangerLevel: 4, connections: ["woods"] },
    ],
    scenarios: [
      { id: "s1", title: "Пропавшая хранительница", hook: "Велена не пришла в архив, а на двери — знак Братства Пепла. Капитан Орм просит найти её до заката.", mode: "short", startLocationId: "town" },
      { id: "s2", title: "Сказка о компасе", hook: "Тимка нашёл компас без стрелки, и тот указывает на самого доброго человека в городе.", mode: "tale", startLocationId: "town" },
    ],
    heroes: [
      { name: "Ярина", concept: "Следопыт, читает знаки на коре деревьев", gender: "Ж" },
      { name: "Бор", concept: "Бывший стражник, тяжёлый щит и тяжёлая совесть", gender: "М" },
      { name: "Лекс", concept: "Студент архива, знает все легенды", gender: "М" },
    ],
    enemies: [
      { name: "Пепельник", tier: "minion", traits: "Сектант в сером, бросается толпой, бежит от света" },
      { name: "Тень архива", tier: "regular", traits: "Шепчет забытые имена, уязвима к огню" },
      { name: "Магистр Пепла", tier: "elite", traits: "Глава ячейки Братства, говорит красиво, лжёт всегда" },
      { name: `Пробуждённый ${word}`, tier: "boss", traits: "Сама сила края; слабеет, если назвать её истинное имя" },
    ],
    items: [
      { name: "Тёплый хлеб", kind: "consumable", heal: 2, price: 3, inShop: true, rarity: "common" },
      { name: "Настой зверобоя", kind: "consumable", calm: 2, price: 8, inShop: true, rarity: "common" },
      { name: "Посеребрённый кинжал", kind: "gear", bonus: "+1 к атаке", price: 35, inShop: true, rarity: "uncommon" },
      { name: "Компас без стрелки", kind: "misc", rarity: "rare" },
    ],
  };
  return JSON.stringify(world);
}
