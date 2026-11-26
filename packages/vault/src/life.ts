/**
 * Предметная модель Frame OS поверх Vault: задачи, проекты, цели, циклы,
 * идеи, ежедневные заметки и календарь. Всё вычисляется из Markdown-файлов.
 */
import { addDays, diffDays, isIsoDate, parseHumanDate } from './dates.ts';
import { getSectionText, setSectionText, appendToSection } from './markdown.ts';
import {
  PRIORITY_RANK,
  buildTaskLine,
  completeTaskLine,
  effectiveDate,
  reopenTaskLine,
  setTaskDueLine,
  setTaskPriorityLine,
  type Priority,
} from './tasks.ts';
import { Vault, VaultError, summarize, type Note, type NoteSummary, type VaultTask } from './vault.ts';

// ---------- Задачи ----------

export type TaskView = 'today' | 'overdue' | 'upcoming' | 'backlog' | 'done' | 'open' | 'all';

export interface TaskDTO extends VaultTask {
  date: string | null;
  noteTitle: string;
  noteType: string;
  /** Проект, к которому относится задача (если удалось определить). */
  project: { path: string; title: string } | null;
}

export class Life {
  constructor(readonly vault: Vault) {}

  get today(): string {
    return this.vault.today();
  }

  private projectOf(note: Note): { path: string; title: string } | null {
    if (note.type === 'project') return { path: note.path, title: note.title };
    const fmProject = note.links.find((l) => l.key === 'project' && l.resolved);
    if (fmProject?.resolved) {
      const p = this.vault.get(fmProject.resolved);
      if (p) return { path: p.path, title: p.title };
    }
    // Заметка внутри папки проекта: Projects/Сайт/Заметка.md → Projects/Сайт/Сайт.md или Projects/Сайт.md
    const f = this.vault.folders.projects;
    if (note.path.startsWith(f + '/')) {
      const seg = note.path.slice(f.length + 1).split('/');
      if (seg.length > 1) {
        const candidates = [`${f}/${seg[0]}/${seg[0]}.md`, `${f}/${seg[0]}.md`, `${f}/${seg[0]}/index.md`];
        for (const c of candidates) {
          const p = this.vault.get(c);
          if (p && p.type === 'project') return { path: p.path, title: p.title };
        }
      }
    }
    return null;
  }

  toDTO(t: VaultTask): TaskDTO {
    const note = this.vault.require(t.path);
    return { ...t, date: effectiveDate(t), noteTitle: note.title, noteType: note.type, project: this.projectOf(note) };
  }

  /** Задачи из архива не показываются в рабочих списках. */
  private activeTasks(): VaultTask[] {
    return this.vault.all().filter((n) => n.para !== 'archive' && n.type !== 'template').flatMap((n) => n.tasks);
  }

  tasks(view: TaskView, opts: { date?: string; projectPath?: string; days?: number } = {}): TaskDTO[] {
    const today = opts.date ?? this.today;
    let list = this.activeTasks();
    const isOpen = (t: VaultTask) => t.status === 'open' || t.status === 'in_progress';
    switch (view) {
      case 'today':
        list = list.filter((t) => isOpen(t) && effectiveDate(t) === today);
        break;
      case 'overdue':
        list = list.filter((t) => isOpen(t) && (effectiveDate(t) ?? '9999') < today);
        break;
      case 'upcoming': {
        const end = addDays(today, opts.days ?? 7);
        list = list.filter((t) => {
          const d = effectiveDate(t);
          return isOpen(t) && d !== null && d > today && d <= end;
        });
        break;
      }
      case 'backlog':
        list = list.filter((t) => isOpen(t) && effectiveDate(t) === null && !t.start);
        break;
      case 'done':
        list = list.filter((t) => t.status === 'done' && t.doneDate === today);
        break;
      case 'open':
        list = list.filter(isOpen);
        break;
      case 'all':
        break;
    }
    let dtos = list.map((t) => this.toDTO(t));
    if (opts.projectPath) dtos = dtos.filter((t) => t.project?.path === opts.projectPath);
    return sortTasks(dtos);
  }

