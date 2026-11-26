import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, FileText, Plus } from 'lucide-react';
import {
  api,
  type ApplianceDetail,
  type FinanceItem,
  type LearningDetail,
  type NoteData,
  type RoutineDetail,
  type WorkoutDetail,
} from '../api.ts';
import { EditEntityCard, HistoryList, RefLink, RelatedCard, SectionEditor } from '../components/Entities.tsx';
import { Money, routineWhen, useAct } from '../components/Spheres.tsx';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, Progress, TYPE_LABEL, addDaysIso, fmtDate, noteHref, pastDate, relDate } from '../components/ui.tsx';
import {
  APPLIANCE_STATUS_LABEL,
  DEBT_DIRECTION_LABEL,
  LEARN_STATUS_LABEL,
  MATERIAL_TYPE_LABEL,
  PAYMENT_STATUS_LABEL,
  PERIOD_LABEL,
  RECURRENCE_LABEL,
  SAVINGS_KIND_LABEL,
  SKILL_KIND_LABEL,
  SPHERE_LABEL,
  SUB_STATUS_LABEL,
  WORKOUT_KIND_LABEL,
  WORKOUT_STATUS_LABEL,
  fieldsFor,
  rub,
} from '../entities.ts';
import { ProgressForm } from './Learning.tsx';

const BACK: Record<string, [string, string]> = {
  subscription: ['/finance?tab=regular', 'Финансы'],
  payment: ['/finance?tab=regular', 'Финансы'],
  debt: ['/finance?tab=debts', 'Финансы'],
  savings: ['/finance?tab=debts', 'Финансы'],
  workout: ['/health', 'Спорт и здоровье'],
  book: ['/learning', 'Чтение и обучение'],
  article: ['/learning', 'Чтение и обучение'],
  video: ['/learning', 'Чтение и обучение'],
  course: ['/learning', 'Чтение и обучение'],
  skill: ['/learning?tab=skills', 'Чтение и обучение'],
  appliance: ['/home', 'Дом'],
};

/** Страница записи разделов «Финансы», «Здоровье», «Обучение», «Дом» и регулярных дел. */
export function ItemPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const note = useQuery({ queryKey: ['note', path], queryFn: () => api.get<NoteData>(`/api/note?path=${encodeURIComponent(path)}`), enabled: !!path });
  if (!path) return <Empty title="Запись не выбрана" action={<Link to="/" className="btn small">На главную</Link>} />;
  if (note.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (note.isError) return <ErrorBox error={note.error} onRetry={() => note.refetch()} />;
  const type = note.data.type;
  const back = type === 'routine' ? ['/', 'Главная'] : BACK[type] ?? ['/', 'Главная'];
  const body = (() => {
    switch (type) {
      case 'subscription':
      case 'payment':
      case 'debt':
      case 'savings':
        return <FinanceView path={path} />;
      case 'workout':
        return <WorkoutView path={path} />;
      case 'book':
      case 'article':
      case 'video':
      case 'course':
      case 'skill':
        return <LearningView path={path} />;
      case 'appliance':
        return <ApplianceView path={path} />;
      case 'routine':
        return <RoutineView path={path} />;
      default:
        return (
          <Empty title="Эта заметка открывается в общем просмотре" action={<Link className="btn small" to={noteHref(path)}>Открыть заметку</Link>} />
        );
    }
  })();
  return (
    <div className="stack">
      <div className="row">
        <Link to={back[0]!} className="btn small ghost">
          <ArrowLeft size={14} /> {back[1]}
        </Link>
      </div>
      {body}
    </div>
  );
}

function Shell({ path, title, sub, chips, children, side, type }: { path: string; title: string; sub: ReactNode; chips?: ReactNode; children: ReactNode; side?: ReactNode; type: string }) {
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{title}</h2>
              <div className="small muted">{sub}</div>
            </div>
            {chips}
            <Link className="btn small" to={noteHref(path)}>
              <FileText size={14} /> Заметка
            </Link>
          </div>
        </section>
        {children}
      </div>
      <div className="stack">
        <EditEntityCard path={path} defs={fieldsFor(type)} />
        {side}
      </div>
    </div>
  );
}

function Loaded<T>({ url, keyName, render }: { url: string; keyName: string[]; render: (d: T) => ReactNode }) {
  const q = useQuery({ queryKey: keyName, queryFn: () => api.get<T>(url) });
  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  return <>{render(q.data)}</>;
}

