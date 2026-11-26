import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Calendar, Check, CircleAlert, Info, ListPlus, ListOrdered, ThumbsUp } from 'lucide-react';
import { api, type AssistantAction, type Insight, type ScoredTask } from '../api.ts';
import { fmtDate, noteHref, relDate, useToast } from './ui.tsx';

function run(a: AssistantAction): Promise<unknown> {
  switch (a.kind) {
    case 'set_due':
      return api.patch('/api/tasks', { path: a.path, line: a.line, raw: a.raw, action: 'setDue', due: a.due });
    case 'create_task':
      return api.post('/api/tasks', { text: a.text, due: a.due, path: a.path, section: a.section });
    case 'write_priorities':
      return api.put('/api/day/section', { date: a.date, section: 'priorities', content: a.text });
    case 'open':
      return Promise.resolve();
  }
}

function doneText(a: AssistantAction): string {
  switch (a.kind) {
    case 'set_due':
      return a.due ? `Срок: ${fmtDate(a.due)}` : 'Срок убран';
    case 'create_task':
      return a.due ? `Задача создана на ${fmtDate(a.due)}` : 'Задача создана';
    case 'write_priorities':
      return 'Приоритеты записаны в ежедневную заметку';
    default:
      return 'Готово';
  }
}

/**
 * Кнопка предложения помощника. Изменение выполняется только по нажатию;
 * замена уже записанного (приоритеты дня) требует второго нажатия.
 */
export function ActionButton({ action, primary }: { action: AssistantAction; primary?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => run(action),
    onSuccess: () => {
      toast(doneText(action));
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  if (action.kind === 'open') {
    return (
      <Link className="btn small" to={action.href}>
        {action.label} <ArrowRight size={14} />
      </Link>
    );
  }
  if (m.isSuccess) {
    return (
      <span className="chip green">
        <Check size={12} /> {doneText(action)}
      </span>
    );
  }
  const needsConfirm = action.kind === 'write_priorities' && action.label.startsWith('Заменить');
  const icon = action.kind === 'set_due' ? <Calendar size={14} /> : action.kind === 'create_task' ? <ListPlus size={14} /> : <ListOrdered size={14} />;
  if (needsConfirm && confirm) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <span className="small muted">Текущие приоритеты будут заменены.</span>
        <button className="btn small primary" disabled={m.isPending} onClick={() => m.mutate()}>
          Да, заменить
        </button>
        <button className="btn small ghost" onClick={() => setConfirm(false)}>
          Отмена
        </button>
      </span>
    );
  }
  return (
    <button className={`btn small ${primary ? 'primary' : ''}`} disabled={m.isPending} onClick={() => (needsConfirm ? setConfirm(true) : m.mutate())}>
      {icon} {action.label}
    </button>
  );
}

export function Actions({ actions }: { actions: AssistantAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="row" style={{ gap: 6, marginTop: 6 }}>
      {actions.map((a, i) => (
        <ActionButton key={`${a.kind}-${a.label}-${i}`} action={a} />
      ))}
    </div>
  );
}

/** Задача с оценкой важности и причинами. */
export function ScoredList({ items, today, empty }: { items: ScoredTask[]; today: string; empty?: string }) {
  if (!items.length) return <div className="small muted">{empty ?? 'Нет задач'}</div>;
  return (
    <ul className="list">
      {items.map((s) => (
        <li key={s.task.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{s.task.title}</span>
              <span className="small muted">{s.task.date ? relDate(s.task.date, today) : 'без срока'}</span>
            </div>
            <div className="small muted">
              <Link to={noteHref(s.task.path)}>{s.task.project?.title ?? s.task.noteTitle}</Link>
              {s.reasons.length > 0 && <> · {s.reasons.join(', ')}</>}
            </div>
            <Actions actions={s.actions} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return <div className="small muted">Данных за период пока мало для выводов.</div>;
  return (
    <ul className="list">
      {items.map((i, k) => (
        <li key={k}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'nowrap' }}>
            <span style={{ color: i.tone === 'good' ? 'var(--green)' : i.tone === 'warn' ? 'var(--amber)' : 'var(--text-3)', marginTop: 2 }}>
              {i.tone === 'good' ? <ThumbsUp size={14} /> : i.tone === 'warn' ? <CircleAlert size={14} /> : <Info size={14} />}
            </span>
            <span style={{ flex: 1 }}>{i.text}</span>
            {i.href && (
              <Link to={i.href} className="small">
                Открыть
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
