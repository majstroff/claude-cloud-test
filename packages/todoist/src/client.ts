import { randomUUID } from "node:crypto";
import { TodoistError } from "./errors.ts";
import type {
  CreateProjectInput,
  CreateTaskInput,
  MoveTaskInput,
  Page,
  TodoistLabel,
  TodoistProject,
  TodoistSection,
  TodoistTask,
  UpdateTaskInput,
} from "./types.ts";

export const TODOIST_API_URL = "https://api.todoist.com/api/v1";

export interface TodoistClientOptions {
  token: string;
  baseUrl?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests. Defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Retries for 429, 5xx and network errors. Default 3. */
  maxRetries?: number;
  /** Base for exponential backoff, ms. Default 500. */
  backoffMs?: number;
  /** Longest wait we accept inside one call, ms. Longer Retry-After → error. Default 60 000. */
  maxWaitMs?: number;
  /** Per-request timeout, ms. Default 15 000. */
  timeoutMs?: number;
}

type Query = Record<string, string | number | undefined>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Minimal, dependency-free Todoist API v1 client.
 *
 * - Retries 429 (honouring Retry-After), 5xx and network errors with backoff.
 * - Sends one X-Request-Id per logical write, so Todoist dedupes retried writes.
 * - Never puts the token into error messages or anything it returns.
 */
export class TodoistClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxRetries: number;
  readonly #backoffMs: number;
  readonly #maxWaitMs: number;
  readonly #timeoutMs: number;

  constructor(opts: TodoistClientOptions) {
    if (!opts.token || !opts.token.trim()) {
      throw new TodoistError("not_configured", "Пустой API-токен Todoist");
    }
    this.#token = opts.token.trim();
    this.#baseUrl = (opts.baseUrl ?? TODOIST_API_URL).replace(/\/+$/, "");
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#backoffMs = opts.backoffMs ?? 500;
    this.#maxWaitMs = opts.maxWaitMs ?? 60_000;
    this.#timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** Keeps the token out of console.log / JSON.stringify / util.inspect. */
  toJSON() {
    return { baseUrl: this.#baseUrl, token: "[redacted]" };
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `TodoistClient { baseUrl: '${this.#baseUrl}', token: [redacted] }`;
  }

  // ---------- tasks ----------

  /** All active (not completed) tasks, all pages. */
  listTasks(filter: { project_id?: string; section_id?: string; label?: string; ids?: string[] } = {}) {
    return this.#paginate<TodoistTask>("/tasks", {
      project_id: filter.project_id,
      section_id: filter.section_id,
      label: filter.label,
      ids: filter.ids?.join(","),
    });
  }

  /** Active tasks matching a Todoist filter query, e.g. "today | overdue". */
  filterTasks(query: string, lang?: string) {
    return this.#paginate<TodoistTask>("/tasks/filter", { query, lang });
  }

  async getTask(id: string) {
    return this.#request<TodoistTask>("GET", `/tasks/${enc(id)}`);
  }

  async createTask(input: CreateTaskInput) {
    assertOneDue(input);
    if (!input.content?.trim()) throw new TodoistError("validation", "Название задачи не может быть пустым");
    return this.#request<TodoistTask>("POST", "/tasks", { body: compact(input) });
  }

  /** Parses Todoist Quick Add syntax: "Купить молоко завтра #Дом p1". */
  async quickAdd(text: string) {
    return this.#request<TodoistTask>("POST", "/tasks/quick", { body: { text, meta: true } });
  }

  /** Pass `clearDue: true` to remove the due date. */
  async updateTask(id: string, input: UpdateTaskInput & { clearDue?: boolean }) {
    const { clearDue, ...rest } = input;
    assertOneDue(rest);
    const body: Record<string, unknown> = compact(rest);
    if (clearDue) body.due_string = "no date";
    return this.#request<TodoistTask>("POST", `/tasks/${enc(id)}`, { body });
  }

  /** For recurring tasks Todoist moves the due date to the next occurrence. */
  async closeTask(id: string) {
    await this.#request<unknown>("POST", `/tasks/${enc(id)}/close`);
  }

  async reopenTask(id: string) {
    await this.#request<unknown>("POST", `/tasks/${enc(id)}/reopen`);
  }

  async moveTask(id: string, to: MoveTaskInput) {
    if (!to.project_id && !to.section_id && !to.parent_id) {
      throw new TodoistError("validation", "Укажите проект, раздел или родительскую задачу");
    }
    await this.#request<unknown>("POST", `/tasks/${enc(id)}/move`, { body: compact(to) });
  }

  async deleteTask(id: string) {
    await this.#request<unknown>("DELETE", `/tasks/${enc(id)}`);
  }

  /** Tasks completed in [since, until] (ISO datetimes). Todoist caps the window at ~3 months. */
  async listCompletedTasks(since: string, until: string, project_id?: string) {
    return this.#paginate<TodoistTask>(
      "/tasks/completed/by_completion_date",
      { since, until, project_id },
      "items",
    );
  }

  // ---------- projects, sections, labels ----------

  listProjects() {
    return this.#paginate<TodoistProject>("/projects", {});
  }

  async createProject(input: CreateProjectInput) {
    if (!input.name?.trim()) throw new TodoistError("validation", "Название проекта не может быть пустым");
    return this.#request<TodoistProject>("POST", "/projects", { body: compact(input) });
  }

  listSections(project_id?: string) {
    return this.#paginate<TodoistSection>("/sections", { project_id });
  }

  listLabels() {
    return this.#paginate<TodoistLabel>("/labels", {});
  }

  // ---------- transport ----------

  async #paginate<T>(path: string, query: Query, field: "results" | "items" = "results"): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;
    // Hard stop protects against a server that keeps returning the same cursor.
    for (let page = 0; page < 500; page++) {
      const data: Record<string, unknown> = await this.#request("GET", path, {
        query: { ...query, limit: 200, cursor: cursor ?? undefined },
      });
      const items = data?.[field];
      if (!Array.isArray(items)) {
        throw new TodoistError("unexpected", `Todoist вернул ответ без списка «${field}» для ${path}`);
      }
      all.push(...(items as T[]));
      const next = (data as Partial<Page<T>>).next_cursor ?? null;
      if (!next || next === cursor) return all;
      cursor = next;
    }
    throw new TodoistError("unexpected", `Слишком много страниц в ответе Todoist для ${path}`);
  }

  async #request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.#baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#token}` };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // Same id on every retry: Todoist ignores a write it has already applied.
    if (method !== "GET") headers["X-Request-Id"] = randomUUID();
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (cause) {
        const err = new TodoistError("network", `Нет связи с Todoist (${method} ${path})`, {
          cause: redactError(cause, this.#token),
        });
        if (attempt < this.#maxRetries) {
          await this.#sleep(this.#backoff(attempt++));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new TodoistError("unexpected", `Todoist вернул некорректный ответ (${method} ${path})`, {
            status: res.status,
          });
        }
      }

      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const detail = redact(await safeText(res), this.#token);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.#maxRetries) {
        const wait = retryAfter !== undefined ? retryAfter * 1000 : this.#backoff(attempt);
        if (wait <= this.#maxWaitMs) {
          attempt++;
          await this.#sleep(wait);
          continue;
        }
      }
      throw httpError(res.status, method, path, detail, retryAfter);
    }
  }

  #backoff(attempt: number) {
    const base = this.#backoffMs * 2 ** attempt;
    return Math.min(this.#maxWaitMs, base + Math.floor(Math.random() * this.#backoffMs));
  }
}

