/**
 * Практики: медитации, дыхание, намерения, дневник состояний, расклады,
 * благодарности и наблюдения. Всё пишется в ежедневную заметку Obsidian,
 * в отдельные секции, — так записи видны и в Obsidian, и в «Дневнике»:
 *
 *   ## Намерение      текст
 *   ## Практики       - 07:30 · Медитация · 15 мин · комментарий
 *   ## Состояния      - 14:20 · Спокойствие · 4/5 · комментарий
 *   ## Благодарности  - текст
 *   ## Наблюдения     - 21:00 · текст
 *   ## Расклады       - текст расклада и толкование
 *
 * Лунный цикл вычисляется по астрономической формуле (без интернета).
 */
import { addDays, diffDays, isIsoDate, parseIsoDate } from './dates.ts';
import { nowTime, parseNumber } from './entity-kit.ts';
import { appendToSection, getSectionText, setSectionText } from './markdown.ts';
import { VaultError, type Vault } from './vault.ts';
import type { Life } from './life.ts';
import type { Routines } from './routines.ts';

export const PRACTICE_KINDS = ['meditation', 'breathing', 'yoga', 'journaling', 'visualization', 'prayer', 'other'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];
export const PRACTICE_LABEL: Record<PracticeKind, string> = {
  meditation: 'Медитация',
  breathing: 'Дыхание',
  yoga: 'Йога',
  journaling: 'Письменная практика',
  visualization: 'Визуализация',
  prayer: 'Молитва',
  other: 'Практика',
};

const SECTIONS = {
  intention: ['Намерение', 'Намерения', 'Intention'],
  practices: ['Практики', 'Practices'],
  states: ['Состояния', 'Дневник состояний', 'States'],
  gratitude: ['Благодарности', 'Благодарность', 'Gratitude'],
  observations: ['Наблюдения', 'Observations'],
  spreads: ['Расклады', 'Расклад'],
} as const;

export interface PracticeEntry {
  date: string;
  time: string | null;
  kind: PracticeKind;
  label: string;
  minutes: number | null;
  text: string;
}

export interface StateEntry {
  date: string;
  time: string | null;
  state: string;
  level: number | null;
  text: string;
}

export interface MoonInfo {
  date: string;
  /** Возраст луны в днях от новолуния. */
  age: number;
  lunarDay: number;
  illumination: number;
  phase: 'new' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous' | 'full' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';
  phaseLabel: string;
  waxing: boolean;
  nextNew: string;
  nextFull: string;
}

const SYNODIC = 29.530588853;
/** Опорное новолуние: 6 января 2000, 18:14 UTC. */
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const PHASE_LABEL: Record<MoonInfo['phase'], string> = {
  new: 'Новолуние',
  waxing_crescent: 'Растущий серп',
  first_quarter: 'Первая четверть',
  waxing_gibbous: 'Растущая луна',
  full: 'Полнолуние',
  waning_gibbous: 'Убывающая луна',
  last_quarter: 'Последняя четверть',
  waning_crescent: 'Убывающий серп',
};

/** Фаза луны на полдень указанной даты (UTC). Точность — около суток. */
export function moonPhase(date: string): MoonInfo {
  const t = parseIsoDate(date);
  const noon = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), 12);
  const days = (noon - REF_NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100);
  const bounds: Array<[number, MoonInfo['phase']]> = [
    [1.84566, 'new'],
    [5.53699, 'waxing_crescent'],
    [9.22831, 'first_quarter'],
    [12.91963, 'waxing_gibbous'],
    [16.61096, 'full'],
    [20.30228, 'waning_gibbous'],
    [23.99361, 'last_quarter'],
    [27.68493, 'waning_crescent'],
    [SYNODIC + 1, 'new'],
  ];
  const phase = bounds.find(([b]) => age < b)![1];
  const toNew = SYNODIC - age;
  const toFull = age < SYNODIC / 2 ? SYNODIC / 2 - age : SYNODIC * 1.5 - age;
  return {
    date,
    age: Math.round(age * 10) / 10,
    lunarDay: Math.floor(age) + 1,
    illumination,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    waxing: age < SYNODIC / 2,
    nextNew: addDays(date, Math.round(toNew) || Math.round(toNew + SYNODIC)),
    nextFull: addDays(date, Math.round(toFull) || Math.round(toFull + SYNODIC)),
  };
}