function Stats({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 4 }}>
      {items.map(([l, v]) => (
        <div key={l} className="stat">
          <div className="l">{l}</div>
          <div>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Финансы ----------

function FinanceView({ path }: { path: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const today = health.data?.today ?? '';
  const pay = useAct('/api/finance/pay', 'Оплата записана в операции');
  const debt = useAct('/api/finance/debt-payment', 'Платёж по долгу записан');
  const contribute = useAct('/api/finance/contribute', 'Сумма записана');
  const [amount, setAmount] = useState('');
  return (
    <Loaded<FinanceItem>
      url={`/api/finance/item?path=${encodeURIComponent(path)}`}
      keyName={['finance-item', path]}
      render={(d) => {
        let sub: ReactNode = TYPE_LABEL[d.type];
        let stats: Array<[string, ReactNode]> = [];
        let action: ReactNode = null;
        const amountForm = (label: string, onSubmit: (v: string) => void, pending: boolean, placeholder = 'Сумма') => (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount.trim()) onSubmit(amount);
              setAmount('');
            }}
          >
            <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder={placeholder} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Сумма" />
            <button className="btn small primary" type="submit" disabled={pending || !amount.trim()}>
              {label}
            </button>
          </form>
        );
        if ('period' in d) {
          sub = `Подписка · ${PERIOD_LABEL[d.period]} · ${d.category}`;
          stats = [
            ['Сумма', <Money value={d.amount} />],
            ['В месяц', <Money value={d.monthly} />],
            ['Следующее списание', d.nextPayment ? relDate(d.nextPayment, today) : '—'],
            ['Статус', SUB_STATUS_LABEL[d.status]],
          ];
          if (d.status === 'active')
            action = (
              <button className="btn small primary" onClick={() => pay.mutate({ path })} disabled={pay.isPending || !d.amount}>
                <Check size={14} /> Оплачено {rub(d.amount)}
              </button>
            );
        } else if ('recurrence' in d) {
          sub = `Платёж · ${RECURRENCE_LABEL[d.recurrence]}${d.category ? ` · ${d.category}` : ''}`;
          stats = [
            ['Сумма', <Money value={d.amount} />],
            ['Дата', d.date ? relDate(d.date, today) : '—'],
            ['Статус', PAYMENT_STATUS_LABEL[d.status]],
            ['Получатель', <RefLink r={d.contact} type="contact" />],
          ];
          if (d.status === 'planned')
            action = (
              <button className="btn small primary" onClick={() => pay.mutate({ path })} disabled={pay.isPending || !d.amount}>
                <Check size={14} /> Оплачено {rub(d.amount)}
              </button>
            );
        } else if ('direction' in d) {
          sub = `Долг · ${DEBT_DIRECTION_LABEL[d.direction]}${d.counterparty ? ` · ${d.counterparty.title}` : ''}`;
          stats = [
            ['Осталось', <Money value={d.remaining} />],
            ['Сумма', <Money value={d.amount} />],
            ['Платёж', d.monthlyPayment ? `${rub(d.monthlyPayment)}${d.nextPayment ? `, ${relDate(d.nextPayment, today)}` : ''}` : '—'],
            ['Погасить до', d.due ? fmtDate(d.due) : '—'],
          ];
          if (d.status === 'active') action = amountForm(d.direction === 'i_owe' ? 'Погасить' : 'Получено', (v) => debt.mutate({ path, amount: v }), debt.isPending, d.monthlyPayment ? String(d.monthlyPayment) : 'Сумма');
        } else {
          sub = `Накопления · ${SAVINGS_KIND_LABEL[d.kind]}`;
          stats = [
            ['Накоплено', <Money value={d.current} />],
            ['Цель', <Money value={d.target} />],
            ['Срок', d.deadline ? `${fmtDate(d.deadline)} ${d.deadline.slice(0, 4)}` : '—'],
            ['Нужно в месяц', <Money value={d.neededPerMonth} />],
          ];
          if (d.status === 'active')
            action = (
              <div className="stack" style={{ gap: 6 }}>
                {amountForm('Пополнить', (v) => contribute.mutate({ path, amount: v }), contribute.isPending, d.monthly ? String(d.monthly) : 'Сумма')}
                <div className="small muted">
                  Связанная цель: <RefLink r={d.goal} type="goal" />
                </div>
              </div>
            );
        }
        return (
          <Shell path={path} title={'title' in d ? d.title : ''} sub={sub} type={d.type} side={<RelatedCard related={d.related} emptyHint="Сошлитесь на эту запись из проекта или контакта." />}>
            <section className="card">
              <Stats items={stats} />
              {'progress' in d && typeof d.progress === 'number' && d.target !== null && (
                <div style={{ marginTop: 12 }}>
                  <Progress value={d.progress} tone="green" />
                </div>
              )}
              {'paidPercent' in d && (
                <div style={{ marginTop: 12 }}>
                  <Progress value={d.paidPercent} tone="green" />
                </div>
              )}
              {action && <div style={{ marginTop: 12 }}>{action}</div>}
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Операции</h3>
              {d.transactions.length === 0 ? (
                <Empty title="Операций по этой записи нет" />
              ) : (
                <ul className="list">
                  {d.transactions.map((t) => (
                    <li key={`${t.path}:${t.line}`}>
                      <Link to={noteHref(t.path)}>
                        <span className="li-main">
                          <div className="li-title">{t.description || t.category}</div>
                          <div className="li-sub">{fmtDate(t.date)} · {t.category}</div>
                        </span>
                        <Money value={t.amount} sign={t.kind === 'income' ? 'plus' : 'minus'} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>История</h3>
              <HistoryList items={d.history} empty="Истории пока нет" />
            </section>
            <SectionEditor path={path} section="notes" title="Заметки" value={d.notes} />
          </Shell>
        );
      }}
    />
  );
}

// ---------- Тренировка ----------

function WorkoutView({ path }: { path: string }) {
  const status = useAct('/api/sport/workout/status', 'Статус тренировки сохранён');
  const repeat = useAct('/api/sport/workout/repeat', (r: { workout: { date: string } }) => `Запланирована тренировка на ${fmtDate(r.workout.date)}`);
  const ex = useAct('/api/sport/workout/exercise', 'Упражнение добавлено в таблицу');
  const [form, setForm] = useState({ name: '', sets: '', reps: '', weight: '' });
  const [duration, setDuration] = useState('');
  const [repeatDate, setRepeatDate] = useState('');
  return (
    <Loaded<WorkoutDetail>
      url={`/api/sport/workout?path=${encodeURIComponent(path)}`}
      keyName={['workout', path]}
      render={(w) => (
        <Shell
          path={path}
          type="workout"
          title={w.title}
          sub={`${WORKOUT_KIND_LABEL[w.kind]}${w.date ? ` · ${fmtDate(w.date, true)}` : ''}${w.time ? ` · ${w.time}` : ''}`}
          chips={<span className={`chip ${w.status === 'done' ? 'green' : w.missed ? 'red' : ''}`}>{WORKOUT_STATUS_LABEL[w.status]}</span>}
          side={<RelatedCard related={w.related} emptyHint="Свяжите тренировку с целью в свойстве «Цель»." />}
        >
          <section className="card">
            <Stats
              items={[
                ['Длительность', w.duration ? `${w.duration} мин` : '—'],
                ['Дистанция', w.distance ? `${w.distance} км` : '—'],
                ['Нагрузка', w.effort ? `${w.effort}/5` : '—'],
                ['Упражнений', String(w.exercises.length)],
              ]}
            />
            <div className="row" style={{ marginTop: 12 }}>
              {w.status !== 'done' && (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    status.mutate({ path, status: 'done', duration: duration || undefined });
                  }}
                >
                  <input className="input" style={{ width: 90 }} inputMode="numeric" placeholder="мин" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Длительность, мин" />
                  <button className="btn small primary" type="submit" disabled={status.isPending}>
                    <Check size={14} /> Выполнено
                  </button>
                </form>
              )}
              {w.status === 'planned' && (
                <button className="btn small ghost" onClick={() => status.mutate({ path, status: 'skipped' })} disabled={status.isPending}>
                  Пропустить
                </button>
              )}
              <span className="spacer" />
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  repeat.mutate({ path, date: repeatDate || addDaysIso(w.date ?? new Date().toISOString().slice(0, 10), 7) });
                }}
              >
                <input className="input" type="date" style={{ width: 150 }} value={repeatDate} onChange={(e) => setRepeatDate(e.target.value)} aria-label="Дата повтора" />
                <button className="btn small" type="submit" disabled={repeat.isPending}>
                  <Copy size={14} /> Повторить
                </button>
              </form>
            </div>
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Упражнения</h3>
            {w.exercises.length === 0 ? (
              <Empty title="Упражнений нет" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Упражнение</th>
                      <th className="r">Подходы</th>
                      <th className="r">Повторы</th>
                      <th className="r">Вес, кг</th>
                      <th>Прошлый раз</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.exercises.map((e, i) => {
                      const prev = w.previous[e.name];
                      return (
                        <tr key={i}>
                          <td>{e.name}</td>
                          <td className="r">{e.sets ?? '—'}</td>
                          <td className="r">{e.reps ?? '—'}</td>
                          <td className="r">{e.weight ?? '—'}</td>
                          <td className="small muted">{prev ? `${fmtDate(prev.date)}: ${prev.sets ?? '—'}×${prev.reps ?? '—'}${prev.weight !== null ? `, ${prev.weight} кг` : ''}` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <form
              className="inline-form"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim()) ex.mutate({ path, ...form }, { onSuccess: () => setForm({ name: '', sets: '', reps: '', weight: '' }) });
              }}
            >
              <input className="input grow" placeholder="Упражнение" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Упражнение" />
              <input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="подходы" value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} aria-label="Подходы" />
              <input className="input" style={{ width: 80 }} placeholder="повторы" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} aria-label="Повторы" />
              <input className="input" style={{ width: 80 }} inputMode="decimal" placeholder="кг" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} aria-label="Вес" />
              <button className="btn small" type="submit" disabled={ex.isPending || !form.name.trim()}>
                <Plus size={14} /> Добавить
              </button>
            </form>
          </section>
          <SectionEditor path={path} section="notes" title="Заметки" value={w.notes} placeholder="Самочувствие, техника, что изменить" />
        </Shell>
      )}
    />
  );
}

// ---------- Чтение и обучение ----------

function LearningView({ path }: { path: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const today = health.data?.today ?? '';
  const quote = useAct('/api/learning/quote', 'Цитата добавлена');
  const action = useAct('/api/learning/action', 'Действие добавлено как задача');
  const session = useAct('/api/learning/session', 'Занятие записано в журнал');
  const [q, setQ] = useState({ text: '', page: '' });
  const [a, setA] = useState({ text: '', due: '' });
  const [s, setS] = useState({ minutes: '', text: '' });
  return (
    <Loaded<LearningDetail>
      url={`/api/learning/item?path=${encodeURIComponent(path)}`}
      keyName={['learning-item', path]}
      render={(d) => {
        if (d.type === 'skill') {
          return (
            <Shell
              path={path}
              type="skill"
              title={d.title}
              sub={`${SKILL_KIND_LABEL[d.kind]}${d.level ? ` · ${d.level}` : ''}${d.target ? ` → ${d.target}` : ''}`}
              side={<RelatedCard related={d.related} emptyHint="Укажите навык в свойстве «Навык» у книги или курса." />}
            >
              <section className="card">
                <Stats
                  items={[
                    ['Часов практики', String(d.hours)],
                    ['За 7 дней', `${d.minutes7} мин${d.weeklyMinutes ? ` из ${d.weeklyMinutes}` : ''}`],
                    ['Последнее занятие', d.lastSession ? pastDate(d.lastSession, today) : '—'],
                    ['Цель', <RefLink r={d.goal} type="goal" />],
                  ]}
                />
                <form
                  className="inline-form"
                  style={{ marginTop: 12 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (s.minutes.trim()) session.mutate({ path, ...s }, { onSuccess: () => setS({ minutes: '', text: '' }) });
                  }}
                >
                  <input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="мин" value={s.minutes} onChange={(e) => setS({ ...s, minutes: e.target.value })} aria-label="Минут" />
                  <input className="input grow" placeholder="Что делали" value={s.text} onChange={(e) => setS({ ...s, text: e.target.value })} aria-label="Что делали" />
                  <button className="btn small primary" type="submit" disabled={session.isPending || !s.minutes.trim()}>
                    Записать занятие
                  </button>
                </form>
              </section>
              <section className="card">
                <h3 className="card-title" style={{ marginBottom: 8 }}>Журнал</h3>
                <HistoryList items={d.journal.map((j) => ({ date: j.date, text: `${j.minutes} мин${j.text ? ` · ${j.text}` : ''}` }))} empty="Занятий пока нет" />
              </section>
              <section className="card">
                <h3 className="card-title" style={{ marginBottom: 8 }}>Материалы</h3>
                {d.materials.length === 0 ? (
                  <Empty title="Материалов нет" />
                ) : (
                  <ul className="list">
                    {d.materials.map((m) => (
                      <li key={m.path}>
                        <Link to={`/item?path=${encodeURIComponent(m.path)}`}>
                          <span className="type-dot book" />
                          <span className="li-main">{m.title}</span>
                          <span className="chip">{LEARN_STATUS_LABEL[m.status]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card">
                <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
                {d.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={d.tasks} today={today} showSource={false} />}
                <AddTaskInline path={path} placeholder="Например: записаться на разговорный клуб" />
              </section>
              <SectionEditor path={path} section="why" title="Зачем" value={d.why} />
            </Shell>
          );
        }
        return (
          <Shell
            path={path}
            type={d.type}
            title={d.title}
            sub={`${MATERIAL_TYPE_LABEL[d.type]}${d.author ? ` · ${d.author}` : ''}`}
            chips={<span className={`chip ${d.status === 'active' ? 'blue' : d.status === 'done' ? 'green' : ''}`}>{LEARN_STATUS_LABEL[d.status]}</span>}
            side={<RelatedCard related={d.related} emptyHint="Свяжите материал с навыком, целью или проектом в свойствах." />}
          >
            <section className="card">
              <Stats
                items={[
                  ['Прогресс', `${d.percent}%`],
                  ['Начато', d.started ? fmtDate(d.started) : '—'],
                  ['Закончено', d.finished ? fmtDate(d.finished) : '—'],
                  ['Навык', <RefLink r={d.skill} type="skill" />],
                ]}
              />
              <div style={{ marginTop: 12 }}>
                <Progress value={d.percent} tone="blue" />
              </div>
              <div style={{ marginTop: 12 }}>
                <ProgressForm item={d} />
              </div>
              {d.url && (
                <div className="small" style={{ marginTop: 10 }}>
                  <a href={d.url} target="_blank" rel="noreferrer noopener">
                    {d.url}
                  </a>
                </div>
              )}
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Практические действия</h3>
              {d.actions.length === 0 ? <Empty title="Действий пока нет">Что из прочитанного применить? Действие станет задачей и появится в «Сегодня» или бэклоге.</Empty> : <TaskList tasks={d.actions} today={today} showSource={false} />}
              <form
                className="inline-form"
                style={{ marginTop: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (a.text.trim()) action.mutate({ path, text: a.text, due: a.due || null }, { onSuccess: () => setA({ text: '', due: '' }) });
                }}
              >
                <input className="input grow" placeholder="Что сделать на практике" value={a.text} onChange={(e) => setA({ ...a, text: e.target.value })} aria-label="Практическое действие" />
                <input className="input" type="date" style={{ width: 150 }} value={a.due} onChange={(e) => setA({ ...a, due: e.target.value })} aria-label="Срок действия" />
                <button className="btn small" type="submit" disabled={action.isPending || !a.text.trim()}>
                  <Plus size={14} /> Действие
                </button>
              </form>
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Цитаты</h3>
              {d.quoteList.length === 0 ? (
                <Empty title="Цитат нет" />
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {d.quoteList.map((x, i) => (
                    <blockquote key={i} className="quote">
                      {x}
                    </blockquote>
                  ))}
                </div>
              )}
              <form
                className="inline-form"
                style={{ marginTop: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (q.text.trim()) quote.mutate({ path, ...q }, { onSuccess: () => setQ({ text: '', page: '' }) });
                }}
              >
                <input className="input grow" placeholder="Текст цитаты" value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} aria-label="Текст цитаты" />
                <input className="input" style={{ width: 80 }} placeholder="стр." value={q.page} onChange={(e) => setQ({ ...q, page: e.target.value })} aria-label="Страница" />
                <button className="btn small" type="submit" disabled={quote.isPending || !q.text.trim()}>
                  <Plus size={14} /> Цитата
                </button>
              </form>
            </section>
            <SectionEditor path={path} section="summary" title="Конспект" value={d.summary} rows={7} />
            <SectionEditor path={path} section="takeaways" title="Выводы" value={d.takeaways} placeholder="Главные мысли и что я понял" />
          </Shell>
        );
      }}
    />
  );
}

// ---------- Техника ----------

function ApplianceView({ path }: { path: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const today = health.data?.today ?? '';
  const service = useAct('/api/home/service', 'Запись об обслуживании добавлена');
  const [f, setF] = useState({ text: '', cost: '' });
  return (
    <Loaded<ApplianceDetail>
      url={`/api/home/appliance?path=${encodeURIComponent(path)}`}
      keyName={['appliance', path]}
      render={(a) => (
        <Shell
          path={path}
          type="appliance"
          title={a.title}
          sub={[a.brand, a.model, a.room].filter(Boolean).join(' · ') || 'Техника'}
          chips={<span className="chip">{APPLIANCE_STATUS_LABEL[a.status]}</span>}
          side={<RelatedCard related={a.related} emptyHint="Сошлитесь на гарантийный талон из раздела «Документы»." />}
        >
          <section className="card">
            <Stats
              items={[
                ['Куплено', a.purchased ? `${fmtDate(a.purchased)} ${a.purchased.slice(0, 4)}` : '—'],
                ['Цена', <Money value={a.price} />],
                ['Гарантия до', a.warrantyUntil ? `${fmtDate(a.warrantyUntil)} ${a.warrantyUntil.slice(0, 4)}` : '—'],
                ['Магазин', a.store ?? '—'],
              ]}
            />
            {a.warrantyState === 'expiring' && <div className="small" style={{ marginTop: 10, color: 'var(--amber)' }}>Гарантия заканчивается через {a.warrantyDaysLeft} дн. — проверьте технику, пока ремонт бесплатный.</div>}
            {a.manual && (
              <div className="small" style={{ marginTop: 10 }}>
                Инструкция:{' '}
                <a href={a.manual} target="_blank" rel="noreferrer noopener">
                  {a.manual}
                </a>
              </div>
            )}
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Обслуживание и ремонт</h3>
            <HistoryList items={a.service} empty="Записей пока нет" />
            <form
              className="inline-form"
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (f.text.trim()) service.mutate({ path, text: f.text, cost: f.cost || null }, { onSuccess: () => setF({ text: '', cost: '' }) });
              }}
            >
              <input className="input grow" placeholder="Что сделали: чистка, ремонт…" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Что сделали" />
              <input className="input" style={{ width: 110 }} inputMode="decimal" placeholder="₽" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} aria-label="Стоимость" title="Если указать стоимость, расход попадёт в «Финансы»" />
              <button className="btn small" type="submit" disabled={service.isPending || !f.text.trim()}>
                <Plus size={14} /> Записать
              </button>
            </form>
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
            {a.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={a.tasks} today={today} showSource={false} />}
            <AddTaskInline path={path} placeholder="Например: вызвать мастера" />
          </section>
          <SectionEditor path={path} section="notes" title="Заметки" value={a.notes} />
        </Shell>
      )}
    />
  );
}

// ---------- Регулярное дело ----------

function RoutineView({ path }: { path: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const today = health.data?.today ?? '';
  const done = useAct('/api/routines/done', 'Отмечено');
  return (
    <Loaded<RoutineDetail>
      url={`/api/routine?path=${encodeURIComponent(path)}`}
      keyName={['routine', path]}
      render={(r) => (
        <Shell
          path={path}
          type="routine"
          title={r.title}
          sub={`Регулярное дело · ${SPHERE_LABEL[r.sphere]} · раз в ${r.every} дн.`}
          chips={<span className={`chip ${r.due === 'overdue' ? 'red' : r.due === 'today' ? 'amber' : ''}`}>{routineWhen(r, today)}</span>}
          side={<RelatedCard related={r.related} emptyHint="Сошлитесь на дело из проекта или заметки." />}
        >
          <section className="card">
            <Stats
              items={[
                ['Последний раз', r.lastDone ? pastDate(r.lastDone, today) : 'ещё не делали'],
                ['Следующий раз', relDate(r.next, today)],
                ['За 30 дней', `${r.done30} раз`],
                ['Время', r.time ?? '—'],
              ]}
            />
            {r.active && r.lastDone !== today && (
              <button className="btn small primary" style={{ marginTop: 12 }} onClick={() => done.mutate({ path })} disabled={done.isPending}>
                <Check size={14} /> Сделано сегодня
              </button>
            )}
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>История</h3>
            <HistoryList items={r.history} empty="Ещё ни разу не отмечено" />
          </section>
          <SectionEditor path={path} section="notes" title="Заметки" value={r.notes} />
        </Shell>
      )}
    />
  );
}
