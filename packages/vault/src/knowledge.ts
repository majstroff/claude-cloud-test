/**
 * Знания: заметки, инструкции, исследования и ссылки поверх Obsidian.
 *
 *   type: note        — обычная заметка (так же определяются заметки без type);
 *   type: instruction — инструкция: шаги, когда проверялась;
 *   type: research    — исследование: вопрос, источники, выводы, следующие шаги;
 *   type: bookmark    — ссылка на статью или сайт: адрес, прочитано ли, зачем сохранили.
 *
 * Связи — обычные ссылки [[…]]: исходящие, обратные, «висячие» (на заметки,
 * которых ещё нет) и упоминания названия без ссылки. Поиск — общий полнотекстовый
 * индекс хранилища. Конфиденциальные заметки и документы сюда не попадают.
 */
import path from 'node:path';
import { appendToSection } from './markdown.ts';
import { normalize } from './search.ts';
import { EntityModule, fmDate, fmEnum, fmStr, type EntitySpec } from './entity-kit.ts';
import { VaultError, summarize, type Note, type NoteSummary, type ParaBucket } from './vault.ts';
import type { Life } from './life.ts';

export const KNOWLEDGE_TYPES = ['note', 'instruction', 'research', 'bookmark'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeType, string> = {
  note: 'Заметка',
  instruction: 'Инструкция',
  research: 'Исследование',
  bookmark: 'Ссылка',
};
export const KNOWLEDGE_STATUSES = ['draft', 'active', 'done', 'outdated'] as const;
/** Расширения вложений: ссылки на них не считаются «висячими». */
const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|tiff?|pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?|xlsx?|pptx?|csv|txt|canvas|excalidraw)$/i;

export interface KnowledgeItemDTO {
  path: string;
  title: string;
  type: KnowledgeType;
  para: ParaBucket;
  folder: string;
  topic: string | null;
  status: string | null;
  url: string | null;
  read: boolean | null;
  tags: string[];
  excerpt: string;
  linksOut: number;
  backlinks: number;
  unresolved: number;
  mtimeMs: number;
}

export interface UnresolvedLinkDTO {
  target: string;
  from: Array<{ path: string; title: string }>;
}

const LABELS: Record<string, string> = {
  topic: 'Тема', status: 'Статус', source: 'Источник', project: 'Проект', goal: 'Цель', area: 'Сфера', tags: 'Теги',
  question: 'Вопрос', reviewed: 'Проверено', url: 'Адрес', read: 'Прочитано', why: 'Зачем сохранил',
};

export class Knowledge extends EntityModule {
  protected specs: Record<string, EntitySpec>;

  constructor(life: Life) {
    super(life);
    const base = { topic: 'text', tags: 'list', project: 'link', area: 'text' } as const;
    const folder = (sub?: string) => () => (sub ? `${this.vault.folders.knowledge}/${sub}` : this.vault.folders.knowledge);
    this.specs = {
      note: {
        folder: folder(),
        fields: { ...base, status: { enum: KNOWLEDGE_STATUSES }, source: 'url', goal: 'link' },
        labels: LABELS,
        create: ({ text }) => ({ body: `${text ? text + '\n' : ''}\n## Связи\n` }),
      },
      instruction: {
        folder: folder('Инструкции'),
        fields: { ...base, status: { enum: KNOWLEDGE_STATUSES }, reviewed: 'date', source: 'url' },
        labels: LABELS,
        create: ({ fm, text, today }) => {
          fm.status ??= 'active';
          fm.reviewed ??= today;
          return { body: `${text ? text + '\n\n' : ''}## Шаги\n\n1. \n\n## Заметки\n\n## Связи\n` };
        },
      },
      research: {
        folder: folder('Исследования'),
        fields: { ...base, status: { enum: KNOWLEDGE_STATUSES }, question: 'text', goal: 'link' },
        labels: LABELS,
        create: ({ fm, text }) => {
          fm.status ??= 'active';
          const q = typeof fm.question === 'string' ? fm.question : '';
          return { body: `## Вопрос\n\n${q || text}\n\n## Источники\n\n## Выводы\n\n## Следующие шаги\n\n## Связи\n` };
        },
      },
      bookmark: {
        folder: folder('Ссылки'),
        fields: { ...base, url: 'url', read: 'boolean', why: 'text' },
        labels: LABELS,
        create: ({ fm, text }) => {
          if (typeof fm.url !== 'string') throw new VaultError('Укажите адрес ссылки (http:// или https://)', 'invalid');
          fm.read ??= false;
          return { body: `${fm.url}\n\n${text ? text + '\n\n' : ''}## Выводы\n\n## Связи\n` };
        },
      },
    };
  }

