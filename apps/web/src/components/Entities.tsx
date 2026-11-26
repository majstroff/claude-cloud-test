import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api, type NoteData, type NoteSummary } from '../api.ts';
import { entityHref, type FieldDef } from '../entities.ts';
import { Modal } from './Layout.tsx';
import { Empty, ErrorBox, Loading, TYPE_LABEL, fmtDate, useToast } from './ui.tsx';

type Values = Record<string, unknown>;

/** Подсказки для полей-ссылок: названия заметок нужных типов. */
function useLinkOptions(defs: FieldDef[]): Record<string, string[]> {
  const types = useMemo(() => [...new Set(defs.flatMap((d) => d.linkTypes ?? []))], [defs]);
  const results = useQueries({
    queries: types.map((t) => ({
      queryKey: ['notes', t],
      queryFn: () => api.get<{ notes: NoteSummary[] }>(`/api/notes?type=${encodeURIComponent(t)}`),
      staleTime: 30_000,
    })),
  });
  const out: Record<string, string[]> = {};
  types.forEach((t, i) => {
    out[t] = (results[i]?.data?.notes ?? []).map((n) => n.title).sort((a, b) => a.localeCompare(b, 'ru'));
  });
  return out;
}

/** Значение свойства в виде, удобном для поля формы. */
export function toFormValue(def: FieldDef, v: unknown): unknown {
  if (def.kind === 'boolean') return v === true;
  if (def.kind === 'list') return Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : '';
  if (v === null || v === undefined) return '';
  const s = String(v);
  return def.kind === 'link' ? s.replace(/^\[\[|\]\]$/g, '').split('|').pop()!.split('/').pop()! : s;
}

export function EntityFields({ defs, values, onChange, idPrefix }: { defs: FieldDef[]; values: Values; onChange: (v: Values) => void; idPrefix: string }) {
  const options = useLinkOptions(defs);
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="form-grid">
      {defs.map((d) => {
        const v = values[d.key];
        const id = `${idPrefix}-${d.key}`;
        if (d.kind === 'boolean') {
          return (
            <label key={d.key} className="check-field wide">
              <input type="checkbox" checked={v === true} onChange={(e) => set(d.key, e.target.checked)} />
              <span>{d.label}</span>
            </label>
          );
        }
        let input: ReactNode;
        if (d.kind === 'select') {
          input = (
            <select id={id} className="select" value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value)}>
              <option value="">—</option>
              {Object.entries(d.options ?? {}).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          );
        } else if (d.kind === 'list') {
          input = <textarea id={id} className="textarea" rows={2} value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value)} placeholder={d.placeholder} />;
        } else {
          const listId = d.kind === 'link' ? `${id}-list` : undefined;
          input = (
            <>
              <input
                id={id}
                className="input"
                type={d.kind === 'link' ? 'text' : d.kind}
                value={String(v ?? '')}
                onChange={(e) => set(d.key, e.target.value)}
                placeholder={d.placeholder ?? (d.kind === 'link' ? 'Название заметки или текст' : undefined)}
                list={listId}
                min={d.kind === 'number' ? 0 : undefined}
              />
              {listId && (
                <datalist id={listId}>
                  {(d.linkTypes ?? []).flatMap((t) => options[t] ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              )}
            </>
          );
        }
        return (
          <label key={d.key} className={`field ${d.wide ? 'wide' : ''}`} htmlFor={id}>
            {d.label}
            {input}
            {d.hint && <span className="small muted">{d.hint}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Только изменённые поля; пустое значение означает «удалить свойство». */
function diff(defs: FieldDef[], initial: Values, current: Values): Values {
  const out: Values = {};
  for (const d of defs) {
    const a = initial[d.key] ?? (d.kind === 'boolean' ? false : '');
    const b = current[d.key] ?? (d.kind === 'boolean' ? false : '');
    if (a === b) continue;
    if (d.kind === 'boolean') out[d.key] = b === true;
    else if (d.kind === 'number') out[d.key] = String(b).trim() ? Number(b) : null;
    else if (d.kind === 'list') out[d.key] = String(b).split('\n').map((x) => x.trim()).filter(Boolean);
    else out[d.key] = String(b).trim() || null;
  }
  return out;
}

/** Карточка редактирования свойств заметки (YAML) по схеме раздела. */
export function EditEntityCard({ path, defs, title = 'Свойства', children }: { path: string; defs: FieldDef[]; title?: string; children?: ReactNode }) {
  const q = useQuery({ queryKey: ['note', path], queryFn: () => api.get<NoteData>(`/api/note?path=${encodeURIComponent(path)}`) });
  const initial = useMemo(() => {
    const fm = q.data?.frontmatter ?? {};
    return Object.fromEntries(defs.map((d) => [d.key, toFormValue(d, fm[d.key])]));
  }, [q.data, defs]);
  const [values, setValues] = useState<Values>(initial);
  useEffect(() => setValues(initial), [initial]);
  const qc = useQueryClient();
  const toast = useToast();
  const changes = diff(defs, initial, values);
  const dirty = Object.keys(changes).length > 0;
  const m = useMutation({
    mutationFn: () => api.put('/api/entity', { path, set: changes }),
    onSuccess: () => {
      toast('Свойства сохранены в заметку');
      void qc.invalidateQueries();
    },
  });
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 12 }}>{title}</h3>
      {q.isPending ? (
        <Loading rows={4} />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) m.mutate();
          }}
          className="stack"
          style={{ gap: 12 }}
        >
          <EntityFields defs={defs} values={values} onChange={setValues} idPrefix={`edit-${path}`} />
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
          <div className="row">
            <button className="btn primary small" type="submit" disabled={!dirty || m.isPending}>
              <Save size={14} /> Сохранить
            </button>
            {dirty && (
              <button type="button" className="btn small ghost" onClick={() => setValues(initial)}>
                Отменить изменения
              </button>
            )}
          </div>
          {children}
        </form>
      )}
    </section>
  );
}

