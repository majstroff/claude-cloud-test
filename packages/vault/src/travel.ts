/**
 * Путешествия: поездки, брони и билеты, бюджет, документы и списки вещей.
 *
 *   type: trip    — поездка: куда, даты, бюджет, участники, документы (ссылки на
 *                   заметки раздела «Документы»), проект или цель. Секции:
 *                   «Маршрут» (строки «- 2026-12-10 · Тбилиси»), «Список вещей»
 *                   (задачи-галочки Obsidian), «Заметки».
 *   type: booking — бронь или билет: поездка, вид, дата и время, до какого числа,
 *                   место, кто продаёт, код брони, стоимость, оплачено ли.
 * Расходы поездки — операции «Финансов» со связью на поездку или её брони.
 */
import { addDays, diffDays, isIsoDate } from './dates.ts';
import { appendToSection } from './markdown.ts';
import { EntityModule, fmDate, fmEnum, fmNum, fmStr, linkOrText, parseDatedLines, parseNumber, type EntitySpec, type Ref } from './entity-kit.ts';
import { VaultError, type Note } from './vault.ts';
import type { CalendarItem, Life, TaskDTO } from './life.ts';
import type { Finance, TransactionDTO } from './finance.ts';

export const TRIP_STATUSES = ['idea', 'planning', 'booked', 'done', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
/** Фаза считается по датам: «в поездке» и «прошла» не нужно отмечать вручную. */
export type TripPhase = 'idea' | 'planning' | 'booked' | 'ongoing' | 'done' | 'cancelled';
export const BOOKING_KINDS = ['flight', 'train', 'bus', 'hotel', 'apartment', 'car', 'transfer', 'tour', 'insurance', 'event', 'other'] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_KIND_LABEL: Record<BookingKind, string> = {
  flight: 'Перелёт',
  train: 'Поезд',
  bus: 'Автобус',
  hotel: 'Отель',
  apartment: 'Апартаменты',
  car: 'Аренда авто',
  transfer: 'Трансфер',
  tour: 'Экскурсия',
  insurance: 'Страховка',
  event: 'Билет на событие',
  other: 'Другое',
};
/** Брони с датой окончания, которая важна в календаре (выезд, сдача машины). */
const STAY_KINDS: BookingKind[] = ['hotel', 'apartment', 'car'];
export const PACKING_SECTION = 'Список вещей';

/** Готовые списки вещей: добавляются только недостающие пункты. */
export const PACKING_TEMPLATES: Record<string, { label: string; items: string[] }> = {
  base: {
    label: 'Базовый',
    items: ['Паспорт и документы', 'Билеты и брони (офлайн-копии)', 'Банковские карты и наличные', 'Телефон и зарядка', 'Пауэрбанк', 'Переходник для розеток', 'Аптечка и личные лекарства', 'Средства гигиены', 'Одежда по погоде', 'Удобная обувь'],
  },
  beach: { label: 'Море', items: ['Купальник / плавки', 'Солнцезащитный крем', 'Солнечные очки', 'Головной убор', 'Пляжное полотенце', 'Шлёпанцы'] },
  winter: { label: 'Зима и горы', items: ['Термобельё', 'Тёплая куртка', 'Шапка, шарф, перчатки', 'Тёплые носки', 'Крем от мороза', 'Термос'] },
  business: { label: 'Командировка', items: ['Ноутбук и зарядка', 'Деловая одежда', 'Визитки', 'Материалы к встречам', 'Документы для отчёта о расходах'] },
};

export interface BookingDTO {
  path: string;
  title: string;
  kind: BookingKind;
  trip: Ref | null;
  date: string | null;
  time: string | null;
  endDate: string | null;
  place: string | null;
  provider: string | null;
  confirmation: string | null;
  cost: number | null;
  paid: boolean;
  url: string | null;
}

export interface TripDTO {
  path: string;
  title: string;
  status: TripStatus;
  phase: TripPhase;
  destination: string | null;
  start: string | null;
  end: string | null;
  nights: number | null;
  /** Дней до начала (отрицательное — уже началась). */
  daysUntil: number | null;
  budget: number | null;
  /** Стоимость всех броней. */
  booked: number;
  /** Записано в «Финансы» по поездке и её броням. */
  spent: number;
  /** Брони без оплаты: ещё предстоит заплатить. */
  unpaid: number;
  /** Остаток бюджета с учётом неоплаченных броней. */
  left: number | null;
  overBudget: boolean;
  bookings: number;
  packingTotal: number;
  packingDone: number;
  documentIssues: number;
  travelers: string[];
  project: Ref | null;
  goal: Ref | null;
}

export interface TripDocumentCheck {
  path: string | null;
  title: string;
  expires: string | null;
  level: 'ok' | 'warning' | 'error' | 'unknown';
  message: string;
}

const LABELS: Record<string, string> = {
  status: 'Статус', destination: 'Куда', start: 'Начало', end: 'Конец', budget: 'Бюджет', travelers: 'Кто едет', documents: 'Документы',
  project: 'Проект', goal: 'Цель', trip: 'Поездка', kind: 'Вид', date: 'Дата', time: 'Время', end_date: 'До (выезд, возврат)',
  place: 'Откуда — куда / адрес', provider: 'Перевозчик / сервис', confirmation: 'Код брони', cost: 'Стоимость', paid: 'Оплачено', url: 'Ссылка',
};

export class Travel extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(
    life: Life,
    private readonly finance: Finance,
  ) {
    super(life);
    this.specs = {
      trip: {
        folder: () => this.vault.folders.travel,
        fields: {
          status: { enum: TRIP_STATUSES }, destination: 'text', start: 'date', end: 'date', budget: 'money',
          travelers: 'list', documents: 'list', project: 'link', goal: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.status ??= 'planning';
          checkRange(fm.start, fm.end);
          return { body: `${text ? text + '\n\n' : ''}## Маршрут\n\n## ${PACKING_SECTION}\n\n## Задачи\n\n## Заметки\n` };
        },
        sections: { route: 'Маршрут', notes: 'Заметки' },
      },
      booking: {
        folder: () => `${this.vault.folders.travel}/Брони`,
        fields: {
          trip: 'link', kind: { enum: BOOKING_KINDS }, date: 'date', time: 'time', end_date: 'date', place: 'text', provider: 'text',
          confirmation: 'text', cost: 'money', paid: 'boolean', url: 'url',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.kind ??= 'other';
          fm.paid ??= false;
          checkRange(fm.date, fm.end_date, 'Дата окончания брони раньше её начала');
          return { body: `${text ? text + '\n\n' : ''}## Заметки\n` };
        },
        sections: { notes: 'Заметки' },
      },
    };
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
    // Вещи в поездку — чек-лист, а не дела без срока: в бэклоге им не место.
    life.excludeFromBacklog((t, n) => n.type === 'trip' && t.section === PACKING_SECTION);
  }

  /** Документы в поездке — ссылки на заметки, а не просто текст. */
  override normalizeFields(type: string, input: Record<string, unknown>) {
    const r = super.normalizeFields(type, input);
    if (Array.isArray(r.set.documents)) r.set.documents = (r.set.documents as string[]).map((d) => linkOrText(this.vault, d));
    return r;
  }

  override async updateEntity(rel: string, input: Record<string, unknown>): Promise<Note> {
    const n = this.vault.require(rel);
    const fm = n.frontmatter;
    const { set, unset } = this.normalizeFields(n.type, input);
    const pick = (k: string) => (unset.includes(k) ? null : k in set ? set[k] : fm[k]);
    if (n.type === 'trip') checkRange(pick('start'), pick('end'));
    if (n.type === 'booking') checkRange(pick('date'), pick('end_date'), 'Дата окончания брони раньше её начала');
    return super.updateEntity(rel, input);
  }

  // ---------- Брони ----------

  booking(n: Note): BookingDTO {
    const fm = n.frontmatter;
    return {
      path: n.path,
      title: n.title,
      kind: fmEnum(fm.kind, BOOKING_KINDS, 'other'),
      trip: this.ref(n, 'trip'),
      date: fmDate(fm.date),
      time: fmStr(fm.time),
      endDate: fmDate(fm.end_date),
      place: fmStr(fm.place),
      provider: fmStr(fm.provider),
      confirmation: fmStr(fm.confirmation),
      cost: fmNum(fm.cost),
      paid: fm.paid === true,
      url: fmStr(fm.url),
    };
  }

  bookingsOf(tripPath: string): BookingDTO[] {
    return this.vault
      .byType('booking')
      .map((n) => this.booking(n))
      .filter((b) => b.trip?.path === tripPath)
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? ''));
  }

  bookingDetail(rel: string) {
    const n = this.requireType(rel, 'booking', 'бронь');
    return {
      ...this.booking(n),
      notes: this.section(n, ['Заметки', 'Notes']),
      transactions: this.finance.transactions().filter((t) => t.link?.path === n.path),
      related: this.life.related(n),
    };
  }

  /** Отмечает бронь оплаченной и записывает расход «Путешествия» в «Финансы». */
  async payBooking(rel: string, input: { date?: string | null; amount?: unknown } = {}) {
    const n = this.requireType(rel, 'booking', 'бронь');
    const b = this.booking(n);
    if (b.paid) throw new VaultError('Бронь уже отмечена оплаченной', 'conflict');
    const given = input.amount === undefined || input.amount === null || input.amount === '' ? null : parseNumber(input.amount);
    if (given !== null && given <= 0) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    if (input.amount !== undefined && input.amount !== null && input.amount !== '' && given === null) throw new VaultError('Сумма — число', 'invalid');
    const amount = given ?? b.cost;
    const date = this.checkDate(input.date, 'Дата оплаты');
    const tx = amount
      ? await this.finance.addTransaction({ date, kind: 'expense', amount, category: 'Путешествия', description: `${b.trip?.title ? b.trip.title + ': ' : ''}${b.title}`, link: rel })
      : null;
    const set: Record<string, unknown> = { paid: true };
    if (amount && b.cost === null) set.cost = amount;
    await this.vault.updateProperties(rel, set);
    return { booking: this.booking(this.vault.require(rel)), transaction: tx };
  }

  // ---------- Поездки ----------

  private phase(status: TripStatus, start: string | null, end: string | null): TripPhase {
    if (status === 'cancelled' || status === 'idea') return status;
    const today = this.today;
    const last = end ?? start;
    if (start && start <= today && last && last >= today) return 'ongoing';
    if (last && last < today) return 'done';
    return status;
  }

  private spentOf(n: Note, bookings: BookingDTO[]): TransactionDTO[] {
    const paths = new Set([n.path, ...bookings.map((b) => b.path)]);
    return this.finance.transactions().filter((t) => t.kind === 'expense' && t.link?.path && paths.has(t.link.path));
  }

  trip(n: Note): TripDTO {
    const fm = n.frontmatter;
    const status = fmEnum(fm.status, TRIP_STATUSES, 'planning');
    const start = fmDate(fm.start);
    const end = fmDate(fm.end);
    const bookings = this.bookingsOf(n.path);
    const booked = sum(bookings.map((b) => b.cost ?? 0));
    const unpaid = sum(bookings.filter((b) => !b.paid).map((b) => b.cost ?? 0));
    const spent = sum(this.spentOf(n, bookings).map((t) => t.amount));
    const budget = fmNum(fm.budget);
    const left = budget === null ? null : round(budget - spent - unpaid);
    const packing = n.tasks.filter((t) => t.section === PACKING_SECTION && t.status !== 'cancelled');
    const phase = this.phase(status, start, end);
    return {
      path: n.path,
      title: n.title,
      status,
      phase,
      destination: fmStr(fm.destination),
      start,
      end,
      nights: start && end ? Math.max(0, diffDays(start, end)) : null,
      daysUntil: start ? diffDays(this.today, start) : null,
      budget,
      booked,
      spent,
      unpaid,
      left,
      overBudget: left !== null && left < 0,
      bookings: bookings.length,
      packingTotal: packing.length,
      packingDone: packing.filter((t) => t.status === 'done').length,
      documentIssues: phase === 'done' || phase === 'cancelled' ? 0 : this.documentCheck(n, end ?? start).filter((d) => d.level === 'error' || d.level === 'warning').length,
      travelers: listOf(fm.travelers),
      project: this.ref(n, 'project'),
      goal: this.ref(n, 'goal'),
    };
  }

  trips(): TripDTO[] {
    const rank: Record<TripPhase, number> = { ongoing: 0, booked: 1, planning: 2, idea: 3, done: 4, cancelled: 5 };
    return this.vault
      .byType('trip')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.trip(n))
      .sort((a, b) => rank[a.phase] - rank[b.phase] || (a.phase === 'done' ? (b.start ?? '').localeCompare(a.start ?? '') : (a.start ?? '9999').localeCompare(b.start ?? '9999')));
  }

  /**
   * Проверка документов к поездке: срок действия против даты возвращения.
   * Номера документов не читаются и не передаются — только срок действия.
   */
  documentCheck(n: Note, until: string | null): TripDocumentCheck[] {
    const raw = listOf(n.frontmatter.documents);
    const linked = n.links.filter((l) => l.key === 'documents');
    const out: TripDocumentCheck[] = [];
    for (const item of raw) {
      const name = item.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();
      const link = linked.find((l) => l.target === name && l.resolved);
      const doc = link?.resolved ? this.vault.get(link.resolved) : this.vault.get(this.vault.resolve(name) ?? '');
      if (!doc) {
        out.push({ path: null, title: name, expires: null, level: 'unknown', message: 'Заметки документа нет — срок действия не проверить' });
        continue;
      }
      const expires = fmDate(doc.frontmatter.expires) ?? fmDate(doc.frontmatter.valid_until);
      const isPassport = /passport|паспорт/i.test(String(doc.frontmatter.doc_type ?? '')) || /паспорт|passport/i.test(doc.title);
      let level: TripDocumentCheck['level'] = 'ok';
      let message = expires ? `Действует до ${expires}` : 'Бессрочный';
      if (expires && expires < this.today) [level, message] = ['error', `Истёк ${expires}`];
      else if (expires && until && expires < until) [level, message] = ['error', `Истекает ${expires} — раньше, чем закончится поездка`];
      else if (expires && until && isPassport && expires < addDays(until, 183)) {
        [level, message] = ['warning', `Действует до ${expires}: меньше 6 месяцев после возвращения — для многих стран этого мало`];
      }
      out.push({ path: doc.path, title: doc.title, expires, level, message });
    }
    return out;
  }

  tripDetail(rel: string) {
    const n = this.requireType(rel, 'trip', 'поездка');
    const t = this.trip(n);
    const bookings = this.bookingsOf(n.path);
    const tasks = this.life.tasks('all').filter((x) => x.path === n.path);
    return {
      ...t,
      route: this.section(n, ['Маршрут', 'Route']),
      routePoints: parseDatedLines(this.section(n, ['Маршрут', 'Route'])).reverse(),
      notes: this.section(n, ['Заметки', 'Notes']),
      bookingList: bookings,
      packing: tasks.filter((x) => x.section === PACKING_SECTION),
      tasks: tasks.filter((x) => x.section !== PACKING_SECTION),
      documents: this.documentCheck(n, t.end ?? t.start),
      transactions: this.spentOf(n, bookings),
      templates: Object.entries(PACKING_TEMPLATES).map(([id, v]) => ({ id, label: v.label, count: v.items.length })),
      related: this.life.related(n),
    };
  }

  async addRoutePoint(rel: string, input: { date?: string | null; text: string }) {
    const n = this.requireType(rel, 'trip', 'поездка');
    const text = input.text.replace(/\s+/g, ' ').trim();
    if (!text) throw new VaultError('Опишите пункт маршрута', 'invalid');
    const t = this.trip(n);
    const date = this.checkDate(input.date || t.start, 'Дата');
    await this.vault.transform(rel, (c) => appendToSection(c, 'Маршрут', `- ${date} · ${text}`).text);
    return this.trip(this.vault.require(rel));
  }

  async addPackingItem(rel: string, text: string): Promise<TaskDTO> {
    this.requireType(rel, 'trip', 'поездка');
    return this.life.createTask({ text, path: rel, section: PACKING_SECTION });
  }

  /** Добавляет пункты готового списка, которых ещё нет в «Списке вещей». */
  async fillPacking(rel: string, template: string): Promise<{ added: number }> {
    const n = this.requireType(rel, 'trip', 'поездка');
    const tpl = PACKING_TEMPLATES[template];
    if (!tpl) throw new VaultError('Неизвестный список вещей', 'invalid');
    const have = new Set(n.tasks.filter((t) => t.section === PACKING_SECTION).map((t) => t.title.toLowerCase()));
    const missing = tpl.items.filter((i) => !have.has(i.toLowerCase()));
    if (missing.length === 0) return { added: 0 };
    await this.vault.transform(rel, (c) => missing.reduce((acc, i) => appendToSection(acc, PACKING_SECTION, `- [ ] ${i}`).text, c));
    return { added: missing.length };
  }

  async addExpense(rel: string, input: { amount: unknown; description?: string | null; date?: string | null }) {
    const n = this.requireType(rel, 'trip', 'поездка');
    return this.finance.addTransaction({
      date: input.date,
      kind: 'expense',
      amount: input.amount as number | string,
      category: 'Путешествия',
      description: `${n.title}${input.description?.trim() ? ': ' + input.description.trim() : ''}`,
      link: rel,
    });
  }

  overview() {
    const trips = this.trips();
    const year = this.today.slice(0, 4);
    return {
      today: this.today,
      trips,
      current: trips.filter((t) => t.phase === 'ongoing'),
      upcoming: trips.filter((t) => t.phase === 'booked' || t.phase === 'planning'),
      ideas: trips.filter((t) => t.phase === 'idea'),
      past: trips.filter((t) => t.phase === 'done'),
      cancelled: trips.filter((t) => t.phase === 'cancelled'),
      yearSpent: sum(trips.filter((t) => (t.start ?? '').startsWith(year)).map((t) => t.spent)),
      nextBookings: this.vault
        .byType('booking')
        .map((n) => this.booking(n))
        .filter((b) => b.date && b.date >= this.today)
        .sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '').localeCompare(b.time ?? ''))
        .slice(0, 8),
      unpaidBookings: this.vault
        .byType('booking')
        .map((n) => this.booking(n))
        .filter((b) => !b.paid && b.cost && (!b.date || b.date >= this.today)),
    };
  }

  /** Для «Главной»: текущая или ближайшая поездка в пределах 60 дней. */
  next(): TripDTO | null {
    const t = this.trips().find((x) => x.phase === 'ongoing' || ((x.phase === 'booked' || x.phase === 'planning') && x.daysUntil !== null && x.daysUntil >= 0 && x.daysUntil <= 60));
    return t ?? null;
  }

  /** Для «Сегодня»: поездки, которые идут в этот день, и брони на этот день. */
  day(date: string) {
    const trips = this.trips().filter((t) => t.phase !== 'cancelled' && t.phase !== 'idea' && t.start && t.start <= date && (t.end ?? t.start) >= date);
    const bookings = this.vault
      .byType('booking')
      .map((n) => this.booking(n))
      .filter((b) => b.date === date || (b.endDate === date && STAY_KINDS.includes(b.kind)));
    return { trips, bookings };
  }

  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    const out: Array<{ date: string; item: CalendarItem }> = [];
    const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;
    for (const t of this.trips()) {
      if (t.phase === 'cancelled' || t.phase === 'idea') continue;
      if (inRange(t.start)) out.push({ date: t.start, item: { kind: 'event', title: `Поездка: ${t.title}`, path: t.path, noteType: 'trip', time: null, amount: null } });
      if (t.end && t.end !== t.start && inRange(t.end)) out.push({ date: t.end, item: { kind: 'event', title: `Возвращение: ${t.title}`, path: t.path, noteType: 'trip', time: null, amount: null } });
    }
    // Начало брони (date) попадает в календарь как обычное событие с датой; здесь — окончание проживания и аренды.
    for (const n of this.vault.byType('booking')) {
      const b = this.booking(n);
      if (STAY_KINDS.includes(b.kind) && b.endDate && b.endDate !== b.date && inRange(b.endDate)) {
        out.push({ date: b.endDate, item: { kind: 'event', title: `${b.kind === 'car' ? 'Вернуть авто' : 'Выезд'}: ${b.title}`, path: b.path, noteType: 'booking', time: null, amount: null } });
      }
    }
    return out;
  }
}

function checkRange(a: unknown, b: unknown, msg = 'Конец поездки раньше начала'): void {
  if (isIsoDate(a) && isIsoDate(b) && b < a) throw new VaultError(msg, 'invalid');
}

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => fmStr(x)).filter((x): x is string => !!x);
  const s = fmStr(v);
  return s ? [s] : [];
}

function sum(a: number[]): number {
  return round(a.reduce((x, y) => x + y, 0));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
