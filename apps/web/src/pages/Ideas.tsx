import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, FolderPlus, ListPlus, Lightbulb, PauseCircle } from 'lucide-react';
import { api, type IdeaDTO } from '../api.ts';
import { Empty, ErrorBox, Loading, STATUS_LABEL, StatusChip, fmtDate, noteHref, useToast } from '../components/ui.tsx';

const FILTERS = ['active', 'new', 'hypothesis', 'parked', 'converted', 'all'] as const;

export function IdeasPage() {
  const q = useQuery({ queryKey: ['ideas'], queryFn: () => api.get<{ ideas: IdeaDTO[] }>('/api/ideas') });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('active');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post('/api/ideas', { title, text }),
    onSuccess: () => {
      setTitle('');
      setText('');
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const ideas = q.data.ideas.filter((i) =>
    filter === 'all' ? true : filter === 'active' ? ['new', 'hypothesis'].includes(i.status) : i.status === filter,
  );

  return (
    <div className="grid cols-3">
      <div className="stack">
        <div className="filters">
          <div className="tabs" role="tablist">
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Все' : f === 'active' ? 'В работе' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        {ideas.length === 0 ? (
          <div className="card">
            <Empty icon={<Lightbulb size={18} />} title={q.data.ideas.length ? 'Нет идей с таким статусом' : 'Идей пока нет'}>
              Запишите идею справа или нажмите N в любом месте.
            </Empty>
          </div>
        ) : (
          <div className="grid cols-auto">
            {ideas.map((i) => (
              <IdeaCard key={i.path} idea={i} />
            ))}
          </div>
        )}
      </div>
      <div className="stack">
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 12 }}>
            <Lightbulb size={16} /> Новая идея
          </h2>
          <form
            className="stack"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate();
            }}
          >
            <input className="input" placeholder="Коротко: в чём идея" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Название идеи" />
            <textarea className="textarea" placeholder="Подробности, контекст, ссылки [[…]]" value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Описание идеи" />
            <button className="btn primary" type="submit" disabled={!title.trim() || create.isPending}>
              Сохранить идею
            </button>
          </form>
        </section>
        <section className="card small muted">
          Идея — заметка с <code>type: idea</code>. Её можно превратить в проект или задачу: исходная заметка останется и получит ссылку на результат.
        </section>
      </div>
    </div>
  );
}

function IdeaCard({ idea }: { idea: IdeaDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const convert = useMutation({
    mutationFn: (to: 'project' | 'task' | 'hypothesis') => api.post<{ created: string | null }>('/api/ideas/convert', { path: idea.path, to }),
    onSuccess: (r, to) => {
      void qc.invalidateQueries();
      toast(
        to === 'hypothesis' ? (
          'Идея отмечена как гипотеза'
        ) : (
          <span>
            Создано: <Link to={to === 'project' ? `/projects/view?path=${encodeURIComponent(r.created!)}` : noteHref(r.created!)}>{r.created}</Link>
          </span>
        ),
      );
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const status = useMutation({
    mutationFn: (s: string) => api.post('/api/ideas/status', { path: idea.path, status: s }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const busy = convert.isPending || status.isPending;
  const open = idea.status === 'new' || idea.status === 'hypothesis' || idea.status === 'parked';
  return (
    <div className="card" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
      <div className="row">
        <Link to={noteHref(idea.path)} style={{ fontWeight: 600, flex: 1 }}>
          {idea.title}
        </Link>
        <StatusChip status={idea.status} />
      </div>
      {idea.excerpt && <div className="small" style={{ color: 'var(--text-2)' }}>{idea.excerpt}</div>}
      <div className="small muted">
        {fmtDate(idea.created)}
        {idea.tags.length > 0 && ` · #${idea.tags.join(' #')}`}
      </div>
      {idea.convertedTo && (
        <div className="small">
          → <Link to={noteHref(idea.convertedTo)}>{idea.convertedTo}</Link>
        </div>
      )}
      {open && (
        <div className="row">
          <button className="btn small" disabled={busy} onClick={() => convert.mutate('project')} title="Создать заметку проекта">
            <FolderPlus size={14} /> В проект
          </button>
          <button className="btn small" disabled={busy} onClick={() => convert.mutate('task')} title="Добавить задачу в сегодняшнюю заметку">
            <ListPlus size={14} /> В задачу
          </button>
          {idea.status !== 'hypothesis' && (
            <button className="btn small" disabled={busy} onClick={() => convert.mutate('hypothesis')}>
              <FlaskConical size={14} /> Гипотеза
            </button>
          )}
          {idea.status !== 'parked' && (
            <button className="btn small ghost" disabled={busy} onClick={() => status.mutate('parked')} title="Отложить">
              <PauseCircle size={14} /> Отложить
            </button>
          )}
        </div>
      )}
    </div>
  );
}
