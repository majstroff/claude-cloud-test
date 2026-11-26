import { randomUUID } from "node:crypto";
import type { TodoistClient } from "./client.ts";
import { TodoistError, USER_MESSAGES, toTodoistError } from "./errors.ts";
import { type FrameTask, fromTodoist, projectFromTodoist } from "./model.ts";
import type { OutboxEntry, OutboxOp, SyncSnapshot, SyncStore } from "./store.ts";
import type { CreateTaskInput, DueInput, MoveTaskInput, TodoistTask, UpdateTaskInput } from "./types.ts";

export type TaskView = "today" | "overdue" | "upcoming" | "backlog" | "completed" | "all";

export interface ListOptions {
  view?: TaskView;
  projectId?: string;
  label?: string;
  /** Case-insensitive search in title and notes. */
  search?: string;
  /** Days ahead for the "upcoming" view. Default 7. */
  days?: number;
}

export interface BacklogItem {
  title: string;
  notes?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  /** Vault-relative path of the Obsidian note this item came from. */
  obsidianPath?: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  remoteDeleted: number;
  error: { code: string; message: string } | null;
}

export interface TodoistSyncServiceOptions {
  /** null when no token is configured: local edits still queue up offline. */
  client: TodoistClient | null;
  store: SyncStore;
  /** IANA zone used to decide what "today" is. Default: system zone. */
  timeZone?: string;
  now?: () => Date;
  /** Obsidian vault name, used to put an obsidian:// link into the Todoist description. */
  vaultName?: string;
  /** Push each change right after it is made. Default true. */
  autoFlush?: boolean;
  /** Called after every successful sync(), e.g. to mirror completions into the vault. */
  onSync?: (result: SyncResult) => Promise<void> | void;
}

/**
 * Two-way sync between Frame OS and Todoist.
 *
 * Local edits are applied at once to a local mirror and queued in an outbox,
 * so the app keeps working offline. `sync()` first pulls Todoist (spotting
 * conflicts), then pushes the outbox. Nothing is ever deleted without an
 * explicit `confirmed: true`, and a task deleted in Todoist is only flagged.
 */
export class TodoistSyncService {
  readonly #client: TodoistClient | null;
  readonly #store: SyncStore;
  readonly #tz: string;
  readonly #now: () => Date;
  readonly #vaultName?: string;
  readonly #autoFlush: boolean;
  readonly #onSync?: (result: SyncResult) => Promise<void> | void;
  #lock: Promise<unknown> = Promise.resolve();
  #syncing = false;

  constructor(opts: TodoistSyncServiceOptions) {
    this.#client = opts.client;
    this.#store = opts.store;
    this.#tz = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.#now = opts.now ?? (() => new Date());
    this.#vaultName = opts.vaultName;
    this.#autoFlush = opts.autoFlush ?? true;
    this.#onSync = opts.onSync;
  }

  get configured() {
    return this.#client !== null;
  }

  async status() {
    const s = await this.#store.load();
    const tasks = Object.values(s.tasks);
    return {
      configured: this.configured,
      syncing: this.#syncing,
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
      pending: s.outbox.length,
      conflicts: tasks.filter((t) => t.syncState === "conflict").length,
      errors: tasks.filter((t) => t.syncState === "error").length,
      remoteDeleted: tasks.filter((t) => t.syncState === "remote_deleted").length,
    };
  }

  // ---------- reading ----------

