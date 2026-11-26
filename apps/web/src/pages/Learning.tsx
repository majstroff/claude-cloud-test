import { DeleteNoteButton } from '../components/DeleteNote.tsx';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, GraduationCap, Plus, Quote } from 'lucide-react';
import { api, type LearningData, type LearningItemDTO, type SkillDTO } from '../api.ts';
import { CreateEntityModal } from '../components/Entities.tsx';
import { useAct } from '../components/Spheres.tsx';
import { Empty, ErrorBox, Loading, Progress, pastDate, plural } from '../components/ui.tsx';
import { LEARN_STATUS_LABEL, MATERIAL_FIELDS_LEARN, MATERIAL_TYPE_LABEL, SKILL_FIELDS, SKILL_KIND_LABEL, UNIT_LABEL, entityHref } from '../entities.ts';

type Tab = 'materials' | 'skills' | 'quotes';

export function ProgressForm({ item }: { item: LearningItemDTO }) {
  const [v, setV] = useState('');
  const m = useAct('/api/learning/progress', (r: { item: LearningItemDTO }) => (r.item.status === 'done' ? `«${r.item.title}» — готово!` : `Прогресс: ${r.item.percent}%`));
  if (item.status === 'done' || item.status === 'dropped') return null;
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) m.mutate({ path: item.path, progress: v }, { onSuccess: () => setV('') });
      }}
    >
      <input
        className="input"
        style={{ width: 120 }}
        inputMode="numeric"
        placeholder={item.unit === 'percent' ? '%' : item.unit === 'pages' ? 'страница' : item.unit === 'lessons' ? 'урок' : 'минут'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label={`Прогресс: ${item.title}`}
      />
      <button className="btn small" type="submit" disabled={m.isPending || !v.trim()}>
        Отметить
      </button>
      <button type="button" className="btn small ghost" style={{ whiteSpace: 'nowrap' }} onClick={() => m.mutate({ path: item.path, status: 'done' })} disabled={m.isPending}>
        Готово
      </button>
    </form>
  );
}

function ItemCard({ it, today }: { it: LearningItemDTO; today: string }) {
  return (
    <div className="stat" style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Link to={entityHref(it.type, it.path)} style={{ flex: 1 }}>
          <strong>{it.title}</strong>
          <div className="small muted">
            {MATERIAL_TYPE_LABEL[it.type]}
            {it.author ? ` · ${it.author}` : ''}
            {it.skill ? ` · ${it.skill.title}` : ''}
          </div>
        </Link>
        <span className={`chip ${it.status === 'active' ? 'blue' : it.status === 'done' ? 'green' : ''}`}>{LEARN_STATUS_LABEL[it.status]}</span>
        <DeleteNoteButton path={it.path} title={it.title} after={null} iconOnly />
      </div>
      {(it.status === 'active' || it.status === 'paused') && <Progress value={it.percent} tone="blue" />}
      <div className="small muted">
        {it.status === 'done'
          ? `Закончено${it.finished ? ` ${pastDate(it.finished, today)}` : ''}${it.rating ? ` · ${'★'.repeat(it.rating)}` : ''}`
          : it.progress !== null
            ? it.unit === 'percent'
              ? `${it.percent}%`
              : `${it.progress}${it.total ? ` из ${it.total}` : ''} ${UNIT_LABEL[it.unit] ?? ''} · ${it.percent}%`
            : 'Ещё не начато'}
        {it.quotes ? ` · ${it.quotes} ${plural(it.quotes, 'цитата', 'цитаты', 'цитат')}` : ''}
        {it.openActions ? ` · ${it.openActions} ${plural(it.openActions, 'действие', 'действия', 'действий')}` : ''}
      </div>
      <ProgressForm item={it} />
    </div>
  );
}

