import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Check, Dumbbell, HeartPulse, Info, Plus, Save } from 'lucide-react';
import { api, type SportData, type WorkoutDTO } from '../api.ts';
import { CreateEntityModal } from '../components/Entities.tsx';
import { Bars, NewRoutineButton, RoutineList, useAct } from '../components/Spheres.tsx';
import { Empty, ErrorBox, Loading, fmtDate, noteHref, pastDate, plural, relDate } from '../components/ui.tsx';
import { WORKOUT_FIELDS, WORKOUT_KIND_LABEL, WORKOUT_STATUS_LABEL, entityHref } from '../entities.ts';

const METRICS: Array<{ key: 'sleep' | 'sleep_quality' | 'recovery' | 'water' | 'weight' | 'steps'; label: string; unit: string; step?: string }> = [
  { key: 'sleep', label: 'Сон', unit: 'ч', step: '0.5' },
  { key: 'sleep_quality', label: 'Качество сна', unit: '1–5' },
  { key: 'recovery', label: 'Восстановление', unit: '1–5' },
  { key: 'water', label: 'Вода', unit: 'л', step: '0.25' },
  { key: 'weight', label: 'Вес', unit: 'кг', step: '0.1' },
  { key: 'steps', label: 'Шаги', unit: '' },
];

export function WorkoutLine({ w, today }: { w: WorkoutDTO; today: string }) {
  const status = useAct('/api/sport/workout/status', (r: { workout: WorkoutDTO }) => (r.workout.status === 'done' ? 'Тренировка отмечена выполненной' : 'Тренировка отмечена пропущенной'));
  return (
    <div className="li">
      <span className="type-dot workout" />
      <Link to={entityHref('workout', w.path)} className="li-main">
        <div className="li-title">{w.title}</div>
        <div className="li-sub" style={{ color: w.missed ? 'var(--red)' : undefined }}>
          {WORKOUT_KIND_LABEL[w.kind]}
          {w.date ? ` · ${w.status === 'planned' ? relDate(w.date, today) : pastDate(w.date, today)}` : ''}
          {w.time ? ` · ${w.time}` : ''}
          {w.exercises.length ? ` · ${w.exercises.length} ${plural(w.exercises.length, 'упражнение', 'упражнения', 'упражнений')}` : ''}
          {w.duration ? ` · ${w.duration} мин` : ''}
          {w.distance ? ` · ${w.distance} км` : ''}
        </div>
      </Link>
      <span className={`chip ${w.status === 'done' ? 'green' : w.missed ? 'red' : ''}`}>{w.missed ? 'не отмечена' : WORKOUT_STATUS_LABEL[w.status]}</span>
      {w.status === 'planned' && (!w.date || w.date <= today) && (
        <>
          <button className="btn small" onClick={() => status.mutate({ path: w.path, status: 'done' })} disabled={status.isPending} aria-label={`Выполнено: ${w.title}`}>
            <Check size={14} /> Выполнено
          </button>
          <button className="btn small ghost" onClick={() => status.mutate({ path: w.path, status: 'skipped' })} disabled={status.isPending}>
            Пропуск
          </button>
        </>
      )}
    </div>
  );
}

