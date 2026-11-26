import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListChecks, Pencil, Trash2, X } from 'lucide-react';
import { api } from '../api.ts';
import { useToast } from './ui.tsx';

type Item = { line: number; raw: string };
type Section = { heading: string; items: Item[] };

/** Маркер строки («- », «- [ ] », «> », «1. »), который сохраняется при правке. */
const PREFIX_RE = /^(\s*(?:[-*+]\s+(?:\[.\]\s+)?|>\s?|\d+[.)]\s+)?)/;

function split(raw: string): { prefix: string; text: string } {
  if (/^\s*\|/.test(raw)) return { prefix: '', text: raw };
  const prefix = PREFIX_RE.exec(raw)?.[1] ?? '';
  return { prefix, text: raw.slice(prefix.length) };
}

/** Убираем разметку для показа: [[ссылки|псевдонимы]], **жирный**, ячейки таблицы. */
function display(raw: string): string {
  const { text } = split(raw);
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .replace(/\s*\|\s*/g, ' · ');
}

/**
 * Записи внутри заметки по разделам (цитаты, журнал, история общения, идеи
 * подарков, маршрут…): каждую можно изменить или удалить, удаление — с «Отменить».
 */
export function NoteLinesCard({ path, defaultOpen = false }: { path: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const q = useQuery({
    queryKey: ['note-lines', path],
    queryFn: () => api.get<{ sections: Section[] }>(`/api/note/lines?path=${encodeURIComponent(path)}`),
    enabled: open,
  });
  const total = q.data?.sections.reduce((n, s) => n + s.items.length, 0) ?? 0;
  return (
    <section className="card">
      <button className="card-head plain" style={{ width: '100%', marginBottom: open ? 12 : 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="card-title">
          <ListChecks size={16} /> Записи в заметке
        </span>
        <span className="card-sub row" style={{ gap: 4 }}>
          {open ? 'Скрыть' : 'Изменить или удалить'} {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <>
          {q.isLoading && <div className="small muted">Загрузка…</div>}
          {q.error && <div className="small" style={{ color: 'var(--red)' }}>{(q.error as Error).message}</div>}
          {q.data && total === 0 && <div className="small muted">В разделах заметки пока нет записей.</div>}
          {q.data?.sections.map((s) => (
            <div key={`${s.heading}:${s.items[0]?.line}`} style={{ marginBottom: 12 }}>
              <div className="small" style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>
                {s.heading}
              </div>
              <ul className="list">
                {s.items.map((it) => (
                  <LineRow key={`${it.line}:${it.raw}`} path={path} item={it} />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function LineRow({ path, item }: { path: string; item: Item }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { prefix, text } = split(item.raw);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [draft, setDraft] = useState(text);
  const save = useMutation({
    mutationFn: () => api.post('/api/note/line', { path, line: item.line, raw: item.raw, text: prefix + draft.trim() }),
    onSuccess: () => {
      toast('Запись изменена');
      setMode('view');
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.post<{ line: number; raw: string }>('/api/note/line', { path, line: item.line, raw: item.raw, text: null }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      const short = display(item.raw);
      toast(
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span>Запись удалена: «{short.length > 40 ? short.slice(0, 40) + '…' : short}»</span>
          <button
            className="btn small"
            onClick={() =>
              void api
                .post('/api/note/line/restore', { path, line: r.line, raw: item.raw })
                .then(() => toast('Запись возвращена'))
                .catch((e: Error) => toast(e.message, 'error'))
                .finally(() => void qc.invalidateQueries())
            }
          >
            Отменить
          </button>
        </span>,
        'info',
        8000,
      );
    },
    onError: (e: Error) => {
      toast(e.message, 'error');
      setMode('view');
    },
  });
  const label = display(item.raw).slice(0, 60);

  if (mode === 'edit') {
    return (
      <li className="line-row">
        <form
          className="row"
          style={{ gap: 6, flex: 1, flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && prefix + draft.trim() !== item.raw) save.mutate();
            else setMode('view');
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setMode('view')}
            aria-label="Текст записи"
          />
          <button className="btn small primary" type="submit" disabled={save.isPending || !draft.trim()}>
            Сохранить
          </button>
          <button className="btn small ghost" type="button" onClick={() => setMode('view')}>
            Отмена
          </button>
        </form>
      </li>
    );
  }
  return (
    <li className="line-row">
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{display(item.raw) || <span className="muted">(пусто)</span>}</span>
      {mode === 'confirm' ? (
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <span className="small muted">Удалить?</span>
          <button className="btn small danger" disabled={del.isPending} onClick={() => del.mutate()}>
            Да, удалить
          </button>
          <button className="btn small ghost icon" aria-label="Не удалять" onClick={() => setMode('view')}>
            <X size={14} />
          </button>
        </span>
      ) : (
        <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
          <button
            className="btn small ghost icon"
            title="Изменить"
            aria-label={`Изменить запись: ${label}`}
            onClick={() => {
              setDraft(text);
              setMode('edit');
            }}
          >
            <Pencil size={14} />
          </button>
          <button className="btn small ghost icon" title="Удалить" aria-label={`Удалить запись: ${label}`} onClick={() => setMode('confirm')}>
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
  );
}
