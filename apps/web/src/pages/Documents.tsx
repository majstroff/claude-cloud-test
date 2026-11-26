import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarPlus, Eye, EyeOff, FileLock2, FileText, Plus, ShieldCheck } from 'lucide-react';
import { api, type DocumentDTO, type DocumentDetail, type Health } from '../api.ts';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { CreateEntityModal, EditEntityCard, RefLink, RelatedCard, SectionEditor } from '../components/Entities.tsx';
import { Empty, ErrorBox, Loading, fmtDate, noteHref, plural, useToast } from '../components/ui.tsx';
import { DOCUMENT_FIELDS, DOC_STATE_LABEL, DOC_TYPE_LABEL } from '../entities.ts';

/** Дата с годом: у документов сроки бывают через много лет. */
const fmtYear = (iso: string) => `${fmtDate(iso)} ${iso.slice(0, 4)}`;

const STATE_TONE: Record<string, string> = { expired: 'red', expiring: 'amber', valid: 'green', no_expiry: '' };

function StateChip({ d }: { d: DocumentDTO }) {
  const left =
    d.daysLeft !== null && d.state !== 'expired' && d.state !== 'no_expiry'
      ? ` · ${d.daysLeft} ${plural(d.daysLeft, 'день', 'дня', 'дней')}`
      : d.state === 'expired' && d.daysLeft !== null
        ? ` · ${-d.daysLeft} ${plural(-d.daysLeft, 'день', 'дня', 'дней')} назад`
        : '';
  return <span className={`chip ${STATE_TONE[d.state]}`}>{DOC_STATE_LABEL[d.state]}{left}</span>;
}

function useRenewal() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (path: string) => api.post<{ task: { due: string | null } }>('/api/documents/renewal-task', { path }),
    onSuccess: (r) => {
      toast(`Задача на продление создана${r.task.due ? ` на ${fmtDate(r.task.due)}` : ''}`);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
}

