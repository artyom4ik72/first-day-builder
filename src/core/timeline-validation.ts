import { normalizeLink } from './links';
import { DAY_MINUTES, type Block, type Contact, type DayPlan } from './model';
import { endLabel, isValidDate, toHHMM } from './time';

// Проверка плана: поля блоков и контактов, интервалы и пересечения.
// Пересечения ищутся проходом по отсортированным блокам с набором «ещё не закончившихся» —
// это учитывает самую позднюю границу всех предыдущих блоков, а не только соседа:
// длинная встреча с двумя вложенными конфликтами даёт два пересечения. Смежные блоки допустимы.

export type BlockField = 'title' | 'start' | 'duration' | 'link';
export type ContactField = 'name' | 'email';
export type PlanField = 'date' | 'title';

export interface Issue {
  /** Ключ поля в интерфейсе (data-field): block.<id>.start, contact.<id>.email, plan.date. */
  key: string;
  targetId: string | null;
  message: string;
}

export interface Overlap {
  /** Блок, который начался раньше (или одновременно, но раньше в списке). */
  first: string;
  second: string;
  from: number;
  to: number;
}

export interface PlanCheck {
  issues: Issue[];
  overlaps: Overlap[];
  /** Блоки с хотя бы одним пересечением. */
  conflictIds: Set<string>;
  /** Блоки со временем, по возрастанию начала (при равенстве — короче раньше, затем порядок ввода). */
  timed: Block[];
  /** Задачи и материалы без времени, в порядке редактора. */
  untimed: Block[];
  /** Нормализованные ссылки по id блока. */
  links: Map<string, string>;
  ok: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function blockIssues(b: Block): Issue[] {
  const out: Issue[] = [];
  const key = (f: BlockField) => `block.${b.id}.${f}`;
  if (!b.title.trim()) out.push({ key: key('title'), targetId: b.id, message: 'Укажите название' });
  if (b.kind === 'meeting' && b.start === null) out.push({ key: key('start'), targetId: b.id, message: 'Укажите время начала встречи' });
  if (b.start !== null) {
    if (!Number.isInteger(b.start) || b.start < 0 || b.start >= DAY_MINUTES)
      out.push({ key: key('start'), targetId: b.id, message: 'Время начала вне суток' });
    if (!Number.isInteger(b.duration) || b.duration < 1)
      out.push({ key: key('duration'), targetId: b.id, message: 'Длительность — целое число минут, не меньше 1' });
    else if (b.start + b.duration > DAY_MINUTES)
      out.push({ key: key('duration'), targetId: b.id, message: `Блок заканчивается после полуночи (${toHHMM(b.start)} + ${b.duration} мин)` });
  }
  const link = normalizeLink(b.link);
  if (!link.ok) out.push({ key: key('link'), targetId: b.id, message: link.error });
  return out;
}

export function contactIssues(c: Contact): Issue[] {
  const out: Issue[] = [];
  if (!c.name.trim()) out.push({ key: `contact.${c.id}.name`, targetId: c.id, message: 'Укажите имя контакта' });
  if (c.email.trim() && !EMAIL.test(c.email.trim()))
    out.push({ key: `contact.${c.id}.email`, targetId: c.id, message: 'Почта в формате name@example.com' });
  return out;
}

/** Блоки со временем по порядку: начало, затем конец, затем порядок ввода. Сортировка стабильна. */
export function sortTimed(blocks: Block[]): Block[] {
  return blocks
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.start !== null)
    .sort((x, y) => x.b.start! - y.b.start! || x.b.duration - y.b.duration || x.i - y.i)
    .map((x) => x.b);
}

/** Все пары пересекающихся интервалов. Блоки с ошибками времени в проверку не попадают. */
export function findOverlaps(sorted: Block[]): Overlap[] {
  const out: Overlap[] = [];
  let active: Block[] = [];
  for (const b of sorted) {
    const start = b.start!;
    // Закончившиеся к началу b не мешают: конец == начало — смежные блоки.
    active = active.filter((a) => a.start! + a.duration > start);
    for (const a of active) out.push({ first: a.id, second: b.id, from: start, to: Math.min(a.start! + a.duration, start + b.duration) });
    active.push(b);
  }
  return out;
}

export function validatePlan(plan: DayPlan): PlanCheck {
  const issues: Issue[] = [];
  if (!plan.title.trim()) issues.push({ key: 'plan.title', targetId: null, message: 'Укажите заголовок плана' });
  if (!plan.date) issues.push({ key: 'plan.date', targetId: null, message: 'Выберите дату первого дня' });
  else if (!isValidDate(plan.date)) issues.push({ key: 'plan.date', targetId: null, message: 'Дата в формате ГГГГ-ММ-ДД' });

  const badTime = new Set<string>();
  const links = new Map<string, string>();
  for (const b of plan.blocks) {
    const bi = blockIssues(b);
    issues.push(...bi);
    if (bi.some((i) => i.key.endsWith('.start') || i.key.endsWith('.duration'))) badTime.add(b.id);
    const l = normalizeLink(b.link);
    if (l.ok && l.href) links.set(b.id, l.href);
  }
  for (const c of plan.contacts) issues.push(...contactIssues(c));

  const timed = sortTimed(plan.blocks);
  const overlaps = findOverlaps(timed.filter((b) => !badTime.has(b.id)));
  const conflictIds = new Set(overlaps.flatMap((o) => [o.first, o.second]));
  const untimed = plan.blocks.filter((b) => b.start === null);
  return { issues, overlaps, conflictIds, timed, untimed, links, ok: issues.length === 0 && overlaps.length === 0 };
}

export function overlapText(o: Overlap, byId: Map<string, Block>): string {
  const a = byId.get(o.first)!;
  const b = byId.get(o.second)!;
  return `«${a.title || 'Без названия'}» (${toHHMM(a.start!)}–${endLabel(a.start! + a.duration)}) пересекается с «${b.title || 'Без названия'}» (${toHHMM(b.start!)}–${endLabel(b.start! + b.duration)}) на ${o.to - o.from} мин`;
}
