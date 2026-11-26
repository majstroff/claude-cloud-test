/**
 * Общие инструменты разделов, где записи — Markdown-заметки с YAML-свойствами:
 * проверка значений из форм, ссылки между заметками, создание и изменение
 * записей по схеме, история в секции заметки.
 */
import { addDays, addMonths, isIsoDate } from './dates.ts';
import { appendToSection, getSectionText, setSectionText } from './markdown.ts';
import { VaultError, type Note, type Vault } from './vault.ts';
import type { Life } from './life.ts';

export type FieldKind =
  | 'text'
  | 'date'
  | 'time'
  | 'url'
  | 'email'
  | 'phone'
  /** Целое 0…3650 (дни, минуты). */
  | 'number'
  /** Целое 0…1 000 000 (страницы, шаги). */
  | 'count'
  /** Сумма денег: до 2 знаков после запятой. */
  | 'money'
  /** Дробное 0…100 000 (часы сна, литры, километры, вес). */
  | 'decimal'
  /** Оценка 1…5. */
  | 'rating'
  | 'link'
  | 'list'
  | 'boolean'
  | 'last4'
  | 'docnumber'
  /** Ежегодная дата: ГГГГ-ММ-ДД или ММ-ДД, если год неизвестен (день рождения, годовщина). */
  | 'monthday'
  | { enum: readonly string[] };

/** Ссылка на заметку или просто текст, если такой заметки нет. */
export interface Ref {
  path: string | null;
  title: string;
}

/** Переводит строку с числом «1 250,50» в число. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s  ₽]/g, '').replace(',', '.');
  if (!s || !/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeFieldValue(kind: FieldKind, value: unknown, label: string, linkOrText: (s: string) => string): unknown {
  if (typeof kind === 'object') {
    if (typeof value !== 'string' || !kind.enum.includes(value)) throw new VaultError(`Недопустимое значение поля «${label}»`, 'invalid');
    return value;
  }
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') throw new VaultError(`Поле «${label}» должно быть да/нет`, 'invalid');
    return value;
  }
  if (kind === 'number' || kind === 'count' || kind === 'rating') {
    const n = parseNumber(value);
    const [min, max] = kind === 'number' ? [0, 3650] : kind === 'count' ? [0, 1_000_000] : [1, 5];
    if (n === null || n < min || n > max) throw new VaultError(`Поле «${label}»: введите число от ${min} до ${max.toLocaleString('ru-RU')}`, 'invalid');
    return Math.round(n);
  }
  if (kind === 'money' || kind === 'decimal') {
    const n = parseNumber(value);
    const max = kind === 'money' ? 1e12 : 100_000;
    if (n === null || n < 0 || n > max) throw new VaultError(`Поле «${label}»: введите неотрицательное число`, 'invalid');
    return Math.round(n * 100) / 100;
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
      if (!/^[0-9A-Za-zА-Яа-я]{1,4}$/.test(s)) throw new VaultError('Поле «Последние символы номера»: не больше 4 букв или цифр', 'invalid');
      return s;
    case 'docnumber':
      if (!/^[0-9A-Za-zА-Яа-яЁё№\s\-/.]{1,40}$/.test(s)) {
        throw new VaultError('Поле «Номер»: только буквы, цифры, пробелы, дефис, точка, «/» и «№», до 40 символов', 'invalid');
      }
      return s.replace(/\s+/g, ' ');
    case 'monthday': {
      const a = parseAnniversary(s);
      if (!a) throw new VaultError(`Поле «${label}»: дата в формате ГГГГ-ММ-ДД, ДД.ММ.ГГГГ или ДД.ММ, если год неизвестен`, 'invalid');
      return a.year ? `${a.year}-${a.md}` : a.md;
    }
    case 'link':
      return linkOrText(s);
    default:
      return s.slice(0, 500);
  }
}

/** Значение ссылочного свойства: найденная заметка или текст как есть. */
export function refOf(vault: Vault, n: Note, key: string): Ref | null {
  const l = n.links.find((x) => x.key === key && x.resolved);
  if (l?.resolved) {
    const target = vault.get(l.resolved);
    if (target) return { path: target.path, title: target.title };
  }
  const v = n.frontmatter[key];
  const raw = Array.isArray(v) ? v[0] : v;
  const s = fmStr(raw);
  if (!s) return null;
  return { path: null, title: s.replace(/^\[\[|\]\]$/g, '').split('|').pop()!.trim() };
}

