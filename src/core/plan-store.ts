import { DAY_MINUTES, makeId, MAX_BLOCKS, MAX_CONTACTS, type Block, type BlockKind, type Contact, type DayPlan } from './model';

// Модуль plan-store. Черновик: IndexedDB «first-day-builder», запись «current» с номером ревизии.
// putIfRev пишет только поверх ожидаемой ревизии (проверка и запись в одной транзакции):
// так вторая вкладка не перезапишет молча чужие правки. Перенос — JSON-файл проекта.

export const FILE_FORMAT = 'first-day-builder';
const MAX_TEXT = 200;
const MAX_LONG = 2000;

export interface StoredDraft {
  rev: number;
  draft: DayPlan;
}

export type PutResult = { ok: true; rev: number } | { ok: false; current: StoredDraft | null };

export interface DraftStore {
  load(): Promise<StoredDraft | null>;
  putIfRev(draft: DayPlan, expectedRev: number): Promise<PutResult>;
}

export class MemoryDraftStore implements DraftStore {
  private rec: StoredDraft | null = null;
  async load() {
    return this.rec ? structuredClone(this.rec) : null;
  }
  async putIfRev(draft: DayPlan, expectedRev: number): Promise<PutResult> {
    const cur = this.rec?.rev ?? 0;
    if (cur !== expectedRev) return { ok: false, current: this.rec ? structuredClone(this.rec) : null };
    this.rec = { rev: cur + 1, draft: structuredClone(draft) };
    return { ok: true, rev: cur + 1 };
  }
}

const DB = 'first-day-builder';
const STORE = 'drafts';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступна'));
    req.onblocked = () => reject(new Error('IndexedDB заблокирована другой вкладкой'));
  });
}

export class IdbDraftStore implements DraftStore {
  private db: Promise<IDBDatabase> | null = null;
  private conn() {
    this.db ??= openDb().catch((e) => {
      this.db = null;
      throw e;
    });
    return this.db;
  }
  async load(): Promise<StoredDraft | null> {
    const db = await this.conn();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredDraft | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async putIfRev(draft: DayPlan, expectedRev: number): Promise<PutResult> {
    const db = await this.conn();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let result: PutResult = { ok: false, current: null };
      const get = store.get(KEY);
      get.onsuccess = () => {
        const cur = (get.result as StoredDraft | undefined) ?? null;
        if ((cur?.rev ?? 0) !== expectedRev) {
          result = { ok: false, current: cur };
          return;
        }
        const rec: StoredDraft = { rev: expectedRev + 1, draft };
        store.put(rec, KEY);
        result = { ok: true, rev: rec.rev };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Не удалось сохранить черновик'));
      tx.onabort = () => reject(tx.error ?? new Error('Сохранение прервано'));
    });
  }
}

// ---------- проверка и нормализация данных из файла или хранилища ----------

function str(v: unknown, max = MAX_TEXT): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

export type Normalized = { ok: true; plan: DayPlan; warnings: string[] } | { ok: false; error: string };

const KINDS: BlockKind[] = ['meeting', 'task', 'material'];

export function normalizePlan(raw: unknown): Normalized {
  const root = obj(raw);
  if (!root) return { ok: false, error: 'Файл не похож на план: ожидается JSON-объект' };
  if (root.format !== undefined && root.format !== FILE_FORMAT) return { ok: false, error: `Это файл другого формата (${str(root.format, 40)})` };
  const p = obj(root.plan) ?? root;
  if (!Array.isArray(p.blocks)) return { ok: false, error: 'В файле нет списка блоков плана' };
  const warnings: string[] = [];
  const seen = new Set<string>();
  const uniq = (id: unknown, prefix: string) => {
    let s = str(id, 60);
    if (!s || seen.has(s)) s = makeId(prefix);
    seen.add(s);
    return s;
  };
  const rawContacts = Array.isArray(p.contacts) ? p.contacts : [];
  const contacts: Contact[] = rawContacts.slice(0, MAX_CONTACTS).flatMap((rc) => {
    const c = obj(rc);
    if (!c) return [];
    return [{ id: uniq(c.id, 'p'), name: str(c.name), role: str(c.role), email: str(c.email), phone: str(c.phone, 60) }];
  });
  const contactIds = new Set(contacts.map((c) => c.id));
  if (p.blocks.length > MAX_BLOCKS) warnings.push(`Загружены первые ${MAX_BLOCKS} блоков из ${p.blocks.length}`);
  const blocks: Block[] = p.blocks.slice(0, MAX_BLOCKS).flatMap((rb) => {
    const b = obj(rb);
    if (!b) return [];
    const kind = KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : 'task';
    const start = b.start === null || b.start === undefined || kind === 'material' ? null : int(b.start, 0, DAY_MINUTES - 1, 9 * 60);
    return [
      {
        id: uniq(b.id, 'b'),
        kind,
        title: str(b.title),
        start,
        duration: int(b.duration, 0, DAY_MINUTES, 30),
        parkedStart: b.parkedStart === null || b.parkedStart === undefined ? null : int(b.parkedStart, 0, DAY_MINUTES - 1, 9 * 60),
        place: str(b.place),
        description: str(b.description, MAX_LONG),
        link: str(b.link, 500),
        contactIds: (Array.isArray(b.contactIds) ? b.contactIds : []).filter((id): id is string => typeof id === 'string' && contactIds.has(id)),
      },
    ];
  });
  return {
    ok: true,
    warnings,
    plan: {
      version: 1,
      date: /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : '',
      title: str(p.title) || 'Первый рабочий день',
      newcomer: str(p.newcomer),
      mentor: str(p.mentor),
      welcome: str(p.welcome, MAX_LONG),
      blocks,
      contacts,
      updatedAt: typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
    },
  };
}

export function exportProject(plan: DayPlan): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, plan }, null, 2) + '\n';
}

export function importProject(textContent: string): Normalized {
  let raw: unknown;
  try {
    raw = JSON.parse(textContent.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'Файл повреждён или это не JSON' };
  }
  return normalizePlan(raw);
}

export function projectFileName(plan: DayPlan): string {
  return `first-day-${/^\d{4}-\d{2}-\d{2}$/.test(plan.date) ? plan.date : 'plan'}.plan.json`;
}

// ---------- синхронная резервная копия на закрытие вкладки ----------

export const BACKUP_KEY = 'fdb.v1.unsaved';

export function writeBackup(storage: Storage | null, draft: DayPlan, baseRev: number): void {
  try {
    storage?.setItem(BACKUP_KEY, JSON.stringify({ baseRev, draft }));
  } catch {
    /* переполнено или запрещено — остаётся только IndexedDB */
  }
}

export function readBackup(storage: Storage | null): { baseRev: number; draft: DayPlan } | null {
  try {
    const raw = storage?.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { baseRev?: unknown; draft?: unknown };
    const n = normalizePlan(parsed.draft);
    if (!n.ok || typeof parsed.baseRev !== 'number') return null;
    return { baseRev: parsed.baseRev, draft: n.plan };
  } catch {
    return null;
  }
}

export function clearBackup(storage: Storage | null): void {
  try {
    storage?.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
}
