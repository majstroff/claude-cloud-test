/**
 * Помощник «Лёгкость ОС»: план дня, приоритеты, разбор просрочек, задачи из
 * заметок, помощь с поиском работы, связанные записи и следующий шаг.
 *
 * Работает по понятным правилам на этом компьютере, без внешних сервисов и
 * без платных моделей. Помощник только предлагает: каждое изменение (срок,
 * новая задача, приоритеты дня) выполняет интерфейс по нажатию человека через
 * обычные методы API.
 *
 * Точка расширения: если когда-нибудь понадобится внешняя модель, её нужно
 * подключать как ещё один `AssistantEngine` и передавать ей только записи,
 * для которых `aiAccess(note).allowed === true`. Сейчас подключён только
 * локальный движок.
 */
import { addDays, diffDays, isIsoDate, parseHumanDate, startOfWeek } from './dates.ts';
import { getSectionText } from './markdown.ts';
import { PRIORITY_RANK, TASK_LINE } from './tasks.ts';
import { tokenize } from './search.ts';
import { summarize, VaultError, type Note, type NoteSummary } from './vault.ts';
import { aiAccess, type Crm } from './crm.ts';
import type { Life, TaskDTO } from './life.ts';
import type { Spheres } from './spheres.ts';
import { plural } from './journal.ts';

export interface AssistantEngine {
  id: string;
  name: string;
  /** Отправляет ли движок данные за пределы компьютера. */
  external: boolean;
  /** Платный ли он. */
  paid: boolean;
}

export const LOCAL_ENGINE: AssistantEngine = { id: 'local', name: 'Локальные правила', external: false, paid: false };

/** Действие, которое человек может подтвердить. Выполняет его интерфейс. */
export type AssistantAction =
  | { kind: 'set_due'; label: string; path: string; line: number; raw: string; due: string | null }
  | { kind: 'create_task'; label: string; text: string; due: string | null; path: string | null; section?: string }
  | { kind: 'write_priorities'; label: string; date: string; text: string }
  | { kind: 'open'; label: string; href: string };

export interface ScoredTask {
  task: TaskDTO;
  score: number;
  reasons: string[];
  actions: AssistantAction[];
}

export interface Advice {
  tone: 'good' | 'warn' | 'info';
  title: string;
  reason: string;
  ref?: { path: string; title: string; href?: string };
  actions: AssistantAction[];
}

const PRIORITY_POINTS: Record<string, number> = { highest: 8, high: 6, medium: 3, none: 1, low: 0, lowest: -1 };
const PRIORITY_WORD: Record<string, string> = { highest: 'наивысший приоритет', high: 'высокий приоритет', medium: 'средний приоритет' };

/** Слова, с которых обычно начинается дело. */
const ACTION_VERBS = [
  'сделать', 'написать', 'позвонить', 'отправить', 'купить', 'подготовить', 'проверить', 'договориться', 'найти', 'записаться',
  'оплатить', 'обновить', 'прочитать', 'узнать', 'спросить', 'забронировать', 'заказать', 'связаться', 'назначить', 'сходить',
  'починить', 'продлить', 'отменить', 'подать', 'собрать', 'составить', 'оформить', 'посмотреть', 'разобрать', 'выбрать',
  'созвониться', 'ответить', 'запланировать', 'перенести', 'добавить', 'убрать', 'поменять', 'заменить', 'обсудить', 'попросить',
  'изучить', 'пройти', 'сдать', 'получить', 'забрать', 'вернуть', 'настроить', 'установить', 'зарегистрироваться',
];
const MARKERS = /^(?:todo|to do|надо|нужно|необходимо|не забыть|не забудь|важно|сделать)\s*[:\-—–]?\s*/i;

export class Assistant {
  readonly engine = LOCAL_ENGINE;

  constructor(
    readonly life: Life,
    readonly spheres: Spheres,
    readonly crm: Crm,
  ) {}

  get vault() {
    return this.life.vault;
  }

  get today(): string {
    return this.life.today;
  }

  info() {
    return {
      engine: this.engine,
      engines: [this.engine],
      note: 'Подсказки считаются на этом компьютере по вашим заметкам. Платный ИИ не подключён, данные никуда не отправляются.',
    };
  }

  // ---------- Оценка задач ----------