  async createTask(input: {
    text: string;
    due?: string | null;
    priority?: Priority;
    recurrence?: string | null;
    /** Куда записать: ежедневная заметка (по умолчанию) или конкретная заметка. */
    path?: string | null;
    section?: string;
  }): Promise<TaskDTO> {
    let { text, due = null } = input;
    if (due && !isIsoDate(due)) {
      const parsed = parseHumanDate(due, this.today);
      if (!parsed) throw new VaultError(`Не удалось распознать дату «${due}»`, 'invalid');
      due = parsed;
    }
    text = text.trim();
    if (!text) throw new VaultError('Введите текст задачи', 'invalid');
    const line = buildTaskLine({ title: text, due, priority: input.priority, recurrence: input.recurrence });
    let target = input.path ?? null;
    if (!target) target = (await this.vault.ensureDaily(this.today)).path;
    else this.vault.require(target);
    const section = input.section ?? 'Задачи';
    let lineIndex = -1;
    const note = await this.vault.transform(target, (content) => {
      const r = appendToSection(content, section, line);
      lineIndex = r.lineIndex;
      return r.text;
    });
    const task = note.tasks.find((t) => t.line === lineIndex) ?? note.tasks.find((t) => t.raw === line);
    if (!task) throw new VaultError('Задача записана, но не найдена при повторном чтении', 'io');
    return this.toDTO(task);
  }

  async updateTask(input: {
    path: string;
    line: number;
    raw: string;
    action: 'complete' | 'reopen' | 'setDue' | 'setPriority';
    due?: string | null;
    priority?: Priority;
  }): Promise<TaskDTO> {
    const today = this.today;
    let due = input.due ?? null;
    if (input.action === 'setDue' && due && !isIsoDate(due)) {
      const parsed = parseHumanDate(due, today);
      if (!parsed) throw new VaultError(`Не удалось распознать дату «${due}»`, 'invalid');
      due = parsed;
    }
    const { note, line } = await this.vault.editTaskLine(input.path, input.line, input.raw, (raw) => {
      switch (input.action) {
        case 'complete': {
          const r = completeTaskLine(raw, today);
          return r.next ? [r.next, r.line] : r.line;
        }
        case 'reopen':
          return reopenTaskLine(raw);
        case 'setDue':
          return setTaskDueLine(raw, due);
        case 'setPriority':
          return setTaskPriorityLine(raw, input.priority ?? 'none');
      }
    });
    const task = note.tasks.find((t) => t.line === line);
    if (!task) throw new VaultError('Задача не найдена после изменения', 'io');
    return this.toDTO(task);
  }

  // ---------- Проекты ----------

