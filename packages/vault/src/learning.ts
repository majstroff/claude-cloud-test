/**
 * Чтение и обучение.
 *
 *   type: book / article / video / course — материал: статус, автор, ссылка,
 *       прогресс (страницы, уроки или %), оценка; секции «Конспект», «Цитаты»,
 *       «Выводы» и «Действия» (практические действия — обычные задачи Obsidian,
 *       они попадают в «Сегодня», бэклог и могут уйти в Todoist).
 *   type: skill — навык или язык: уровень, цель, часы практики и журнал занятий.
 */
import { addDays } from './dates.ts';
import { EntityModule, fmDate, fmEnum, fmNum, fmStr, parseDatedLines, parseNumber, type EntitySpec, type Ref } from './entity-kit.ts';
import { appendToSection, getSectionText } from './markdown.ts';
import { VaultError, type Note } from './vault.ts';
import type { Life, TaskDTO } from './life.ts';

export const MATERIAL_TYPES = ['book', 'article', 'video', 'course'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = { book: 'Книга', article: 'Статья', video: 'Видео', course: 'Курс' };
export const LEARN_STATUSES = ['want', 'active', 'paused', 'done', 'dropped'] as const;
export type LearnStatus = (typeof LEARN_STATUSES)[number];

export interface LearningItemDTO {
  path: string;
  title: string;
  type: MaterialType;
  status: LearnStatus;
  author: string | null;
  url: string | null;
  total: number | null;
  progress: number | null;
  percent: number;
  unit: string;
  started: string | null;
  finished: string | null;
  rating: number | null;
  skill: Ref | null;
  project: Ref | null;
  goal: Ref | null;
  quotes: number;
  openActions: number;
  hasSummary: boolean;
  mtimeMs: number;
}

export interface SkillDTO {
  path: string;
  title: string;
  kind: 'skill' | 'language';
  level: string | null;
  target: string | null;
  status: 'active' | 'paused' | 'done';
  hours: number;
  weeklyMinutes: number | null;
  /** Минуты занятий за последние 7 дней (по журналу). */
  minutes7: number;
  lastSession: string | null;
  goal: Ref | null;
  materials: Array<{ path: string; title: string; status: LearnStatus }>;
}

export interface QuoteDTO {
  text: string;
  path: string;
  title: string;
  author: string | null;
}

const LABELS: Record<string, string> = {
  status: 'Статус', author: 'Автор', url: 'Ссылка', total: 'Всего (страниц, уроков)', progress: 'Пройдено', started: 'Начато',
  finished: 'Закончено', rating: 'Оценка', skill: 'Навык', project: 'Проект', goal: 'Цель', kind: 'Вид', level: 'Уровень',
  target_level: 'Целевой уровень', hours: 'Часов практики', weekly_minutes: 'Цель, минут в неделю', unit: 'Единица',
};

const MATERIAL_SECTIONS = { summary: 'Конспект', quotes: 'Цитаты', takeaways: 'Выводы' };

export class Learning extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(life: Life) {
    super(life);
    const f = () => this.vault.folders.learning;
    const folderName: Record<MaterialType, string> = { book: 'Книги', article: 'Статьи', video: 'Видео', course: 'Курсы' };
    const material = (type: MaterialType): EntitySpec => ({
      folder: () => `${f()}/${folderName[type]}`,
      fields: {
        status: { enum: LEARN_STATUSES }, author: 'text', url: 'url', total: 'count', progress: 'count', unit: { enum: ['pages', 'lessons', 'percent', 'minutes'] },
        started: 'date', finished: 'date', rating: 'rating', skill: 'link', project: 'link', goal: 'link',
      },
      labels: LABELS,
      create: ({ fm, text, today }) => {
        fm.status ??= 'want';
        fm.unit ??= type === 'book' ? 'pages' : type === 'course' ? 'lessons' : 'percent';
        if (fm.status === 'active') fm.started ??= today;
        if (fm.status === 'done') fm.finished ??= today;
        return { body: `${text ? text + '\n\n' : ''}## Конспект\n\n## Цитаты\n\n## Выводы\n\n## Действия\n` };
      },
      sections: MATERIAL_SECTIONS,
    });
    this.specs = {
      book: material('book'),
      article: material('article'),
      video: material('video'),
      course: material('course'),
      skill: {
        folder: () => `${f()}/Навыки`,
        fields: {
          kind: { enum: ['skill', 'language'] }, level: 'text', target_level: 'text', status: { enum: ['active', 'paused', 'done'] },
          hours: 'decimal', weekly_minutes: 'number', goal: 'link', project: 'link',
        },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.kind ??= 'skill';
          fm.status ??= 'active';
          fm.hours ??= 0;
          return { body: `## Зачем\n${text}\n\n## Журнал\n\n## Задачи\n` };
        },
        sections: { why: 'Зачем' },
      },
    };
  }

  item(n: Note): LearningItemDTO {
    const fm = n.frontmatter;
    const type = n.type as MaterialType;
    const total = fmNum(fm.total);
    const progress = fmNum(fm.progress);
    const unit = fmStr(fm.unit) ?? (type === 'book' ? 'pages' : type === 'course' ? 'lessons' : 'percent');
    const status = n.para === 'archive' ? 'done' : fmEnum(fm.status, LEARN_STATUSES, 'want');
    let percent = 0;
    if (status === 'done') percent = 100;
    else if (unit === 'percent' && progress !== null) percent = Math.min(100, progress);
    else if (total && progress !== null) percent = Math.min(100, Math.round((progress / total) * 100));
    return {
      path: n.path,
      title: n.title,
      type,
      status,
      author: fmStr(fm.author),
      url: fmStr(fm.url),
      total,
      progress,
      percent,
      unit,
      started: fmDate(fm.started),
      finished: fmDate(fm.finished),
      rating: fmNum(fm.rating),
      skill: this.ref(n, 'skill'),
      project: this.ref(n, 'project'),
      goal: this.ref(n, 'goal'),
      quotes: parseQuotes(getSectionText(n.body, ['Цитаты', 'Quotes']) ?? '').length,
      openActions: n.tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
      hasSummary: !!(getSectionText(n.body, ['Конспект', 'Summary']) ?? '').trim(),
      mtimeMs: n.mtimeMs,
    };
  }

  items(): LearningItemDTO[] {
    const rank: Record<LearnStatus, number> = { active: 0, want: 1, paused: 2, done: 3, dropped: 4 };
    return MATERIAL_TYPES.flatMap((t) => this.vault.byType(t))
      .map((n) => this.item(n))
      .sort((a, b) => rank[a.status] - rank[b.status] || (b.finished ?? '').localeCompare(a.finished ?? '') || b.mtimeMs - a.mtimeMs);
  }

  skill(n: Note): SkillDTO {
    const fm = n.frontmatter;
    const journal = parseJournal(getSectionText(n.body, ['Журнал', 'Journal']) ?? '');
    const since = addDays(this.today, -7);
    return {
      path: n.path,
      title: n.title,
      kind: fmEnum(fm.kind, ['skill', 'language'] as const, 'skill'),
      level: fmStr(fm.level),
      target: fmStr(fm.target_level),
      status: fmEnum(fm.status, ['active', 'paused', 'done'] as const, 'active'),
      hours: fmNum(fm.hours) ?? 0,
      weeklyMinutes: fmNum(fm.weekly_minutes),
      minutes7: journal.filter((j) => j.date > since && j.date <= this.today).reduce((s, j) => s + j.minutes, 0),
      lastSession: journal[0]?.date ?? null,
      goal: this.ref(n, 'goal'),
      materials: MATERIAL_TYPES.flatMap((t) => this.vault.byType(t))
        .filter((m) => m.links.some((l) => l.key === 'skill' && l.resolved === n.path))
        .map((m) => ({ path: m.path, title: m.title, status: this.item(m).status })),
    };
  }

  skills(): SkillDTO[] {
    return this.vault
      .byType('skill')
      .filter((n) => n.para !== 'archive')
      .map((n) => this.skill(n))
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.title.localeCompare(b.title, 'ru'));
  }

  quotes(): QuoteDTO[] {
    return MATERIAL_TYPES.flatMap((t) => this.vault.byType(t)).flatMap((n) =>
      parseQuotes(getSectionText(n.body, ['Цитаты', 'Quotes']) ?? '').map((q) => ({ text: q, path: n.path, title: n.title, author: fmStr(n.frontmatter.author) })),
    );
  }

  detail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type === 'skill') {
      return {
        type: 'skill' as const,
        ...this.skill(n),
        why: this.section(n, ['Зачем', 'Why']),
        journal: parseJournal(this.section(n, ['Журнал', 'Journal'])),
        tasks: this.life.tasks('all').filter((t) => t.path === n.path),
        related: this.life.related(n),
      };
    }
    if (!(MATERIAL_TYPES as readonly string[]).includes(n.type)) throw new VaultError('Это не запись раздела «Чтение и обучение»', 'invalid');
    const actions: TaskDTO[] = this.life.tasks('all').filter((t) => t.path === n.path);
    return {
      ...this.item(n),
      summary: this.section(n, ['Конспект', 'Summary']),
      quotesText: this.section(n, ['Цитаты', 'Quotes']),
      quoteList: parseQuotes(this.section(n, ['Цитаты', 'Quotes'])),
      takeaways: this.section(n, ['Выводы', 'Takeaways']),
      actions,
      related: this.life.related(n),
    };
  }

  /** Прогресс чтения или прохождения; при 100% материал отмечается прочитанным. */
  async setProgress(rel: string, input: { progress?: unknown; status?: string | null }) {
    const n = this.requireType(rel, [...MATERIAL_TYPES], 'материал для изучения');
    const it = this.item(n);
    const set: Record<string, unknown> = {};
    if (input.progress !== undefined && input.progress !== null && input.progress !== '') {
      const p = parseNumber(input.progress);
      if (p === null || p < 0) throw new VaultError('Прогресс — неотрицательное число', 'invalid');
      const max = it.unit === 'percent' ? 100 : it.total;
      if (max !== null && p > max) throw new VaultError(`Прогресс не может быть больше ${max}`, 'invalid');
      set.progress = Math.round(p);
      if ((max !== null && p >= max) && it.status !== 'done') set.status = 'done';
      else if (it.status === 'want' || it.status === 'paused') set.status = 'active';
    }
    if (input.status) {
      if (!(LEARN_STATUSES as readonly string[]).includes(input.status)) throw new VaultError('Недопустимый статус', 'invalid');
      set.status = input.status;
    }
    if (set.status === 'active' && !it.started) set.started = this.today;
    if (set.status === 'done') {
      if (!it.finished) set.finished = this.today;
      if (!it.started) set.started = this.today;
      if (it.unit === 'percent') set.progress = 100;
      else if (it.total !== null) set.progress = it.total;
    }
    await this.vault.updateProperties(rel, set);
    return this.item(this.vault.require(rel));
  }

  async addQuote(rel: string, input: { text: string; page?: string | null }) {
    this.requireType(rel, [...MATERIAL_TYPES], 'материал для изучения');
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new VaultError('Введите текст цитаты', 'invalid');
    const page = input.page?.trim() ? ` (с. ${input.page.trim().replace(/\s+/g, ' ')})` : '';
    // Пустая строка отделяет цитаты друг от друга: иначе Obsidian склеит их в одну.
    await this.vault.transform(rel, (t) => {
      const existing = getSectionText(t, ['Цитаты', 'Quotes']) ?? '';
      return appendToSection(t, 'Цитаты', `${existing.trim() ? '\n' : ''}> ${text}${page}`).text;
    });
    return this.item(this.vault.require(rel));
  }

  /** Практическое действие из материала — задача в секции «Действия». */
  async addAction(rel: string, input: { text: string; due?: string | null }) {
    this.requireType(rel, [...MATERIAL_TYPES], 'материал для изучения');
    return this.life.createTask({ text: input.text, due: input.due ?? null, path: rel, section: 'Действия' });
  }

  /** Занятие по навыку: строка в журнале и часы практики. */
  async logSession(rel: string, input: { minutes: unknown; text?: string | null; date?: string | null }) {
    const n = this.requireType(rel, 'skill', 'навык');
    const minutes = parseNumber(input.minutes);
    if (minutes === null || minutes <= 0 || minutes > 24 * 60) throw new VaultError('Длительность — от 1 до 1440 минут', 'invalid');
    const date = this.checkDate(input.date, 'Дата');
    if (date > this.today) throw new VaultError('Занятие не может быть в будущем', 'invalid');
    const hours = Math.round(((fmNum(n.frontmatter.hours) ?? 0) + minutes / 60) * 100) / 100;
    await this.vault.updateProperties(rel, { hours });
    const note = input.text?.trim() ? ` · ${input.text.trim().replace(/\s+/g, ' ')}` : '';
    await this.vault.transform(rel, (t) => appendToSection(t, 'Журнал', `- ${date} · ${Math.round(minutes)} мин${note}`).text);
    return this.skill(this.vault.require(rel));
  }

  overview() {
    const items = this.items();
    const year = this.today.slice(0, 4);
    const skills = this.skills();
    return {
      today: this.today,
      items,
      skills,
      quotes: this.quotes(),
      stats: {
        active: items.filter((i) => i.status === 'active').length,
        want: items.filter((i) => i.status === 'want').length,
        doneThisYear: items.filter((i) => i.status === 'done' && i.finished?.startsWith(year)).length,
        booksThisYear: items.filter((i) => i.type === 'book' && i.status === 'done' && i.finished?.startsWith(year)).length,
        minutes7: skills.reduce((s, x) => s + x.minutes7, 0),
        openActions: items.reduce((s, i) => s + i.openActions, 0),
      },
    };
  }
}

export function parseQuotes(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join(' ').trim());
    cur = [];
  };
  for (const line of text.split('\n')) {
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      if (q[1]!.trim()) cur.push(q[1]!.trim());
      else flush();
      continue;
    }
    flush();
    const li = /^\s*[-*]\s+(.+)$/.exec(line);
    if (li && !/^\[[ xX/-]\]/.test(li[1]!)) out.push(li[1]!.trim());
  }
  flush();
  return out.filter(Boolean);
}

export function parseJournal(text: string): Array<{ date: string; minutes: number; text: string }> {
  return parseDatedLines(text).map((e) => {
    const m = /^(\d+)\s*(?:мин|min|м)\.?\s*(?:[·—–-]\s*)?(.*)$/i.exec(e.text);
    return { date: e.date, minutes: m ? Number(m[1]) : 0, text: m ? m[2]!.trim() : e.text };
  });
}

export function isMaterialType(t: string): t is MaterialType {
  return (MATERIAL_TYPES as readonly string[]).includes(t);
}

