import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Briefcase, CalendarClock, ExternalLink, FileText, FlaskConical, ListPlus, Plus } from 'lucide-react';
import { api, type Health, type VacancyDTO, type VacancyDetail, type WorkData } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { CreateEntityModal, EditEntityCard, HistoryList, RefLink, RelatedCard, SectionEditor } from '../components/Entities.tsx';
import { Empty, ErrorBox, Loading, fmtDate, noteHref, relDate, useToast } from '../components/ui.tsx';
import { MATERIAL_FIELDS, VACANCY_ACTIVE, VACANCY_FIELDS, VACANCY_STATUSES, VACANCY_STATUS_LABEL, type VacancyStatus } from '../entities.ts';
import { DeleteNoteButton } from '../components/DeleteNote.tsx';

const FILTERS = ['active', ...VACANCY_STATUSES, 'all'] as const;

export function VacancyStatusChip({ status }: { status: string }) {
  const tone =
    status === 'offer' ? 'green' : status === 'rejected' || status === 'archived' ? '' : status === 'interview' || status === 'test' ? 'amber' : 'blue';
  return <span className={`chip ${tone}`}>{VACANCY_STATUS_LABEL[status as VacancyStatus] ?? status}</span>;
}

export function WorkPage() {
  const q = useQuery({ queryKey: ['work'], queryFn: () => api.get<WorkData>('/api/work') });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('active');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState<null | 'vacancy' | 'resume' | 'portfolio'>(null);
  const nav = useNavigate();

  const list = useMemo(() => {
    const all = q.data?.vacancies ?? [];
    const t = text.trim().toLowerCase();
    return all.filter(
      (v) =>
        (filter === 'all' || (filter === 'active' ? VACANCY_ACTIVE.includes(v.status) : v.status === filter)) &&
        (!t || `${v.title} ${v.company?.title ?? ''} ${v.position} ${v.source ?? ''}`.toLowerCase().includes(t)),
    );
  }, [q.data, filter, text]);

  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const w = q.data;

  return (
    <div className="stack">
      <div className="pipeline" aria-label="Воронка откликов">
        {VACANCY_STATUSES.filter((s) => s !== 'archived').map((s) => (
          <button key={s} className={`stage ${filter === s ? 'on' : ''}`} onClick={() => setFilter(filter === s ? 'active' : s)}>
            <span className="v">{w.byStatus[s] ?? 0}</span>
            <span className="l">{VACANCY_STATUS_LABEL[s]}</span>
          </button>
        ))}
      </div>

      <div className="grid cols-3">
        <div className="stack">
          <div className="filters">
            <div className="tabs" role="tablist">
              {(['active', 'all'] as const).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'active' ? `В работе · ${w.active}` : `Все · ${w.vacancies.length}`}
                </button>
              ))}
              {filter !== 'active' && filter !== 'all' && <button className="on">{VACANCY_STATUS_LABEL[filter]}</button>}
            </div>
            <input className="input" placeholder="Компания, должность, источник" value={text} onChange={(e) => setText(e.target.value)} aria-label="Фильтр вакансий" />
            <span className="spacer" />
            <button className="btn primary" onClick={() => setCreating('vacancy')}>
              <Plus size={16} /> Вакансия
            </button>
          </div>

          {list.length === 0 ? (
            <div className="card">
              <Empty
                icon={<Briefcase size={18} />}
                title={w.vacancies.length === 0 ? 'Вакансий пока нет' : 'Нет вакансий по этому фильтру'}
                action={w.vacancies.length === 0 ? <button className="btn small" onClick={() => setCreating('vacancy')}>Добавить первую вакансию</button> : undefined}
              >
                {w.vacancies.length === 0 && 'Вакансия — заметка с type: vacancy. Статусы: Интересно → Отклик → Ответ → Собеседование → Тестовое → Оффер / Отказ → Архив.'}
              </Empty>
            </div>
          ) : (
            <div className="card" style={{ padding: 8 }}>
              <ul className="list">
                {list.map((v) => (
                  <VacancyRow key={v.path} v={v} today={w.today} />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 8 }}>
              <CalendarClock size={16} /> Собеседования
            </h2>
            {w.interviews.length === 0 ? (
              <Empty title="Собеседований не запланировано">Назначьте его в карточке вакансии — дата попадёт в календарь.</Empty>
            ) : (
              <ul className="list">
                {w.interviews.map((v) => (
                  <li key={v.path}>
                    <Link to={`/work/view?path=${encodeURIComponent(v.path)}`}>
                      <span className="type-dot vacancy" />
                      <span className="li-main">
                        <div className="li-title">{v.title}</div>
                        <div className="li-sub">
                          {relDate(v.interview!, w.today)}
                          {v.interviewTime ? ` · ${v.interviewTime}` : ''}
                        </div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {w.attention.length > 0 && (
            <section className="card">
              <h2 className="card-title" style={{ marginBottom: 8, color: 'var(--red)' }}>
                <AlertTriangle size={16} /> Требуют внимания
              </h2>
              <ul className="list">
                {w.attention.map((v) => (
                  <li key={v.path}>
                    <Link to={`/work/view?path=${encodeURIComponent(v.path)}`}>
                      <span className="li-main">
                        <div className="li-title">{v.title}</div>
                        <div className="li-sub">{v.nextStep ?? 'Просрочен шаг или задача'}</div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <FileText size={16} /> Резюме и портфолио
              </h2>
            </div>
            {w.materials.length === 0 ? (
              <Empty title="Материалов пока нет">Добавьте версию резюме, чтобы отмечать, с какой вы откликались.</Empty>
            ) : (
              <ul className="list">
                {w.materials.map((m) => (
                  <li key={m.path}>
                    <Link to={noteHref(m.path)}>
                      <span className="li-main">
                        <div className="li-title">
                          {m.title} {m.version && <span className="chip">{m.version}</span>}
                        </div>
                        <div className="li-sub">
                          {m.type === 'resume' ? 'Резюме' : 'Портфолио'}
                          {m.updated ? ` · обновлено ${fmtDate(m.updated)}` : ''} · откликов: {m.usedIn}
                        </div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setCreating('resume')}>
                <Plus size={14} /> Резюме
              </button>
              <button className="btn small" onClick={() => setCreating('portfolio')}>
                <Plus size={14} /> Портфолио
              </button>
            </div>
          </section>

          <section className="card small muted">
            Отклики: {w.vacancies.filter((v) => v.applied).length}
            {w.responseRate !== null && <> · ответили {w.responseRate}%</>}. Компании-работодатели — в разделе{' '}
            <Link to="/contacts?tab=companies">Контакты</Link>.
          </section>
        </div>
      </div>

      {creating === 'vacancy' && (
        <CreateEntityModal
          type="vacancy"
          heading="Новая вакансия"
          titleLabel="Название (например, «PM — Acme»)"
          defs={VACANCY_FIELDS.filter((d) => !['result', 'next_step', 'next_date', 'applied'].includes(d.key))}
          initial={{ status: 'interesting' }}
          textLabel="Описание вакансии"
          folderHint="Заметка в папке «Работа/Вакансии»"
          companyOption
          onClose={() => setCreating(null)}
          onCreated={(path) => nav(`/work/view?path=${encodeURIComponent(path)}`)}
        />
      )}
      {(creating === 'resume' || creating === 'portfolio') && (
        <CreateEntityModal
          type={creating}
          heading={creating === 'resume' ? 'Новая версия резюме' : 'Новое портфолио'}
          defs={MATERIAL_FIELDS}
          textLabel="Что в этой версии"
          folderHint="Заметка в папке «Работа/Материалы»"
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function VacancyRow({ v, today }: { v: VacancyDTO; today: string }) {
  return (
    <li>
      <Link to={`/work/view?path=${encodeURIComponent(v.path)}`}>
        <span className="type-dot vacancy" />
        <span className="li-main">
          <div className="li-title">{v.title}</div>
          <div className="li-sub">
            {[v.company?.title, v.salary, v.applied ? `отклик ${fmtDate(v.applied)}` : null].filter(Boolean).join(' · ')}
            {v.nextStep && (
              <>
                {' '}
                · <span style={{ color: v.nextDate && v.nextDate < today ? 'var(--red)' : undefined }}>шаг: {v.nextStep}{v.nextDate ? ` (${relDate(v.nextDate, today)})` : ''}</span>
              </>
            )}
          </div>
        </span>
        {v.attention && <AlertTriangle size={14} style={{ color: 'var(--red)' }} aria-label="Требует внимания" />}
        <VacancyStatusChip status={v.status} />
      </Link>
    </li>
  );
}

export function VacancyPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['vacancy', path], queryFn: () => api.get<VacancyDetail>(`/api/vacancy?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [interview, setInterview] = useState({ date: '', time: '', format: '' });
  const [test, setTest] = useState({ due: '', text: '' });
  const onError = (e: Error) => toast(e.message, 'error');
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries();
  };
  const status = useMutation({
    mutationFn: (s: VacancyStatus) => api.post('/api/vacancy/status', { path, status: s, comment }),
    onSuccess: () => {
      setComment('');
      done('Статус изменён, запись добавлена в историю')();
    },
    onError,
  });
  const iv = useMutation({
    mutationFn: () => api.post('/api/vacancy/interview', { path, ...interview }),
    onSuccess: () => {
      setInterview({ date: '', time: '', format: '' });
      done('Собеседование добавлено в календарь')();
    },
    onError,
  });
  const ts = useMutation({
    mutationFn: () => api.post('/api/vacancy/test', { path, ...test }),
    onSuccess: () => {
      setTest({ due: '', text: '' });
      done('Задача по тестовому создана')();
    },
    onError,
  });
  const stepTask = useMutation({
    mutationFn: (v: VacancyDetail) => api.post('/api/tasks', { text: v.nextStep, due: v.nextDate, path }),
    onSuccess: done('Следующий шаг добавлен задачей'),
    onError,
  });

  if (!path) return <Empty title="Вакансия не выбрана" action={<Link to="/work" className="btn small">К вакансиям</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;
  const today = health.data?.today ?? '';
  const open = v.tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const closed = v.tasks.filter((t) => t.status === 'done');
  const stepAlreadyTask = !!v.nextStep && open.some((t) => t.title === v.nextStep);
  const idx = VACANCY_STATUSES.indexOf(v.status);

  return (
    <div className="stack">
      <div className="row">
        <Link to="/work" className="btn small ghost">
          <ArrowLeft size={14} /> Работа
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{v.title}</h2>
                <div className="small muted">
                  {v.position} · <RefLink r={v.company} type="company" />
                  {v.salary ? ` · ${v.salary}` : ''}
                </div>
              </div>
              <VacancyStatusChip status={v.status} />
              {v.url && (
                <a className="btn small" href={v.url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={14} /> Вакансия
                </a>
              )}
              <Link className="btn small" to={noteHref(v.path)}>
                <FileText size={14} /> Заметка
              </Link>
              <DeleteNoteButton path={v.path} title={v.title} after="/work" />
            </div>

            <div className="steps" aria-label="Этапы">
              {VACANCY_STATUSES.filter((s) => s !== 'archived').map((s, i) => (
                <button
                  key={s}
                  className={`step ${s === v.status ? 'on' : ''} ${i < idx && v.status !== 'rejected' ? 'past' : ''}`}
                  disabled={status.isPending || s === v.status}
                  onClick={() => status.mutate(s)}
                  title={`Перевести в «${VACANCY_STATUS_LABEL[s]}»`}
                >
                  {VACANCY_STATUS_LABEL[s]}
                </button>
              ))}
              <button className={`step ${v.status === 'archived' ? 'on' : ''}`} disabled={status.isPending || v.status === 'archived'} onClick={() => status.mutate('archived')}>
                В архив
              </button>
            </div>
            <input
              className="input"
              style={{ marginTop: 8 }}
              placeholder="Комментарий к смене статуса (необязательно)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-label="Комментарий к смене статуса"
            />

            <div className="stat" style={{ marginTop: 14 }}>
              <div className="l">Следующий шаг</div>
              <div className="row">
                <div style={{ fontWeight: 500, flex: 1 }}>
                  {v.nextStep ?? 'Не задан — заполните поле «Следующий шаг» справа'}
                  {v.nextDate && <span className="small muted"> · {fmtDate(v.nextDate)}</span>}
                </div>
                {v.nextStep && !stepAlreadyTask && (
                  <button className="btn small" onClick={() => stepTask.mutate(v)} disabled={stepTask.isPending}>
                    <ListPlus size={14} /> Сделать задачей
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">Задачи по вакансии</h3>
              <span className="card-sub">видны в «Сегодня» и в проекте{v.project?.title ? ` «${v.project.title}»` : ''}</span>
            </div>
            {open.length === 0 ? <Empty title="Открытых задач нет" /> : <TaskList tasks={open} today={today} showSource={false} />}
            <AddTaskInline path={v.path} placeholder="Например: подготовить вопросы к интервью завтра" />
            {closed.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>Выполнено · {closed.length}</summary>
                <TaskList tasks={closed} today={today} showSource={false} />
              </details>
            )}
          </section>

          <div className="grid cols-2">
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 10 }}>
                <CalendarClock size={16} /> Собеседование
              </h3>
              {v.interview && (
                <div className="small" style={{ marginBottom: 8 }}>
                  Ближайшее: <strong>{fmtDate(v.interview)}{v.interviewTime ? `, ${v.interviewTime}` : ''}</strong>
                </div>
              )}
              <form
                className="stack"
                style={{ gap: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (interview.date) iv.mutate();
                }}
              >
                <div className="row">
                  <input type="date" className="input" style={{ flex: 1 }} value={interview.date} onChange={(e) => setInterview({ ...interview, date: e.target.value })} aria-label="Дата собеседования" required />
                  <input type="time" className="input" style={{ width: 110 }} value={interview.time} onChange={(e) => setInterview({ ...interview, time: e.target.value })} aria-label="Время" />
                </div>
                <input className="input" placeholder="Формат, с кем (Zoom, CPO…)" value={interview.format} onChange={(e) => setInterview({ ...interview, format: e.target.value })} aria-label="Формат собеседования" />
                <button className="btn small" type="submit" disabled={!interview.date || iv.isPending}>Назначить</button>
              </form>
              {v.interviews && <div className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{v.interviews}</div>}
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 10 }}>
                <FlaskConical size={16} /> Тестовое задание
              </h3>
              {v.testDue && (
                <div className="small" style={{ marginBottom: 8 }}>
                  Срок: <strong>{fmtDate(v.testDue)}</strong>
                </div>
              )}
              <form
                className="stack"
                style={{ gap: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (test.due) ts.mutate();
                }}
              >
                <input type="date" className="input" value={test.due} onChange={(e) => setTest({ ...test, due: e.target.value })} aria-label="Срок тестового" required />
                <input className="input" placeholder="Что нужно сделать" value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} aria-label="Описание тестового" />
                <button className="btn small" type="submit" disabled={!test.due || ts.isPending}>Добавить задачу</button>
              </form>
            </section>
          </div>

          <SectionEditor path={v.path} section="cover_letter" title="Сопроводительное письмо" value={v.coverLetter} rows={7} placeholder="Текст письма хранится в заметке вакансии" />
          <SectionEditor path={v.path} section="description" title="Описание и требования" value={v.description} />

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>История</h3>
            <HistoryList items={v.history} empty="История пуста" />
          </section>
        </div>

        <div className="stack">
          <EditEntityCard path={v.path} defs={VACANCY_FIELDS} />
          <section className="card small">
            <div>Рекрутер: <RefLink r={v.recruiter} type="contact" /></div>
            <div>Резюме: <RefLink r={v.resume} type="resume" /></div>
            <div>Проект: <RefLink r={v.project} type="project" /></div>
          </section>
          <RelatedCard related={v.related} emptyHint="Свяжите вакансию с компанией, рекрутером и проектом в свойствах." />
        </div>
      </div>
    </div>
  );
}
