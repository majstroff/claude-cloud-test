import type { IncomingMessage, ServerResponse } from "node:http";
import { TodoistError, USER_MESSAGES, toTodoistError } from "./errors.ts";
import type { TaskView, TodoistSyncService } from "./service.ts";

/**
 * Framework-agnostic JSON API for the Todoist module, mounted under /api/todoist.
 *
 *   GET    /api/todoist/status
 *   POST   /api/todoist/sync
 *   GET    /api/todoist/projects
 *   GET    /api/todoist/tasks?view=today|overdue|upcoming|backlog|completed|all&project=&label=&q=&days=
 *   POST   /api/todoist/tasks                      CreateTaskInput (+ obsidianPath)
 *   GET    /api/todoist/tasks/:id
 *   PATCH  /api/todoist/tasks/:id                  UpdateTaskInput (+ clearDue)
 *   POST   /api/todoist/tasks/:id/complete
 *   POST   /api/todoist/tasks/:id/reopen
 *   POST   /api/todoist/tasks/:id/move             { project_id | section_id | parent_id }
 *   POST   /api/todoist/tasks/:id/resolve          { keep: "local" | "remote" }
 *   POST   /api/todoist/tasks/:id/retry
 *   DELETE /api/todoist/tasks/:id                  { confirmed: true }   ← required
 *   POST   /api/todoist/backlog/send               { item: BacklogItem, target?: {...} }
 */

export interface ApiRequest {
  method: string;
  path: string;
  query?: URLSearchParams;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const VIEWS = new Set<TaskView>(["today", "overdue", "upcoming", "backlog", "completed", "all"]);
const PREFIX = "/api/todoist";
const LOCAL_CODES = new Set(["validation", "not_found", "confirmation_required"]);

export async function handleTodoistApi(svc: TodoistSyncService, req: ApiRequest): Promise<ApiResponse | null> {
  if (!req.path.startsWith(PREFIX)) return null;
  const parts = req.path.slice(PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method.toUpperCase();
  const q = req.query ?? new URLSearchParams();
  const body = (req.body ?? {}) as Record<string, any>;

  try {
    const [a, id, action] = parts;
    if (a === "status" && m === "GET" && !id) return ok(await svc.status());
    if (a === "sync" && m === "POST" && !id) return ok(await svc.sync());
    if (a === "projects" && m === "GET" && !id) return ok(await svc.listProjects());

    if (a === "backlog" && id === "send" && m === "POST") {
      if (!body.item?.title) throw new TodoistError("validation", "Не указано название задачи (item.title)");
      return created(await svc.sendBacklogItem(body.item, body.target ?? {}));
    }

    if (a === "tasks") {
      if (!id) {
        if (m === "GET") {
          const view = (q.get("view") ?? "all") as TaskView;
          if (!VIEWS.has(view)) throw new TodoistError("validation", `Неизвестный список задач: ${view}`);
          return ok(
            await svc.listTasks({
              view,
              projectId: q.get("project") ?? undefined,
              label: q.get("label") ?? undefined,
              search: q.get("q") ?? undefined,
              days: q.has("days") ? Number(q.get("days")) : undefined,
            }),
          );
        }
        if (m === "POST") {
          const { obsidianPath, ...input } = body;
          return created(await svc.createTask(input as any, { obsidianPath }));
        }
      } else if (!action) {
        if (m === "GET") {
          const t = await svc.getTask(id);
          if (!t) throw new TodoistError("not_found", "Задача не найдена");
          return ok(t);
        }
        if (m === "PATCH") return ok(await svc.updateTask(id, body));
        if (m === "DELETE") {
          await svc.deleteTask(id, { confirmed: body.confirmed === true });
          return { status: 204, body: null };
        }
      } else if (m === "POST") {
        if (action === "complete") return ok(await svc.completeTask(id));
        if (action === "reopen") return ok(await svc.reopenTask(id));
        if (action === "move") return ok(await svc.moveTask(id, body));
        if (action === "retry") return ok(await svc.retryTask(id));
        if (action === "resolve") {
          if (body.keep !== "local" && body.keep !== "remote") {
            throw new TodoistError("validation", 'Укажите, какую версию оставить: keep = "local" или "remote"');
          }
          return ok(await svc.resolveConflict(id, body.keep));
        }
      }
    }
    return { status: 404, body: { error: { code: "route_not_found", message: `Нет такого метода API: ${m} ${req.path}` } } };
  } catch (err) {
    return errorResponse(err);
  }
}

export function errorResponse(err: unknown): ApiResponse {
  const e = toTodoistError(err);
  const status: Record<string, number> = {
    not_configured: 503,
    unauthorized: 502,
    not_found: 404,
    validation: 400,
    rate_limited: 429,
    server: 502,
    network: 503,
    conflict: 409,
    confirmation_required: 428,
    unexpected: 500,
  };
  return {
    status: status[e.code] ?? 500,
    body: {
      error: {
        ...e.toJSON(),
        // Проверки на нашей стороне дают точный текст; ответы Todoist — общий понятный.
        userMessage: e.status === undefined && LOCAL_CODES.has(e.code) ? e.message : USER_MESSAGES[e.code],
      },
    },
  };
}

/** Adapter for a plain node:http server. Returns false when the route is not ours. */
export function createNodeHandler(svc: TodoistSyncService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(PREFIX)) return false;
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      send(res, { status: 400, body: { error: { code: "validation", message: "Некорректный JSON в запросе" } } });
      return true;
    }
    const out = (await handleTodoistApi(svc, {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body,
    }))!;
    send(res, out);
    return true;
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function send(res: ServerResponse, out: ApiResponse) {
  res.statusCode = out.status;
  if (out.status === 204) return void res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(out.body));
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const created = (body: unknown): ApiResponse => ({ status: 201, body });