/** Окно создания записи: название, поля схемы, текст. */
export function CreateEntityModal({
  type,
  heading,
  titleLabel = 'Название',
  defs,
  initial = {},
  textLabel,
  folderHint,
  companyOption,
  onClose,
  onCreated,
}: {
  type: string;
  heading: string;
  titleLabel?: string;
  defs: FieldDef[];
  initial?: Values;
  textLabel?: string;
  folderHint: string;
  companyOption?: boolean;
  onClose: () => void;
  onCreated?: (path: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [values, setValues] = useState<Values>(initial);
  const [createCompany, setCreateCompany] = useState(true);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () =>
      api.post<{ path: string }>('/api/entities', {
        type,
        title,
        text,
        fields: diff(defs, {}, values),
        createCompany: companyOption ? createCompany : false,
      }),
    onSuccess: (r) => {
      toast(`Создана заметка ${r.path}`);
      void qc.invalidateQueries();
      onClose();
      onCreated?.(r.path);
    },
  });
  return (
    <Modal onClose={onClose} label={heading}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) m.mutate();
        }}
      >
        <div className="modal-head">
          <strong>{heading}</strong>
        </div>
        <div className="modal-body" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <label className="field">
            {titleLabel}
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <EntityFields defs={defs} values={values} onChange={setValues} idPrefix={`new-${type}`} />
          {companyOption && (
            <label className="check-field">
              <input type="checkbox" checked={createCompany} onChange={(e) => setCreateCompany(e.target.checked)} />
              <span>Создать карточку компании, если её ещё нет</span>
            </label>
          )}
          {textLabel && (
            <label className="field">
              {textLabel}
              <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="small muted">{folderHint}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || m.isPending}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Редактор текстовой секции заметки (описание, сопроводительное письмо, заметки). */
export function SectionEditor({ path, section, title, value, placeholder, rows = 5 }: { path: string; section: string; title: string; value: string; placeholder?: string; rows?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.put('/api/entity/section', { path, section, content: text }),
    onSuccess: () => {
      toast('Сохранено в заметку');
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="card-title">{title}</h3>
        {text !== value && (
          <button className="btn small primary" onClick={() => m.mutate()} disabled={m.isPending}>
            <Save size={14} /> Сохранить
          </button>
        )}
      </div>
      <textarea className="textarea" rows={rows} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={title} />
    </section>
  );
}

export function HistoryList({ items, empty }: { items: Array<{ date: string; text: string }>; empty: string }) {
  if (items.length === 0) return <Empty title={empty} />;
  return (
    <ol className="timeline">
      {items.map((h, i) => (
        <li key={`${h.date}-${i}`}>
          <span className="small muted">{fmtDate(h.date)}</span>
          <span>{h.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function RelatedCard({ related, emptyHint }: { related: Array<NoteSummary & { direction: 'out' | 'in' | 'both' }>; emptyHint: string }) {
  const groups = related.reduce<Record<string, typeof related>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>Связи</h3>
      {related.length === 0 ? (
        <Empty title="Связей пока нет">{emptyHint}</Empty>
      ) : (
        Object.entries(groups).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 10 }}>
            <div className="small muted" style={{ margin: '4px 10px' }}>{TYPE_LABEL[type] ?? type}</div>
            <ul className="list">
              {items.map((r) => (
                <li key={r.path}>
                  <Link to={entityHref(r.type, r.path)}>
                    <span className={`type-dot ${r.type}`} />
                    <span className="li-main">
                      <div className="li-title">{r.title}</div>
                    </span>
                    <span className="small muted">{r.direction === 'in' ? 'ссылается сюда' : r.direction === 'out' ? 'упомянут' : 'взаимно'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Ссылка на заметку из Ref (или просто текст, если заметки нет). */
export function RefLink({ r, type }: { r: { path: string | null; title: string } | null; type: string }) {
  if (!r) return <span className="muted">—</span>;
  if (!r.path) return <span title="Заметки с таким названием нет">{r.title}</span>;
  return <Link to={entityHref(type, r.path)}>{r.title}</Link>;
}
