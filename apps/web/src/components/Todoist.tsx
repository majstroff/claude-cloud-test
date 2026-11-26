import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calendar, Check, CloudOff, ExternalLink, FileText, Flag, RefreshCw, Repeat, Send } from 'lucide-react';
import { ApiError, api, type Health, type TaskDTO } from '../api.ts';
import { Empty, ErrorBox, Loading, noteHref, relDate, useToast } from './ui.tsx';

/** Задача Todoist в том виде, как её отдаёт /api/todoist (локальная копия @frame-os/todoist). */
export interface TodoistTask {
  id: string;
  todoistId: string | null;
  title: string;
  notes: string;
  projectId: string | null;
  labels: string[];
  priority: 1 | 2 | 3 | 4;
  due: { date: string; datetime: string | null; string: string | null; recurring: boolean } | null;
  completed: boolean;
  syncState: 'synced' | 'pending' | 'conflict' | 'error' | 'remote_deleted';
  syncError: { code: string; message: string } | null;
  conflictRemote: TodoistTask | null;
  obsidianPath: string | null;
  url: string | null;
}

export interface TodoistProject {
  id: string;
  name: string;
  isInbox: boolean;
}

type IntegrationState = Health['integrations'][number];

export function useTodoistIntegration(): IntegrationState | null {
  const h = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  return h.data?.integrations.find((i) => i.id === 'todoist') ?? null;
}

const isReady = (i: IntegrationState | null) => !!i && (i.state === 'ok' || i.state === 'offline');

/** Блок Todoist для Главной и Today: просроченные и сегодняшние задачи, синхронизация, быстрый ввод. */
export function TodoistPanel({ today }: { today: string }) {
  const integration = useTodoistIntegration();
  const qc = useQueryClient();
  const toast = useToast();
  const ready = isReady(integration);
  const overdue = useQuery({
    queryKey: ['todoist', 'tasks', 'overdue'],
    queryFn: () => api.get<TodoistTask[]>('/api/todoist/tasks?view=overdue'),
    enabled: ready,
  });
  const todays = useQuery({
    queryKey: ['todoist', 'tasks', 'today'],
    queryFn: () => api.get<TodoistTask[]>('/api/todoist/tasks?view=today'),
    enabled: ready,
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ pulled: number; pushed: number }>('/api/todoist/sync', {}),
    onSuccess: (r) => toast(`Todoist: получено ${r.pulled}, отправлено ${r.pushed}`),
    onError: (e: Error) => toast(e.message, 'error'),
    onSettled: () => qc.invalidateQueries(),
  });

  if (!integration || integration.state === 'not_installed') return null;
  if (!ready) {
    return (
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Todoist</h2>
          <span className={`chip ${integration.state === 'error' ? 'red' : ''}`}>{integration.state === 'not_configured' ? 'Нужен ключ' : 'Ошибка'}</span>
        </div>
        <div className="small muted">{integration.message}</div>
        <div className="small" style={{ marginTop: 8 }}>
          <Link to="/settings">Настройки интеграций</Link>
        </div>
      </section>
    );
  }

  const list = [...(overdue.data ?? []), ...(todays.data ?? [])];
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          Todoist {integration.state === 'offline' && <CloudOff size={14} aria-label="Нет связи" />}
        </h2>
        <button className="btn small ghost" onClick={() => sync.mutate()} disabled={sync.isPending} title="Синхронизировать с Todoist">
          <RefreshCw size={14} className={sync.isPending ? 'spin' : ''} /> {sync.isPending ? 'Синхронизация…' : 'Синхронизировать'}
        </button>
      </div>
      {integration.state === 'offline' && <div className="small muted" style={{ marginBottom: 8 }}>{integration.message}. Изменения сохраняются и уйдут позже.</div>}
      {overdue.isPending || todays.isPending ? (
        <Loading rows={3} />
      ) : overdue.isError || todays.isError ? (
        <ErrorBox error={overdue.error ?? todays.error} onRetry={() => void qc.invalidateQueries({ queryKey: ['todoist'] })} />
      ) : list.length === 0 ? (
        <Empty title="В Todoist на сегодня пусто">Задачи появятся после синхронизации. Добавить можно ниже.</Empty>
      ) : (
        <ul className="tasks">
          {list.map((t) => (
            <TodoistItem key={t.id} task={t} today={today} />
          ))}
        </ul>
      )}
      <TodoistQuickAdd />
    </section>
  );
}

const PRIO: Record<number, { label: string; tone: string } | undefined> = {
  4: { label: 'P1', tone: 'red' },
  3: { label: 'P2', tone: 'amber' },
  2: { label: 'P3', tone: 'blue' },
};

