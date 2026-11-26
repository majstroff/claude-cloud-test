import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, Moon, Sunrise } from 'lucide-react';
import { api, type DayData, type Health } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { MonthCalendar, useCalendar } from '../components/Calendar.tsx';
import { TodoistPanel } from '../components/Todoist.tsx';
import { MoonBadge, ObligationList, RoutineList } from '../components/Spheres.tsx';
import { WorkoutLine } from './Health.tsx';
import type { SpheresDay } from '../api.ts';
import { Empty, ErrorBox, Loading, WEEKDAYS_SHORT, addDaysIso, fmtDate, noteHref, parseIso, useToast } from '../components/ui.tsx';

type View = 'day' | 'week' | 'month';

export function TodayPage() {
  const [params, setParams] = useSearchParams();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const today = health.data?.today;
  const date = params.get('date') ?? today;
  const view = (params.get('view') as View) ?? 'day';
  const [anchor, setAnchor] = useState<string | null>(null);

  const set = (next: { date?: string; view?: View }) => {
    const p = new URLSearchParams(params);
    if (next.date) p.set('date', next.date);
    if (next.view) p.set('view', next.view);
    setParams(p, { replace: true });
  };

  if (health.isError) return <ErrorBox error={health.error} onRetry={() => health.refetch()} />;
  if (!today || !date) return <div className="card"><Loading /></div>;

  const step = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  return (
    <div className="stack">
      <div className="row">
        <div className="tabs" role="tablist" aria-label="Вид календаря">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => set({ view: v })} role="tab" aria-selected={view === v}>
              {v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
        <button className="btn small icon" aria-label="Назад" onClick={() => set({ date: addDaysIso(date, -step) })}>
          <ChevronLeft size={14} />
        </button>
        <button className="btn small" onClick={() => set({ date: today })} disabled={date === today}>
          Сегодня
        </button>
        <button className="btn small icon" aria-label="Вперёд" onClick={() => set({ date: addDaysIso(date, step) })}>
          <ChevronRight size={14} />
        </button>
        <strong style={{ marginLeft: 6 }}>{fmtDate(date, true)}</strong>
        <input type="date" className="input" style={{ width: 160, height: 30, padding: '0 8px' }} value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Выбрать дату" />
      </div>

      {view === 'week' && <WeekView date={date} today={today} onSelect={(d) => set({ date: d, view: 'day' })} />}
      {view === 'month' && (
        <section className="card">
          <MonthCalendar anchor={anchor ?? date} today={today} selected={date} onAnchor={setAnchor} onSelect={(d) => set({ date: d, view: 'day' })} />
        </section>
      )}
      <DayView date={date} today={today} />
    </div>
  );
}

function WeekView({ date, today, onSelect }: { date: string; today: string; onSelect: (d: string) => void }) {
  const dow = (parseIso(date).getDay() + 6) % 7;
  const from = addDaysIso(date, -dow);
  const cal = useCalendar(from, addDaysIso(from, 6));
  if (cal.isError) return <ErrorBox error={cal.error} onRetry={() => cal.refetch()} />;
  return (
    <div className="week">
      {(cal.data?.days ?? []).map((d, i) => (
        <button key={d.date} className={`col ${d.date === today ? 'today' : ''} ${d.date === date ? 'sel' : ''}`} onClick={() => onSelect(d.date)}>
          <div className="h">
            {WEEKDAYS_SHORT[i]} · {fmtDate(d.date)}
          </div>
          {d.items.length === 0 && <div className="small muted">—</div>}
          {d.items.map((it, j) => (
            <div key={j} className={`item ${it.kind} ${it.kind === 'task' && it.done ? 'done' : ''}`} title={it.title}>
              {it.kind === 'event' && it.time ? `${it.time} ` : ''}
              {it.title}
            </div>
          ))}
        </button>
      ))}
    </div>
  );
}

