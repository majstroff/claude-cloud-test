import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, Flag, FileText, Pencil, Repeat, Trash2, X } from 'lucide-react';
import { api, type Priority, type TaskDTO } from '../api.ts';
import { addDaysIso, noteHref, relDate, useToast } from './ui.tsx';

type Action =
  | { action: 'complete' }
  | { action: 'reopen' }
  | { action: 'setDue'; due: string | null }
  | { action: 'setPriority'; priority: Priority }
  | { action: 'rename'; text: string };

export function useTaskAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ task, change }: { task: TaskDTO; change: Action }) =>
      api.patch<{ task: TaskDTO }>('/api/tasks', { path: task.path, line: task.line, raw: task.raw, ...change }),
    onSuccess: (r, { task, change }) => {
      void qc.invalidateQueries();
      if (change.action !== 'complete') return;
      const doneTask = r.task.status === 'done' ? r.task : null;
      toast(
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span>
            Выполнено: «{task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}»{r.task.status !== 'done' ? '. Создано следующее повторение' : ''}
          </span>
          {doneTask && (
            <button
              className="btn small"
              onClick={() =>
                // Строка могла уже исчезнуть из списка, поэтому вызываем API напрямую.
                void api
                  .patch('/api/tasks', { path: doneTask.path, line: doneTask.line, raw: doneTask.raw, action: 'reopen' })
                  .then(() => toast('Задача снова в работе'))
                  .catch((e: Error) => toast(e.message, 'error'))
                  .finally(() => void qc.invalidateQueries())
              }
            >
              Отменить
            </button>
          )}
        </span>,
        'info',
        7000,
      );
    },
    onError: (e: Error) => {
      toast(e.message, 'error');
      void qc.invalidateQueries();
    },
  });
}

/** Правило повтора из Obsidian Tasks (every week) — по-русски. */
export function recurrenceRu(rule: string): string {
  const r = rule.trim().toLowerCase();
  const whenDone = /\s+when done$/.test(r);
  const m = /^every\s+(\d+\s+)?(day|days|week|weeks|month|months|year|years)(\s+when done)?$/.exec(r);
  if (!m) return rule;
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2]!.replace(/s$/, '');
  const forms: Record<string, [string, string, string, string]> = {
    day: ['каждый день', 'дня', 'дня', 'дней'],
    week: ['каждую неделю', 'недели', 'недели', 'недель'],
    month: ['каждый месяц', 'месяца', 'месяца', 'месяцев'],
    year: ['каждый год', 'года', 'года', 'лет'],
  };
  const f = forms[unit]!;
  let text: string;
  if (n === 1) text = f[0];
  else {
    const m10 = n % 10, m100 = n % 100;
    const word = m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? f[2] : f[3];
    text = `раз в ${n} ${word}`;
  }
  return whenDone ? `${text} после выполнения` : text;
}

const PRIO_LABEL: Record<Priority, string> = {
  highest: 'Срочно',
  high: 'Высокий',
  medium: 'Средний',
  none: 'Без приоритета',
  low: 'Низкий',
  lowest: 'Самый низкий',
};

/** Удаление задачи с подтверждением и «Отменить» в уведомлении. */
function useDeleteTask() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (task: TaskDTO) => api.post<{ deleted: { path: string; line: number; raw: string } }>('/api/tasks/delete', { path: task.path, line: task.line, raw: task.raw }),
    onSuccess: ({ deleted }, task) => {
      void qc.invalidateQueries();
      toast(
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span>Задача удалена: «{task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}»</span>
          <button
            className="btn small"
            onClick={() =>
              void api
                .post('/api/tasks/restore', deleted)
                .then(() => toast('Задача возвращена'))
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
      void qc.invalidateQueries();
    },
  });
}

