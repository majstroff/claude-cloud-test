import { createHash, randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import path from 'node:path';
import { systemClock, type Clock } from './dates.ts';
import { buildNote, parseFrontmatter, splitFrontmatter, updateFrontmatter, type Frontmatter } from './frontmatter.ts';
import { extractFrontmatterLinks, extractLinks, extractTags, findSections, firstHeading, maskCode, type RawLink } from './markdown.ts';
import { SearchIndex, type SearchHit } from './search.ts';
import { TASK_LINE, effectiveDate, parseTaskLine, type ParsedTask } from './tasks.ts';

export type ParaBucket = 'projects' | 'areas' | 'resources' | 'archive' | null;

export interface VaultTask extends ParsedTask {
  /** Стабильный в пределах версии файла идентификатор: путь + номер строки. */
  id: string;
  path: string;
  /** Номер строки в файле (с 0). */
  line: number;
  /** Исходная строка — используется для проверки конфликтов при изменении. */
  raw: string;
  /** Заголовок ближайшей секции над задачей. */
  section: string | null;
}

export interface NoteLink extends RawLink {
  /** Путь найденной заметки или null для «висячей» ссылки. */
  resolved: string | null;
  /** Ключ свойства, если ссылка взята из frontmatter. */
  key?: string;
}

export interface Note {
  path: string;
  title: string;
  type: string;
  para: ParaBucket;
  frontmatter: Frontmatter;
  frontmatterError: string | null;
  body: string;
  bodyLine: number;
  tags: string[];
  links: NoteLink[];
  tasks: VaultTask[];
  mtimeMs: number;
  size: number;
  hash: string;
  sensitive: boolean;
}

export interface NoteSummary {
  path: string;
  title: string;
  type: string;
  para: ParaBucket;
  tags: string[];
  mtimeMs: number;
  sensitive: boolean;
  frontmatter: Frontmatter;
}

export interface FolderConfig {
  projects: string;
  areas: string;
  resources: string;
  archive: string;
  goals: string;
  cycles: string;
  ideas: string;
  inbox: string;
  daily: string;
  events: string;
  /** Работа и поиск работы: вакансии и материалы для откликов. */
  work: string;
  contacts: string;
  companies: string;
  documents: string;
  /** Финансы: бюджет, операции, подписки, долги, накопления. */
  finance: string;
  /** Спорт и здоровье: тренировки и процедуры. */
  health: string;
  /** Чтение и обучение: книги, статьи, курсы, навыки. */
  learning: string;
  practices: string;
  /** Дом: техника, покупки, бытовые дела. */
  home: string;
  /** Знания: заметки, инструкции, исследования, ссылки. */
  knowledge: string;
  /** Путешествия: поездки и брони. */
  travel: string;
  /** Отношения: важные даты и близкие люди. */
  relationships: string;
  /** Итоги недели и месяца. */
  reviews: string;
  /** Формат имени файла ежедневной заметки (поддерживаются YYYY, MM, DD). */
  dailyFormat: string;
  dailyTemplate: string | null;
}

export class VaultError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'conflict' | 'invalid' | 'forbidden' | 'io',
  ) {
    super(message);
  }
}

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.frame-os']);
const MAX_NOTE_BYTES = 5 * 1024 * 1024;

export interface VaultOptions {
  root: string;
  clock?: Clock;
  folders?: Partial<FolderConfig>;
}

export class Vault {
  readonly root: string;
  readonly clock: Clock;
  folders!: FolderConfig;
  private folderOverrides: Partial<FolderConfig>;
  private notes = new Map<string, Note>();
  private byName = new Map<string, string[]>();
  private backlinkIndex = new Map<string, Set<string>>();
  readonly search = new SearchIndex();
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, NodeJS.Timeout>();
  private listeners = new Set<(paths: string[]) => void>();
  readErrors: Array<{ path: string; error: string }> = [];
  lastScan: number = 0;

  constructor(opts: VaultOptions) {
    this.root = path.resolve(opts.root);
    this.clock = opts.clock ?? systemClock;
    this.folderOverrides = opts.folders ?? {};
  }

  static async open(opts: VaultOptions): Promise<Vault> {
    const v = new Vault(opts);
    const st = await fs.stat(v.root).catch(() => null);
    if (!st || !st.isDirectory()) {
      throw new VaultError(`Папка хранилища не найдена: ${v.root}`, 'not_found');
    }
    await v.scan();
    return v;
  }

  // ---------- Чтение и индекс ----------

  async scan(): Promise<void> {
    const files: string[] = [];
    await this.walk('', files);
    this.notes.clear();
    this.byName.clear();
    this.readErrors = [];
    this.folders = await this.detectFolders();
    const results = await Promise.all(files.map((f) => this.readNote(f)));
    for (const n of results) if (n) this.putNote(n, false);
    this.rebuildLinks();
    this.lastScan = Date.now();
  }

