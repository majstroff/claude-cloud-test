import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText, Mail, MessageSquarePlus, Phone, Plus, Users } from 'lucide-react';
import { api, type CompanyDTO, type CompanyDetail, type ContactDTO, type ContactDetail, type Health } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { CreateEntityModal, EditEntityCard, HistoryList, RefLink, RelatedCard, SectionEditor } from '../components/Entities.tsx';
import { Empty, ErrorBox, Loading, fmtDate, noteHref, plural, relDate, useToast } from '../components/ui.tsx';
import { COMPANY_FIELDS, COMPANY_KIND_LABEL, CONTACT_FIELDS, CONTACT_KIND_LABEL, RELATION_STATUS_LABEL, entityHref } from '../entities.ts';
import { VacancyStatusChip } from './Work.tsx';
import { PersonRelationsCard } from '../components/Personal.tsx';

type ContactsData = { today: string; contacts: ContactDTO[]; companies: CompanyDTO[] };

function FollowUpChip({ c, today }: { c: ContactDTO; today: string }) {
  if (!c.nextContact) return null;
  const tone = c.followUp === 'overdue' ? 'red' : c.followUp === 'today' ? 'accent' : c.followUp === 'soon' ? 'amber' : '';
  return <span className={`chip ${tone}`}>связаться {relDate(c.nextContact, today)}</span>;
}