  projects(): ProjectDTO[] {
    return this.vault
      .byType('project')
      .map((n) => this.project(n))
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title));
  }

  project(n: Note): ProjectDTO {
    const tasks = this.tasks('all', { projectPath: n.path });
    const countable = tasks.filter((t) => t.status !== 'cancelled');
    const done = countable.filter((t) => t.status === 'done').length;
    const open = countable.filter((t) => t.status === 'open' || t.status === 'in_progress');
    const fm = n.frontmatter;
    const goalLink = n.links.find((l) => l.key === 'goal' && l.resolved);
    const goal = goalLink?.resolved ? this.vault.get(goalLink.resolved) : undefined;
    const next = typeof fm.next === 'string' && fm.next.trim() ? fm.next.trim() : (open[0]?.title ?? null);
    const status = n.para === 'archive' ? 'archived' : str(fm.status) ?? 'active';
    const deadline = isIsoDate(fm.deadline) ? fm.deadline : isIsoDate(fm.due) ? fm.due : null;
    return {
      path: n.path,
      title: n.title,
      status,
      area: str(fm.area)?.replace(/^\[\[|\]\]$/g, '') ?? null,
      deadline,
      daysLeft: deadline ? diffDays(this.today, deadline) : null,
      budget: num(fm.budget),
      spent: num(fm.spent),
      goal: goal ? { path: goal.path, title: goal.title } : null,
      tasksTotal: countable.length,
      tasksDone: done,
      tasksOverdue: open.filter((t) => t.date !== null && t.date < this.today).length,
      progress: num(fm.progress) ?? (countable.length ? Math.round((done / countable.length) * 100) : 0),
      nextStep: next,
      tags: n.tags,
      mtimeMs: n.mtimeMs,
    };
  }

  projectDetail(rel: string) {
    const n = this.vault.require(rel);
    if (n.type !== 'project') throw new VaultError('Это не заметка проекта', 'invalid');
    const related = this.related(n);
    return {
      ...this.project(n),
      frontmatter: n.frontmatter,
      tasks: this.tasks('all', { projectPath: n.path }),
      related,
      stages: getSectionText(n.body, ['Этапы', 'Stages', 'Milestones']),
    };
  }

  /** Связанные заметки: исходящие ссылки и обратные ссылки, сгруппированные по типу. */
  related(n: Note): Array<NoteSummary & { direction: 'out' | 'in' | 'both' }> {
    const out = new Set(n.links.map((l) => l.resolved).filter((p): p is string => !!p && p !== n.path));
    const inn = new Set(this.vault.backlinks(n.path));
    const all = new Set([...out, ...inn]);
    return [...all]
      .flatMap((p) => {
        const note = this.vault.get(p);
        if (!note) return [];
        const direction: 'out' | 'in' | 'both' = out.has(p) && inn.has(p) ? 'both' : out.has(p) ? 'out' : 'in';
        return [{ ...summarize(note), direction }];
      })
      .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  }

  async createProject(input: { title: string; goal?: string | null; deadline?: string | null; area?: string | null; budget?: number | null; description?: string }): Promise<Note> {
    const fm: Record<string, unknown> = { type: 'project', status: 'active', created: this.today };
    if (input.goal) fm.goal = this.vault.linkTo(this.vault.require(input.goal).path);
    if (input.deadline) {
      if (!isIsoDate(input.deadline)) throw new VaultError('Срок должен быть в формате ГГГГ-ММ-ДД', 'invalid');
      fm.deadline = input.deadline;
    }
    if (input.area) fm.area = input.area;
    if (typeof input.budget === 'number' && Number.isFinite(input.budget)) fm.budget = input.budget;
    const body = `# ${input.title.trim()}\n\n${input.description?.trim() ? input.description.trim() + '\n\n' : ''}## Этапы\n\n## Задачи\n\n## Заметки\n`;
    return this.vault.createNote({ folder: this.vault.folders.projects, title: input.title, frontmatter: fm, body });
  }

  // ---------- Цели и 12-недельные циклы ----------

  goals(): GoalDTO[] {
    const projects = this.projects();
    return this.vault
      .byType('goal')
      .map((g) => {
        const linked = projects.filter((p) => p.goal?.path === g.path);
        const fm = g.frontmatter;
        const auto = linked.length ? Math.round(linked.reduce((s, p) => s + p.progress, 0) / linked.length) : 0;
        const cycleLink = g.links.find((l) => l.key === 'cycle' && l.resolved);
        return {
          path: g.path,
          title: g.title,
          status: g.para === 'archive' ? 'archived' : str(fm.status) ?? 'active',
          area: str(fm.area)?.replace(/^\[\[|\]\]$/g, '') ?? null,
          horizon: str(fm.horizon),
          deadline: isIsoDate(fm.deadline) ? fm.deadline : null,
          metric: str(fm.metric),
          progress: num(fm.progress) ?? auto,
          progressSource: num(fm.progress) !== null ? ('manual' as const) : ('projects' as const),
          cycle: cycleLink?.resolved ? cycleLink.resolved : null,
          projects: linked.map((p) => ({ path: p.path, title: p.title, progress: p.progress, status: p.status })),
          why: getSectionText(g.body, ['Зачем', 'Почему', 'Why']),
        };
      })
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title));
  }

  async createGoal(input: { title: string; horizon?: string | null; deadline?: string | null; area?: string | null; metric?: string | null; cycle?: string | null; why?: string }): Promise<Note> {
    const fm: Record<string, unknown> = { type: 'goal', status: 'active', created: this.today };
    if (input.horizon) fm.horizon = input.horizon;
    if (input.deadline) {
      if (!isIsoDate(input.deadline)) throw new VaultError('Срок должен быть в формате ГГГГ-ММ-ДД', 'invalid');
      fm.deadline = input.deadline;
    }
    if (input.area) fm.area = input.area;
    if (input.metric) fm.metric = input.metric;
    if (input.cycle) fm.cycle = this.vault.linkTo(this.vault.require(input.cycle).path);
    const body = `# ${input.title.trim()}\n\n## Зачем\n${input.why?.trim() ?? ''}\n\n## Ключевые результаты\n\n## Рефлексия\n`;
    return this.vault.createNote({ folder: this.vault.folders.goals, title: input.title, frontmatter: fm, body });
  }

  cycles(): CycleDTO[] {
    const goals = this.goals();
    return this.vault
      .byType('cycle')
      .flatMap((c) => {
        const start = c.frontmatter.start;
        if (!isIsoDate(start)) return [];
        const weeks = num(c.frontmatter.weeks) ?? 12;
        const end = isIsoDate(c.frontmatter.end) ? c.frontmatter.end : addDays(start, weeks * 7 - 1);
        const elapsed = diffDays(start, this.today);
        const week = elapsed < 0 ? 0 : Math.min(weeks, Math.floor(elapsed / 7) + 1);
        const linkedGoals = goals.filter(
          (g) => g.cycle === c.path || c.links.some((l) => l.key === 'goals' && l.resolved === g.path),
        );
        const phases = parsePhases(c.frontmatter.phases, start, weeks);
        return [
          {
            path: c.path,
            title: c.title,
            start,
            end,
            weeks,
            week,
            state: this.today < start ? ('planned' as const) : this.today > end ? ('finished' as const) : ('current' as const),
            timeProgress: Math.max(0, Math.min(100, Math.round(((elapsed + 1) / (weeks * 7)) * 100))),
            goals: linkedGoals.map((g) => ({ path: g.path, title: g.title, progress: g.progress })),
            phases,
            focus: str(c.frontmatter.focus),
          },
        ];
      })
      .sort((a, b) => b.start.localeCompare(a.start));
  }

  async createCycle(input: { title: string; start: string; focus?: string | null }): Promise<Note> {
    if (!isIsoDate(input.start)) throw new VaultError('Дата начала должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    const fm: Record<string, unknown> = { type: 'cycle', start: input.start, weeks: 12 };
    if (input.focus) fm.focus = input.focus;
    const weeks = Array.from({ length: 12 }, (_, i) => `### Неделя ${i + 1} (${addDays(input.start, i * 7)})\n`).join('\n');
    const body = `# ${input.title.trim()}\n\n## Цели цикла\n\n## Недели\n\n${weeks}\n## Итоги цикла\n`;
    return this.vault.createNote({ folder: this.vault.folders.cycles, title: input.title, frontmatter: fm, body });
  }

  // ---------- Идеи ----------

  ideas(): IdeaDTO[] {
    return this.vault
      .byType('idea')
      .map((n) => {
        const fm = n.frontmatter;
        const convertedLink = n.links.find((l) => l.key === 'converted_to' && l.resolved);
        return {
          path: n.path,
          title: n.title,
          status: n.para === 'archive' ? 'archived' : str(fm.status) ?? 'new',
          created: isIsoDate(fm.created) ? fm.created : new Date(n.mtimeMs).toISOString().slice(0, 10),
          area: str(fm.area),
          tags: n.tags,
          excerpt: n.sensitive ? '' : n.body.replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 220),
          convertedTo: convertedLink?.resolved ?? null,
          mtimeMs: n.mtimeMs,
        };
      })
      .sort((a, b) => b.created.localeCompare(a.created) || b.mtimeMs - a.mtimeMs);
  }

  async createIdea(input: { title: string; text?: string; tags?: string[] }): Promise<Note> {
    const title = input.title.trim();
    if (!title) throw new VaultError('Введите текст идеи', 'invalid');
    const fm: Record<string, unknown> = { type: 'idea', status: 'new', created: this.today };
    if (input.tags?.length) fm.tags = input.tags;
    const body = `# ${title}\n\n${input.text?.trim() ?? ''}\n`;
    return this.vault.createNote({ folder: this.vault.folders.ideas, title, frontmatter: fm, body });
  }

  /** Превращает идею в проект, задачу или гипотезу. Исходная заметка не удаляется. */
  async convertIdea(rel: string, to: 'project' | 'task' | 'hypothesis', opts: { due?: string | null } = {}) {
    const idea = this.vault.require(rel);
    if (idea.type !== 'idea') throw new VaultError('Это не заметка-идея', 'invalid');
    if (to === 'hypothesis') {
      await this.vault.updateProperties(rel, { status: 'hypothesis' });
      return { idea: rel, created: null };
    }
    if (to === 'project') {
      const project = await this.createProject({
        title: idea.title,
        description: `Из идеи ${this.vault.linkTo(rel)}`,
      });
      await this.vault.updateProperties(rel, { status: 'converted', converted_to: this.vault.linkTo(project.path) });
      return { idea: rel, created: project.path };
    }
    const task = await this.createTask({ text: `${idea.title} ${this.vault.linkTo(rel)}`, due: opts.due ?? null });
    await this.vault.updateProperties(rel, { status: 'converted', converted_to: this.vault.linkTo(task.path) });
    return { idea: rel, created: task.path };
  }

  // ---------- День ----------

  async day(date: string) {
    if (!isIsoDate(date)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    const rel = this.vault.dailyPath(date);
    const note = this.vault.get(rel) ?? null;
    const all = this.activeTasks().map((t) => this.toDTO(t));
    const isOpen = (t: TaskDTO) => t.status === 'open' || t.status === 'in_progress';
    const planned = sortTasks(all.filter((t) => t.date === date && isOpen(t)));
    const doneOnDay = all.filter((t) => t.status === 'done' && t.doneDate === date);
    const overdue = date === this.today ? sortTasks(all.filter((t) => isOpen(t) && t.date !== null && t.date < date)) : [];
    const fromDaily = note ? note.tasks.map((t) => this.toDTO(t)) : [];
    return {
      date,
      isToday: date === this.today,
      note: note ? { path: note.path, hash: note.hash, mtimeMs: note.mtimeMs } : null,
      notePath: rel,
      priorities: note ? getSectionText(note.body, ['Приоритеты', 'Priorities', 'Фокус']) ?? '' : '',
      review: note ? getSectionText(note.body, ['Итог дня', 'Вечерний итог', 'Review']) ?? '' : '',
      notes: note ? getSectionText(note.body, ['Заметки', 'Notes']) ?? '' : '',
      mood: note ? num(note.frontmatter.mood) : null,
      energy: note ? num(note.frontmatter.energy) : null,
      planned,
      overdue,
      done: doneOnDay,
      dailyTasks: fromDaily.filter((t) => !planned.some((p) => p.id === t.id) && !doneOnDay.some((d) => d.id === t.id)),
      events: this.calendar(date, date).flatMap((d) => d.items.filter((i) => i.kind !== 'task')),
    };
  }

  async saveDaySection(date: string, section: 'priorities' | 'review' | 'notes', content: string) {
    const headings = { priorities: 'Приоритеты', review: 'Итог дня', notes: 'Заметки' } as const;
    const note = await this.vault.ensureDaily(date);
    const aliases: Record<string, string[]> = {
      priorities: ['Приоритеты', 'Priorities', 'Фокус'],
      review: ['Итог дня', 'Вечерний итог', 'Review'],
      notes: ['Заметки', 'Notes'],
    };
    await this.vault.transform(note.path, (text) => {
      // Используем существующий заголовок, если в шаблоне он назван иначе.
      const existing = aliases[section]!.find((h) => getSectionText(text, h) !== null) ?? headings[section];
      return setSectionText(text, existing, content);
    });
    return this.day(date);
  }

  async saveDayMetrics(date: string, metrics: { mood?: number | null; energy?: number | null }) {
    const note = await this.vault.ensureDaily(date);
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of ['mood', 'energy'] as const) {
      const v = metrics[k];
      if (v === undefined) continue;
      if (v === null) unset.push(k);
      else if (Number.isInteger(v) && v >= 1 && v <= 5) set[k] = v;
      else throw new VaultError('Оценка должна быть от 1 до 5', 'invalid');
    }
    await this.vault.updateProperties(note.path, set, unset);
    return this.day(date);
  }

  // ---------- Календарь ----------

  /**
   * Элементы календаря за период: задачи со сроком, заметки с датой (события,
   * платежи, тренировки…), дедлайны проектов и целей, ежедневные заметки.
   */
  calendar(from: string, to: string): CalendarDay[] {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new VaultError('Неверный период', 'invalid');
    if (diffDays(from, to) > 400) throw new VaultError('Слишком длинный период', 'invalid');
    const map = new Map<string, CalendarItem[]>();
    const push = (date: string, item: CalendarItem) => {
      if (date < from || date > to) return;
      const arr = map.get(date) ?? [];
      arr.push(item);
      map.set(date, arr);
    };
    for (const t of this.activeTasks()) {
      const d = effectiveDate(t);
      if (!d || t.status === 'cancelled') continue;
      push(d, { kind: 'task', title: t.title, path: t.path, done: t.status === 'done', priority: t.priority, line: t.line, raw: t.raw });
    }
    for (const n of this.vault.all()) {
      if (n.para === 'archive') continue;
      const fm = n.frontmatter;
      if (n.type === 'project' || n.type === 'goal') {
        const dl = isIsoDate(fm.deadline) ? fm.deadline : null;
        if (dl) push(dl, { kind: 'deadline', title: `Срок: ${n.title}`, path: n.path, noteType: n.type });
        continue;
      }
      if (n.type === 'daily') continue;
      if (isIsoDate(fm.date)) {
        push(fm.date, {
          kind: 'event',
          title: n.title,
          path: n.path,
          noteType: n.type,
          time: str(fm.time),
          amount: num(fm.amount),
        });
      }
    }
    const days: CalendarDay[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const items = map.get(d) ?? [];
      days.push({ date: d, items, hasDaily: !!this.vault.get(this.vault.dailyPath(d)) });
    }
    return days;
  }

  // ---------- Главная ----------

  dashboard() {
    const today = this.today;
    const todayTasks = this.tasks('today');
    const overdue = this.tasks('overdue');
    const upcomingDays = this.calendar(addDays(today, 1), addDays(today, 14));
    const events = upcomingDays.flatMap((d) => d.items.filter((i) => i.kind !== 'task').map((i) => ({ ...i, date: d.date })));
    const todayEvents = this.calendar(today, today)[0]!.items.filter((i) => i.kind !== 'task');
    const projects = this.projects().filter((p) => p.status === 'active');
    const cycles = this.cycles();
    const current = cycles.find((c) => c.state === 'current') ?? null;
    const dailyPath = this.vault.dailyPath(today);
    const daily = this.vault.get(dailyPath);
    return {
      today,
      todayTasks,
      overdue,
      doneToday: this.tasks('done'),
      upcomingTasks: this.tasks('upcoming', { days: 7 }),
      todayEvents,
      events,
      projects: projects.slice(0, 6),
      projectsTotal: projects.length,
      cycle: current,
      backlogCount: this.tasks('backlog').length,
      ideasNew: this.ideas().filter((i) => i.status === 'new').length,
      priorities: daily ? getSectionText(daily.body, ['Приоритеты', 'Priorities', 'Фокус']) ?? '' : '',
      dailyPath: daily ? daily.path : null,
    };
  }

  /** Быстрый ввод: «задача …», «идея: …», «заметка: …» — или явный тип. */
  async quickAdd(input: { kind: 'task' | 'idea' | 'note'; text: string; due?: string | null; priority?: Priority }) {
    const text = input.text.trim();
    if (!text) throw new VaultError('Пустой ввод', 'invalid');
    if (input.kind === 'idea') {
      const n = await this.createIdea({ title: firstLine(text), text: rest(text) });
      return { kind: 'idea' as const, path: n.path, title: n.title };
    }
    if (input.kind === 'note') {
      const n = await this.vault.createNote({
        folder: this.vault.folders.inbox,
        title: firstLine(text),
        frontmatter: { created: this.today },
        body: `# ${firstLine(text)}\n\n${rest(text)}\n`,
      });
      return { kind: 'note' as const, path: n.path, title: n.title };
    }
    // Задача: поддержка «… завтра», «… !1» в конце строки.
    let title = text;
    let due = input.due ?? null;
    let priority = input.priority;
    const prio = /\s!(1|2|3)$/.exec(title);
    if (prio) {
      priority = prio[1] === '1' ? 'high' : prio[1] === '2' ? 'medium' : 'low';
      title = title.slice(0, prio.index);
    }
    if (!due) {
      const m = /\s(сегодня|завтра|послезавтра|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}(?:\.\d{4})?)$/i.exec(title);
      if (m) {
        due = parseHumanDate(m[1]!, this.today);
        if (due) title = title.slice(0, m.index);
      }
    }
    const t = await this.createTask({ text: title, due, priority });
    return { kind: 'task' as const, path: t.path, title: t.title, due: t.due };
  }
}

