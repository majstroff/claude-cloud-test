import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type CalendarDay } from '../api.ts';
import { ErrorBox, MONTHS, WEEKDAYS_SHORT, addDaysIso, parseIso, toIso } from './ui.tsx';

function monthGrid(anchor: string): { from: string; to: string } {
  const first = parseIso(anchor.slice(0, 8) + '01');
  const dow = (first.getDay() + 6) % 7;
  const from = addDaysIso(toIso(first), -dow);
  return { from, to: addDaysIso(from, 41) };
}

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<{ days: CalendarDay[] }>(`/api/calendar?from=${from}&to=${to}`),
  });
}

export function shiftMonth(anchor: string, n: number): string {
  const d = parseIso(anchor.slice(0, 8) + '01');
  d.setMonth(d.getMonth() + n);
  return toIso(d);
}

export function MonthCalendar({
  anchor,
  today,
  selected,
  onSelect,
  onAnchor,
}: {
  anchor: string;
  today: string;
  selected?: string;
  onSelect?: (d: string) => void;
  onAnchor: (a: string) => void;
}) {
  const { from, to } = monthGrid(anchor);
  const cal = useCalendar(from, to);
  const month = parseIso(anchor).getMonth();
  return (
    <div>
      <div className="card-head">
        <div className="card-title">
          {MONTHS[month]} {parseIso(anchor).getFullYear()}
        </div>
        <div className="row">
          <button className="btn small icon ghost" aria-label="Предыдущий месяц" onClick={() => onAnchor(shiftMonth(anchor, -1))}>
            <ChevronLeft size={14} />
          </button>
          <button className="btn small ghost" onClick={() => onAnchor(today)}>
            Сегодня
          </button>
          <button className="btn small icon ghost" aria-label="Следующий месяц" onClick={() => onAnchor(shiftMonth(anchor, 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {cal.isError && <ErrorBox error={cal.error} onRetry={() => cal.refetch()} />}
      <div className="cal">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="dow">
            {d}
          </div>
        ))}
        {(cal.data?.days ?? placeholderDays(from)).map((d) => {
          const kinds = new Set(d.items.filter((i) => !(i.kind === 'task' && i.done)).map((i) => i.kind));
          const inMonth = parseIso(d.date).getMonth() === month;
          return (
            <button
              key={d.date}
              className={`day ${inMonth ? '' : 'out'} ${d.date === today ? 'today' : ''} ${d.date === selected ? 'sel' : ''}`}
              onClick={() => onSelect?.(d.date)}
              title={d.items.map((i) => i.title).join('\n') || undefined}
              aria-label={`${d.date}: ${d.items.length} записей`}
            >
              <span className="n">{parseIso(d.date).getDate()}</span>
              <span className="dots">
                {[...kinds].map((k) => (
                  <i key={k} className={`k-${k}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="row small muted" style={{ marginTop: 10, gap: 14 }}>
        <span className="row" style={{ gap: 4 }}>
          <i className="type-dot project" /> задачи
        </span>
        <span className="row" style={{ gap: 4 }}>
          <i className="type-dot event" /> события и платежи
        </span>
        <span className="row" style={{ gap: 4 }}>
          <i className="type-dot" style={{ background: 'var(--red)' }} /> сроки
        </span>
      </div>
    </div>
  );
}

function placeholderDays(from: string): CalendarDay[] {
  return Array.from({ length: 42 }, (_, i) => ({ date: addDaysIso(from, i), items: [], hasDaily: false }));
}
