import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TodoistClient } from "../src/client.ts";
import { TodoistSyncService } from "../src/service.ts";
import { JsonFileStore, MemoryStore } from "../src/store.ts";
import { FakeTodoist } from "./fake-todoist.ts";

let api: FakeTodoist;
let store: MemoryStore;
let now: Date;

function service(opts: { autoFlush?: boolean; client?: TodoistClient | null; vaultName?: string } = {}) {
  const client =
    opts.client === undefined
      ? new TodoistClient({ token: "good-token", fetch: api.fetch as typeof fetch, sleep: async () => {}, maxRetries: 0 })
      : opts.client;
  return new TodoistSyncService({
    client,
    store,
    timeZone: "Europe/Moscow",
    now: () => now,
    autoFlush: opts.autoFlush ?? true,
    vaultName: opts.vaultName,
  });
}

beforeEach(() => {
  api = new FakeTodoist();
  store = new MemoryStore();
  now = new Date("2026-11-24T10:00:00Z");
});

describe("pull from Todoist", () => {
  it("imports tasks and projects and sorts them into views", async () => {
    api.addTask({ content: "Сегодня", due: { date: "2026-11-24", string: "today", is_recurring: false }, priority: 4 });
    api.addTask({ content: "Просрочено", due: { date: "2026-11-20", string: "20 nov", is_recurring: false } });
    api.addTask({ content: "Скоро", due: { date: "2026-11-27T09:00:00", string: "27 nov 9am", is_recurring: false } });
    api.addTask({ content: "Без даты", project_id: "p_work", labels: ["deep"] });
    const svc = service();
    const r = await svc.sync();
    expect(r).toMatchObject({ pulled: 4, pushed: 0, error: null });

    const titles = async (o: Parameters<typeof svc.listTasks>[0]) => (await svc.listTasks(o)).map((t) => t.title);
    expect(await titles({ view: "today" })).toEqual(["Сегодня"]);
    expect(await titles({ view: "overdue" })).toEqual(["Просрочено"]);
    expect(await titles({ view: "upcoming" })).toEqual(["Скоро"]);
    expect(await titles({ view: "backlog" })).toEqual(["Без даты"]);
    expect(await titles({ projectId: "p_work" })).toEqual(["Без даты"]);
    expect(await titles({ label: "deep" })).toEqual(["Без даты"]);
    expect(await titles({ search: "скор" })).toEqual(["Скоро"]);

    const upcoming = (await svc.listTasks({ view: "upcoming" }))[0]!;
    expect(upcoming.due).toMatchObject({ date: "2026-11-27", datetime: "2026-11-27T09:00:00" });
    expect((await svc.listProjects()).map((p) => p.name)).toEqual(["Inbox", "Работа"]);
  });

  it("uses the configured time zone for today", async () => {
    now = new Date("2026-11-24T22:30:00Z"); // already the 25th in Moscow
    api.addTask({ content: "Завтра по UTC", due: { date: "2026-11-25", string: "", is_recurring: false } });
    const svc = service();
    await svc.sync();
    expect((await svc.listTasks({ view: "today" })).map((t) => t.title)).toEqual(["Завтра по UTC"]);
  });

  it("picks up remote edits, completions and deletions", async () => {
    const a = api.addTask({ content: "A" });
    const b = api.addTask({ content: "B" });
    const c = api.addTask({ content: "C" });
    const svc = service();
    await svc.sync();

    api.editRemote(a.id, { content: "A2", due: { date: "2026-11-24", string: "today", is_recurring: false } });
    api.completeRemote(b.id);
    api.tasks.delete(c.id);
    now = new Date("2026-11-24T12:00:00Z");
    const r = await svc.sync();

    expect(r.remoteDeleted).toBe(1);
    const all = await svc.listTasks();
    expect(all.find((t) => t.todoistId === a.id)).toMatchObject({ title: "A2", syncState: "synced" });
    expect(all.find((t) => t.todoistId === b.id)).toMatchObject({ completed: true });
    // Deleted in Todoist: flagged, never silently removed locally.
    expect(all.find((t) => t.todoistId === c.id)).toMatchObject({ syncState: "remote_deleted" });
    expect(await svc.listTasks({ view: "backlog" })).toHaveLength(0);
  });
});

