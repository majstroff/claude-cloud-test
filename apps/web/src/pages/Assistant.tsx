import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Briefcase, CalendarCheck, FileSearch, ListOrdered, ShieldCheck } from 'lucide-react';
import {
  api,
  type AssistantInfo,
  type DayPlan,
  type JobReport,
  type NextStep,
  type NoteTasksReport,
  type OverdueReport,
  type RelatedReport,
  type ScoredTask,
  type SearchResult,
} from '../api.ts';
import { ActionButton, Actions, ScoredList } from '../components/Assist.tsx';
import { Empty, ErrorBox, Loading, TYPE_LABEL, fmtDate, noteHref } from '../components/ui.tsx';

const TOOLS = [
  { id: 'plan', label: 'План дня', icon: CalendarCheck },
  { id: 'priorities', label: 'Приоритеты', icon: ListOrdered },
  { id: 'overdue', label: 'Просрочки', icon: AlarmClock },
  { id: 'job', label: 'Поиск работы', icon: Briefcase },
  { id: 'note', label: 'Заметка', icon: FileSearch },
] as const;
type Tool = (typeof TOOLS)[number]['id'];

const VACANCY_LABEL: Record<string, string> = {
  interesting: 'Интересные', applied: 'Отклик', response: 'Ответ', interview: 'Собеседование', test: 'Тестовое', offer: 'Оффер', rejected: 'Отказ', archived: 'Архив',
};

export function AssistantPage() {
  const [params, setParams] = useSearchParams();
  const tool = (TOOLS.find((t) => t.id === params.get('tool'))?.id ?? 'plan') as Tool;
  const info = useQuery({ queryKey: ['assistant', 'info'], queryFn: () => api.get<AssistantInfo>('/api/assistant') });
  return (
    <div className="stack">
      <div className="notice" style={{ background: 'var(--surface-2)' }}>
        <ShieldCheck size={18} style={{ flex: '0 0 auto', marginTop: 1 }} />
        <div className="small">
          {info.data?.note ?? 'Подсказки считаются на этом компьютере по вашим заметкам.'} Помощник только предлагает: срок, новая задача или приоритеты
          меняются, когда вы нажмёте кнопку. Документы и заметки с пометкой sensitive он не читает.
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setParams({ tool: t.id })}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tool === 'plan' && <Plan />}
      {tool === 'priorities' && <Priorities />}
      {tool === 'overdue' && <Overdue />}
      {tool === 'job' && <Job />}
      {tool === 'note' && <NoteTool path={params.get('path')} onPath={(p) => setParams({ tool: 'note', path: p })} />}
    </div>
  );
}

function useToday() {
  const h = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  return h.data?.today ?? '';
}

