import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookMarked, Check, ExternalLink, FileText, Link2, Link2Off, Plus, Search, Unlink } from 'lucide-react';
import { api, type KnowledgeData, type KnowledgeDetail, type KnowledgeHit, type KnowledgeItemDTO, type NoteSummary } from '../api.ts';
import { CreateEntityModal, EditEntityCard } from '../components/Entities.tsx';
import { useAct } from '../components/Spheres.tsx';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, TYPE_LABEL, fmtDate, noteHref, plural } from '../components/ui.tsx';
import { KNOWLEDGE_FIELDS, KNOWLEDGE_STATUS_LABEL, KNOWLEDGE_TYPE_LABEL, PARA_LABEL, entityHref, fieldsFor } from '../entities.ts';
import { DeleteNoteButton } from '../components/DeleteNote.tsx';

const CREATE_TYPES = ['note', 'instruction', 'research', 'bookmark'] as const;

export function knowledgeHref(path: string): string {
  return `/knowledge/view?path=${encodeURIComponent(path)}`;
}

export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? '';
  const tag = params.get('tag') ?? '';
  const para = params.get('para') ?? '';
  const [text, setText] = useState(params.get('q') ?? '');
  const [scope, setScope] = useState<'knowledge' | 'all'>('knowledge');
  const [creating, setCreating] = useState<null | (typeof CREATE_TYPES)[number]>(null);
  const nav = useNavigate();
  const q = useDeferredValue(text.trim());
  const filters = new URLSearchParams({ ...(type && { type }), ...(tag && { tag }), ...(para && { para }) }).toString();
  const data = useQuery({ queryKey: ['knowledge', filters], queryFn: () => api.get<KnowledgeData>(`/api/knowledge?${filters}`) });
  const search = useQuery({
    queryKey: ['knowledge-search', q, scope, filters],
    queryFn: () => api.get<{ results: KnowledgeHit[] }>(`/api/knowledge/search?q=${encodeURIComponent(q)}&scope=${scope}&${filters}`),
    enabled: q.length > 0,
  });
  const setFilter = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  if (data.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (data.isError) return <ErrorBox error={data.error} onRetry={() => data.refetch()} />;
  const d = data.data;
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile value={d.total} label={plural(d.total, 'заметка в «Знаниях»', 'заметки в «Знаниях»', 'заметок в «Знаниях»')} onClick={() => setFilter('type', '')} />
        <Tile value={d.byType.instruction} label="инструкций" onClick={() => setFilter('type', 'instruction')} />
        <Tile value={d.byType.research} label="исследований" onClick={() => setFilter('type', 'research')} />
        <Tile value={d.unreadBookmarks} label="ссылок не прочитано" onClick={() => setFilter('type', 'bookmark')} />
        <Tile value={d.unresolvedTotal} label="висячих ссылок" />
      </div>

      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="filters">
              <div className="input-icon grow" style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <input className="input" style={{ width: '100%' }} placeholder="Поиск по тексту заметок Obsidian…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск по знаниям" />
              </div>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value as 'knowledge' | 'all')} aria-label="Где искать">
                <option value="knowledge">Только «Знания»</option>
                <option value="all">Всё хранилище</option>
              </select>
              <select className="select" value={type} onChange={(e) => setFilter('type', e.target.value)} aria-label="Вид заметки">
                <option value="">Все виды</option>
                {CREATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {KNOWLEDGE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select className="select" value={para} onChange={(e) => setFilter('para', e.target.value)} aria-label="Папка PARA">
                <option value="">Все папки</option>
                {Object.entries(PARA_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <CreateMenu onPick={setCreating} />
            </div>
            {tag && (
              <div className="row small" style={{ margin: '0 8px 10px' }}>
                Тег <span className="chip">#{tag}</span>
                <button className="btn small ghost" onClick={() => setFilter('tag', '')}>
                  Сбросить
                </button>
              </div>
            )}
            {q ? (
              search.isPending ? (
                <Loading rows={4} />
              ) : search.isError ? (
                <ErrorBox error={search.error} />
              ) : search.data.results.length === 0 ? (
                <Empty icon={<Search size={20} />} title="Ничего не найдено">
                  {scope === 'knowledge' ? 'Попробуйте искать по всему хранилищу.' : 'Конфиденциальные заметки и документы в поиск не попадают.'}
                </Empty>
              ) : (
                <ul className="list">
                  {search.data.results.map((h) => (
                    <li key={h.path}>
                      <Link to={['note', 'instruction', 'research', 'bookmark'].includes(h.type) ? knowledgeHref(h.path) : entityHref(h.type, h.path)}>
                        <span className={`type-dot ${h.type}`} />
                        <span className="li-main">
                          <div className="li-title">{h.title}</div>
                          {h.snippet && <div className="snippet">{h.snippet}</div>}
                        </span>
                        <span className="chip">{TYPE_LABEL[h.type] ?? h.type}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : d.items.length === 0 ? (
              <Empty icon={<BookMarked size={20} />} title={filters ? 'Под фильтр ничего не подходит' : 'Знаний пока нет'}>
                {filters ? 'Сбросьте фильтры.' : `Создайте заметку, инструкцию, исследование или сохраните ссылку — файлы появятся в папке «${d.folder}».`}
              </Empty>
            ) : (
              <ul className="list">
                {d.items.map((i) => (
                  <li key={i.path}>
                    <ItemLine i={i} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Теги</h3>
            {d.tags.length === 0 ? (
              <Empty title="Тегов нет" />
            ) : (
              <div className="tag-cloud">
                {d.tags.map((t) => (
                  <button key={t.tag} className={`chip ${tag === t.tag ? 'on' : ''}`} onClick={() => setFilter('tag', tag === t.tag ? '' : t.tag)}>
                    #{t.tag} · {t.count}
                  </button>
                ))}
              </div>
            )}
          </section>
          <UnresolvedCard d={d} />
          <section className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Unlink size={16} /> Без связей
              </h3>
              <span className="card-sub">{d.orphansTotal}</span>
            </div>
            {d.orphans.length === 0 ? (
              <Empty title="Все заметки связаны" />
            ) : (
              <ul className="list">
                {d.orphans.slice(0, 10).map((i) => (
                  <li key={i.path}>
                    <Link to={knowledgeHref(i.path)}>
                      <span className={`type-dot ${i.type}`} />
                      <span className="li-main">
                        <div className="li-title">{i.title}</div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {creating && (
        <CreateEntityModal
          type={creating}
          heading={`Новая запись: ${KNOWLEDGE_TYPE_LABEL[creating]!.toLowerCase()}`}
          defs={KNOWLEDGE_FIELDS[creating]!}
          textLabel={creating === 'research' ? 'Вопрос (если не заполнен выше)' : 'Текст'}
          folderHint={`Заметка в «${d.folder}${creating === 'note' ? '' : creating === 'instruction' ? '/Инструкции' : creating === 'research' ? '/Исследования' : '/Ссылки'}»`}
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(knowledgeHref(p))}
        />
      )}
    </div>
  );
}

function CreateMenu({ onPick }: { onPick: (t: (typeof CREATE_TYPES)[number]) => void }) {
  return (
    <select
      className="select"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as (typeof CREATE_TYPES)[number]);
      }}
      aria-label="Создать"
    >
      <option value="">+ Создать…</option>
      {CREATE_TYPES.map((t) => (
        <option key={t} value={t}>
          {KNOWLEDGE_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

function ItemLine({ i }: { i: KnowledgeItemDTO }) {
  return (
    <Link to={knowledgeHref(i.path)}>
      <span className={`type-dot ${i.type}`} />
      <span className="li-main">
        <div className="li-title">{i.title}</div>
        <div className="li-sub">
          {[i.topic, i.folder, i.tags.length ? i.tags.map((t) => `#${t}`).join(' ') : null, `связей ${i.linksOut + i.backlinks}`].filter(Boolean).join(' · ')}
        </div>
        {i.excerpt && <div className="snippet">{i.excerpt}</div>}
      </span>
      {i.type === 'bookmark' && i.read === false && <span className="chip amber">не прочитано</span>}
      {i.status && i.type !== 'bookmark' && <span className="chip">{KNOWLEDGE_STATUS_LABEL[i.status] ?? i.status}</span>}
      <span className="chip">{KNOWLEDGE_TYPE_LABEL[i.type]}</span>
    </Link>
  );
}

function UnresolvedCard({ d }: { d: KnowledgeData }) {
  const nav = useNavigate();
  const create = useAct<{ path: string }>('/api/knowledge/create-for-link', 'Заметка создана — ссылки на неё заработали');
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Link2Off size={16} /> Висячие ссылки
        </h3>
        <span className="card-sub">ссылки на заметки, которых ещё нет</span>
      </div>
      {d.unresolved.length === 0 ? (
        <Empty title="Все ссылки ведут на заметки" />
      ) : (
        <ul className="list">
          {d.unresolved.slice(0, 12).map((u) => (
            <li key={u.target}>
              <div className="li">
                <span className="li-main">
                  <div className="li-title">[[{u.target}]]</div>
                  <div className="li-sub">из: {u.from.map((f) => f.title).join(', ')}</div>
                </span>
                <button
                  className="btn small"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ target: u.target }, { onSuccess: (r) => nav(knowledgeHref(r.path)) })}
                  aria-label={`Создать заметку: ${u.target}`}
                >
                  <Plus size={14} /> Создать
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tile({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  return (
    <button className="card" style={{ padding: 16, textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick} type="button">
      <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="small muted">{label}</div>
    </button>
  );
}

// ---------- Заметка «Знаний» ----------

export function KnowledgeItemPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['knowledge-item', path], queryFn: () => api.get<KnowledgeDetail>(`/api/knowledge/item?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const markRead = useAct('/api/entity', 'Отмечено как прочитанное', 'put');
  const nav = useNavigate();
  const create = useAct<{ path: string }>('/api/knowledge/create-for-link', 'Заметка создана');
  if (!path) return <Empty title="Заметка не выбрана" action={<Link to="/knowledge" className="btn small">К знаниям</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const n = q.data;
  const today = health.data?.today ?? '';
  return (
    <div className="stack">
      <div className="row">
        <Link to="/knowledge" className="btn small ghost">
          <ArrowLeft size={14} /> Знания
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{n.title}</h2>
                <div className="small muted">
                  {[KNOWLEDGE_TYPE_LABEL[n.type], n.topic, n.folder, `изменена ${fmtDate(new Date(n.mtimeMs).toISOString().slice(0, 10))}`].filter(Boolean).join(' · ')}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {n.tags.map((t) => (
                    <Link key={t} to={`/knowledge?tag=${encodeURIComponent(t)}`} className="chip">
                      #{t}
                    </Link>
                  ))}
                  {n.status && <span className="chip">{KNOWLEDGE_STATUS_LABEL[n.status] ?? n.status}</span>}
                </div>
              </div>
              <Link className="btn small" to={noteHref(n.path)}>
                <FileText size={14} /> Открыть и править
              </Link>
              <DeleteNoteButton path={n.path} title={n.title} after="/knowledge" />
            </div>
            {n.question && <div style={{ marginTop: 12 }}><span className="muted small">Вопрос:</span> {n.question}</div>}
            {n.why && <div style={{ marginTop: 12 }}><span className="muted small">Зачем:</span> {n.why}</div>}
            {n.reviewed && <div className="small muted" style={{ marginTop: 8 }}>Проверено: {fmtDate(n.reviewed)} {n.reviewed.slice(0, 4)}</div>}
            {n.excerpt && <p style={{ marginTop: 12, marginBottom: 0 }}>{n.excerpt}</p>}
            {n.url && (
              <div className="row" style={{ marginTop: 12 }}>
                <a className="btn small" href={n.url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={14} /> {n.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
                </a>
                {n.type === 'bookmark' && n.read === false && (
                  <button className="btn small primary" onClick={() => markRead.mutate({ path: n.path, set: { read: true } })} disabled={markRead.isPending}>
                    <Check size={14} /> Прочитано
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>
              <Link2 size={16} /> Связи
            </h3>
            <LinkGroup title="Ссылается на" items={n.outgoing} empty="Исходящих ссылок нет" />
            <LinkGroup title="Ссылаются сюда" items={n.backlinks} empty="Обратных ссылок нет" />
            {n.dangling.length > 0 && (
              <>
                <div className="small muted" style={{ margin: '10px 10px 4px' }}>Ссылки на несуществующие заметки</div>
                <ul className="list">
                  {n.dangling.map((t) => (
                    <li key={t}>
                      <div className="li">
                        <span className="li-main">
                          <div className="li-title">[[{t}]]</div>
                        </span>
                        <button className="btn small" disabled={create.isPending} onClick={() => create.mutate({ target: t }, { onSuccess: (r) => nav(knowledgeHref(r.path)) })} aria-label={`Создать заметку: ${t}`}>
                          <Plus size={14} /> Создать
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <LinkForm from={n.path} />
          </section>

          {(n.mentions.length > 0 || n.suggestions.length > 0) && (
            <section className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Возможные связи</h3>
              {n.mentions.length > 0 && (
                <SuggestList title={`Упоминают «${n.title}» без ссылки`} items={n.mentions} action={(x) => ({ from: x.path, to: n.path })} label="Добавить ссылку туда" />
              )}
              {n.suggestions.length > 0 && <SuggestList title="Похожие по тегам и теме" items={n.suggestions} action={(x) => ({ from: n.path, to: x.path })} label="Связать" />}
              <div className="small muted" style={{ margin: '8px 10px 0' }}>Ссылка добавляется строкой в секцию «Связи» заметки — ничего не удаляется.</div>
            </section>
          )}

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи из заметки</h3>
            {n.tasks.length === 0 ? <Empty title="Задач нет">Превратите вывод в действие — задача запишется в эту заметку.</Empty> : <TaskList tasks={n.tasks} today={today} showSource={false} />}
            <AddTaskInline path={n.path} placeholder="Например: попробовать на практике" />
          </section>
        </div>
        <div className="stack">
          {fieldsFor(n.type).length > 0 && <EditEntityCard path={n.path} defs={fieldsFor(n.type)} />}
        </div>
      </div>
    </div>
  );
}

function LinkGroup({ title, items, empty }: { title: string; items: NoteSummary[]; empty: string }) {
  return (
    <>
      <div className="small muted" style={{ margin: '6px 10px 4px' }}>{title}</div>
      {items.length === 0 ? (
        <div className="small muted" style={{ margin: '0 10px 8px' }}>{empty}</div>
      ) : (
        <ul className="list">
          {items.map((x) => (
            <li key={x.path}>
              <Link to={['note', 'instruction', 'research', 'bookmark'].includes(x.type) ? knowledgeHref(x.path) : entityHref(x.type, x.path)}>
                <span className={`type-dot ${x.type}`} />
                <span className="li-main">
                  <div className="li-title">{x.title}</div>
                </span>
                <span className="small muted">{TYPE_LABEL[x.type] ?? x.type}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SuggestList({ title, items, action, label }: { title: string; items: NoteSummary[]; action: (x: NoteSummary) => { from: string; to: string }; label: string }) {
  const link = useAct('/api/knowledge/link', 'Ссылка добавлена в секцию «Связи»');
  return (
    <>
      <div className="small muted" style={{ margin: '6px 10px 4px' }}>{title}</div>
      <ul className="list">
        {items.map((x) => (
          <li key={x.path}>
            <div className="li">
              <span className={`type-dot ${x.type}`} />
              <Link to={knowledgeHref(x.path)} className="li-main">
                <div className="li-title">{x.title}</div>
              </Link>
              <button className="btn small" onClick={() => link.mutate(action(x))} disabled={link.isPending} aria-label={`${label}: ${x.title}`}>
                <Link2 size={14} /> {label}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Поиск заметки по всему хранилищу и добавление ссылки на неё. */
function LinkForm({ from }: { from: string }) {
  const [text, setText] = useState('');
  const [comment, setComment] = useState('');
  const q = useDeferredValue(text.trim());
  const res = useQuery({
    queryKey: ['knowledge-link-search', q],
    queryFn: () => api.get<{ results: KnowledgeHit[] }>(`/api/knowledge/search?q=${encodeURIComponent(q)}&scope=all&limit=8`),
    enabled: q.length > 1,
  });
  const link = useAct('/api/knowledge/link', 'Ссылка добавлена в секцию «Связи»');
  const options = (res.data?.results ?? []).filter((h) => h.path !== from).slice(0, 6);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="inline-form">
        <input className="input grow" placeholder="Связать с заметкой: начните вводить название" value={text} onChange={(e) => setText(e.target.value)} aria-label="Связать с заметкой" />
        <input className="input" style={{ width: 180 }} placeholder="Комментарий" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Комментарий к связи" />
      </div>
      {q.length > 1 && (
        <ul className="list" style={{ marginTop: 6 }}>
          {res.isPending ? (
            <li className="small muted" style={{ padding: 8 }}>Ищу…</li>
          ) : options.length === 0 ? (
            <li className="small muted" style={{ padding: 8 }}>Ничего не найдено</li>
          ) : (
            options.map((h) => (
              <li key={h.path}>
                <button
                  className="li"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() =>
                    link.mutate(
                      { from, to: h.path, comment: comment || null },
                      {
                        onSuccess: () => {
                          setText('');
                          setComment('');
                        },
                      },
                    )
                  }
                  aria-label={`Добавить ссылку: ${h.title}`}
                >
                  <span className={`type-dot ${h.type}`} />
                  <span className="li-main">
                    <div className="li-title">{h.title}</div>
                  </span>
                  <span className="small muted">{TYPE_LABEL[h.type] ?? h.type}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