function SkillCard({ s, today }: { s: SkillDTO; today: string }) {
  const [min, setMin] = useState('');
  const [text, setText] = useState('');
  const log = useAct('/api/learning/session', 'Занятие записано в журнал');
  const weekPct = s.weeklyMinutes ? Math.min(100, Math.round((s.minutes7 / s.weeklyMinutes) * 100)) : null;
  return (
    <div className="stat" style={{ display: 'grid', gap: 8 }}>
      <div className="row">
        <Link to={entityHref('skill', s.path)} style={{ flex: 1 }}>
          <strong>{s.title}</strong>
          <div className="small muted">
            {SKILL_KIND_LABEL[s.kind]}
            {s.level ? ` · ${s.level}` : ''}
            {s.target ? ` → ${s.target}` : ''}
            {` · ${s.hours} ч практики`}
          </div>
        </Link>
        <DeleteNoteButton path={s.path} title={s.title} after={null} iconOnly />
      </div>
      {weekPct !== null && <Progress value={weekPct} tone="green" />}
      <div className="small muted">
        За 7 дней: {s.minutes7} мин{s.weeklyMinutes ? ` из ${s.weeklyMinutes}` : ''}
        {s.lastSession ? ` · последнее занятие ${pastDate(s.lastSession, today)}` : ''}
        {s.materials.length ? ` · материалов: ${s.materials.length}` : ''}
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (min.trim())
            log.mutate(
              { path: s.path, minutes: min, text },
              {
                onSuccess: () => {
                  setMin('');
                  setText('');
                },
              },
            );
        }}
      >
        <input className="input" style={{ width: 80 }} inputMode="numeric" placeholder="мин" value={min} onChange={(e) => setMin(e.target.value)} aria-label={`Минут: ${s.title}`} />
        <input className="input grow" placeholder="Что делали" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Что делали: ${s.title}`} />
        <button className="btn small" type="submit" disabled={log.isPending || !min.trim()}>
          Записать занятие
        </button>
      </form>
    </div>
  );
}

export function LearningPage() {
  const q = useQuery({ queryKey: ['learning'], queryFn: () => api.get<LearningData>('/api/learning') });
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'materials';
  const [status, setStatus] = useState('current');
  const [type, setType] = useState('all');
  const [creating, setCreating] = useState<null | 'book' | 'article' | 'video' | 'course' | 'skill'>(null);
  const nav = useNavigate();
  const items = useMemo(
    () =>
      (q.data?.items ?? []).filter(
        (i) => (status === 'all' || (status === 'current' ? i.status === 'active' || i.status === 'want' || i.status === 'paused' : i.status === status)) && (type === 'all' || i.type === type),
      ),
    [q.data, status, type],
  );
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === 'materials') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  };
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile value={d.stats.active} label="изучаю сейчас" />
        <Tile value={d.stats.want} label="в списке «хочу»" />
        <Tile value={d.stats.booksThisYear} label={`${plural(d.stats.booksThisYear, 'книга прочитана', 'книги прочитаны', 'книг прочитано')} в этом году`} />
        <Tile value={d.stats.minutes7} label="минут практики навыков за неделю" />
        <Tile value={d.stats.openActions} label="практических действий не сделано" />
      </div>

      <div className="filters">
        <div className="tabs" role="tablist">
          {(
            [
              ['materials', 'Материалы'],
              ['skills', `Навыки и языки · ${d.skills.length}`],
              ['quotes', `Цитаты · ${d.quotes.length}`],
            ] as Array<[Tab, string]>
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'materials' && (
          <>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
              <option value="current">В работе и в планах</option>
              <option value="all">Все</option>
              {Object.entries(LEARN_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Вид">
              <option value="all">Книги, статьи, видео, курсы</option>
              {Object.entries(MATERIAL_TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="spacer" />
        {tab === 'skills' ? (
          <button className="btn primary" onClick={() => setCreating('skill')}>
            <Plus size={16} /> Навык или язык
          </button>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            {(['book', 'article', 'video', 'course'] as const).map((t) => (
              <button key={t} className={`btn ${t === 'book' ? 'primary' : ''}`} onClick={() => setCreating(t)}>
                <Plus size={16} /> {MATERIAL_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'materials' &&
        (items.length === 0 ? (
          <div className="card">
            <Empty icon={<BookOpen size={18} />} title={d.items.length ? 'Нет материалов по фильтру' : 'Материалов пока нет'}>
              {!d.items.length && 'Добавьте книгу, статью, видео или курс: с конспектом, цитатами, выводами и практическими действиями.'}
            </Empty>
          </div>
        ) : (
          <div className="grid cols-auto">
            {items.map((it) => (
              <ItemCard key={it.path} it={it} today={d.today} />
            ))}
          </div>
        ))}

      {tab === 'skills' &&
        (d.skills.length === 0 ? (
          <div className="card">
            <Empty icon={<GraduationCap size={18} />} title="Навыков пока нет">Навык или язык: уровень, цель, журнал занятий и часы практики.</Empty>
          </div>
        ) : (
          <div className="grid cols-auto">
            {d.skills.map((s) => (
              <SkillCard key={s.path} s={s} today={d.today} />
            ))}
          </div>
        ))}

      {tab === 'quotes' && (
        <section className="card">
          {d.quotes.length === 0 ? (
            <Empty icon={<Quote size={18} />} title="Цитат пока нет">Добавляйте цитаты на странице книги или статьи.</Empty>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {d.quotes.map((qt, i) => (
                <figure key={i} style={{ margin: 0 }}>
                  <blockquote className="quote">{qt.text}</blockquote>
                  <figcaption className="small muted" style={{ marginTop: 4, marginLeft: 15 }}>
                    <Link to={entityHref('book', qt.path)}>{qt.title}</Link>
                    {qt.author ? ` · ${qt.author}` : ''}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      )}

      {creating && (
        <CreateEntityModal
          type={creating}
          heading={creating === 'skill' ? 'Новый навык или язык' : `Новая запись: ${MATERIAL_TYPE_LABEL[creating]!.toLowerCase()}`}
          defs={creating === 'skill' ? SKILL_FIELDS : MATERIAL_FIELDS_LEARN.filter((f) => !['finished', 'progress'].includes(f.key))}
          initial={creating === 'skill' ? { kind: 'skill', status: 'active' } : { status: 'want' }}
          textLabel={creating === 'skill' ? 'Зачем развивать' : 'Первые мысли'}
          folderHint="Заметка в «Обучение»"
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(entityHref(creating, p))}
        />
      )}
    </div>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}