  private context() {
    const today = this.today;
    const cycle = this.life.cycles().find((c) => c.state === 'current') ?? null;
    const cycleGoals = new Set(cycle?.goals.map((g) => g.path) ?? []);
    const projects = new Map(this.life.projects().map((p) => [p.path, p]));
    return { today, cycle, cycleGoals, projects };
  }

  score(t: TaskDTO, ctx = this.context()): ScoredTask {
    const reasons: string[] = [];
    let score = PRIORITY_POINTS[t.priority] ?? 1;
    if (PRIORITY_WORD[t.priority]) reasons.push(PRIORITY_WORD[t.priority]!);
    if (t.date) {
      const d = diffDays(ctx.today, t.date);
      if (d < 0) {
        score += 4 + Math.min(-d, 14) / 2;
        reasons.push(`просрочена на ${-d} дн.`);
      } else if (d === 0) {
        score += 5;
        reasons.push('срок сегодня');
      } else if (d <= 2) {
        score += 2;
        reasons.push(d === 1 ? 'срок завтра' : 'срок послезавтра');
      }
    }
    const p = t.project ? ctx.projects.get(t.project.path) : undefined;
    if (p) {
      if (p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 14) {
        score += p.daysLeft <= 7 ? 3 : 1.5;
        reasons.push(`дедлайн проекта «${p.title}» через ${p.daysLeft} дн.`);
      }
      if (p.goal && ctx.cycleGoals.has(p.goal.path)) {
        score += 2.5;
        reasons.push(`цель текущего цикла: «${p.goal.title}»`);
      }
      if (p.nextStep && p.nextStep === t.title) {
        score += 1;
        reasons.push('следующий шаг проекта');
      }
    }
    if (t.noteType === 'vacancy') {
      score += 1.5;
      reasons.push('поиск работы');
    }
    if (t.status === 'in_progress') {
      score += 1;
      reasons.push('уже в работе');
    }
    return { task: t, score: Math.round(score * 10) / 10, reasons, actions: [] };
  }

  private candidates(date: string): TaskDTO[] {
    const horizon = addDays(date, 3);
    const open = this.life.tasks('open');
    return open.filter((t) => (t.date !== null && t.date <= horizon) || (t.date === null && PRIORITY_RANK[t.priority] <= PRIORITY_RANK.high && !t.todoistId));
  }

  /** Самые важные дела на ближайшие дни с объяснением, почему они важны. */
  priorities(limit = 7): ScoredTask[] {
    const ctx = this.context();
    return this.candidates(ctx.today)
      .map((t) => this.score(t, ctx))
      .sort((a, b) => b.score - a.score || (a.task.date ?? '9999').localeCompare(b.task.date ?? '9999'))
      .slice(0, Math.max(1, Math.min(limit, 30)))
      .map((s) => ({ ...s, actions: s.task.date !== ctx.today ? [setDue(s.task, ctx.today, 'Сделать сегодня')] : [] }));
  }

  // ---------- План дня ----------

  async planDay(date = this.today) {
    if (!isIsoDate(date)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    if (date < this.today) throw new VaultError('План можно составить на сегодня или на будущий день', 'invalid');
    const ctx = this.context();
    const day = await this.life.day(date);
    const sph = this.spheres.day(date);
    const fixed: Array<{ title: string; time: string | null; kind: string; path: string | null }> = [
      ...day.events.filter((e) => !(e.kind === 'event' && ['workout', 'payment', 'subscription', 'debt', 'important_date', 'birthday'].includes(e.noteType))).map((e) => ({ title: e.title, time: e.kind === 'event' ? e.time : null, kind: e.kind === 'deadline' ? 'Срок' : 'Событие', path: e.path })),
      ...sph.workouts.map((w) => ({ title: w.title, time: w.time, kind: 'Тренировка', path: w.path })),
      ...sph.obligations.map((o) => ({ title: o.title, time: null, kind: o.overdue ? 'Платёж просрочен' : 'Платёж', path: o.path })),
      ...sph.routines.map((r) => ({ title: r.title, time: null, kind: 'Регулярное', path: r.path })),
      ...sph.occasions.map((o) => ({ title: o.title, time: null, kind: 'Важная дата', path: o.path })),
    ]
      .filter((x, i, arr) => !x.path || arr.findIndex((y) => y.path === x.path) === i)
      .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));

