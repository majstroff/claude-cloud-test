/**
 * Дом: техника и гарантии, список покупок, бытовые дела, ремонт, счета.
 *
 *   type: appliance — техника: модель, дата покупки, цена, гарантия до, магазин,
 *                     инструкция; секция «Обслуживание» — история ремонтов и чисток.
 *   «Покупки.md» (type: shopping) — список покупок задачами Obsidian в секции «Список».
 *   «Бытовые дела.md» (type: chores) — разовые дела по дому задачами.
 *   Ремонт — обычные проекты со сферой «Дом»; счета — платежи и подписки
 *   из «Финансов» с бытовыми категориями; уборка — регулярные дела сферы «Дом».
 */
import { addDays, diffDays } from './dates.ts';
import { EntityModule, fmDate, fmEnum, fmNum, fmStr, parseDatedLines, parseNumber, type EntitySpec } from './entity-kit.ts';
import { VaultError, type Note } from './vault.ts';
import type { CalendarItem, Life, TaskDTO } from './life.ts';
import type { Finance } from './finance.ts';
import type { Routines } from './routines.ts';

export const APPLIANCE_STATUSES = ['in_use', 'repair', 'sold', 'disposed'] as const;
/** Категории платежей, которые считаются бытовыми счетами. */
export const HOME_BILL_RE = /(жкх|коммунал|аренд|квартир|ипотек|интернет|электр|газ|вод[аы]|отоплен|домофон|дом|связь)/i;

export interface ApplianceDTO {
  path: string;
  title: string;
  brand: string | null;
  model: string | null;
  room: string | null;
  purchased: string | null;
  price: number | null;
  store: string | null;
  warrantyUntil: string | null;
  warrantyState: 'active' | 'expiring' | 'expired' | 'none';
  warrantyDaysLeft: number | null;
  manual: string | null;
  status: (typeof APPLIANCE_STATUSES)[number];
  lastService: string | null;
  openTasks: number;
}

const LABELS: Record<string, string> = {
  brand: 'Бренд', model: 'Модель', room: 'Где стоит', purchased: 'Куплено', price: 'Цена', store: 'Магазин', warranty_until: 'Гарантия до',
  serial: 'Серийный номер', manual: 'Инструкция', status: 'Состояние', project: 'Проект',
};

