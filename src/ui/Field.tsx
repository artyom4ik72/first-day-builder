import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Ключ ошибки, он же data-field: по нему тесты и ссылки «к полю» находят ввод. */
  field: string;
  error?: string;
  hint?: string;
  suffix?: string;
}

export function Field({ label, value, onChange, field, error, hint, suffix, className, 'aria-describedby': extraDesc, ...rest }: Props) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`field ${className ?? ''} ${error ? 'field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field__control">
        <input
          id={id}
          data-field={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errId, hintId, extraDesc].filter(Boolean).join(' ') || undefined}
          autoComplete="off"
          {...rest}
        />
        {suffix ? <span className="field__suffix" aria-hidden="true">{suffix}</span> : null}
      </div>
      {error ? (
        <p className="field__error" id={errId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  field: string;
  error?: string;
  hint?: string;
}

export function TextArea({ label, value, onChange, field, error, hint, className, ...rest }: AreaProps) {
  const id = useId();
  const noteId = error || hint ? `${id}-note` : undefined;
  return (
    <div className={`field ${className ?? ''} ${error ? 'field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        data-field={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        rows={2}
        {...rest}
      />
      {error ? (
        <p className="field__error" id={noteId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={noteId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
