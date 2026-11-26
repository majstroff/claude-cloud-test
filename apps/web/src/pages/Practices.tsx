import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flame, Moon, Save, Sparkles } from 'lucide-react';
import { api, type PracticesData, type PracticeDay } from '../api.ts';
import { MoonBadge, NewRoutineButton, RoutineList, useAct } from '../components/Spheres.tsx';
import { Empty, ErrorBox, Loading, fmtDate, noteHref, plural } from '../components/ui.tsx';

const ENTRY_LABEL = { gratitude: 'Благодарность', observations: 'Наблюдение', spreads: 'Расклад' } as const;

export function PracticesPage() {
  const q = useQuery({ queryKey: ['practices'], queryFn: () => api.get<PracticesData>('/api/practices') });
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const t = d.today;
  const past = d.history.filter(
    (h) => h.date !== t.date && (h.intention || h.practices.length || h.states.length || h.gratitude.length || h.observations.length || h.spreads.length),
  );
  const minutes7 = Object.values(d.stats.minutes7).reduce((s, v) => s + v, 0);
  return (
    <div className="grid cols-3">
      <div className="stack">
        <IntentionCard day={t} />
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 10 }}>Записать практику</h2>
          <PracticeForm kinds={d.kinds} />
          <div style={{ height: 14 }} />
          <h3 className="card-title" style={{ marginBottom: 8, fontSize: 14 }}>Состояние сейчас</h3>
          <StateForm />
          <div style={{ height: 14 }} />
          <h3 className="card-title" style={{ marginBottom: 8, fontSize: 14 }}>Благодарность, наблюдение, расклад</h3>
          <EntryForm />
        </section>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Сегодня</h2>
            <Link to={noteHref(t.notePath)} className="card-sub">
              {t.exists ? 'ежедневная заметка' : 'заметка создастся при первой записи'}
            </Link>
          </div>
          <DayEntries day={t} />
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Последние 30 дней</h2>
          {past.length === 0 ? (
            <Empty title="Записей за прошлые дни нет" />
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {past.map((h) => (
                  <div key={h.date}>
                    <Link to={noteHref(h.notePath)} className="small muted">
                      {fmtDate(h.date, true)}
                    </Link>
                    <DayEntries day={h} compact />
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <div className="row" style={{ gap: 14 }}>
            <MoonBadge moon={d.moon} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                <Moon size={14} /> {d.moon.phaseLabel}
              </div>
              <div className="small muted">
                {d.moon.lunarDay}-й лунный день · освещённость {d.moon.illumination}%
              </div>
              <div className="small muted">
                Новолуние {fmtDate(d.moon.nextNew)} · полнолуние {fmtDate(d.moon.nextFull)}
              </div>
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Фаза рассчитывается по астрономической формуле на полдень, точность — около суток.</div>
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 10 }}>
            <Flame size={16} /> Регулярность
          </h2>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="stat">
              <div className="l">Серия</div>
              <div style={{ fontSize: 22 }}>
                {d.stats.streak} {plural(d.stats.streak, 'день', 'дня', 'дней')}
              </div>
            </div>
            <div className="stat">
              <div className="l">За 7 дней</div>
              <div style={{ fontSize: 22 }}>{minutes7} мин</div>
            </div>
          </div>
          {Object.keys(d.stats.minutes30).length > 0 && (
            <ul className="list" style={{ marginTop: 10 }}>
              {Object.entries(d.stats.minutes30)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <li key={k}>
                    <div className="li">
                      <span className="li-main">{d.kinds[k as keyof typeof d.kinds] ?? k}</span>
                      <span className="small muted">
                        {v} мин за 30 дней · {d.stats.minutes7[k] ?? 0} за неделю
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Sparkles size={16} /> Регулярные практики
            </h2>
            <NewRoutineButton sphere="practice" label="Практика" />
          </div>
          <RoutineList routines={d.routines} today={t.date} />
        </section>
      </div>
    </div>
  );
}

function IntentionCard({ day }: { day: PracticeDay }) {
  const [text, setText] = useState(day.intention);
  useEffect(() => setText(day.intention), [day.intention]);
  const save = useAct('/api/practices/intention', 'Намерение записано в ежедневную заметку', 'put');
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Намерение дня</h2>
        {text !== day.intention && (
          <button className="btn small primary" onClick={() => save.mutate({ date: day.date, text })} disabled={save.isPending}>
            <Save size={14} /> Сохранить
          </button>
        )}
      </div>
      <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="С каким настроем я проживаю этот день?" aria-label="Намерение дня" />
    </section>
  );
}

function PracticeForm({ kinds }: { kinds: Record<string, string> }) {
  const [kind, setKind] = useState('meditation');
  const [minutes, setMinutes] = useState('');
  const [text, setText] = useState('');
  const log = useAct('/api/practices/log', 'Практика записана');
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        log.mutate(
          { kind, minutes, text },
          {
            onSuccess: () => {
              setMinutes('');
              setText('');
            },
          },
        );
      }}
    >
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид практики">
        {Object.entries(kinds).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="мин" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Минут" />
      <input className="input grow" placeholder="Комментарий" value={text} onChange={(e) => setText(e.target.value)} aria-label="Комментарий к практике" />
      <button className="btn small primary" type="submit" disabled={log.isPending}>
        Записать
      </button>
    </form>
  );
}

function StateForm() {
  const [state, setState] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [text, setText] = useState('');
  const log = useAct('/api/practices/state', 'Состояние записано');
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (state.trim())
          log.mutate(
            { state, level, text },
            {
              onSuccess: () => {
                setState('');
                setLevel(null);
                setText('');
              },
            },
          );
      }}
    >
      <div className="inline-form">
        <input className="input grow" placeholder="Спокойствие, тревога, радость…" value={state} onChange={(e) => setState(e.target.value)} aria-label="Состояние" />
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`btn small icon ${level === n ? 'primary' : ''}`} onClick={() => setLevel(level === n ? null : n)} aria-pressed={level === n} aria-label={`Оценка ${n}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="inline-form">
        <input className="input grow" placeholder="Что повлияло (необязательно)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Что повлияло" />
        <button className="btn small" type="submit" disabled={log.isPending || !state.trim()}>
          Записать состояние
        </button>
      </div>
    </form>
  );
}

function EntryForm() {
  const [section, setSection] = useState<keyof typeof ENTRY_LABEL>('gratitude');
  const [text, setText] = useState('');
  const add = useAct('/api/practices/entry', (r: unknown) => (void r, `${ENTRY_LABEL[section]} записано в ежедневную заметку`));
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) add.mutate({ section, text }, { onSuccess: () => setText('') });
      }}
    >
      <select className="select" value={section} onChange={(e) => setSection(e.target.value as 'gratitude')} aria-label="Вид записи">
        {Object.entries(ENTRY_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input className="input grow" placeholder={section === 'spreads' ? 'Карты и толкование' : section === 'gratitude' ? 'За что я благодарен' : 'Что заметил'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст записи" />
      <button className="btn small" type="submit" disabled={add.isPending || !text.trim()}>
        Добавить
      </button>
    </form>
  );
}

function DayEntries({ day, compact }: { day: PracticeDay; compact?: boolean }) {
  const empty = !day.intention && !day.practices.length && !day.states.length && !day.gratitude.length && !day.observations.length && !day.spreads.length;
  if (empty) return compact ? null : <Empty title="Пока ничего не записано">Запишите практику, состояние или благодарность — они попадут в ежедневную заметку.</Empty>;
  return (
    <ul className="stack small" style={{ gap: 4, margin: '6px 0 0', paddingLeft: 18 }}>
      {compact && day.intention && <li>Намерение: {day.intention}</li>}
      {day.practices.map((p, i) => (
        <li key={`p${i}`}>
          {p.time ? `${p.time} · ` : ''}
          <strong>{p.label}</strong>
          {p.minutes ? ` · ${p.minutes} мин` : ''}
          {p.text ? ` · ${p.text}` : ''}
        </li>
      ))}
      {day.states.map((s, i) => (
        <li key={`s${i}`}>
          {s.time ? `${s.time} · ` : ''}Состояние: <strong>{s.state}</strong>
          {s.level ? ` · ${s.level}/5` : ''}
          {s.text ? ` · ${s.text}` : ''}
        </li>
      ))}
      {day.gratitude.map((g, i) => (
        <li key={`g${i}`}>Благодарность: {g}</li>
      ))}
      {day.observations.map((o, i) => (
        <li key={`o${i}`}>
          {o.time ? `${o.time} · ` : ''}Наблюдение: {o.text}
        </li>
      ))}
      {day.spreads.map((s, i) => (
        <li key={`r${i}`}>Расклад: {s}</li>
      ))}
    </ul>
  );
}
