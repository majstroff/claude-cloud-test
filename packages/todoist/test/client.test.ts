import { inspect } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { TodoistClient } from "../src/client.ts";
import { TodoistError } from "../src/errors.ts";
import { FakeTodoist } from "./fake-todoist.ts";

let api: FakeTodoist;
let sleeps: number[];
const make = (token = "good-token", extra = {}) =>
  new TodoistClient({
    token,
    fetch: api.fetch as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    backoffMs: 10,
    ...extra,
  });

beforeEach(() => {
  api = new FakeTodoist();
  sleeps = [];
});

describe("TodoistClient", () => {
  it("lists tasks across all pages", async () => {
    api.pageSize = 2;
    for (let i = 0; i < 5; i++) api.addTask({ content: `t${i}` });
    const tasks = await make().listTasks();
    expect(tasks.map((t) => t.content)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(api.requests.filter((r) => r.path === "/tasks")).toHaveLength(3);
    expect(api.requests[1]!.query.get("cursor")).toBe("2");
  });

  it("sends the bearer token, JSON body and an X-Request-Id on writes", async () => {
    const t = await make().createTask({ content: "Позвонить", due_string: "завтра", due_lang: "ru", priority: 4 });
    expect(t.due?.date).toBe("2026-11-25");
    const req = api.requests.at(-1)!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/tasks");
    expect(req.headers.Authorization).toBe("Bearer good-token");
    expect(req.headers["X-Request-Id"]).toMatch(/[0-9a-f-]{36}/);
    expect(req.body).toEqual({ content: "Позвонить", due_string: "завтра", due_lang: "ru", priority: 4 });
  });

  it("updates, clears the due date, closes, reopens, moves and deletes", async () => {
    const c = make();
    const t = await c.createTask({ content: "A", due_date: "2026-12-01" });
    expect((await c.updateTask(t.id, { content: "B" })).content).toBe("B");
    expect((await c.updateTask(t.id, { clearDue: true })).due).toBeNull();
    expect(api.requests.at(-1)!.body).toEqual({ due_string: "no date" });
    await c.moveTask(t.id, { project_id: "p_work" });
    expect(api.tasks.get(t.id)!.project_id).toBe("p_work");
    await c.closeTask(t.id);
    expect(api.tasks.has(t.id)).toBe(false);
    const u = await c.createTask({ content: "C" });
    await c.deleteTask(u.id);
    expect(api.tasks.has(u.id)).toBe(false);
  });

  it("closing a recurring task moves it to the next date", async () => {
    const c = make();
    const t = await c.createTask({ content: "Тренировка", due_string: "every monday" });
    await c.closeTask(t.id);
    expect((await c.getTask(t.id)).due).toMatchObject({ date: "2026-12-01", is_recurring: true });
  });

  it("validates input before calling the API", async () => {
    const c = make();
    await expect(c.createTask({ content: "  " })).rejects.toMatchObject({ code: "validation" });
    await expect(c.createTask({ content: "x", due_date: "2026-01-01", due_string: "today" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(c.createTask({ content: "x", due_date: "01.01.2026" })).rejects.toMatchObject({ code: "validation" });
    await expect(c.moveTask("1", {})).rejects.toMatchObject({ code: "validation" });
    expect(api.requests).toHaveLength(0);
  });

  it("retries 429 honouring Retry-After, with the same X-Request-Id", async () => {
    api.failNext((r) => r.method === "POST", { status: 429, headers: { "Retry-After": "2" } });
    const t = await make().createTask({ content: "x" });
    expect(t.content).toBe("x");
    expect(sleeps).toEqual([2000]);
    const posts = api.requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers["X-Request-Id"]).toBe(posts[1]!.headers["X-Request-Id"]);
  });

  it("gives up with rate_limited when Retry-After is too long", async () => {
    api.failNext(() => true, { status: 429, headers: { "Retry-After": "900" } });
    const err = await make().listProjects().catch((e) => e);
    expect(err).toBeInstanceOf(TodoistError);
    expect(err).toMatchObject({ code: "rate_limited", retryAfter: 900, retryable: true });
    expect(sleeps).toEqual([]);
  });

  it("retries 5xx and network errors with backoff, then fails", async () => {
    api.failNext(() => true, { status: 503 });
    api.failNext(() => true, "network");
    expect(await make().listProjects()).toHaveLength(2);
    expect(sleeps).toHaveLength(2);

    api.failNext(() => true, "network", 4);
    await expect(make().listProjects()).rejects.toMatchObject({ code: "network", retryable: true });
  });

  it("maps HTTP errors to codes without retrying", async () => {
    await expect(make("bad-token").listTasks()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    await expect(make().getTask("nope")).rejects.toMatchObject({ code: "not_found", status: 404 });
    api.failNext(() => true, { status: 400, body: "bad" });
    await expect(make().createTask({ content: "x" })).rejects.toMatchObject({ code: "validation" });
    expect(sleeps).toEqual([]);
  });

  it("recognises free-plan limits instead of blaming the token", async () => {
    api.failNext(() => true, { status: 403, body: '{"error":"Maximum number of projects reached","error_tag":"MAX_PROJECTS_LIMIT_REACHED"}' });
    await expect(make().createProject({ name: "Шестой" })).rejects.toMatchObject({ code: "plan_limit", retryable: false });
    api.failNext(() => true, { status: 403, body: "Forbidden" });
    await expect(make().listProjects()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("never leaks the token in errors, JSON or inspect output", async () => {
    const secret = "good-token";
    api.failNext(() => true, { status: 400, body: `invalid token ${secret}` });
    const c = make(secret);
    const err: TodoistError = await c.listTasks().catch((e) => e);
    expect(err.message).not.toContain(secret);
    expect(err.message).toContain("[redacted]");
    expect(JSON.stringify(c)).not.toContain(secret);
    expect(inspect(c)).not.toContain(secret);
  });

  it("refuses an empty token", () => {
    expect(() => new TodoistClient({ token: " " })).toThrow(TodoistError);
  });

  it("reads completed tasks from the items field", async () => {
    const t = api.addTask({ content: "done" });
    api.completeRemote(t.id);
    const done = await make().listCompletedTasks("2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");
    expect(done.map((d) => d.content)).toEqual(["done"]);
  });
});
