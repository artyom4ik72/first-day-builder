// Модель плана первого дня. Время блоков — минуты от начала выбранной даты (0…1440).
// Черновик хранит то, что ввёл наставник; проверки (timeline-validation) и экспорт (html-export)
// получают один и тот же объект DayPlan.

export type BlockKind = 'meeting' | 'task' | 'material';

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface Block {
  id: string;
  kind: BlockKind;
  title: string;
  /** Минуты от начала дня или null — «без времени» (только задачи и материалы). */
  start: number | null;
  /** Длительность в минутах; для блока без времени не используется. */
  duration: number;
  /** Последнее время начала до снятия со шкалы: «Без времени» и смена типа обратимы без потери времени. */
  parkedStart: number | null;
  place: string;
  description: string;
  link: string;
  contactIds: string[];
}

export interface DayPlan {
  version: 1;
  /** Дата в формате YYYY-MM-DD. */
  date: string;
  title: string;
  newcomer: string;
  mentor: string;
  welcome: string;
  blocks: Block[];
  contacts: Contact[];
  updatedAt: number;
}

export const DAY_MINUTES = 24 * 60;
export const MAX_BLOCKS = 60;
export const MAX_CONTACTS = 30;

export const KIND_LABEL: Record<BlockKind, string> = {
  meeting: 'Встреча',
  task: 'Самостоятельная задача',
  material: 'Материал',
};

let counter = 0;
export function makeId(prefix: string): string {
  counter += 1;
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}-${counter}`;
}

export function blockEnd(b: Block): number | null {
  return b.start === null ? null : b.start + b.duration;
}

export function emptyPlan(now = Date.now()): DayPlan {
  return {
    version: 1,
    date: '',
    title: 'Первый рабочий день',
    newcomer: '',
    mentor: '',
    welcome: '',
    blocks: [],
    contacts: [],
    updatedAt: now,
  };
}

export function newBlock(kind: BlockKind, start: number | null): Block {
  return {
    id: makeId('b'),
    kind,
    title: '',
    start: kind === 'material' ? null : start,
    duration: kind === 'meeting' ? 30 : 60,
    parkedStart: null,
    place: '',
    description: '',
    link: '',
    contactIds: [],
  };
}

export function newContact(): Contact {
  return { id: makeId('p'), name: '', role: '', email: '', phone: '' };
}

const t = (h: number, m = 0) => h * 60 + m;

/**
 * Демо из приёмки ТЗ: длинная настройка рабочего места 10:00–12:00 с двумя вложенными конфликтами,
 * смежный обед в 12:00 (допустим), материалы без времени и подпись с HTML, которая должна остаться текстом.
 */
export function demoPlan(now = Date.now()): DayPlan {
  const anna: Contact = { id: makeId('p'), name: 'Анна Морозова', role: 'Наставник, ведущий аналитик', email: 'anna.morozova@example.com', phone: '+7 900 000-00-01' };
  const ilya: Contact = { id: makeId('p'), name: 'Илья Петров', role: 'ИТ-поддержка', email: 'it-help@example.com', phone: 'доб. 1234' };
  const sveta: Contact = { id: makeId('p'), name: 'Светлана Ким', role: 'Офис-менеджер', email: 'office@example.com', phone: '' };
  const b = (kind: BlockKind, title: string, start: number | null, duration: number, extra: Partial<Block> = {}): Block => ({
    ...newBlock(kind, start),
    title,
    start,
    duration,
    ...extra,
  });
  return {
    version: 1,
    date: '2026-11-23',
    title: 'Первый день в команде аналитики',
    newcomer: 'Мария',
    mentor: 'Анна Морозова',
    welcome: 'Добро пожаловать! Ниже план на день: где быть, с кем встретиться и что почитать. Если что-то непонятно — пишите наставнику.',
    contacts: [anna, ilya, sveta],
    updatedAt: now,
    blocks: [
      b('meeting', 'Знакомство с наставником', t(9, 30), 30, { place: 'Переговорная «Байкал», 3 этаж', contactIds: [anna.id] }),
      b('meeting', 'Настройка ноутбука и доступов', t(10), 120, {
        place: 'Кабинет ИТ, 2 этаж',
        description: 'Возьмите <b>паспорт</b> и телефон для двухфакторной защиты.',
        contactIds: [ilya.id],
      }),
      b('meeting', 'Знакомство с командой', t(10, 30), 30, { place: 'Open space, зона аналитики', contactIds: [anna.id] }),
      b('task', 'Получить пропуск', t(11, 15), 30, { place: 'Ресепшен, 1 этаж', contactIds: [sveta.id] }),
      b('meeting', 'Обед с командой', t(12), 60, { place: 'Столовая, 1 этаж' }),
      b('task', 'Пройти вводный курс по безопасности', t(15), 60, {
        link: 'https://learning.example.com/security-intro',
        description: 'Курс занимает около часа, тест в конце.',
      }),
      b('meeting', 'Итоги дня', t(16, 30), 30, { place: 'Переговорная «Байкал»', contactIds: [anna.id] }),
      b('material', 'Справочник новичка', null, 0, { link: 'https://wiki.example.com/newcomer' }),
      b('material', 'Карта офиса', null, 0, { link: 'example.com/office-map', description: 'Где кухня, переговорные и тихая комната.' }),
      b('task', 'Заполнить профиль в корпоративном мессенджере', null, 0, { description: 'Фото и должность, чтобы коллеги вас узнали.' }),
    ],
  };
}