  /** Заметка относится к «Знаниям» и её можно показывать (не документ, не конфиденциальная). */
  isKnowledge(n: Note): boolean {
    return (KNOWLEDGE_TYPES as readonly string[]).includes(n.type) && !n.sensitive && n.frontmatter.ai !== false;
  }

  item(n: Note): KnowledgeItemDTO {
    const fm = n.frontmatter;
    const resolved = new Set(n.links.map((l) => l.resolved).filter((p): p is string => !!p && p !== n.path));
    return {
      path: n.path,
      title: n.title,
      type: n.type as KnowledgeType,
      para: n.para,
      folder: path.posix.dirname(n.path) === '.' ? '' : path.posix.dirname(n.path),
      topic: fmStr(fm.topic),
      status: fmStr(fm.status),
      url: fmStr(fm.url) ?? fmStr(fm.source),
      read: typeof fm.read === 'boolean' ? fm.read : null,
      tags: n.tags,
      excerpt: excerpt(n.body),
      linksOut: resolved.size,
      backlinks: this.vault.backlinks(n.path).filter((p) => p !== n.path).length,
      unresolved: this.danglingOf(n).length,
      mtimeMs: n.mtimeMs,
    };
  }

  /** Ссылки заметки на несуществующие заметки (вложения не считаются). */
  private danglingOf(n: Note): string[] {
    return [...new Set(n.links.filter((l) => !l.resolved && l.target && !ATTACHMENT_EXT.test(l.target)).map((l) => l.target))];
  }

