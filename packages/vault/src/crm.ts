/**
 * Работа, контакты, компании и документы поверх Vault.
 *
 * Каждая сущность — обычная Markdown-заметка с YAML-свойствами:
 *   type: vacancy   — вакансия и отклик на неё (воронка статусов, собеседования, тестовые);
 *   type: company   — компания: работодатель, клиент, партнёр;
 *   type: contact   — человек: рекрутер, клиент, коллега; история общения и договорённости;
 *   type: document  — документ: паспорт, РВП/ВНЖ, договор…; сроки действия и напоминания;
 *   type: resume / portfolio — материалы для откликов.
 * Связи — обычные ссылки [[…]] в свойствах (company, recruiter, project, organization…).
 */
import { addDays, diffDays, isIsoDate } from './dates.ts';
import { appendToSection, getSectionText, setSectionText } from './markdown.ts';
import { VaultError, type Note, type NoteSummary } from './vault.ts';
import type { CalendarItem, Life, TaskDTO } from './life.ts';

// ---------- Справочники ----------

export const VACANCY_STATUSES = ['interesting', 'applied', 'response', 'interview', 'test', 'offer', 'rejected', 'archived'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export const VACANCY_STATUS_LABEL: Record<VacancyStatus, string> = {
  interesting: 'Интересно',
  applied: 'Отклик',
  response: 'Ответ',
  interview: 'Собеседование',
  test: 'Тестовое',
  offer: 'Оффер',
  rejected: 'Отказ',
  archived: 'Архив',
};
/** Статусы, в которых вакансия ещё «в работе». */
export const VACANCY_ACTIVE: VacancyStatus[] = ['interesting', 'applied', 'response', 'interview', 'test', 'offer'];

export const CONTACT_KINDS = ['client', 'recruiter', 'colleague', 'partner', 'friend', 'family', 'other'] as const;
export const RELATION_STATUSES = ['lead', 'active', 'paused', 'former'] as const;
export const COMPANY_KINDS = ['employer', 'client', 'partner', 'vendor', 'other'] as const;
export const DOC_TYPES = ['passport', 'residence', 'visa', 'contract', 'diploma', 'certificate', 'insurance', 'warranty', 'medical', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  passport: 'Паспорт',
  residence: 'РВП / ВНЖ',
  visa: 'Виза',
  contract: 'Договор',
  diploma: 'Диплом',
  certificate: 'Сертификат',
  insurance: 'Страховка',
  warranty: 'Гарантия',
  medical: 'Медицинский',
  other: 'Другое',
};
/** За сколько дней напоминать о продлении, если в заметке не указано remind_days. */
const DEFAULT_REMIND: Record<DocType, number> = {
  passport: 180,
  residence: 180,
  visa: 60,
  contract: 30,
  diploma: 0,
  certificate: 60,
  insurance: 30,
  warranty: 14,
  medical: 30,
  other: 30,
};
/** Типы документов, которые по умолчанию считаются конфиденциальными. */
const SENSITIVE_DOC_TYPES: DocType[] = ['passport', 'residence', 'visa', 'contract', 'diploma', 'medical', 'insurance'];

export type EntityType = 'vacancy' | 'company' | 'contact' | 'document' | 'resume' | 'portfolio';
export const ENTITY_TYPES: EntityType[] = ['vacancy', 'company', 'contact', 'document', 'resume', 'portfolio'];

type FieldKind = 'text' | 'date' | 'time' | 'url' | 'email' | 'phone' | 'number' | 'link' | 'list' | 'boolean' | 'last4' | { enum: readonly string[] };

/** Какие свойства можно задавать через интерфейс и как их проверять. */
export const ENTITY_FIELDS: Record<EntityType, Record<string, FieldKind>> = {
  vacancy: {
    status: { enum: VACANCY_STATUSES },
    position: 'text',
    company: 'link',
    url: 'url',
    salary: 'text',
    location: 'text',
    source: 'text',
    recruiter: 'link',
    applied: 'date',
    resume: 'link',
    interview: 'date',
    interview_time: 'time',
    test_due: 'date',
    next_step: 'text',
    next_date: 'date',
    result: 'text',
    project: 'link',
  },
  company: {
    kind: { enum: COMPANY_KINDS },
    status: { enum: RELATION_STATUSES },
    website: 'url',
    industry: 'text',
    city: 'text',
    project: 'link',
  },
  contact: {
    company: 'link',
    role: 'text',
    kind: { enum: CONTACT_KINDS },
    client_status: { enum: RELATION_STATUSES },
    phone: 'phone',
    email: 'email',
    links: 'list',
    last_contact: 'date',
    next_contact: 'date',
    project: 'link',
  },
  document: {
    doc_type: { enum: DOC_TYPES },
    owner: 'text',
    storage: 'text',
    number_last4: 'last4',
    issued: 'date',
    expires: 'date',
    remind_days: 'number',
    organization: 'link',
    sensitive: 'boolean',
    project: 'link',
  },
  resume: { version: 'text', url: 'url', updated: 'date' },
  portfolio: { version: 'text', url: 'url', updated: 'date' },
};

const FIELD_LABEL: Record<string, string> = {
  status: 'Статус', position: 'Должность', company: 'Компания', url: 'Ссылка', salary: 'Зарплата', location: 'Локация',
  source: 'Источник', recruiter: 'Рекрутер', applied: 'Дата отклика', resume: 'Резюме', interview: 'Собеседование',
  interview_time: 'Время собеседования', test_due: 'Срок тестового', next_step: 'Следующий шаг', next_date: 'Дата шага',
  result: 'Результат', project: 'Проект', kind: 'Вид', website: 'Сайт', industry: 'Отрасль', city: 'Город', role: 'Должность',
  client_status: 'Статус клиента', phone: 'Телефон', email: 'Email', links: 'Ссылки', last_contact: 'Последняя связь',
  next_contact: 'Следующий контакт', doc_type: 'Тип документа', owner: 'Владелец', storage: 'Где хранится',
  number_last4: 'Последние символы номера', issued: 'Дата выдачи', expires: 'Действует до', remind_days: 'Напомнить за, дней',
  organization: 'Организация', sensitive: 'Конфиденциально', version: 'Версия', updated: 'Обновлено',
};

// ---------- Типы данных ----------

/** Ссылка на заметку или просто текст, если такой заметки нет. */
export interface Ref {
  path: string | null;
  title: string;
}

export interface VacancyDTO {
  path: string;
  title: string;
  position: string;
  status: VacancyStatus;
  company: Ref | null;
  url: string | null;
  salary: string | null;
  location: string | null;
  source: string | null;
  recruiter: Ref | null;
  applied: string | null;
  resume: Ref | null;
  interview: string | null;
  interviewTime: string | null;
  testDue: string | null;
  nextStep: string | null;
  nextDate: string | null;
  result: string | null;
  project: Ref | null;
  openTasks: number;
  /** Просрочен следующий шаг, тестовое или есть просроченные задачи. */
  attention: boolean;
  mtimeMs: number;
}

export interface CompanyDTO {
  path: string;
  title: string;
  kind: string | null;
  status: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  contacts: Ref[];
  vacancies: Array<{ path: string; title: string; status: VacancyStatus }>;
  mtimeMs: number;
}

export interface HistoryEntry {
  date: string;
  text: string;
}

export interface ContactDTO {
  path: string;
  title: string;
  company: Ref | null;
  role: string | null;
  kind: string | null;
  clientStatus: string | null;
  phone: string | null;
  email: string | null;
  links: string[];
  lastContact: string | null;
  nextContact: string | null;
  /** Когда пора связаться: просрочено, сегодня, в ближайшие 3 дня. */
  followUp: 'overdue' | 'today' | 'soon' | null;
  daysSinceContact: number | null;
  openTasks: number;
  mtimeMs: number;
}

export interface DocumentDTO {
  path: string;
  title: string;
  docType: DocType;
  owner: string | null;
  storage: string | null;
  numberLast4: string | null;
  issued: string | null;
  expires: string | null;
  remindDays: number;
  /** С какой даты пора заниматься продлением. */
  remindFrom: string | null;
  daysLeft: number | null;
  state: 'valid' | 'expiring' | 'expired' | 'no_expiry';
  organization: Ref | null;
  sensitive: boolean;
  comment: string;
  warnings: string[];
  renewalTask: TaskDTO | null;
  mtimeMs: number;
}

export interface MaterialDTO {
  path: string;
  title: string;
  type: 'resume' | 'portfolio';
  version: string | null;
  url: string | null;
  updated: string | null;
  usedIn: number;
}

type Related = Array<NoteSummary & { direction: 'out' | 'in' | 'both' }>;

// ---------- Модуль ----------

export class Crm {
  constructor(readonly life: Life) {
    life.addCalendarSource((from, to) => this.calendarItems(from, to));
  }

  private get vault() {
    return this.life.vault;
  }

  private get today() {
    return this.life.today;
  }

  private notesOf(type: string): Note[] {
    return this.vault.byType(type);
  }

  /** Значение ссылочного свойства: найденная заметка или текст как есть. */
  private ref(n: Note, key: string): Ref | null {
    const l = n.links.find((x) => x.key === key && x.resolved);
    if (l?.resolved) {
      const target = this.vault.get(l.resolved);
      if (target) return { path: target.path, title: target.title };
    }
    const v = n.frontmatter[key];
    const raw = Array.isArray(v) ? v[0] : v;
    const s = str(raw);
    if (!s) return null;
    return { path: null, title: s.replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim() };
  }

  private openTasksOf(path: string): TaskDTO[] {
    return this.life.tasks('open').filter((t) => t.path === path);
  }

  // ---------- Создание и изменение ----------

  folderFor(type: EntityType): string {
    const f = this.vault.folders;
    switch (type) {
      case 'vacancy':
        return `${f.work}/Вакансии`;
      case 'resume':
      case 'portfolio':
        return `${f.work}/Материалы`;
      case 'company':
        return f.companies;
      case 'contact':
        return f.contacts;
      case 'document':
        return f.documents;
    }
  }

  /** Проверяет и переводит значения из формы в YAML-свойства. */
  normalizeFields(type: EntityType, input: Record<string, unknown>): { set: Record<string, unknown>; unset: string[] } {
    const schema = ENTITY_FIELDS[type];
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const kind = schema[key];
      if (!kind) throw new VaultError(`Свойство «${key}» нельзя менять в этом разделе`, 'invalid');
      const label = FIELD_LABEL[key] ?? key;
      const empty = value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (empty) {
        unset.push(key);
        continue;
      }
      set[key] = this.normalizeValue(kind, value, label);
    }
    return { set, unset };
  }

  private normalizeValue(kind: FieldKind, value: unknown, label: string): unknown {
    if (typeof kind === 'object') {
      if (typeof value !== 'string' || !kind.enum.includes(value)) throw new VaultError(`Недопустимое значение поля «${label}»`, 'invalid');
      return value;
    }
    if (kind === 'boolean') {
      if (typeof value !== 'boolean') throw new VaultError(`Поле «${label}» должно быть да/нет`, 'invalid');
      return value;
    }
    if (kind === 'number') {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 3650) throw new VaultError(`Поле «${label}»: введите число от 0 до 3650`, 'invalid');
      return Math.round(n);
    }
    if (kind === 'list') {
      const arr = Array.isArray(value) ? value : String(value).split(/[\n,]+/);
      return arr.map((x) => String(x).trim()).filter(Boolean);
    }
    const s = String(value).trim();
    switch (kind) {
      case 'date':
        if (!isIsoDate(s)) throw new VaultError(`Поле «${label}»: дата в формате ГГГГ-ММ-ДД`, 'invalid');
        return s;
      case 'time':
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) throw new VaultError(`Поле «${label}»: время в формате ЧЧ:ММ`, 'invalid');
        return s;
      case 'url':
        if (!/^https?:\/\/\S+$/i.test(s)) throw new VaultError(`Поле «${label}»: ссылка должна начинаться с http:// или https://`, 'invalid');
        return s;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new VaultError(`Поле «${label}»: неверный email`, 'invalid');
        return s;
      case 'phone':
        if (!/^\+?[\d\s()\-]{5,20}$/.test(s)) throw new VaultError(`Поле «${label}»: неверный номер телефона`, 'invalid');
        return s;
      case 'last4':
        // Полный номер документа не храним в открытом Markdown — только последние символы.
        if (!/^[0-9A-Za-zА-Яа-я]{1,4}$/.test(s)) {
          throw new VaultError('Укажите не больше 4 последних символов номера: полный номер в хранилище не записывается', 'invalid');
        }
        return s;
      case 'link':
        return this.linkOrText(s);
      default:
        return s.slice(0, 500);
    }
  }

  /** Ссылка [[…]], если заметка с таким путём или именем есть, иначе текст. */
  linkOrText(value: string): string {
    const v = value.trim();
    if (/^\[\[.+\]\]$/.test(v)) return v;
    const resolved = this.vault.get(v) ? v : this.vault.resolve(v);
    return resolved ? this.vault.linkTo(resolved) : v;
  }

  async updateEntity(rel: string, input: Record<string, unknown>): Promise<Note> {
    const n = this.vault.require(rel);
    const type = entityType(n);
    const { set, unset } = this.normalizeFields(type, input);
    if (type === 'vacancy' && typeof set.status === 'string' && set.status !== this.vacancy(n).status) {
      // Смена статуса через общее редактирование тоже попадает в историю.
      const { status, ...rest } = set;
      await this.vault.updateProperties(rel, rest, unset);
      return this.setVacancyStatus(rel, status as VacancyStatus);
    }
    return this.vault.updateProperties(rel, set, unset);
  }

  async createEntity(input: { type: EntityType; title: string; fields?: Record<string, unknown>; text?: string; createCompany?: boolean }): Promise<Note> {
    const { type } = input;
    if (!ENTITY_TYPES.includes(type)) throw new VaultError('Неизвестный тип записи', 'invalid');
    const title = input.title.trim();
    if (!title) throw new VaultError('Введите название', 'invalid');
    const fields = { ...(input.fields ?? {}) };

    // Компания: по желанию создаём карточку, если её ещё нет, чтобы связь стала ссылкой.
    if (input.createCompany && typeof fields.company === 'string' && fields.company.trim()) {
      const name = fields.company.trim();
      if (!this.vault.resolve(name) && !this.vault.get(name)) {
        await this.createEntity({ type: 'company', title: name, fields: { kind: type === 'vacancy' ? 'employer' : 'client', status: 'active' } });
      }
    }
    const { set } = this.normalizeFields(type, fields);
    const fm: Record<string, unknown> = { type, ...set, created: this.today };
    let body = `# ${title}\n\n`;
    const text = input.text?.trim() ?? '';
    switch (type) {
      case 'vacancy': {
        fm.status ??= 'interesting';
        if (fm.status !== 'interesting' && !fm.applied) fm.applied = this.today;
        body +=
          `## Описание\n${text}\n\n## Сопроводительное письмо\n\n## Собеседования\n\n## Задачи\n\n` +
          `## История\n- ${this.today} · Добавлена, статус «${VACANCY_STATUS_LABEL[fm.status as VacancyStatus]}»\n`;
        break;
      }
      case 'contact':
        body += `## Заметки\n${text}\n\n## Договорённости\n\n## История общения\n`;
        break;
      case 'company':
        body += `## Заметки\n${text}\n\n## История\n`;
        break;
      case 'document': {
        const docType = (fm.doc_type as DocType | undefined) ?? 'other';
        fm.doc_type = docType;
        fm.sensitive ??= SENSITIVE_DOC_TYPES.includes(docType);
        body += `## Комментарий\n${text}\n\n## Задачи\n`;
        break;
      }
      default:
        fm.updated ??= this.today;
        body += `${text}\n`;
    }
    return this.vault.createNote({ folder: this.folderFor(type), title, frontmatter: fm, body });
  }

  /** Меняет текст одной из секций заметки (описание, письмо, заметки, комментарий). */
  async saveSection(rel: string, section: 'description' | 'cover_letter' | 'notes' | 'comment', content: string): Promise<Note> {
    const n = this.vault.require(rel);
    entityType(n);
    const heading = { description: 'Описание', cover_letter: 'Сопроводительное письмо', notes: 'Заметки', comment: 'Комментарий' }[section];
    if (!heading) throw new VaultError('Неизвестная секция', 'invalid');
    return this.vault.transform(rel, (text) => setSectionText(text, heading, content));
  }

  // ---------- Вакансии ----------

  vacancy(n: Note): VacancyDTO {
    const fm = n.frontmatter;
    const rawStatus = str(fm.status);
    const status: VacancyStatus =
      n.para === 'archive' ? 'archived' : rawStatus && (VACANCY_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as VacancyStatus) : 'interesting';
    const tasks = this.openTasksOf(n.path);
    const active = VACANCY_ACTIVE.includes(status);
    const nextDate = date(fm.next_date);
    const testDue = date(fm.test_due);
    return {
      path: n.path,
      title: n.title,
      position: str(fm.position) ?? n.title,
      status,
      company: this.ref(n, 'company'),
      url: str(fm.url),
      salary: str(fm.salary),
      location: str(fm.location),
      source: str(fm.source),
      recruiter: this.ref(n, 'recruiter'),
      applied: date(fm.applied),
      resume: this.ref(n, 'resume'),
      interview: date(fm.interview),
      interviewTime: str(fm.interview_time),
      testDue,
      nextStep: str(fm.next_step),
      nextDate,
      result: str(fm.result),
      project: this.ref(n, 'project'),
      openTasks: tasks.length,
      attention:
        active &&
        ((nextDate !== null && nextDate < this.today) ||
          (status === 'test' && testDue !== null && testDue < this.today) ||
          tasks.some((t) => t.date !== null && t.date < this.today)),
      mtimeMs: n.mtimeMs,
    };
  }

  vacancies(): VacancyDTO[] {
    // Сначала дальше продвинувшиеся по воронке, закрытые — в конце.
    const rank = (s: VacancyStatus) => (VACANCY_ACTIVE.includes(s) ? VACANCY_ACTIVE.length - VACANCY_ACTIVE.indexOf(s) : 100);
    return this.notesOf('vacancy')
      .map((n) => this.vacancy(n))
      .sort((a, b) => rank(a.status) - rank(b.status) || b.mtimeMs - a.mtimeMs);
  }

  vacancyDetail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type !== 'vacancy') throw new VaultError('Это не заметка вакансии', 'invalid');
    return {
      ...this.vacancy(n),
      description: getSectionText(n.body, ['Описание', 'Description']) ?? '',
      coverLetter: getSectionText(n.body, ['Сопроводительное письмо', 'Cover letter']) ?? '',
      interviews: getSectionText(n.body, ['Собеседования', 'Interviews']) ?? '',
      history: parseHistory(getSectionText(n.body, ['История', 'History']) ?? ''),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
      related: this.life.related(n),
    };
  }

  async setVacancyStatus(rel: string, status: VacancyStatus, comment?: string | null): Promise<Note> {
    if (!VACANCY_STATUSES.includes(status)) throw new VaultError('Недопустимый статус вакансии', 'invalid');
    const n = this.vault.require(rel);
    if (n.type !== 'vacancy') throw new VaultError('Это не заметка вакансии', 'invalid');
    const prev = this.vacancy(n).status;
    const set: Record<string, unknown> = { status };
    if (status !== 'interesting' && status !== 'archived' && !date(n.frontmatter.applied)) set.applied = this.today;
    await this.vault.updateProperties(rel, set);
    const note = comment?.trim() ? `: ${comment.trim().replace(/\s+/g, ' ')}` : '';
    const line = prev === status ? `- ${this.today} · ${VACANCY_STATUS_LABEL[status]}${note}` : `- ${this.today} · ${VACANCY_STATUS_LABEL[prev]} → ${VACANCY_STATUS_LABEL[status]}${note}`;
    return this.vault.transform(rel, (text) => appendToSection(text, 'История', line).text);
  }

  /** Назначает собеседование: дата в свойствах (попадает в календарь), строка в секции и в истории. */
  async scheduleInterview(rel: string, input: { date: string; time?: string | null; format?: string | null }): Promise<Note> {
    const n = this.vault.require(rel);
    if (n.type !== 'vacancy') throw new VaultError('Это не заметка вакансии', 'invalid');
    const { set } = this.normalizeFields('vacancy', { interview: input.date, interview_time: input.time ?? null });
    await this.vault.updateProperties(rel, set, input.time ? [] : ['interview_time']);
    const when = `${set.interview}${set.interview_time ? ` ${set.interview_time}` : ''}`;
    const format = input.format?.trim() ? ` · ${input.format.trim().replace(/\s+/g, ' ')}` : '';
    await this.vault.transform(rel, (text) => appendToSection(text, 'Собеседования', `- ${when}${format}`).text);
    const status = this.vacancy(this.vault.require(rel)).status;
    const earlier: VacancyStatus[] = ['interesting', 'applied', 'response'];
    return this.setVacancyStatus(rel, earlier.includes(status) ? 'interview' : status, `собеседование ${when}${format}`);
  }

  /** Тестовое задание: срок в свойствах и задача со сроком в заметке вакансии. */
  async addTestAssignment(rel: string, input: { due: string; text?: string | null }) {
    const n = this.vault.require(rel);
    if (n.type !== 'vacancy') throw new VaultError('Это не заметка вакансии', 'invalid');
    const { set } = this.normalizeFields('vacancy', { test_due: input.due });
    await this.vault.updateProperties(rel, set);
    const task = await this.life.createTask({
      text: `Тестовое: ${input.text?.trim() || n.title}`,
      due: set.test_due as string,
      priority: 'high',
      path: rel,
      section: 'Задачи',
    });
    await this.setVacancyStatus(rel, 'test', `срок ${set.test_due}`);
    return task;
  }

  materials(): MaterialDTO[] {
    const vacancies = this.notesOf('vacancy');
    return [...this.notesOf('resume'), ...this.notesOf('portfolio')]
      .map((n) => ({
        path: n.path,
        title: n.title,
        type: n.type as 'resume' | 'portfolio',
        version: str(n.frontmatter.version),
        url: str(n.frontmatter.url),
        updated: date(n.frontmatter.updated),
        usedIn: vacancies.filter((v) => v.links.some((l) => l.resolved === n.path)).length,
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || (b.updated ?? '').localeCompare(a.updated ?? '') || a.title.localeCompare(b.title));
  }

  work() {
    const vacancies = this.vacancies();
    const byStatus = Object.fromEntries(VACANCY_STATUSES.map((s) => [s, 0])) as Record<VacancyStatus, number>;
    for (const v of vacancies) byStatus[v.status]++;
    const active = vacancies.filter((v) => VACANCY_ACTIVE.includes(v.status));
    const sent = vacancies.filter((v) => v.applied).length;
    const responded = vacancies.filter((v) => v.applied && !['applied', 'interesting'].includes(v.status)).length;
    return {
      today: this.today,
      vacancies,
      byStatus,
      active: active.length,
      responseRate: sent ? Math.round((responded / sent) * 100) : null,
      interviews: active
        .filter((v) => v.interview && v.interview >= this.today)
        .sort((a, b) => (a.interview! + (a.interviewTime ?? '')).localeCompare(b.interview! + (b.interviewTime ?? ''))),
      attention: active.filter((v) => v.attention),
      materials: this.materials(),
      companies: this.companies().filter((c) => c.kind !== 'client'),
    };
  }

  // ---------- Компании ----------

  company(n: Note): CompanyDTO {
    const fm = n.frontmatter;
    const contacts = this.notesOf('contact').filter((c) => this.ref(c, 'company')?.path === n.path || refMatchesTitle(this.ref(c, 'company'), n.title));
    const vacancies = this.notesOf('vacancy').filter((v) => this.ref(v, 'company')?.path === n.path || refMatchesTitle(this.ref(v, 'company'), n.title));
    return {
      path: n.path,
      title: n.title,
      kind: str(fm.kind),
      status: str(fm.status),
      website: str(fm.website),
      industry: str(fm.industry),
      city: str(fm.city),
      contacts: contacts.map((c) => ({ path: c.path, title: c.title })),
      vacancies: vacancies.map((v) => ({ path: v.path, title: v.title, status: this.vacancy(v).status })),
      mtimeMs: n.mtimeMs,
    };
  }

  companies(): CompanyDTO[] {
    return this.notesOf('company')
      .map((n) => this.company(n))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  companyDetail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type !== 'company') throw new VaultError('Это не заметка компании', 'invalid');
    const related = this.life.related(n);
    return {
      ...this.company(n),
      notes: getSectionText(n.body, ['Заметки', 'Notes']) ?? '',
      history: parseHistory(getSectionText(n.body, ['История', 'История общения']) ?? ''),
      tasks: this.tasksAround(n, related),
      related,
      documents: this.documents().filter((d) => d.organization?.path === n.path),
    };
  }

  // ---------- Контакты ----------

  contact(n: Note): ContactDTO {
    const fm = n.frontmatter;
    const last = date(fm.last_contact);
    const next = date(fm.next_contact);
    const today = this.today;
    let followUp: ContactDTO['followUp'] = null;
    if (next && n.para !== 'archive') {
      if (next < today) followUp = 'overdue';
      else if (next === today) followUp = 'today';
      else if (next <= addDays(today, 3)) followUp = 'soon';
    }
    const links = Array.isArray(fm.links) ? fm.links.map((x) => str(x)).filter((x): x is string => !!x) : str(fm.links) ? [str(fm.links)!] : [];
    return {
      path: n.path,
      title: n.title,
      company: this.ref(n, 'company'),
      role: str(fm.role),
      kind: str(fm.kind),
      clientStatus: str(fm.client_status),
      phone: str(fm.phone),
      email: str(fm.email),
      links,
      lastContact: last,
      nextContact: next,
      followUp,
      daysSinceContact: last ? diffDays(last, today) : null,
      openTasks: this.openTasksOf(n.path).length,
      mtimeMs: n.mtimeMs,
    };
  }

  contacts(): ContactDTO[] {
    const rank = (c: ContactDTO) => (c.followUp === 'overdue' ? 0 : c.followUp === 'today' ? 1 : c.followUp === 'soon' ? 2 : 3);
    return this.notesOf('contact')
      .map((n) => this.contact(n))
      .sort((a, b) => rank(a) - rank(b) || (a.nextContact ?? '9999').localeCompare(b.nextContact ?? '9999') || a.title.localeCompare(b.title, 'ru'));
  }

  /** Задачи самой заметки и задачи, в тексте которых есть ссылка на неё. */
  private tasksAround(n: Note, related: Related): TaskDTO[] {
    const own = this.life.tasks('all').filter((t) => t.path === n.path);
    const mentioning = related
      .filter((r) => r.direction !== 'out')
      .flatMap((r) => this.vault.get(r.path)?.tasks ?? [])
      .filter((t) => t.status === 'open' || t.status === 'in_progress')
      .filter((t) => t.raw.includes(`[[${n.title}`) || t.raw.includes(`[[${n.path.replace(/\.md$/, '')}`))
      .map((t) => this.life.toDTO(t));
    return [...own, ...mentioning];
  }

  contactDetail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type !== 'contact') throw new VaultError('Это не заметка контакта', 'invalid');
    const related = this.life.related(n);
    const tasks = this.tasksAround(n, related);
    const vacancies = this.notesOf('vacancy')
      .filter((v) => v.links.some((l) => l.resolved === n.path))
      .map((v) => ({ path: v.path, title: v.title, status: this.vacancy(v).status }));
    return {
      ...this.contact(n),
      notes: getSectionText(n.body, ['Заметки', 'Notes']) ?? '',
      history: parseHistory(getSectionText(n.body, ['История общения', 'История', 'History']) ?? ''),
      agreements: tasks.filter((t) => t.path === n.path && t.section && /договор[её]нност/i.test(t.section)),
      tasks: tasks.filter((t) => !(t.path === n.path && t.section && /договор[её]нност/i.test(t.section))),
      vacancies,
      related,
    };
  }

  /**
   * Записывает факт общения: строка в «Истории общения», дата последней связи,
   * следующий контакт и, по желанию, договорённость как задача со сроком.
   */
  async logInteraction(input: {
    path: string;
    text: string;
    channel?: string | null;
    date?: string | null;
    nextContact?: string | null;
    agreement?: string | null;
    agreementDue?: string | null;
  }) {
    const n = this.vault.require(input.path);
    if (n.type !== 'contact' && n.type !== 'company') throw new VaultError('Историю общения можно вести только для контакта или компании', 'invalid');
    const text = input.text.trim().replace(/\s+/g, ' ');
    if (!text) throw new VaultError('Опишите, о чём говорили', 'invalid');
    const day = input.date?.trim() || this.today;
    if (!isIsoDate(day)) throw new VaultError('Дата в формате ГГГГ-ММ-ДД', 'invalid');
    if (day > this.today) throw new VaultError('Дата общения не может быть в будущем: для планов используйте «Следующий контакт»', 'invalid');
    if (input.nextContact && !isIsoDate(input.nextContact)) throw new VaultError('Следующий контакт: дата в формате ГГГГ-ММ-ДД', 'invalid');
    const channel = input.channel?.trim() ? `${input.channel.trim()}: ` : '';
    const heading = n.type === 'contact' ? 'История общения' : 'История';
    await this.vault.transform(n.path, (t) => appendToSection(t, heading, `- ${day} · ${channel}${text}`).text);

    if (n.type === 'contact') {
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      const last = date(n.frontmatter.last_contact);
      if (!last || day > last) set.last_contact = day;
      const prevNext = date(n.frontmatter.next_contact);
      if (input.nextContact) set.next_contact = input.nextContact;
      else if (prevNext && prevNext <= day) unset.push('next_contact'); // запланированный контакт состоялся
      await this.vault.updateProperties(n.path, set, unset);
    }
    let agreement: TaskDTO | null = null;
    if (input.agreement?.trim()) {
      agreement = await this.life.createTask({
        text: input.agreement.trim(),
        due: input.agreementDue || null,
        path: n.path,
        section: 'Договорённости',
      });
    }
    return { path: n.path, agreement };
  }

  // ---------- Документы ----------

  document(n: Note): DocumentDTO {
    const fm = n.frontmatter;
    const rawType = str(fm.doc_type);
    const docType: DocType = rawType && (DOC_TYPES as readonly string[]).includes(rawType) ? (rawType as DocType) : guessDocType(n.title);
    const remindDays = num(fm.remind_days) ?? DEFAULT_REMIND[docType];
    const expires = date(fm.expires) ?? date(fm.valid_until);
    const daysLeft = expires ? diffDays(this.today, expires) : null;
    const remindFrom = expires ? addDays(expires, -remindDays) : null;
    const state: DocumentDTO['state'] = !expires ? 'no_expiry' : expires < this.today ? 'expired' : remindFrom! <= this.today ? 'expiring' : 'valid';
    const renewal = n.tasks.find((t) => (t.status === 'open' || t.status === 'in_progress') && /^продлить/i.test(t.title)) ?? null;
    return {
      path: n.path,
      title: n.title,
      docType,
      owner: str(fm.owner),
      storage: str(fm.storage),
      numberLast4: str(fm.number_last4),
      issued: date(fm.issued),
      expires,
      remindDays,
      remindFrom,
      daysLeft,
      state,
      organization: this.ref(n, 'organization'),
      sensitive: n.sensitive,
      comment: getSectionText(n.body, ['Комментарий', 'Comment']) ?? n.body.replace(/^#.*$/m, '').trim(),
      warnings: documentWarnings(n, docType),
      renewalTask: renewal ? this.life.toDTO(renewal) : null,
      mtimeMs: n.mtimeMs,
    };
  }

  documents(): DocumentDTO[] {
    const rank = { expired: 0, expiring: 1, valid: 2, no_expiry: 3 } as const;
    return this.notesOf('document')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.document(n))
      .sort((a, b) => rank[a.state] - rank[b.state] || (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.title.localeCompare(b.title, 'ru'));
  }

  documentDetail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type !== 'document') throw new VaultError('Это не заметка документа', 'invalid');
    return { ...this.document(n), tasks: this.life.tasks('all').filter((t) => t.path === n.path), related: this.life.related(n) };
  }

  /** Задача «Продлить …» со сроком начала продления (или сегодня, если уже пора). */
  async createRenewalTask(rel: string): Promise<TaskDTO> {
    const n = this.vault.require(rel);
    if (n.type !== 'document') throw new VaultError('Это не заметка документа', 'invalid');
    const d = this.document(n);
    if (!d.expires) throw new VaultError('У документа не указан срок действия', 'invalid');
    if (d.renewalTask) throw new VaultError('Задача на продление уже есть', 'conflict');
    const due = d.remindFrom! > this.today ? d.remindFrom! : this.today;
    return this.life.createTask({ text: `Продлить: ${d.title} (до ${d.expires})`, due, priority: 'high', path: rel, section: 'Задачи' });
  }

  // ---------- Главная и календарь ----------

  reminders() {
    const docs = this.documents();
    return {
      followUps: this.contacts().filter((c) => c.followUp),
      documents: docs.filter((d) => d.state === 'expired' || d.state === 'expiring'),
      interviews: this.work().interviews.filter((v) => v.interview! <= addDays(this.today, 14)),
      vacanciesActive: this.vacancies().filter((v) => VACANCY_ACTIVE.includes(v.status)).length,
    };
  }

  calendarItems(from: string, to: string): Array<{ date: string; item: CalendarItem }> {
    const out: Array<{ date: string; item: CalendarItem }> = [];
    const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;
    for (const n of this.notesOf('vacancy')) {
      if (n.para === 'archive') continue;
      const v = this.vacancy(n);
      if (!VACANCY_ACTIVE.includes(v.status)) continue;
      if (inRange(v.interview)) {
        out.push({ date: v.interview, item: { kind: 'event', title: `Собеседование: ${v.title}`, path: v.path, noteType: 'vacancy', time: v.interviewTime, amount: null } });
      }
      if (v.status === 'test' && inRange(v.testDue)) {
        out.push({ date: v.testDue, item: { kind: 'deadline', title: `Тестовое: ${v.title}`, path: v.path, noteType: 'vacancy' } });
      }
    }
    for (const n of this.notesOf('contact')) {
      if (n.para === 'archive') continue;
      const next = date(n.frontmatter.next_contact);
      if (inRange(next)) out.push({ date: next, item: { kind: 'event', title: `Связаться: ${n.title}`, path: n.path, noteType: 'contact', time: null, amount: null } });
    }
    for (const d of this.documents()) {
      if (inRange(d.expires)) out.push({ date: d.expires, item: { kind: 'deadline', title: `Истекает: ${d.title}`, path: d.path, noteType: 'document' } });
    }
    return out;
  }
}

