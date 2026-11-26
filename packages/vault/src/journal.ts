/**
 * Дневник, итоги недели и месяца, аналитика.
 *
 * Записи дневника — секция «Дневник» в ежедневной заметке Obsidian.
 * Итоги — заметки `type: review` в папке итогов. Вся аналитика считается
 * на этом компьютере по Markdown-файлам, никуда не отправляется.
 */
import { addDays, diffDays, endOfMonth, isIsoDate, startOfMonth, startOfWeek } from './dates.ts';
import { getSectionText, setSectionText } from './markdown.ts';
import { VaultError, type Note } from './vault.ts';
import type { Life, TaskDTO } from './life.ts';
import type { Spheres } from './spheres.ts';

export const JOURNAL_SECTION = ['Дневник', 'Journal', 'Запись дня'];
const REVIEW_SECTION = ['Итог дня', 'Вечерний итог', 'Review'];
const GRATITUDE_SECTION = ['Благодарности', 'Благодарность'];

export type ReviewPeriod = 'week' | 'month';

export interface JournalEntrySummary {
  date: string;
  path: string;
  mood: number | null;
  energy: number | null;
  /** Есть текст в «Дневнике» или в «Итоге дня». */
  written: boolean;
  words: number;
  excerpt: string;
  doneTasks: number;
}

export interface Insight {
  tone: 'good' | 'warn' | 'info';
  text: string;
  /** Куда перейти, чтобы разобраться. */
  href?: string;
}

export interface PeriodStats {
  period: ReviewPeriod;
  start: string;
  end: string;
  /** Сколько дней периода уже прошло (включая сегодня). */
  days: number;
  label: string;
  tasks: {
    done: number;
    highDone: number;
    /** Срок в периоде прошёл, задача не выполнена. */
    missed: number;
    overdueNow: number;
    doneByDay: Array<{ date: string; count: number }>;
    byProject: Array<{ path: string; title: string; done: number }>;
    doneList: Array<Pick<TaskDTO, 'title' | 'path' | 'doneDate' | 'noteTitle'>>;
    missedList: Array<Pick<TaskDTO, 'title' | 'path' | 'date' | 'noteTitle' | 'line' | 'raw'>>;
  };
  journal: { daysWithNote: number; daysWritten: number; words: number };
  mood: {
    avg: number | null;
    energyAvg: number | null;
    series: Array<{ date: string; mood: number | null; energy: number | null }>;
  };
  health: { sleepAvg: number | null; sleepDays: number; workoutsDone: number; workoutsPlanned: number; workoutsMissed: number };
  practices: { days: number; minutes: number };
  finance: { income: number; expense: number; topCategories: Array<{ category: string; amount: number }> };
  projects: { active: number; withoutNextStep: Array<{ path: string; title: string }>; deadlines: Array<{ path: string; title: string; deadline: string }> };
}

export interface ReviewDTO {
  path: string;
  title: string;
  period: ReviewPeriod;
  start: string;
  end: string;
  mtimeMs: number;
}