function httpError(status: number, method: string, path: string, detail: string, retryAfter?: number) {
  const where = `Todoist ответил ${status} на ${method} ${path}${detail ? `: ${detail}` : ""}`;
  // Ограничения тарифа Todoist приходят как 403 (иногда 400) с текстом про лимит или Pro.
  if ((status === 403 || status === 400 || status === 422) && PLAN_LIMIT_RE.test(detail)) {
    return new TodoistError("plan_limit", where, { status });
  }
  if (status === 401 || status === 403) return new TodoistError("unauthorized", where, { status });
  if (status === 404) return new TodoistError("not_found", where, { status });
  if (status === 429) return new TodoistError("rate_limited", where, { status, retryAfter });
  if (status >= 500) return new TodoistError("server", where, { status, retryAfter });
  if (status === 400 || status === 422) return new TodoistError("validation", where, { status });
  return new TodoistError("unexpected", where, { status });
}

const PLAN_LIMIT_RE = /limit|premium|upgrade|pro plan|maximum|max_|read[-_ ]?only|view[-_ ]?only/i;

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function safeText(res: Response) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export function redact(s: string, token: string) {
  return token ? s.split(token).join("[redacted]") : s;
}

function redactError(err: unknown, token: string) {
  if (err instanceof Error) {
    const copy = new Error(redact(err.message, token));
    copy.name = err.name;
    return copy;
  }
  return redact(String(err), token);
}

function assertOneDue(input: { due_string?: string; due_date?: string; due_datetime?: string }) {
  const n = [input.due_string, input.due_date, input.due_datetime].filter((v) => v !== undefined).length;
  if (n > 1) throw new TodoistError("validation", "Укажите срок одним способом: текстом, датой или датой со временем");
  if (input.due_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) {
    throw new TodoistError("validation", "Дата должна быть в формате ГГГГ-ММ-ДД");
  }
}

function compact<T extends object>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

const enc = encodeURIComponent;
