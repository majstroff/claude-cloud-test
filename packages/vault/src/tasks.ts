import { addDays, addMonths, isIsoDate } from './dates.ts';

/**
 * Задачи в Markdown в формате, совместимом с плагином Obsidian Tasks:
 *   - [ ] Позвонить в банк 📅 2026-11-25 ⏫ 🔁 every week #финансы
 * Также понимаются поля Dataview: [due:: 2026-11-25], [scheduled:: …],
 * и метка [todoist:: <id>] — задача отправлена в Todoist и ведётся там.
 */

export type TaskStatus = 'open' | 'done' | 'cancelled' | 'in_progress';
export type Priority = 'highest' | 'high' | 'medium' | 'none' | 'low' | 'lowest';

export interface ParsedTask {
  status: TaskStatus;
  statusChar: string;
  /** Текст задачи без служебных меток. */
  title: string;
  due: string | null;
  scheduled: string | null;
  start: string | null;
  doneDate: string | null;
  created: string | null;
  priority: Priority;
  recurrence: string | null;
  tags: string[];
  indent: string;
  /** Id задачи в Todoist, если строка была отправлена туда из Frame OS. */
  todoistId: string | null;
}

export const TASK_LINE = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;

const PRIORITY_EMOJI: Record<string, Priority> = {
  '🔺': 'highest',
  '⏫': 'high',
  '🔼': 'medium',
  '🔽': 'low',
  '⏬': 'lowest',
};
export const PRIORITY_TO_EMOJI: Record<Priority, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  none: '',
  low: '🔽',
  lowest: '⏬',
};
export const PRIORITY_RANK: Record<Priority, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  none: 3,
  low: 4,
  lowest: 5,
};

const DATE_EMOJI: Record<string, 'due' | 'scheduled' | 'start' | 'doneDate' | 'created' | 'cancelled'> = {
  '📅': 'due',
  '📆': 'due',
  '🗓': 'due',
  '🗓️': 'due',
  '⏳': 'scheduled',
  '⌛': 'scheduled',
  '🛫': 'start',
  '✅': 'doneDate',
  '➕': 'created',
  '❌': 'cancelled',
};

const EMOJI_DATE_RE = /(📅|📆|🗓️?|⏳|⌛|🛫|✅|➕|❌)️?\s*(\d{4}-\d{2}-\d{2})/gu;
const PRIORITY_RE = /\s*(🔺|⏫|🔼|🔽|⏬)️?/gu;
const RECUR_RE = /🔁️?\s*([^📅📆🗓⏳⌛🛫✅➕❌🔺⏫🔼🔽⏬#\[]+)/u;
const DATAVIEW_RE = /\[(due|scheduled|start|completion|created|priority|repeat|todoist)::\s*([^\]]*)\]/gi;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;

export function parseTaskLine(line: string): ParsedTask | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;
  const [, indent = '', , statusChar = ' ', rest = ''] = m;
  let text = rest;
  const task: ParsedTask = {
    status: statusFromChar(statusChar),
    statusChar,
    title: '',
    due: null,
    scheduled: null,
    start: null,
    doneDate: null,
    created: null,
    priority: 'none',
    recurrence: null,
    tags: [],
    indent,
    todoistId: null,
  };

  text = text.replace(EMOJI_DATE_RE, (_all, emoji: string, date: string) => {
    const field = DATE_EMOJI[emoji] ?? DATE_EMOJI[emoji.replace('️', '')];
    if (field && field !== 'cancelled' && isIsoDate(date)) task[field] = date;
    return '';
  });
  text = text.replace(PRIORITY_RE, (_all, emoji: string) => {
    task.priority = PRIORITY_EMOJI[emoji] ?? 'none';
    return '';
  });
  const rec = RECUR_RE.exec(text);
  if (rec) {
    task.recurrence = rec[1]!.trim();
    text = text.replace(rec[0], '');
  }
  text = text.replace(DATAVIEW_RE, (_all, key: string, value: string) => {
    const k = key.toLowerCase();
    const v = value.trim();
    if (k === 'priority') {
      const p = v.toLowerCase() as Priority;
      if (p in PRIORITY_RANK) task.priority = p;
    } else if (k === 'repeat') {
      task.recurrence = v || null;
    } else if (k === 'todoist') {
      task.todoistId = v || null;
    } else if (isIsoDate(v)) {
      if (k === 'due') task.due = v;
      else if (k === 'scheduled') task.scheduled = v;
      else if (k === 'start') task.start = v;
      else if (k === 'completion') task.doneDate = v;
      else if (k === 'created') task.created = v;
    }
    return '';
  });
  for (const t of text.matchAll(TAG_RE)) task.tags.push(t[2]!);
  task.title = text.replace(/\s{2,}/g, ' ').trim();
  return task;
}

function statusFromChar(c: string): TaskStatus {
  if (c === 'x' || c === 'X') return 'done';
  if (c === '-') return 'cancelled';
  if (c === '/') return 'in_progress';
  return 'open';
}

/** Дата, на которую задача «назначена»: срок, иначе запланированная дата. */
export function effectiveDate(t: Pick<ParsedTask, 'due' | 'scheduled'>): string | null {
  return t.due ?? t.scheduled ?? null;
}

function replaceStatusChar(line: string, c: string): string {
  return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/, `$1${c}$3`);
}