    const pool = this.candidates(date)
      .filter((t) => t.date === null || t.date <= date || PRIORITY_RANK[t.priority] <= PRIORITY_RANK.high)
      .map((t) => this.score(t, { ...ctx, today: date }))
      .sort((a, b) => b.score - a.score);
    // Чем больше обязательных дел, тем меньше задач стоит брать в фокус.
    const capacity = Math.max(3, 8 - Math.floor(fixed.length / 2));
    const focus = pool.slice(0, 3).map((s) => withPlanActions(s, date));
    const more = pool.slice(3, capacity).map((s) => withPlanActions(s, date));
    const dueToday = pool.filter((s) => s.task.date !== null && s.task.date <= date);
    const overload = dueToday.length > capacity
      ? dueToday.slice(capacity).map((s) => ({ ...s, actions: [setDue(s.task, nextWorkday(date), 'Перенести на следующий рабочий день'), setDue(s.task, null, 'Убрать срок (в бэклог)')] }))
      : [];
    const prioritiesText = focus.map((s, i) => `${i + 1}. ${s.task.title}`).join('\n');
    const warnings: string[] = [];
    if (overload.length) warnings.push(`На день больше дел, чем помещается: ${dueToday.length}. Предлагаю перенести ${overload.length}.`);
    if (day.overdue.length >= 5) warnings.push(`Просроченных задач: ${day.overdue.length}. Посмотрите раздел «Просрочки».`);
    if (!focus.length) warnings.push('Нет задач со сроком и важных задач без срока. Добавьте задачи или посмотрите бэклог.');
    return {
      date,
      currentPriorities: day.priorities,
      fixed,
      focus,
      more,
      overload,
      warnings,
      prioritiesText,
      actions: prioritiesText ? [{ kind: 'write_priorities', label: day.priorities ? 'Заменить приоритеты дня' : 'Записать приоритеты дня', date, text: prioritiesText } as AssistantAction] : [],
    };
  }

  // ---------- Просрочки ----------

  overdue() {
    const today = this.today;
    const list = this.life.tasks('overdue');
    const groups = [
      { id: 'fresh', title: '1–3 дня', hint: 'Скорее всего, ещё актуально — перенесите на сегодня или завтра.', items: [] as ScoredTask[] },
      { id: 'week', title: '4–14 дней', hint: 'Решите: сделать на этой неделе или убрать срок.', items: [] as ScoredTask[] },
      { id: 'old', title: 'Больше двух недель', hint: 'Срок, похоже, был нереальным. Уберите его или закройте задачу в Obsidian.', items: [] as ScoredTask[] },
    ];
    const ctx = this.context();
    for (const t of list) {
      const age = diffDays(t.date!, today);
      const s = this.score(t, ctx);
      if (age <= 3) groups[0]!.items.push({ ...s, actions: [setDue(t, today, 'На сегодня'), setDue(t, addDays(today, 1), 'На завтра')] });
      else if (age <= 14) groups[1]!.items.push({ ...s, actions: [setDue(t, addDays(today, 1), 'На завтра'), setDue(t, nextMonday(today), 'На понедельник'), setDue(t, null, 'Убрать срок')] });
      else groups[2]!.items.push({ ...s, actions: [setDue(t, null, 'Убрать срок (в бэклог)'), setDue(t, nextMonday(today), 'На понедельник')] });
    }
    for (const g of groups) g.items.sort((a, b) => b.score - a.score);
    const byProject = new Map<string, { title: string; path: string; count: number }>();
    for (const t of list) {
      const key = t.project?.path ?? t.path;
      const e = byProject.get(key) ?? { title: t.project?.title ?? t.noteTitle, path: key, count: 0 };
      e.count++;
      byProject.set(key, e);
    }
    const hotspots = [...byProject.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count);
    const summary: string[] = [];
    if (!list.length) summary.push('Просроченных задач нет.');
    else {
      summary.push(`Просрочено ${list.length} ${plural(list.length, 'задача', 'задачи', 'задач')}, самая старая — ${diffDays(list.reduce((m, t) => (t.date! < m ? t.date! : m), today), today)} дн.`);
      if (hotspots[0]) summary.push(`Больше всего просрочек в «${hotspots[0].title}» (${hotspots[0].count}). Возможно, там слишком много дел сразу.`);
      if (list.length > 10) summary.push('Не переносите всё разом: выберите 3 задачи на сегодня, остальным уберите срок.');
    }
    return { total: list.length, groups: groups.filter((g) => g.items.length), hotspots, summary };
  }

  // ---------- Заметка → задачи ----------

  private allowedNote(rel: string): Note {
    const n = this.vault.require(rel);
    const access = aiAccess(n);
    if (!access.allowed) throw new VaultError(`Помощник не читает эту заметку: ${access.reason}`, 'forbidden');
    return n;
  }

  /** Находит в тексте заметки строки, похожие на дела. Ничего не записывает. */
  noteTasks(rel: string) {
    const n = this.allowedNote(rel);
    const existing = new Set(n.tasks.map((t) => normalizeText(t.title)));
    const lines = n.body.split('\n');
    const out: Array<{ line: number; source: string; text: string; due: string | null }> = [];
    let inCode = false;
    lines.forEach((raw, i) => {
      if (/^\s*(```|~~~)/.test(raw)) inCode = !inCode;
      if (inCode || TASK_LINE.test(raw) || /^\s*#/.test(raw) || /^\s*>/.test(raw) || /^\s*\|/.test(raw)) return;
      const c = candidateFromLine(raw, this.today);
      if (!c || existing.has(normalizeText(c.text)) || out.some((o) => normalizeText(o.text) === normalizeText(c.text))) return;
      out.push({ line: n.bodyLine + i, source: raw.trim(), ...c });
    });
    return {
      path: n.path,
      title: n.title,
      candidates: out.slice(0, 50),
      actions: out.slice(0, 50).map((c) => ({ kind: 'create_task', label: 'Создать задачу', text: `${c.text} ${this.vault.linkTo(n.path)}`, due: c.due, path: null } as AssistantAction)),
    };
  }

  // ---------- Поиск работы ----------

  jobSearch() {
    const today = this.today;
    const vacancies = this.crm.vacancies();
    const active = vacancies.filter((v) => !['rejected', 'archived'].includes(v.status));
    const funnel: Record<string, number> = {};
    for (const v of vacancies) funnel[v.status] = (funnel[v.status] ?? 0) + 1;
    const advice: Advice[] = [];
    const ref = (v: (typeof vacancies)[number]) => ({ path: v.path, title: v.title, href: `/work/view?path=${encodeURIComponent(v.path)}` });
    for (const v of active) {
      if (v.interview && v.interview >= today && diffDays(today, v.interview) <= 7) {
        const prepDue = addDays(v.interview, -1) < today ? today : addDays(v.interview, -1);
        advice.push({
          tone: 'warn',
          title: `Собеседование ${v.interview === today ? 'сегодня' : `через ${diffDays(today, v.interview)} дн.`}: ${v.title}`,
          reason: 'Повторите кейсы, вопросы о компании и свои вопросы к ним.',
          ref: ref(v),
          actions: [{ kind: 'create_task', label: 'Задача: подготовиться', text: `Подготовиться к собеседованию ${this.vault.linkTo(v.path)}`, due: prepDue, path: v.path }],
        });
      }
      if (v.testDue && v.testDue >= today && diffDays(today, v.testDue) <= 5) {
        advice.push({ tone: 'warn', title: `Тестовое до ${v.testDue}: ${v.title}`, reason: 'Срок близко, заложите время в план дня.', ref: ref(v), actions: [] });
      }
      if (v.nextDate && v.nextDate < today) {
        advice.push({ tone: 'warn', title: `Просрочен следующий шаг: ${v.title}`, reason: v.nextStep ? `Было запланировано: ${v.nextStep}` : 'Обновите следующий шаг или статус.', ref: ref(v), actions: [] });
      }
      if (v.status === 'applied' && v.applied && diffDays(v.applied, today) >= 7 && !v.nextDate) {
        advice.push({
          tone: 'info',
          title: `Нет ответа ${diffDays(v.applied, today)} дн.: ${v.title}`,
          reason: v.recruiter ? `Напомните о себе: ${v.recruiter.title}.` : 'Найдите рекрутера или напишите в компанию.',
          ref: ref(v),
          actions: [{ kind: 'create_task', label: 'Задача: напомнить о себе', text: `Напомнить о себе по вакансии ${this.vault.linkTo(v.path)}`, due: today, path: v.path }],
        });
      }
      if (v.status === 'interesting') {
        advice.push({
          tone: 'info',
          title: `Ещё не откликнулись: ${v.title}`,
          reason: v.resume ? 'Резюме выбрано — осталось сопроводительное письмо.' : 'Выберите резюме и откликнитесь или уберите вакансию в архив.',
          ref: ref(v),
          actions: [{ kind: 'create_task', label: 'Задача: откликнуться', text: `Откликнуться на вакансию ${this.vault.linkTo(v.path)}`, due: addDays(today, 1), path: v.path }],
        });
      }
      if (['applied', 'response', 'interview', 'test'].includes(v.status) && !v.resume) {
        advice.push({ tone: 'info', title: `Не указано резюме: ${v.title}`, reason: 'Отметьте, с каким резюме откликались, чтобы видеть, что работает.', ref: ref(v), actions: [] });
      }
    }
    for (const c of this.crm.contacts().filter((c) => c.kind === 'recruiter' && (c.followUp === 'overdue' || c.followUp === 'today'))) {
      advice.push({
        tone: 'info',
        title: `Пора связаться с рекрутером: ${c.title}`,
        reason: c.lastContact ? `Последний контакт — ${c.lastContact}.` : 'Контакта ещё не было.',
        ref: { path: c.path, title: c.title, href: `/contacts/view?path=${encodeURIComponent(c.path)}` },
        actions: [],
      });
    }
    const weekStart = startOfWeek(today);
    const appliedThisWeek = vacancies.filter((v) => v.applied && v.applied >= weekStart && v.applied <= today).length;
    const summary: string[] = [`Активных вакансий: ${active.length}. Откликов на этой неделе: ${appliedThisWeek}.`];
    const responded = vacancies.filter((v) => ['response', 'interview', 'test', 'offer'].includes(v.status)).length;
    const applied = vacancies.filter((v) => v.status !== 'interesting').length;
    if (applied >= 3) summary.push(`Ответили на ${Math.round((responded / applied) * 100)}% откликов.${responded / applied < 0.2 ? ' Это мало — стоит пересмотреть резюме или выбор вакансий.' : ''}`);
    if (!active.length) summary.push('Активных вакансий нет. Добавьте новые в разделе «Работа».');
    const order = { warn: 0, info: 1, good: 2 } as const;
    return { funnel, summary, advice: advice.sort((a, b) => order[a.tone] - order[b.tone]) };
  }

  // ---------- Связанные записи ----------

  related(rel: string, limit = 12) {
    const n = this.allowedNote(rel);
    const scores = new Map<string, { score: number; reasons: Set<string> }>();
    const add = (p: string, s: number, reason: string) => {
      if (p === n.path) return;
      const other = this.vault.get(p);
      if (!other || !aiAccess(other).allowed || other.type === 'daily' || other.type === 'template') return;
      const e = scores.get(p) ?? { score: 0, reasons: new Set<string>() };
      e.score += s;
      e.reasons.add(reason);
      scores.set(p, e);
    };
    for (const r of this.life.related(n)) add(r.path, 5, r.direction === 'in' ? 'ссылается на эту заметку' : 'связана ссылкой');
    if (n.tags.length) {
      for (const o of this.vault.all()) {
        const shared = o.tags.filter((t) => n.tags.includes(t));
        if (shared.length) add(o.path, 2 * shared.length, `общие теги: ${shared.map((t) => '#' + t).join(' ')}`);
      }
    }
    const proj = this.projectOf(n);
    if (proj) {
      for (const o of this.vault.all()) if (o.path !== proj && this.projectOf(o) === proj) add(o.path, 2, 'тот же проект');
      add(proj, 3, 'проект этой заметки');
    }
    const words = [...new Set(tokenize(`${n.title} ${n.title}`).filter((w) => w.length >= 4))].slice(0, 6);
    if (words.length) {
      for (const h of this.vault.searchNotes(words.join(' '), { limit: 15 })) add(h.path, 1.5, 'похожие слова');
    }
    const items = [...scores.entries()]
      .map(([p, e]) => ({ note: summarize(this.vault.require(p)) as NoteSummary, score: Math.round(e.score * 10) / 10, reasons: [...e.reasons] }))
      .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
      .slice(0, Math.max(1, Math.min(limit, 50)));
    return { path: n.path, title: n.title, items };
  }

  private projectOf(n: Note): string | null {
    if (n.type === 'project') return n.path;
    const l = n.links.find((x) => x.key === 'project' && x.resolved);
    return l?.resolved ?? null;
  }

  // ---------- Следующий шаг ----------

  nextStep(rel: string): Advice & { kind: string } {
    const n = this.allowedNote(rel);
    const today = this.today;
    const href = (p: string) => `/note?path=${encodeURIComponent(p)}`;
    const firstOpen = (tasks: TaskDTO[]) => tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').sort((a, b) => this.score(b).score - this.score(a).score)[0];
    switch (n.type) {
      case 'project': {
        const p = this.life.project(n);
        const t = firstOpen(this.life.tasks('all', { projectPath: n.path }));
        if (p.daysLeft !== null && p.daysLeft < 0 && p.status === 'active') {
          return { kind: 'project', tone: 'warn', title: 'Дедлайн проекта прошёл', reason: 'Перенесите дедлайн или завершите проект. Остальные шаги зависят от этого решения.', actions: [{ kind: 'open', label: 'Открыть проект', href: `/projects/view?path=${encodeURIComponent(n.path)}` }] };
        }
        if (t) return { kind: 'project', tone: 'good', title: t.title, reason: this.score(t).reasons.join(', ') || 'первая открытая задача проекта', actions: t.date === today ? [] : [setDue(t, today, 'Сделать сегодня')] };
        return { kind: 'project', tone: 'warn', title: 'Сформулировать следующий шаг', reason: 'В проекте нет открытых задач — без шага он остановится.', actions: [{ kind: 'create_task', label: 'Создать задачу', text: 'Определить следующий шаг', due: today, path: n.path }] };
      }
      case 'goal': {
        const g = this.life.goals().find((x) => x.path === n.path);
        const stuck = g?.projects.filter((p) => p.status === 'active' && !this.life.projects().find((x) => x.path === p.path)?.nextStep) ?? [];
        if (!g || !g.projects.length) return { kind: 'goal', tone: 'warn', title: 'Создать первый проект для цели', reason: 'Цель без проекта остаётся пожеланием.', actions: [{ kind: 'open', label: 'К проектам', href: '/projects' }] };
        if (stuck[0]) return { kind: 'goal', tone: 'warn', title: `Добавить шаг в проект «${stuck[0].title}»`, reason: 'У проекта цели нет открытых задач.', ref: { path: stuck[0].path, title: stuck[0].title, href: `/projects/view?path=${encodeURIComponent(stuck[0].path)}` }, actions: [{ kind: 'create_task', label: 'Создать задачу', text: 'Определить следующий шаг', due: today, path: stuck[0].path }] };
        const weakest = [...g.projects].filter((p) => p.status === 'active').sort((a, b) => a.progress - b.progress)[0];
        return { kind: 'goal', tone: 'info', title: weakest ? `Продвинуть «${weakest.title}» (${weakest.progress}%)` : 'Подвести итог по цели', reason: weakest ? 'Самый отстающий активный проект цели.' : 'Активных проектов нет.', ref: weakest ? { path: weakest.path, title: weakest.title, href: `/projects/view?path=${encodeURIComponent(weakest.path)}` } : undefined, actions: [] };
      }
      case 'vacancy': {
        const v = this.crm.vacancy(n);
        const map: Record<string, [string, string]> = {
          interesting: ['Откликнуться', 'Вакансия отмечена как интересная, но отклика ещё нет.'],
          applied: ['Дождаться ответа или напомнить о себе', v.applied ? `Отклик отправлен ${v.applied}.` : 'Отклик отправлен.'],
          response: ['Договориться о собеседовании', 'Компания ответила.'],
          interview: [v.interview && v.interview >= today ? `Подготовиться к собеседованию ${v.interview}` : 'Записать итоги собеседования', 'Статус: собеседование.'],
          test: [v.testDue ? `Сдать тестовое до ${v.testDue}` : 'Сделать тестовое задание', 'Статус: тестовое.'],
          offer: ['Сравнить оффер с целями и ответить', 'Есть предложение.'],
          rejected: ['Записать выводы и закрыть', 'Отказ.'],
          archived: ['Ничего не нужно', 'Вакансия в архиве.'],
        };
        const [title, reason] = v.nextStep ? [v.nextStep, v.nextDate ? `Запланировано на ${v.nextDate}.` : 'Записано в вакансии.'] : map[v.status]!;
        return { kind: 'vacancy', tone: v.attention ? 'warn' : 'info', title, reason, actions: v.status === 'archived' ? [] : [{ kind: 'create_task', label: 'Создать задачу', text: `${title} ${this.vault.linkTo(n.path)}`, due: v.nextDate && v.nextDate >= today ? v.nextDate : today, path: n.path }] };
      }
      case 'contact': {
        const c = this.crm.contact(n);
        if (c.followUp === 'overdue' || c.followUp === 'today') return { kind: 'contact', tone: 'warn', title: `Связаться с ${c.title}`, reason: c.nextContact ? `Следующий контакт был намечен на ${c.nextContact}.` : 'Пора связаться.', actions: [{ kind: 'create_task', label: 'Создать задачу', text: `Связаться ${this.vault.linkTo(n.path)}`, due: today, path: null }] };
        return { kind: 'contact', tone: 'info', title: c.nextContact ? `Следующий контакт ${c.nextContact}` : 'Назначить следующий контакт', reason: c.lastContact ? `Последний раз общались ${c.lastContact}.` : 'Истории общения пока нет.', actions: [] };
      }
      case 'idea':
        return { kind: 'idea', tone: 'info', title: 'Решить судьбу идеи', reason: 'Превратите её в задачу, гипотезу или проект — или отложите.', actions: [{ kind: 'open', label: 'К идеям', href: '/ideas' }] };
      default: {
        const t = firstOpen(n.tasks.map((x) => this.life.toDTO(x)));
        if (t) return { kind: 'note', tone: 'info', title: t.title, reason: 'Открытая задача в этой заметке.', actions: t.date === today ? [] : [setDue(t, today, 'Сделать сегодня')] };
        const c = this.noteTasks(n.path).candidates.length;
        if (c) return { kind: 'note', tone: 'info', title: `Превратить в задачи: найдено строк — ${c}`, reason: 'В тексте есть дела, которые не оформлены задачами.', actions: [{ kind: 'open', label: 'Показать', href: `/assistant?tool=note&path=${encodeURIComponent(n.path)}` }] };
        return { kind: 'note', tone: 'good', title: 'Действий не требуется', reason: 'В заметке нет открытых задач и похожих на дела строк.', ref: { path: n.path, title: n.title, href: href(n.path) }, actions: [] };
      }
    }
  }
}

// ---------- Вспомогательное ----------

function setDue(t: TaskDTO, due: string | null, label: string): AssistantAction {
  return { kind: 'set_due', label, path: t.path, line: t.line, raw: t.raw, due };
}

function withPlanActions(s: ScoredTask, date: string): ScoredTask {
  return { ...s, actions: s.task.date === date ? [] : [setDue(s.task, date, date === s.task.date ? 'В план' : 'Поставить на этот день')] };
}

function nextMonday(today: string): string {
  return addDays(startOfWeek(today), 7);
}

function nextWorkday(date: string): string {
  let d = addDays(date, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1);
  return d;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\[\[[^\]]*\]\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Строка заметки → дело: «- позвонить в банк завтра», «TODO: купить билеты», «Надо обновить резюме». */
export function candidateFromLine(raw: string, today: string): { text: string; due: string | null } | null {
  let s = raw.trim();
  if (!s) return null;
  const bullet = /^([-*+]|\d+[.)])\s+/.exec(s);
  if (bullet) s = s.slice(bullet[0].length);
  const marked = MARKERS.test(s);
  s = s.replace(MARKERS, '').trim();
  const first = s.toLowerCase().replace(/ё/g, 'е').split(/[\s,.:;!?]+/)[0] ?? '';
  const verb = ACTION_VERBS.includes(first);
  if (!marked && !verb) return null;
  if (s.length < 4 || s.length > 200 || s.endsWith('?')) return null;
  let due: string | null = null;
  const m = /\s(сегодня|завтра|послезавтра|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}(?:\.\d{4})?|до\s+\d{1,2}\.\d{1,2}(?:\.\d{4})?)[.!]?$/i.exec(s);
  if (m) {
    due = parseHumanDate(m[1]!.replace(/^до\s+/i, ''), today);
    if (due) s = s.slice(0, m.index);
  }
  s = s.replace(/[.;]+$/, '').trim();
  if (!s) return null;
  return { text: s[0]!.toUpperCase() + s.slice(1), due };
}

