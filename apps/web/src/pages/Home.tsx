import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, CalendarClock, CheckCircle2, Dumbbell, FolderKanban, Repeat, Target, Wallet } from 'lucide-react';
import { entityHref } from '../entities.ts';
import { api, type Dashboard, type CycleDTO } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { MonthCalendar } from '../components/Calendar.tsx';
import { TodoistPanel } from '../components/Todoist.tsx';
import { ObligationList, RoutineList } from '../components/Spheres.tsx';
import { WorkoutLine } from './Health.tsx';
import { NextTripCard, OccasionLine, TouchButton, dueLabel } from '../components/Personal.tsx';
import { Empty, ErrorBox, Loading, Progress, TYPE_LABEL, plural, relDate } from '../components/ui.tsx';

export function HomePage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard') });
  const [anchor, setAnchor] = useState<string | null>(null);
  const nav = useNavigate();
  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Stat to="/today" value={d.todayTasks.length} label="задач на сегодня" />
        <Stat to="/today" value={d.overdue.length} label="просрочено" tone={d.overdue.length ? 'var(--red)' : undefined} />
        <Stat to="/today" value={d.doneToday.length} label="сделано сегодня" />
        <Stat to="/backlog" value={d.backlogCount} label="в бэклоге" />
        <Stat to="/ideas" value={d.ideasNew} label={plural(d.ideasNew, 'новая идея', 'новые идеи', 'новых идей')} />
      </div>

      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <CheckCircle2 size={16} /> Сегодня
              </h2>
              <Link to="/today" className="btn small ghost">
                План дня <ArrowRight size={14} />
              </Link>
            </div>
            {d.overdue.length > 0 && (
              <>
                <div className="small" style={{ color: 'var(--red)', fontWeight: 600, margin: '4px 8px' }}>
                  Просрочено · {d.overdue.length}
                </div>
                <TaskList tasks={d.overdue} today={d.today} />
                <div style={{ height: 10 }} />
              </>
            )}
            {d.todayTasks.length === 0 && d.overdue.length === 0 ? (
              <Empty title="На сегодня задач нет">
                Добавьте задачу ниже или возьмите что-то из <Link to="/backlog">бэклога</Link>.
              </Empty>
            ) : (
              <TaskList tasks={d.todayTasks} today={d.today} />
            )}
            <AddTaskInline due={d.today} placeholder="Задача на сегодня…" />
          </section>

          <TodoistPanel today={d.today} />

          <LifeCard d={d} />

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <CalendarClock size={16} /> События, платежи и сроки
              </h2>
              <span className="card-sub">сегодня и 14 дней вперёд</span>
            </div>
            {d.todayEvents.length === 0 && d.events.length === 0 ? (
              <Empty title="Ближайших событий нет">
                Событием считается любая заметка со свойством <code>date</code>, например <code>type: payment</code> или <code>type: workout</code>.
              </Empty>
            ) : (
              <ul className="list">
                {[...d.todayEvents.map((e) => ({ ...e, date: d.today })), ...d.events].map((e, i) => (
                  <li key={`${e.path}-${i}`}>
                    <Link to={entityHref(e.kind === 'task' ? 'note' : e.noteType, e.path)}>
                      <span className={`type-dot ${e.kind === 'deadline' ? '' : e.kind === 'event' ? e.noteType : ''}`} style={e.kind === 'deadline' ? { background: 'var(--red)' } : undefined} />
                      <span className="li-main">
                        <div className="li-title">{e.title}</div>
                        <div className="li-sub">
                          {relDate(e.date, d.today)}
                          {e.kind === 'event' && e.time ? ` · ${e.time}` : ''}
                          {e.kind === 'event' && e.amount !== null ? ` · ${e.amount.toLocaleString('ru-RU')} ₽` : ''}
                        </div>
                      </span>
                      <span className="chip">{e.kind === 'deadline' ? 'Срок' : TYPE_LABEL[e.kind === 'event' ? e.noteType : 'note'] ?? 'Событие'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <FolderKanban size={16} /> Активные проекты
              </h2>
              <Link to="/projects" className="btn small ghost">
                Все · {d.projectsTotal} <ArrowRight size={14} />
              </Link>
            </div>
            {d.projects.length === 0 ? (
              <Empty title="Активных проектов нет" action={<Link className="btn small" to="/projects">Создать проект</Link>} />
            ) : (
              <div className="grid cols-auto">
                {d.projects.map((p) => (
                  <Link key={p.path} to={`/projects/view?path=${encodeURIComponent(p.path)}`} className="stat" style={{ display: 'grid', gap: 8 }}>
                    <div className="row">
                      <strong style={{ flex: 1 }}>{p.title}</strong>
                      {p.tasksOverdue > 0 && <span className="chip red">{p.tasksOverdue} просроч.</span>}
                    </div>
                    <Progress value={p.progress} tone="blue" />
                    <div className="small muted">
                      {p.progress}% · {p.tasksDone}/{p.tasksTotal}
                      {p.deadline ? ` · до ${relDate(p.deadline, d.today)}` : ''}
                    </div>
                    {p.nextStep && <div className="small">→ {p.nextStep}</div>}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <CycleHero cycle={d.cycle} />
          <RemindersCard d={d} />
          <NextTripCard t={d.spheres.nextTrip} today={d.today} />
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Target size={16} /> Приоритеты дня
              </h2>
              <Link to="/today" className="btn small ghost">
                Изменить
              </Link>
            </div>
            {d.priorities.trim() ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{d.priorities}</div>
            ) : (
              <Empty title="Приоритеты не заданы">Выберите 1–3 главных дела в разделе «Сегодня».</Empty>
            )}
          </section>
          <section className="card">
            <MonthCalendar anchor={anchor ?? d.today} today={d.today} onAnchor={setAnchor} onSelect={(date) => nav(`/today?date=${date}`)} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Платежи на неделю, тренировки и регулярные дела на сегодня. */
function LifeCard({ d }: { d: Dashboard }) {
  const s = d.spheres;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Wallet size={16} /> Платежи на 7 дней
        </h2>
        <Link to="/finance" className="btn small ghost">
          {s.obligations.length ? `${s.obligationsTotal.toLocaleString('ru-RU')} ₽` : 'Финансы'} <ArrowRight size={14} />
        </Link>
      </div>
      <ObligationList items={s.obligations} today={d.today} empty="На неделю платежей нет" />
      <div className="card-head" style={{ marginTop: 16 }}>
        <h2 className="card-title">
          <Dumbbell size={16} /> Тренировки сегодня
        </h2>
        <Link to="/health" className="btn small ghost">
          Здоровье <ArrowRight size={14} />
        </Link>
      </div>
      {s.workoutsToday.length === 0 ? (
        <Empty title="Сегодня тренировок нет" />
      ) : (
        <ul className="list">
          {s.workoutsToday.map((w) => (
            <li key={w.path}>
              <WorkoutLine w={w} today={d.today} />
            </li>
          ))}
        </ul>
      )}
      <div className="card-head" style={{ marginTop: 16 }}>
        <h2 className="card-title">
          <Repeat size={16} /> Регулярное на сегодня
        </h2>
      </div>
      {s.routinesDue.length === 0 ? <Empty title="Всё регулярное сделано" /> : <RoutineList routines={s.routinesDue} today={d.today} showSphere />}
    </section>
  );
}

/** Кому пора написать, какие документы продлить, ближайшие собеседования. */
function RemindersCard({ d }: { d: Dashboard }) {
  const r = d.reminders;
  const warranties = d.spheres.warranties;
  const occasions = d.spheres.occasions;
  const due = d.spheres.contactsDue;
  const total = r.followUps.length + r.documents.length + r.interviews.length + warranties.length + occasions.length + due.length;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <BellRing size={16} /> Напоминания
        </h2>
        <Link to="/work" className="btn small ghost">
          Вакансий в работе · {r.vacanciesActive}
        </Link>
      </div>
      {total === 0 ? (
        <Empty title="Ничего не горит">Здесь появятся дни рождения, контакты, с которыми пора связаться, документы на продление и собеседования.</Empty>
      ) : (
        <ul className="list">
          {occasions.map((o) => (
            <li key={o.key}>
              <OccasionLine o={o} today={d.today} />
            </li>
          ))}
          {due.map((p) => (
            <li key={p.path}>
              <div className="li">
                <span className="type-dot contact" />
                <Link to={entityHref('contact', p.path)} className="li-main">
                  <div className="li-title">Написать: {p.title}</div>
                  <div className="li-sub" style={{ color: p.dueState === 'overdue' ? 'var(--red)' : undefined }}>{dueLabel(p, d.today)}</div>
                </Link>
                <TouchButton path={p.path} title={p.title} />
              </div>
            </li>
          ))}
          {r.interviews.map((v) => (
            <li key={v.path}>
              <Link to={entityHref('vacancy', v.path)}>
                <span className="type-dot vacancy" />
                <span className="li-main">
                  <div className="li-title">Собеседование: {v.title}</div>
                  <div className="li-sub">{relDate(v.interview!, d.today)}{v.interviewTime ? ` · ${v.interviewTime}` : ''}</div>
                </span>
              </Link>
            </li>
          ))}
          {r.followUps.map((c) => (
            <li key={c.path}>
              <Link to={entityHref('contact', c.path)}>
                <span className="type-dot contact" />
                <span className="li-main">
                  <div className="li-title">Связаться: {c.title}</div>
                  <div className="li-sub" style={{ color: c.followUp === 'overdue' ? 'var(--red)' : undefined }}>{relDate(c.nextContact!, d.today)}{c.company ? ` · ${c.company.title}` : ''}</div>
                </span>
              </Link>
            </li>
          ))}
          {r.documents.map((doc) => (
            <li key={doc.path}>
              <Link to={entityHref('document', doc.path)}>
                <span className="type-dot document" />
                <span className="li-main">
                  <div className="li-title">{doc.state === 'expired' ? 'Истёк' : 'Продлить'}: {doc.title}</div>
                  <div className="li-sub" style={{ color: doc.state === 'expired' ? 'var(--red)' : undefined }}>
                    действует до {relDate(doc.expires!, d.today)}{doc.renewalTask ? ' · задача создана' : ''}
                  </div>
                </span>
              </Link>
            </li>
          ))}
          {warranties.map((a) => (
            <li key={a.path}>
              <Link to={entityHref('appliance', a.path)}>
                <span className="type-dot appliance" />
                <span className="li-main">
                  <div className="li-title">Гарантия заканчивается: {a.title}</div>
                  <div className="li-sub">{relDate(a.warrantyUntil!, d.today)}</div>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ value, label, to, tone }: { value: number; label: string; to: string; tone?: string }) {
  return (
    <Link to={to} className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', color: tone }}>{value}</div>
      <div className="small muted">{label}</div>
    </Link>
  );
}

export function CycleHero({ cycle }: { cycle: CycleDTO | null }) {
  if (!cycle) {
    return (
      <section className="card">
        <Empty title="Нет текущего 12-недельного цикла" action={<Link className="btn small" to="/strategy">Начать цикл</Link>}>
          Цикл помогает держать фокус на 2–3 целях.
        </Empty>
      </section>
    );
  }
  return (
    <Link to="/strategy" className="hero-cycle" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ opacity: 0.7 }}>{cycle.title}</span>
        <span className="chip dark" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          {cycle.timeProgress}% времени
        </span>
      </div>
      <div className="big" style={{ marginTop: 16 }}>
        {cycle.week}
        <span style={{ fontSize: 20, opacity: 0.6 }}>/{cycle.weeks}</span>
      </div>
      <div className="small" style={{ opacity: 0.7 }}>неделя цикла</div>
      {cycle.focus && <div style={{ marginTop: 10 }}>{cycle.focus}</div>}
      <div className="phases">
        {cycle.phases.map((ph) => {
          const span = ph.toWeek - ph.fromWeek + 1;
          const fill = Math.max(0, Math.min(1, (cycle.week - ph.fromWeek + 1) / span));
          const on = cycle.week >= ph.fromWeek && cycle.week <= ph.toWeek;
          return (
            <div key={ph.name} className={`ph ${on ? 'on' : ''}`}>
              <div className="bar">
                <div style={{ width: `${fill * 100}%` }} />
              </div>
              {ph.name}
            </div>
          );
        })}
      </div>
    </Link>
  );
}