function stripEmojiDate(line: string, emojis: string[]): string {
  const re = new RegExp(`\\s*(?:${emojis.join('|')})\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, 'gu');
  return line.replace(re, '');
}

function appendToken(line: string, token: string): string {
  return line.replace(/\s+$/, '') + ' ' + token;
}

/**
 * Отмечает задачу выполненной. Для повторяющихся задач возвращает также
 * строку следующего повторения (вставляется над исходной, как в Obsidian Tasks).
 */
export function completeTaskLine(line: string, today: string): { line: string; next: string | null } {
  const t = parseTaskLine(line);
  if (!t) throw new Error('Строка не является задачей');
  let next: string | null = null;
  if (t.recurrence) {
    next = nextRecurrenceLine(line, t, today);
  }
  let out = replaceStatusChar(line, 'x');
  out = stripEmojiDate(out, ['✅']);
  out = appendToken(out, `✅ ${today}`);
  return { line: out, next };
}

export function reopenTaskLine(line: string): string {
  let out = replaceStatusChar(line, ' ');
  out = stripEmojiDate(out, ['✅']);
  out = out.replace(/\s*\[completion::[^\]]*\]/gi, '');
  return out;
}

export function setTaskDueLine(line: string, due: string | null): string {
  if (due !== null && !isIsoDate(due)) throw new Error(`Некорректная дата: ${due}`);
  let out = stripEmojiDate(line, ['📅', '📆', '🗓']);
  out = out.replace(/\s*\[due::[^\]]*\]/gi, '');
  if (due) out = appendToken(out, `📅 ${due}`);
  return out;
}

export function setTaskPriorityLine(line: string, priority: Priority): string {
  let out = line.replace(PRIORITY_RE, '');
  out = out.replace(/\s*\[priority::[^\]]*\]/gi, '');
  const emoji = PRIORITY_TO_EMOJI[priority];
  if (emoji) out = appendToken(out, emoji);
  return out;
}

/** Помечает строку задачи как отправленную в Todoist: [todoist:: <id>]. */
export function setTaskTodoistLine(line: string, todoistId: string | null): string {
  if (todoistId !== null && !/^[\w-]+$/.test(todoistId)) throw new Error(`Некорректный id Todoist: ${todoistId}`);
  let out = line.replace(/\s*\[todoist::[^\]]*\]/gi, '');
  if (todoistId) out = appendToken(out, `[todoist:: ${todoistId}]`);
  return out;
}

export function buildTaskLine(opts: {
  title: string;
  due?: string | null;
  priority?: Priority;
  recurrence?: string | null;
  indent?: string;
}): string {
  const title = opts.title.replace(/[\r\n]+/g, ' ').trim();
  if (!title) throw new Error('Пустой текст задачи');
  const parts = [`${opts.indent ?? ''}- [ ] ${title}`];
  if (opts.priority && opts.priority !== 'none') parts.push(PRIORITY_TO_EMOJI[opts.priority]);
  if (opts.recurrence) parts.push(`🔁 ${opts.recurrence}`);
  if (opts.due) {
    if (!isIsoDate(opts.due)) throw new Error(`Некорректная дата: ${opts.due}`);
    parts.push(`📅 ${opts.due}`);
  }
  return parts.join(' ');
}

/**
 * Поддерживаемые правила повторения (как в Obsidian Tasks):
 * every day | every N days | every week | every N weeks | every month |
 * every N months | every year, а также русские «каждый день/неделю/месяц/год».
 */
export function nextDate(rule: string, from: string): string | null {
  const r = rule.trim().toLowerCase().replace(/\s+when done$/, '');
  const m = /^every\s+(\d+\s+)?(day|days|week|weeks|month|months|year|years)$/.exec(r);
  let n = 1;
  let unit: string | null = null;
  if (m) {
    n = m[1] ? Number(m[1]) : 1;
    unit = m[2]!.replace(/s$/, '');
  } else {
    const ru = /^кажд(?:ый|ую|ое|ые)\s+(?:(\d+)\s+)?(день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев|год|года|лет)$/.exec(r);
    if (ru) {
      n = ru[1] ? Number(ru[1]) : 1;
      const u = ru[2]!;
      unit = u.startsWith('д') ? 'day' : u.startsWith('нед') ? 'week' : u.startsWith('мес') ? 'month' : 'year';
    }
  }
  if (!unit) return null;
  switch (unit) {
    case 'day':
      return addDays(from, n);
    case 'week':
      return addDays(from, 7 * n);
    case 'month':
      return addMonths(from, n);
    case 'year':
      return addMonths(from, 12 * n);
  }
  return null;
}

function nextRecurrenceLine(line: string, t: ParsedTask, today: string): string | null {
  const whenDone = /when done/i.test(t.recurrence ?? '');
  const base = whenDone ? today : (t.due ?? t.scheduled ?? today);
  const nd = nextDate(t.recurrence!, base);
  if (!nd) return null;
  const shift = (orig: string | null) => {
    if (!orig) return null;
    const delta = Math.round((Date.parse(nd) - Date.parse(base)) / 86_400_000);
    return addDays(orig, delta);
  };
  let out = replaceStatusChar(line, ' ');
  out = stripEmojiDate(out, ['✅']);
  const map: Array<[string, string | null]> = [
    ['📅', t.due ? (whenDone ? nd : shift(t.due)) : null],
    ['⏳', t.scheduled ? shift(t.scheduled) : null],
    ['🛫', t.start ? shift(t.start) : null],
  ];
  for (const [emoji, value] of map) {
    if (!value) continue;
    out = out.replace(new RegExp(`${emoji}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`, 'u'), `${emoji} ${value}`);
  }
  if (!t.due && !t.scheduled) out = appendToken(out, `📅 ${nd}`);
  return out;
}
