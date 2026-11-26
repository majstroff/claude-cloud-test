/**
 * Отношения: дни рождения, важные даты, подарки, договорённости и ритм общения.
 *
 * Люди — заметки контактов (type: contact) из раздела «Контакты». Для отношений
 * у контакта есть свойства birthday (ГГГГ-ММ-ДД или ММ-ДД, если год неизвестен)
 * и contact_every — раз в сколько дней хочется связываться.
 *
 *   type: important_date / birthday — ежегодная (или разовая) дата: годовщина,
 *        памятный день, праздник; date, kind, person (ссылка на контакт), yearly,
 *        remind_days.
 * Подарки — секции «Идеи подарков» (простой список) и «Подарки» (строки
 * «- 2026-11-24 · что подарили · повод · сумма») в заметке человека или даты.
 * Договорённости — задачи в секции «Договорённости» заметки контакта.
 */
import { addDays, diffDays } from './dates.ts';
import { appendToSection, getSectionText, setSectionText } from './markdown.ts';
import {
  EntityModule,
  fmDate,
  fmEnum,
  fmNum,
  fmStr,
  nextOccurrence,
  parseAnniversary,
  parseDatedLines,
  parseNumber,
  type EntitySpec,
  type Ref,
} from './entity-kit.ts';
import { VaultError, type Note } from './vault.ts';
import type { CalendarItem, Life, TaskDTO } from './life.ts';
import type { Finance } from './finance.ts';

export const DATE_KINDS = ['birthday', 'anniversary', 'memorial', 'holiday', 'other'] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export const DATE_KIND_LABEL: Record<DateKind, string> = {
  birthday: 'День рождения',
  anniversary: 'Годовщина',
  memorial: 'Памятная дата',
  holiday: 'Праздник',
  other: 'Другое',
};
/** Близкие люди: друзья и семья (остальные — если указан день рождения или ритм общения). */
const PERSONAL_KINDS = ['friend', 'family'];
const GIFT_TYPES = ['contact', 'important_date', 'birthday'];
const DEFAULT_REMIND = 7;
const IDEAS = 'Идеи подарков';
const GIVEN = 'Подарки';

export interface OccasionDTO {
  /** Уникальный ключ: путь заметки (+ «#birthday» для дня рождения из контакта). */
  key: string;
  path: string;
  title: string;
  source: 'contact' | 'date';
  kind: DateKind;
  person: Ref | null;
  /** Ближайшая дата наступления. */
  next: string;
  daysLeft: number;
  /** Сколько лет исполняется / прошло (если год известен). */
  years: number | null;
  yearly: boolean;
  remindDays: number;
  /** Пора готовиться: до даты осталось не больше remindDays. */
  remind: boolean;
  giftIdeas: number;
}

export interface PersonDTO {
  path: string;
  title: string;
  kind: string | null;
  birthday: string | null;
  nextBirthday: string | null;
  birthdayIn: number | null;
  age: number | null;
  contactEvery: number | null;
  lastContact: string | null;
  nextContact: string | null;
  /** Когда пора связаться: явная дата или последняя связь + ритм. */
  due: string | null;
  dueState: 'overdue' | 'today' | 'soon' | null;
  daysSince: number | null;
  giftIdeas: number;
  agreements: number;
}

const LABELS: Record<string, string> = {
  date: 'Дата', kind: 'Вид', person: 'Человек', yearly: 'Каждый год', remind_days: 'Напомнить за, дней', project: 'Проект',
};

