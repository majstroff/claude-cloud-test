/** Работа с датами в формате YYYY-MM-DD в локальном часовом поясе. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = parseIsoDate(value);
  return toIsoDate(d) === value;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toIsoDate(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86_400_000);
}

/** Понедельник недели, в которую попадает дата. */
export function startOfWeek(iso: string): string {
  const d = parseIsoDate(iso);
  const dow = (d.getDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso: string): string {
  const d = parseIsoDate(startOfMonth(iso));
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
}

/** Функция «сегодня», которую можно подменить в тестах. */
export type Clock = () => string;
export const systemClock: Clock = () => toIsoDate(new Date());

const WEEKDAYS_RU: Record<string, number> = {
  пн: 1, понедельник: 1, вт: 2, вторник: 2, ср: 3, среда: 3, среду: 3,
  чт: 4, четверг: 4, пт: 5, пятница: 5, пятницу: 5, сб: 6, суббота: 6, субботу: 6,
  вс: 0, воскресенье: 0,
};

/**
 * Разбирает дату из быстрого ввода: «сегодня», «завтра», «послезавтра»,
 * «через 3 дня», «в пятницу», «2026-12-01», «01.12», «01.12.2026».
 * Возвращает null, если дату не удалось распознать.
 */
export function parseHumanDate(input: string, today: string): string | null {
  const s = input.trim().toLowerCase().replace(/ё/g, 'е');
  if (!s) return null;
  if (isIsoDate(s)) return s;
  if (s === 'сегодня' || s === 'today') return today;
  if (s === 'завтра' || s === 'tomorrow') return addDays(today, 1);
  if (s === 'послезавтра') return addDays(today, 2);
  const inDays = /^через\s+(\d+)\s+(дн|день|дня|дней)/.exec(s);
  if (inDays) return addDays(today, Number(inDays[1]));
  const inWeeks = /^через\s+(\d+)?\s*(недел)/.exec(s);
  if (inWeeks) return addDays(today, 7 * Number(inWeeks[1] ?? 1));
  const dm = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(s);
  if (dm) {
    const year = dm[3] ? Number(dm[3]) : Number(today.slice(0, 4));
    let iso = `${year}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    if (!isIsoDate(iso)) return null;
    if (!dm[3] && iso < today) iso = `${year + 1}${iso.slice(4)}`;
    return iso;
  }
  const wd: string = String(s).replace(/^(в|во)\s+/, "");
  if (wd in WEEKDAYS_RU) {
    const target = WEEKDAYS_RU[wd]!;
    const cur = parseIsoDate(today).getDay();
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  return null;
}
