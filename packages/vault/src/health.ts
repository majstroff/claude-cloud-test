/**
 * Спорт и здоровье.
 *
 *   type: workout — тренировка: дата, вид, статус (план / сделано / пропуск),
 *                   длительность, дистанция; упражнения — таблица
 *                   | Упражнение | Подходы | Повторы | Вес, кг | в секции «Упражнения».
 *   Сон, восстановление, вода, вес и шаги — свойства ежедневной заметки
 *   (sleep, sleep_quality, recovery, water, weight, steps), питание — секция «Питание».
 *   Регулярные процедуры — заметки type: routine со сферой «Здоровье».
 *
 * Модуль только ведёт записи и считает статистику: диагнозов и медицинских
 * рекомендаций он не даёт.
 */
import { addDays, diffDays, isIsoDate, startOfWeek } from './dates.ts';
import { EntityModule, fmDate, fmEnum, fmNum, fmStr, normalizeFieldValue, parseNumber, type EntitySpec } from './entity-kit.ts';
import { splitRow } from './finance.ts';
import { appendToSection, findSection, getSectionText, setSectionText } from './markdown.ts';
import { VaultError, type Note } from './vault.ts';
import type { Life } from './life.ts';
import type { Routines } from './routines.ts';

export const WORKOUT_KINDS = ['strength', 'run', 'cardio', 'swim', 'bike', 'yoga', 'stretch', 'walk', 'other'] as const;
export const WORKOUT_KIND_LABEL: Record<(typeof WORKOUT_KINDS)[number], string> = {
  strength: 'Силовая',
  run: 'Бег',
  cardio: 'Кардио',
  swim: 'Плавание',
  bike: 'Велосипед',
  yoga: 'Йога',
  stretch: 'Растяжка',
  walk: 'Прогулка',
  other: 'Другое',
};
export const WORKOUT_STATUSES = ['planned', 'done', 'skipped'] as const;

/** Свойства ежедневной заметки, которые ведёт раздел «Здоровье». */
export const DAY_HEALTH_FIELDS = {
  sleep: { kind: 'decimal', label: 'Сон, часов', max: 24 },
  sleep_quality: { kind: 'rating', label: 'Качество сна' },
  recovery: { kind: 'rating', label: 'Восстановление' },
  water: { kind: 'decimal', label: 'Вода, л', max: 15 },
  weight: { kind: 'decimal', label: 'Вес, кг', max: 400 },
  steps: { kind: 'count', label: 'Шаги', max: 200_000 },
} as const;
type DayHealthKey = keyof typeof DAY_HEALTH_FIELDS;

const EX_HEADER = '| Упражнение | Подходы | Повторы | Вес, кг |';
const EX_SEP = '|---|---:|---:|---:|';

export interface ExerciseRow {
  name: string;
  sets: number | null;
  reps: string | null;
  weight: number | null;
}

export interface WorkoutDTO {
  path: string;
  title: string;
  date: string | null;
  time: string | null;
  kind: (typeof WORKOUT_KINDS)[number];
  status: (typeof WORKOUT_STATUSES)[number];
  duration: number | null;
  distance: number | null;
  effort: number | null;
  exercises: ExerciseRow[];
  /** Плановая тренировка, дата которой прошла. */
  missed: boolean;
}

export interface DayHealth {
  date: string;
  sleep: number | null;
  sleep_quality: number | null;
  recovery: number | null;
  water: number | null;
  weight: number | null;
  steps: number | null;
}

const LABELS: Record<string, string> = {
  date: 'Дата', time: 'Время', kind: 'Вид', status: 'Статус', duration: 'Длительность, мин', distance: 'Дистанция, км',
  effort: 'Нагрузка (1–5)', project: 'Проект', goal: 'Цель',
};