function DayView({ date, today }: { date: string; today: string }) {
  const q = useQuery({ queryKey: ['day', date], queryFn: () => api.get<DayData>(`/api/day?date=${date}`) });
  if (q.isPending) return <div className="card"><Loading rows={4} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const isPast = date < today;
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Sunrise size={16} /> Приоритеты
            </h2>
            <span className="card-sub">1–3 главных дела дня</span>
          </div>
          <SectionEditor date={date} section="priorities" value={d.priorities} placeholder={'1. Самое важное\n2. …'} rows={3} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Задачи {d.isToday ? 'на сегодня' : `на ${fmtDate(date)}`}</h2>
            <span className="card-sub">{d.planned.length} в плане · {d.done.length} сделано</span>
          </div>
          {d.overdue.length > 0 && (
            <>
              <div className="small" style={{ color: 'var(--red)', fontWeight: 600, margin: '4px 8px' }}>
                Просрочено · {d.overdue.length}
              </div>
              <TaskList tasks={d.overdue} today={today} />
              <div style={{ height: 8 }} />
            </>
          )}
          {d.planned.length === 0 ? (
            <Empty title={isPast ? 'В этот день задач не было' : 'Задач на этот день нет'}>
              {isPast ? 'Выполненные задачи этого дня показаны ниже.' : 'Добавьте задачу или перенесите её из бэклога.'}
            </Empty>
          ) : (
            <TaskList tasks={d.planned} today={today} />
          )}
          <AddTaskInline due={date} placeholder={`Задача на ${d.isToday ? 'сегодня' : fmtDate(date)}…`} />
          {d.dailyTasks.length > 0 && (
            <>
              <div className="small muted" style={{ margin: '16px 8px 4px' }}>Без срока в ежедневной заметке</div>
              <TaskList tasks={d.dailyTasks} today={today} showSource={false} />
            </>
          )}
          {d.done.length > 0 && (
            <>
              <div className="small muted" style={{ margin: '16px 8px 4px' }}>Сделано · {d.done.length}</div>
              <TaskList tasks={d.done} today={today} />
            </>
          )}
        </section>

        <DayExtras date={date} today={today} />

        {d.isToday && <TodoistPanel today={today} />}

        {d.events.length > 0 && (
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 10 }}>События и сроки</h2>
            <ul className="list">
              {d.events.map((e, i) => (
                <li key={i}>
                  <Link to={noteHref(e.path)}>
                    <span className="li-main">
                      <div className="li-title">{e.title}</div>
                      {e.kind === 'event' && (e.time || e.amount !== null) && (
                        <div className="li-sub">
                          {e.time ?? ''} {e.amount !== null ? `${e.amount.toLocaleString('ru-RU')} ₽` : ''}
                        </div>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Moon size={16} /> Вечерний итог
            </h2>
          </div>
          <Metrics date={date} mood={d.mood} energy={d.energy} />
          <div style={{ height: 12 }} />
          <SectionEditor date={date} section="review" value={d.review} placeholder="Что получилось? Что перенести? Чему научился?" rows={6} />
          <div className="small muted" style={{ marginTop: 10 }}>
            Сделано задач: {d.done.length}. Не завершено из плана: {d.planned.length}.
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Заметки дня</h2>
          </div>
          <SectionEditor date={date} section="notes" value={d.notes} placeholder="Мысли, наблюдения, ссылки [[…]]" rows={5} />
        </section>
        <div className="small muted row">
          <FileText size={14} />
          {d.note ? <Link to={noteHref(d.note.path)}>{d.note.path}</Link> : <span>Заметка {d.notePath} будет создана при первом сохранении</span>}
        </div>
      </div>
    </div>
  );
}

/** Платежи, тренировки, регулярные дела и практики выбранного дня. */
function DayExtras({ date, today }: { date: string; today: string }) {
  const q = useQuery({ queryKey: ['spheres-day', date], queryFn: () => api.get<SpheresDay>(`/api/spheres/day?date=${date}`) });
  if (q.isPending) return <div className="card"><Loading rows={2} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data;
  const p = x.practices;
  const practiceCount = p.practices.length + p.states.length + p.gratitude.length;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Регулярное, тренировки и платежи</h2>
        <span className="row small muted" style={{ gap: 8 }}>
          <MoonBadge moon={x.moon} />
          {x.moon.phaseLabel}, {x.moon.lunarDay}-й лунный день
        </span>
      </div>
      {x.obligations.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '4px 8px' }}>Платежи</div>
          <ObligationList items={x.obligations} today={today} />
        </>
      )}
      {x.tomorrowObligations.length > 0 && (
        <div className="small" style={{ margin: '6px 8px', color: 'var(--amber)' }}>
          Завтра к оплате: {x.tomorrowObligations.map((o) => `${o.title}${o.amount ? ` (${o.amount.toLocaleString('ru-RU')} ₽)` : ''}`).join(', ')}
        </div>
      )}
      {x.workouts.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '10px 8px 4px' }}>Тренировки</div>
          <ul className="list">
            {x.workouts.map((w) => (
              <li key={w.path}>
                <WorkoutLine w={w} today={today} />
              </li>
            ))}
          </ul>
        </>
      )}
      {x.routines.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '10px 8px 4px' }}>Регулярные дела</div>
          <RoutineList routines={x.routines} today={today} showSphere />
        </>
      )}
      {x.obligations.length === 0 && x.workouts.length === 0 && x.routines.length === 0 && (
        <Empty title="Ни платежей, ни тренировок, ни регулярных дел на этот день" />
      )}
      <div className="small muted" style={{ margin: '12px 8px 0' }}>
        {x.health.sleep !== null ? `Сон ${x.health.sleep} ч · ` : ''}
        {x.health.water !== null ? `вода ${x.health.water} л · ` : ''}
        {practiceCount ? `записей в практиках: ${practiceCount} · ` : ''}
        <Link to="/health">здоровье</Link> · <Link to="/practices">практики</Link>
        {p.intention ? <div style={{ marginTop: 4 }}>Намерение: {p.intention}</div> : null}
      </div>
    </section>
  );
}