describe("бесплатный тариф Todoist", () => {
  it("без истории выполненных проверяет пропавшие задачи по одной", async () => {
    const a = api.addTask({ content: "Сделано в Todoist" });
    const b = api.addTask({ content: "Удалено в Todoist" });
    const svc = service();
    await svc.sync();
    api.completeRemote(a.id);
    api.tasks.delete(b.id);
    // На бесплатном тарифе история ограничена неделей; имитируем отказ запроса истории.
    api.failNext((r) => r.path.startsWith("/tasks/completed"), { status: 403, body: "Premium only" });
    const r = await svc.sync();
    const all = await svc.listTasks();
    expect(all.find((t) => t.todoistId === a.id)).toMatchObject({ completed: true, syncState: "synced" });
    expect(all.find((t) => t.todoistId === b.id)).toMatchObject({ syncState: "remote_deleted" });
    expect(r.remoteDeleted).toBe(1);
  });

  it("лимит тарифа показывает понятную причину у задачи", async () => {
    const svc = service();
    api.failNext((r) => r.method === "POST" && r.path === "/tasks", { status: 403, body: "Max 300 active tasks per project limit reached" });
    const t = await svc.createTask({ content: "301-я задача", project_id: "p_work" });
    expect(t.syncState).toBe("error");
    expect(t.syncError).toMatchObject({ code: "plan_limit", message: expect.stringContaining("бесплатного тарифа") });
    expect((await svc.status()).pending).toBe(0);
  });
});

