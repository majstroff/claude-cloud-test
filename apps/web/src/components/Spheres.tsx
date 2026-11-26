import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Repeat, Wallet } from 'lucide-react';
import { api, type MoonInfo, type ObligationDTO, type RoutineDTO } from '../api.ts';
import { OBLIGATION_LABEL, ROUTINE_FIELDS, SPHERE_LABEL, entityHref, rub } from '../entities.ts';
import { CreateEntityModal } from './Entities.tsx';
import { Empty, plural, relDate, useToast } from './ui.tsx';

/** Действие с записью: POST, затем обновление всех данных и сообщение. */
export function useAct<T = unknown>(url: string, ok: string | ((r: T) => string), method: 'post' | 'put' = 'post') {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => (method === 'post' ? api.post<T>(url, body) : api.put<T>(url, body)),
    onSuccess: (r) => {
      toast(typeof ok === 'function' ? ok(r) : ok);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
}

export function Money({ value, sign }: { value: number | null | undefined; sign?: 'plus' | 'minus' }) {
  return (
    <span className={`money ${sign ?? ''}`}>
      {sign === 'plus' ? '+' : sign === 'minus' ? '−' : ''}
      {rub(value)}
    </span>
  );
}

function everyLabel(n: number): string {
  if (n === 1) return 'каждый день';
  if (n === 7) return 'раз в неделю';
  if (n === 14) return 'раз в две недели';
  if (n >= 28 && n <= 31) return 'раз в месяц';
  return `раз в ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

const DUE_TONE: Record<string, string> = { overdue: 'red', today: 'amber', soon: 'blue', later: '', paused: '' };

export function routineWhen(r: RoutineDTO, today: string): string {
  if (r.due === 'paused') return 'на паузе';
  if (r.due === 'overdue') return `просрочено на ${r.daysOverdue} ${plural(r.daysOverdue, 'день', 'дня', 'дней')}`;
  return relDate(r.next, today);
}

/** Список регулярных дел с отметкой «Сделано». */
export function RoutineList({ routines, today, showSphere }: { routines: RoutineDTO[]; today: string; showSphere?: boolean }) {
  const done = useAct<{ routine: RoutineDTO }>('/api/routines/done', (r) => `Отмечено. Следующий раз — ${relDate(r.routine.next, today)}`);
  if (routines.length === 0) return <Empty title="Регулярных дел нет">Добавьте то, что повторяется: процедуры, уборку, замену фильтров.</Empty>;
  return (
    <ul className="list">
      {routines.map((r) => (
        <li key={r.path}>
          <div className="li">
            <span className="type-dot routine" />
            <Link to={entityHref('routine', r.path)} className="li-main">
              <div className="li-title">{r.title}</div>
              <div className="li-sub">
                {everyLabel(r.every)}
                {r.time ? ` · ${r.time}` : ''}
                {showSphere ? ` · ${SPHERE_LABEL[r.sphere]}` : ''}
              </div>
            </Link>
            <span className={`chip ${DUE_TONE[r.due]}`}>{routineWhen(r, today)}</span>
            {r.active && r.lastDone !== today && (
              <button className="btn small" onClick={() => done.mutate({ path: r.path })} disabled={done.isPending} aria-label={`Сделано: ${r.title}`}>
                <Check size={14} /> Сделано
              </button>
            )}
            {r.lastDone === today && <span className="chip green">сегодня ✓</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NewRoutineButton({ sphere, label = 'Регулярное дело' }: { sphere: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn small" onClick={() => setOpen(true)}>
        <Repeat size={14} /> {label}
      </button>
      {open && (
        <CreateEntityModal
          type="routine"
          heading="Новое регулярное дело"
          defs={ROUTINE_FIELDS}
          initial={{ sphere, every: '7', status: 'active' }}
          textLabel="Описание"
          folderHint="Заметка в папке «Регулярное» выбранной сферы"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Платежи, подписки и долги к оплате с кнопкой «Оплачено». */
export function ObligationList({ items, today, empty = 'Платежей в ближайшие дни нет' }: { items: ObligationDTO[]; today: string; empty?: string }) {
  const pay = useAct('/api/finance/pay', 'Оплата записана в операции');
  const debt = useAct('/api/finance/debt-payment', 'Платёж по долгу записан');
  if (items.length === 0) return <Empty icon={<Wallet size={18} />} title={empty} />;
  return (
    <ul className="list">
      {items.map((o) => (
        <li key={`${o.path}-${o.date}`}>
          <div className="li">
            <span className={`type-dot ${o.kind}`} />
            <Link to={entityHref(o.kind, o.path)} className="li-main">
              <div className="li-title">{o.title}</div>
              <div className="li-sub" style={{ color: o.overdue ? 'var(--red)' : undefined }}>
                {OBLIGATION_LABEL[o.kind]} · {o.overdue ? `просрочен, ${relDate(o.date, today)}` : relDate(o.date, today)}
                {o.category && o.kind !== 'debt' ? ` · ${o.category}` : ''}
              </div>
            </Link>
            <Money value={o.amount} />
            <button
              className="btn small"
              disabled={pay.isPending || debt.isPending || (o.kind === 'debt' && !o.amount)}
              onClick={() => (o.kind === 'debt' ? debt.mutate({ path: o.path, amount: o.amount }) : pay.mutate({ path: o.path }))}
              title="Записать расход в операции и перенести дату следующего платежа"
              aria-label={`Оплачено: ${o.title}`}
            >
              <Check size={14} /> Оплачено
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Простая столбчатая диаграмма по дням. */
export function Bars({ values, labels, format, tone }: { values: Array<number | null>; labels: string[]; format?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <div className="bars" role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v ?? 'нет данных'}`).join(', ')}>
      {values.map((v, i) => (
        <div key={i} className="b" title={`${labels[i]}: ${v === null ? 'нет данных' : format ? format(v) : v}`}>
          <i className={v === null ? 'empty' : ''} style={{ height: `${v === null ? 4 : Math.max(4, (v / max) * 100)}%`, background: v === null ? undefined : tone }} />
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function MoonBadge({ moon }: { moon: MoonInfo }) {
  // Освещённая часть: смещение «тени» слева или справа в зависимости от фазы.
  const lit = moon.illumination / 100;
  const shift = (moon.waxing ? 1 : -1) * (1 - lit) * 100;
  return (
    <span className="moon" aria-hidden>
      <i style={{ transform: `translateX(${shift}%)` }} />
    </span>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button className="btn primary" onClick={onClick}>
      <Plus size={16} /> {children}
    </button>
  );
}