// ---------- Защита от передачи ИИ ----------

/**
 * Можно ли передавать заметку ИИ-помощнику. Документы и конфиденциальные
 * заметки (sensitive: true, #секретно) закрыты, пока в заметке явно не
 * разрешено `ai: true`. `ai: false` закрывает любую заметку.
 */
export function aiAccess(n: Pick<Note, 'type' | 'sensitive' | 'frontmatter'>): { allowed: boolean; reason: string | null } {
  if (n.frontmatter.ai === false) return { allowed: false, reason: 'В заметке запрещено: ai: false' };
  if (n.frontmatter.ai === true) return { allowed: true, reason: null };
  if (n.sensitive) return { allowed: false, reason: 'Конфиденциальная заметка' };
  if (n.type === 'document') return { allowed: false, reason: 'Документы не передаются ИИ без явного разрешения (ai: true)' };
  return { allowed: true, reason: null };
}

// ---------- Вспомогательное ----------

function entityType(n: Note): EntityType {
  if (!(ENTITY_TYPES as string[]).includes(n.type)) throw new VaultError('Эту заметку нельзя редактировать в этом разделе', 'invalid');
  return n.type as EntityType;
}

export function parseHistory(text: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*(?:[·—–-]\s*)?(.*)$/.exec(line);
    if (m && isIsoDate(m[1])) out.push({ date: m[1]!, text: m[2]!.trim() });
  }
  // Свежие записи сверху; при равной дате — в обратном порядке записи.
  return out.map((e, i) => ({ e, i })).sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i).map((x) => x.e);
}