export function DocumentsPage() {
  const q = useQuery({ queryKey: ['documents'], queryFn: () => api.get<{ today: string; documents: DocumentDTO[] }>('/api/documents') });
  const [state, setState] = useState('all');
  const [type, setType] = useState('all');
  const [creating, setCreating] = useState(false);
  const renewal = useRenewal();
  const nav = useNavigate();
  const list = useMemo(
    () =>
      (q.data?.documents ?? []).filter(
        (d) => (state === 'all' || (state === 'attention' ? d.state === 'expired' || d.state === 'expiring' : d.state === state)) && (type === 'all' || d.docType === type),
      ),
    [q.data, state, type],
  );
  if (q.isPending) return <div className="card"><Loading rows={5} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const docs = q.data.documents;
  const attention = docs.filter((d) => d.state === 'expired' || d.state === 'expiring').length;
  const warnings = docs.filter((d) => d.warnings.length > 0).length;

  return (
    <div className="stack">
      <div className="notice">
        <ShieldCheck size={18} style={{ flex: '0 0 auto' }} />
        <div className="small">
          Сведения о документе, включая номер, хранятся в заметке Obsidian открытым текстом. В интерфейсе номер скрыт, пока вы не нажмёте «Показать». Сканы держите в зашифрованном месте и указывайте его в поле «Где хранится».
          Конфиденциальные документы не показываются в поиске и не передаются ИИ-помощнику без явного разрешения (<code>ai: true</code> в заметке).
        </div>
      </div>

      <div className="filters">
        <div className="tabs" role="tablist">
          {[
            ['all', `Все · ${docs.length}`],
            ['attention', `Требуют внимания · ${attention}`],
            ['valid', DOC_STATE_LABEL.valid],
            ['no_expiry', DOC_STATE_LABEL.no_expiry],
          ].map(([k, l]) => (
            <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k!)}>
              {l}
            </button>
          ))}
        </div>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип документа">
          <option value="all">Все типы</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Документ
        </button>
      </div>

      {warnings > 0 && (
        <div className="error-box" role="status">
          <AlertTriangle size={18} style={{ flex: '0 0 auto' }} />
          <div className="small">
            {warnings} {plural(warnings, 'документ требует', 'документа требуют', 'документов требуют')} внимания к безопасности хранения — подробности в карточке.
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="card">
          <Empty
            icon={<FileLock2 size={18} />}
            title={docs.length ? 'Нет документов по этому фильтру' : 'Документов пока нет'}
            action={!docs.length ? <button className="btn small" onClick={() => setCreating(true)}>Добавить документ</button> : undefined}
          >
            {!docs.length && 'Документ — заметка с type: document: паспорт, РВП/ВНЖ, договор, диплом, страховка, гарантия.'}
          </Empty>
        </div>
      ) : (
        <div className="card" style={{ padding: 8 }}>
          <ul className="list">
            {list.map((d) => (
              <li key={d.path}>
                <div className="li">
                  <span className="type-dot document" />
                  <Link to={`/documents/view?path=${encodeURIComponent(d.path)}`} className="li-main">
                    <div className="li-title">
                      {d.title} {d.sensitive && <FileLock2 size={13} className="muted" aria-label="Конфиденциально" />}
                      {d.warnings.length > 0 && <AlertTriangle size={13} style={{ color: 'var(--amber)', marginLeft: 4 }} aria-label="Есть предупреждения" />}
                    </div>
                    <div className="li-sub">
                      {[DOC_TYPE_LABEL[d.docType], d.owner, d.expires ? `до ${fmtYear(d.expires)}` : null, d.storage].filter(Boolean).join(' · ')}
                    </div>
                  </Link>
                  <StateChip d={d} />
                  {d.expires && !d.renewalTask && (d.state === 'expiring' || d.state === 'expired') && (
                    <button className="btn small" onClick={() => renewal.mutate(d.path)} disabled={renewal.isPending}>
                      <CalendarPlus size={14} /> Задача на продление
                    </button>
                  )}
                  {d.renewalTask && <span className="chip blue">задача {d.renewalTask.due ? `на ${fmtDate(d.renewalTask.due)}` : 'создана'}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <CreateEntityModal
          type="document"
          heading="Новый документ"
          defs={DOCUMENT_FIELDS}
          initial={{ doc_type: 'passport', sensitive: true }}
          textLabel="Комментарий (без номеров и персональных данных)"
          folderHint="Заметка в папке документов"
          onClose={() => setCreating(false)}
          onCreated={(p) => nav(`/documents/view?path=${encodeURIComponent(p)}`)}
        />
      )}
    </div>
  );
}

export function DocumentPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['document', path], queryFn: () => api.get<DocumentDetail>(`/api/document?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const renewal = useRenewal();
  const [showNumber, setShowNumber] = useState(false);
  if (!path) return <Empty title="Документ не выбран" action={<Link to="/documents" className="btn small">К документам</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const today = health.data?.today ?? '';
  return (
    <div className="stack">
      <div className="row">
        <Link to="/documents" className="btn small ghost">
          <ArrowLeft size={14} /> Документы
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{d.title}</h2>
                <div className="small muted">
                  {DOC_TYPE_LABEL[d.docType]}
                  {d.owner ? ` · ${d.owner}` : ''}
                  {d.number ? (
                    <>
                      {' · № '}
                      <span className="mono">{showNumber ? d.number : `••••${d.numberLast4 ?? ''}`}</span>{' '}
                      <button className="btn small icon ghost" onClick={() => setShowNumber(!showNumber)} aria-label={showNumber ? 'Скрыть номер' : 'Показать номер'}>
                        {showNumber ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </>
                  ) : d.numberLast4 ? (
                    ` · №…${d.numberLast4}`
                  ) : (
                    ''
                  )}
                </div>
              </div>
              {d.sensitive ? <span className="chip dark"><FileLock2 size={12} /> Конфиденциально</span> : <span className="chip">Открытый</span>}
              <Link className="btn small" to={noteHref(d.path)}>
                <FileText size={14} /> Заметка
              </Link>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 14 }}>
              <div className="stat">
                <div className="l">Выдан</div>
                <div>{d.issued ? fmtYear(d.issued) : '—'}</div>
              </div>
              <div className="stat">
                <div className="l">Действует до</div>
                <div>{d.expires ? fmtYear(d.expires) : 'бессрочно'}</div>
              </div>
              <div className="stat">
                <div className="l">Состояние</div>
                <div><StateChip d={d} /></div>
              </div>
              <div className="stat">
                <div className="l">Напоминание</div>
                <div>{d.remindFrom ? `с ${fmtYear(d.remindFrom)} (за ${d.remindDays} дн.)` : '—'}</div>
              </div>
            </div>
            <div className="small" style={{ marginTop: 12 }}>
              Где хранится: {d.storage ?? <span className="muted">не указано</span>} · Организация: <RefLink r={d.organization} type="company" />
            </div>
            {d.expires && (
              <div className="row" style={{ marginTop: 12 }}>
                {d.renewalTask ? (
                  <span className="small">Задача на продление: «{d.renewalTask.title}»{d.renewalTask.due ? `, ${fmtDate(d.renewalTask.due)}` : ''}</span>
                ) : (
                  <button className="btn small" onClick={() => renewal.mutate(d.path)} disabled={renewal.isPending}>
                    <CalendarPlus size={14} /> Создать задачу на продление
                  </button>
                )}
              </div>
            )}
          </section>

          {d.warnings.length > 0 && (
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8, color: 'var(--amber)' }}>
                <AlertTriangle size={16} /> Безопасность хранения
              </h3>
              <ul className="stack small" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
                {d.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
            {d.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={d.tasks} today={today} showSource={false} />}
            <AddTaskInline path={d.path} placeholder="Например: записаться на подачу документов" />
          </section>

          <SectionEditor path={d.path} section="comment" title="Комментарий" value={d.comment} placeholder="Без номеров и персональных данных" />
        </div>
        <div className="stack">
          <EditEntityCard path={d.path} defs={DOCUMENT_FIELDS} />
          <RelatedCard related={d.related} emptyHint="Сошлитесь на документ из проекта или поездки: [[Название]]." />
        </div>
      </div>
    </div>
  );
}
