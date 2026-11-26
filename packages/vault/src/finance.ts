/**
 * Финансы поверх Vault.
 *
 *   Операции — таблица в месячной заметке `type: ledger` (Финансы/Операции/2026-11.md):
 *     | Дата | Тип | Сумма | Категория | Описание | Связь |
 *   type: budget       — план дохода и лимиты по категориям (таблица «Лимиты»);
 *   type: subscription — подписка: сумма, период, дата следующего списания;
 *   type: payment      — обязательный платёж: дата, сумма, повторение;
 *   type: debt         — долг: я должен / мне должны, остаток, ежемесячный платёж;
 *   type: savings      — накопления и финансовые цели, крупные покупки.
 *
 * Банковские счета не подключаются: все данные вводятся вручную или правкой заметок.
 */
import { addDays, diffDays, endOfMonth, isIsoDate, startOfMonth } from './dates.ts';
import {
  EntityModule,
  addPeriod,
  fmDate,
  fmEnum,
  fmNum,
  fmStr,
  linkOrText,
  money,
  monthlyEquivalent,
  parseDatedLines,
  parseNumber,
  type EntitySpec,
  type Period,
  type Ref,
} from './entity-kit.ts';
import { appendToSection, findSection, getSectionText, setSectionText, parseWikiTarget } from './markdown.ts';
import { VaultError, type Note } from './vault.ts';
import type { CalendarItem, Life } from './life.ts';

export const TX_KINDS = ['income', 'expense', 'saving'] as const;
export type TxKind = (typeof TX_KINDS)[number];
export const TX_KIND_LABEL: Record<TxKind, string> = { income: 'Доход', expense: 'Расход', saving: 'Накопления' };

export const PERIODS = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const RECURRENCES = ['none', 'monthly', 'quarterly', 'yearly'] as const;

export const EXPENSE_CATEGORIES = [
  'Продукты', 'Жильё', 'Коммунальные', 'Транспорт', 'Здоровье', 'Спорт', 'Обучение', 'Дом', 'Подписки',
  'Связь и интернет', 'Одежда', 'Развлечения', 'Кафе', 'Подарки', 'Путешествия', 'Долги', 'Другое',
];
export const INCOME_CATEGORIES = ['Зарплата', 'Фриланс', 'Проекты', 'Возврат долга', 'Проценты', 'Подарки', 'Другое'];

const LEDGER_HEADER = '| Дата | Тип | Сумма | Категория | Описание | Связь |';
const LEDGER_SEP = '|---|---|---:|---|---|---|';

export interface TransactionDTO {
  path: string;
  line: number;
  date: string;
  kind: TxKind;
  amount: number;
  category: string;
  description: string;
  link: Ref | null;
  /** Проект, если связь ведёт на проект или заметку проекта. */
  project: Ref | null;
}

export interface ObligationDTO {
  kind: 'payment' | 'subscription' | 'debt';
  path: string;
  title: string;
  date: string;
  amount: number | null;
  category: string | null;
  overdue: boolean;
  daysLeft: number;
}

export interface SubscriptionDTO {
  path: string;
  title: string;
  amount: number | null;
  period: Period;
  monthly: number | null;
  nextPayment: string | null;
  category: string;
  status: 'active' | 'paused' | 'cancelled';
  url: string | null;
  account: string | null;
}

export interface PaymentDTO {
  path: string;
  title: string;
  amount: number | null;
  date: string | null;
  status: 'planned' | 'paid' | 'cancelled';
  recurrence: (typeof RECURRENCES)[number];
  category: string | null;
  contact: Ref | null;
  project: Ref | null;
  overdue: boolean;
}

export interface DebtDTO {
  path: string;
  title: string;
  direction: 'i_owe' | 'owed_to_me';
  counterparty: Ref | null;
  amount: number | null;
  remaining: number;
  paidPercent: number;
  due: string | null;
  rate: number | null;
  monthlyPayment: number | null;
  nextPayment: string | null;
  status: 'active' | 'closed';
  overdue: boolean;
}

export interface SavingsDTO {
  path: string;
  title: string;
  kind: 'reserve' | 'goal' | 'purchase';
  target: number | null;
  current: number;
  progress: number;
  deadline: string | null;
  monthly: number | null;
  /** Сколько откладывать в месяц, чтобы успеть к сроку. */
  neededPerMonth: number | null;
  goal: Ref | null;
  status: 'active' | 'done' | 'paused';
}

