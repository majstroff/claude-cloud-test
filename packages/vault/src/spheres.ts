/**
 * Сферы жизни этапа 6: финансы, здоровье, обучение, практики, дом
 * и общие регулярные дела. Здесь же — сводки для «Главной» и «Сегодня».
 */
import { addDays } from './dates.ts';
import { Finance } from './finance.ts';
import { Health } from './health.ts';
import { Household } from './household.ts';
import { Learning } from './learning.ts';
import { Practices, moonPhase } from './practices.ts';
import { Routines } from './routines.ts';
import { Knowledge } from './knowledge.ts';
import { Travel } from './travel.ts';
import { Relationships } from './relationships.ts';
import type { EntityModule } from './entity-kit.ts';
import type { Life } from './life.ts';

export class Spheres {
  readonly routines: Routines;
  readonly finance: Finance;
  readonly health: Health;
  readonly learning: Learning;
  readonly practices: Practices;
  readonly home: Household;
  readonly knowledge: Knowledge;
  readonly travel: Travel;
  readonly relations: Relationships;

  constructor(readonly life: Life) {
    this.routines = new Routines(life);
    this.finance = new Finance(life);
    this.health = new Health(life);
    this.learning = new Learning(life);
    this.practices = new Practices(life);
    this.home = new Household(life, this.finance, this.routines);
    this.knowledge = new Knowledge(life);
    this.travel = new Travel(life, this.finance);
    this.relations = new Relationships(life, this.finance);
  }

  /** Модули, которые создают и меняют записи через общие /api/entities и /api/entity. */
  get owners(): EntityModule[] {
    return [this.routines, this.finance, this.health, this.learning, this.home, this.knowledge, this.travel, this.relations];
  }

  ownerOf(type: string): EntityModule | null {
    return this.owners.find((o) => o.entityTypes.includes(type)) ?? null;
  }

  /** Для «Главной»: платежи на неделю, тренировки и регулярные дела на сегодня, гарантии. */
  dashboard() {
    const today = this.life.today;
    const fin = this.finance.reminders();
    return {
      obligations: fin.obligations,
      obligationsOverdue: fin.overdue,
      obligationsTotal: fin.total,
      workoutsToday: this.health.workoutsOn(today),
      routinesDue: this.routines.dueToday(),
      warranties: this.home.reminders().warranties,
      learningActive: this.learning.items().filter((i) => i.status === 'active').slice(0, 3),
      nextTrip: this.travel.next(),
      ...this.relations.reminders(),
    };
  }

  /** Для «Сегодня»: то, что относится к выбранному дню. */
  day(date: string) {
    const today = this.life.today;
    const isToday = date === today;
    const obligations = this.finance.obligations(date).filter((o) => o.date === date || (isToday && o.overdue));
    const routines = this.routines
      .list()
      .filter((r) => r.active && (isToday ? r.due === 'overdue' || r.due === 'today' : date > today && (r.next === date || (r.next < date && (Date.parse(date) - Date.parse(r.next)) / 86_400_000 % r.every === 0))));
    return {
      date,
      isToday,
      obligations,
      workouts: this.health.workouts().filter((w) => w.date === date && w.status !== 'skipped'),
      routines,
      practices: this.practices.day(date),
      health: this.health.dayHealth(date),
      moon: moonPhase(date),
      travel: this.travel.day(date),
      occasions: this.relations.day(date).occasions,
      tomorrowObligations: isToday ? this.finance.obligations(addDays(date, 1)).filter((o) => o.date === addDays(date, 1)) : [],
    };
  }
}