export function HealthPage() {
  const q = useQuery({ queryKey: ['sport'], queryFn: () => api.get<SportData>('/api/sport') });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const labels = d.days.map((x) => x.date.slice(8));
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile value={`${d.week.done}`} label={`тренировок на этой неделе (прошлая: ${d.week.previousDone})`} />
        <Tile value={`${d.week.minutes} мин`} label="время тренировок за неделю" />
        <Tile value={d.averages.sleep !== null ? `${d.averages.sleep} ч` : '—'} label="сон в среднем за 7 дней" />
        <Tile value={d.averages.water !== null ? `${d.averages.water} л` : '—'} label="вода в среднем за 7 дней" />
        <Tile value={d.lastWorkoutDaysAgo === null ? '—' : d.lastWorkoutDaysAgo === 0 ? 'сегодня' : `${d.lastWorkoutDaysAgo} дн.`} label="с последней тренировки" />
      </div>

      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Dumbbell size={16} /> Тренировки
              </h2>
              <button className="btn small primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Тренировка
              </button>
            </div>
            {d.missed.length > 0 && (
              <>
                <div className="small" style={{ color: 'var(--red)', fontWeight: 600, margin: '4px 8px' }}>Не отмечены · {d.missed.length}</div>
                <ul className="list">
                  {d.missed.map((w) => (
                    <li key={w.path}>
                      <WorkoutLine w={w} today={d.today} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="small muted" style={{ margin: '8px 8px 4px' }}>Запланировано</div>
            {d.upcoming.length === 0 ? (
              <Empty title="Плановых тренировок нет">Запланируйте тренировку — она появится в календаре и в «Сегодня».</Empty>
            ) : (
              <ul className="list">
                {d.upcoming.map((w) => (
                  <li key={w.path}>
                    <WorkoutLine w={w} today={d.today} />
                  </li>
                ))}
              </ul>
            )}
            <div className="small muted" style={{ margin: '16px 8px 4px' }}>Недавние</div>
            {d.recent.length === 0 ? (
              <Empty title="Выполненных тренировок пока нет" />
            ) : (
              <ul className="list">
                {d.recent.slice(0, 8).map((w) => (
                  <li key={w.path}>
                    <WorkoutLine w={w} today={d.today} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 8 }}>
              <Activity size={16} /> Упражнения и веса
            </h2>
            {d.exercises.length === 0 ? (
              <Empty title="Пока нет данных">Добавляйте упражнения в выполненные тренировки — здесь появится прогресс.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Упражнение</th>
                      <th>Последний раз</th>
                      <th className="r">Последний вес</th>
                      <th className="r">Лучший</th>
                      <th className="r">Раз</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.exercises.map((e) => (
                      <tr key={e.name}>
                        <td>{e.name}</td>
                        <td className="small">
                          <Link to={entityHref('workout', e.last.path)}>{fmtDate(e.last.date)}</Link>
                          {e.last.sets ? ` · ${e.last.sets}×${e.last.reps ?? '—'}` : ''}
                        </td>
                        <td className="r">{e.last.weight !== null ? `${e.last.weight} кг` : '—'}</td>
                        <td className="r">{e.best !== null ? `${e.best} кг` : '—'}</td>
                        <td className="r">{e.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <DayHealthCard d={d} />
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 8 }}>Сон за 14 дней</h2>
            <Bars values={d.days.map((x) => x.sleep)} labels={labels} format={(n) => `${n} ч`} />
            <div style={{ height: 12 }} />
            <h3 className="card-title" style={{ marginBottom: 8, fontSize: 14 }}>Вода</h3>
            <Bars values={d.days.map((x) => x.water)} labels={labels} format={(n) => `${n} л`} tone="var(--green)" />
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <HeartPulse size={16} /> Регулярные процедуры
              </h2>
              <NewRoutineButton sphere="health" label="Процедура" />
            </div>
            <RoutineList routines={d.routines} today={d.today} />
          </section>
          <div className="notice">
            <Info size={18} style={{ flex: '0 0 auto' }} />
            <div className="small">Frame OS только ведёт записи и показывает динамику. Это не медицинская оценка: диагнозов и назначений раздел не даёт.</div>
          </div>
        </div>
      </div>

      {creating && (
        <CreateEntityModal
          type="workout"
          heading="Новая тренировка"
          titleLabel="Название (например, «Силовая А»)"
          defs={WORKOUT_FIELDS}
          initial={{ date: d.today, status: 'planned' }}
          textLabel="План или заметки"
          folderHint="Заметка в «Здоровье/Тренировки»"
          onClose={() => setCreating(false)}
          onCreated={(p) => nav(entityHref('workout', p))}
        />
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

function DayHealthCard({ d }: { d: SportData }) {
  const h = d.todayHealth;
  const initial = Object.fromEntries(METRICS.map((m) => [m.key, h[m.key] === null ? '' : String(h[m.key])]));
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [nutrition, setNutrition] = useState(h.nutrition);
  useEffect(() => {
    setVals(Object.fromEntries(METRICS.map((m) => [m.key, h[m.key] === null ? '' : String(h[m.key])])));
    setNutrition(h.nutrition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.notePath, h.sleep, h.water, h.weight, h.steps, h.recovery, h.sleep_quality, h.nutrition]);
  const save = useAct('/api/sport/day', 'Показатели записаны в ежедневную заметку', 'put');
  const saveFood = useAct('/api/sport/nutrition', 'Питание записано в ежедневную заметку', 'put');
  const changed = METRICS.filter((m) => (vals[m.key] ?? '') !== (initial[m.key] ?? ''));
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Сегодня</h2>
        <Link to={noteHref(h.notePath)} className="card-sub">
          {h.exists ? 'ежедневная заметка' : 'заметка создастся при сохранении'}
        </Link>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length) save.mutate({ date: d.today, ...Object.fromEntries(changed.map((m) => [m.key, vals[m.key]!.replace(',', '.') || null])) });
        }}
        className="stack"
        style={{ gap: 10 }}
      >
        <div className="form-grid">
          {METRICS.map((m) => (
            <label key={m.key} className="field">
              {m.label}
              {m.unit ? `, ${m.unit}` : ''}
              <input className="input" inputMode="decimal" value={vals[m.key] ?? ''} onChange={(e) => setVals({ ...vals, [m.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="btn small primary" type="submit" disabled={!changed.length || save.isPending} style={{ justifySelf: 'start' }}>
          <Save size={14} /> Сохранить показатели
        </button>
      </form>
      <div style={{ height: 12 }} />
      <label className="field">
        Питание
        <textarea className="textarea" rows={3} value={nutrition} onChange={(e) => setNutrition(e.target.value)} placeholder="Завтрак, обед, ужин, перекусы" />
      </label>
      {nutrition !== h.nutrition && (
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => saveFood.mutate({ date: d.today, content: nutrition })} disabled={saveFood.isPending}>
          <Save size={14} /> Сохранить питание
        </button>
      )}
    </section>
  );
}