function SectionEditor({ date, section, value, placeholder, rows }: { date: string; section: 'priorities' | 'review' | 'notes'; value: string; placeholder: string; rows: number }) {
  const [text, setText] = useState(value);
  const [dirty, setDirty] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (!dirty) setText(value);
  }, [value, dirty]);
  useEffect(() => {
    setDirty(false);
    setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  const m = useMutation({
    mutationFn: () => api.put<DayData>('/api/day/section', { date, section, content: text }),
    onSuccess: (data) => {
      setDirty(false);
      qc.setQueryData(['day', date], data);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      toast('Сохранено в ежедневную заметку');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea
        className="textarea"
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) m.mutate();
        }}
        aria-label={section}
      />
      <div className="row">
        <button className="btn small primary" disabled={!dirty || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {dirty && (
          <button
            className="btn small ghost"
            onClick={() => {
              setText(value);
              setDirty(false);
            }}
          >
            Отменить
          </button>
        )}
        {dirty && <span className="small muted">есть несохранённые изменения</span>}
      </div>
    </div>
  );
}

function Metrics({ date, mood, energy }: { date: string; mood: number | null; energy: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (v: { mood?: number | null; energy?: number | null }) => api.put<DayData>('/api/day/metrics', { date, ...v }),
    onSuccess: (data) => qc.setQueryData(['day', date], data),
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const scale = (label: string, key: 'mood' | 'energy', value: number | null) => (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="small muted">{label}</span>
      <div className="row" style={{ gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`btn small icon ${value === n ? 'primary' : ''}`}
            onClick={() => m.mutate({ [key]: value === n ? null : n })}
            aria-pressed={value === n}
            aria-label={`${label}: ${n}`}
            disabled={m.isPending}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {scale('Настроение', 'mood', mood)}
      {scale('Энергия', 'energy', energy)}
    </div>
  );
}
