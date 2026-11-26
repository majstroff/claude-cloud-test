import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TodoistClient } from "../src/client.ts";
import { createNodeHandler } from "../src/http.ts";
import { TodoistSyncService } from "../src/service.ts";
import { MemoryStore } from "../src/store.ts";
import { FakeTodoist } from "./fake-todoist.ts";

const api = new FakeTodoist();
const svc = new TodoistSyncService({
  client: new TodoistClient({ token: "good-token", fetch: api.fetch as typeof fetch, maxRetries: 0 }),
  store: new MemoryStore(),
  timeZone: "UTC",
  now: () => new Date("2026-11-24T10:00:00Z"),
});
const handler = createNodeHandler(svc);
const server = createServer(async (req, res) => {
  if (!(await handler(req, res))) {
    res.statusCode = 418;
    res.end();
  }
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe("HTTP API /api/todoist", () => {
  it("runs the main flow end to end", async () => {
    api.addTask({ content: "Из Todoist", due: { date: "2026-11-24", string: "today", is_recurring: false } });
    expect((await call("POST", "/api/todoist/sync")).body).toMatchObject({ pulled: 1 });
    expect((await call("GET", "/api/todoist/tasks?view=today")).body).toHaveLength(1);

    const created = await call("POST", "/api/todoist/tasks", { content: "Новая", due_date: "2026-11-24" });
    expect(created.status).toBe(201);
    const id = created.body.id;

    expect((await call("PATCH", `/api/todoist/tasks/${id}`, { priority: 4 })).body.priority).toBe(4);
    expect((await call("POST", `/api/todoist/tasks/${id}/complete`)).body.completed).toBe(true);
    expect((await call("POST", `/api/todoist/tasks/${id}/reopen`)).body.completed).toBe(false);
    expect((await call("GET", "/api/todoist/projects")).body).toHaveLength(2);

    const backlog = await call("POST", "/api/todoist/backlog/send", { item: { title: "Идея" } });
    expect(backlog.status).toBe(201);
    expect(backlog.body.syncState).toBe("synced");

    expect((await call("GET", "/api/todoist/status")).body).toMatchObject({ configured: true, pending: 0 });
  });

  it("requires confirmation to delete", async () => {
    const { body } = await call("POST", "/api/todoist/tasks", { content: "Удалить" });
    const refused = await call("DELETE", `/api/todoist/tasks/${body.id}`);
    expect(refused.status).toBe(428);
    expect(refused.body.error.code).toBe("confirmation_required");
    expect((await call("DELETE", `/api/todoist/tasks/${body.id}`, { confirmed: true })).status).toBe(204);
  });

  it("returns typed errors with a user message", async () => {
    const bad = await call("POST", "/api/todoist/tasks", { content: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: "validation", retryable: false });
    expect(bad.body.error.userMessage).toBe("Название задачи не может быть пустым");
    expect((await call("GET", "/api/todoist/tasks?view=bogus")).status).toBe(400);
    expect((await call("GET", "/api/todoist/tasks/missing")).status).toBe(404);
    expect((await call("GET", "/api/todoist/nope")).status).toBe(404);
  });

  it("rejects invalid JSON and leaves other routes alone", async () => {
    const res = await fetch(`${base}/api/todoist/tasks`, { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/other`)).status).toBe(418);
  });
});