/** Ссылка [[…]], если заметка с таким путём или именем есть, иначе текст. */
export function linkOrText(vault: Vault, value: string): string {
  const v = value.trim();
  if (/^\[\[.+\]\]$/.test(v)) return v;
  const resolved = vault.get(v) ? v : vault.resolve(v);
  return resolved ? vault.linkTo(resolved) : v;
}

export function fmStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

export function fmDate(v: unknown): string | null {
  return isIsoDate(v) ? v : null;
}

export function fmNum(v: unknown): number | null {
  return parseNumber(v);
}

export function fmEnum<T extends string>(v: unknown, values: readonly T[], dflt: T): T {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : dflt;
}

export function money(n: number): string {
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ')} ₽`;
}

export type Period = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** Следующая дата через период. */
export function addPeriod(iso: string, period: Period | 'none'): string {
  switch (period) {
    case 'weekly':
      return addDays(iso, 7);
    case 'monthly':
      return addMonths(iso, 1);
    case 'quarterly':
      return addMonths(iso, 3);
    case 'yearly':
      return addMonths(iso, 12);
    default:
      return iso;
  }
}

/** Сколько это в месяц: для сравнения подписок с разной периодичностью. */
export function monthlyEquivalent(amount: number, period: Period): number {
  const k = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[period];
  return Math.round(amount * k * 100) / 100;
}

/** Описание одного типа записей раздела. */
export interface EntitySpec {
  /** Папка, где создаются новые заметки этого типа. */
  folder: () => string;
  fields: Record<string, FieldKind>;
  labels: Record<string, string>;
  /** Значения по умолчанию и тело новой заметки. */
  create: (ctx: { title: string; fm: Record<string, unknown>; text: string; today: string }) => { title?: string; body: string };
  /** Секции, которые можно редактировать из интерфейса: ключ → заголовок. */
  sections?: Record<string, string>;
}

export interface EntityOwner {
  readonly entityTypes: readonly string[];
  createEntity(input: { type: string; title: string; fields?: Record<string, unknown>; text?: string; createCompany?: boolean }): Promise<Note>;
  updateEntity(rel: string, input: Record<string, unknown>): Promise<Note>;
  saveSection(rel: string, section: string, content: string): Promise<Note>;
}

/** Базовый модуль: создание и изменение записей по схеме, история, секции. */
export abstract class EntityModule implements EntityOwner {
  protected abstract specs: Record<string, EntitySpec>;

  constructor(readonly life: Life) {}

  get entityTypes(): string[] {
    return Object.keys(this.specs);
  }

  protected get vault(): Vault {
    return this.life.vault;
  }

  protected get today(): string {
    return this.life.today;
  }

  protected ref(n: Note, key: string): Ref | null {
    return refOf(this.vault, n, key);
  }

  protected spec(type: string): EntitySpec {
    const s = this.specs[type];
    if (!s) throw new VaultError('Неизвестный тип записи', 'invalid');
    return s;
  }

  protected requireType(rel: string, types: string | string[], what: string): Note {
    const n = this.vault.require(rel);
    const list = Array.isArray(types) ? types : [types];
    if (!list.includes(n.type)) throw new VaultError(`Это не заметка: ${what}`, 'invalid');
    return n;
  }

