import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cake, Gift, Phone, Plane, Plus } from 'lucide-react';
import { api, type OccasionDTO, type PersonDetail, type PersonDTO, type TripDTO } from '../api.ts';
import { BOOKING_KIND_LABEL, DATE_KIND_LABEL, TRIP_PHASE_LABEL, entityHref, rub } from '../entities.ts';
import { HistoryList } from './Entities.tsx';
import { useAct } from './Spheres.tsx';
import { Empty, ErrorBox, Loading, Progress, fmtDate, pastDate, plural, relDate } from './ui.tsx';

/** Через сколько дней: «сегодня», «завтра», «через 5 дней». */
export function inDays(n: number): string {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n < 0) return `${-n} ${plural(-n, 'день', 'дня', 'дней')} назад`;
  return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

function years(n: number, kind: string): string {
  const w = plural(n, 'год', 'года', 'лет');
  return kind === 'birthday' ? `исполнится ${n}` : `${n} ${w}`;
}

/** Строка ближайшей даты: день рождения, годовщина. */
export function OccasionLine({ o, today }: { o: OccasionDTO; today: string }) {
  const href = o.source === 'contact' ? entityHref('contact', o.path) : entityHref('important_date', o.path);
  return (
    <Link to={href}>
      <span className={`type-dot ${o.kind === 'birthday' ? 'birthday' : 'important_date'}`} />
      <span className="li-main">
        <div className="li-title">{o.title}</div>
        <div className="li-sub">
          {[relDate(o.next, today), o.years ? years(o.years, o.kind) : null, o.kind !== 'birthday' ? DATE_KIND_LABEL[o.kind] : null].filter(Boolean).join(' · ')}
        </div>
      </span>
      {o.giftIdeas > 0 && (
        <span className="chip" title="Идеи подарков">
          <Gift size={12} /> {o.giftIdeas}
        </span>
      )}
      <span className={`chip ${o.daysLeft <= 3 ? 'accent' : o.remind ? 'amber' : ''}`}>{inDays(o.daysLeft)}</span>
    </Link>
  );
}

export function dueLabel(p: PersonDTO, today: string): string {
  if (!p.due) return p.contactEvery ? 'ритм задан, связи ещё не было' : 'без напоминаний';
  if (p.dueState === 'overdue') return `пора было связаться ${pastDate(p.due, today)}`;
  return `связаться ${relDate(p.due, today)}`;
}

/** Кнопка «Связались»: строка в истории общения и дата последней связи. */
export function TouchButton({ path, title, label = 'Связались' }: { path: string; title: string; label?: string }) {
  const touch = useAct<{ person: PersonDTO }>('/api/relationships/touch', (r) => (r.person.due ? `Записано. Следующий раз — ${fmtDate(r.person.due)}` : 'Записано в историю общения'));
  return (
    <button className="btn small" onClick={() => touch.mutate({ path })} disabled={touch.isPending} aria-label={`${label}: ${title}`}>
      <Phone size={14} /> {label}
    </button>
  );
}

/** Строка поездки в списках. */
export function TripLine({ t, today }: { t: TripDTO; today: string }) {
  const when = t.start ? `${fmtDate(t.start)}${t.end && t.end !== t.start ? ` — ${fmtDate(t.end)}` : ''} ${t.start.slice(0, 4)}` : 'даты не выбраны';
  const spentShare = t.budget ? Math.min(100, Math.round(((t.spent + t.unpaid) / t.budget) * 100)) : 0;
  return (
    <Link to={entityHref('trip', t.path)}>
      <span className="type-dot trip" />
      <span className="li-main">
        <div className="li-title">{t.title}</div>
        <div className="li-sub">
          {[t.destination, when, t.nights ? `${t.nights} ${plural(t.nights, 'ночь', 'ночи', 'ночей')}` : null, t.packingTotal ? `вещи ${t.packingDone}/${t.packingTotal}` : null].filter(Boolean).join(' · ')}
        </div>
        {t.budget !== null && t.phase !== 'done' && t.phase !== 'cancelled' && <Progress value={spentShare} tone={t.overBudget ? 'red' : 'blue'} />}
      </span>
      {t.documentIssues > 0 && <span className="chip red">документы: {t.documentIssues}</span>}
      <span className={`chip ${t.phase === 'ongoing' ? 'accent' : t.phase === 'booked' ? 'green' : t.phase === 'planning' ? 'blue' : ''}`}>
        {t.phase === 'booked' || t.phase === 'planning' ? (t.daysUntil !== null && t.daysUntil >= 0 ? inDays(t.daysUntil) : TRIP_PHASE_LABEL[t.phase]) : TRIP_PHASE_LABEL[t.phase]}
      </span>
    </Link>
  );
}

/** Карточка ближайшей поездки для «Главной». */
export function NextTripCard({ t, today }: { t: TripDTO | null; today: string }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Plane size={16} /> {t?.phase === 'ongoing' ? 'Сейчас в поездке' : 'Ближайшая поездка'}
        </h2>
        <Link to="/travel" className="btn small ghost">
          Путешествия
        </Link>
      </div>
      {t ? (
        <>
          <ul className="list">
            <li>
              <TripLine t={t} today={today} />
            </li>
          </ul>
          <div className="small muted" style={{ margin: '8px 10px 0' }}>
            {t.budget !== null ? `Бюджет ${rub(t.budget)} · оплачено ${rub(t.spent)}${t.unpaid ? ` · к оплате ${rub(t.unpaid)}` : ''}` : `Брони: ${t.bookings}`}
          </div>
        </>
      ) : (
        <Empty title="Поездок в ближайшие 2 месяца нет">Запланируйте поездку в разделе «Путешествия».</Empty>
      )}
    </section>
  );
}