export class Practices {
  constructor(readonly life: Life) {}

  private get vault(): Vault {
    return this.life.vault;
  }

  private get today() {
    return this.life.today;
  }

  private checkDate(date: string | null | undefined): string {
    const d = date?.trim() || this.today;
    if (!isIsoDate(d)) throw new VaultError('Дата в формате ГГГГ-ММ-ДД', 'invalid');
    if (d > this.today) throw new VaultError('Запись не может быть в будущем', 'invalid');
    return d;
  }

  private time(t: string | null | undefined): string {
    const v = t?.trim() || nowTime();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) throw new VaultError('Время в формате ЧЧ:ММ', 'invalid');
    return v.padStart(5, '0');
  }

  private clean(s: string | null | undefined): string {
    return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  }

  private async append(date: string, key: keyof typeof SECTIONS, line: string) {
    const note = await this.vault.ensureDaily(date);
    await this.vault.transform(note.path, (text) => {
      const heading = SECTIONS[key].find((h) => getSectionText(text, h) !== null) ?? SECTIONS[key][0];
      return appendToSection(text, heading, line).text;
    });
  }

  async logPractice(input: { date?: string | null; time?: string | null; kind: string; minutes?: unknown; text?: string | null }) {
    const date = this.checkDate(input.date);
    if (!(PRACTICE_KINDS as readonly string[]).includes(input.kind)) throw new VaultError('Неизвестный вид практики', 'invalid');
    const kind = input.kind as PracticeKind;
    let minutes: number | null = null;
    if (input.minutes !== undefined && input.minutes !== null && input.minutes !== '') {
      minutes = parseNumber(input.minutes);
      if (minutes === null || minutes <= 0 || minutes > 600) throw new VaultError('Длительность — от 1 до 600 минут', 'invalid');
      minutes = Math.round(minutes);
    }
    const text = this.clean(input.text);
    const parts = [this.time(input.time), PRACTICE_LABEL[kind], minutes ? `${minutes} мин` : null, text || null].filter(Boolean);
    await this.append(date, 'practices', `- ${parts.join(' · ')}`);
    return this.day(date);
  }

  async logState(input: { date?: string | null; time?: string | null; state: string; level?: unknown; text?: string | null }) {
    const date = this.checkDate(input.date);
    const state = this.clean(input.state).replace(/·/g, ',');
    if (!state) throw new VaultError('Опишите состояние одним-двумя словами', 'invalid');
    let level: number | null = null;
    if (input.level !== undefined && input.level !== null && input.level !== '') {
      level = parseNumber(input.level);
      if (level === null || !Number.isInteger(level) || level < 1 || level > 5) throw new VaultError('Оценка состояния — от 1 до 5', 'invalid');
    }
    const text = this.clean(input.text);
    const parts = [this.time(input.time), state, level ? `${level}/5` : null, text || null].filter(Boolean);
    await this.append(date, 'states', `- ${parts.join(' · ')}`);
    return this.day(date);
  }

  async addEntry(input: { date?: string | null; section: 'gratitude' | 'observations' | 'spreads'; text: string; time?: string | null }) {
    const date = this.checkDate(input.date);
    if (!['gratitude', 'observations', 'spreads'].includes(input.section)) throw new VaultError('Неизвестный вид записи', 'invalid');
    const text = this.clean(input.text);
    if (!text) throw new VaultError('Пустая запись', 'invalid');
    const line = input.section === 'observations' ? `- ${this.time(input.time)} · ${text}` : `- ${text}`;
    await this.append(date, input.section, line);
    return this.day(date);
  }

  async setIntention(date: string, text: string) {
    const d = isIsoDate(date) ? date : this.today;
    const note = await this.vault.ensureDaily(d);
    await this.vault.transform(note.path, (t) => {
      const heading = SECTIONS.intention.find((h) => getSectionText(t, h) !== null) ?? SECTIONS.intention[0];
      return setSectionText(t, heading, text.trim());
    });
    return this.day(d);
  }

  /** Записи практик за один день из ежедневной заметки. */
  day(date: string) {
    const n = this.vault.get(this.vault.dailyPath(date));
    const sec = (k: keyof typeof SECTIONS) => (n ? getSectionText(n.body, [...SECTIONS[k]]) ?? '' : '');
    const list = (k: keyof typeof SECTIONS) =>
      sec(k)
        .split('\n')
        .map((l) => /^\s*[-*]\s+(?!\[[ xX/-]\])(.+)$/.exec(l)?.[1]?.trim())
        .filter((x): x is string => !!x);
    return {
      date,
      notePath: this.vault.dailyPath(date),
      exists: !!n,
      intention: sec('intention'),
      practices: list('practices').map((l) => parsePractice(date, l)),
      states: list('states').map((l) => parseState(date, l)),
      gratitude: list('gratitude'),
      observations: list('observations').map((l) => {
        const m = /^(\d{1,2}:\d{2})\s*·\s*(.*)$/.exec(l);
        return { date, time: m?.[1] ?? null, text: m ? m[2]! : l };
      }),
      spreads: list('spreads'),
      mood: n ? parseNumber(n.frontmatter.mood) : null,
      energy: n ? parseNumber(n.frontmatter.energy) : null,
    };
  }

  overview(routines: Routines, days = 30) {
    const today = this.today;
    const range = Array.from({ length: Math.max(1, Math.min(days, 366)) }, (_, i) => addDays(today, -i));
    const history = range.map((d) => this.day(d)).filter((d) => d.exists);
    const all = history.flatMap((d) => d.practices);
    const minutesBy = (since: string) => {
      const out: Record<string, number> = {};
      for (const p of all) if (p.date > since) out[p.kind] = (out[p.kind] ?? 0) + (p.minutes ?? 0);
      return out;
    };
    // Серия: дни подряд с хотя бы одной практикой, считая от сегодня (или вчера, если сегодня ещё нет).
    const daysWith = new Set(all.map((p) => p.date));
    let streak = 0;
    let d = daysWith.has(today) ? today : addDays(today, -1);
    while (daysWith.has(d)) {
      streak++;
      d = addDays(d, -1);
    }
    const moon = moonPhase(today);
    return {
      today: this.day(today),
      history: history.filter((h) => h.date !== today || true),
      stats: {
        streak,
        sessions7: all.filter((p) => p.date > addDays(today, -7)).length,
        minutes7: minutesBy(addDays(today, -7)),
        minutes30: minutesBy(addDays(today, -30)),
        lastPractice: all[0]?.date ?? null,
        daysSinceLast: all[0] ? diffDays(all[0].date, today) : null,
      },
      moon,
      moonDays: Array.from({ length: 30 }, (_, i) => {
        const m = moonPhase(addDays(today, i));
        return { date: m.date, phase: m.phase, illumination: m.illumination };
      }),
      routines: routines.list('practice'),
      kinds: PRACTICE_LABEL,
    };
  }
}

