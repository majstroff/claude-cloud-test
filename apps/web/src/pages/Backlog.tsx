import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { api, type Health, type TaskDTO } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading } from '../components/ui.tsx';
import { SendToTodoistButton, isTodoistReady, useTodoistProjects } from '../components/Todoist.tsx';

/**
 * Бэклог — открытые задачи без даты из всех заметок хранилища (кроме архива).
 * Кнопка «В Todoist» отправляет задачу в выбранный проект Todoist и помечает строку
 * в заметке меткой [todoist:: id]; такие задачи дальше ведутся в Todoist.
 */
export function BacklogPage() {
  const q = useQuery({ queryKey: ['tasks', 'backlog'], queryFn: () => api.get<{ tasks: TaskDTO[] }>('/api/tasks?view=backlog') });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [prio, setPrio] = useState('');
  const [tag, setTag] = useState('');
  const today = health.data?.today ?? '';
  const todoist = health.data?.integrations.find((i) => i.id === 'todoist') ?? null;
  const todoistReady = isTodoistReady(todoist);
  const projects = useTodoistProjects(todoistReady);
  const [todoistProject, setTodoistProject] = useState('');
  const sendButton = todoistReady ? (t: TaskDTO) => <SendToTodoistButton task={t} projectId={todoistProject} /> : undefined;

  const tasks = q.data?.tasks ?? [];
  const sources = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      const key = t.project?.path ?? t.path;
      m.set(key, t.project?.title ?? t.noteTitle);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks]);

  const filtered = tasks.filter(
    (t) =>
      (!text.trim() || t.title.toLowerCase().includes(text.trim().toLowerCase())) &&
      (!source || (t.project?.path ?? t.path) === source) &&
      (!prio || (prio === 'set' ? t.priority !== 'none' : t.priority === prio)) &&
      (!tag || t.tags.includes(tag)),
  );

  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const grouped = new Map<string, { title: string; tasks: TaskDTO[] }>();
  for (const t of filtered) {
    const key = t.project?.path ?? t.path;
    const g = grouped.get(key) ?? { title: t.project?.title ?? t.noteTitle, tasks: [] };
    g.tasks.push(t);
    grouped.set(key, g);
  }

  return (
    <div className="grid cols-3">
      <div className="stack">
        <div className="filters">
          <input className="input" placeholder="Поиск по задачам" value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск по задачам" />
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Проект или заметка">
            <option value="">Все проекты и заметки</option>
            {sources.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="select" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Приоритет">
            <option value="">Любой приоритет</option>
            <option value="set">С приоритетом</option>
            <option value="high">Высокий</option>
            <option value="medium">Средний</option>
            <option value="low">Низкий</option>
          </select>
          {tags.length > 0 && (
            <select className="select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Тег">
              <option value="">Все теги</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
          {todoistReady && (
            <select className="select" value={todoistProject} onChange={(e) => setTodoistProject(e.target.value)} aria-label="Проект Todoist для отправки">
              <option value="">В Todoist: Входящие</option>
              {(projects.data ?? [])
                .filter((p) => !p.isInbox)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    В Todoist: {p.name}
                  </option>
                ))}
            </select>
          )}
          <span className="small muted">
            {filtered.length} из {tasks.length}
          </span>
        </div>
        {tasks.length === 0 ? (
          <div className="card">
            <Empty icon={<Inbox size={18} />} title="Бэклог пуст">
              Здесь собираются открытые задачи без даты из всех заметок Obsidian.
            </Empty>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <Empty title="Нет задач по этим фильтрам" />
          </div>
        ) : (
          [...grouped.entries()].map(([key, g]) => (
            <section key={key} className="card">
              <div className="card-head">
                <h3 className="card-title">{g.title}</h3>
                <span className="card-sub">{g.tasks.length}</span>
              </div>
              <TaskList tasks={g.tasks} today={today} showSource={false} extra={sendButton} />
            </section>
          ))
        )}
      </div>
      <div className="stack">
        <section className="card">
          <h3 className="card-title" style={{ marginBottom: 6 }}>Записать в бэклог</h3>
          <div className="small muted">Задача без даты попадёт в сегодняшнюю ежедневную заметку.</div>
          <AddTaskInline placeholder="Что сделать когда-нибудь…" />
        </section>
        <section className="card small">
          <strong>Как разбирать бэклог</strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            Назначьте срок кнопкой календаря у задачи, и она уйдёт в <Link to="/today">Today</Link>. Если задача больше не нужна, отметьте её выполненной или
            удалите строку в Obsidian.
          </p>
          {todoistReady ? (
            <p className="muted">
              «В Todoist» отправляет задачу в выбранный проект и ставит в заметке метку <code>[todoist:: id]</code>. Когда задачу закроют в Todoist, она
              отметится выполненной и в Obsidian.
            </p>
          ) : (
            todoist && todoist.state !== 'not_installed' && <p className="muted">Todoist: {todoist.message}.</p>
          )}
        </section>
      </div>
    </div>
  );
}