function TodoistItem({ task, today }: { task: TodoistTask; today: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (op: { path: string; body?: unknown }) => api.post<TodoistTask>(`/api/todoist/tasks/${encodeURIComponent(task.id)}${op.path}`, op.body ?? {}),
    onError: (e: Error) => toast(e.message, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['todoist'] }),
  });
  const date = task.due?.date || null;
  const prio = PRIO[task.priority];
  return (
    <li className={`task ${task.completed ? 'done' : ''} ${m.isPending ? 'busy' : ''}`}>
      <button
        className={`check ${task.priority === 4 ? 'p-high' : task.priority === 3 ? 'p-medium' : ''}`}
        aria-label={task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
        title={task.due?.recurring ? 'Выполнено (перенесётся на следующую дату)' : 'Выполнено'}
        onClick={() => m.mutate({ path: task.completed ? '/reopen' : '/complete' })}
        disabled={task.syncState === 'conflict'}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="t-body">
        <div className="t-title">{task.title}</div>
        <div className="t-meta">
          {date && (
            <span className={`chip ${date < today ? 'red' : date === today ? 'blue' : ''}`}>
              <Calendar size={11} /> {relDate(date, today)}
              {task.due?.datetime ? ` ${task.due.datetime.slice(11, 16)}` : ''}
            </span>
          )}
          {task.due?.recurring && (
            <span className="chip">
              <Repeat size={11} /> {task.due.string}
            </span>
          )}
          {prio && (
            <span className={`chip ${prio.tone}`}>
              <Flag size={11} /> {prio.label}
            </span>
          )}
          {task.labels.map((l) => (
            <span key={l} className="chip">
              @{l}
            </span>
          ))}
          {task.syncState === 'pending' && <span className="chip amber">ждёт отправки</span>}
          {task.syncState === 'error' && (
            <span className="chip red" title={task.syncError?.message}>
              <AlertTriangle size={11} /> не принято Todoist
            </span>
          )}
          {task.obsidianPath && (
            <Link to={noteHref(task.obsidianPath)} className="muted" title={task.obsidianPath}>
              <FileText size={11} /> заметка
            </Link>
          )}
          {task.url && (
            <a href={task.url} target="_blank" rel="noreferrer" className="muted">
              <ExternalLink size={11} /> Todoist
            </a>
          )}
        </div>
        {task.syncState === 'conflict' && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small">Задачу изменили и здесь, и в Todoist{task.conflictRemote ? ` («${task.conflictRemote.title}»)` : ''}.</span>
            <button className="btn small" onClick={() => m.mutate({ path: '/resolve', body: { keep: 'local' } })}>
              Оставить эту версию
            </button>
            <button className="btn small" onClick={() => m.mutate({ path: '/resolve', body: { keep: 'remote' } })}>
              Взять из Todoist
            </button>
          </div>
        )}
        {task.syncState === 'error' && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small" style={{ color: 'var(--red)' }}>{task.syncError?.message}</span>
            <button className="btn small" onClick={() => m.mutate({ path: '/retry' })}>
              Отправить снова
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function TodoistQuickAdd() {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [due, setDue] = useState('сегодня');
  const m = useMutation({
    mutationFn: () => api.post<TodoistTask>('/api/todoist/tasks', { content: text, ...(due.trim() ? { due_string: due.trim(), due_lang: 'ru' } : {}) }),
    onSuccess: (t) => {
      setText('');
      if (t.syncState === 'pending') toast('Нет связи с Todoist: задача сохранена и будет отправлена позже');
    },
    onError: (e: Error) => toast(e.message, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['todoist'] }),
  });
  return (
    <form
      className="row"
      style={{ marginTop: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) m.mutate();
      }}
    >
      <input className="input" style={{ flex: 2, minWidth: 140 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Новая задача в Todoist…" aria-label="Новая задача в Todoist" disabled={m.isPending} />
      <input className="input" style={{ flex: 1, minWidth: 100 }} value={due} onChange={(e) => setDue(e.target.value)} placeholder="Срок: завтра, каждый пн…" aria-label="Срок в Todoist" disabled={m.isPending} />
      <button className="btn" type="submit" disabled={!text.trim() || m.isPending}>
        В Todoist
      </button>
    </form>
  );
}

/** Выбор проекта Todoist для отправки из бэклога. */
export function useTodoistProjects(enabled: boolean) {
  return useQuery({ queryKey: ['todoist', 'projects'], queryFn: () => api.get<TodoistProject[]>('/api/todoist/projects'), enabled });
}

/** Кнопка «В Todoist» у задачи бэклога Obsidian. */
export function SendToTodoistButton({ task, projectId }: { task: TaskDTO; projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () =>
      api.post<{ todoist: TodoistTask; warning?: string }>('/api/todoist/backlog/send-vault-task', {
        path: task.path,
        line: task.line,
        raw: task.raw,
        projectId: projectId || undefined,
      }),
    onSuccess: (r) => toast(r.warning ?? `«${r.todoist.title}» отправлена в Todoist`, r.warning ? 'error' : 'info'),
    onError: (e: Error) => toast(e instanceof ApiError && e.status === 409 ? e.message : `Не отправлено: ${e.message}`, 'error'),
    onSettled: () => qc.invalidateQueries(),
  });
  return (
    <button className="btn small" onClick={() => m.mutate()} disabled={m.isPending} title="Отправить задачу в Todoist и пометить строку в заметке" aria-label="Отправить в Todoist">
      <Send size={13} /> <span className="lbl">{m.isPending ? 'Отправка…' : 'В Todoist'}</span>
    </button>
  );
}

export { isReady as isTodoistReady };