const ATTACHMENT_RE = /(?:\[\[|\]\(|!\[\[)[^\]\)]*\.(?:pdf|jpe?g|png|heic|tiff?|webp|gif|bmp)\b/i;

/** Предупреждения о небезопасном хранении данных документа. */
export function documentWarnings(n: Pick<Note, 'body' | 'frontmatter' | 'sensitive'>, docType: DocType): string[] {
  const out: string[] = [];
  if (ATTACHMENT_RE.test(n.body)) {
    out.push('В заметке есть ссылка на скан или фото внутри хранилища: файл лежит без шифрования. Перенесите его в зашифрованное место и укажите его в поле «Где хранится».');
  }
  const scrub = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const fmText = Object.entries(n.frontmatter)
    .filter(([k]) => !['number_last4', 'remind_days'].includes(k))
    .map(([, v]) => (typeof v === 'string' || typeof v === 'number' ? String(v) : ''))
    .join(' ');
  if (/\d[\d \-]{5,}\d/.test(scrub(n.body) + ' ' + scrub(fmText))) {
    out.push('Похоже, в заметке записан полный номер документа. Оставьте только последние 4 символа в поле «Последние символы номера».');
  }
  if (!n.sensitive && SENSITIVE_DOC_TYPES.includes(docType)) {
    out.push('Документ не помечен как конфиденциальный: включите «Конфиденциально», чтобы он не попадал в поиск и к ИИ.');
  }
  return out;
}

function guessDocType(title: string): DocType {
  const t = title.toLowerCase();
  if (/паспорт|passport/.test(t)) return 'passport';
  if (/рвп|внж|вид на жительство|residence/.test(t)) return 'residence';
  if (/виза|visa/.test(t)) return 'visa';
  if (/договор|contract/.test(t)) return 'contract';
  if (/диплом|diploma/.test(t)) return 'diploma';
  if (/сертификат|certificate/.test(t)) return 'certificate';
  if (/страхов|полис|insurance/.test(t)) return 'insurance';
  if (/гаранти|warranty/.test(t)) return 'warranty';
  return 'other';
}

function refMatchesTitle(r: Ref | null, title: string): boolean {
  return !!r && r.path === null && r.title.toLowerCase() === title.toLowerCase();
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function date(v: unknown): string | null {
  return isIsoDate(v) ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