export class Relationships extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(
    life: Life,
    private readonly finance: Finance,
  ) {
    super(life);
    const spec = (dflt: DateKind): EntitySpec => ({
      folder: () => `${this.vault.folders.relationships}/Даты`,
      fields: { date: 'monthday', kind: { enum: DATE_KINDS }, person: 'link', yearly: 'boolean', remind_days: 'number', project: 'link' },
      labels: LABELS,
      create: ({ fm, text }) => {
        if (typeof fm.date !== 'string') throw new VaultError('Укажите дату', 'invalid');
        fm.kind ??= dflt;
        fm.yearly ??= true;
        if (fm.yearly === false && !parseAnniversary(fm.date)?.year) throw new VaultError('Для разовой даты укажите год', 'invalid');
        return { body: `${text ? text + '\n\n' : ''}## ${IDEAS}\n\n## ${GIVEN}\n\n## Задачи\n\n## Заметки\n` };
      },
      sections: { notes: 'Заметки' },
    });
    this.specs = { important_date: spec('other'), birthday: spec('birthday') };
    life.ownCalendarType('important_date');
    life.ownCalendarType('birthday');
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
  }

  // ---------- Даты ----------

  /** Все ежегодные и разовые даты: из контактов и из заметок дат. */
  occasions(): OccasionDTO[] {
    const today = this.today;
    const out: OccasionDTO[] = [];
    const notePeople = new Set<string>();
    for (const n of [...this.vault.byType('important_date'), ...this.vault.byType('birthday')]) {
      if (n.para === 'archive') continue;
      const a = parseAnniversary(n.frontmatter.date);
      if (!a) continue;
      const kind = fmEnum(n.frontmatter.kind, DATE_KINDS, n.type === 'birthday' ? 'birthday' : 'other');
      const yearly = n.frontmatter.yearly !== false;
      const next = yearly ? nextOccurrence(a.md, today) : a.year ? `${a.year}-${a.md}` : null;
      if (!next || next < today) continue;
      const person = this.ref(n, 'person');
      if (person?.path && kind === 'birthday') notePeople.add(`${person.path}|${a.md}`);
      out.push(this.occasion(n, { key: n.path, source: 'date', kind, person, md: a.md, year: a.year, next, yearly, title: n.title }));
    }
    for (const n of this.vault.byType('contact')) {
      if (n.para === 'archive') continue;
      const a = parseAnniversary(n.frontmatter.birthday);
      if (!a || notePeople.has(`${n.path}|${a.md}`)) continue;
      out.push(
        this.occasion(n, {
          key: `${n.path}#birthday`,
          source: 'contact',
          kind: 'birthday',
          person: { path: n.path, title: n.title },
          md: a.md,
          year: a.year,
          next: nextOccurrence(a.md, today),
          yearly: true,
          title: `День рождения: ${n.title}`,
        }),
      );
    }
    return out.sort((x, y) => x.daysLeft - y.daysLeft || x.title.localeCompare(y.title, 'ru'));
  }

  private occasion(
    n: Note,
    o: { key: string; source: 'contact' | 'date'; kind: DateKind; person: Ref | null; md: string; year: number | null; next: string; yearly: boolean; title: string },
  ): OccasionDTO {
    const remindDays = o.source === 'date' ? fmNum(n.frontmatter.remind_days) ?? DEFAULT_REMIND : DEFAULT_REMIND;
    const daysLeft = diffDays(this.today, o.next);
    const years = o.year ? Number(o.next.slice(0, 4)) - o.year : null;
    return {
      key: o.key,
      path: n.path,
      title: o.title,
      source: o.source,
      kind: o.kind,
      person: o.person,
      next: o.next,
      daysLeft,
      years: years && years > 0 ? years : null,
      yearly: o.yearly,
      remindDays,
      remind: daysLeft <= remindDays,
      // Для даты, связанной с человеком, считаем и идеи из карточки этого человека.
      giftIdeas: this.giftIdeas(n).length + (o.source === 'date' && o.person?.path ? this.giftIdeasOf(o.person.path) : 0),
    };
  }

  private giftIdeasOf(rel: string): number {
    const p = this.vault.get(rel);
    return p ? this.giftIdeas(p).length : 0;
  }

  upcoming(days = 30): OccasionDTO[] {
    return this.occasions().filter((o) => o.daysLeft <= days);
  }

  /** Наступления дат в периоде (ежегодные — каждый год). */
  occurrences(from: string, to: string): Array<{ date: string; title: string; occasion: OccasionDTO }> {
    const out: Array<{ date: string; title: string; occasion: OccasionDTO }> = [];
    for (const o of this.occasions()) {
      const dates: string[] = [];
      if (!o.yearly) dates.push(o.next);
      else for (let d = nextOccurrence(o.next.slice(5), from); d <= to; d = nextOccurrence(o.next.slice(5), addDays(d, 1))) dates.push(d);
      for (const date of dates) {
        if (date < from || date > to) continue;
        const years = o.years !== null ? o.years + (Number(date.slice(0, 4)) - Number(o.next.slice(0, 4))) : null;
        out.push({ date, title: years && years > 0 ? `${o.title} (${years})` : o.title, occasion: o });
      }
    }
    return out;
  }

  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    return this.occurrences(from, to).map(({ date, title, occasion: o }) => ({
      date,
      item: { kind: 'event' as const, title, path: o.path, noteType: o.source === 'contact' ? 'contact' : o.kind === 'birthday' ? 'birthday' : 'important_date', time: null, amount: null },
    }));
  }

  // ---------- Люди ----------

  person(n: Note): PersonDTO {
    const fm = n.frontmatter;
    const today = this.today;
    const a = parseAnniversary(fm.birthday);
    const nextBirthday = a ? nextOccurrence(a.md, today) : null;
    const every = fmNum(fm.contact_every);
    const last = fmDate(fm.last_contact);
    const explicit = fmDate(fm.next_contact);
    const created = fmDate(fm.created);
    const due = explicit ?? (every && every > 0 ? addDays(last ?? created ?? today, every) : null);
    let dueState: PersonDTO['dueState'] = null;
    if (due) dueState = due < today ? 'overdue' : due === today ? 'today' : due <= addDays(today, 3) ? 'soon' : null;
    const age = a?.year && nextBirthday ? Number(nextBirthday.slice(0, 4)) - a.year - (nextBirthday === today ? 0 : 1) : null;
    return {
      path: n.path,
      title: n.title,
      kind: fmStr(fm.kind),
      birthday: a ? (a.year ? `${a.year}-${a.md}` : a.md) : null,
      nextBirthday,
      birthdayIn: nextBirthday ? diffDays(today, nextBirthday) : null,
      age: age !== null && age >= 0 ? age : null,
      contactEvery: every,
      lastContact: last,
      nextContact: explicit,
      due,
      dueState,
      daysSince: last ? diffDays(last, today) : null,
      giftIdeas: this.giftIdeas(n).length,
      agreements: n.tasks.filter((t) => (t.status === 'open' || t.status === 'in_progress') && isAgreement(t.section)).length,
    };
  }

  /** Близкие и те, для кого задан день рождения или ритм общения. */
  people(): PersonDTO[] {
    const rank = (p: PersonDTO) => (p.dueState === 'overdue' ? 0 : p.dueState === 'today' ? 1 : p.dueState === 'soon' ? 2 : 3);
    return this.vault
      .byType('contact')
      .filter((n) => n.para !== 'archive')
      .filter((n) => PERSONAL_KINDS.includes(String(n.frontmatter.kind)) || n.frontmatter.birthday || n.frontmatter.contact_every)
      .map((n) => this.person(n))
      .sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'ru'));
  }

  /** Пора связаться по ритму общения (для явной даты «Следующий контакт» есть напоминания раздела «Контакты»). */
  contactsDue(): PersonDTO[] {
    return this.people().filter((p) => p.dueState && !p.nextContact && p.contactEvery);
  }

  /** Открытые договорённости со всеми людьми. */
  agreements(): TaskDTO[] {
    return this.life
      .tasks('open')
      .filter((t) => t.noteType === 'contact' && isAgreement(t.section))
      .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  }

  async addAgreement(rel: string, input: { text: string; due?: string | null }): Promise<TaskDTO> {
    this.requireType(rel, 'contact', 'контакт');
    return this.life.createTask({ text: input.text, due: input.due ?? null, path: rel, section: 'Договорённости' });
  }

  // ---------- Подарки ----------

  giftIdeas(n: Note): string[] {
    return (getSectionText(n.body, [IDEAS, 'Идеи для подарков']) ?? '')
      .split('\n')
      .map((l) => /^\s*[-*+]\s+(?!\[.\])(.+)$/.exec(l)?.[1]?.trim())
      .filter((x): x is string => !!x);
  }

  gifts(rel: string) {
    const n = this.giftNote(rel);
    return { ideas: this.giftIdeas(n), given: parseDatedLines(getSectionText(n.body, [GIVEN]) ?? '') };
  }

  private giftNote(rel: string): Note {
    const n = this.vault.require(rel);
    if (!GIFT_TYPES.includes(n.type)) throw new VaultError('Подарки ведутся в заметке человека или важной даты', 'invalid');
    return n;
  }

  async addGiftIdea(rel: string, text: string) {
    const n = this.giftNote(rel);
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) throw new VaultError('Опишите идею подарка', 'invalid');
    if (this.giftIdeas(n).some((i) => i.toLowerCase() === t.toLowerCase())) throw new VaultError('Такая идея уже записана', 'conflict');
    await this.vault.transform(rel, (c) => appendToSection(c, IDEAS, `- ${t}`).text);
    return this.gifts(rel);
  }

  /**
   * Записывает подарок: строка в «Подарки», идея с тем же текстом убирается из
   * «Идей подарков», сумма (если указана) — расход «Подарки» в «Финансах».
   */
  async giveGift(rel: string, input: { text: string; date?: string | null; occasion?: string | null; cost?: unknown }) {
    const n = this.giftNote(rel);
    const t = input.text.replace(/\s+/g, ' ').trim();
    if (!t) throw new VaultError('Что подарили?', 'invalid');
    const date = this.checkDate(input.date, 'Дата');
    const hasCost = input.cost !== undefined && input.cost !== null && input.cost !== '';
    const cost = hasCost ? parseNumber(input.cost) : null;
    if (hasCost && (cost === null || cost <= 0)) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    const occasion = input.occasion?.replace(/\s+/g, ' ').trim();
    const line = `- ${date} · ${t}${occasion ? ` · ${occasion}` : ''}${cost ? ` · ${cost.toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽` : ''}`;
    const ideas = this.giftIdeas(n).filter((i) => i.toLowerCase() !== t.toLowerCase());
    await this.vault.transform(rel, (c) => {
      let out = appendToSection(c, GIVEN, line).text;
      if (ideas.length !== this.giftIdeas(n).length) out = setSectionText(out, IDEAS, ideas.map((i) => `- ${i}`).join('\n'));
      return out;
    });
    const person = n.type === 'contact' ? n.title : (this.ref(n, 'person')?.title ?? n.title);
    const tx = cost ? await this.finance.addTransaction({ date, kind: 'expense', amount: cost, category: 'Подарки', description: `Подарок: ${person} — ${t}`, link: rel }) : null;
    return { ...this.gifts(rel), transaction: tx };
  }

  // ---------- Страницы ----------

  overview() {
    const occasions = this.occasions();
    return {
      today: this.today,
      folder: this.vault.folders.relationships,
      upcoming: occasions.filter((o) => o.daysLeft <= 60),
      occasions,
      people: this.people(),
      contactsDue: this.contactsDue(),
      agreements: this.agreements(),
      dates: [...this.vault.byType('important_date'), ...this.vault.byType('birthday')]
        .filter((n) => n.para !== 'archive')
        .map((n) => ({ path: n.path, title: n.title, date: fmStr(n.frontmatter.date), kind: fmEnum(n.frontmatter.kind, DATE_KINDS, n.type === 'birthday' ? 'birthday' : 'other'), person: this.ref(n, 'person') }))
        .sort((a, b) => (a.date ?? '').slice(-5).localeCompare((b.date ?? '').slice(-5))),
    };
  }

  dateDetail(rel: string) {
    const n = this.requireType(rel, ['important_date', 'birthday'], 'важная дата');
    const occ = this.occasions().find((o) => o.key === n.path) ?? null;
    return {
      path: n.path,
      title: n.title,
      date: fmStr(n.frontmatter.date),
      kind: fmEnum(n.frontmatter.kind, DATE_KINDS, n.type === 'birthday' ? 'birthday' : 'other'),
      person: this.ref(n, 'person'),
      yearly: n.frontmatter.yearly !== false,
      occasion: occ,
      ...this.gifts(rel),
      notes: this.section(n, ['Заметки', 'Notes']),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
      related: this.life.related(n),
    };
  }

  /** Для страницы контакта: день рождения, ритм, подарки. */
  personDetail(rel: string) {
    const n = this.requireType(rel, 'contact', 'контакт');
    return {
      ...this.person(n),
      ...this.gifts(rel),
      occasions: this.occasions().filter((o) => o.person?.path === n.path || o.path === n.path),
    };
  }

  reminders() {
    return {
      occasions: this.occasions().filter((o) => o.remind),
      contactsDue: this.contactsDue(),
    };
  }

  day(date: string) {
    return { occasions: this.occurrences(date, date).map((x) => ({ ...x.occasion, title: x.title })) };
  }
}

function isAgreement(section: string | null): boolean {
  return !!section && /договор[её]нност/i.test(section);
}
