import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Target } from 'lucide-react';
import { api, type Strategy } from '../api.ts';
import { Empty, ErrorBox, Loading, Progress, StatusChip, addDaysIso, fmtDate, noteHref, parseIso, relDate, toIso } from '../components/ui.tsx';
import { Modal } from '../components/Layout.tsx';
import { CycleHero } from './Home.tsx';
import { CreateProject } from './Projects.tsx';

export function StrategyPage() {
  const q = useQuery({ queryKey: ['strategy'], queryFn: () => api.get<Strategy>('/api/strategy') });
  const [goalOpen, setGoalOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [projectFor, setProjectFor] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const goals = showAll ? s.goals : s.goals.filter((g) => g.status === 'active');
  const otherCycles = s.cycles.filter((c) => c.path !== s.current?.path);

  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Target size={16} /> Цели
            </h2>
            <div className="row">
              <button className={`btn small ${showAll ? 'primary' : ''}`} onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>
                {showAll ? 'Все' : 'Активные'}
              </button>
              <button className="btn small primary" onClick={() => setGoalOpen(true)}>
                <Plus size={14} /> Цель
              </button>
            </div>
          </div>
          {goals.length === 0 ? (
            <Empty title="Целей пока нет" action={<button className="btn small" onClick={() => setGoalOpen(true)}>Сформулировать цель</button>}>
              Цель — заметка с <code>type: goal</code> или в папке целей. Проекты связываются с ней свойством <code>goal: "[[Цель]]"</code>.
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {goals.map((g) => (
                <div key={g.path} className="stat" style={{ display: 'grid', gap: 8 }}>
                  <div className="row">
                    <Link to={noteHref(g.path)} style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
                      {g.title}
                    </Link>
                    <StatusChip status={g.status} />
                    {g.horizon && <span className="chip">{g.horizon}</span>}
                    {g.deadline && <span className="chip">до {fmtDate(g.deadline)}</span>}
                  </div>
                  {g.metric && <div className="small">Метрика: {g.metric}</div>}
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <Progress value={g.progress} tone="green" />
                    </div>
                    <span className="small" style={{ minWidth: 40, textAlign: 'right' }}>{g.progress}%</span>
                  </div>
                  <div className="small muted">{g.progressSource === 'manual' ? 'Прогресс указан в свойстве progress' : 'Прогресс — среднее по связанным проектам'}</div>
                  {g.projects.length > 0 ? (
                    <ul className="list">
                      {g.projects.map((p) => (
                        <li key={p.path}>
                          <Link to={`/projects/view?path=${encodeURIComponent(p.path)}`}>
                            <span className="type-dot project" />
                            <span className="li-main">
                              <div className="li-title">{p.title}</div>
                            </span>
                            <span className="small muted">{p.progress}%</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="small muted">Нет проектов под эту цель.</div>
                  )}
                  <div>
                    <button className="btn small" onClick={() => setProjectFor(g.path)}>
                      <Plus size={14} /> Проект под цель
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {s.projectsWithoutGoal.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Проекты без цели</h2>
              <span className="card-sub">свяжите их с целью или пересмотрите</span>
            </div>
            <ul className="list">
              {s.projectsWithoutGoal.map((p) => (
                <li key={p.path}>
                  <Link to={`/projects/view?path=${encodeURIComponent(p.path)}`}>
                    <span className="type-dot project" />
                    <span className="li-main">
                      <div className="li-title">{p.title}</div>
                      <div className="li-sub">{p.progress}% · {p.nextStep ?? 'нет следующего шага'}</div>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="stack">
        <CycleHero cycle={s.current} />
        {s.current && (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Цели цикла</h2>
              <span className="card-sub">
                {fmtDate(s.current.start)} — {fmtDate(s.current.end)}
              </span>
            </div>
            {s.current.goals.length === 0 ? (
              <Empty title="Цели не привязаны">Добавьте в цели свойство cycle или в заметку цикла список goals.</Empty>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {s.current.goals.map((g) => (
                  <div key={g.path}>
                    <div className="row small" style={{ marginBottom: 4 }}>
                      <Link to={noteHref(g.path)} style={{ flex: 1 }}>{g.title}</Link>
                      {g.progress}%
                    </div>
                    <Progress value={g.progress} tone="green" />
                  </div>
                ))}
                <div className="small muted">Время цикла: {s.current.timeProgress}%. Если прогресс целей заметно отстаёт — пора пересмотреть план недели.</div>
              </div>
            )}
          </section>
        )}
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">12-недельные циклы</h2>
            <button className="btn small" onClick={() => setCycleOpen(true)}>
              <Plus size={14} /> Цикл
            </button>
          </div>
          {otherCycles.length === 0 && !s.current ? (
            <Empty title="Циклов пока нет" />
          ) : otherCycles.length === 0 ? (
            <div className="small muted">Других циклов нет.</div>
          ) : (
            <ul className="list">
              {otherCycles.map((c) => (
                <li key={c.path}>
                  <Link to={noteHref(c.path)}>
                    <span className="li-main">
                      <div className="li-title">{c.title}</div>
                      <div className="li-sub">
                        {c.state === 'planned' ? `начнётся ${relDate(c.start, s.today)}` : `завершён ${fmtDate(c.end)}`}
                      </div>
                    </span>
                    <span className="chip">{c.state === 'planned' ? 'Запланирован' : 'Завершён'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {goalOpen && <CreateGoal onClose={() => setGoalOpen(false)} cycles={s.cycles.filter((c) => c.state !== 'finished')} />}
      {cycleOpen && <CreateCycle onClose={() => setCycleOpen(false)} today={s.today} />}
      {projectFor && <CreateProject onClose={() => setProjectFor(null)} goal={projectFor} />}
    </div>
  );
}

function CreateGoal({ onClose, cycles }: { onClose: () => void; cycles: Strategy['cycles'] }) {
  const [f, setF] = useState({ title: '', horizon: '', deadline: '', area: '', metric: '', cycle: '', why: '' });
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api.post('/api/goals', {
        title: f.title,
        horizon: f.horizon || null,
        deadline: f.deadline || null,
        area: f.area || null,
        metric: f.metric || null,
        cycle: f.cycle || null,
        why: f.why || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal onClose={onClose} label="Новая цель">
      <form onSubmit={(e) => (e.preventDefault(), f.title.trim() && m.mutate())}>
        <div className="modal-head">
          <strong>Новая цель</strong>
        </div>
        <div className="modal-body">
          <label className="field">
            Формулировка
            <input className="input" autoFocus value={f.title} onChange={upd('title')} placeholder="Например: Найти работу продакт-менеджером" />
          </label>
          <label className="field">
            Как измерить результат
            <input className="input" value={f.metric} onChange={upd('metric')} placeholder="Оффер от 250 000 ₽" />
          </label>
          <div className="row">
            <label className="field" style={{ flex: '1 1 140px' }}>
              Горизонт
              <select className="select" value={f.horizon} onChange={upd('horizon')}>
                <option value="">—</option>
                <option>12 недель</option>
                <option>6 месяцев</option>
                <option>1 год</option>
                <option>3 года</option>
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              Срок
              <input type="date" className="input" value={f.deadline} onChange={upd('deadline')} />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              Сфера
              <input className="input" value={f.area} onChange={upd('area')} />
            </label>
          </div>
          {cycles.length > 0 && (
            <label className="field">
              12-недельный цикл
              <select className="select" value={f.cycle} onChange={upd('cycle')}>
                <option value="">Без цикла</option>
                {cycles.map((c) => (
                  <option key={c.path} value={c.path}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Зачем мне это
            <textarea className="textarea" rows={3} value={f.why} onChange={upd('why')} />
          </label>
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={!f.title.trim() || m.isPending}>
            Создать цель
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateCycle({ onClose, today }: { onClose: () => void; today: string }) {
  // По умолчанию цикл начинается с ближайшего понедельника.
  const dow = (parseIso(today).getDay() + 6) % 7;
  const monday = dow === 0 ? today : addDaysIso(today, 7 - dow);
  const [f, setF] = useState({ title: '', start: monday, focus: '' });
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post('/api/cycles', { title: f.title, start: f.start, focus: f.focus || null }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const end = f.start ? addDaysIso(f.start, 83) : null;
  return (
    <Modal onClose={onClose} label="Новый цикл">
      <form onSubmit={(e) => (e.preventDefault(), f.title.trim() && m.mutate())}>
        <div className="modal-head">
          <strong>Новый 12-недельный цикл</strong>
        </div>
        <div className="modal-body">
          <label className="field">
            Название
            <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={`Цикл ${parseIso(monday).getFullYear()}`} />
          </label>
          <label className="field">
            Начало
            <input type="date" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </label>
          {end && <div className="small muted">Цикл закончится {fmtDate(end)} {toIso(parseIso(end)).slice(0, 4)}.</div>}
          <label className="field">
            Фокус цикла
            <input className="input" value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })} />
          </label>
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={!f.title.trim() || !f.start || m.isPending}>
            Создать цикл
          </button>
        </div>
      </form>
    </Modal>
  );
}
