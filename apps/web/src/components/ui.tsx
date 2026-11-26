import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { ApiError } from '../api.ts';

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon ?? <Inbox size={18} />}</div>
      <div className="t">{title}</div>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  const offline = error instanceof ApiError && error.status === 0;
  return (
    <div className="error-box" role="alert">
      <AlertTriangle size={18} style={{ flex: '0 0 auto', marginTop: 1 }} />
      <div>
        <div style={{ fontWeight: 600 }}>{offline ? 'Нет связи с сервером' : 'Не удалось загрузить данные'}</div>
        <div className="small">{msg}</div>
      </div>
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          <RefreshCw size={14} /> Повторить
        </button>
      )}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" style={{ gap: 10 }} aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'blue' | 'green' }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${v}%` }} />
    </div>
  );
}

// ---------- Уведомления ----------

interface Toast {
  id: number;
  text: ReactNode;
  kind: 'info' | 'error';
}
const ToastCtx = createContext<(text: ReactNode, kind?: 'info' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------- Тема ----------

export type Theme = 'light' | 'dark' | 'system';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem('frame-os-theme');
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('frame-os-theme');
      else localStorage.setItem('frame-os-theme', theme);
    } catch {
      // Хранилище браузера недоступно — тема просто не запомнится.
    }
  }, [theme]);
  return [theme, setTheme];
}

// ---------- Даты ----------

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
}
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
export function fmtDate(iso: string, withWeekday = false): string {
  const d = parseIso(iso);
  const s = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  return withWeekday ? `${WEEKDAYS[d.getDay()]}, ${s}` : s;
}
export function relDate(iso: string, today: string): string {
  const diff = Math.round((parseIso(iso).getTime() - parseIso(today).getTime()) / 86_400_000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff < 0) return `${fmtDate(iso)} · просрочено ${-diff} дн.`;
  if (diff < 7) return `${WEEKDAYS[parseIso(iso).getDay()]}, ${fmtDate(iso)}`;
  return fmtDate(iso);
}
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export const TYPE_LABEL: Record<string, string> = {
  project: 'Проект',
  goal: 'Цель',
  cycle: 'Цикл',
  idea: 'Идея',
  daily: 'Дневник',
  note: 'Заметка',
  event: 'Событие',
  payment: 'Платёж',
  workout: 'Тренировка',
  birthday: 'День рождения',
  contact: 'Контакт',
  document: 'Документ',
  area: 'Сфера',
  vacancy: 'Вакансия',
  company: 'Компания',
  resume: 'Резюме',
  portfolio: 'Портфолио',
};

export const STATUS_LABEL: Record<string, string> = {
  active: 'Активен',
  in_progress: 'В работе',
  planned: 'Запланирован',
  paused: 'На паузе',
  done: 'Завершён',
  completed: 'Завершён',
  archived: 'В архиве',
  new: 'Новая',
  hypothesis: 'Гипотеза',
  converted: 'Реализована',
  rejected: 'Отклонена',
  parked: 'Отложена',
};

export function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'in_progress' || status === 'new'
      ? 'blue'
      : status === 'done' || status === 'completed' || status === 'converted'
        ? 'green'
        : status === 'paused' || status === 'hypothesis' || status === 'parked'
          ? 'amber'
          : '';
  return <span className={`chip ${tone}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function noteHref(path: string): string {
  return `/note?path=${encodeURIComponent(path)}`;
}