  items(filter: { type?: string | null; tag?: string | null; para?: string | null; folder?: string | null; archive?: boolean } = {}): KnowledgeItemDTO[] {
    return this.vault
      .all()
      .filter((n) => this.isKnowledge(n))
      .filter((n) => filter.archive || n.para !== 'archive' || filter.para === 'archive')
      .filter((n) => !filter.type || n.type === filter.type)
      .filter((n) => !filter.tag || n.tags.includes(filter.tag))
      .filter((n) => !filter.para || (filter.para === 'none' ? n.para === null : n.para === filter.para))
      .filter((n) => !filter.folder || n.path.startsWith(filter.folder.replace(/\/+$/, '') + '/'))
      .map((n) => this.item(n))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /**
   * Полнотекстовый поиск. scope=knowledge — только «Знания», scope=all — по всему
   * хранилищу (кроме конфиденциального: у таких заметок нет фрагмента текста).
   */
  search(query: string, opts: { scope?: 'knowledge' | 'all'; type?: string | null; tag?: string | null; para?: string | null; limit?: number } = {}) {
    const q = query.trim();
    if (!q) return [];
    const hits = this.vault.searchNotes(q, { limit: 300 });
    return hits
      .filter((h) => {
        const n = this.vault.get(h.path);
        if (!n || n.sensitive || n.type === 'document') return false;
        if ((opts.scope ?? 'knowledge') === 'knowledge' && !this.isKnowledge(n)) return false;
        if (opts.type && n.type !== opts.type) return false;
        if (opts.tag && !n.tags.includes(opts.tag)) return false;
        if (opts.para && (opts.para === 'none' ? n.para !== null : n.para !== opts.para)) return false;
        return true;
      })
      .slice(0, opts.limit ?? 50)
      .map((h) => ({ path: h.path, title: h.note.title, type: h.note.type, para: h.note.para, tags: h.note.tags, snippet: h.snippet, score: h.score }));
  }

  /** Теги заметок «Знаний» по частоте. */
  tags(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const n of this.vault.all()) {
      if (!this.isKnowledge(n) || n.para === 'archive') continue;
      for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru'));
  }

  /** Заметки без единой связи: ни исходящих ссылок, ни обратных. */
  orphans(): KnowledgeItemDTO[] {
    return this.items().filter((i) => i.linksOut === 0 && i.backlinks === 0);
  }

  /** «Висячие» ссылки по всему хранилищу: на что ссылаются, но заметки ещё нет. */
  unresolved(): UnresolvedLinkDTO[] {
    const map = new Map<string, { target: string; from: Map<string, string> }>();
    for (const n of this.vault.all()) {
      if (n.sensitive || n.type === 'document' || n.type === 'template' || n.para === 'archive') continue;
      for (const t of this.danglingOf(n)) {
        const key = normalize(t);
        const e = map.get(key) ?? { target: t, from: new Map() };
        e.from.set(n.path, n.title);
        map.set(key, e);
      }
    }
    return [...map.values()]
      .map((e) => ({ target: e.target, from: [...e.from].map(([p, title]) => ({ path: p, title })) }))
      .sort((a, b) => b.from.length - a.from.length || a.target.localeCompare(b.target, 'ru'));
  }

  overview(filter: { type?: string | null; tag?: string | null; para?: string | null } = {}) {
    const all = this.items();
    const byType = Object.fromEntries(KNOWLEDGE_TYPES.map((t) => [t, all.filter((i) => i.type === t).length])) as Record<KnowledgeType, number>;
    const unresolved = this.unresolved();
    return {
      today: this.today,
      folder: this.vault.folders.knowledge,
      total: all.length,
      byType,
      items: this.items(filter).slice(0, 300),
      tags: this.tags().slice(0, 40),
      orphans: this.orphans().slice(0, 30),
      orphansTotal: this.orphans().length,
      unresolved: unresolved.slice(0, 30),
      unresolvedTotal: unresolved.length,
      unreadBookmarks: all.filter((i) => i.type === 'bookmark' && i.read === false).length,
    };
  }

  detail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type === 'document' || n.sensitive) throw new VaultError('Конфиденциальные заметки и документы не показываются в «Знаниях»', 'forbidden');
    const outgoing = [...new Map(n.links.filter((l) => l.resolved && l.resolved !== n.path).map((l) => [l.resolved!, l])).keys()]
      .map((p) => this.vault.get(p))
      .filter((x): x is Note => !!x)
      .map((x) => summarize(x));
    const backlinks = this.vault
      .backlinks(n.path)
      .filter((p) => p !== n.path)
      .map((p) => this.vault.get(p))
      .filter((x): x is Note => !!x)
      .map((x) => summarize(x));
    return {
      ...(this.isKnowledge(n) ? this.item(n) : { ...this.itemLike(n) }),
      frontmatter: n.frontmatter,
      reviewed: fmDate(n.frontmatter.reviewed),
      question: fmStr(n.frontmatter.question),
      why: fmStr(n.frontmatter.why),
      outgoing,
      backlinks,
      dangling: this.danglingOf(n),
      mentions: this.unlinkedMentions(n),
      suggestions: this.suggestions(n),
      tasks: this.life.tasks('all').filter((t) => t.path === n.path),
    };
  }

  private itemLike(n: Note): KnowledgeItemDTO {
    return { ...this.item(n), type: fmEnum(n.type, KNOWLEDGE_TYPES, 'note') };
  }

  /** Заметки, где название встречается в тексте, но ссылки на неё нет. */
  unlinkedMentions(n: Note): NoteSummary[] {
    const title = n.title.trim();
    if (title.length < 3) return [];
    const needle = normalize(title);
    const linked = new Set(this.vault.backlinks(n.path));
    return this.vault
      .searchNotes(title, { limit: 60 })
      .filter((h) => h.path !== n.path && !linked.has(h.path))
      .map((h) => this.vault.get(h.path))
      .filter((x): x is Note => !!x && !x.sensitive && x.type !== 'document' && normalize(x.body).includes(needle))
      .slice(0, 10)
      .map((x) => summarize(x));
  }

  /** Похожие заметки: общие теги и тема, ещё не связанные с этой. */
  suggestions(n: Note): NoteSummary[] {
    const linked = new Set([...n.links.map((l) => l.resolved), ...this.vault.backlinks(n.path), n.path]);
    const topic = fmStr(n.frontmatter.topic)?.toLowerCase() ?? null;
    if (!n.tags.length && !topic) return [];
    return this.vault
      .all()
      .filter((x) => !linked.has(x.path) && this.isKnowledge(x) && x.para !== 'archive')
      .map((x) => {
        const common = x.tags.filter((t) => n.tags.includes(t)).length;
        const sameTopic = topic && fmStr(x.frontmatter.topic)?.toLowerCase() === topic ? 2 : 0;
        return { x, score: common + sameTopic };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score || b.x.mtimeMs - a.x.mtimeMs)
      .slice(0, 8)
      .map((e) => summarize(e.x));
  }

  /** Добавляет ссылку [[цель]] в секцию «Связи» заметки (если её там ещё нет). */
  async link(fromRel: string, toRel: string, comment?: string | null): Promise<Note> {
    const from = this.vault.require(fromRel);
    const to = this.vault.require(toRel);
    if (from.path === to.path) throw new VaultError('Нельзя связать заметку саму с собой', 'invalid');
    if (from.type === 'document' || from.sensitive) throw new VaultError('В конфиденциальные заметки и документы связи отсюда не добавляются', 'forbidden');
    if (from.links.some((l) => l.resolved === to.path)) throw new VaultError('Ссылка на эту заметку уже есть', 'conflict');
    const note = comment?.trim() ? ` — ${comment.replace(/\s+/g, ' ').trim()}` : '';
    return this.vault.transform(from.path, (t) => appendToSection(t, 'Связи', `- ${this.vault.linkTo(to.path)}${note}`).text);
  }

  /** Создаёт заметку для «висячей» ссылки, чтобы ссылка заработала. */
  async createForLink(target: string, type: KnowledgeType = 'note'): Promise<Note> {
    const t = target.trim();
    if (!t) throw new VaultError('Пустое название', 'invalid');
    if (this.vault.resolve(t)) throw new VaultError('Такая заметка уже есть', 'conflict');
    const base = t.split('/').pop()!.trim();
    const from = this.unresolved().find((u) => normalize(u.target) === normalize(t))?.from ?? [];
    const mentions = from.length ? `Ссылаются: ${from.map((f) => this.vault.linkTo(f.path)).join(', ')}\n` : '';
    const n = await this.createEntity({ type, title: base, text: mentions.trim() });
    if (this.vault.resolve(t) !== n.path) {
      // Имя было занято другим файлом — ссылка не заработает, сообщаем честно.
      throw new VaultError(`Заметка создана как «${n.title}», но ссылки [[${t}]] на неё не указывают`, 'conflict');
    }
    return n;
  }
}

/** Первые строки текста без заголовков, свойств, задач и разметки. */
export function excerpt(body: string, max = 180): string {
  const text = body
    .split('\n')
    .filter((l) => l.trim() && !/^\s*#/.test(l) && !/^\s*[-*]\s+\[.\]/.test(l))
    .join(' ')
    .replace(/!?\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