// ---------- Типы ----------

export interface ProjectDTO {
  path: string;
  title: string;
  status: string;
  area: string | null;
  deadline: string | null;
  daysLeft: number | null;
  budget: number | null;
  spent: number | null;
  goal: { path: string; title: string } | null;
  tasksTotal: number;
  tasksDone: number;
  tasksOverdue: number;
  progress: number;
  nextStep: string | null;
  tags: string[];
  mtimeMs: number;
}

export interface GoalDTO {
  path: string;
  title: string;
  status: string;
  area: string | null;
  horizon: string | null;
  deadline: string | null;
  metric: string | null;
  progress: number;
  progressSource: 'manual' | 'projects';
  cycle: string | null;
  projects: Array<{ path: string; title: string; progress: number; status: string }>;
  why: string | null;
}

export interface CyclePhase {
  name: string;
  fromWeek: number;
  toWeek: number;
}

export interface CycleDTO {
  path: string;
  title: string;
  start: string;
  end: string;
  weeks: number;
  week: number;
  state: 'planned' | 'current' | 'finished';
  timeProgress: number;
  goals: Array<{ path: string; title: string; progress: number }>;
  phases: CyclePhase[];
  focus: string | null;
}

export interface IdeaDTO {
  path: string;
  title: string;
  status: string;
  created: string;
  area: string | null;
  tags: string[];
  excerpt: string;
  convertedTo: string | null;
  mtimeMs: number;
}