describe("push to Todoist", () => {
  it("creates, edits, completes and reopens", async () => {
    const svc = service();
    const t = await svc.createTask({ content: "Отправить резюме", due_date: "2026-11-24", priority: 4, labels: ["job"] });
    expect(t).toMatchObject({ syncState: "synced", title: "Отправить резюме" });
    expect(t.todoistId).toBeTruthy();
    expect(t.url).toContain(t.todoistId!);
    expect(api.tasks.get(t.todoistId!)).toMatchObject({ content: "Отправить резюме", priority: 4, labels: ["job"] });

    const u = await svc.updateTask(t.id, { content: "Отправить резюме в Яндекс", due_string: "tomorrow" });
    expect(u.due?.date).toBe("2026-11-25");
    expect(api.tasks.get(t.todoistId!)!.content).toBe("Отправить резюме в Яндекс");

    const cleared = await svc.updateTask(t.id, { clearDue: true });
    expect(cleared.due).toBeNull();

    const done = await svc.completeTask(t.id);
    expect(done.completed).toBe(true);
    expect(api.completed.map((x) => x.id)).toContain(t.todoistId);

    const reopened = await svc.reopenTask(t.id);
    expect(reopened.completed).toBe(false);
    expect(api.requests.at(-1)!.path).toBe(`/tasks/${t.todoistId}/reopen`);
  });

  it("completing a recurring task keeps it open with the next date", async () => {
    const svc = service();
    const t = await svc.createTask({ content: "Йога", due_string: "every monday" });
    expect(t.due?.recurring).toBe(true);
    const next = await svc.completeTask(t.id);
    expect(next).toMatchObject({ completed: false, syncState: "synced" });
    expect(next.due?.date).toBe("2026-12-01");
  });

  it("moves tasks between projects", async () => {
    const svc = service();
    const t = await svc.createTask({ content: "x" });
    const moved = await svc.moveTask(t.id, { project_id: "p_work" });
    expect(moved.projectId).toBe("p_work");
    expect(api.tasks.get(t.todoistId!)!.project_id).toBe("p_work");
  });

  it("does not delete without explicit confirmation", async () => {
    const svc = service();
    const t = await svc.createTask({ content: "x" });
    await expect(svc.deleteTask(t.id)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(api.tasks.has(t.todoistId!)).toBe(true);
    await svc.deleteTask(t.id, { confirmed: true });
    expect(api.tasks.has(t.todoistId!)).toBe(false);
    expect(await svc.getTask(t.id)).toBeNull();
  });

  it("works offline and pushes the queue in order when back online", async () => {
    const svc = service();
    api.failNext(() => true, "network", 3); // one failed push per change
    const t = await svc.createTask({ content: "Офлайн" });
    expect(t).toMatchObject({ syncState: "pending", todoistId: null });
    await svc.updateTask(t.id, { priority: 3 });
    await svc.completeTask(t.id);
    expect((await svc.status()).pending).toBe(3);
    expect((await svc.status()).lastError).toMatchObject({ code: "network" });
    expect(await svc.listTasks({ view: "completed" })).toHaveLength(1);

    const r = await svc.sync();
    expect(r.pushed).toBe(3);
    expect((await svc.status()).pending).toBe(0);
    const synced = (await svc.getTask(t.id))!;
    expect(synced).toMatchObject({ completed: true, syncState: "synced", priority: 3 });
    expect(api.completed.find((x) => x.id === synced.todoistId)).toBeTruthy();
  });

  it("queues changes when no token is configured", async () => {
    const svc = service({ client: null });
    const t = await svc.createTask({ content: "Без токена" });
    expect(t.syncState).toBe("pending");
    expect(svc.configured).toBe(false);
    await expect(svc.sync()).rejects.toMatchObject({ code: "not_configured" });
  });

  it("marks a task as error when Todoist rejects it, and can retry", async () => {
    const svc = service();
    api.failNext((r) => r.method === "POST" && r.path === "/tasks", { status: 400, body: "bad due" });
    const t = await svc.createTask({ content: "x", due_string: "когда-нибудь" });
    expect(t.syncState).toBe("error");
    expect(t.syncError?.code).toBe("validation");
    expect((await svc.status()).pending).toBe(0);

    const retried = await svc.retryTask(t.id);
    expect(retried.syncState).toBe("synced");
    expect(retried.todoistId).toBeTruthy();
  });

  it("flags a task deleted in Todoist while we were editing it", async () => {
    const svc = service();
    const t = await svc.createTask({ content: "x" });
    api.tasks.delete(t.todoistId!);
    const u = await svc.updateTask(t.id, { content: "y" });
    expect(u.syncState).toBe("remote_deleted");
  });

  it("stops the queue on 401 and keeps the changes", async () => {
    const bad = new TodoistClient({ token: "bad-token", fetch: api.fetch as typeof fetch, maxRetries: 0 });
    const svc = service({ client: bad });
    const t = await svc.createTask({ content: "x" });
    expect(t.syncState).toBe("pending");
    expect((await svc.status()).lastError?.code).toBe("unauthorized");
    await expect(svc.sync()).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("conflicts", () => {
  it("detects edits on both sides and lets the person choose", async () => {
    const remote = api.addTask({ content: "Original" });
    const svc = service({ autoFlush: false });
    await svc.sync();
    const local = (await svc.listTasks())[0]!;

    await svc.updateTask(local.id, { content: "Local edit" });
    api.editRemote(remote.id, { content: "Remote edit" });
    const r = await svc.sync();
    expect(r.conflicts).toBe(1);
    const c = (await svc.getTask(local.id))!;
    expect(c).toMatchObject({ syncState: "conflict", title: "Local edit" });
    expect(c.conflictRemote?.title).toBe("Remote edit");
    expect(api.tasks.get(remote.id)!.content).toBe("Remote edit"); // nothing pushed yet

    await svc.resolveConflict(local.id, "local");
    await svc.sync();
    expect(api.tasks.get(remote.id)!.content).toBe("Local edit");
    expect((await svc.getTask(local.id))!.syncState).toBe("synced");
  });

  it("keeping the remote version drops local changes", async () => {
    const remote = api.addTask({ content: "Original" });
    const svc = service({ autoFlush: false });
    await svc.sync();
    const local = (await svc.listTasks())[0]!;
    await svc.updateTask(local.id, { content: "Local" });
    api.editRemote(remote.id, { content: "Remote" });
    await svc.sync();
    const kept = await svc.resolveConflict(local.id, "remote");
    expect(kept).toMatchObject({ title: "Remote", syncState: "synced" });
    expect((await svc.status()).pending).toBe(0);
  });
});

describe("Backlog → Todoist", () => {
  it("sends a backlog item with a link back to the Obsidian note", async () => {
    const svc = service({ vaultName: "Life" });
    const t = await svc.sendBacklogItem(
      { title: "Обновить портфолио", notes: "Добавить кейс", obsidianPath: "Projects/Работа/Портфолио.md", priority: 3 },
      { projectId: "p_work", due_string: "tomorrow" },
    );
    expect(t).toMatchObject({ syncState: "synced", obsidianPath: "Projects/Работа/Портфолио.md", projectId: "p_work" });
    const remote = api.tasks.get(t.todoistId!)!;
    expect(remote.description).toBe(
      "Добавить кейс\n\nObsidian: obsidian://open?vault=Life&file=Projects%2F%D0%A0%D0%B0%D0%B1%D0%BE%D1%82%D0%B0%2F%D0%9F%D0%BE%D1%80%D1%82%D1%84%D0%BE%D0%BB%D0%B8%D0%BE",
    );
    expect(remote.due?.date).toBe("2026-11-25");
  });
});

describe("JsonFileStore", () => {
  it("persists the cache as readable JSON with owner-only permissions and no token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frame-todoist-"));
    const path = join(dir, "nested", "todoist-cache.json");
    const fileStore = new JsonFileStore(path);
    expect((await fileStore.load()).tasks).toEqual({});
    const svc = new TodoistSyncService({
      client: new TodoistClient({ token: "good-token", fetch: api.fetch as typeof fetch }),
      store: fileStore,
      timeZone: "UTC",
    });
    await svc.createTask({ content: "Сохранить" });
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text).tasks).toBeTypeOf("object");
    expect(text).toContain("Сохранить");
    expect(text).not.toContain("good-token");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);
  });
});