export class Household extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(
    life: Life,
    private readonly finance: Finance,
    private readonly routines: Routines,
  ) {
    super(life);
    this.specs = {
      appliance: {
        folder: () => `${this.vault.folders.home}/Техника`,
        fields: {
          brand: 'text', model: 'text', room: 'text', purchased: 'date', price: 'money', store: 'text', warranty_until: 'date',
          serial: 'text', manual: 'url', status: { enum: APPLIANCE_STATUSES }, project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.status ??= 'in_use';
          return { body: `${text ? text + '\n\n' : ''}## Обслуживание\n\n## Задачи\n\n## Заметки\n` };
        },
        sections: { notes: 'Заметки' },
      },
    };
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
  }

  appliance(n: Note): ApplianceDTO {
    const fm = n.frontmatter;
    const until = fmDate(fm.warranty_until);
    const left = until ? diffDays(this.today, until) : null;
    const state: ApplianceDTO['warrantyState'] = !until ? 'none' : left! < 0 ? 'expired' : left! <= 30 ? 'expiring' : 'active';
    return {
      path: n.path,
      title: n.title,
      brand: fmStr(fm.brand),
      model: fmStr(fm.model),
      room: fmStr(fm.room),
      purchased: fmDate(fm.purchased),
      price: fmNum(fm.price),
      store: fmStr(fm.store),
      warrantyUntil: until,
      warrantyState: state,
      warrantyDaysLeft: left,
      manual: fmStr(fm.manual),
      status: fmEnum(fm.status, APPLIANCE_STATUSES, 'in_use'),
      lastService: parseDatedLines(this.section(n, ['Обслуживание', 'Service']))[0]?.date ?? null,
      openTasks: n.tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    };
  }

  appliances(): ApplianceDTO[] {
    const rank = { expiring: 0, active: 1, expired: 2, none: 3 } as const;
    return this.vault
      .byType('appliance')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.appliance(n))
      .sort((a, b) => rank[a.warrantyState] - rank[b.warrantyState] || a.title.localeCompare(b.title, 'ru'));
  }

  applianceDetail(rel: string) {
    const n = this.requireType(rel, 'appliance', 'техника');
    return {
      ...this.appliance(n),
      serial: fmStr(n.frontmatter.serial),
      service: parseDatedLines(this.section(n, ['Обслуживание', 'Service'])),
      notes: this.section(n, ['Заметки', 'Notes']),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
      related: this.life.related(n),
    };
  }

  async logService(rel: string, input: { text: string; date?: string | null; cost?: unknown }) {
    const n = this.requireType(rel, 'appliance', 'техника');
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new VaultError('Опишите, что сделали', 'invalid');
    const date = this.checkDate(input.date, 'Дата');
    const cost = input.cost === undefined || input.cost === null || input.cost === '' ? null : parseNumber(input.cost);
    if (input.cost !== undefined && input.cost !== null && input.cost !== '' && (cost === null || cost < 0)) throw new VaultError('Стоимость — неотрицательное число', 'invalid');
    await this.logHistory(rel, date, `${text}${cost ? ` · ${cost.toLocaleString('ru-RU')} ₽` : ''}`, 'Обслуживание');
    if (cost) await this.finance.addTransaction({ date, kind: 'expense', amount: cost, category: 'Дом', description: `${n.title}: ${text}`, link: rel });
    return this.appliance(this.vault.require(rel));
  }

  private async listNote(kind: 'shopping' | 'chores'): Promise<Note> {
    const existing = this.vault.byType(kind)[0];
    if (existing) return existing;
    const title = kind === 'shopping' ? 'Покупки' : 'Бытовые дела';
    const intro = kind === 'shopping' ? 'Список покупок для дома. Отмеченные пункты считаются купленными.' : 'Разовые дела по дому.';
    return this.ensureNote(this.vault.folders.home, title, { type: kind }, `# ${title}\n\n${intro}\n\n## ${kind === 'shopping' ? 'Список' : 'Задачи'}\n`);
  }

  async addShoppingItem(input: { text: string; due?: string | null }): Promise<TaskDTO> {
    const n = await this.listNote('shopping');
    return this.life.createTask({ text: input.text, due: input.due ?? null, path: n.path, section: 'Список' });
  }

  async addChore(input: { text: string; due?: string | null; priority?: 'high' | 'medium' | 'low' | 'none' }): Promise<TaskDTO> {
    const n = await this.listNote('chores');
    return this.life.createTask({ text: input.text, due: input.due ?? null, priority: input.priority, path: n.path, section: 'Задачи' });
  }

  /** Отмечает покупку и по желанию записывает расход в «Финансы». */
  async buy(input: { path: string; line: number; raw: string; amount?: unknown; category?: string | null }) {
    const n = this.vault.require(input.path);
    if (n.type !== 'shopping') throw new VaultError('Это не список покупок', 'invalid');
    const amount = input.amount === undefined || input.amount === null || input.amount === '' ? null : parseNumber(input.amount);
    if (input.amount !== undefined && input.amount !== null && input.amount !== '' && (amount === null || amount <= 0)) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    const task = await this.life.updateTask({ path: input.path, line: input.line, raw: input.raw, action: 'complete' });
    const tx = amount
      ? await this.finance.addTransaction({ kind: 'expense', amount, category: input.category?.trim() || 'Дом', description: task.title, link: input.path })
      : null;
    return { task, transaction: tx };
  }

  overview() {
    const today = this.today;
    const homeFolder = this.vault.folders.home;
    const inHome = (p: string) => p.startsWith(homeFolder + '/');
    const open = this.life.tasks('open');
    const shopping = this.vault.byType('shopping')[0] ?? null;
    const chores = open.filter(
      (t) => (inHome(t.path) && t.noteType !== 'shopping') || t.tags.some((g) => /^(дом|быт|home)$/i.test(g)),
    );
    const projects = this.life
      .projects()
      .filter((p) => p.status !== 'archived' && (/(дом|быт|home|квартир)/i.test(p.area ?? '') || /ремонт/i.test(p.title) || p.tags.some((g) => /^(дом|ремонт)$/i.test(g))));
    const bills = [
      ...this.finance.payments().filter((p) => p.status === 'planned' && (HOME_BILL_RE.test(p.category ?? '') || HOME_BILL_RE.test(p.title))),
    ];
    const subs = this.finance.subscriptions().filter((s) => s.status === 'active' && (HOME_BILL_RE.test(s.category) || HOME_BILL_RE.test(s.title)));
    return {
      today,
      appliances: this.appliances(),
      warranties: this.appliances().filter((a) => a.warrantyState === 'expiring' || (a.warrantyState === 'expired' && a.warrantyDaysLeft! > -30)),
      shopping: shopping
        ? { path: shopping.path, items: this.life.tasks('all').filter((t) => t.path === shopping.path && (t.status !== 'done' || t.doneDate === today || (t.doneDate ?? '') >= addDays(today, -7))) }
        : { path: null, items: [] as TaskDTO[] },
      chores,
      projects,
      bills,
      billSubscriptions: subs,
      routines: this.routines.list('home'),
    };
  }

  reminders() {
    return { warranties: this.appliances().filter((a) => a.warrantyState === 'expiring') };
  }

  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    return this.appliances()
      .filter((a) => a.warrantyUntil && a.warrantyUntil >= from && a.warrantyUntil <= to && a.status !== 'sold' && a.status !== 'disposed')
      .map((a) => ({ date: a.warrantyUntil!, item: { kind: 'deadline' as const, title: `Гарантия заканчивается: ${a.title}`, path: a.path, noteType: 'appliance' } }));
  }
}