  today(): string {
    return localDate(this.#now(), this.#tz);
  }

  async listTasks(opts: ListOptions = {}): Promise<FrameTask[]> {
    const s = await this.#store.load();
    const deleting = new Set(s.outbox.filter((e) => e.kind === "delete").map((e) => e.taskId));
    const today = this.today();
    const horizon = addDays(today, opts.days ?? 7);
    const q = opts.search?.trim().toLowerCase();
    const view = opts.view ?? "all";

    return Object.values(s.tasks)
      .filter((t) => !deleting.has(t.id))
      .filter((t) => {
        const date = t.due?.date || null;
        const open = !t.completed && t.syncState !== "remote_deleted";
        switch (view) {
          case "today":
            return open && date === today;
          case "overdue":
            return open && !!date && date < today;
          case "upcoming":
            return open && !!date && date > today && date <= horizon;
          case "backlog":
            return open && !t.due;
          case "completed":
            return t.completed;
          default:
            return true;
        }
      })
      .filter((t) => !opts.projectId || t.projectId === opts.projectId)
      .filter((t) => !opts.label || t.labels.includes(opts.label))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))
      .sort(byDueThenPriority);
  }

  async getTask(id: string) {
    const s = await this.#store.load();
    return s.tasks[id] ?? null;
  }

  async listProjects() {
    return (await this.#store.load()).projects;
  }

  // ---------- writing (optimistic + outbox) ----------

  async createTask(input: CreateTaskInput, link: { obsidianPath?: string } = {}): Promise<FrameTask> {
    if (!input.content?.trim()) throw new TodoistError("validation", "Название задачи не может быть пустым");
    assertDue(input);
    const id = await this.#mutate((s) => {
      const id = `loc_${randomUUID()}`;
      s.tasks[id] = {
        id,
        todoistId: null,
        title: input.content.trim(),
        notes: input.description ?? "",
        projectId: input.project_id ?? null,
        sectionId: input.section_id ?? null,
        parentId: input.parent_id ?? null,
        labels: input.labels ?? [],
        priority: input.priority ?? 1,
        due: localDue(input),
        deadline: input.deadline_date ?? null,
        completed: false,
        completedAt: null,
        remoteUpdatedAt: null,
        localUpdatedAt: this.#now().toISOString(),
        syncState: "pending",
        syncError: null,
        conflictRemote: null,
        obsidianPath: link.obsidianPath ?? null,
        url: null,
      };
      this.#enqueue(s, id, { kind: "create", input: { ...input, content: input.content.trim() } });
      return id;
    });
    return this.#afterWrite(id);
  }

  async updateTask(id: string, patch: UpdateTaskInput & { clearDue?: boolean }): Promise<FrameTask> {
    assertDue(patch);
    if (patch.content !== undefined && !patch.content.trim()) {
      throw new TodoistError("validation", "Название задачи не может быть пустым");
    }
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (patch.content !== undefined) t.title = patch.content.trim();
      if (patch.description !== undefined) t.notes = patch.description;
      if (patch.labels !== undefined) t.labels = patch.labels;
      if (patch.priority !== undefined) t.priority = patch.priority;
      if (patch.deadline_date !== undefined) t.deadline = patch.deadline_date;
      if (patch.clearDue) t.due = null;
      else if (patch.due_string || patch.due_date || patch.due_datetime) t.due = localDue(patch);
      this.#touch(t);
      this.#enqueue(s, id, { kind: "update", input: patch });
    });
    return this.#afterWrite(id);
  }

  /** Recurring tasks are not marked done: Todoist moves them to the next date. */
  async completeTask(id: string): Promise<FrameTask> {
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (!t.due?.recurring) {
        t.completed = true;
        t.completedAt = this.#now().toISOString();
      }
      this.#touch(t);
      this.#enqueue(s, id, { kind: "close" });
    });
    return this.#afterWrite(id);
  }

  async reopenTask(id: string): Promise<FrameTask> {
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      t.completed = false;
      t.completedAt = null;
      this.#touch(t);
      this.#enqueue(s, id, { kind: "reopen" });
    });
    return this.#afterWrite(id);
  }

  async moveTask(id: string, to: MoveTaskInput): Promise<FrameTask> {
    if (!to.project_id && !to.section_id && !to.parent_id) {
      throw new TodoistError("validation", "Укажите проект, раздел или родительскую задачу");
    }
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (to.project_id) t.projectId = to.project_id;
      if (to.section_id) t.sectionId = to.section_id;
      if (to.parent_id) t.parentId = to.parent_id;
      this.#touch(t);
      this.#enqueue(s, id, { kind: "move", input: to });
    });
    return this.#afterWrite(id);
  }

  /** Deleting needs an explicit confirmation from the person (never from the AI alone). */
  async deleteTask(id: string, opts: { confirmed?: boolean } = {}): Promise<void> {
    if (opts.confirmed !== true) {
      throw new TodoistError("confirmation_required", "Удаление задачи нужно подтвердить");
    }
    const flushNeeded = await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (!t.todoistId) {
        // Never reached Todoist: drop it and its queued ops locally.
        s.outbox = s.outbox.filter((e) => e.taskId !== id);
        delete s.tasks[id];
        return false;
      }
      this.#touch(t);
      this.#enqueue(s, id, { kind: "delete" });
      return true;
    });
    if (flushNeeded && this.#autoFlush && this.#client) await this.flush().catch(() => undefined);
  }

  /** Send a Backlog item (usually an Obsidian note) to Todoist as a task. */
  async sendBacklogItem(
    item: BacklogItem,
    target: { projectId?: string; sectionId?: string } & DueInput = {},
  ): Promise<FrameTask> {
    const link = item.obsidianPath ? this.obsidianLink(item.obsidianPath) : null;
    const description = [item.notes?.trim(), link ? `Obsidian: ${link}` : null].filter(Boolean).join("\n\n");
    const { projectId, sectionId, ...due } = target;
    return this.createTask(
      {
        content: item.title,
        description: description || undefined,
        labels: item.labels,
        priority: item.priority,
        project_id: projectId,
        section_id: sectionId,
        ...due,
      },
      { obsidianPath: item.obsidianPath },
    );
  }

  obsidianLink(path: string): string | null {
    if (!this.#vaultName) return null;
    return `obsidian://open?vault=${encodeURIComponent(this.#vaultName)}&file=${encodeURIComponent(path.replace(/\.md$/, ""))}`;
  }

  /** Choose which side wins after both changed the same task. */
  async resolveConflict(id: string, keep: "local" | "remote"): Promise<FrameTask> {
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (t.syncState !== "conflict" || !t.conflictRemote) {
        throw new TodoistError("validation", "У задачи нет конфликта");
      }
      if (keep === "remote") {
        s.tasks[id] = { ...t.conflictRemote, id, obsidianPath: t.obsidianPath };
        s.outbox = s.outbox.filter((e) => e.taskId !== id);
      } else {
        t.remoteUpdatedAt = t.conflictRemote.remoteUpdatedAt;
        t.conflictRemote = null;
        t.syncState = "pending";
      }
    });
    return this.#afterWrite(id);
  }

  /** Re-queue a task whose last push was refused (syncState "error"). */
  async retryTask(id: string): Promise<FrameTask> {
    await this.#mutate((s) => {
      const t = mustGet(s, id);
      if (t.syncState !== "error") return;
      t.syncError = null;
      if (!t.todoistId && !s.outbox.some((e) => e.taskId === id && e.kind === "create")) {
        this.#enqueue(s, id, { kind: "create", input: toCreateInput(t) }, true);
      }
      t.syncState = "pending";
    });
    return this.#afterWrite(id);
  }

  // ---------- sync ----------

  /** Full two-way sync: pull from Todoist, then push queued local changes. */
  async sync(): Promise<SyncResult> {
    const result = await this.#syncOnce();
    if (this.#onSync) await this.#onSync(result);
    return result;
  }

  #syncOnce(): Promise<SyncResult> {
    return this.#exclusive(async () => {
      const client = this.#requireClient();
      this.#syncing = true;
      const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, remoteDeleted: 0, error: null };
      const s = await this.#store.load();
      let failure: TodoistError | null = null;
      try {
        await this.#pull(client, s, result);
        await this.#push(client, s, result);
        s.lastError = null;
      } catch (err) {
        failure = toTodoistError(err);
        result.error = { code: failure.code, message: failure.message };
        s.lastError = { ...result.error, at: this.#now().toISOString() };
      } finally {
        this.#syncing = false;
        await this.#store.save(s);
      }
      if (failure) throw failure;
      return result;
    });
  }

  /** Push the outbox only. Never throws for Todoist problems: changes stay queued and the error is returned. */
  flush(): Promise<SyncResult> {
    return this.#exclusive(async () => {
      const client = this.#requireClient();
      const s = await this.#store.load();
      const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, remoteDeleted: 0, error: null };
      try {
        await this.#push(client, s, result);
      } catch (err) {
        const e = toTodoistError(err);
        result.error = { code: e.code, message: e.message };
        s.lastError = { ...result.error, at: this.#now().toISOString() };
      }
      await this.#store.save(s);
      return result;
    });
  }

  /**
   * Periodic background sync. Backs off after errors and honours Retry-After.
   * Returns a stop function.
   */
  startAutoSync(intervalMs = 5 * 60_000, onError?: (e: TodoistError) => void, firstDelayMs = 0): () => void {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    let failures = 0;
    const run = async () => {
      let delay = intervalMs;
      try {
        await this.sync();
        failures = 0;
      } catch (err) {
        const e = toTodoistError(err);
        failures++;
        onError?.(e);
        delay = e.retryAfter
          ? Math.max(e.retryAfter * 1000, intervalMs)
          : Math.min(intervalMs * 2 ** failures, 60 * 60_000);
      }
      if (!stopped) timer = setTimeout(run, delay);
    };
    timer = setTimeout(run, firstDelayMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  async #pull(client: TodoistClient, s: SyncSnapshot, result: SyncResult) {
    const [projects, remote] = await Promise.all([client.listProjects(), client.listTasks()]);
    s.projects = projects.filter((p) => !p.is_archived).map(projectFromTodoist);

    const pendingIds = new Set(s.outbox.map((e) => e.taskId));
    const byTodoist = new Map<string, FrameTask>();
    for (const t of Object.values(s.tasks)) if (t.todoistId) byTodoist.set(t.todoistId, t);
    const seen = new Set<string>();

    for (const r of remote) {
      seen.add(r.id);
      const local = byTodoist.get(r.id);
      if (!local) {
        const t = fromTodoist(r, { localUpdatedAt: this.#now().toISOString() });
        s.tasks[t.id] = t;
        result.pulled++;
        continue;
      }
      const incoming = fromTodoist(r, local);
      const remoteChanged = !!incoming.remoteUpdatedAt && incoming.remoteUpdatedAt !== local.remoteUpdatedAt;
      if (local.syncState === "conflict") {
        local.conflictRemote = incoming;
      } else if (pendingIds.has(local.id)) {
        if (remoteChanged) {
          local.syncState = "conflict";
          local.conflictRemote = incoming;
          result.conflicts++;
        }
      } else if (remoteChanged || local.syncState !== "synced") {
        s.tasks[local.id] = incoming;
        result.pulled++;
      }
    }

    // Local mirrors that are no longer active in Todoist: completed or deleted there.
    const missing = Object.values(s.tasks).filter(
      (t) =>
        t.todoistId &&
        !seen.has(t.todoistId) &&
        !pendingIds.has(t.id) &&
        !t.completed &&
        t.syncState !== "remote_deleted",
    );
    if (missing.length) {
      const now = this.#now();
      // A day of slack on both ends covers clock skew between this machine and Todoist.
      const until = new Date(now.getTime() + DAY);
      const since = new Date(
        Math.max(
          until.getTime() - 89 * DAY, // API window limit
          (s.lastSyncAt ? Date.parse(s.lastSyncAt) : now.getTime() - 30 * DAY) - DAY,
        ),
      );
      // История выполненных на бесплатном тарифе ограничена неделей, а сам запрос может быть
      // недоступен; поэтому всё, чего нет в истории, проверяем по одной задаче.
      const done = await client.listCompletedTasks(since.toISOString(), until.toISOString()).catch(() => []);
      const doneById = new Map(done.map((d) => [d.id, d]));
      let checks = 0;
      for (const t of missing) {
        let d: TodoistTask | null | undefined = doneById.get(t.todoistId!);
        if (!d) {
          if (checks++ >= MAX_SINGLE_CHECKS) continue; // остальные проверим при следующей синхронизации
          try {
            d = await client.getTask(t.todoistId!);
          } catch (err) {
            if (toTodoistError(err).code !== "not_found") throw err;
            d = null;
          }
        }
        if (d && (d.checked || d.completed_at)) {
          t.completed = true;
          t.completedAt = d.completed_at ?? now.toISOString();
          t.syncState = "synced";
          result.pulled++;
        } else if (d === null || (d && d.is_deleted)) {
          t.syncState = "remote_deleted";
          result.remoteDeleted++;
        }
        // Задача активна, но не пришла в списке (например, гонка с правкой): оставляем как есть.
      }
    }
    s.lastSyncAt = this.#now().toISOString();
  }

  async #push(client: TodoistClient, s: SyncSnapshot, result: SyncResult) {
    const blocked = new Set<string>();
    const queue = [...s.outbox];
    for (const entry of queue) {
      const t = s.tasks[entry.taskId];
      if (!t) {
        s.outbox = s.outbox.filter((e) => e.opId !== entry.opId);
        continue;
      }
      if (blocked.has(t.id) || t.syncState === "conflict" || (entry.kind !== "create" && !t.todoistId)) {
        blocked.add(t.id);
        continue;
      }
      try {
        await this.#apply(client, s, t, entry);
        s.outbox = s.outbox.filter((e) => e.opId !== entry.opId);
        result.pushed++;
        const cur = s.tasks[t.id];
        if (cur && !s.outbox.some((e) => e.taskId === t.id) && cur.syncState === "pending") {
          cur.syncState = "synced";
        }
      } catch (err) {
        const e = toTodoistError(err);
        entry.attempts++;
        const stored = s.outbox.find((x) => x.opId === entry.opId);
        if (stored) stored.attempts = entry.attempts;
        if (e.retryable || e.code === "unauthorized" || e.code === "not_configured") {
          // Whole queue waits: the next sync retries in order.
          throw e;
        }
        if (e.code === "not_found") {
          if (entry.kind === "delete") {
            delete s.tasks[t.id];
          } else {
            t.syncState = "remote_deleted";
            result.remoteDeleted++;
          }
          s.outbox = s.outbox.filter((x) => x.taskId !== t.id);
          continue;
        }
        t.syncState = "error";
        t.syncError = { code: e.code, message: e.code === "plan_limit" ? USER_MESSAGES.plan_limit : e.message };
        s.outbox = s.outbox.filter((x) => x.opId !== entry.opId);
        blocked.add(t.id);
      }
    }
  }

  async #apply(client: TodoistClient, s: SyncSnapshot, t: FrameTask, entry: OutboxEntry) {
    const keep = { id: t.id, obsidianPath: t.obsidianPath, localUpdatedAt: t.localUpdatedAt };
    switch (entry.kind) {
      case "create": {
        const created = await client.createTask(entry.input);
        s.tasks[t.id] = { ...fromTodoist(created, keep), syncState: "pending" };
        return;
      }
      case "update": {
        const updated = await client.updateTask(t.todoistId!, entry.input);
        const fresh = fromTodoist(updated, keep);
        // Keep local completion state; update responses describe the task, not later ops.
        s.tasks[t.id] = { ...fresh, completed: t.completed, completedAt: t.completedAt, syncState: "pending" };
        return;
      }
      case "close": {
        await client.closeTask(t.todoistId!);
        if (t.due?.recurring) {
          // Todoist moved it to the next occurrence; fetch the new date.
          const next = await client.getTask(t.todoistId!);
          s.tasks[t.id] = { ...fromTodoist(next, keep), syncState: "pending" };
        } else {
          t.completed = true;
          t.completedAt ??= this.#now().toISOString();
        }
        return;
      }
      case "reopen":
        await client.reopenTask(t.todoistId!);
        t.completed = false;
        t.completedAt = null;
        return;
      case "move":
        await client.moveTask(t.todoistId!, entry.input);
        return;
      case "delete":
        await client.deleteTask(t.todoistId!);
        delete s.tasks[t.id];
        return;
    }
  }

  // ---------- helpers ----------

  #requireClient(): TodoistClient {
    if (!this.#client) throw new TodoistError("not_configured", "API-токен Todoist не найден");
    return this.#client;
  }

  #enqueue(s: SyncSnapshot, taskId: string, op: OutboxOp, front = false) {
    const entry = { ...op, opId: randomUUID(), taskId, createdAt: this.#now().toISOString(), attempts: 0 } as OutboxEntry;
    if (front) s.outbox.unshift(entry);
    else s.outbox.push(entry);
    const t = s.tasks[taskId];
    if (t && t.syncState !== "conflict") t.syncState = "pending";
  }

  #touch(t: FrameTask) {
    t.localUpdatedAt = this.#now().toISOString();
  }

  async #mutate<R>(fn: (s: SyncSnapshot) => R): Promise<R> {
    return this.#exclusive(async () => {
      const s = await this.#store.load();
      const r = fn(s);
      await this.#store.save(s);
      return r;
    });
  }

  async #afterWrite(id: string): Promise<FrameTask> {
    if (this.#autoFlush && this.#client) await this.flush().catch(() => undefined);
    const t = await this.getTask(id);
    if (!t) throw new TodoistError("not_found", "Задача не найдена");
    return t;
  }

  /** Serialises all reads-modify-writes of the store. */
  #exclusive<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.#lock.then(fn, fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }
}