export class Health extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(life: Life) {
    super(life);
    this.specs = {
      workout: {
        folder: () => `${this.vault.folders.health}/Тренировки`,
        fields: {
          date: 'date', time: 'time', kind: { enum: WORKOUT_KINDS }, status: { enum: WORKOUT_STATUSES }, duration: 'number',
          distance: 'decimal', effort: 'rating', project: 'link', goal: 'link',
        },
        labels: LABELS,
        create: ({ title, fm, text, today }) => {
          fm.date ??= today;
          fm.status ??= 'planned';
          fm.kind ??= guessKind(title);
          const withDate = title.includes(String(fm.date)) ? title : `${fm.date} ${title}`;
          return { title: withDate, body: `${text ? text + '\n\n' : ''}## Упражнения\n${EX_HEADER}\n${EX_SEP}\n\n## Заметки\n` };
        },
        sections: { notes: 'Заметки' },
      },
    };
  }

  workout(n: Note): WorkoutDTO {
    const fm = n.frontmatter;
    const date = fmDate(fm.date);
    const status = fmEnum(fm.status, WORKOUT_STATUSES, date && date < this.today ? 'done' : 'planned');
    return {
      path: n.path,
      title: n.title,
      date,
      time: fmStr(fm.time),
      kind: fmEnum(fm.kind, WORKOUT_KINDS, guessKind(n.title)),
      status,
      duration: fmNum(fm.duration),
      distance: fmNum(fm.distance),
      effort: fmNum(fm.effort),
      exercises: parseExercises(getSectionText(n.body, ['Упражнения', 'Exercises']) ?? ''),
      missed: status === 'planned' && !!date && date < this.today,
    };
  }

  workouts(): WorkoutDTO[] {
    return this.vault
      .byType('workout')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.workout(n))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.time ?? '').localeCompare(a.time ?? ''));
  }

  workoutsOn(date: string): WorkoutDTO[] {
    return this.workouts().filter((w) => w.date === date && w.status !== 'skipped');
  }

  workoutDetail(rel: string) {
    const n = this.requireType(rel, 'workout', 'тренировка');
    const w = this.workout(n);
    // Прошлый результат по каждому упражнению — чтобы видеть прогресс.
    const stats = this.exerciseStats();
    return {
      ...w,
      notes: this.section(n, ['Заметки', 'Notes']),
      previous: Object.fromEntries(w.exercises.map((e) => [e.name, stats.find((s) => s.name.toLowerCase() === e.name.toLowerCase())?.history.find((h) => h.date !== w.date) ?? null])),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
      related: this.life.related(n),
    };
  }

  /** Отмечает тренировку выполненной или пропущенной. */
  async setWorkoutStatus(rel: string, status: (typeof WORKOUT_STATUSES)[number], input: { duration?: unknown; distance?: unknown; effort?: unknown; note?: string | null } = {}) {
    this.requireType(rel, 'workout', 'тренировка');
    if (!WORKOUT_STATUSES.includes(status)) throw new VaultError('Недопустимый статус тренировки', 'invalid');
    const extra: Record<string, unknown> = {};
    for (const k of ['duration', 'distance', 'effort'] as const) if (input[k] !== undefined && input[k] !== null && input[k] !== '') extra[k] = input[k];
    const { set } = this.normalizeFields('workout', { ...extra, status });
    await this.vault.updateProperties(rel, set);
    if (input.note?.trim()) await this.vault.transform(rel, (t) => appendToSection(t, 'Заметки', input.note!.trim()).text);
    return this.workout(this.vault.require(rel));
  }

  async addExercise(rel: string, input: { name: string; sets?: unknown; reps?: unknown; weight?: unknown }) {
    this.requireType(rel, 'workout', 'тренировка');
    const name = String(input.name ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
    if (!name) throw new VaultError('Введите название упражнения', 'invalid');
    const sets = input.sets === undefined || input.sets === null || input.sets === '' ? '' : String(normalizeFieldValue('count', input.sets, 'Подходы', (s) => s));
    const reps = String(input.reps ?? '').replace(/\|/g, '/').trim().slice(0, 30);
    const weight = input.weight === undefined || input.weight === null || input.weight === '' ? '' : String(normalizeFieldValue('decimal', input.weight, 'Вес', (s) => s));
    const row = `| ${name} | ${sets} | ${reps} | ${weight} |`;
    await this.vault.transform(rel, (text) => {
      const lines = text.split('\n');
      const s = findSection(lines, 'Упражнения');
      const hasTable = s && lines.slice(s.start, s.end).some((l) => l.trim().startsWith('| Упражнение'));
      const base = hasTable ? text : setSectionText(text, 'Упражнения', `${getSectionText(text, 'Упражнения') ?? ''}\n\n${EX_HEADER}\n${EX_SEP}`.trim());
      return appendToSection(base, 'Упражнения', row).text;
    });
    return this.workout(this.vault.require(rel));
  }

  /** Новая плановая тренировка по образцу: тот же вид, время и упражнения. */
  async repeatWorkout(rel: string, date: string) {
    const n = this.requireType(rel, 'workout', 'тренировка');
    if (!isIsoDate(date)) throw new VaultError('Дата в формате ГГГГ-ММ-ДД', 'invalid');
    const w = this.workout(n);
    const baseTitle = n.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').trim() || n.title;
    const created = await this.createEntity({
      type: 'workout',
      title: baseTitle,
      fields: { date, kind: w.kind, ...(w.time ? { time: w.time } : {}), status: 'planned' },
    });
    for (const e of w.exercises) await this.addExercise(created.path, { name: e.name, sets: e.sets, reps: e.reps, weight: e.weight });
    return this.workout(this.vault.require(created.path));
  }

  /** История по упражнениям из выполненных тренировок. */
  exerciseStats() {
    const map = new Map<string, { name: string; history: Array<{ date: string; path: string; sets: number | null; reps: string | null; weight: number | null }> }>();
    for (const w of this.workouts()) {
      if (w.status !== 'done' || !w.date) continue;
      for (const e of w.exercises) {
        const key = e.name.toLowerCase();
        const item = map.get(key) ?? { name: e.name, history: [] };
        item.history.push({ date: w.date, path: w.path, sets: e.sets, reps: e.reps, weight: e.weight });
        map.set(key, item);
      }
    }
    return [...map.values()]
      .map((x) => {
        const weights = x.history.map((h) => h.weight).filter((v): v is number => v !== null);
        return { ...x, last: x.history[0]!, best: weights.length ? Math.max(...weights) : null, count: x.history.length };
      })
      .sort((a, b) => b.last.date.localeCompare(a.last.date) || a.name.localeCompare(b.name, 'ru'));
  }

  // ---------- Показатели дня ----------

  dayHealth(date: string): DayHealth & { nutrition: string; notePath: string; exists: boolean } {
    const rel = this.vault.dailyPath(date);
    const n = this.vault.get(rel);
    const fm = n?.frontmatter ?? {};
    const out: DayHealth = { date, sleep: null, sleep_quality: null, recovery: null, water: null, weight: null, steps: null };
    for (const k of Object.keys(DAY_HEALTH_FIELDS) as DayHealthKey[]) out[k] = fmNum(fm[k]);
    return { ...out, nutrition: n ? getSectionText(n.body, ['Питание', 'Nutrition']) ?? '' : '', notePath: rel, exists: !!n };
  }

  async saveDayHealth(date: string, input: Record<string, unknown>) {
    if (!isIsoDate(date)) throw new VaultError('Дата в формате ГГГГ-ММ-ДД', 'invalid');
    if (date > this.today) throw new VaultError('Показатели можно записать только за прошедшие дни и сегодня', 'invalid');
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [k, v] of Object.entries(input)) {
      const def = DAY_HEALTH_FIELDS[k as DayHealthKey];
      if (!def) throw new VaultError(`Неизвестный показатель «${k}»`, 'invalid');
      if (v === null || v === '' || v === undefined) {
        unset.push(k);
        continue;
      }
      const val = normalizeFieldValue(def.kind, v, def.label, (s) => s) as number;
      if ('max' in def && val > def.max) throw new VaultError(`${def.label}: не больше ${def.max.toLocaleString('ru-RU')}`, 'invalid');
      set[k] = val;
    }
    const note = await this.vault.ensureDaily(date);
    await this.vault.updateProperties(note.path, set, unset);
    return this.dayHealth(date);
  }

  async saveNutrition(date: string, content: string) {
    if (!isIsoDate(date)) throw new VaultError('Дата в формате ГГГГ-ММ-ДД', 'invalid');
    const note = await this.vault.ensureDaily(date);
    await this.vault.transform(note.path, (t) => setSectionText(t, 'Питание', content));
    return this.dayHealth(date);
  }

  overview(routines: Routines) {
    const today = this.today;
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => {
      const h = this.dayHealth(d);
      const { nutrition: _n, notePath: _p, exists: _e, ...rest } = h;
      return rest;
    });
    const last7 = days.slice(-7);
    const avg = (k: keyof DayHealth) => {
      const vals = last7.map((d) => d[k]).filter((v): v is number => typeof v === 'number');
      return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
    };
    const workouts = this.workouts();
    const week = startOfWeek(today);
    const prevWeek = addDays(week, -7);
    const doneIn = (from: string, to: string) => workouts.filter((w) => w.status === 'done' && w.date && w.date >= from && w.date <= to);
    const thisWeek = doneIn(week, addDays(week, 6));
    return {
      today,
      todayHealth: this.dayHealth(today),
      days,
      averages: { sleep: avg('sleep'), sleep_quality: avg('sleep_quality'), recovery: avg('recovery'), water: avg('water'), weight: avg('weight'), steps: avg('steps') },
      week: {
        done: thisWeek.length,
        minutes: thisWeek.reduce((s, w) => s + (w.duration ?? 0), 0),
        distance: Math.round(thisWeek.reduce((s, w) => s + (w.distance ?? 0), 0) * 10) / 10,
        previousDone: doneIn(prevWeek, addDays(prevWeek, 6)).length,
      },
      upcoming: workouts.filter((w) => w.status === 'planned' && w.date && w.date >= today).sort((a, b) => a.date!.localeCompare(b.date!)),
      missed: workouts.filter((w) => w.missed),
      recent: workouts.filter((w) => w.status !== 'planned').slice(0, 20),
      exercises: this.exerciseStats(),
      routines: routines.list('health'),
      lastWorkoutDaysAgo: (() => {
        const last = workouts.find((w) => w.status === 'done' && w.date && w.date <= today);
        return last?.date ? diffDays(last.date, today) : null;
      })(),
    };
  }
}