const LABELS: Record<string, string> = {
  amount: 'Сумма', period: 'Период', next_payment: 'Следующее списание', category: 'Категория', status: 'Статус', url: 'Ссылка',
  account: 'Карта / счёт', project: 'Проект', date: 'Дата', recurrence: 'Повторение', contact: 'Получатель', direction: 'Направление',
  counterparty: 'Кто', remaining: 'Осталось', due: 'Погасить до', rate: 'Ставка, %', monthly_payment: 'Ежемесячный платёж',
  kind: 'Вид', target: 'Цель, ₽', current: 'Накоплено', deadline: 'Срок', monthly: 'Откладывать в месяц', goal: 'Цель в «Стратегии»',
  income: 'План дохода',
};

export class Finance extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(life: Life) {
    super(life);
    const f = () => this.vault.folders.finance;
    const history = '## Заметки\n\n## История\n';
    this.specs = {
      subscription: {
        folder: () => `${f()}/Подписки`,
        fields: {
          amount: 'money', period: { enum: PERIODS }, next_payment: 'date', category: 'text',
          status: { enum: ['active', 'paused', 'cancelled'] }, url: 'url', account: 'text', project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.period ??= 'monthly';
          fm.status ??= 'active';
          fm.category ??= 'Подписки';
          return { body: `${text ? text + '\n\n' : ''}${history}` };
        },
        sections: { notes: 'Заметки' },
      },
      payment: {
        folder: () => `${f()}/Платежи`,
        fields: {
          amount: 'money', date: 'date', status: { enum: ['planned', 'paid', 'cancelled'] }, recurrence: { enum: RECURRENCES },
          category: 'text', contact: 'link', project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.status ??= 'planned';
          fm.recurrence ??= 'none';
          return { body: `${text ? text + '\n\n' : ''}${history}` };
        },
        sections: { notes: 'Заметки' },
      },
      debt: {
        folder: () => `${f()}/Долги`,
        fields: {
          direction: { enum: ['i_owe', 'owed_to_me'] }, counterparty: 'link', amount: 'money', remaining: 'money', due: 'date',
          rate: 'decimal', monthly_payment: 'money', next_payment: 'date', status: { enum: ['active', 'closed'] }, project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.direction ??= 'i_owe';
          fm.status ??= 'active';
          if (fm.remaining === undefined && typeof fm.amount === 'number') fm.remaining = fm.amount;
          return { body: `${text ? text + '\n\n' : ''}${history}` };
        },
        sections: { notes: 'Заметки' },
      },
      savings: {
        folder: () => `${f()}/Накопления`,
        fields: {
          kind: { enum: ['reserve', 'goal', 'purchase'] }, target: 'money', current: 'money', deadline: 'date', monthly: 'money',
          goal: 'link', status: { enum: ['active', 'done', 'paused'] }, project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.kind ??= 'goal';
          fm.status ??= 'active';
          fm.current ??= 0;
          return { body: `${text ? text + '\n\n' : ''}${history}` };
        },
        sections: { notes: 'Заметки' },
      },
    };
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
  }

  // ---------- Операции ----------

  private ledgerNotes(): Note[] {
    return this.vault.byType('ledger');
  }

  /** Все операции из таблиц месячных заметок. */
  transactions(opts: { from?: string; to?: string } = {}): TransactionDTO[] {
    const out: TransactionDTO[] = [];
    for (const n of this.ledgerNotes()) {
      for (const tx of this.parseLedger(n)) {
        if (opts.from && tx.date < opts.from) continue;
        if (opts.to && tx.date > opts.to) continue;
        out.push(tx);
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
  }

  private parseLedger(n: Note): TransactionDTO[] {
    const lines = n.body.split('\n');
    // Номер строки в файле: body начинается после frontmatter.
    const offset = n.bodyLine ?? 0;
    const out: TransactionDTO[] = [];
    lines.forEach((line, i) => {
      const cells = splitRow(line);
      if (!cells || cells.length < 3) return;
      const [date, kindRaw, amountRaw, category = '', description = '', linkCell = ''] = cells;
      if (!isIsoDate(date)) return;
      const kind = parseKind(kindRaw!);
      const amount = parseNumber(amountRaw);
      if (!kind || amount === null) return;
      const link = this.cellRef(linkCell, n.path) ?? this.cellRef(description, n.path);
      out.push({
        path: n.path,
        line: offset + i,
        date,
        kind,
        amount: Math.abs(amount),
        category: category.trim() || 'Другое',
        description: description.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => parseWikiTarget(inner).alias ?? parseWikiTarget(inner).target).trim(),
        link,
        project: link?.path ? this.projectOfPath(link.path) : null,
      });
    });
    return out;
  }

  private cellRef(cell: string, from: string): Ref | null {
    const m = /\[\[([^\]]+)\]\]/.exec(cell.replace(/\\\|/g, '|'));
    if (!m) return null;
    const { target } = parseWikiTarget(m[1]!);
    const resolved = this.vault.resolve(target, from);
    const note = resolved ? this.vault.get(resolved) : undefined;
    return note ? { path: note.path, title: note.title } : { path: null, title: target };
  }

  private projectOfPath(rel: string): Ref | null {
    const n = this.vault.get(rel);
    if (!n) return null;
    if (n.type === 'project') return { path: n.path, title: n.title };
    const p = this.ref(n, 'project');
    return p?.path ? p : null;
  }

  /** Добавляет строку в таблицу операций месяца (создаёт заметку месяца при необходимости). */
  async addTransaction(input: {
    date?: string | null;
    kind: TxKind;
    amount: number | string;
    category?: string | null;
    description?: string | null;
    link?: string | null;
  }): Promise<TransactionDTO> {
    if (!TX_KINDS.includes(input.kind)) throw new VaultError('Тип операции: доход, расход или накопления', 'invalid');
    const date = this.checkDate(input.date, 'Дата операции');
    const amount = parseNumber(input.amount);
    if (amount === null || amount <= 0 || amount > 1e12) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    const category = cell(input.category?.trim() || (input.kind === 'income' ? 'Другое' : input.kind === 'saving' ? 'Накопления' : 'Другое'));
    const description = cell(input.description?.trim() ?? '');
    let link = '';
    if (input.link?.trim()) {
      const l = linkOrText(this.vault, input.link.trim());
      link = l.startsWith('[[') ? l.replace(/\|/g, '\\|') : cell(l);
    }
    const note = await this.ensureLedger(date.slice(0, 7));
    const row = `| ${date} | ${TX_KIND_LABEL[input.kind]} | ${formatAmount(amount)} | ${category} | ${description} | ${link} |`;
    let lineIndex = -1;
    const updated = await this.vault.transform(note.path, (text) => {
      const lines = text.split('\n');
      const s = findSection(lines, 'Операции');
      if (!s || !lines.slice(s.start, s.end).some((l) => l.trim().startsWith('| Дата'))) {
        const withTable = setSectionText(text, 'Операции', `${getSectionText(text, 'Операции') ?? ''}\n\n${LEDGER_HEADER}\n${LEDGER_SEP}`.trim());
        const r = appendToSection(withTable, 'Операции', row);
        lineIndex = r.lineIndex;
        return r.text;
      }
      const r = appendToSection(text, 'Операции', row);
      lineIndex = r.lineIndex;
      return r.text;
    });
    const tx = this.parseLedger(updated).find((t) => t.line === lineIndex) ?? this.parseLedger(updated).at(-1);
    if (!tx) throw new VaultError('Операция записана, но не прочитана повторно', 'io');
    return tx;
  }

  private async ensureLedger(month: string): Promise<Note> {
    const existing = this.ledgerNotes().find((n) => fmStr(n.frontmatter.month) === month);
    if (existing) return existing;
    const [y, m] = month.split('-');
    const name = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][Number(m) - 1];
    return this.ensureNote(
      `${this.vault.folders.finance}/Операции`,
      month,
      { type: 'ledger', month },
      `# Операции — ${name} ${y}\n\n## Операции\n${LEDGER_HEADER}\n${LEDGER_SEP}\n`,
    );
  }

  // ---------- Бюджет ----------

  budgetNote(): Note | null {
    const all = this.vault.byType('budget').filter((n) => n.para !== 'archive');
    return all.find((n) => !fmStr(n.frontmatter.month)) ?? all[0] ?? null;
  }

  budget(month: string) {
    const all = this.vault.byType('budget').filter((n) => n.para !== 'archive');
    const n = all.find((x) => fmStr(x.frontmatter.month) === month) ?? all.find((x) => !fmStr(x.frontmatter.month)) ?? null;
    if (!n) return { path: null, income: null, limits: [] as Array<{ category: string; limit: number }> };
    const limits: Array<{ category: string; limit: number }> = [];
    for (const line of (getSectionText(n.body, ['Лимиты', 'Бюджет', 'Limits']) ?? '').split('\n')) {
      const cells = splitRow(line);
      if (cells && cells.length >= 2) {
        const limit = parseNumber(cells[1]);
        if (limit !== null && cells[0] && !/^категория$/i.test(cells[0])) limits.push({ category: cells[0], limit });
        continue;
      }
      // Также поддерживаем список «- Продукты: 30000».
      const m = /^\s*[-*]\s+(.+?):\s*([\d\s.,]+)\s*₽?\s*$/.exec(line);
      if (m) {
        const limit = parseNumber(m[2]);
        if (limit !== null) limits.push({ category: m[1]!.trim(), limit });
      }
    }
    return { path: n.path, income: fmNum(n.frontmatter.income), limits };
  }

  /** Сохраняет план дохода и лимиты в заметку бюджета (создаёт её при необходимости). */
  async saveBudget(input: { income?: number | string | null; limits: Array<{ category: string; limit: number | string }> }) {
    const rows: string[] = [];
    const seen = new Set<string>();
    for (const l of input.limits) {
      const category = cell(String(l.category ?? '').trim());
      if (!category) continue;
      const limit = parseNumber(l.limit);
      if (limit === null || limit < 0) throw new VaultError(`Лимит для «${category}» должен быть числом`, 'invalid');
      if (seen.has(category.toLowerCase())) throw new VaultError(`Категория «${category}» указана дважды`, 'invalid');
      seen.add(category.toLowerCase());
      rows.push(`| ${category} | ${formatAmount(limit)} |`);
    }
    const income = input.income === null || input.income === undefined || input.income === '' ? null : parseNumber(input.income);
    if (income !== null && income < 0) throw new VaultError('План дохода не может быть отрицательным', 'invalid');
    if (input.income !== null && input.income !== undefined && input.income !== '' && income === null) throw new VaultError('План дохода должен быть числом', 'invalid');
    let n = this.budgetNote();
    if (!n) {
      n = await this.vault.createNote({
        folder: this.vault.folders.finance,
        title: 'Бюджет',
        frontmatter: { type: 'budget' },
        body: '# Бюджет\n\nЛимиты расходов на месяц по категориям. Операции с такой же категорией считаются расходом по лимиту.\n\n## Лимиты\n',
      });
    }
    await this.vault.updateProperties(n.path, income === null ? {} : { income }, income === null ? ['income'] : []);
    const table = rows.length ? `| Категория | Лимит |\n|---|---:|\n${rows.join('\n')}` : '';
    await this.vault.transform(n.path, (text) => setSectionText(text, 'Лимиты', table));
    return this.budget(this.today.slice(0, 7));
  }

  // ---------- Подписки, платежи, долги, накопления ----------

  subscription(n: Note): SubscriptionDTO {
    const fm = n.frontmatter;
    const amount = fmNum(fm.amount);
    const period = fmEnum(fm.period, PERIODS, 'monthly');
    return {
      path: n.path,
      title: n.title,
      amount,
      period,
      monthly: amount !== null ? monthlyEquivalent(amount, period) : null,
      nextPayment: fmDate(fm.next_payment),
      category: fmStr(fm.category) ?? 'Подписки',
      status: n.para === 'archive' ? 'cancelled' : fmEnum(fm.status, ['active', 'paused', 'cancelled'] as const, 'active'),
      url: fmStr(fm.url),
      account: fmStr(fm.account),
    };
  }

  subscriptions(): SubscriptionDTO[] {
    const rank = { active: 0, paused: 1, cancelled: 2 } as const;
    return this.vault
      .byType('subscription')
      .map((n) => this.subscription(n))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.nextPayment ?? '9999').localeCompare(b.nextPayment ?? '9999'));
  }

  payment(n: Note): PaymentDTO {
    const fm = n.frontmatter;
    const date = fmDate(fm.date);
    const status = fmEnum(fm.status, ['planned', 'paid', 'cancelled'] as const, 'planned');
    return {
      path: n.path,
      title: n.title,
      amount: fmNum(fm.amount),
      date,
      status,
      recurrence: fmEnum(fm.recurrence, RECURRENCES, 'none'),
      category: fmStr(fm.category),
      contact: this.ref(n, 'contact'),
      project: this.ref(n, 'project'),
      overdue: status === 'planned' && !!date && date < this.today,
    };
  }

  payments(): PaymentDTO[] {
    return this.vault
      .byType('payment')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.payment(n))
      .sort((a, b) => (a.status === 'planned' ? 0 : 1) - (b.status === 'planned' ? 0 : 1) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  }

  debt(n: Note): DebtDTO {
    const fm = n.frontmatter;
    const amount = fmNum(fm.amount);
    const remaining = fmNum(fm.remaining) ?? amount ?? 0;
    const status = n.para === 'archive' ? 'closed' : fmEnum(fm.status, ['active', 'closed'] as const, remaining > 0 ? 'active' : 'closed');
    const next = fmDate(fm.next_payment);
    const due = fmDate(fm.due);
    return {
      path: n.path,
      title: n.title,
      direction: fmEnum(fm.direction, ['i_owe', 'owed_to_me'] as const, 'i_owe'),
      counterparty: this.ref(n, 'counterparty'),
      amount,
      remaining,
      paidPercent: amount ? Math.max(0, Math.min(100, Math.round(((amount - remaining) / amount) * 100))) : 0,
      due,
      rate: fmNum(fm.rate),
      monthlyPayment: fmNum(fm.monthly_payment),
      nextPayment: next,
      status,
      overdue: status === 'active' && (((next ?? '9999') < this.today) || ((due ?? '9999') < this.today)),
    };
  }

  debts(): DebtDTO[] {
    return this.vault
      .byType('debt')
      .map((n) => this.debt(n))
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.nextPayment ?? a.due ?? '9999').localeCompare(b.nextPayment ?? b.due ?? '9999'));
  }

  savingsOf(n: Note): SavingsDTO {
    const fm = n.frontmatter;
    const target = fmNum(fm.target);
    const current = fmNum(fm.current) ?? 0;
    const deadline = fmDate(fm.deadline);
    const status = fmEnum(fm.status, ['active', 'done', 'paused'] as const, 'active');
    let neededPerMonth: number | null = null;
    if (target !== null && deadline && status === 'active' && current < target) {
      const months = Math.max(1, Math.ceil(diffDays(this.today, deadline) / 30.44));
      neededPerMonth = Math.ceil((target - current) / months);
    }
    return {
      path: n.path,
      title: n.title,
      kind: fmEnum(fm.kind, ['reserve', 'goal', 'purchase'] as const, 'goal'),
      target,
      current,
      progress: target ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0,
      deadline,
      monthly: fmNum(fm.monthly),
      neededPerMonth,
      goal: this.ref(n, 'goal'),
      status,
    };
  }

  savings(): SavingsDTO[] {
    return this.vault
      .byType('savings')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.savingsOf(n))
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  }

  /** Предстоящие и просроченные обязательные платежи, подписки и платежи по долгам. */
  obligations(to: string): ObligationDTO[] {
    const today = this.today;
    const out: ObligationDTO[] = [];
    const push = (o: Omit<ObligationDTO, 'overdue' | 'daysLeft'>) => {
      if (o.date > to) return;
      out.push({ ...o, overdue: o.date < today, daysLeft: diffDays(today, o.date) });
    };
    for (const p of this.payments()) {
      if (p.status === 'planned' && p.date) push({ kind: 'payment', path: p.path, title: p.title, date: p.date, amount: p.amount, category: p.category });
    }
    for (const s of this.subscriptions()) {
      if (s.status === 'active' && s.nextPayment) push({ kind: 'subscription', path: s.path, title: s.title, date: s.nextPayment, amount: s.amount, category: s.category });
    }
    for (const d of this.debts()) {
      if (d.status !== 'active' || d.direction !== 'i_owe') continue;
      const date = d.nextPayment ?? d.due;
      if (date) push({ kind: 'debt', path: d.path, title: d.title, date, amount: d.nextPayment ? (d.monthlyPayment ?? d.remaining) : d.remaining, category: 'Долги' });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'));
  }

  /** Отмечает оплату платежа или подписки: строка в операциях, следующий срок, история. */
  async pay(rel: string, input: { date?: string | null; amount?: number | string | null } = {}) {
    const n = this.requireType(rel, ['payment', 'subscription'], 'платёж или подписка');
    const date = this.checkDate(input.date, 'Дата оплаты');
    const fm = n.frontmatter;
    const amount = input.amount !== undefined && input.amount !== null && input.amount !== '' ? parseNumber(input.amount) : fmNum(fm.amount);
    if (amount === null || amount <= 0) throw new VaultError('Укажите сумму оплаты', 'invalid');
    let category: string;
    if (n.type === 'subscription') {
      const s = this.subscription(n);
      if (s.status !== 'active') throw new VaultError('Подписка не активна', 'invalid');
      category = s.category;
      const base = s.nextPayment ?? date;
      await this.vault.updateProperties(rel, { next_payment: addPeriod(base, s.period) });
    } else {
      const p = this.payment(n);
      if (p.status !== 'planned') throw new VaultError('Платёж уже оплачен или отменён', 'invalid');
      category = p.category ?? 'Другое';
      if (p.recurrence !== 'none') await this.vault.updateProperties(rel, { date: addPeriod(p.date ?? date, p.recurrence) });
      else await this.vault.updateProperties(rel, { status: 'paid', paid: date });
    }
    const tx = await this.addTransaction({ date, kind: 'expense', amount, category, description: n.title, link: rel });
    await this.logHistory(rel, date, `Оплачено ${money(amount)}`);
    return { transaction: tx };
  }

  /** Платёж по долгу: уменьшает остаток, при нуле закрывает долг. */
  async debtPayment(rel: string, input: { amount: number | string; date?: string | null }) {
    const n = this.requireType(rel, 'debt', 'долг');
    const d = this.debt(n);
    if (d.status !== 'active') throw new VaultError('Долг уже закрыт', 'invalid');
    const date = this.checkDate(input.date, 'Дата');
    const amount = parseNumber(input.amount);
    if (amount === null || amount <= 0) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    if (amount > d.remaining + 0.001) throw new VaultError(`Сумма больше остатка долга (${money(d.remaining)})`, 'invalid');
    const remaining = Math.round((d.remaining - amount) * 100) / 100;
    const set: Record<string, unknown> = { remaining };
    if (remaining === 0) set.status = 'closed';
    else if (d.nextPayment) set.next_payment = addPeriod(d.nextPayment, 'monthly');
    await this.vault.updateProperties(rel, set);
    const tx = await this.addTransaction({
      date,
      kind: d.direction === 'i_owe' ? 'expense' : 'income',
      amount,
      category: d.direction === 'i_owe' ? 'Долги' : 'Возврат долга',
      description: n.title,
      link: rel,
    });
    await this.logHistory(rel, date, `${d.direction === 'i_owe' ? 'Погашено' : 'Получено'} ${money(amount)}, осталось ${money(remaining)}${remaining === 0 ? ' — долг закрыт' : ''}`);
    return { remaining, transaction: tx };
  }

  /** Пополнение накоплений: растёт «Накоплено», в операциях — строка «Накопления». */
  async contribute(rel: string, input: { amount: number | string; date?: string | null; withdraw?: boolean }) {
    const n = this.requireType(rel, 'savings', 'накопления');
    const s = this.savingsOf(n);
    const date = this.checkDate(input.date, 'Дата');
    const amount = parseNumber(input.amount);
    if (amount === null || amount <= 0) throw new VaultError('Сумма должна быть больше нуля', 'invalid');
    if (input.withdraw && amount > s.current) throw new VaultError(`Снять можно не больше ${money(s.current)}`, 'invalid');
    const current = Math.round((s.current + (input.withdraw ? -amount : amount)) * 100) / 100;
    await this.vault.updateProperties(rel, { current });
    let tx: TransactionDTO | null = null;
    if (!input.withdraw) tx = await this.addTransaction({ date, kind: 'saving', amount, category: 'Накопления', description: n.title, link: rel });
    const reached = s.target !== null && current >= s.target && s.current < s.target;
    await this.logHistory(rel, date, `${input.withdraw ? 'Снято' : 'Пополнено'} ${money(amount)}, всего ${money(current)}${reached ? ' — цель достигнута' : ''}`);
    return { current, reached, transaction: tx };
  }

  detail(rel: string) {
    const n = this.vault.require(rel);
    const base =
      n.type === 'subscription' ? this.subscription(n) : n.type === 'payment' ? this.payment(n) : n.type === 'debt' ? this.debt(n) : n.type === 'savings' ? this.savingsOf(n) : null;
    if (!base) throw new VaultError('Это не запись раздела «Финансы»', 'invalid');
    return {
      ...base,
      type: n.type,
      notes: this.section(n, ['Заметки', 'Notes']),
      history: parseDatedLines(this.section(n, ['История', 'History'])),
      transactions: this.transactions().filter((t) => t.link?.path === n.path),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
      related: this.life.related(n),
    };
  }

  // ---------- Сводка месяца ----------

  overview(month = this.today.slice(0, 7)) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new VaultError('Месяц в формате ГГГГ-ММ', 'invalid');
    const from = startOfMonth(`${month}-01`);
    const to = endOfMonth(from);
    const txs = this.transactions({ from, to });
    const sum = (k: TxKind) => round(txs.filter((t) => t.kind === k).reduce((s, t) => s + t.amount, 0));
    const income = sum('income');
    const expense = sum('expense');
    const saved = sum('saving');
    const budget = this.budget(month);
    const spentBy = new Map<string, number>();
    for (const t of txs) if (t.kind === 'expense') spentBy.set(t.category, (spentBy.get(t.category) ?? 0) + t.amount);
    const limitKeys = new Set(budget.limits.map((l) => l.category.toLowerCase()));
    const categories = [
      ...budget.limits.map((l) => {
        const spent = round([...spentBy].filter(([k]) => k.toLowerCase() === l.category.toLowerCase()).reduce((s, [, v]) => s + v, 0));
        return { category: l.category, limit: l.limit, spent, left: round(l.limit - spent), over: spent > l.limit };
      }),
      ...[...spentBy]
        .filter(([k]) => !limitKeys.has(k.toLowerCase()))
        .map(([category, spent]) => ({ category, limit: null as number | null, spent: round(spent), left: null as number | null, over: false })),
    ].sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category, 'ru'));

    // Обязательства этого месяца (для плана) и ещё не оплаченные (для прогноза).
    const isCurrent = month === this.today.slice(0, 7);
    const obligationsMonth = this.obligationsInMonth(month);
    const limitsTotal = round(budget.limits.reduce((s, l) => s + l.limit, 0));
    const extraObligations = round(
      obligationsMonth.filter((o) => !o.category || !limitKeys.has(o.category.toLowerCase())).reduce((s, o) => s + (o.amount ?? 0), 0),
    );
    const plannedSavings = round(this.savings().filter((s) => s.status === 'active').reduce((s, x) => s + (x.monthly ?? 0), 0));
    const plannedExpense = round(limitsTotal + extraObligations);
    const factBalance = round(income - expense - saved);
    const unpaid = isCurrent ? this.obligations(to).filter((o) => o.date <= to) : [];
    const unpaidTotal = round(unpaid.reduce((s, o) => s + (o.amount ?? 0), 0));
    const forecast = isCurrent ? round(factBalance + Math.max(0, (budget.income ?? 0) - income) - unpaidTotal) : factBalance;

    const projects = this.life
      .projects()
      .map((p) => {
        const spent = round(this.transactions().filter((t) => t.kind === 'expense' && t.project?.path === p.path).reduce((s, t) => s + t.amount, 0));
        return { path: p.path, title: p.title, budget: p.budget, spent: spent || (p.spent ?? 0), status: p.status };
      })
      .filter((p) => p.budget !== null || p.spent > 0);

    const subs = this.subscriptions();
    return {
      today: this.today,
      month,
      income,
      expense,
      saved,
      factBalance,
      plan: {
        income: budget.income,
        expense: plannedExpense,
        limits: limitsTotal,
        obligations: extraObligations,
        savings: plannedSavings,
        balance: budget.income !== null ? round(budget.income - plannedExpense - plannedSavings) : null,
      },
      forecast,
      unpaidTotal,
      budget,
      categories,
      transactions: txs,
      obligations: this.obligations(addDays(this.today, 30)),
      subscriptions: subs,
      subscriptionsMonthly: round(subs.filter((s) => s.status === 'active').reduce((s, x) => s + (x.monthly ?? 0), 0)),
      payments: this.payments(),
      debts: this.debts(),
      savings: this.savings(),
      projects,
      expenseCategories: [...new Set([...budget.limits.map((l) => l.category), ...EXPENSE_CATEGORIES, ...this.transactions().filter((t) => t.kind === 'expense').map((t) => t.category)])],
      incomeCategories: [...new Set([...INCOME_CATEGORIES, ...this.transactions().filter((t) => t.kind === 'income').map((t) => t.category)])],
    };
  }

  private obligationsInMonth(month: string): ObligationDTO[] {
    const from = `${month}-01`;
    const to = endOfMonth(from);
    const out: ObligationDTO[] = [];
    const add = (kind: ObligationDTO['kind'], path: string, title: string, date: string, amount: number | null, category: string | null) =>
      out.push({ kind, path, title, date, amount, category, overdue: false, daysLeft: diffDays(this.today, date) });
    for (const p of this.payments()) {
      if (p.status === 'cancelled' || !p.date) continue;
      // Повторяющийся платёж: если ближайшая дата позже месяца, считаем его в каждом месяце.
      if (p.date >= from && p.date <= to) add('payment', p.path, p.title, p.date, p.amount, p.category);
      else if (p.recurrence === 'monthly' && p.date > to) add('payment', p.path, p.title, from, p.amount, p.category);
    }
    for (const s of this.subscriptions()) {
      if (s.status !== 'active' || s.amount === null) continue;
      if (s.period === 'monthly' || s.period === 'weekly') add('subscription', s.path, s.title, s.nextPayment ?? from, round(s.monthly ?? s.amount), s.category);
      else if (s.nextPayment && s.nextPayment >= from && s.nextPayment <= to) add('subscription', s.path, s.title, s.nextPayment, s.amount, s.category);
    }
    for (const d of this.debts()) {
      if (d.status === 'active' && d.direction === 'i_owe' && d.monthlyPayment) add('debt', d.path, d.title, d.nextPayment ?? from, d.monthlyPayment, 'Долги');
    }
    return out;
  }

  reminders() {
    const to = addDays(this.today, 7);
    const obligations = this.obligations(to);
    return { obligations, overdue: obligations.filter((o) => o.overdue).length, total: round(obligations.reduce((s, o) => s + (o.amount ?? 0), 0)) };
  }

  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    const out: Array<{ date: string; item: CalendarItem }> = [];
    const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;
    for (const s of this.subscriptions()) {
      if (s.status === 'active' && inRange(s.nextPayment)) {
        out.push({ date: s.nextPayment, item: { kind: 'event', title: `Подписка: ${s.title}`, path: s.path, noteType: 'subscription', time: null, amount: s.amount } });
      }
    }
    for (const d of this.debts()) {
      if (d.status === 'active' && d.direction === 'i_owe' && inRange(d.nextPayment)) {
        out.push({ date: d.nextPayment, item: { kind: 'event', title: `Платёж по долгу: ${d.title}`, path: d.path, noteType: 'debt', time: null, amount: d.monthlyPayment } });
      }
      if (d.status === 'active' && inRange(d.due)) out.push({ date: d.due, item: { kind: 'deadline', title: `Вернуть долг: ${d.title}`, path: d.path, noteType: 'debt' } });
    }
    for (const s of this.savings()) {
      if (s.status === 'active' && inRange(s.deadline)) out.push({ date: s.deadline, item: { kind: 'deadline', title: `Срок накоплений: ${s.title}`, path: s.path, noteType: 'savings' } });
    }
    return out;
  }
}

// ---------- Таблица операций ----------

/** Делит строку таблицы Markdown на ячейки (учитывает «\|» внутри ссылок). */
export function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  if (/^\|[\s:|-]+\|?$/.test(t)) return null; // разделитель заголовка
  const cells: string[] = [];
  let cur = '';
  for (let i = 1; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) cells.push(cur.trim());
  return cells;
}

function parseKind(s: string): TxKind | null {
  const v = s.trim().toLowerCase();
  if (/^(доход|income|\+|приход)$/.test(v)) return 'income';
  if (/^(расход|expense|-|−|трата)$/.test(v)) return 'expense';
  if (/^(накопления|накопление|saving|savings|перевод в накопления)$/.test(v)) return 'saving';
  return null;
}

function cell(s: string): string {
  return s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