  normalizeFields(type: string, input: Record<string, unknown>): { set: Record<string, unknown>; unset: string[] } {
    const spec = this.spec(type);
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const kind = spec.fields[key];
      if (!kind) throw new VaultError(`Свойство «${key}» нельзя менять в этом разделе`, 'invalid');
      const empty = value === null || value === undefined || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
      if (empty) {
        unset.push(key);
        continue;
      }
      set[key] = normalizeFieldValue(kind, value, spec.labels[key] ?? key, (s) => linkOrText(this.vault, s));
    }
    return { set, unset };
  }

  async createEntity(input: { type: string; title: string; fields?: Record<string, unknown>; text?: string }): Promise<Note> {
    const spec = this.spec(input.type);
    const title = input.title.trim();
    if (!title) throw new VaultError('Введите название', 'invalid');
    const { set } = this.normalizeFields(input.type, input.fields ?? {});
    const fm: Record<string, unknown> = { type: input.type, ...set, created: this.today };
    const r = spec.create({ title, fm, text: input.text?.trim() ?? '', today: this.today });
    const finalTitle = r.title ?? title;
    return this.vault.createNote({ folder: spec.folder(), title: finalTitle, frontmatter: fm, body: `# ${finalTitle}\n\n${r.body}` });
  }

  async updateEntity(rel: string, input: Record<string, unknown>): Promise<Note> {
    const n = this.vault.require(rel);
    if (!this.entityTypes.includes(n.type)) throw new VaultError('Эту заметку нельзя редактировать в этом разделе', 'invalid');
    const { set, unset } = this.normalizeFields(n.type, input);
    return this.vault.updateProperties(rel, set, unset);
  }

  async saveSection(rel: string, section: string, content: string): Promise<Note> {
    const n = this.vault.require(rel);
    const heading = this.specs[n.type]?.sections?.[section];
    if (!heading) throw new VaultError('Эту секцию нельзя менять из интерфейса', 'invalid');
    return this.vault.transform(rel, (text) => setSectionText(text, heading, content));
  }

  protected section(n: Note, headings: string | string[]): string {
    return getSectionText(n.body, headings) ?? '';
  }

  /** Строка «- 2026-11-24 · текст» в секцию истории заметки. */
  protected async logHistory(rel: string, date: string, text: string, heading = 'История'): Promise<Note> {
    const line = `- ${date} · ${text.replace(/\s+/g, ' ').trim()}`;
    return this.vault.transform(rel, (t) => appendToSection(t, heading, line).text);
  }

  /** Находит или создаёт служебную заметку (список покупок, бюджет…). */
  protected async ensureNote(folder: string, title: string, fm: Record<string, unknown>, body: string): Promise<Note> {
    const rel = `${folder}/${title}.md`;
    const existing = this.vault.get(rel);
    if (existing) return existing;
    return this.vault.createNote({ folder, title, frontmatter: fm, body });
  }

  protected checkDate(v: string | null | undefined, label: string): string {
    const d = v?.trim() || this.today;
    if (!isIsoDate(d)) throw new VaultError(`${label}: дата в формате ГГГГ-ММ-ДД`, 'invalid');
    return d;
  }
}

/** Текущее время ЧЧ:ММ по часам компьютера. */
export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Разбор строк «- 2026-11-24 · текст» (свежие сверху). */
export function parseDatedLines(text: string): Array<{ date: string; text: string }> {
  const out: Array<{ date: string; text: string }> = [];
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*(?:[·—–-]\s*)?(.*)$/.exec(line);
    if (m && isIsoDate(m[1])) out.push({ date: m[1]!, text: m[2]!.trim() });
  }
  return out.map((e, i) => ({ e, i })).sort((a, b) => b.e.date.localeCompare(a.e.date) || b.i - a.i).map((x) => x.e);
}

/**
 * Ежегодная дата: «1990-03-15», «03-15», «15.03.1990», «15.03».
 * Год может быть неизвестен — тогда возраст и «сколько лет» не считаются.
 */
export function parseAnniversary(v: unknown): { year: number | null; md: string } | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) v = v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let y: number | null = null;
  let m: number;
  let d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^-{0,2}(\d{2})-(\d{2})$/.exec(s))) [m, d] = [Number(r[1]), Number(r[2])];
  else if ((r = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), r[3] ? Number(r[3]) : null];
  else return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  if (d > maxDay) return null;
  if (y !== null && (y < 1900 || y > 2200)) return null;
  if (y !== null && m === 2 && d === 29 && !isLeap(y)) return null;
  return { year: y, md: `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Ближайшее наступление ежегодной даты не раньше from (29 февраля в невисокосный год — 28-го). */
export function nextOccurrence(md: string, from: string): string {
  const year = Number(from.slice(0, 4));
  const at = (y: number) => (md === '02-29' && !isLeap(y) ? `${y}-02-28` : `${y}-${md}`);
  const cur = at(year);
  return cur >= from ? cur : at(year + 1);
}
