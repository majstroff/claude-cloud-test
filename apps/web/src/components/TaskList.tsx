import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, Flag, FileText, Repeat, X } from 'lucide-react';
import { api, type Priority, type TaskDTO } from '../api.ts';
import { addDaysIso, noteHref, relDate, useToast } from './ui.tsx';

type Action =
  | { action: 'complete' }
  | { action: 'reopen' }
  | { action: 'setDue'; due: string | null }
  | { action: 'setPriority'; priority: Priority };

export function useTaskAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ task, change }: { task: TaskDTO; change: Action }) =>
      api.patch<{ task: TaskDTO }>('/api/tasks', { path: task.path, line: task.line, raw: task.raw, ...change }),
    onSuccess: () => qc.invalidateQueries(),
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

export function TaskItem({ task, today, showSource = true }: { task: TaskDTO; today: string; showSource?: boolean }) {
  const m = useTaskAction();
  const [menu, setMenu] = useState<null | 'date' | 'prio'>(null);
  const [customDate, setCustomDate] = useState(task.due ?? '');
  const done = task.status === 'done';
  const overdue = !done && task.date !== null && task.date < today;
  const run = (change: Action) => {
    setMenu(null);
    m.mutate({ task, change });
  };
  return (
    <li className={`task ${done ? 'done' : ''} ${m.isPending ? 'busy' : ''}`}>
      <button
        className={`check p-${task.priority}`}
        aria-label={done ? 'Вернуть в работу' : 'Отметить выполненной'}
        title={done ? 'Вернуть в работу' : 'Выполнено'}
        onClick={() => run(done ? { action: 'reopen' } : { action: 'complete' })}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="t-body">
        <div className="t-title">{task.title || <span className="muted">(без текста)</span>}</div>
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
      {!done && (
        <div className="t-actions">
          <button className="btn small icon ghost" title="Срок" aria-label="Изменить срок" onClick={() => setMenu(menu === 'date' ? null : 'date')}>
            {menu === 'date' ? <X size={14} /> : <Calendar size={14} />}
          </button>
          <button className="btn small icon ghost" title="Приоритет" aria-label="Изменить приоритет" onClick={() => setMenu(menu === 'prio' ? null : 'prio')}>
            {menu === 'prio' ? <X size={14} /> : <Flag size={14} />}
          </button>
          <Link className="btn small icon ghost" title="Открыть заметку" aria-label="Открыть заметку" to={noteHref(task.path)}>
            <FileText size={14} />
          </Link>
        </div>
      )}
    </li>
  );
}

export function TaskList({ tasks, today, showSource }: { tasks: TaskDTO[]; today: string; showSource?: boolean }) {
  return (
    <ul className="tasks">
      {tasks.map((t) => (
        <TaskItem key={`${t.id}:${t.raw}`} task={t} today={today} showSource={showSource} />
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
