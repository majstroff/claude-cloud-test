import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarHeart, Handshake, HeartHandshake, Plus, Users } from 'lucide-react';
import { api, type RelationsData } from '../api.ts';
import { CreateEntityModal } from '../components/Entities.tsx';
import { OccasionLine, TouchButton, dueLabel, inDays } from '../components/Personal.tsx';
import { TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, fmtDate, pastDate, plural } from '../components/ui.tsx';
import { CONTACT_FIELDS, CONTACT_KIND_LABEL, DATE_FIELDS, DATE_KIND_LABEL, entityHref } from '../entities.ts';

export function RelationshipsPage() {
  const q = useQuery({ queryKey: ['relationships'], queryFn: () => api.get<RelationsData>('/api/relationships') });
  const [creating, setCreating] = useState<null | 'date' | 'person'>(null);
  const nav = useNavigate();
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const soon = d.upcoming.filter((o) => o.daysLeft <= 30);
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile value={soon.length} label="важных дат за 30 дней" />
        <Tile value={d.contactsDue.length} label={plural(d.contactsDue.length, 'человеку пора написать', 'людям пора написать', 'людям пора написать')} />
        <Tile value={d.agreements.length} label="открытых договорённостей" />
        <Tile value={d.people.length} label="близких в списке" />
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <CalendarHeart size={16} /> Ближайшие даты
              </h2>
              <span className="card-sub">на 60 дней</span>
            </div>
            {d.upcoming.length === 0 ? (
              <Empty title="В ближайшие два месяца дат нет">Добавьте день рождения в карточку контакта или создайте важную дату.</Empty>
            ) : (
              <ul className="list">
                {d.upcoming.map((o) => (
                  <li key={o.key}>
                    <OccasionLine o={o} today={d.today} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <HeartHandshake size={16} /> Пора связаться
              </h2>
              <span className="card-sub">по ритму «раз в N дней»</span>
            </div>
            {d.contactsDue.length === 0 ? (
              <Empty title="Со всеми на связи">Укажите у контакта «Связываться раз в, дней» — и здесь появится напоминание.</Empty>
            ) : (
              <ul className="list">
                {d.contactsDue.map((p) => (
                  <li key={p.path}>
                    <div className="li">
                      <span className="type-dot contact" />
                      <Link to={entityHref('contact', p.path)} className="li-main">
                        <div className="li-title">{p.title}</div>
                        <div className="li-sub" style={{ color: p.dueState === 'overdue' ? 'var(--red)' : undefined }}>
                          {dueLabel(p, d.today)}
                          {p.lastContact ? ` · последний раз ${pastDate(p.lastContact, d.today)}` : ''}
                        </div>
                      </Link>
                      <TouchButton path={p.path} title={p.title} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Handshake size={16} /> Договорённости
              </h2>
              <span className="card-sub">задачи из карточек контактов</span>
            </div>
            {d.agreements.length === 0 ? <Empty title="Открытых договорённостей нет">Их можно добавить при записи общения в карточке контакта.</Empty> : <TaskList tasks={d.agreements} today={d.today} />}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Users size={16} /> Близкие
              </h3>
              <button className="btn small" onClick={() => setCreating('person')}>
                <Plus size={14} /> Человек
              </button>
            </div>
            {d.people.length === 0 ? (
              <Empty title="Список пуст">Здесь контакты с видом «Друг» или «Семья», а также все, у кого указан день рождения или ритм общения.</Empty>
            ) : (
              <ul className="list">
                {d.people.map((p) => (
                  <li key={p.path}>
                    <Link to={entityHref('contact', p.path)}>
                      <span className="type-dot contact" />
                      <span className="li-main">
                        <div className="li-title">{p.title}</div>
                        <div className="li-sub">
                          {[
                            p.kind ? CONTACT_KIND_LABEL[p.kind] ?? p.kind : null,
                            p.nextBirthday ? `ДР ${fmtDate(p.nextBirthday)} (${inDays(p.birthdayIn!)})` : null,
                            p.contactEvery ? `раз в ${p.contactEvery} дн.` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </span>
                      {p.dueState && <span className={`chip ${p.dueState === 'overdue' ? 'red' : 'amber'}`}>{p.dueState === 'overdue' ? 'пора написать' : 'скоро'}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">Важные даты</h3>
              <button className="btn small" onClick={() => setCreating('date')}>
                <Plus size={14} /> Дата
              </button>
            </div>
            {d.dates.length === 0 ? (
              <Empty title="Дат пока нет">Годовщины, памятные дни, семейные праздники — каждый год появятся в календаре.</Empty>
            ) : (
              <ul className="list">
                {d.dates.map((x) => (
                  <li key={x.path}>
                    <Link to={entityHref('important_date', x.path)}>
                      <span className={`type-dot ${x.kind === 'birthday' ? 'birthday' : 'important_date'}`} />
                      <span className="li-main">
                        <div className="li-title">{x.title}</div>
                        <div className="li-sub">{[DATE_KIND_LABEL[x.kind], x.date, x.person?.title].filter(Boolean).join(' · ')}</div>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {creating === 'date' && (
        <CreateEntityModal
          type="important_date"
          heading="Новая важная дата"
          defs={DATE_FIELDS}
          initial={{ yearly: true, kind: 'anniversary' }}
          textLabel="Заметки"
          folderHint={`Заметка в «${d.folder}/Даты»`}
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(entityHref('important_date', p))}
        />
      )}
      {creating === 'person' && (
        <CreateEntityModal
          type="contact"
          heading="Новый близкий человек"
          titleLabel="Имя"
          defs={CONTACT_FIELDS.filter((f) => ['kind', 'phone', 'email', 'birthday', 'contact_every', 'last_contact'].includes(f.key))}
          initial={{ kind: 'friend' }}
          textLabel="Заметки"
          folderHint="Заметка в «Контакты»"
          onClose={() => setCreating(null)}
          onCreated={(p) => nav(entityHref('contact', p))}
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
