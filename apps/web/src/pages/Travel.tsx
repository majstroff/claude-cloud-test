import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Backpack, BadgeCheck, FileText, Luggage, Map as MapIcon, Plane, Plus, Ticket, Wallet } from 'lucide-react';
import { api, type BookingDTO, type TravelData, type TripDetail } from '../api.ts';
import { CreateEntityModal, EditEntityCard, RelatedCard, SectionEditor } from '../components/Entities.tsx';
import { TripLine, bookingWhen, inDays } from '../components/Personal.tsx';
import { Money, useAct } from '../components/Spheres.tsx';
import { AddTaskInline, TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, Progress, fmtDate, plural } from '../components/ui.tsx';
import { BOOKING_FIELDS, TRIP_FIELDS, TRIP_PHASE_LABEL, entityHref, rub } from '../entities.ts';

export function TravelPage() {
  const q = useQuery({ queryKey: ['travel'], queryFn: () => api.get<TravelData>('/api/travel') });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const unpaid = d.unpaidBookings.reduce((s, b) => s + (b.cost ?? 0), 0);
  const groups: Array<[string, typeof d.trips]> = [
    ['Сейчас в поездке', d.current],
    ['Впереди', d.upcoming],
    ['Идеи поездок', d.ideas],
    ['Прошедшие', d.past],
    ['Отменённые', d.cancelled],
  ];
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Tile value={String(d.current.length + d.upcoming.length)} label="поездок в планах" />
        <Tile value={String(d.ideas.length)} label={plural(d.ideas.length, 'идея поездки', 'идеи поездок', 'идей поездок')} />
        <Tile value={rub(unpaid)} label="брони к оплате" />
        <Tile value={rub(d.yearSpent)} label={`потрачено в поездках за ${d.today.slice(0, 4)}`} />
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Plane size={16} /> Поездки
              </h2>
              <button className="btn small primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Поездка
              </button>
            </div>
            {d.trips.length === 0 ? (
              <Empty icon={<Luggage size={20} />} title="Поездок пока нет">
                Добавьте поездку с датами и бюджетом — брони, маршрут и список вещей появятся внутри.
              </Empty>
            ) : (
              groups
                .filter(([, list]) => list.length > 0)
                .map(([title, list]) => (
                  <div key={title} style={{ marginBottom: 10 }}>
                    <div className="small muted" style={{ margin: '6px 10px 4px' }}>{title}</div>
                    <ul className="list">
                      {list.map((t) => (
                        <li key={t.path}>
                          <TripLine t={t} today={d.today} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
            )}
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>
              <Ticket size={16} /> Ближайшие брони
            </h3>
            {d.nextBookings.length === 0 ? <Empty title="Броней впереди нет" /> : <BookingList items={d.nextBookings} showTrip />}
          </section>
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>
              <Wallet size={16} /> К оплате
            </h3>
            {d.unpaidBookings.length === 0 ? <Empty title="Все брони оплачены" /> : <BookingList items={d.unpaidBookings} showTrip />}
          </section>
        </div>
      </div>
      {creating && (
        <CreateEntityModal
          type="trip"
          heading="Новая поездка"
          defs={TRIP_FIELDS}
          initial={{ status: 'planning' }}
          textLabel="Зачем едем, идеи"
          folderHint="Заметка в «Путешествия»"
          onClose={() => setCreating(false)}
          onCreated={(p) => nav(entityHref('trip', p))}
        />
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

/** Брони со статусом оплаты и кнопкой «Оплачено» (расход попадает в «Финансы»). */
export function BookingList({ items, showTrip }: { items: BookingDTO[]; showTrip?: boolean }) {
  const pay = useAct<{ transaction: unknown }>('/api/travel/pay', (r) => (r.transaction ? 'Оплачено, расход записан в «Финансы»' : 'Отмечено как оплаченное'));
  return (
    <ul className="list">
      {items.map((b) => (
        <li key={b.path}>
          <div className="li">
            <span className="type-dot booking" />
            <Link to={entityHref('booking', b.path)} className="li-main">
              <div className="li-title">{b.title}</div>
              <div className="li-sub">
                {[bookingWhen(b), b.place, b.provider, b.confirmation ? `код ${b.confirmation}` : null, showTrip && b.trip ? b.trip.title : null].filter(Boolean).join(' · ')}
              </div>
            </Link>
            {b.cost !== null && <Money value={b.cost} />}
            {b.paid ? (
              <span className="chip green">оплачено</span>
            ) : (
              <button className="btn small" onClick={() => pay.mutate({ path: b.path })} disabled={pay.isPending} aria-label={`Оплачено: ${b.title}`} title="Отметить оплату и записать расход «Путешествия»">
                <BadgeCheck size={14} /> Оплачено
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- Поездка ----------

export function TripPage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['trip', path], queryFn: () => api.get<TripDetail>(`/api/travel/trip?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ today: string }>('/api/health') });
  const [booking, setBooking] = useState(false);
  if (!path) return <Empty title="Поездка не выбрана" action={<Link to="/travel" className="btn small">К путешествиям</Link>} />;
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const today = health.data?.today ?? '';
  const committed = t.spent + t.unpaid;
  return (
    <div className="stack">
      <div className="row">
        <Link to="/travel" className="btn small ghost">
          <ArrowLeft size={14} /> Путешествия
        </Link>
      </div>
      <div className="grid cols-3">
        <div className="stack">
          <section className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{t.title}</h2>
                <div className="small muted">
                  {[t.destination, t.start ? `${fmtDate(t.start)}${t.end ? ` — ${fmtDate(t.end)}` : ''} ${t.start.slice(0, 4)}` : 'даты не выбраны', t.nights ? `${t.nights} ${plural(t.nights, 'ночь', 'ночи', 'ночей')}` : null, t.travelers.length ? t.travelers.join(', ') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <span className={`chip ${t.phase === 'ongoing' ? 'accent' : ''}`}>
                {TRIP_PHASE_LABEL[t.phase]}
                {(t.phase === 'booked' || t.phase === 'planning') && t.daysUntil !== null && t.daysUntil >= 0 ? ` · ${inDays(t.daysUntil)}` : ''}
              </span>
              <Link className="btn small" to={`/note?path=${encodeURIComponent(t.path)}`}>
                <FileText size={14} /> Заметка
              </Link>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 12 }}>
              <Stat l="Бюджет" v={rub(t.budget)} />
              <Stat l="Брони" v={rub(t.booked)} />
              <Stat l="Оплачено" v={rub(t.spent)} />
              <Stat l="Осталось" v={<span style={{ color: t.overBudget ? 'var(--red)' : undefined }}>{t.left === null ? '—' : rub(t.left)}</span>} />
            </div>
            {t.budget !== null && <Progress value={Math.min(100, Math.round((committed / Math.max(1, t.budget)) * 100))} tone={t.overBudget ? 'red' : 'blue'} />}
            {t.overBudget && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>Бюджет превышен с учётом неоплаченных броней.</div>}
          </section>

          <section className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Ticket size={16} /> Билеты и брони
              </h3>
              <button className="btn small" onClick={() => setBooking(true)}>
                <Plus size={14} /> Бронь
              </button>
            </div>
            {t.bookingList.length === 0 ? <Empty title="Броней пока нет">Добавьте билеты, жильё, аренду авто — с кодом брони и стоимостью.</Empty> : <BookingList items={t.bookingList} />}
          </section>

          <RouteCard t={t} />
          <PackingCard t={t} today={today} />

          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи</h3>
            {t.tasks.length === 0 ? <Empty title="Задач нет" /> : <TaskList tasks={t.tasks} today={today} showSource={false} />}
            <AddTaskInline path={t.path} placeholder="Например: оформить страховку" />
          </section>
          <SectionEditor path={t.path} section="notes" title="Заметки" value={t.notes} />
        </div>

        <div className="stack">
          <DocumentsCard t={t} />
          <ExpensesCard t={t} />
          <EditEntityCard path={t.path} defs={TRIP_FIELDS} />
          <RelatedCard related={t.related} emptyHint="Сошлитесь на поездку из цели, проекта или заметки." />
        </div>
      </div>
      {booking && (
        <CreateEntityModal
          type="booking"
          heading="Новая бронь"
          defs={BOOKING_FIELDS}
          initial={{ trip: t.title, kind: 'flight', date: t.start ?? '' }}
          textLabel="Заметки"
          folderHint="Заметка в «Путешествия/Брони»"
          onClose={() => setBooking(false)}
        />
      )}
    </div>
  );
}

function Stat({ l, v }: { l: string; v: ReactNode }) {
  return (
    <div className="stat">
      <div className="l">{l}</div>
      <div>{v}</div>
    </div>
  );
}

function RouteCard({ t }: { t: TripDetail }) {
  const [f, setF] = useState({ date: '', text: '' });
  const add = useAct('/api/travel/route', 'Пункт маршрута добавлен');
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>
        <MapIcon size={16} /> Маршрут
      </h3>
      {t.routePoints.length === 0 ? (
        <Empty title="Маршрута пока нет">Добавьте по дням: куда едете и что смотрите.</Empty>
      ) : (
        <ol className="timeline">
          {[...t.routePoints].sort((a, b) => a.date.localeCompare(b.date)).map((p, i) => (
            <li key={`${p.date}-${i}`}>
              <span className="small muted">{fmtDate(p.date, true)}</span>
              <span>{p.text}</span>
            </li>
          ))}
        </ol>
      )}
      <form
        className="inline-form"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.text.trim()) add.mutate({ path: t.path, date: f.date || null, text: f.text }, { onSuccess: () => setF({ date: f.date, text: '' }) });
        }}
      >
        <input className="input" type="date" style={{ width: 150 }} value={f.date} min={t.start ?? undefined} max={t.end ?? undefined} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="День маршрута" />
        <input className="input grow" placeholder="Город, места, планы на день" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Пункт маршрута" />
        <button className="btn small" type="submit" disabled={add.isPending || !f.text.trim()}>
          <Plus size={14} /> Добавить
        </button>
      </form>
    </section>
  );
}

function PackingCard({ t, today }: { t: TripDetail; today: string }) {
  const [text, setText] = useState('');
  const add = useAct('/api/travel/packing', 'Добавлено в список вещей');
  const fill = useAct<{ added: number }>('/api/travel/packing/template', (r) => (r.added ? `Добавлено пунктов: ${r.added}` : 'Все пункты этого списка уже есть'));
  const done = t.packing.filter((x) => x.status === 'done').length;
  return (
    <section className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Backpack size={16} /> Список вещей
        </h3>
        <span className="card-sub">
          {done}/{t.packing.length} собрано
        </span>
      </div>
      {t.packing.length > 0 && <Progress value={Math.round((done / t.packing.length) * 100)} tone="green" />}
      {t.packing.length === 0 ? <Empty title="Список пуст">Начните с готового списка или добавьте свои пункты.</Empty> : <TaskList tasks={t.packing} today={today} showSource={false} />}
      <form
        className="inline-form"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ path: t.path, text }, { onSuccess: () => setText('') });
        }}
      >
        <input className="input grow" placeholder="Что взять" value={text} onChange={(e) => setText(e.target.value)} aria-label="Что взять" />
        <button className="btn small" type="submit" disabled={add.isPending || !text.trim()}>
          <Plus size={14} /> Добавить
        </button>
      </form>
      <div className="row small" style={{ marginTop: 10, gap: 6 }}>
        <span className="muted">Готовые списки:</span>
        {t.templates.map((x) => (
          <button key={x.id} className="btn small ghost" onClick={() => fill.mutate({ path: t.path, template: x.id })} disabled={fill.isPending} title={`Добавит недостающие пункты (${x.count})`}>
            + {x.label}
          </button>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Пункты — галочки в заметке поездки; в бэклог они не попадают.</div>
    </section>
  );
}

function DocumentsCard({ t }: { t: TripDetail }) {
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>Документы</h3>
      {t.documents.length === 0 ? (
        <Empty title="Документы не указаны">Перечислите в свойстве «Документы» названия заметок из раздела «Документы» — проверим срок действия к дате возвращения.</Empty>
      ) : (
        <ul className="list">
          {t.documents.map((d) => (
            <li key={d.title}>
              {d.path ? (
                <Link to={entityHref('document', d.path)}>
                  <span className="type-dot document" />
                  <span className="li-main">
                    <div className="li-title">{d.title}</div>
                    <div className={`li-sub level-${d.level}`}>{d.message}</div>
                  </span>
                </Link>
              ) : (
                <div className="li">
                  <span className="type-dot document" />
                  <span className="li-main">
                    <div className="li-title">{d.title}</div>
                    <div className="li-sub level-warning">{d.message}</div>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="small muted" style={{ marginTop: 6 }}>Номера документов сюда не выводятся — только срок действия.</div>
    </section>
  );
}

function ExpensesCard({ t }: { t: TripDetail }) {
  const [f, setF] = useState({ amount: '', description: '' });
  const add = useAct('/api/travel/expense', 'Расход записан в «Финансы»');
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>
        <Wallet size={16} /> Расходы
      </h3>
      {t.transactions.length === 0 ? (
        <Empty title="Расходов пока нет" />
      ) : (
        <ul className="list">
          {t.transactions.map((x) => (
            <li key={`${x.path}:${x.line}`}>
              <div className="li">
                <span className="li-main">
                  <div className="li-title">{x.description || x.category}</div>
                  <div className="li-sub">{fmtDate(x.date)}</div>
                </span>
                <Money value={x.amount} sign="minus" />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (f.amount.trim()) add.mutate({ path: t.path, amount: f.amount, description: f.description || null }, { onSuccess: () => setF({ amount: '', description: '' }) });
        }}
      >
        <input className="input" style={{ width: 100 }} inputMode="decimal" placeholder="₽" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Сумма расхода" />
        <input className="input grow" placeholder="На что: такси, ужин…" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="На что потратили" />
        <button className="btn small" type="submit" disabled={add.isPending || !f.amount.trim()}>
          <Plus size={14} /> Записать
        </button>
      </form>
    </section>
  );
}