/** Разделы итогов, которые программа пересчитывает. Остальное пишет человек и не трогается. */
const AUTO_SECTIONS = ['Цифры', 'Наблюдения', 'Сделано', 'Не сделано в срок'];
const HUMAN_SECTIONS = ['Что получилось', 'Что не получилось', 'Чему научился', 'Фокус на следующий период'];

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export class Journal {
  constructor(
    readonly life: Life,
    readonly spheres: Spheres,
  ) {}

  get vault() {
    return this.life.vault;
  }

  get today(): string {
    return this.life.today;
  }

  // ---------- Ежедневные записи ----------

  private daily(date: string): Note | null {
    return this.vault.get(this.vault.dailyPath(date)) ?? null;
  }

  summary(date: string, done?: number): JournalEntrySummary | null {
    const n = this.daily(date);
    if (!n) return null;
    const text = getSectionText(n.body, JOURNAL_SECTION) ?? '';
    const review = getSectionText(n.body, REVIEW_SECTION) ?? '';
    const all = `${text}\n${review}`.trim();
    return {
      date,
      path: n.path,
      mood: num(n.frontmatter.mood),
      energy: num(n.frontmatter.energy),
      written: all.length > 0,
      words: countWords(all),
      excerpt: (text || review).replace(/\s+/g, ' ').trim().slice(0, 160),
      doneTasks: done ?? this.life.tasks('done', { date }).length,
    };
  }

  /** Записи за период, свежие сверху. Дни без ежедневной заметки пропускаются. */
  entries(from: string, to: string): JournalEntrySummary[] {
    assertRange(from, to);
    const doneBy = countBy(this.life.tasks('all').filter((t) => t.status === 'done' && t.doneDate), (t) => t.doneDate!);
    const out: JournalEntrySummary[] = [];
    for (let d = to; d >= from; d = addDays(d, -1)) {
      const s = this.summary(d, doneBy.get(d) ?? 0);
      if (s) out.push(s);
    }
    return out;
  }

  /** Сколько дней подряд (до сегодня или до вчера) есть запись. */
  streak(): number {
    let d = this.today;
    if (!this.summary(d, 0)?.written) d = addDays(d, -1);
    let n = 0;
    while (this.summary(d, 0)?.written) {
      n++;
      d = addDays(d, -1);
      if (n > 3660) break;
    }
    return n;
  }

  entry(date: string) {
    if (!isIsoDate(date)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    const n = this.daily(date);
    const day = this.spheres.practices.day(date);
    const known = this.vault
      .byType('daily')
      .map((x) => (isIsoDate(x.frontmatter.date) ? x.frontmatter.date : /(\d{4}-\d{2}-\d{2})/.exec(x.path)?.[1] ?? null))
      .filter((x): x is string => !!x)
      .sort();
    return {
      date,
      isToday: date === this.today,
      notePath: this.vault.dailyPath(date),
      exists: !!n,
      hash: n?.hash ?? null,
      text: n ? getSectionText(n.body, JOURNAL_SECTION) ?? '' : '',
      review: n ? getSectionText(n.body, REVIEW_SECTION) ?? '' : '',
      gratitude: n ? listItems(getSectionText(n.body, GRATITUDE_SECTION) ?? '') : [],
      mood: day.mood,
      energy: day.energy,
      states: day.states,
      practices: day.practices,
      done: this.life.tasks('done', { date }),
      prev: [...known].reverse().find((d) => d < date) ?? null,
      next: known.find((d) => d > date) ?? null,
      prompts: prompts(date),
    };
  }

  async saveEntry(date: string, text: string) {
    if (!isIsoDate(date)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    if (date > this.today) throw new VaultError('Нельзя писать дневник на будущую дату', 'invalid');
    if (text.length > 200_000) throw new VaultError('Слишком длинная запись', 'invalid');
    const note = await this.vault.ensureDaily(date);
    await this.vault.transform(note.path, (content) => {
      const heading = JOURNAL_SECTION.find((h) => getSectionText(content, h) !== null) ?? JOURNAL_SECTION[0]!;
      return setSectionText(content, heading, text.trim());
    });
    return this.entry(date);
  }

  // ---------- Периоды и аналитика ----------

  bounds(period: ReviewPeriod, anchor: string): { start: string; end: string; label: string } {
    if (!isIsoDate(anchor)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
    if (period === 'week') {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      return { start, end, label: `Неделя ${rangeLabel(start, end)}` };
    }
    const start = startOfMonth(anchor);
    const m = Number(start.slice(5, 7)) - 1;
    return { start, end: endOfMonth(anchor), label: `${MONTHS[m]} ${start.slice(0, 4)}` };
  }

  previous(period: ReviewPeriod, start: string): string {
    return period === 'week' ? addDays(start, -7) : startOfMonth(addDays(start, -1));
  }

  stats(period: ReviewPeriod, anchor: string): PeriodStats {
    const { start, end, label } = this.bounds(period, anchor);
    const today = this.today;
    const last = end < today ? end : today;
    const days = last < start ? 0 : diffDays(start, last) + 1;
    const inRange = (d: string | null | undefined) => !!d && d >= start && d <= end;

    const all = this.life.tasks('all');
    const done = all.filter((t) => t.status === 'done' && inRange(t.doneDate));
    const isOpen = (t: TaskDTO) => t.status === 'open' || t.status === 'in_progress';
    // Пропущенным считается срок, который уже прошёл (сегодняшние задачи ещё можно сделать).
    const missed = all.filter((t) => isOpen(t) && t.date && t.date >= start && t.date <= end && t.date < today);
    const doneByDay: Array<{ date: string; count: number }> = [];
    const doneCount = countBy(done, (t) => t.doneDate!);
    for (let d = start; d <= end; d = addDays(d, 1)) doneByDay.push({ date: d, count: doneCount.get(d) ?? 0 });
    const projMap = new Map<string, { path: string; title: string; done: number }>();
    for (const t of done) {
      if (!t.project) continue;
      const p = projMap.get(t.project.path) ?? { ...t.project, done: 0 };
      p.done++;
      projMap.set(t.project.path, p);
    }

    let daysWithNote = 0;
    let daysWritten = 0;
    let words = 0;
    const series: PeriodStats['mood']['series'] = [];
    const sleep: number[] = [];
    let practiceDays = 0;
    let practiceMinutes = 0;
    for (let d = start; d <= last; d = addDays(d, 1)) {
      const s = this.summary(d, 0);
      if (s) {
        daysWithNote++;
        if (s.written) daysWritten++;
        words += s.words;
        series.push({ date: d, mood: s.mood, energy: s.energy });
        const h = this.spheres.health.dayHealth(d);
        if (h.sleep !== null) sleep.push(h.sleep);
        const p = this.spheres.practices.day(d).practices;
        if (p.length) practiceDays++;
        practiceMinutes += p.reduce((sum, x) => sum + (x.minutes ?? 0), 0);
      }
    }

    const workouts = this.spheres.health.workouts().filter((w) => !!w.date && w.date >= start && w.date <= last);
    const tx = this.spheres.finance.transactions({ from: start, to: end });
    const cats = new Map<string, number>();
    for (const t of tx) if (t.kind === 'expense') cats.set(t.category || 'Другое', (cats.get(t.category || 'Другое') ?? 0) + t.amount);

    const projects = this.life.projects().filter((p) => p.status === 'active');
    return {
      period,
      start,
      end,
      days,
      label,
      tasks: {
        done: done.length,
        highDone: done.filter((t) => t.priority === 'high' || t.priority === 'highest').length,
        missed: missed.length,
        overdueNow: this.life.tasks('overdue').length,
        doneByDay,
        byProject: [...projMap.values()].sort((a, b) => b.done - a.done),
        doneList: done.map((t) => ({ title: t.title, path: t.path, doneDate: t.doneDate, noteTitle: t.noteTitle })),
        missedList: missed.map((t) => ({ title: t.title, path: t.path, date: t.date, noteTitle: t.noteTitle, line: t.line, raw: t.raw })),
      },
      journal: { daysWithNote, daysWritten, words },
      mood: {
        avg: avg(series.map((s) => s.mood)),
        energyAvg: avg(series.map((s) => s.energy)),
        series,
      },
      health: {
        sleepAvg: avg(sleep),
        sleepDays: sleep.length,
        workoutsDone: workouts.filter((w) => w.status === 'done').length,
        workoutsPlanned: workouts.filter((w) => w.status !== 'skipped').length,
        workoutsMissed: workouts.filter((w) => w.missed || w.status === 'skipped').length,
      },
      practices: { days: practiceDays, minutes: practiceMinutes },
      finance: {
        income: round2(tx.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0)),
        expense: round2(tx.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0)),
        topCategories: [...cats.entries()]
          .map(([category, amount]) => ({ category, amount: round2(amount) }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5),
      },
      projects: {
        active: projects.length,
        withoutNextStep: projects.filter((p) => !p.nextStep).map((p) => ({ path: p.path, title: p.title })),
        deadlines: projects.filter((p) => inRange(p.deadline)).map((p) => ({ path: p.path, title: p.title, deadline: p.deadline! })),
      },
    };
  }

  /** Аналитика периода с выводами и сравнением с предыдущим. */
  analytics(period: ReviewPeriod, anchor: string) {
    const stats = this.stats(period, anchor);
    const prev = this.stats(period, this.previous(period, stats.start));
    return { stats, prev, insights: insights(stats, prev, this.correlations(stats)) };
  }

  /** Связь сна и настроения внутри периода: средние при сне от 7 часов и меньше. */
  private correlations(s: PeriodStats) {
    const good: number[] = [];
    const bad: number[] = [];
    for (const p of s.mood.series) {
      if (p.mood === null) continue;
      const sleep = this.spheres.health.dayHealth(p.date).sleep;
      if (sleep === null) continue;
      (sleep >= 7 ? good : bad).push(p.mood);
    }
    return { moodGoodSleep: good.length >= 2 ? avg(good) : null, moodBadSleep: bad.length >= 2 ? avg(bad) : null };
  }

  // ---------- Итоги ----------

  reviews(): ReviewDTO[] {
    return this.vault
      .byType('review')
      .flatMap((n) => {
        const fm = n.frontmatter;
        const period: ReviewPeriod | null = fm.period === 'week' || fm.period === 'month' ? fm.period : null;
        if (!period || !isIsoDate(fm.start)) return [];
        const end = isIsoDate(fm.end) ? fm.end : this.bounds(period, fm.start).end;
        return [{ path: n.path, title: n.title, period, start: fm.start as string, end, mtimeMs: n.mtimeMs } satisfies ReviewDTO];
      })
      .sort((a, b) => b.start.localeCompare(a.start) || a.period.localeCompare(b.period));
  }

  findReview(period: ReviewPeriod, start: string): ReviewDTO | null {
    return this.reviews().find((r) => r.period === period && r.start === start) ?? null;
  }

  /** Черновик итогов: что будет записано. Ничего не сохраняет. */
  draft(period: ReviewPeriod, anchor: string) {
    const a = this.analytics(period, anchor);
    const existing = this.findReview(period, a.stats.start);
    const auto = autoSections(a.stats, a.prev, a.insights, (p) => this.vault.linkTo(p));
    let human: Record<string, string> = Object.fromEntries(HUMAN_SECTIONS.map((h) => [h, '']));
    if (existing) {
      const n = this.vault.require(existing.path);
      human = Object.fromEntries(HUMAN_SECTIONS.map((h) => [h, getSectionText(n.body, h) ?? '']));
    }
    return { ...a, existing, title: reviewTitle(period, a.stats.start), auto, human };
  }

  /**
   * Сохраняет итоги в Obsidian. Новая заметка создаётся целиком; в существующей
   * пересчитываются только разделы с цифрами, записи человека не меняются.
   */
  async saveReview(period: ReviewPeriod, anchor: string, answers: Record<string, string> = {}) {
    const d = this.draft(period, anchor);
    const cleanAnswers: Record<string, string> = {};
    for (const h of HUMAN_SECTIONS) {
      const v = answers[h];
      if (typeof v === 'string') cleanAnswers[h] = v.trim();
    }
    if (d.existing) {
      const n = await this.vault.transform(d.existing.path, (content) => {
        let next = content;
        for (const h of AUTO_SECTIONS) next = setSectionText(next, h, d.auto[h] ?? '');
        for (const [h, v] of Object.entries(cleanAnswers)) next = setSectionText(next, h, v);
        return next;
      });
      return { path: n.path, created: false };
    }
    const body =
      `# ${d.title}\n\n` +
      [...AUTO_SECTIONS.map((h) => `## ${h}\n${d.auto[h] ? d.auto[h] + '\n' : ''}`), ...HUMAN_SECTIONS.map((h) => `## ${h}\n${cleanAnswers[h] ? cleanAnswers[h] + '\n' : ''}`)].join('\n');
    const n = await this.vault.createNote({
      folder: this.vault.folders.reviews,
      title: d.title,
      frontmatter: { type: 'review', period, start: d.stats.start, end: d.stats.end, created: this.today },
      body,
    });
    return { path: n.path, created: true };
  }
}

// ---------- Выводы по правилам ----------

export function insights(s: PeriodStats, prev: PeriodStats, corr: { moodGoodSleep: number | null; moodBadSleep: number | null } = { moodGoodSleep: null, moodBadSleep: null }): Insight[] {
  const out: Insight[] = [];
  const planned = s.tasks.done + s.tasks.missed;
  if (planned > 0) {
    const rate = Math.round((s.tasks.done / planned) * 100);
    out.push({
      tone: rate >= 70 ? 'good' : rate >= 40 ? 'info' : 'warn',
      text: `Выполнено ${s.tasks.done} из ${planned} запланированных задач (${rate}%).${prev.tasks.done ? ` В прошлом периоде — ${prev.tasks.done}.` : ''}`,
    });
  } else if (s.days > 0) {
    out.push({ tone: 'info', text: 'За период нет выполненных задач и задач со сроком. Запланируйте хотя бы одно дело на день.' , href: '/today' });
  }
  if (s.tasks.overdueNow >= 5) out.push({ tone: 'warn', text: `Сейчас просрочено ${s.tasks.overdueNow} ${plural(s.tasks.overdueNow, 'задача', 'задачи', 'задач')}. Разберите их: перенесите, уберите срок или закройте.`, href: '/assistant?tool=overdue' });
  else if (s.tasks.overdueNow > 0) out.push({ tone: 'info', text: `Просрочено задач: ${s.tasks.overdueNow}.`, href: '/assistant?tool=overdue' });
  if (s.tasks.byProject[0]) out.push({ tone: 'good', text: `Больше всего продвинулся проект «${s.tasks.byProject[0].title}»: ${s.tasks.byProject[0].done} ${plural(s.tasks.byProject[0].done, 'задача', 'задачи', 'задач')}.` });
  if (s.projects.withoutNextStep.length) {
    out.push({
      tone: 'warn',
      text: `Без следующего шага: ${s.projects.withoutNextStep.map((p) => `«${p.title}»`).join(', ')}. Добавьте по одной задаче, иначе проект встанет.`,
      href: '/projects',
    });
  }
  if (s.mood.avg !== null) {
    const diff = prev.mood.avg !== null ? s.mood.avg - prev.mood.avg : null;
    out.push({
      tone: s.mood.avg >= 3.5 ? 'good' : s.mood.avg < 2.5 ? 'warn' : 'info',
      text: `Среднее настроение ${fmt1(s.mood.avg)} из 5${diff !== null && Math.abs(diff) >= 0.3 ? `, ${diff > 0 ? 'выше' : 'ниже'} прошлого периода на ${fmt1(Math.abs(diff))}` : ''}.`,
    });
  }
  if (corr.moodGoodSleep !== null && corr.moodBadSleep !== null && corr.moodGoodSleep - corr.moodBadSleep >= 0.5) {
    out.push({ tone: 'info', text: `В дни со сном от 7 часов настроение в среднем ${fmt1(corr.moodGoodSleep)}, а после короткого сна — ${fmt1(corr.moodBadSleep)}.` });
  }
  if (s.health.sleepAvg !== null && s.health.sleepAvg < 7) out.push({ tone: 'warn', text: `Сон в среднем ${fmt1(s.health.sleepAvg)} ч — меньше 7 часов.`, href: '/health' });
  if (s.health.workoutsPlanned > 0) {
    out.push({
      tone: s.health.workoutsDone >= s.health.workoutsPlanned ? 'good' : s.health.workoutsMissed > 0 ? 'warn' : 'info',
      text: `Тренировок проведено: ${s.health.workoutsDone} из ${s.health.workoutsPlanned}.${s.health.workoutsMissed ? ` Пропущено: ${s.health.workoutsMissed}.` : ''}`,
      href: '/health',
    });
  }
  if (s.finance.expense > 0 && prev.finance.expense > 0) {
    const ch = Math.round(((s.finance.expense - prev.finance.expense) / prev.finance.expense) * 100);
    if (Math.abs(ch) >= 15) out.push({ tone: ch > 0 ? 'warn' : 'good', text: `Расходы ${ch > 0 ? 'выросли' : 'снизились'} на ${Math.abs(ch)}% к прошлому периоду.`, href: '/finance' });
  }
  if (s.finance.topCategories[0]) out.push({ tone: 'info', text: `Главная статья расходов — «${s.finance.topCategories[0].category}»: ${money(s.finance.topCategories[0].amount)}.`, href: '/finance' });
  if (s.days > 0) {
    if (s.journal.daysWritten === 0) out.push({ tone: 'info', text: 'Записей в дневнике за период нет. Пара строк в конце дня помогает видеть, что работает.', href: '/journal' });
    else out.push({ tone: s.journal.daysWritten >= Math.ceil(s.days / 2) ? 'good' : 'info', text: `Дневник: ${s.journal.daysWritten} из ${s.days} дней.` });
  }
  if (s.practices.days > 0) out.push({ tone: 'good', text: `Практики: ${s.practices.days} дн., ${s.practices.minutes} мин.` });
  return out;
}

function autoSections(s: PeriodStats, prev: PeriodStats, ins: Insight[], link: (p: string) => string): Record<string, string> {
  const cmp = (a: number, b: number) => (b ? ` (было ${b})` : '');
  const nums = [
    `- Выполнено задач: ${s.tasks.done}${cmp(s.tasks.done, prev.tasks.done)}, из них важных: ${s.tasks.highDone}`,
    `- Не сделано в срок: ${s.tasks.missed}; просрочено сейчас: ${s.tasks.overdueNow}`,
    `- Записей в дневнике: ${s.journal.daysWritten} из ${s.days} дн.`,
    s.mood.avg !== null ? `- Настроение: ${fmt1(s.mood.avg)}/5${s.mood.energyAvg !== null ? `, энергия: ${fmt1(s.mood.energyAvg)}/5` : ''}` : null,
    s.health.sleepAvg !== null ? `- Сон в среднем: ${fmt1(s.health.sleepAvg)} ч` : null,
    s.health.workoutsPlanned ? `- Тренировки: ${s.health.workoutsDone} из ${s.health.workoutsPlanned}` : null,
    s.practices.days ? `- Практики: ${s.practices.days} дн., ${s.practices.minutes} мин` : null,
    s.finance.income || s.finance.expense ? `- Доходы: ${money(s.finance.income)}; расходы: ${money(s.finance.expense)}` : null,
  ].filter(Boolean);
  const doneList = s.tasks.doneList.slice(0, 50).map((t) => `- ${t.title} — ${link(t.path)}`);
  const missedList = s.tasks.missedList.slice(0, 50).map((t) => `- ${t.title} (срок ${t.date}) — ${link(t.path)}`);
  return {
    Цифры: nums.join('\n'),
    Наблюдения: ins.map((i) => `- ${i.text}`).join('\n'),
    Сделано: doneList.join('\n') || '- Пока ничего не отмечено выполненным',
    'Не сделано в срок': missedList.join('\n') || '- Всё, что было со сроком, сделано',
  };
}

function reviewTitle(period: ReviewPeriod, start: string): string {
  return period === 'week' ? `Итоги недели ${start}` : `Итоги месяца ${start.slice(0, 7)}`;
}

function prompts(date: string): string[] {
  const all = [
    'Что сегодня получилось лучше всего?',
    'Что забрало больше всего сил?',
    'За что я благодарен сегодня?',
    'Что я узнал нового?',
    'Что сделаю завтра первым делом?',
    'Какое решение я откладываю?',
    'Что бы я сделал иначе?',
  ];
  const seed = Number(date.replace(/-/g, '')) % all.length;
  return [all[seed]!, all[(seed + 2) % all.length]!, all[(seed + 4) % all.length]!];
}

// ---------- Вспомогательное ----------

function assertRange(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new VaultError('Неверный период', 'invalid');
  if (diffDays(from, to) > 400) throw new VaultError('Слишком длинный период', 'invalid');
}

function rangeLabel(a: string, b: string): string {
  const [, am, ad] = a.split('-').map(Number);
  const [, bm, bd] = b.split('-').map(Number);
  return am === bm ? `${ad}–${bd} ${MONTHS_GEN[bm! - 1]}` : `${ad} ${MONTHS_GEN[am! - 1]} – ${bd} ${MONTHS_GEN[bm! - 1]}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function countBy<T>(list: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}

function listItems(text: string): string[] {
  return text
    .split('\n')
    .map((l) => /^\s*[-*]\s+(?!\[[ xX/-]\])(.+)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => !!x);
}

function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'));
  return null;
}

function avg(list: Array<number | null>): number | null {
  const xs = list.filter((x): x is number => x !== null);
  return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}