  private async walk(rel: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(this.root, rel), { withFileTypes: true });
    } catch (e) {
      this.readErrors.push({ path: rel || '.', error: (e as Error).message });
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORED_DIRS.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await this.walk(childRel, out);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(childRel);
    }
  }

  private async readNote(rel: string): Promise<Note | null> {
    const abs = path.join(this.root, rel);
    try {
      const st = await fs.stat(abs);
      if (st.size > MAX_NOTE_BYTES) {
        this.readErrors.push({ path: rel, error: 'Файл больше 5 МБ, пропущен' });
        return null;
      }
      const content = await fs.readFile(abs, 'utf8');
      return this.parseNote(rel, content, st.mtimeMs, st.size);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      this.readErrors.push({ path: rel, error: (e as Error).message });
      return null;
    }
  }

  parseNote(rel: string, content: string, mtimeMs: number, size: number): Note {
    const { yaml, body, bodyLine } = splitFrontmatter(content);
    const fm = parseFrontmatter(yaml);
    const data = fm.data;
    const basename = path.posix.basename(rel, '.md');
    const title =
      (typeof data.title === 'string' && data.title.trim()) || basename || firstHeading(body) || rel;
    const para = this.paraOf(rel);
    const fmTags = normalizeTags(data.tags);
    const tags = [...new Set([...fmTags, ...extractTags(body)])];
    const links: NoteLink[] = [
      ...extractFrontmatterLinks(data).map((l) => ({ ...l, resolved: null })),
      ...extractLinks(body).map((l) => ({ ...l, resolved: null })),
    ];
    const note: Note = {
      path: rel,
      title,
      type: this.inferType(rel, data, para),
      para,
      frontmatter: data,
      frontmatterError: fm.error,
      body,
      bodyLine,
      tags,
      links,
      tasks: [],
      mtimeMs,
      size,
      hash: hashContent(content),
      sensitive: data.sensitive === true || tags.includes('sensitive') || tags.includes('секретно'),
    };
    note.tasks = this.parseTasks(note, content);
    return note;
  }

  private parseTasks(note: Note, content: string): VaultTask[] {
    const lines = content.split('\n');
    const masked = maskCode(content).split('\n');
    const tasks: VaultTask[] = [];
    let section: string | null = null;
    for (let i = note.bodyLine; i < lines.length; i++) {
      const raw = lines[i]!.replace(/\r$/, '');
      const h = /^#{1,6}\s+(.*)$/.exec(masked[i] ?? '');
      if (h) section = h[1]!.trim();
      if (!TASK_LINE.test(masked[i] ?? '')) continue;
      const t = parseTaskLine(raw);
      if (!t) continue;
      tasks.push({ ...t, id: `${note.path}:${i}`, path: note.path, line: i, raw, section });
    }
    return tasks;
  }

  private inferType(rel: string, data: Frontmatter, para: ParaBucket): string {
    if (typeof data.type === 'string' && data.type.trim()) return data.type.trim().toLowerCase();
    const f = this.folders;
    const dir = path.posix.dirname(rel);
    const inDir = (folder: string) => folder && (dir === folder || dir.startsWith(folder + '/'));
    if (inDir(f.daily)) return 'daily';
    if (inDir(f.goals)) return 'goal';
    if (inDir(f.cycles)) return 'cycle';
    if (inDir(f.ideas)) return 'idea';
    if (inDir(`${f.work}/Вакансии`)) return 'vacancy';
    if (inDir(f.contacts)) return 'contact';
    if (inDir(f.companies)) return 'company';
    if (inDir(f.documents)) return 'document';
    if (para === 'projects') {
      const base = path.posix.basename(rel, '.md');
      if (dir === f.projects) return 'project';
      // «Папка-заметка»: Projects/Сайт/Сайт.md
      if (path.posix.dirname(dir) === f.projects && path.posix.basename(dir) === base) return 'project';
    }
    return 'note';
  }

  paraOf(rel: string): ParaBucket {
    const f = this.folders;
    const under = (folder: string) => folder && (rel === folder || rel.startsWith(folder + '/'));
    if (under(f.projects)) return 'projects';
    if (under(f.areas)) return 'areas';
    if (under(f.resources)) return 'resources';
    if (under(f.archive)) return 'archive';
    return null;
  }

  private async detectFolders(): Promise<FolderConfig> {
    let top: string[] = [];
    try {
      top = (await fs.readdir(this.root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      top = [];
    }
    const pick = (re: RegExp, fallback: string, list = top) => list.find((n) => re.test(n)) ?? fallback;
    const projects = pick(/^(\d+[\s._-]*)?(projects?|проекты?)$/i, 'Projects');
    const areas = pick(/^(\d+[\s._-]*)?(areas?|сферы|области)$/i, 'Areas');
    const resources = pick(/^(\d+[\s._-]*)?(resources?|ресурсы)$/i, 'Resources');
    const archive = pick(/^(\d+[\s._-]*)?(archives?|архив)$/i, 'Archive');
    const inbox = pick(/^(\d+[\s._-]*)?(inbox|входящие)$/i, 'Inbox');
    const sub = async (parent: string) => {
      try {
        return (await fs.readdir(path.join(this.root, parent), { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => `${parent}/${e.name}`);
      } catch {
        return [];
      }
    };
    const second = [...(await sub(areas)), ...(await sub(inbox)), ...(await sub(resources))];
    const all = [...top, ...second];
    const byBase = (re: RegExp, fallback: string) => all.find((p) => re.test(path.posix.basename(p))) ?? fallback;

    let daily = byBase(/^(daily|daily notes|journal|дневник|ежедневные)$/i, 'Daily');
    let dailyFormat = 'YYYY-MM-DD';
    let dailyTemplate: string | null = null;
    try {
      const cfg = JSON.parse(await fs.readFile(path.join(this.root, '.obsidian', 'daily-notes.json'), 'utf8'));
      if (typeof cfg.folder === 'string' && cfg.folder.trim()) daily = cfg.folder.replace(/^\/+|\/+$/g, '');
      if (typeof cfg.format === 'string' && /^[YMD\-_. ]+$/.test(cfg.format)) dailyFormat = cfg.format;
      if (typeof cfg.template === 'string' && cfg.template.trim()) dailyTemplate = cfg.template.trim();
    } catch {
      // Настроек плагина «Ежедневные заметки» нет — используем значения по умолчанию.
    }
    const detected: FolderConfig = {
      projects,
      areas,
      resources,
      archive,
      inbox,
      goals: byBase(/^(goals?|цели)$/i, `${areas}/Goals`),
      cycles: byBase(/^(cycles?|циклы|12[\s-]?week.*|12[\s-]?недель.*)$/i, `${areas}/Cycles`),
      ideas: byBase(/^(ideas?|идеи)$/i, `${inbox}/Ideas`),
      events: byBase(/^(calendar|events?|календарь|события)$/i, 'Calendar'),
      work: byBase(/^(work|career|работа|карьера)$/i, `${areas}/Работа`),
      contacts: byBase(/^(contacts|people|контакты|люди)$/i, `${resources}/Контакты`),
      companies: byBase(/^(companies|organizations|компании|организации)$/i, `${resources}/Компании`),
      documents: byBase(/^(documents|docs|документы)$/i, `${areas}/Документы`),
      finance: byBase(/^(finance|finances|money|финансы|деньги)$/i, `${areas}/Финансы`),
      health: byBase(/^(health|sport|здоровье|спорт|спорт и здоровье)$/i, `${areas}/Здоровье`),
      learning: byBase(/^(learning|study|обучение|чтение|чтение и обучение)$/i, `${resources}/Обучение`),
      practices: byBase(/^(practices?|практики)$/i, `${areas}/Практики`),
      home: byBase(/^(home|house|household|дом|быт)$/i, `${areas}/Дом`),
      knowledge: byBase(/^(knowledge|knowledge base|wiki|знания|база знаний)$/i, `${resources}/Знания`),
      travel: byBase(/^(travel|travels|trips|путешествия|поездки)$/i, `${areas}/Путешествия`),
      relationships: byBase(/^(relationships|relations|отношения|близкие)$/i, `${areas}/Отношения`),
      reviews: byBase(/^(reviews?|итоги|обзоры)$/i, `${areas}/Итоги`),
      daily,
      dailyFormat,
      dailyTemplate,
    };
    return { ...detected, ...stripEmpty(this.folderOverrides) };
  }

  async setFolderOverrides(overrides: Partial<FolderConfig>): Promise<void> {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'string' && v) this.assertRelDir(v);
      void k;
    }
    this.folderOverrides = overrides;
    await this.scan();
  }

  private putNote(n: Note, relink = true): void {
    const prev = this.notes.get(n.path);
    if (prev) this.unindexName(prev.path);
    this.notes.set(n.path, n);
    const key = nameKey(n.path);
    const arr = this.byName.get(key) ?? [];
    if (!arr.includes(n.path)) arr.push(n.path);
    this.byName.set(key, arr);
    this.search.upsert(n.path, n.title, n.body);
    if (relink) this.rebuildLinks();
  }

  private dropNote(rel: string): void {
    if (!this.notes.has(rel)) return;
    this.unindexName(rel);
    this.notes.delete(rel);
    this.search.remove(rel);
    this.rebuildLinks();
  }

  private unindexName(rel: string): void {
    const key = nameKey(rel);
    const arr = (this.byName.get(key) ?? []).filter((p) => p !== rel);
    if (arr.length) this.byName.set(key, arr);
    else this.byName.delete(key);
  }

  private rebuildLinks(): void {
    this.backlinkIndex.clear();
    for (const n of this.notes.values()) {
      for (const l of n.links) {
        l.resolved = l.target ? this.resolve(l.target, n.path) : n.path;
        if (l.resolved && l.resolved !== n.path) {
          let s = this.backlinkIndex.get(l.resolved);
          if (!s) this.backlinkIndex.set(l.resolved, (s = new Set()));
          s.add(n.path);
        }
      }
    }
  }

  /** Разрешает цель ссылки так же, как Obsidian: путь, затем имя файла. */
  resolve(target: string, fromPath?: string): string | null {
    let t = target.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!t) return null;
    if (fromPath && (t.startsWith('../') || t.startsWith('./'))) {
      t = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), t));
    }
    const withExt = t.toLowerCase().endsWith('.md') ? t : `${t}.md`;
    if (this.notes.has(withExt)) return withExt;
    const lower = withExt.toLowerCase();
    for (const p of this.notes.keys()) if (p.toLowerCase() === lower) return p;
    if (fromPath) {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), withExt));
      if (this.notes.has(rel)) return rel;
    }
    const candidates = (this.byName.get(nameKey(withExt)) ?? []).filter((p) =>
      t.includes('/') ? p.toLowerCase().endsWith('/' + lower) || p.toLowerCase() === lower : true,
    );
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    const fromDir = fromPath ? path.posix.dirname(fromPath) : '';
    return [...candidates].sort((a, b) => {
      const sa = path.posix.dirname(a) === fromDir ? 0 : 1;
      const sb = path.posix.dirname(b) === fromDir ? 0 : 1;
      return sa - sb || a.split('/').length - b.split('/').length || a.localeCompare(b);
    })[0]!;
  }

  /** Ссылка в формате Obsidian на заметку: [[Имя]] или [[Путь/Имя]] при совпадении имён. */
  linkTo(rel: string): string {
    const base = path.posix.basename(rel, '.md');
    const same = this.byName.get(nameKey(rel)) ?? [];
    const target = same.length > 1 ? rel.replace(/\.md$/, '') : base;
    return `[[${target}]]`;
  }

  get(rel: string): Note | undefined {
    return this.notes.get(rel);
  }

  require(rel: string): Note {
    const n = this.notes.get(rel);
    if (!n) throw new VaultError(`Заметка не найдена: ${rel}`, 'not_found');
    return n;
  }

  all(): Note[] {
    return [...this.notes.values()];
  }

  byType(type: string): Note[] {
    return this.all().filter((n) => n.type === type);
  }

  backlinks(rel: string): string[] {
    return [...(this.backlinkIndex.get(rel) ?? [])].sort();
  }

  allTasks(): VaultTask[] {
    return this.all().flatMap((n) => n.tasks);
  }

  searchNotes(query: string, opts: { limit?: number; type?: string } = {}): Array<SearchHit & { note: NoteSummary }> {
    const hits = this.search.search(query, {
      limit: opts.limit ?? 30,
      filter: opts.type ? (p) => this.notes.get(p)?.type === opts.type : undefined,
    });
    return hits.flatMap((h) => {
      const n = this.notes.get(h.path);
      if (!n) return [];
      return [{ ...h, snippet: n.sensitive ? '' : h.snippet, note: summarize(n) }];
    });
  }

  stats() {
    const types: Record<string, number> = {};
    for (const n of this.notes.values()) types[n.type] = (types[n.type] ?? 0) + 1;
    return {
      root: this.root,
      notes: this.notes.size,
      tasks: this.allTasks().length,
      types,
      frontmatterErrors: this.all()
        .filter((n) => n.frontmatterError)
        .map((n) => ({ path: n.path, error: n.frontmatterError! })),
      readErrors: this.readErrors,
      lastScan: this.lastScan,
      folders: this.folders,
    };
  }

  // ---------- Наблюдение за файлами ----------

  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString().split(path.sep).join('/');
        if (rel.split('/').some((seg) => seg.startsWith('.'))) {
          if (rel.startsWith('.obsidian/daily-notes.json')) this.schedule('__rescan__');
          return;
        }
        if (!rel.toLowerCase().endsWith('.md')) {
          // Переименование/удаление папки — проще пересканировать.
          if (!path.posix.extname(rel)) this.schedule('__rescan__');
          return;
        }
        this.schedule(rel);
      });
      this.watcher.on('error', () => this.unwatch());
    } catch {
      this.watcher = null;
    }
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  onChange(fn: (paths: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private schedule(rel: string): void {
    const prev = this.pending.get(rel);
    if (prev) clearTimeout(prev);
    this.pending.set(
      rel,
      setTimeout(() => {
        this.pending.delete(rel);
        void (rel === '__rescan__' ? this.scan().then(() => this.emit(['*'])) : this.refresh(rel));
      }, 150),
    );
  }

  /** Перечитывает один файл с диска (после внешнего изменения). */
  async refresh(rel: string): Promise<void> {
    const n = await this.readNote(rel);
    if (n) this.putNote(n);
    else this.dropNote(rel);
    this.emit([rel]);
  }

  private emit(paths: string[]): void {
    for (const l of this.listeners) l(paths);
  }

  // ---------- Запись ----------

  private assertRelDir(rel: string): void {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s === '..' || s.startsWith('.'))) {
      throw new VaultError(`Недопустимый путь: ${rel}`, 'forbidden');
    }
  }

  /** Проверяет, что путь указывает на .md-файл внутри хранилища. */
  safePath(rel: string): string {
    if (typeof rel !== 'string' || !rel.trim()) throw new VaultError('Не указан путь', 'invalid');
    const clean = rel.replace(/\\/g, '/');
    if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) throw new VaultError(`Недопустимый путь: ${rel}`, 'forbidden');
    this.assertRelDir(clean);
    if (!clean.toLowerCase().endsWith('.md')) throw new VaultError('Можно записывать только .md-файлы', 'forbidden');
    const abs = path.resolve(this.root, clean);
    if (!abs.startsWith(this.root + path.sep)) throw new VaultError(`Путь вне хранилища: ${rel}`, 'forbidden');
    return abs;
  }

  private async writeFileAtomic(rel: string, content: string): Promise<Note> {
    const abs = this.safePath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const real = await fs.realpath(path.dirname(abs));
    const realRoot = await fs.realpath(this.root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new VaultError(`Путь вне хранилища: ${rel}`, 'forbidden');
    }
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, abs);
    const st = await fs.stat(abs);
    const note = this.parseNote(rel.replace(/\\/g, '/'), content, st.mtimeMs, st.size);
    this.putNote(note);
    this.emit([note.path]);
    return note;
  }

  private async readFresh(rel: string): Promise<string> {
    const abs = this.safePath(rel);
    try {
      return await fs.readFile(abs, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError(`Заметка не найдена: ${rel}`, 'not_found');
      throw new VaultError((e as Error).message, 'io');
    }
  }

  async readRaw(rel: string): Promise<{ content: string; hash: string }> {
    const content = await this.readFresh(rel);
    return { content, hash: hashContent(content) };
  }

  /** Перезаписывает файл, если он не изменился с момента чтения (baseHash). */
  async writeNote(rel: string, content: string, baseHash: string | null): Promise<Note> {
    const exists = await fs
      .stat(this.safePath(rel))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      const current = await this.readFresh(rel);
      if (baseHash === null || hashContent(current) !== baseHash) {
        throw new VaultError('Файл изменился в Obsidian после открытия. Обновите страницу, чтобы не потерять правки.', 'conflict');
      }
    } else if (baseHash !== null) {
      throw new VaultError('Файл был удалён или перемещён', 'conflict');
    }
    return this.writeFileAtomic(rel, content);
  }

  /** Создаёт новую заметку; при совпадении имени добавляет « 2», « 3»… */
  async createNote(opts: { folder: string; title: string; frontmatter?: Frontmatter; body?: string }): Promise<Note> {
    const folder = opts.folder.replace(/^\/+|\/+$/g, '');
    if (folder) this.assertRelDir(folder);
    const base = sanitizeFileName(opts.title);
    if (!base) throw new VaultError('Пустое название', 'invalid');
    let rel = folder ? `${folder}/${base}.md` : `${base}.md`;
    for (let i = 2; await exists(this.safePath(rel)); i++) {
      rel = folder ? `${folder}/${base} ${i}.md` : `${base} ${i}.md`;
      if (i > 999) throw new VaultError('Не удалось подобрать имя файла', 'conflict');
    }
    const body = opts.body ?? '';
    return this.writeFileAtomic(rel, buildNote(opts.frontmatter ?? {}, body));
  }

  /** Меняет свойства заметки (YAML), не трогая текст. */
  async updateProperties(rel: string, set: Frontmatter, unset: string[] = []): Promise<Note> {
    const content = await this.readFresh(rel);
    let next: string;
    try {
      next = updateFrontmatter(content, set, unset);
    } catch (e) {
      throw new VaultError((e as Error).message, 'invalid');
    }
    return this.writeFileAtomic(rel, next);
  }

  /** Изменяет текст заметки функцией (читает свежую версию с диска). */
  async transform(rel: string, fn: (content: string) => string): Promise<Note> {
    const content = await this.readFresh(rel);
    const next = fn(content);
    if (next === content) return this.notes.get(rel) ?? this.parseNote(rel, content, Date.now(), content.length);
    return this.writeFileAtomic(rel, next);
  }

  /**
   * Изменяет строку задачи. `expectedRaw` — строка, которую видел пользователь;
   * если файл с тех пор изменился, задача ищется по точному тексту, иначе конфликт.
   */
  async editTaskLine(
    rel: string,
    line: number,
    expectedRaw: string,
    fn: (raw: string) => string | string[],
  ): Promise<{ note: Note; line: number }> {
    let resultLine = line;
    const note = await this.transform(rel, (content) => {
      const lines = content.split('\n');
      let idx = line;
      const strip = (s: string | undefined) => (s ?? '').replace(/\r$/, '');
      if (strip(lines[idx]) !== expectedRaw) {
        const found = lines.map(strip).flatMap((l, i) => (l === expectedRaw ? [i] : []));
        if (found.length !== 1) {
          throw new VaultError('Задача изменилась в Obsidian. Обновите список и повторите.', 'conflict');
        }
        idx = found[0]!;
      }
      const cr = lines[idx]!.endsWith('\r') ? '\r' : '';
      const replaced = fn(strip(lines[idx]));
      const arr = (Array.isArray(replaced) ? replaced : [replaced]).map((l) => l + cr);
      lines.splice(idx, 1, ...arr);
      resultLine = idx + arr.length - 1;
      return lines.join('\n');
    });
    return { note, line: resultLine };
  }

  /**
   * Записи заметки по секциям: непустые строки под заголовками (пункты списков,
   * цитаты, строки таблиц, абзацы). Заголовки, шапки таблиц и код не входят.
   */
  async noteLines(rel: string): Promise<Array<{ heading: string; items: Array<{ line: number; raw: string }> }>> {
    const content = await this.readFresh(rel);
    const { bodyLine } = splitFrontmatter(content);
    const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
    const out: Array<{ heading: string; items: Array<{ line: number; raw: string }> }> = [];
    const sections = findSections(lines).filter((s) => s.start >= bodyLine && s.level >= 2);
    for (const s of sections) {
      const items: Array<{ line: number; raw: string }> = [];
      let inFence = false;
      for (let i = s.start + 1; i < s.end; i++) {
        const raw = lines[i]!;
        if (/^\s*```/.test(raw)) {
          inFence = !inFence;
          continue;
        }
        if (!inFence && /^#{1,6}\s/.test(raw)) break; // подзаголовок — своя секция
        if (inFence || !raw.trim()) continue;
        // Шапка таблицы и разделитель |---| — не записи.
        if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue;
        if (/^\s*\|/.test(raw) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) continue;
        items.push({ line: i, raw });
      }
      if (items.length) out.push({ heading: s.heading, items });
    }
    return out;
  }

  /** Заменяет (text — строка) или удаляет (text = null) одну строку заметки. Свойства и заголовки не трогает. */
  async editLine(rel: string, line: number, expectedRaw: string, text: string | null): Promise<{ line: number; raw: string }> {
    if (text !== null) {
      if (/[\r\n]/.test(text)) throw new VaultError('Запись должна быть одной строкой', 'invalid');
      if (!text.trim()) throw new VaultError('Запись не может быть пустой. Чтобы убрать её, нажмите «Удалить».', 'invalid');
    }
    let at = line;
    await this.transform(rel, (content) => {
      const { bodyLine } = splitFrontmatter(content);
      const lines = content.split('\n');
      const strip = (x: string | undefined) => (x ?? '').replace(/\r$/, '');
      let idx = line;
      if (strip(lines[idx]) !== expectedRaw) {
        const found = lines.map(strip).flatMap((l, i) => (l === expectedRaw ? [i] : []));
        if (found.length !== 1) throw new VaultError('Запись изменилась в Obsidian. Обновите страницу и повторите.', 'conflict');
        idx = found[0]!;
      }
      if (idx < bodyLine || /^#{1,6}\s/.test(strip(lines[idx]))) throw new VaultError('Эту строку нельзя менять здесь', 'invalid');
      at = idx;
      const cr = lines[idx]!.endsWith('\r') ? '\r' : '';
      if (text === null) lines.splice(idx, 1);
      else lines[idx] = text + cr;
      return lines.join('\n');
    });
    return { line: at, raw: expectedRaw };
  }

  /** Вставляет строку обратно (для «Отменить» после удаления записи). */
  async insertLine(rel: string, line: number, raw: string): Promise<void> {
    if (/[\r\n]/.test(raw) || !raw.trim()) throw new VaultError('Некорректная запись', 'invalid');
    await this.transform(rel, (content) => {
      const { bodyLine } = splitFrontmatter(content);
      const lines = content.split('\n');
      lines.splice(Math.max(bodyLine, Math.min(line, lines.length)), 0, raw);
      return lines.join('\n');
    });
  }

  // ---------- Вложения: аудио и видео ----------

  /** Папка вложений: как в настройках Obsidian (attachmentFolderPath), иначе «<Resources>/Вложения». */
  async attachmentsFolder(): Promise<string> {
    try {
      const cfg = JSON.parse(await fs.readFile(path.join(this.root, '.obsidian', 'app.json'), 'utf8')) as { attachmentFolderPath?: string };
      const f = (cfg.attachmentFolderPath ?? '').replace(/^\/+|\/+$/g, '');
      if (f && !f.startsWith('.')) {
        this.assertRelDir(f);
        return f;
      }
    } catch {
      /* настроек нет — папка по умолчанию */
    }
    return `${this.folders.resources || 'Resources'}/Вложения`;
  }

  /** Абсолютный путь к медиафайлу внутри хранилища (только аудио и видео, без служебных папок). */
  assetPath(rel: string): string {
    if (typeof rel !== 'string' || !rel.trim()) throw new VaultError('Не указан файл', 'invalid');
    const clean = rel.replace(/\\/g, '/');
    if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) throw new VaultError(`Недопустимый путь: ${rel}`, 'forbidden');
    this.assertRelDir(clean);
    if (!mediaKind(clean)) throw new VaultError('Поддерживаются только аудио и видео', 'forbidden');
    const abs = path.resolve(this.root, clean);
    if (!abs.startsWith(this.root + path.sep)) throw new VaultError(`Путь вне хранилища: ${rel}`, 'forbidden');
    return abs;
  }

  /** Находит файл вложения по имени из ![[…]]: рядом с заметкой, в папке вложений или где угодно в хранилище. */
  async findAsset(name: string, fromNote: string): Promise<string | null> {
    const clean = name.replace(/\\/g, '/').trim();
    if (!mediaKind(clean)) return null;
    const candidates = [clean, `${path.posix.dirname(fromNote)}/${clean}`, `${await this.attachmentsFolder()}/${path.posix.basename(clean)}`];
    for (const c of candidates) {
      try {
        if (await exists(this.assetPath(c))) return path.posix.normalize(c);
      } catch {
        /* недопустимый путь — пропускаем */
      }
    }
    const base = path.posix.basename(clean).toLowerCase();
    const walk = async (dir: string): Promise<string | null> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(path.join(this.root, dir), { withFileTypes: true });
      } catch {
        return null;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isFile() && e.name.toLowerCase() === base) return rel;
        if (e.isDirectory()) {
          const r = await walk(rel);
          if (r) return r;
        }
      }
      return null;
    };
    return walk('');
  }

  /** Сохраняет загруженный файл в папку вложений; возвращает путь. maxBytes — предел размера. */
  async saveAttachment(name: string, data: Readable, maxBytes: number): Promise<{ path: string; size: number }> {
    const base = path.posix.basename(name.replace(/\\/g, '/')).replace(/[\x00-\x1f<>:"|?*#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base || base.startsWith('.')) throw new VaultError('Некорректное имя файла', 'invalid');
    if (!mediaKind(base)) throw new VaultError('Можно прикреплять аудио (mp3, m4a, aac, wav, flac, ogg, opus) и видео (mp4, m4v, mov, webm)', 'invalid');
    const folder = await this.attachmentsFolder();
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let rel = `${folder}/${base}`;
    for (let i = 2; await exists(this.assetPath(rel)); i++) rel = `${folder}/${stem} ${i}${ext}`;
    const abs = this.assetPath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const real = await fs.realpath(path.dirname(abs));
    const realRoot = await fs.realpath(this.root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new VaultError('Путь вне хранилища', 'forbidden');
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.part`);
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) cb(new VaultError(`Файл больше ${Math.round(maxBytes / 1024 ** 3)} ГБ`, 'invalid'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(data, limit, createWriteStream(tmp));
      if (size === 0) throw new VaultError('Файл пустой', 'invalid');
      await fs.rename(tmp, abs);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return { path: rel, size };
  }

  /** Переносит медиафайл в корзину Obsidian (.trash). */
  async trashAsset(rel: string): Promise<{ from: string; to: string }> {
    const src = this.assetPath(rel);
    if (!(await exists(src))) throw new VaultError(`Файл не найден: ${rel}`, 'not_found');
    const trashDir = path.join(this.root, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const ext = path.posix.extname(rel);
    const stem = path.posix.basename(rel, ext);
    let name = `${stem}${ext}`;
    for (let i = 2; await exists(path.join(trashDir, name)); i++) name = `${stem} ${i}${ext}`;
    await fs.rename(src, path.join(trashDir, name));
    return { from: rel, to: `.trash/${name}` };
  }

  /** Возвращает медиафайл из корзины на прежнее место. */
  async restoreAsset(trashed: { from: string; to: string }): Promise<void> {
    const name = path.posix.basename(trashed.to);
    if (!trashed.to.startsWith('.trash/') || name !== trashed.to.slice(7) || !mediaKind(name)) throw new VaultError('Некорректный файл в корзине', 'invalid');
    const dest = this.assetPath(trashed.from);
    if (await exists(dest)) throw new VaultError('Файл с таким именем уже есть', 'conflict');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(path.join(this.root, '.trash', name), dest);
  }

  /** Перемещает заметку в другую папку (например, в архив). Ссылки по имени продолжают работать. */
  async move(rel: string, toFolder: string): Promise<Note> {
    const src = this.safePath(rel);
    this.assertRelDir(toFolder);
    const name = path.posix.basename(rel);
    const destRel = `${toFolder.replace(/^\/+|\/+$/g, '')}/${name}`;
    const dest = this.safePath(destRel);
    if (await exists(dest)) throw new VaultError(`В папке ${toFolder} уже есть ${name}`, 'conflict');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    this.dropNote(rel);
    await this.refresh(destRel);
    return this.require(destRel);
  }

  /**
   * Удаление в корзину Obsidian: файл переносится в `.trash` внутри хранилища
   * (так же делает сам Obsidian), его можно вернуть вручную. Безвозвратно не удаляется.
   */
  async trash(rel: string): Promise<{ from: string; to: string }> {
    const src = this.safePath(rel);
    if (!(await exists(src))) throw new VaultError(`Заметка не найдена: ${rel}`, 'not_found');
    const trashDir = path.join(this.root, '.trash');
    await fs.mkdir(trashDir, { recursive: true });
    const base = path.posix.basename(rel, '.md');
    let name = `${base}.md`;
    for (let i = 2; await exists(path.join(trashDir, name)); i++) name = `${base} ${i}.md`;
    await fs.rename(src, path.join(trashDir, name));
    this.dropNote(rel);
    this.emit([rel]);
    return { from: rel, to: `.trash/${name}` };
  }

  dailyPath(date: string): string {
    const [y, m, d] = date.split('-');
    const name = this.folders.dailyFormat.replace('YYYY', y!).replace('MM', m!).replace('DD', d!);
    return this.folders.daily ? `${this.folders.daily}/${name}.md` : `${name}.md`;
  }

  async dailyTemplate(date: string): Promise<string> {
    const t = this.folders.dailyTemplate;
    if (t) {
      try {
        const tpl = await this.readFresh(t.endsWith('.md') ? t : `${t}.md`);
        return tpl.replace(/\{\{\s*date(:[^}]*)?\s*\}\}/g, date).replace(/\{\{\s*title\s*\}\}/g, date);
      } catch {
        // Шаблон из настроек Obsidian не найден — используем встроенный.
      }
    }
    return buildNote(
      { type: 'daily', date },
      `# ${date}\n\n## Приоритеты\n\n## Задачи\n\n## Заметки\n\n## Итог дня\n`,
    );
  }

  async ensureDaily(date: string): Promise<Note> {
    const rel = this.dailyPath(date);
    const existing = this.notes.get(rel);
    if (existing) return existing;
    if (await exists(this.safePath(rel))) {
      await this.refresh(rel);
      return this.require(rel);
    }
    return this.writeFileAtomic(rel, await this.dailyTemplate(date));
  }

  today(): string {
    return this.clock();
  }

  taskDate(t: VaultTask): string | null {
    return effectiveDate(t);
  }
}

export function summarize(n: Note): NoteSummary {
  return {
    path: n.path,
    title: n.title,
    type: n.type,
    para: n.para,
    tags: n.tags,
    mtimeMs: n.mtimeMs,
    sensitive: n.sensitive,
    frontmatter: n.sensitive ? pickSafe(n.frontmatter) : n.frontmatter,
  };
}

function pickSafe(fm: Frontmatter): Frontmatter {
  const out: Frontmatter = {};
  for (const k of ['type', 'status', 'title', 'tags', 'sensitive']) if (k in fm) out[k] = fm[k];
  return out;
}

export function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

function nameKey(rel: string): string {
  return path.posix.basename(rel).toLowerCase();
}

function normalizeTags(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean);
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^#/, ''));
  return [];
}

export function sanitizeFileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  return out;
}

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm'];
export const MEDIA_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

/** audio / video по расширению файла, иначе null. */
export function mediaKind(file: string): 'audio' | 'video' | null {
  const ext = path.posix.extname(file).slice(1).toLowerCase();
  return AUDIO_EXT.includes(ext) ? 'audio' : VIDEO_EXT.includes(ext) ? 'video' : null;
}

async function exists(abs: string): Promise<boolean> {
  return fs
    .stat(abs)
    .then(() => true)
    .catch(() => false);
}