export function ContactsPage() {
  const q = useQuery({ queryKey: ['contacts'], queryFn: () => api.get<ContactsData>('/api/contacts') });
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'companies' ? 'companies' : 'people';
  const [kind, setKind] = useState('all');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState<null | 'contact' | 'company'>(null);
  const nav = useNavigate();

  const t = text.trim().toLowerCase();
  const people = useMemo(
    () =>
      (q.data?.contacts ?? []).filter(
        (c) =>
          (kind === 'all' || (kind === 'followup' ? !!c.followUp : c.kind === kind)) &&
          (!t || `${c.title} ${c.company?.title ?? ''} ${c.role ?? ''} ${c.email ?? ''}`.toLowerCase().includes(t)),
      ),
    [q.data, kind, t],
  );
  const companies = useMemo(
    () => (q.data?.companies ?? []).filter((c) => (kind === 'all' || c.kind === kind) && (!t || `${c.title} ${c.industry ?? ''} ${c.city ?? ''}`.toLowerCase().includes(t))),
    [q.data, kind, t],
  );

  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const followCount = d.contacts.filter((c) => c.followUp).length;
  const kinds = tab === 'people' ? CONTACT_KIND_LABEL : COMPANY_KIND_LABEL;

  return (
    <div className="stack">
      <div className="filters">
        <div className="tabs" role="tablist">
          <button
            className={tab === 'people' ? 'on' : ''}
            onClick={() => {
              setParams({});
              setKind('all');
            }}
          >
            <Users size={14} /> Люди · {d.contacts.length}
          </button>
          <button
            className={tab === 'companies' ? 'on' : ''}
            onClick={() => {
              setParams({ tab: 'companies' });
              setKind('all');
            }}
          >
            <Building2 size={14} /> Компании · {d.companies.length}
          </button>
        </div>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид">
          <option value="all">Все</option>
          {tab === 'people' && <option value="followup">Пора связаться · {followCount}</option>}
          {Object.entries(kinds).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Имя, компания, email" value={text} onChange={(e) => setText(e.target.value)} aria-label="Фильтр контактов" />
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(tab === 'people' ? 'contact' : 'company')}>
          <Plus size={16} /> {tab === 'people' ? 'Контакт' : 'Компания'}
        </button>
      </div>

      {tab === 'people' ? (
        people.length === 0 ? (
          <div className="card">
            <Empty
              icon={<Users size={18} />}
              title={d.contacts.length ? 'Нет контактов по этому фильтру' : 'Контактов пока нет'}
              action={!d.contacts.length ? <button className="btn small" onClick={() => setCreating('contact')}>Добавить контакт</button> : undefined}
            >
              {!d.contacts.length && 'Контакт — заметка с type: contact, по умолчанию в папке «Ресурсы/Контакты».'}
            </Empty>
          </div>
        ) : (
          <div className="grid cols-auto">
            {people.map((c) => (
              <Link key={c.path} to={`/contacts/view?path=${encodeURIComponent(c.path)}`} className="card contact-card">
                <div className="row">
                  <span className="avatar" aria-hidden>{initials(c.title)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.title}</div>
                    <div className="small muted">{[c.role, c.company?.title].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                </div>
                <div className="row">
                  {c.kind && <span className="chip">{CONTACT_KIND_LABEL[c.kind] ?? c.kind}</span>}
                  {c.clientStatus && <span className="chip blue">{RELATION_STATUS_LABEL[c.clientStatus] ?? c.clientStatus}</span>}
                  <FollowUpChip c={c} today={d.today} />
                </div>
                <div className="small muted">
                  {c.lastContact ? `Последняя связь: ${fmtDate(c.lastContact)} (${c.daysSinceContact} ${plural(c.daysSinceContact ?? 0, 'день', 'дня', 'дней')} назад)` : 'Связи ещё не было'}
                  {c.openTasks > 0 && ` · задач: ${c.openTasks}`}
                </div>
              </Link>
            ))}
          </div>
        )
      ) : companies.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Building2 size={18} />}
            title={d.companies.length ? 'Нет компаний по этому фильтру' : 'Компаний пока нет'}
            action={!d.companies.length ? <button className="btn small" onClick={() => setCreating('company')}>Добавить компанию</button> : undefined}
          >
            {!d.companies.length && 'Компания — заметка с type: company. Её можно указать у контакта, вакансии или документа.'}
          </Empty>
        </div>
      ) : (
        <div className="grid cols-auto">
          {companies.map((c) => (
            <Link key={c.path} to={`/contacts/company?path=${encodeURIComponent(c.path)}`} className="card contact-card">
              <div style={{ fontWeight: 600 }}>{c.title}</div>
              <div className="row">
                {c.kind && <span className="chip">{COMPANY_KIND_LABEL[c.kind] ?? c.kind}</span>}
                {c.status && <span className="chip blue">{RELATION_STATUS_LABEL[c.status] ?? c.status}</span>}
              </div>
              <div className="small muted">
                {[c.industry, c.city].filter(Boolean).join(' · ')}
                {(c.industry || c.city) && ' · '}
                людей: {c.contacts.length} · вакансий: {c.vacancies.length}
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating === 'contact' && (
        <CreateEntityModal
          type="contact"
          heading="Новый контакт"
          titleLabel="Имя"
          defs={CONTACT_FIELDS.filter((x) => x.key !== 'last_contact')}
          textLabel="Заметки о человеке"
          folderHint="Заметка в папке контактов"
          companyOption
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(`/contacts/view?path=${encodeURIComponent(p)}`)}
        />
      )}
      {creating === 'company' && (
        <CreateEntityModal
          type="company"
          heading="Новая компания"
          defs={COMPANY_FIELDS}
          initial={{ status: 'active' }}
          textLabel="Заметки"
          folderHint="Заметка в папке компаний"
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(`/contacts/company?path=${encodeURIComponent(p)}`)}
        />
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Форма «Записать общение»: история, следующий контакт, договорённость. */
function LogInteraction({ path, today, withNext = true }: { path: string; today: string; withNext?: boolean }) {
  const empty = { text: '', channel: 'звонок', date: '', nextContact: '', agreement: '', agreementDue: '' };
  const [f, setF] = useState(empty);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post('/api/contacts/log', { path, ...f, date: f.date || null }),
    onSuccess: () => {
      setF(empty);
      toast('Записано в историю общения');
      void qc.invalidateQueries();
    },
  });
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 10 }}>
        <MessageSquarePlus size={16} /> Записать общение
      </h3>
      <form
        className="stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.text.trim()) m.mutate();
        }}
      >
        <div className="row">
          <select className="select" value={f.channel} onChange={upd('channel')} aria-label="Канал">
            {['звонок', 'встреча', 'письмо', 'сообщение', 'созвон'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input type="date" className="input" value={f.date} max={today} onChange={upd('date')} aria-label="Дата (по умолчанию сегодня)" title="Дата (по умолчанию сегодня)" />
        </div>
        <textarea className="textarea" rows={2} placeholder="О чём договорились, что обсудили" value={f.text} onChange={upd('text')} aria-label="Что обсудили" required />
        {withNext && (
          <label className="field">
            Следующий контакт
            <input type="date" className="input" value={f.nextContact} min={today} onChange={upd('nextContact')} />
          </label>
        )}
        <div className="row">
          <input className="input" style={{ flex: 1 }} placeholder="Договорённость → задача (необязательно)" value={f.agreement} onChange={upd('agreement')} aria-label="Договорённость" />
          <input type="date" className="input" value={f.agreementDue} onChange={upd('agreementDue')} aria-label="Срок договорённости" />
        </div>
        {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        <button className="btn primary small" type="submit" disabled={!f.text.trim() || m.isPending}>
          Записать
        </button>
        <span className="small muted">Если запланированный контакт уже наступил и новый не указан, напоминание снимается.</span>
      </form>
    </section>
  );
}

export function ContactPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['contact', path], queryFn: () => api.get<ContactDetail>(`/api/contact?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  if (!path) return <Empty title="Контакт не выбран" action={<Link to="/contacts" className="btn small">К контактам</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const today = health.data?.today ?? '';
  return (
    <div className="stack">
      <div className="row">
        <Link to="/contacts" className="btn small ghost">
          <ArrowLeft size={14} /> Контакты
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="avatar big" aria-hidden>{initials(c.title)}</span>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{c.title}</h2>
                <div className="small muted">
                  {c.role ?? 'Должность не указана'} · <RefLink r={c.company} type="company" />
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {c.kind && <span className="chip">{CONTACT_KIND_LABEL[c.kind] ?? c.kind}</span>}
                  {c.clientStatus && <span className="chip blue">{RELATION_STATUS_LABEL[c.clientStatus]}</span>}
                  {today && <FollowUpChip c={c} today={today} />}
                </div>
              </div>
              <Link className="btn small" to={noteHref(c.path)}>
                <FileText size={14} /> Заметка
              </Link>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {c.phone && (
                <a className="btn small" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
                  <Phone size={14} /> {c.phone}
                </a>
              )}
              {c.email && (
                <a className="btn small" href={`mailto:${c.email}`}>
                  <Mail size={14} /> {c.email}
                </a>
              )}
              {c.links.map((l) =>
                /^https?:\/\//.test(l) ? (
                  <a key={l} className="btn small ghost" href={l} target="_blank" rel="noreferrer noopener">
                    {l.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
                  </a>
                ) : (
                  <span key={l} className="chip">{l}</span>
                ),
              )}
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              Последняя связь: {c.lastContact ? fmtDate(c.lastContact) : 'не было'} · Следующий контакт: {c.nextContact ? fmtDate(c.nextContact) : 'не запланирован'}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">Договорённости</h3>
              <span className="card-sub">задачи со сроками — видны в «Сегодня»</span>
            </div>
            {c.agreements.length === 0 ? <Empty title="Договорённостей нет">Добавьте их при записи общения.</Empty> : <TaskList tasks={c.agreements} today={today} showSource={false} />}
          </section>

          <PersonRelationsCard path={c.path} today={today} />

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
            {c.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={c.tasks} today={today} />}
            <AddTaskInline path={c.path} placeholder="Задача по контакту…" />
          </section>

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>История общения</h3>
            <HistoryList items={c.history} empty="Записей пока нет" />
          </section>

          <SectionEditor path={c.path} section="notes" title="Заметки" value={c.notes} />
        </div>

        <div className="stack">
          <LogInteraction path={c.path} today={today} />
          {c.vacancies.length > 0 && (
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Вакансии</h3>
              <ul className="list">
                {c.vacancies.map((v) => (
                  <li key={v.path}>
                    <Link to={entityHref('vacancy', v.path)}>
                      <span className="li-main"><div className="li-title">{v.title}</div></span>
                      <VacancyStatusChip status={v.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <EditEntityCard path={c.path} defs={CONTACT_FIELDS} />
          <RelatedCard related={c.related} emptyHint="Упомяните контакт в проекте или задаче: [[Имя]]." />
        </div>
      </div>
    </div>
  );
}

export function CompanyPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['company', path], queryFn: () => api.get<CompanyDetail>(`/api/company?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  if (!path) return <Empty title="Компания не выбрана" action={<Link to="/contacts?tab=companies" className="btn small">К компаниям</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const today = health.data?.today ?? '';
  return (
    <div className="stack">
      <div className="row">
        <Link to="/contacts?tab=companies" className="btn small ghost">
          <ArrowLeft size={14} /> Компании
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{c.title}</h2>
                <div className="small muted">{[c.industry, c.city].filter(Boolean).join(' · ') || 'Отрасль и город не указаны'}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  {c.kind && <span className="chip">{COMPANY_KIND_LABEL[c.kind] ?? c.kind}</span>}
                  {c.status && <span className="chip blue">{RELATION_STATUS_LABEL[c.status] ?? c.status}</span>}
                </div>
              </div>
              {c.website && (
                <a className="btn small" href={c.website} target="_blank" rel="noreferrer noopener">Сайт</a>
              )}
              <Link className="btn small" to={noteHref(c.path)}>
                <FileText size={14} /> Заметка
              </Link>
            </div>
          </section>
          <div className="grid cols-2">
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Люди</h3>
              {c.contacts.length === 0 ? (
                <Empty title="Контактов нет">Укажите компанию в карточке человека.</Empty>
              ) : (
                <ul className="list">
                  {c.contacts.map((p) => (
                    <li key={p.path ?? p.title}>
                      <Link to={entityHref('contact', p.path!)}><span className="li-main"><div className="li-title">{p.title}</div></span></Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Вакансии</h3>
              {c.vacancies.length === 0 ? (
                <Empty title="Вакансий нет" />
              ) : (
                <ul className="list">
                  {c.vacancies.map((v) => (
                    <li key={v.path}>
                      <Link to={entityHref('vacancy', v.path)}>
                        <span className="li-main"><div className="li-title">{v.title}</div></span>
                        <VacancyStatusChip status={v.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
            {c.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={c.tasks} today={today} />}
            <AddTaskInline path={c.path} placeholder="Задача по компании…" />
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>История</h3>
            <HistoryList items={c.history} empty="Записей пока нет" />
          </section>
          {c.documents.length > 0 && (
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Документы</h3>
              <ul className="list">
                {c.documents.map((d) => (
                  <li key={d.path}>
                    <Link to={entityHref('document', d.path)}><span className="li-main"><div className="li-title">{d.title}</div></span></Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <SectionEditor path={c.path} section="notes" title="Заметки" value={c.notes} />
        </div>
        <div className="stack">
          <LogInteraction path={c.path} today={today} withNext={false} />
          <EditEntityCard path={c.path} defs={COMPANY_FIELDS} />
          <RelatedCard related={c.related} emptyHint="Свяжите компанию с проектом, контактами и документами." />
        </div>
      </div>
    </div>
  );
}