export function parsePractice(date: string, line: string): PracticeEntry {
  const parts = line.split(/\s+·\s+/);
  let time: string | null = null;
  if (/^\d{1,2}:\d{2}$/.test(parts[0] ?? '')) time = parts.shift()!;
  const label = parts.shift() ?? 'Практика';
  const kind = (Object.entries(PRACTICE_LABEL).find(([, l]) => l.toLowerCase() === label.toLowerCase())?.[0] as PracticeKind | undefined) ?? guessPractice(label);
  let minutes: number | null = null;
  if (parts[0] && /^\d+\s*мин/.test(parts[0])) minutes = Number(/^\d+/.exec(parts.shift()!)![0]);
  return { date, time, kind, label, minutes, text: parts.join(' · ') };
}

export function parseState(date: string, line: string): StateEntry {
  const parts = line.split(/\s+·\s+/);
  let time: string | null = null;
  if (/^\d{1,2}:\d{2}$/.test(parts[0] ?? '')) time = parts.shift()!;
  const state = parts.shift() ?? '';
  let level: number | null = null;
  if (parts[0] && /^[1-5]\/5$/.test(parts[0])) level = Number(parts.shift()![0]);
  return { date, time, state, level, text: parts.join(' · ') };
}

function guessPractice(label: string): PracticeKind {
  const t = label.toLowerCase();
  if (/медит/.test(t)) return 'meditation';
  if (/дыхан|пранаям|breath/.test(t)) return 'breathing';
  if (/йог/.test(t)) return 'yoga';
  if (/дневник|письм|страниц/.test(t)) return 'journaling';
  if (/визуал/.test(t)) return 'visualization';
  if (/молитв/.test(t)) return 'prayer';
  return 'other';
}
