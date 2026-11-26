import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, FileText, Plus, Star } from 'lucide-react';
import { api, type Health, type ProjectDTO, type ProjectDetail, type Strategy } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, Progress, STATUS_LABEL, StatusChip, TYPE_LABEL, noteHref, relDate, useToast } from '../components/ui.tsx';
import { Modal } from '../components/Layout.tsx';

export function useFavorite() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: { path: string; favorite: boolean }) => api.post('/api/favorites', v),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast(e.message, 'error'),
  });
}

export function ProjectsPage() {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: ProjectDTO[]; favorites: string[] }>('/api/projects') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const [status, setStatus] = useState('active');
  const [text, setText] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [creating, setCreating] = useState(false);
  const fav = useFavorite();
  const today = health.data?.today ?? '';

  const list = useMemo(() => {
    const all = q.data?.projects ?? [];
    const favs = new Set(q.data?.favorites ?? []);
    return all.filter(
      (p) =>
        (status === 'all' || p.status === status || (status === 'done' && p.status === 'completed')) &&
        (!onlyFav || favs.has(p.path)) &&
        (!text.trim() || `${p.title} ${p.area ?? ''} ${p.goal?.title ?? ''}`.toLowerCase().includes(text.trim().toLowerCase())),
    );
  }, [q.data, status, text, onlyFav]);

  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const favs = new Set(q.data.favorites);
  const counts = q.data.projects.reduce<Record<string, number>>((acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc), {});

  return (
    <div className="stack">
      <div className="filters">
        <div className="tabs" role="tablist">
          {['active', 'paused', 'done', 'archived', 'all'].map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {s === 'all' ? `Все · ${q.data.projects.length}` : `${STATUS_LABEL[s]} · ${counts[s] ?? 0}`}
            </button>
          ))}
        </div>
        <input className="input" placeholder="Фильтр по названию, сфере, цели" value={text} onChange={(e) => setText(e.target.value)} aria-label="Фильтр" />
        <button className={`btn small ${onlyFav ? 'primary' : ''}`} onClick={() => setOnlyFav(!onlyFav)} aria-pressed={onlyFav}>
          <Star size={14} /> Избранные
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Новый проект
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty
            title={q.data.projects.length === 0 ? 'В хранилище пока нет проектов' : 'Нет проектов по этому фильтру'}
            action={q.data.projects.length === 0 ? <button className="btn small" onClick={() => setCreating(true)}>Создать первый проект</button> : undefined}
          >
            {q.data.projects.length === 0 && 'Проект — это заметка в папке Projects или с type: project.'}
          </Empty>
        </div>
      ) : (
        <div className="grid cols-auto">
          {list.map((p) => (
            <div key={p.path} className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="row">
                <Link to={`/projects/view?path=${encodeURIComponent(p.path)}`} style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>
                  {p.title}
                </Link>
                <button
                  className="btn small icon ghost"
                  aria-label={favs.has(p.path) ? 'Убрать из избранного' : 'В избранное'}
                  onClick={() => fav.mutate({ path: p.path, favorite: !favs.has(p.path) })}
                >
                  <Star size={14} fill={favs.has(p.path) ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className="row">
                <StatusChip status={p.status} />
                {p.area && <span className="chip">{p.area}</span>}
                {p.deadline && today && <span className={`chip ${p.daysLeft !== null && p.daysLeft < 0 ? 'red' : ''}`}>до {relDate(p.deadline, today)}</span>}
              </div>
              <Progress value={p.progress} tone="blue" />
              <div className="small muted">
                {p.progress}% · задач {p.tasksDone}/{p.tasksTotal}
                {p.tasksOverdue > 0 && <span style={{ color: 'var(--red)' }}> · просрочено {p.tasksOverdue}</span>}
              </div>
              {p.goal && (
                <div className="small">
                  Цель: <Link to={noteHref(p.goal.path)}>{p.goal.title}</Link>
                </div>
              )}
              <div className="small" style={{ color: p.nextStep ? 'var(--text)' : 'var(--text-3)' }}>
                Следующий шаг: {p.nextStep ?? 'не определён — добавьте задачу'}
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </div>
  );
}

export function CreateProject({ onClose, goal }: { onClose: () => void; goal?: string }) {
  const s = useQuery({ queryKey: ['strategy'], queryFn: () => api.get<Strategy>('/api/strategy') });
  const [form, setForm] = useState({ title: '', goal: goal ?? '', deadline: '', area: '', budget: '', description: '' });
  const qc = useQueryClient();
  const nav = useNavigate();
  const m = useMutation({
    mutationFn: () =>
      api.post<{ path: string }>('/api/projects', {
        title: form.title,
        goal: form.goal || null,
        deadline: form.deadline || null,
        area: form.area || null,
        budget: form.budget ? Number(form.budget) : null,
        description: form.description || null,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      onClose();
      nav(`/projects/view?path=${encodeURIComponent(r.path)}`);
    },
  });
  const upd = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal onClose={onClose} label="Новый проект">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.title.trim()) m.mutate();
        }}
      >
        <div className="modal-head">
          <strong>Новый проект</strong>
        </div>
        <div className="modal-body">
          <label className="field">
            Название
            <input className="input" autoFocus value={form.title} onChange={upd('title')} required />
          </label>
          <label className="field">
            Цель
            <select className="select" value={form.goal} onChange={upd('goal')}>
              <option value="">Без цели</option>
              {(s.data?.goals ?? [])
                .filter((g) => g.status === 'active')
                .map((g) => (
                  <option key={g.path} value={g.path}>
                    {g.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="row">
            <label className="field" style={{ flex: '1 1 140px' }}>
              Срок
              <input type="date" className="input" value={form.deadline} onChange={upd('deadline')} />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              Сфера
              <input className="input" value={form.area} onChange={upd('area')} placeholder="Карьера, Дом…" />
            </label>
            <label className="field" style={{ flex: '1 1 120px' }}>
              Бюджет, ₽
              <input type="number" min="0" className="input" value={form.budget} onChange={upd('budget')} />
            </label>
          </div>
          <label className="field">
            Описание
            <textarea className="textarea" value={form.description} onChange={upd('description')} rows={3} />
          </label>
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="small muted">Будет создана заметка в папке проектов</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={!form.title.trim() || m.isPending}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['project', path], queryFn: () => api.get<ProjectDetail>(`/api/project?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const fav = useFavorite();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const props = useMutation({
    mutationFn: (set: Record<string, unknown>) => api.patch('/api/note/properties', { path, set, unset: Object.keys(set).filter((k) => set[k] === null) }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const archive = useMutation({
    mutationFn: () => api.post<{ path: string }>('/api/note/archive', { path, confirmed: true }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast(`Проект перемещён в ${r.path}`);
      nav('/projects');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (!path) return <Empty title="Проект не выбран" action={<Link to="/projects" className="btn small">К проектам</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const today = health.data?.today ?? '';
  const open = p.tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const done = p.tasks.filter((t) => t.status === 'done');
  const groups = p.related.reduce<Record<string, typeof p.related>>((acc, r) => {
    (acc[r.type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="stack">
      <div className="row">
        <Link to="/projects" className="btn small ghost">
          <ArrowLeft size={14} /> Проекты
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{p.title}</h2>
                <div className="small muted">{p.path}</div>
              </div>
              <button className="btn small icon" aria-label={p.favorite ? 'Убрать из избранного' : 'В избранное'} onClick={() => fav.mutate({ path, favorite: !p.favorite })}>
                <Star size={14} fill={p.favorite ? 'currentColor' : 'none'} />
              </button>
              <Link className="btn small" to={noteHref(p.path)}>
                <FileText size={14} /> Заметка
              </Link>
            </div>
            <div style={{ margin: '16px 0 8px' }}>
              <Progress value={p.progress} tone="blue" />
            </div>
            <div className="small muted">
              {p.progress}% · задач {p.tasksDone}/{p.tasksTotal}
              {p.tasksOverdue > 0 && <span style={{ color: 'var(--red)' }}> · просрочено {p.tasksOverdue}</span>}
            </div>
            <div className="stat" style={{ marginTop: 14 }}>
              <div className="l">Следующий шаг</div>
              <div style={{ fontWeight: 500, marginTop: 2 }}>{p.nextStep ?? 'Не определён: добавьте задачу или свойство next в заметку'}</div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">Задачи</h3>
              <span className="card-sub">из заметки проекта и заметок в его папке</span>
            </div>
            {open.length === 0 ? <Empty title="Открытых задач нет" /> : <TaskList tasks={open} today={today} />}
            <AddTaskInline path={p.path} placeholder="Новая задача проекта…" />
            {done.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>
                  Выполнено · {done.length}
                </summary>
                <TaskList tasks={done} today={today} />
              </details>
            )}
          </section>

          {p.stages && (
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Этапы</h3>
              <div style={{ whiteSpace: 'pre-wrap' }}>{p.stages}</div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>Свойства</h3>
            <div className="stack" style={{ gap: 10 }}>
              <label className="field">
                Статус
                <select className="select" value={p.status} onChange={(e) => props.mutate({ status: e.target.value })} disabled={p.status === 'archived'}>
                  {['active', 'planned', 'paused', 'done'].map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                  {!['active', 'planned', 'paused', 'done'].includes(p.status) && <option value={p.status}>{STATUS_LABEL[p.status] ?? p.status}</option>}
                </select>
              </label>
              <label className="field">
                Срок
                <input type="date" className="input" value={p.deadline ?? ''} onChange={(e) => props.mutate({ deadline: e.target.value || null })} />
              </label>
              {p.goal && (
                <div className="small">
                  Цель: <Link to={noteHref(p.goal.path)}>{p.goal.title}</Link>
                </div>
              )}
              {p.area && <div className="small">Сфера: {p.area}</div>}
              {(p.budget !== null || p.spent !== null) && (
                <div className="stat">
                  <div className="l">Бюджет</div>
                  <div>
                    {(p.spent ?? 0).toLocaleString('ru-RU')} из {(p.budget ?? 0).toLocaleString('ru-RU')} ₽
                  </div>
                  {p.budget ? <Progress value={((p.spent ?? 0) / p.budget) * 100} /> : null}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Связи</h3>
            {p.related.length === 0 ? (
              <Empty title="Связей пока нет">Добавьте в заметку ссылки [[…]] на контакты, документы и заметки.</Empty>
            ) : (
              Object.entries(groups).map(([type, items]) => (
                <div key={type} style={{ marginBottom: 10 }}>
                  <div className="small muted" style={{ margin: '4px 10px' }}>{TYPE_LABEL[type] ?? type}</div>
                  <ul className="list">
                    {items.map((r) => (
                      <li key={r.path}>
                        <Link to={r.type === 'project' ? `/projects/view?path=${encodeURIComponent(r.path)}` : noteHref(r.path)}>
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

          {p.status !== 'archived' && (
            <section className="card">
              {!confirmArchive ? (
                <button className="btn small" onClick={() => setConfirmArchive(true)}>
                  <Archive size={14} /> Переместить в архив
                </button>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="small">Заметка будет перемещена в папку архива. Ничего не удаляется, ссылки по имени продолжат работать.</div>
                  <div className="row">
                    <button className="btn small primary" onClick={() => archive.mutate()} disabled={archive.isPending}>
                      Да, в архив
                    </button>
                    <button className="btn small ghost" onClick={() => setConfirmArchive(false)}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
