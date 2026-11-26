import { memo } from 'react';
import { DAY_MINUTES, KIND_LABEL, type Block, type BlockKind, type Contact, type DayPlan } from '../core/model';
import { endLabel, parseHHMM, toHHMM } from '../core/time';
import { Field, TextArea } from './Field';

// Модуль plan-editor: поля плана, контакты и блоки дня. Ошибки приходят из timeline-validation
// картой «ключ поля → сообщение», конфликты — картой «id блока → тексты пересечений».

export type Errors = Map<string, string>;

export interface BlockActions {
  onBlock: (id: string, patch: Partial<Block>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onShift: (id: string, minutes: number) => void;
  onRemoveBlock: (id: string) => void;
}

interface BlockProps extends BlockActions {
  block: Block;
  index: number;
  count: number;
  contacts: Contact[];
  /** Ошибки и конфликты — примитивами: memo пропускает блоки, у которых они не изменились. */
  titleError?: string;
  startError?: string;
  durationError?: string;
  linkError?: string;
  conflictText?: string;
}

const BlockEditor = memo(function BlockEditor(p: BlockProps) {
  const b = p.block;
  const conflicts = p.conflictText ? p.conflictText.split('\n') : undefined;
  const ERR: Record<string, string | undefined> = { title: p.titleError, start: p.startError, duration: p.durationError, link: p.linkError };
  const fieldError = (k: string) => ERR[k.slice(k.lastIndexOf('.') + 1)];
  const key = (f: string) => `block.${b.id}.${f}`;
  const name = b.title.trim() || `${KIND_LABEL[b.kind]} ${p.index + 1}`;
  const timed = b.start !== null;
  // Снятие со шкалы запоминает время в parkedStart, возврат на шкалу его восстанавливает.
  const park = (): Partial<Block> => ({ start: null, parkedStart: b.start ?? b.parkedStart });
  const unpark = (fallbackDuration: number): Partial<Block> => ({
    start: b.parkedStart ?? 9 * 60,
    duration: b.duration || fallbackDuration,
    parkedStart: null,
  });
  const setKind = (kind: BlockKind) => {
    if (kind === 'material') p.onBlock(b.id, { kind, ...park() });
    else if (kind === 'meeting' && b.start === null) p.onBlock(b.id, { kind, ...unpark(30) });
    else p.onBlock(b.id, { kind });
  };
  return (
    <li
      className={`block block--${b.kind} ${conflicts ? 'block--conflict' : ''}`}
      data-testid="block"
      data-block-id={b.id}
      data-title={b.title}
      aria-label={name}
    >
      <div className="block__head">
        <h3>
          {timed ? (
            <span className="block__time">
              {toHHMM(b.start!)}–{b.start! + b.duration <= DAY_MINUTES ? endLabel(b.start! + b.duration) : '…'}
            </span>
          ) : null}
          {name}
        </h3>
        <div className="block__order">
          <button type="button" className="btn btn--ghost" disabled={p.index === 0} onClick={() => p.onMove(b.id, -1)} aria-label={`Переместить «${name}» выше`}>
            ↑
          </button>
          <button type="button" className="btn btn--ghost" disabled={p.index === p.count - 1} onClick={() => p.onMove(b.id, 1)} aria-label={`Переместить «${name}» ниже`}>
            ↓
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => p.onRemoveBlock(b.id)}>
            Удалить
          </button>
        </div>
      </div>
      {conflicts ? (
        <ul className="block__conflicts" data-testid="block-conflicts" id={`conf-${b.id}`}>
          {conflicts.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      <div className="block__grid">
        <div className="field">
          <label htmlFor={`kind-${b.id}`}>Тип</label>
          <select id={`kind-${b.id}`} data-field={key('kind')} value={b.kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
            <option value="meeting">{KIND_LABEL.meeting}</option>
            <option value="task">{KIND_LABEL.task}</option>
            <option value="material">{KIND_LABEL.material}</option>
          </select>
        </div>
        <Field label="Название" field={key('title')} value={b.title} maxLength={200} error={fieldError(key('title'))} onChange={(title) => p.onBlock(b.id, { title })} />
        {b.kind !== 'material' ? (
          <>
            {b.kind === 'task' ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={!timed}
                  data-field={key('untimed')}
                  onChange={(e) => p.onBlock(b.id, e.target.checked ? park() : unpark(60))}
                />
                Без времени
              </label>
            ) : null}
            {timed || b.kind === 'meeting' ? (
              <>
                <Field
                  label="Начало"
                  type="time"
                  field={key('start')}
                  value={b.start === null ? '' : toHHMM(b.start)}
                  error={fieldError(key('start'))}
                  aria-describedby={conflicts ? `conf-${b.id}` : undefined}
                  onChange={(v) => p.onBlock(b.id, { start: parseHHMM(v) })}
                />
                <Field
                  label="Длительность"
                  type="number"
                  min={1}
                  max={DAY_MINUTES}
                  step={5}
                  inputMode="numeric"
                  suffix="мин"
                  field={key('duration')}
                  value={b.duration ? String(b.duration) : ''}
                  error={fieldError(key('duration'))}
                  onChange={(v) => p.onBlock(b.id, { duration: v === '' ? 0 : Math.max(0, Math.round(Number(v))) })}
                />
                <div className="block__shift">
                  <button type="button" className="btn" disabled={!timed} onClick={() => p.onShift(b.id, -15)}>
                    Раньше на 15 мин
                  </button>
                  <button type="button" className="btn" disabled={!timed} onClick={() => p.onShift(b.id, 15)}>
                    Позже на 15 мин
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <details className="block__more" open={b.kind === 'material' || Boolean(fieldError(key('link'))) || undefined}>
        <summary>
          Место, ссылка, описание и контакты
          {summaryBits(b, p.contacts) ? <span className="muted"> · {summaryBits(b, p.contacts)}</span> : null}
        </summary>
        <div className="block__grid">
        <Field label="Где" field={key('place')} value={b.place} maxLength={200} onChange={(place) => p.onBlock(b.id, { place })} />
        <Field
          label="Ссылка"
          field={key('link')}
          value={b.link}
          inputMode="url"
          placeholder="https://…"
          error={fieldError(key('link'))}
          hint="Только http:// или https://"
          onChange={(link) => p.onBlock(b.id, { link })}
        />
        <TextArea
          label="Описание"
          field={key('description')}
          value={b.description}
          maxLength={2000}
          className="field--wide"
          hint="Текст показывается как есть, разметка HTML не выполняется"
          onChange={(description) => p.onBlock(b.id, { description })}
        />
        {p.contacts.length ? (
          <fieldset className="field--wide block__people">
            <legend>Контакты блока</legend>
            {p.contacts.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={b.contactIds.includes(c.id)}
                  onChange={(e) =>
                    p.onBlock(b.id, { contactIds: e.target.checked ? [...b.contactIds, c.id] : b.contactIds.filter((x) => x !== c.id) })
                  }
                />
                {c.name.trim() || 'Без имени'}
              </label>
            ))}
          </fieldset>
        ) : null}
        </div>
      </details>
    </li>
  );
});

function summaryBits(b: Block, contacts: Contact[]): string {
  const who = b.contactIds.map((id) => contacts.find((c) => c.id === id)?.name.trim()).filter(Boolean);
  return [b.place.trim(), b.link.trim() ? 'есть ссылка' : '', who.length ? who.join(', ') : ''].filter(Boolean).join(' · ');
}

interface Props extends BlockActions {
  plan: DayPlan;
  errors: Errors;
  conflicts: Map<string, string[]>;
  onPlan: (patch: Partial<DayPlan>) => void;
  onAddBlock: (kind: BlockKind) => void;
  onContact: (id: string, patch: Partial<Contact>) => void;
  onAddContact: () => void;
  onRemoveContact: (id: string) => void;
  canAddBlock: boolean;
  canAddContact: boolean;
}

export function PlanEditor(p: Props) {
  const { plan } = p;
  const error = (k: string) => p.errors.get(k);
  return (
    <>
      <section className="panel" aria-labelledby="plan-h">
        <h2 id="plan-h">1. День и новичок</h2>
        <div className="grid">
          <Field label="Заголовок" field="plan.title" value={plan.title} maxLength={200} error={error('plan.title')} onChange={(title) => p.onPlan({ title })} />
          <Field label="Дата" type="date" field="plan.date" value={plan.date} error={error('plan.date')} onChange={(date) => p.onPlan({ date })} />
          <Field label="Имя новичка" field="plan.newcomer" value={plan.newcomer} maxLength={200} onChange={(newcomer) => p.onPlan({ newcomer })} />
          <Field label="Наставник" field="plan.mentor" value={plan.mentor} maxLength={200} onChange={(mentor) => p.onPlan({ mentor })} />
          <TextArea label="Приветствие" field="plan.welcome" value={plan.welcome} maxLength={2000} className="field--wide" onChange={(welcome) => p.onPlan({ welcome })} />
        </div>
      </section>

      <section className="panel" aria-labelledby="people-h">
        <h2 id="people-h">2. Контакты</h2>
        {plan.contacts.length === 0 ? <p className="empty">Добавьте людей, к которым новичок может обратиться.</p> : null}
        <ul className="contacts">
          {plan.contacts.map((c, i) => (
            <li key={c.id} className="contact" data-testid="contact" data-contact-id={c.id}>
              <Field label="Имя" field={`contact.${c.id}.name`} value={c.name} maxLength={200} error={error(`contact.${c.id}.name`)} onChange={(name) => p.onContact(c.id, { name })} />
              <Field label="Роль" field={`contact.${c.id}.role`} value={c.role} maxLength={200} onChange={(role) => p.onContact(c.id, { role })} />
              <Field label="Почта" type="email" field={`contact.${c.id}.email`} value={c.email} maxLength={200} error={error(`contact.${c.id}.email`)} onChange={(email) => p.onContact(c.id, { email })} />
              <Field label="Телефон" field={`contact.${c.id}.phone`} value={c.phone} maxLength={60} onChange={(phone) => p.onContact(c.id, { phone })} />
              <button type="button" className="btn btn--ghost" aria-label={`Удалить контакт ${c.name.trim() || i + 1}`} onClick={() => p.onRemoveContact(c.id)}>
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={p.onAddContact} disabled={!p.canAddContact} data-testid="add-contact">
          Добавить контакт
        </button>
      </section>

      <section className="panel" aria-labelledby="blocks-h">
        <h2 id="blocks-h">3. Блоки дня</h2>
        {plan.blocks.length === 0 ? <p className="empty">Добавьте встречи, задачи и материалы.</p> : null}
        <ol className="blocks">
          {plan.blocks.map((b, i) => (
            <BlockEditor
              key={b.id}
              block={b}
              index={i}
              count={plan.blocks.length}
              contacts={plan.contacts}
              titleError={error(`block.${b.id}.title`)}
              startError={error(`block.${b.id}.start`)}
              durationError={error(`block.${b.id}.duration`)}
              linkError={error(`block.${b.id}.link`)}
              conflictText={p.conflicts.get(b.id)?.join('\n')}
              onBlock={p.onBlock}
              onMove={p.onMove}
              onShift={p.onShift}
              onRemoveBlock={p.onRemoveBlock}
            />
          ))}
        </ol>
        <div className="toolbar">
          {(['meeting', 'task', 'material'] as const).map((k) => (
            <button key={k} type="button" className="btn btn--primary" disabled={!p.canAddBlock} data-add-block={k} onClick={() => p.onAddBlock(k)}>
              + {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
