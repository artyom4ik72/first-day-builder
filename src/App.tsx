import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportFileName, renderPlanHtml } from './core/html-export';
import { DAY_MINUTES, demoPlan, emptyPlan, MAX_BLOCKS, MAX_CONTACTS, newBlock, newContact, type Block, type BlockKind, type Contact, type DayPlan } from './core/model';
import { exportProject, importProject, projectFileName } from './core/plan-store';
import { overlapText, validatePlan } from './core/timeline-validation';
import { PlanEditor } from './ui/PlanEditor';
import { Timeline } from './ui/Timeline';
import { usePersistentDraft, type SaveState } from './ui/usePersistentDraft';

const SAVE_TEXT: Record<SaveState, string> = {
  loading: 'Загрузка черновика…',
  saved: 'Черновик сохранён в этом браузере',
  saving: 'Сохранение…',
  error: 'Не удалось сохранить. Сохраните план в файл.',
  memory: 'Хранилище браузера недоступно: сохраните план в файл',
};

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function App() {
  const d = usePersistentDraft(() => emptyPlan(), 'first-day-builder');
  const { draft: plan, update, latestRef } = d;
  const [undo, setUndo] = useState<{ text: string; prev: DayPlan } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const focusRef = useRef<string | null>(null);
  const [, setFocusTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const loading = d.save === 'loading';

  useEffect(() => {
    if (d.external) setNotice({ kind: 'ok', text: 'План обновлён из другой вкладки' });
  }, [d.external]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!focusRef.current) return;
    const el = document.querySelector<HTMLElement>(focusRef.current);
    focusRef.current = null;
    el?.focus();
    el?.scrollIntoView({ block: 'center' });
  });

  const check = useMemo(() => validatePlan(plan), [plan]);
  const errors = useMemo(() => new Map(check.issues.map((i) => [i.key, i.message])), [check]);
  const conflicts = useMemo(() => {
    const byId = new Map(plan.blocks.map((b) => [b.id, b]));
    const m = new Map<string, string[]>();
    for (const o of check.overlaps) {
      const t = overlapText(o, byId);
      for (const id of [o.first, o.second]) m.set(id, [...(m.get(id) ?? []), t]);
    }
    return m;
  }, [check, plan.blocks]);
  // Предпросмотр обновляется через 300 мс после последней правки: перезагрузка iframe на каждое нажатие
  // стоила длинных задач (раунд 4). Скачивание всегда строит файл из текущего плана.
  const html = useMemo(() => (check.ok ? renderPlanHtml(plan) : ''), [check.ok, plan]);
  const [previewHtml, setPreviewHtml] = useState(html);
  useEffect(() => {
    if (!html || !previewHtml) {
      setPreviewHtml(html);
      return;
    }
    const t = window.setTimeout(() => setPreviewHtml(html), 300);
    return () => window.clearTimeout(t);
  }, [html, previewHtml]);

  const goTo = (selector: string) => {
    focusRef.current = selector;
    setFocusTick((n) => n + 1); // перерисовка, чтобы эффект фокуса сработал
  };

  const replacePlan = (next: DayPlan, text: string) => {
    const prev = latestRef.current;
    if (prev.blocks.length || prev.contacts.length) setUndo({ text, prev });
    update(() => next);
  };

  const mapBlock = useCallback(
    (id: string, fn: (b: Block) => Block) => update((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? fn(b) : b)) })),
    [update],
  );
  const actions = useMemo(
    () => ({
      onBlock: (id: string, patch: Partial<Block>) => mapBlock(id, (b) => ({ ...b, ...patch })),
      onShift: (id: string, minutes: number) =>
        mapBlock(id, (b) => (b.start === null ? b : { ...b, start: Math.min(DAY_MINUTES - 1, Math.max(0, b.start + minutes)) })),
      onMove: (id: string, dir: -1 | 1) => {
        focusRef.current = `[data-block-id="${id}"] [aria-label*="${dir < 0 ? 'выше' : 'ниже'}"]`;
        update((p) => {
          const i = p.blocks.findIndex((b) => b.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= p.blocks.length) return p;
          const blocks = [...p.blocks];
          [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
          return { ...p, blocks };
        });
      },
      onRemoveBlock: (id: string) => {
        const prev = latestRef.current;
        setUndo({ text: `«${prev.blocks.find((b) => b.id === id)?.title.trim() || 'Блок'}» удалён`, prev });
        focusRef.current = '[data-testid="undo"]';
        update((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) }));
      },
    }),
    [mapBlock, update, latestRef],
  );

  const addBlock = (kind: BlockKind) => {
    const ends = plan.blocks.filter((b) => b.start !== null).map((b) => b.start! + b.duration);
    const start = Math.min(23 * 60, ends.length ? Math.max(...ends) : 9 * 60);
    const b = newBlock(kind, kind === 'material' ? null : start);
    focusRef.current = `[data-field="block.${b.id}.title"]`;
    update((p) => ({ ...p, blocks: [...p.blocks, b] }));
  };

  const addContact = () => {
    const c = newContact();
    focusRef.current = `[data-field="contact.${c.id}.name"]`;
    update((p) => ({ ...p, contacts: [...p.contacts, c] }));
  };
  const patchContact = (id: string, patch: Partial<Contact>) =>
    update((p) => ({ ...p, contacts: p.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const removeContact = (id: string) => {
    const prev = latestRef.current;
    setUndo({ text: `Контакт «${prev.contacts.find((c) => c.id === id)?.name.trim() || 'без имени'}» удалён`, prev });
    focusRef.current = '[data-testid="undo"]';
    update((p) => ({
      ...p,
      contacts: p.contacts.filter((c) => c.id !== id),
      blocks: p.blocks.map((b) => (b.contactIds.includes(id) ? { ...b, contactIds: b.contactIds.filter((x) => x !== id) } : b)),
    }));
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNotice({ kind: 'error', text: 'Файл больше 2 МБ, это не похоже на план' });
      return;
    }
    const r = importProject(await file.text());
    if (!r.ok) {
      setNotice({ kind: 'error', text: `Не удалось открыть «${file.name}»: ${r.error}` });
      return;
    }
    replacePlan(r.plan, `План загружен из «${file.name}»`);
    setNotice({ kind: 'ok', text: r.warnings.length ? r.warnings.join('. ') : `Открыт план «${r.plan.title}»` });
  };

  const whose = (id: string | null) => {
    if (!id) return '';
    const bi = plan.blocks.findIndex((b) => b.id === id);
    if (bi >= 0) return `${plan.blocks[bi].title.trim() ? `«${plan.blocks[bi].title.trim()}»` : `Блок ${bi + 1}`}: `;
    const ci = plan.contacts.findIndex((c) => c.id === id);
    return ci >= 0 ? `${plan.contacts[ci].name.trim() ? `Контакт «${plan.contacts[ci].name.trim()}»` : `Контакт ${ci + 1}`}: ` : '';
  };
  const problems = [
    ...check.issues.map((i) => ({ text: whose(i.targetId) + i.message, target: `[data-field="${i.key}"]`, key: i.key })),
    ...check.overlaps.map((o) => ({
      text: overlapText(o, new Map(plan.blocks.map((b) => [b.id, b]))),
      target: `[data-field="block.${o.second}.start"]`,
      key: `${o.first}-${o.second}`,
    })),
  ];

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Конструктор первого рабочего дня</h1>
          <p className="muted">Соберите план дня для новичка и выгрузите его отдельной страницей.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" disabled={loading} onClick={() => replacePlan(demoPlan(), 'Загружен демоплан')}>
            Загрузить демоплан
          </button>
          <button type="button" className="btn" disabled={loading} onClick={() => replacePlan(emptyPlan(), 'Начат новый план')}>
            Новый план
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              download(projectFileName(plan), exportProject(plan), 'application/json');
              setNotice({ kind: 'ok', text: `Черновик сохранён в файл ${projectFileName(plan)}` });
            }}
          >
            Сохранить черновик в файл
          </button>
          <button type="button" className="btn" disabled={loading} onClick={() => fileRef.current?.click()}>
            Открыть черновик
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".json,application/json"
            data-testid="import-input"
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="statusbar">
        <span className={`save save--${d.save}`} role="status" data-testid="save-state">
          {SAVE_TEXT[d.save]}
        </span>
        {notice ? (
          <span className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="notice">
            {notice.text}
          </span>
        ) : null}
      </div>

      {d.conflict ? (
        <div className="banner" role="alert" data-testid="conflict">
          <p>План изменили в другой вкладке. Выберите, какую версию оставить.</p>
          <button type="button" className="btn" onClick={d.takeTheirs}>
            Взять версию из другой вкладки
          </button>
          <button type="button" className="btn btn--primary" onClick={d.keepMine}>
            Оставить мою
          </button>
        </div>
      ) : null}
      {d.recover ? (
        <div className="banner" role="alert" data-testid="recover">
          <p>Найдены несохранённые правки из закрытой вкладки, но план с тех пор менялся.</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const r = d.recover!;
              d.setRecover(null);
              replacePlan(r, 'Восстановлены несохранённые правки');
            }}
          >
            Восстановить мои правки
          </button>
          <button type="button" className="btn" onClick={d.dismissRecover}>
            Отбросить
          </button>
        </div>
      ) : null}
      {undo ? (
        <div className="toast" role="status">
          <span>{undo.text}</span>
          <button
            type="button"
            className="btn"
            data-testid="undo"
            onClick={() => {
              const prev = undo.prev;
              setUndo(null);
              update(() => prev);
            }}
          >
            Вернуть
          </button>
          <button type="button" className="btn btn--ghost" aria-label="Закрыть уведомление" onClick={() => setUndo(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <main className="layout">
        <fieldset className="editor" disabled={loading} aria-busy={loading}>
          <legend className="visually-hidden">Редактор плана</legend>
          <PlanEditor
            plan={plan}
            errors={errors}
            conflicts={conflicts}
            onPlan={(patch) => update((p) => ({ ...p, ...patch }))}
            onAddBlock={addBlock}
            onContact={patchContact}
            onAddContact={addContact}
            onRemoveContact={removeContact}
            canAddBlock={plan.blocks.length < MAX_BLOCKS}
            canAddContact={plan.contacts.length < MAX_CONTACTS}
            {...actions}
          />
        </fieldset>

        <aside className="side">
          <section className="panel" aria-labelledby="out-h" data-testid="export-panel">
            <h2 id="out-h">Проверка и страница для новичка</h2>
            {problems.length ? (
              <div data-testid="problems">
                <p role="status">
                  Перед выгрузкой исправьте: {problems.length} {problems.length === 1 ? 'замечание' : problems.length < 5 ? 'замечания' : 'замечаний'}.
                </p>
                <ul className="problems">
                  {problems.map((pr) => (
                    <li key={pr.key}>
                      <button type="button" className="link" onClick={() => goTo(pr.target)}>
                        {pr.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p role="status" className="ok" data-testid="check-ok">
                  Время и ссылки в порядке: {check.timed.length} по времени, {check.untimed.length} без времени.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="download-page"
                  onClick={() => {
                    download(exportFileName(plan), html, 'text/html');
                    setNotice({ kind: 'ok', text: `Страница ${exportFileName(plan)} сохранена в загрузки` });
                  }}
                >
                  Скачать страницу для новичка
                </button>
                <iframe
                  title="Предпросмотр страницы для новичка"
                  className="preview"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={previewHtml}
                  data-testid="preview"
                />
              </>
            )}
          </section>
          <section className="panel" aria-labelledby="tl-h">
            <h2 id="tl-h">Шкала дня</h2>
            <Timeline timed={check.timed} conflictIds={check.conflictIds} onPick={(id) => goTo(`[data-field="block.${id}.title"]`)} />
          </section>

        </aside>
      </main>

      <div className="mobilebar narrow-only" data-testid="mobilebar">
        <span role="status">{problems.length ? `Замечаний: ${problems.length}` : 'План готов к выгрузке'}</span>
        <button
          type="button"
          className={`btn ${problems.length ? '' : 'btn--primary'}`}
          onClick={() => goTo(problems.length ? '[data-testid="problems"] .link' : '[data-testid="download-page"]')}
        >
          {problems.length ? 'Показать' : 'К выгрузке'}
        </button>
      </div>
    </div>
  );
}