function Plan() {
  const today = useToday();
  const [date, setDate] = useState<string | null>(null);
  const d = date ?? today;
  const q = useQuery({ queryKey: ['assistant', 'plan', d], queryFn: () => api.get<DayPlan>(`/api/assistant/plan?date=${d}`), enabled: !!d });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  const p = q.data;
  const tomorrow = today && d === today;
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">План на {fmtDate(p.date, true)}</h2>
            <div className="tabs">
              <button className={d === today ? 'on' : ''} onClick={() => setDate(null)}>
                Сегодня
              </button>
              <button
                className={d !== today ? 'on' : ''}
                onClick={() => {
                  const t = new Date(`${today}T12:00:00`);
                  t.setDate(t.getDate() + 1);
                  setDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
                }}
              >
                Завтра
              </button>
            </div>
          </div>
          {p.warnings.map((w) => (
            <div key={w} className="error-box" style={{ marginBottom: 10, background: 'var(--amber-soft)' }}>
              {w}
            </div>
          ))}
          <h3 className="card-title" style={{ fontSize: 14, margin: '4px 0 6px' }}>Главное (три дела)</h3>
          <ScoredList items={p.focus} today={today} empty="Нет подходящих задач" />
          {p.more.length > 0 && (
            <>
              <h3 className="card-title" style={{ fontSize: 14, margin: '14px 0 6px' }}>Если останется время</h3>
              <ScoredList items={p.more} today={today} />
            </>
          )}
          {p.overload.length > 0 && (
            <>
              <h3 className="card-title" style={{ fontSize: 14, margin: '14px 0 6px' }}>Не поместится — предлагаю перенести</h3>
              <ScoredList items={p.overload} today={today} />
            </>
          )}
        </section>
      </div>
      <div className="stack">
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Приоритеты дня</h2>
          {p.prioritiesText ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit' }}>{p.prioritiesText}</pre> : <div className="small muted">Предложить нечего.</div>}
          {p.currentPriorities && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Сейчас записано: {p.currentPriorities.split('\n').filter(Boolean).length} строк.
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            {p.actions.map((a) => (
              <ActionButton key={a.label} action={a} primary />
            ))}
            <Link className="btn small ghost" to={tomorrow ? '/today' : `/today?date=${p.date}`}>
              Открыть день
            </Link>
          </div>
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Обязательное</h2>
          {p.fixed.length === 0 ? (
            <div className="small muted">Событий, платежей и регулярных дел нет.</div>
          ) : (
            <ul className="list">
              {p.fixed.map((f, i) => (
                <li key={i}>
                  <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    {f.path ? <Link to={noteHref(f.path)}>{f.title}</Link> : <span>{f.title}</span>}
                    <span className="small muted">
                      {f.kind}
                      {f.time ? ` · ${f.time}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Priorities() {
  const today = useToday();
  const q = useQuery({ queryKey: ['assistant', 'priorities'], queryFn: () => api.get<{ items: ScoredTask[] }>('/api/assistant/priorities?limit=10') });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 4 }}>Что важнее всего сейчас</h2>
      <div className="small muted" style={{ marginBottom: 10 }}>
        Учитываются приоритет, сроки, дедлайны проектов, цели текущего 12-недельного цикла и поиск работы.
      </div>
      <ScoredList items={q.data.items} today={today} empty="Нет задач со сроком на ближайшие дни и важных задач без срока." />
    </section>
  );
}

function Overdue() {
  const today = useToday();
  const q = useQuery({ queryKey: ['assistant', 'overdue'], queryFn: () => api.get<OverdueReport>('/api/assistant/overdue') });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  const o = q.data;
  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 6 }}>Разбор просрочек</h2>
        {o.summary.map((s) => (
          <div key={s}>{s}</div>
        ))}
      </section>
      {o.total === 0 ? (
        <div className="card">
          <Empty title="Всё в срок">Просроченных задач нет.</Empty>
        </div>
      ) : (
        o.groups.map((g) => (
          <section key={g.id} className="card">
            <h3 className="card-title">
              {g.title} · {g.items.length}
            </h3>
            <div className="small muted" style={{ marginBottom: 8 }}>{g.hint}</div>
            <ScoredList items={g.items} today={today} />
          </section>
        ))
      )}
    </div>
  );
}

function Job() {
  const q = useQuery({ queryKey: ['assistant', 'job'], queryFn: () => api.get<JobReport>('/api/assistant/job') });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  const j = q.data;
  return (
    <div className="grid cols-3">
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 8 }}>Что сделать по поиску работы</h2>
        {j.advice.length === 0 ? (
          <Empty title="Срочного ничего нет" action={<Link className="btn small" to="/work">К вакансиям</Link>} />
        ) : (
          <ul className="list">
            {j.advice.map((a, i) => (
              <li key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: a.tone === 'warn' ? 'var(--amber)' : undefined }}>{a.title}</div>
                  <div className="small muted">
                    {a.reason}
                    {a.ref && (
                      <>
                        {' '}
                        <Link to={a.ref.href ?? noteHref(a.ref.path)}>Открыть</Link>
                      </>
                    )}
                  </div>
                  <Actions actions={a.actions} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 8 }}>Воронка</h2>
        {j.summary.map((s) => (
          <div key={s} className="small" style={{ marginBottom: 4 }}>
            {s}
          </div>
        ))}
        <ul className="list" style={{ marginTop: 8 }}>
          {Object.entries(j.funnel).map(([k, v]) => (
            <li key={k}>
              <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <span>{VACANCY_LABEL[k] ?? k}</span>
                <span>{v}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NoteTool({ path, onPath }: { path: string | null; onPath: (p: string) => void }) {
  const [text, setText] = useState('');
  const search = useQuery({
    queryKey: ['search', text],
    queryFn: () => api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(text)}&limit=8`),
    enabled: text.trim().length >= 2,
  });
  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 8 }}>Выберите заметку, проект, цель или вакансию</h2>
        <input className="input" placeholder="Начните вводить название…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск заметки" />
        {text.trim().length >= 2 && search.data && (
          <ul className="list" style={{ marginTop: 8 }}>
            {search.data.results.length === 0 && <li className="small muted">Ничего не найдено</li>}
            {search.data.results.map((r) => (
              <li key={r.path}>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    onPath(r.path);
                    setText('');
                  }}
                >
                  {r.note?.title ?? r.path} <span className="small muted">· {TYPE_LABEL[r.note?.type ?? ''] ?? 'Заметка'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {path ? <NoteReport path={path} /> : <div className="card"><Empty title="Заметка не выбрана">Помощник подскажет следующий шаг, найдёт в тексте дела и связанные записи.</Empty></div>}
    </div>
  );
}

function NoteReport({ path }: { path: string }) {
  const e = encodeURIComponent(path);
  const next = useQuery({ queryKey: ['assistant', 'next', path], queryFn: () => api.get<NextStep>(`/api/assistant/next-step?path=${e}`) });
  const tasks = useQuery({ queryKey: ['assistant', 'note-tasks', path], queryFn: () => api.get<NoteTasksReport>(`/api/assistant/note-tasks?path=${e}`) });
  const related = useQuery({ queryKey: ['assistant', 'related', path], queryFn: () => api.get<RelatedReport>(`/api/assistant/related?path=${e}`) });
  if (next.isError) return <ErrorBox error={next.error} />;
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Следующий шаг</h2>
            <Link to={noteHref(path)} className="card-sub">
              {tasks.data?.title ?? 'открыть заметку'}
            </Link>
          </div>
          {next.isPending ? (
            <Loading rows={2} />
          ) : (
            <div>
              <div style={{ fontWeight: 600, color: next.data.tone === 'warn' ? 'var(--amber)' : undefined }}>{next.data.title}</div>
              <div className="small muted">{next.data.reason}</div>
              <Actions actions={next.data.actions} />
            </div>
          )}
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Дела в тексте</h2>
          {tasks.isError ? (
            <ErrorBox error={tasks.error} />
          ) : tasks.isPending ? (
            <Loading rows={3} />
          ) : tasks.data.candidates.length === 0 ? (
            <div className="small muted">Строк, похожих на дела, не нашлось. Помощник ищет строки, которые начинаются с действия («позвонить», «купить»…) или со слов «надо», «нужно», TODO.</div>
          ) : (
            <ul className="list">
              {tasks.data.candidates.map((c, i) => (
                <li key={c.line}>
                  <div style={{ flex: 1 }}>
                    <div>
                      {c.text}
                      {c.due && <span className="small muted"> · {fmtDate(c.due)}</span>}
                    </div>
                    <div className="small muted">Строка: «{c.source}»</div>
                    <Actions actions={[tasks.data.actions[i]!]} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 8 }}>Связанные записи</h2>
        {related.isError ? (
          <ErrorBox error={related.error} />
        ) : related.isPending ? (
          <Loading rows={4} />
        ) : related.data.items.length === 0 ? (
          <div className="small muted">Связей не найдено.</div>
        ) : (
          <ul className="list">
            {related.data.items.map((r) => (
              <li key={r.note.path}>
                <div>
                  <Link to={noteHref(r.note.path)}>{r.note.title}</Link>
                  <div className="small muted">{r.reasons.join(' · ')}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
