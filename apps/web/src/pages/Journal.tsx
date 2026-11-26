import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, FileText, Flame, NotebookPen, Save } from 'lucide-react';
import { api, type AnalyticsData, type JournalData, type JournalEntry, type ReviewDraft, type ReviewPeriod } from '../api.ts';
import { Bars } from '../components/Spheres.tsx';
import { InsightList } from '../components/Assist.tsx';
import { Empty, ErrorBox, Loading, addDaysIso, fmtDate, noteHref, parseIso, plural, toIso, useToast } from '../components/ui.tsx';
import { Metrics } from './Today.tsx';
import { rub } from '../entities.ts';

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function JournalPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'reviews' ? 'reviews' : 'entries';
  const set = (next: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...next });
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        <button className={tab === 'entries' ? 'on' : ''} onClick={() => setParams({})}>
          <NotebookPen size={14} /> Записи
        </button>
        <button className={tab === 'reviews' ? 'on' : ''} onClick={() => setParams({ tab: 'reviews' })}>
          <BarChart3 size={14} /> Итоги и аналитика
        </button>
      </div>
      {tab === 'entries' ? <Entries date={params.get('date')} onDate={(d) => set({ date: d })} /> : <Reviews />}
    </div>
  );
}

// ---------- Записи ----------

function Entries({ date, onDate }: { date: string | null; onDate: (d: string) => void }) {
  const list = useQuery({ queryKey: ['journal', 'list'], queryFn: () => api.get<JournalData>('/api/journal') });
  const today = list.data?.today;
  const current = date ?? today ?? null;
  const entry = useQuery({
    queryKey: ['journal', 'entry', current],
    queryFn: () => api.get<JournalEntry>(`/api/journal/entry?date=${current}`),
    enabled: !!current,
  });
  if (list.isError) return <ErrorBox error={list.error} onRetry={() => list.refetch()} />;
  if (list.isPending || !current) return <div className="card"><Loading rows={6} /></div>;
  const d = list.data;
  return (
    <div className="grid cols-3">
      <div className="stack">
        {entry.isError ? <ErrorBox error={entry.error} onRetry={() => entry.refetch()} /> : entry.isPending ? <div className="card"><Loading rows={5} /></div> : <EntryCard e={entry.data} today={d.today} onDate={onDate} />}
      </div>
      <div className="stack">
        <section className="card">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="stat">
              <div className="l">
                <Flame size={12} /> Серия
              </div>
              <div style={{ fontSize: 22 }}>
                {d.streak} {plural(d.streak, 'день', 'дня', 'дней')}
              </div>
            </div>
            <div className="stat">
              <div className="l">Записей за 30 дней</div>
              <div style={{ fontSize: 22 }}>{d.entries.filter((e) => e.written).length}</div>
            </div>
          </div>
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Последние дни</h2>
          {d.entries.length === 0 ? (
            <Empty title="Ежедневных заметок пока нет">Первая запись создаст заметку дня в Obsidian.</Empty>
          ) : (
            <ul className="list">
              {d.entries.map((e) => (
                <li key={e.date}>
                  <button className="li" style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => onDate(e.date)} aria-current={e.date === current}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: e.date === current ? 600 : 500 }}>{fmtDate(e.date, true)}</span>
                      <span className="small muted">
                        {e.mood !== null && `настроение ${e.mood} · `}
                        {e.doneTasks > 0 && `${e.doneTasks} ${plural(e.doneTasks, 'задача', 'задачи', 'задач')} · `}
                        {e.written ? `${e.words} сл.` : 'без записи'}
                      </span>
                    </div>
                    {e.excerpt && <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.excerpt}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Итоги</h2>
            <Link className="card-sub" to="/journal?tab=reviews">
              Подвести итоги
            </Link>
          </div>
          {d.reviews.length === 0 ? (
            <div className="small muted">Сохранённых итогов пока нет.</div>
          ) : (
            <ul className="list">
              {d.reviews.slice(0, 8).map((r) => (
                <li key={r.path}>
                  <Link to={noteHref(r.path)} className="row">
                    <FileText size={14} /> {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EntryCard({ e, today, onDate }: { e: JournalEntry; today: string; onDate: (d: string) => void }) {
  const [text, setText] = useState(e.text);
  useEffect(() => setText(e.text), [e.text, e.date]);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.put<JournalEntry>('/api/journal/entry', { date: e.date, text }),
    onSuccess: () => {
      toast('Запись сохранена в ежедневную заметку');
      void qc.invalidateQueries();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const future = e.date > today;
  const dirty = text.trim() !== e.text.trim();
  return (
    <section className="card">
      <div className="card-head">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small icon" aria-label="Предыдущий день" onClick={() => onDate(addDaysIso(e.date, -1))}>
            <ChevronLeft size={14} />
          </button>
          <h2 className="card-title" style={{ margin: '0 6px' }}>
            {e.isToday ? 'Сегодня, ' : ''}
            {fmtDate(e.date, true)}
          </h2>
          <button className="btn small icon" aria-label="Следующий день" onClick={() => onDate(addDaysIso(e.date, 1))} disabled={e.date >= today}>
            <ChevronRight size={14} />
          </button>
          {!e.isToday && (
            <button className="btn small ghost" onClick={() => onDate(today)}>
              К сегодня
            </button>
          )}
        </div>
        <Link to={noteHref(e.notePath)} className="card-sub">
          {e.exists ? 'открыть заметку' : 'заметка создастся при сохранении'}
        </Link>
      </div>
      {future ? (
        <Empty title="Этот день ещё не наступил" />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <Metrics date={e.date} mood={e.mood} energy={e.energy} />
          <div>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              {e.prompts.map((p) => (
                <button key={p} className="chip" style={{ border: 0, cursor: 'pointer' }} onClick={() => setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${p}\n` : `${p}\n`))}>
                  {p}
                </button>
              ))}
            </div>
            <textarea
              className="textarea"
              aria-label="Запись дневника"
              rows={9}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder="Как прошёл день? Что получилось, что мешало, что важно запомнить."
            />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="small muted">Запись хранится в секции «Дневник» ежедневной заметки Obsidian.</span>
              <button className="btn primary small" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                <Save size={14} /> Сохранить
              </button>
            </div>
          </div>
          {e.review && (
            <div>
              <div className="small muted">Итог дня (из раздела «Сегодня»)</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{e.review}</div>
            </div>
          )}
          {e.done.length > 0 && (
            <div>
              <div className="small muted">Сделано за день</div>
              <ul className="list">
                {e.done.map((t) => (
                  <li key={t.id}>
                    <Link to={noteHref(t.path)}>{t.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(e.states.length > 0 || e.gratitude.length > 0 || e.practices.length > 0) && (
            <div className="small">
              {e.practices.length > 0 && <div>Практики: {e.practices.map((p) => `${p.label}${p.minutes ? ` ${p.minutes} мин` : ''}`).join(', ')}</div>}
              {e.states.length > 0 && <div>Состояния: {e.states.map((s) => `${s.state}${s.level ? ` ${s.level}/5` : ''}`).join(', ')}</div>}
              {e.gratitude.length > 0 && <div>Благодарности: {e.gratitude.join('; ')}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Итоги и аналитика ----------

function shift(period: ReviewPeriod, date: string, n: number): string {
  if (period === 'week') return addDaysIso(date, 7 * n);
  const d = parseIso(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return toIso(d);
}

function Reviews() {
  const [params, setParams] = useSearchParams();
  const period: ReviewPeriod = params.get('period') === 'month' ? 'month' : 'week';
  const date = params.get('date');
  const set = (p: ReviewPeriod, d: string | null) => setParams(d ? { tab: 'reviews', period: p, date: d } : { tab: 'reviews', period: p });
  const q = useQuery({
    queryKey: ['journal', 'draft', period, date],
    queryFn: () => api.get<ReviewDraft>(`/api/reviews/draft?period=${period}${date ? `&date=${date}` : ''}`),
  });
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (q.isPending) return <div className="card"><Loading rows={8} /></div>;
  const d = q.data;
  const s = d.stats;
  const anchor = s.start;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="tabs">
          <button className={period === 'week' ? 'on' : ''} onClick={() => set('week', null)}>
            Неделя
          </button>
          <button className={period === 'month' ? 'on' : ''} onClick={() => set('month', null)}>
            Месяц
          </button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small icon" aria-label="Предыдущий период" onClick={() => set(period, shift(period, anchor, -1))}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontWeight: 600, margin: '0 6px' }}>{s.label}</span>
          <button className="btn small icon" aria-label="Следующий период" onClick={() => set(period, shift(period, anchor, 1))} disabled={s.days === 0}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {s.days === 0 ? (
        <div className="card">
          <Empty title="Период ещё не начался" />
        </div>
      ) : (
        <div className="grid cols-3">
          <div className="stack">
            <StatsCard a={d} />
            <section className="card">
              <h2 className="card-title" style={{ marginBottom: 8 }}>Выводы</h2>
              <InsightList items={d.insights} />
              <div className="small muted" style={{ marginTop: 8 }}>Выводы посчитаны по правилам на этом компьютере. Данные никуда не отправлялись.</div>
            </section>
          </div>
          <div className="stack">
            <SaveReview d={d} period={period} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatsCard({ a }: { a: AnalyticsData }) {
  const s = a.stats;
  const p = a.prev;
  const tile = (label: string, value: string, hint?: string) => (
    <div className="stat">
      <div className="l">{label}</div>
      <div style={{ fontSize: 22 }}>{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
  const one = (n: number | null) => (n === null ? '—' : String(n).replace('.', ','));
  const labels = s.tasks.doneByDay.map((x) => (s.period === 'week' ? WD[parseIso(x.date).getDay()]! : String(parseIso(x.date).getDate())));
  const moodBy = new Map(s.mood.series.map((m) => [m.date, m.mood]));
  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 10 }}>Цифры</h2>
      <div className="grid cols-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {tile('Сделано задач', String(s.tasks.done), `было ${p.tasks.done}`)}
        {tile('Не в срок', String(s.tasks.missed), `просрочено сейчас ${s.tasks.overdueNow}`)}
        {tile('Настроение', one(s.mood.avg), p.mood.avg !== null ? `было ${one(p.mood.avg)}` : undefined)}
        {tile('Энергия', one(s.mood.energyAvg))}
        {tile('Сон, ч', one(s.health.sleepAvg), s.health.sleepDays ? `${s.health.sleepDays} дн. с данными` : 'нет данных')}
        {tile('Тренировки', `${s.health.workoutsDone}/${s.health.workoutsPlanned}`)}
        {tile('Дневник', `${s.journal.daysWritten}/${s.days}`, 'дней с записью')}
        {tile('Расходы', rub(s.finance.expense), p.finance.expense ? `было ${rub(p.finance.expense)}` : undefined)}
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>Выполненные задачи по дням</div>
        <Bars values={s.tasks.doneByDay.map((x) => (x.date > s.end ? null : x.count))} labels={labels} />
      </div>
      {s.mood.series.some((m) => m.mood !== null) && (
        <div style={{ marginTop: 14 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>Настроение по дням</div>
          <Bars values={s.tasks.doneByDay.map((x) => moodBy.get(x.date) ?? null)} labels={labels} tone="var(--violet)" />
        </div>
      )}
      {s.tasks.byProject.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="small muted">По проектам</div>
          <ul className="list">
            {s.tasks.byProject.map((x) => (
              <li key={x.path}>
                <Link to={`/projects/view?path=${encodeURIComponent(x.path)}`}>{x.title}</Link>
                <span className="small muted"> · {x.done}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.finance.topCategories.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="small muted">Расходы по категориям</div>
          <div className="small">{s.finance.topCategories.map((c) => `${c.category} — ${rub(c.amount)}`).join(' · ')}</div>
        </div>
      )}
    </section>
  );
}

const QUESTIONS = ['Что получилось', 'Что не получилось', 'Чему научился', 'Фокус на следующий период'];

function SaveReview({ d, period }: { d: ReviewDraft; period: ReviewPeriod }) {
  const [answers, setAnswers] = useState<Record<string, string>>(d.human);
  useEffect(() => setAnswers(d.human), [d.human, d.stats.start]);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.post<{ path: string; created: boolean }>('/api/reviews', { period, date: d.stats.start, answers }),
    onSuccess: (r) => {
      toast(r.created ? 'Итоги сохранены в Obsidian' : 'Итоги обновлены: цифры пересчитаны, ваши ответы сохранены');
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Рефлексия</h2>
        {d.existing && (
          <Link to={noteHref(d.existing.path)} className="card-sub">
            открыть заметку
          </Link>
        )}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {QUESTIONS.map((h) => (
          <label key={h} className="stack" style={{ gap: 4 }}>
            <span className="small muted">{h}</span>
            <textarea className="textarea" rows={3} value={answers[h] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [h]: e.target.value }))} />
          </label>
        ))}
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Что ещё попадёт в заметку
          </summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
            {Object.entries(d.auto)
              .map(([k, v]) => `## ${k}\n${v}`)
              .join('\n\n')}
          </pre>
        </details>
        <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> {d.existing ? 'Обновить итоги в Obsidian' : 'Сохранить итоги в Obsidian'}
        </button>
        <div className="small muted">
          {d.existing ? 'Цифры и списки пересчитаются, ваши ответы останутся.' : `Будет создана заметка «${d.title}».`}
        </div>
      </div>
    </section>
  );
}