export type CalendarItem =
  | { kind: 'task'; title: string; path: string; done: boolean; priority: Priority; line: number; raw: string }
  | { kind: 'deadline'; title: string; path: string; noteType: string }
  | { kind: 'event'; title: string; path: string; noteType: string; time: string | null; amount: number | null };

export interface CalendarDay {
  date: string;
  items: CalendarItem[];
  hasDaily: boolean;
}

// ---------- Вспомогательное ----------

export function sortTasks<T extends { date: string | null; priority: Priority; path: string; line: number }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
}

function statusRank(s: string): number {
  const order = ['active', 'in_progress', 'planned', 'paused', 'done', 'completed', 'archived'];
  const i = order.indexOf(s);
  return i === -1 ? 3 : i;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.').replace(/\s/g, '')))) {
    return Number(v.replace(',', '.').replace(/\s/g, ''));
  }
  return null;
}

function firstLine(text: string): string {
  return text.split('\n')[0]!.trim().slice(0, 120);
}

function rest(text: string): string {
  return text.split('\n').slice(1).join('\n').trim();
}

function parsePhases(v: unknown, _start: string, weeks: number): CyclePhase[] {
  if (Array.isArray(v)) {
    const out: CyclePhase[] = [];
    for (const p of v) {
      if (p && typeof p === 'object') {
        const o = p as Record<string, unknown>;
        const name = str(o.name);
        const weeksStr = str(o.weeks);
        const m = weeksStr ? /^(\d+)\s*-\s*(\d+)$/.exec(weeksStr) : null;
        if (name && m) out.push({ name, fromWeek: Number(m[1]), toWeek: Number(m[2]) });
      }
    }
    if (out.length) return out;
  }
  const q = Math.max(1, Math.round(weeks / 4));
  return [
    { name: 'Планирование', fromWeek: 1, toWeek: Math.min(weeks, q) },
    { name: 'Действие', fromWeek: q + 1, toWeek: Math.min(weeks, 2 * q) },
    { name: 'Развитие', fromWeek: 2 * q + 1, toWeek: Math.min(weeks, 3 * q) },
    { name: 'Оптимизация', fromWeek: 3 * q + 1, toWeek: weeks },
  ];
}