export function TaskItem({ task, today, showSource = true, extra }: { task: TaskDTO; today: string; showSource?: boolean; extra?: (t: TaskDTO) => ReactNode }) {
  const m = useTaskAction();
  const del = useDeleteTask();
  const [menu, setMenu] = useState<null | 'date' | 'prio' | 'edit' | 'delete'>(null);
  const [draft, setDraft] = useState(task.title);
  const [customDate, setCustomDate] = useState(task.due ?? '');
  const done = task.status === 'done';
  const overdue = !done && task.date !== null && task.date < today;
  const run = (change: Action) => {
    setMenu(null);
    m.mutate({ task, change });
  };
  return (
    <li className={`task ${done ? 'done' : ''} ${m.isPending || del.isPending ? 'busy' : ''}`}>
      <button
        className={`check p-${task.priority}`}
        aria-label={done ? 'Вернуть в работу' : 'Отметить выполненной'}
        title={done ? 'Вернуть в работу' : 'Выполнено'}
        onClick={() => run(done ? { action: 'reopen' } : { action: 'complete' })}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="t-body">
        {menu === 'edit' ? (
          <form
            className="row"
            style={{ gap: 6, flexWrap: 'nowrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() && draft.trim() !== task.title) run({ action: 'rename', text: draft });
              else setMenu(null);
            }}
          >
            <input
              className="input"
              style={{ flex: 1, height: 32 }}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setMenu(null)}
              aria-label="Текст задачи"
            />
            <button className="btn small primary" type="submit" disabled={!draft.trim()}>
              Сохранить
            </button>
            <button className="btn small ghost" type="button" onClick={() => setMenu(null)}>
              Отмена
            </button>
          </form>
        ) : (
          <div className="t-title">{task.title || <span className="muted">(без текста)</span>}</div>
        )}
        {menu === 'delete' && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small muted">Удалить задачу из заметки?</span>
            <button className="btn small danger" disabled={del.isPending} onClick={() => del.mutate(task)}>
              Да, удалить
            </button>
            <button className="btn small ghost" onClick={() => setMenu(null)}>
              Нет
            </button>
          </div>
        )}
        <div className="t-meta">
          {task.date && (
            <span className={`chip ${overdue ? 'red' : task.date === today ? 'blue' : ''}`}>
              <Calendar size={11} /> {relDate(task.date, today)}
            </span>
          )}
          {task.priority !== 'none' && (
            <span className={`chip ${task.priority === 'high' || task.priority === 'highest' ? 'red' : task.priority === 'medium' ? 'amber' : ''}`}>
              <Flag size={11} /> {PRIO_LABEL[task.priority]}
            </span>
          )}
          {task.recurrence && (
            <span className="chip">
              <Repeat size={11} /> {recurrenceRu(task.recurrence)}
            </span>
          )}
          {showSource && (
            <Link to={task.project ? `/projects/view?path=${encodeURIComponent(task.project.path)}` : noteHref(task.path)} className="muted" title={task.path}>
              {task.project ? task.project.title : task.noteType === 'daily' ? 'Дневник' : task.noteTitle}
            </Link>
          )}
        </div>
        {menu === 'date' && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => run({ action: 'setDue', due: today })}>
              Сегодня
            </button>
            <button className="btn small" onClick={() => run({ action: 'setDue', due: addDaysIso(today, 1) })}>
              Завтра
            </button>
            <button className="btn small" onClick={() => run({ action: 'setDue', due: addDaysIso(today, 7) })}>
              Через неделю
            </button>
            <input
              type="date"
              className="input"
              style={{ width: 150, height: 28, padding: '0 8px' }}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              aria-label="Дата"
            />
            <button className="btn small primary" disabled={!customDate} onClick={() => run({ action: 'setDue', due: customDate })}>
              Применить
            </button>
            {task.due && (
              <button className="btn small ghost" onClick={() => run({ action: 'setDue', due: null })}>
                Убрать срок
              </button>
            )}
          </div>
        )}
        {menu === 'prio' && (
          <div className="row" style={{ marginTop: 8 }}>
            {(['high', 'medium', 'low', 'none'] as Priority[]).map((p) => (
              <button key={p} className={`btn small ${task.priority === p ? 'primary' : ''}`} onClick={() => run({ action: 'setPriority', priority: p })}>
                {PRIO_LABEL[p]}
              </button>
            ))}
          </div>
        )}
      </div>
      {!done && extra && <div className="t-side">{extra(task)}</div>}
      {done && (
        <div className="t-actions">
          <button className="btn small icon ghost" title="Удалить" aria-label={`Удалить задачу: ${task.title}`} onClick={() => setMenu(menu === 'delete' ? null : 'delete')}>
            {menu === 'delete' ? <X size={14} /> : <Trash2 size={14} />}
          </button>
        </div>
      )}
      {!done && (
        <div className="t-actions">
          <button
            className="btn small icon ghost"
            title="Изменить текст"
            aria-label={`Изменить задачу: ${task.title}`}
            onClick={() => {
              setDraft(task.title);
              setMenu(menu === 'edit' ? null : 'edit');
            }}
          >
            {menu === 'edit' ? <X size={14} /> : <Pencil size={14} />}
          </button>
          <button className="btn small icon ghost" title="Срок" aria-label="Изменить срок" onClick={() => setMenu(menu === 'date' ? null : 'date')}>
            {menu === 'date' ? <X size={14} /> : <Calendar size={14} />}
          </button>
          <button className="btn small icon ghost" title="Приоритет" aria-label="Изменить приоритет" onClick={() => setMenu(menu === 'prio' ? null : 'prio')}>
            {menu === 'prio' ? <X size={14} /> : <Flag size={14} />}
          </button>
          <Link className="btn small icon ghost" title="Открыть заметку" aria-label="Открыть заметку" to={noteHref(task.path)}>
            <FileText size={14} />
          </Link>
          <button className="btn small icon ghost" title="Удалить" aria-label={`Удалить задачу: ${task.title}`} onClick={() => setMenu(menu === 'delete' ? null : 'delete')}>
            {menu === 'delete' ? <X size={14} /> : <Trash2 size={14} />}
          </button>
        </div>
      )}
    </li>
  );
}

export function TaskList({ tasks, today, showSource, extra }: { tasks: TaskDTO[]; today: string; showSource?: boolean; extra?: (t: TaskDTO) => ReactNode }) {
  return (
    <ul className="tasks">
      {tasks.map((t) => (
        <TaskItem key={`${t.id}:${t.raw}`} task={t} today={today} showSource={showSource} extra={extra} />
      ))}
    </ul>
  );
}

/** Строка добавления задачи прямо в список (в ежедневную заметку или в заметку проекта). */
export function AddTaskInline({ path, due, placeholder }: { path?: string; due?: string; placeholder?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/api/tasks', { text, path: path ?? null, due: due ?? null }),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
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
      <input
        className="input"
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Новая задача…'}
        aria-label="Новая задача"
        disabled={m.isPending}
      />
      <button className="btn" type="submit" disabled={!text.trim() || m.isPending}>
        Добавить
      </button>
    </form>
  );
}