/** Идеи подарков и что уже дарили. */
export function GiftsCard({ path, ideas, given, person }: { path: string; ideas: string[]; given: Array<{ date: string; text: string }>; person: string }) {
  const [idea, setIdea] = useState('');
  const [gift, setGift] = useState({ text: '', occasion: '', cost: '' });
  const add = useAct('/api/relationships/gift-idea', 'Идея подарка записана');
  const give = useAct<{ transaction: unknown }>('/api/relationships/gift', (r) => (r.transaction ? 'Подарок записан, расход — в «Финансах»' : 'Подарок записан'));
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>
        <Gift size={16} /> Подарки
      </h3>
      {ideas.length === 0 ? (
        <Empty title="Идей пока нет">Записывайте, что человек хотел, — пригодится к празднику.</Empty>
      ) : (
        <ul className="list">
          {ideas.map((i) => (
            <li key={i}>
              <div className="li">
                <span className="li-main">
                  <div className="li-title">{i}</div>
                </span>
                <button className="btn small ghost" onClick={() => setGift({ text: i, occasion: '', cost: '' })} aria-label={`Подарил это: ${i}`} title="Перенести в «Что уже подарили»">
                  Выбрать
                </button>
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
          if (idea.trim()) add.mutate({ path, text: idea }, { onSuccess: () => setIdea('') });
        }}
      >
        <input className="input grow" placeholder={`Идея подарка для: ${person}`} value={idea} onChange={(e) => setIdea(e.target.value)} aria-label="Идея подарка" />
        <button className="btn small" type="submit" disabled={add.isPending || !idea.trim()}>
          <Plus size={14} /> Идея
        </button>
      </form>
      <form
        className="stack"
        style={{ gap: 8, marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (gift.text.trim()) give.mutate({ path, text: gift.text, occasion: gift.occasion || null, cost: gift.cost || null }, { onSuccess: () => setGift({ text: '', occasion: '', cost: '' }) });
        }}
      >
        <div className="small muted">Что уже подарили</div>
        <div className="inline-form">
          <input className="input grow" placeholder="Что подарили" value={gift.text} onChange={(e) => setGift({ ...gift, text: e.target.value })} aria-label="Что подарили" />
          <input className="input" style={{ width: 150 }} placeholder="Повод" value={gift.occasion} onChange={(e) => setGift({ ...gift, occasion: e.target.value })} aria-label="Повод" />
          <input className="input" style={{ width: 100 }} inputMode="decimal" placeholder="₽" value={gift.cost} onChange={(e) => setGift({ ...gift, cost: e.target.value })} aria-label="Сумма подарка" title="Если указать сумму, расход попадёт в «Финансы»" />
          <button className="btn small" type="submit" disabled={give.isPending || !gift.text.trim()}>
            Подарено
          </button>
        </div>
      </form>
      {given.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '14px 8px 4px' }}>Уже дарили</div>
          <HistoryList items={given} empty="" />
        </>
      )}
    </section>
  );
}

/** Для страницы контакта: день рождения, ритм общения, подарки. */
export function PersonRelationsCard({ path, today }: { path: string; today: string }) {
  const q = useQuery({ queryKey: ['person', path], queryFn: () => api.get<PersonDetail>(`/api/relationships/person?path=${encodeURIComponent(path)}`) });
  if (q.isPending) return <div className="card"><Loading rows={3} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3 className="card-title">
            <Cake size={16} /> Отношения
          </h3>
          <TouchButton path={p.path} title={p.title} label="Связались сегодня" />
        </div>
        <div className="small" style={{ margin: '0 8px' }}>
          {p.nextBirthday ? (
            <div>
              День рождения: {fmtDate(p.nextBirthday)}
              {p.age !== null ? ` · ${p.birthdayIn === 0 ? 'сегодня' : 'исполнится'} ${p.birthdayIn === 0 ? p.age : p.age + 1}` : ''} · {inDays(p.birthdayIn!)}
            </div>
          ) : (
            <div className="muted">День рождения не указан — добавьте его в свойствах контакта.</div>
          )}
          <div style={{ marginTop: 4, color: p.dueState === 'overdue' ? 'var(--red)' : undefined }}>
            {p.contactEvery ? `Связываться раз в ${p.contactEvery} ${plural(p.contactEvery, 'день', 'дня', 'дней')} · ` : ''}
            {dueLabel(p, today)}
          </div>
          {p.occasions.filter((o) => o.source === 'date').map((o) => (
            <div key={o.key} style={{ marginTop: 4 }}>
              <Link to={entityHref('important_date', o.path)}>{o.title}</Link> — {relDate(o.next, today)}
            </div>
          ))}
        </div>
      </section>
      <GiftsCard path={p.path} ideas={p.ideas} given={p.given} person={p.title} />
    </>
  );
}

export function bookingWhen(b: { kind: string; date: string | null; time: string | null; endDate: string | null }): string {
  if (!b.date) return 'дата не указана';
  return `${BOOKING_KIND_LABEL[b.kind] ?? ''} · ${fmtDate(b.date)}${b.time ? `, ${b.time}` : ''}${b.endDate && b.endDate !== b.date ? ` — ${fmtDate(b.endDate)}` : ''}`;
}
