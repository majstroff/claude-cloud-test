/**
 * Регулярные дела: процедуры здоровья, уборка, замена фильтров, ежедневная
 * медитация… Каждое дело — заметка `type: routine` с периодом в днях и датой
 * последнего выполнения. Следующий срок вычисляется, а история выполнений
 * хранится в секции «История» самой заметки.
 */
import { addDays, diffDays } from './dates.ts';
import { EntityModule, fmDate, fmEnum, fmNum, fmStr, parseDatedLines, type EntitySpec } from './entity-kit.ts';
import { VaultError, type Note } from './vault.ts';
import type { CalendarItem, Life } from './life.ts';

export const SPHERES = ['health', 'home', 'practice', 'learning', 'finance', 'other'] as const;
export type Sphere = (typeof SPHERES)[number];
export const SPHERE_LABEL: Record<Sphere, string> = {
  health: 'Здоровье',
  home: 'Дом',
  practice: 'Практики',
  learning: 'Обучение',
  finance: 'Финансы',
  other: 'Другое',
};

export interface RoutineDTO {
  path: string;
  title: string;
  sphere: Sphere;
  every: number;
  lastDone: string | null;
  next: string;
  time: string | null;
  active: boolean;
  /** overdue — срок прошёл, today — сегодня, soon — в ближайшие 2 дня. */
  due: 'overdue' | 'today' | 'soon' | 'later' | 'paused';
  daysOverdue: number;
  /** Сколько раз выполнено за последние 30 дней. */
  done30: number;
}

const LABELS = { sphere: 'Сфера', every: 'Периодичность, дней', last_done: 'Последний раз', time: 'Время', status: 'Статус', start: 'Первый раз', project: 'Проект' };

export class Routines extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(life: Life) {
    super(life);
    this.specs = {
      routine: {
        folder: () => this.vault.folders.areas + '/Регулярное',
        fields: {
          sphere: { enum: SPHERES },
          every: 'number',
          last_done: 'date',
          start: 'date',
          time: 'time',
          status: { enum: ['active', 'paused'] },
          project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.sphere ??= 'other';
          fm.every ??= 7;
          fm.status ??= 'active';
          if (!fm.every || (fm.every as number) < 1) throw new VaultError('Периодичность — не меньше 1 дня', 'invalid');
          return { body: `${text ? text + '\n\n' : ''}## История\n` };
        },
        sections: { notes: 'Заметки' },
      },
    };
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
  }

  /** Папка зависит от сферы: Здоровье/Регулярное, Дом/Регулярное… */
  override async createEntity(input: { type: string; title: string; fields?: Record<string, unknown>; text?: string }): Promise<Note> {
    const sphere = fmEnum(input.fields?.sphere, SPHERES, 'other');
    const f = this.vault.folders;
    const base = { health: f.health, home: f.home, practice: f.practices, learning: f.learning, finance: f.finance, other: f.areas }[sphere];
    this.specs.routine!.folder = () => `${base}/Регулярное`;
    return super.createEntity(input);
  }

  override async updateEntity(rel: string, input: Record<string, unknown>): Promise<Note> {
    if ('every' in input && input.every !== null && input.every !== '' && Number(input.every) < 1) throw new VaultError('Периодичность — не меньше 1 дня', 'invalid');
    return super.updateEntity(rel, input);
  }

  routine(n: Note): RoutineDTO {
    const fm = n.frontmatter;
    const every = Math.max(1, Math.round(fmNum(fm.every) ?? 7));
    const lastDone = fmDate(fm.last_done);
    const active = fmStr(fm.status) !== 'paused' && n.para !== 'archive';
    const next = lastDone ? addDays(lastDone, every) : (fmDate(fm.start) ?? this.today);
    const today = this.today;
    const due: RoutineDTO['due'] = !active ? 'paused' : next < today ? 'overdue' : next === today ? 'today' : next <= addDays(today, 2) ? 'soon' : 'later';
    const history = parseDatedLines(this.section(n, ['История', 'History']));
    const since = addDays(today, -30);
    return {
      path: n.path,
      title: n.title,
      sphere: fmEnum(fm.sphere, SPHERES, 'other'),
      every,
      lastDone,
      next,
      time: fmStr(fm.time),
      active,
      due,
      daysOverdue: due === 'overdue' ? diffDays(next, today) : 0,
      done30: history.filter((h) => h.date > since && h.date <= today).length,
    };
  }

  list(sphere?: Sphere): RoutineDTO[] {
    const rank = { overdue: 0, today: 1, soon: 2, later: 3, paused: 4 } as const;
    return this.vault
      .byType('routine')
      .map((n) => this.routine(n))
      .filter((r) => !sphere || r.sphere === sphere)
      .sort((a, b) => rank[a.due] - rank[b.due] || a.next.localeCompare(b.next) || a.title.localeCompare(b.title, 'ru'));
  }

  /** Что нужно сделать сегодня (включая просроченное). */
  dueToday(): RoutineDTO[] {
    return this.list().filter((r) => r.due === 'overdue' || r.due === 'today');
  }

  detail(rel: string) {
    const n = this.requireType(rel, 'routine', 'регулярное дело');
    return {
      ...this.routine(n),
      notes: this.section(n, ['Заметки', 'Notes']),
      history: parseDatedLines(this.section(n, ['История', 'History'])),
      related: this.life.related(n),
    };
  }

  /** Отмечает выполнение: дата последнего раза и строка в истории. */
  async markDone(rel: string, input: { date?: string | null; note?: string | null } = {}) {
    const n = this.requireType(rel, 'routine', 'регулярное дело');
    const date = this.checkDate(input.date, 'Дата');
    if (date > this.today) throw new VaultError('Нельзя отметить выполнение в будущем', 'invalid');
    const prev = fmDate(n.frontmatter.last_done);
    if (!prev || date >= prev) await this.vault.updateProperties(rel, { last_done: date });
    await this.logHistory(rel, date, `Сделано${input.note?.trim() ? `: ${input.note.trim()}` : ''}`);
    return this.routine(this.vault.require(rel));
  }

  /** Плановые даты в календаре: ближайшая и следующие по периоду. */
  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    const out: Array<{ date: string; item: CalendarItem }> = [];
    for (const r of this.list()) {
      if (!r.active) continue;
      let d = r.next < this.today ? this.today : r.next;
      for (let i = 0; i < 400 && d <= to; i++, d = addDays(d, r.every)) {
        if (d >= from) out.push({ date: d, item: { kind: 'event', title: r.title, path: r.path, noteType: 'routine', time: r.time, amount: null } });
      }
    }
    return out;
  }
}