export function parseExercises(text: string): ExerciseRow[] {
  const out: ExerciseRow[] = [];
  for (const line of text.split('\n')) {
    const cells = splitRow(line);
    if (!cells || !cells[0] || /^упражнение$/i.test(cells[0])) continue;
    out.push({
      name: cells[0],
      sets: parseNumber(cells[1] ?? '') !== null ? Math.round(parseNumber(cells[1])!) : null,
      reps: cells[2]?.trim() || null,
      weight: parseNumber((cells[3] ?? '').replace(/кг/i, '')),
    });
  }
  return out;
}

function guessKind(title: string): (typeof WORKOUT_KINDS)[number] {
  const t = title.toLowerCase();
  if (/силов|зал|жим|присед|strength|gym/.test(t)) return 'strength';
  if (/бег|пробеж|run/.test(t)) return 'run';
  if (/плав|бассейн|swim/.test(t)) return 'swim';
  if (/вело|bike/.test(t)) return 'bike';
  if (/йога|yoga/.test(t)) return 'yoga';
  if (/растяж|stretch|мобильн/.test(t)) return 'stretch';
  if (/прогулк|ходьб|walk/.test(t)) return 'walk';
  if (/кардио|cardio|hiit|интервал/.test(t)) return 'cardio';
  return 'other';
}