const DAY = 86_400_000;
/** Сколько пропавших задач проверять по одной за синхронизацию (бережём лимит запросов). */
const MAX_SINGLE_CHECKS = 30;

function mustGet(s: SyncSnapshot, id: string): FrameTask {
  const t = s.tasks[id];
  if (!t) throw new TodoistError("not_found", "Задача не найдена");
  return t;
}

function assertDue(d: DueInput) {
  const n = [d.due_string, d.due_date, d.due_datetime].filter((v) => v !== undefined).length;
  if (n > 1) throw new TodoistError("validation", "Укажите срок одним способом: текстом, датой или датой со временем");
  if (d.due_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) {
    throw new TodoistError("validation", "Дата должна быть в формате ГГГГ-ММ-ДД");
  }
  if (d.due_datetime !== undefined && Number.isNaN(Date.parse(d.due_datetime))) {
    throw new TodoistError("validation", "Неверная дата со временем");
  }
}

/** Best local guess until Todoist parses the date; replaced on the next push. */
function localDue(d: DueInput): FrameTask["due"] {
  if (d.due_date) return { date: d.due_date, datetime: null, string: null, recurring: false, timezone: null };
  if (d.due_datetime) {
    return { date: d.due_datetime.slice(0, 10), datetime: d.due_datetime, string: null, recurring: false, timezone: null };
  }
  if (d.due_string) {
    return {
      date: "",
      datetime: null,
      string: d.due_string,
      recurring: /\b(every|each)\b|кажд|ежедн|еженед|ежемес/i.test(d.due_string),
      timezone: null,
    };
  }
  return null;
}

function toCreateInput(t: FrameTask): CreateTaskInput {
  const input: CreateTaskInput = {
    content: t.title,
    description: t.notes || undefined,
    project_id: t.projectId ?? undefined,
    section_id: t.sectionId ?? undefined,
    parent_id: t.parentId ?? undefined,
    labels: t.labels.length ? t.labels : undefined,
    priority: t.priority,
    deadline_date: t.deadline ?? undefined,
  };
  if (t.due?.string) input.due_string = t.due.string;
  else if (t.due?.datetime) input.due_datetime = t.due.datetime;
  else if (t.due?.date) input.due_date = t.due.date;
  return input;
}

export function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function byDueThenPriority(a: FrameTask, b: FrameTask) {
  const da = a.due?.datetime ?? a.due?.date ?? "9999";
  const db = b.due?.datetime ?? b.due?.date ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  return b.priority - a.priority;
}
