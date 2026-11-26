import type { TodoistProject, TodoistTask } from "../src/types.ts";

/**
 * In-memory stand-in for the Todoist API v1, used as `fetch` in tests.
 * It never touches the network. Failures can be scripted per call.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

type Failure = { status: number; body?: string; headers?: Record<string, string> } | "network";

export class FakeTodoist {
  tasks = new Map<string, TodoistTask>();
  completed: TodoistTask[] = [];
  projects: TodoistProject[] = [
    { id: "p_inbox", name: "Inbox", color: "grey", parent_id: null, is_favorite: false, is_archived: false, inbox_project: true },
    { id: "p_work", name: "Работа", color: "blue", parent_id: null, is_favorite: true, is_archived: false },
  ];
  requests: RecordedRequest[] = [];
  /** Scripted failures, consumed one per matching request. */
  failures: { match: (r: RecordedRequest) => boolean; fail: Failure }[] = [];
  /** Pretend the API returns at most this many items per page. */
  pageSize = 200;
  seenRequestIds = new Map<string, unknown>();
  #seq = 100;
  #clock = Date.parse("2026-11-24T10:00:00Z");

  failNext(match: (r: RecordedRequest) => boolean, fail: Failure, times = 1) {
    for (let i = 0; i < times; i++) this.failures.push({ match, fail });
  }

  addTask(partial: Partial<TodoistTask> & { content: string }): TodoistTask {
    const t: TodoistTask = {
      id: String(this.#seq++),
      description: "",
      project_id: "p_inbox",
      section_id: null,
      parent_id: null,
      labels: [],
      priority: 1,
      due: null,
      deadline: null,
      duration: null,
      checked: false,
      completed_at: null,
      added_at: this.#tick(),
      updated_at: this.#tick(),
      ...partial,
    };
    this.tasks.set(t.id, t);
    return t;
  }

  /** Simulate an edit made in the Todoist app. */
  editRemote(id: string, patch: Partial<TodoistTask>) {
    const t = this.tasks.get(id)!;
    Object.assign(t, patch, { updated_at: this.#tick() });
  }

  completeRemote(id: string) {
    const t = this.tasks.get(id)!;
    this.tasks.delete(id);
    this.completed.push({ ...t, checked: true, completed_at: this.#tick() });
  }

  #tick() {
    this.#clock += 1000;
    return new Date(this.#clock).toISOString();
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const req: RecordedRequest = {
      method: init.method ?? "GET",
      path: url.pathname.replace(/^\/api\/v1/, ""),
      query: url.searchParams,
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    this.requests.push(req);

    const i = this.failures.findIndex((f) => f.match(req));
    if (i >= 0) {
      const { fail } = this.failures.splice(i, 1)[0]!;
      if (fail === "network") throw new TypeError("fetch failed");
      return new Response(fail.body ?? "error", { status: fail.status, headers: fail.headers });
    }
    if (headers.Authorization !== "Bearer good-token") return new Response("Forbidden", { status: 401 });

    const rid = headers["X-Request-Id"];
    if (rid && this.seenRequestIds.has(rid)) return json(this.seenRequestIds.get(rid));
    const out = this.#route(req);
    if (rid && out.status < 300) this.seenRequestIds.set(rid, out.data);
    return out.status === 204 ? new Response(null, { status: 204 }) : json(out.data, out.status);
  };

  #route(r: RecordedRequest): { status: number; data?: unknown } {
    const seg = r.path.split("/").filter(Boolean);
    const [a, id, action] = seg;
    const m = r.method;
    if (a === "projects" && m === "GET") return this.#page(this.projects, r);
    if (a === "projects" && m === "POST") {
      const p = { id: `p_${this.#seq++}`, color: "grey", parent_id: null, is_favorite: false, is_archived: false, ...r.body };
      this.projects.push(p);
      return { status: 200, data: p };
    }
    if (a !== "tasks") return { status: 404, data: "not found" };

    if (id === "completed" && action === "by_completion_date") {
      const since = r.query.get("since")!;
      const until = r.query.get("until")!;
      const items = this.completed.filter((t) => t.completed_at! >= since && t.completed_at! <= until);
      return { status: 200, data: { items, next_cursor: null } };
    }
    if (!id && m === "GET") return this.#page([...this.tasks.values()], r);
    if (!id && m === "POST") {
      if (!r.body?.content) return { status: 400, data: "content required" };
      const { due_string, due_date, due_datetime, due_lang, deadline_date, ...rest } = r.body;
      const t = this.addTask({ ...rest, due: fakeDue(due_string, due_date, due_datetime), deadline: deadline_date ? { date: deadline_date } : null });
      return { status: 200, data: t };
    }
    const t = this.tasks.get(id!);
    if (!t && !action && m === "GET") {
      const done = this.completed.find((c) => c.id === id);
      return done ? { status: 200, data: done } : { status: 404, data: "Task not found" };
    }
    if (!t) return { status: 404, data: "Task not found" };
    if (!action && m === "GET") return { status: 200, data: t };
    if (!action && m === "DELETE") {
      this.tasks.delete(id!);
      return { status: 204 };
    }
    if (!action && m === "POST") {
      const { due_string, due_date, due_datetime, due_lang, deadline_date, ...rest } = r.body ?? {};
      if (due_string === "no date") t.due = null;
      else if (due_string || due_date || due_datetime) t.due = fakeDue(due_string, due_date, due_datetime);
      Object.assign(t, rest, { updated_at: this.#tick() });
      return { status: 200, data: t };
    }
    if (action === "close") {
      if (t.due?.is_recurring) {
        const d = new Date(`${t.due.date.slice(0, 10)}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 7);
        t.due = { ...t.due, date: d.toISOString().slice(0, 10) };
        t.updated_at = this.#tick();
      } else {
        this.completeRemote(id!);
      }
      return { status: 204 };
    }
    if (action === "reopen") return { status: 204 };
    if (action === "move") {
      Object.assign(t, r.body, { updated_at: this.#tick() });
      return { status: 204 };
    }
    return { status: 404, data: "unknown" };
  }

  #page<T>(all: T[], r: RecordedRequest) {
    const start = Number(r.query.get("cursor") ?? 0);
    const slice = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize < all.length ? String(start + this.pageSize) : null;
    return { status: 200, data: { results: slice, next_cursor: next } };
  }
}

function fakeDue(s?: string, date?: string, datetime?: string): TodoistTask["due"] {
  if (date) return { date, string: date, is_recurring: false };
  if (datetime) return { date: datetime, string: datetime, is_recurring: false };
  if (!s) return null;
  if (s === "tomorrow" || s === "завтра") return { date: "2026-11-25", string: s, is_recurring: false, lang: "ru" };
  if (/every|кажд/i.test(s)) return { date: "2026-11-24", string: s, is_recurring: true };
  return { date: "2026-11-24", string: s, is_recurring: false };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
