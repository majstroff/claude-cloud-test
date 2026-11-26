import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, TodoistClient, TodoistSyncService } from '@frame-os/todoist';
import { FakeTodoist } from '../../../packages/todoist/test/fake-todoist.ts';
import { buildApp } from '../src/app.ts';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-vault');
const H = { 'x-frame-os': '1', host: '127.0.0.1:4317' };
const LINE = { path: 'Areas/Здоровье.md', line: 7, raw: '- [ ] Записаться к стоматологу на чистку 🔼' };

let app: Awaited<ReturnType<typeof buildApp>>;
let api: FakeTodoist;
let vaultDir: string;

async function start(service: TodoistSyncService | null) {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-td-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-td-data-'));
  await fs.cp(SAMPLE, vaultDir, { recursive: true });
  app = await buildApp({ vaultPath: vaultDir, dataDir, clock: () => '2026-11-24', integrations: { todoist: service } });
}

function makeService() {
  return new TodoistSyncService({
    client: new TodoistClient({ token: 'good-token', fetch: api.fetch as typeof fetch, maxRetries: 0, sleep: async () => {} }),
    store: new MemoryStore(),
    timeZone: 'UTC',
    now: () => new Date('2026-11-24T10:00:00Z'),
    vaultName: 'Life',
  });
}

const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url, headers: { host: H.host } });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};
const send = async (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = H) => {
  const r = await app.inject({ method, url, payload: payload as object, headers });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

beforeEach(() => {
  api = new FakeTodoist();
});
afterEach(async () => {
  await app?.close();
});

describe('Todoist в сервере', () => {
  it('без ключа показывает «Нужен ключ» и отвечает понятной ошибкой', async () => {
    await start(null);
    const h = await get('/api/health');
    expect(h.body.integrations).toEqual([expect.objectContaining({ id: 'todoist', state: 'not_configured' })]);
    const r = await send('POST', '/api/todoist/sync', {});
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'not_configured', error: expect.stringContaining('Todoist не подключён') });
    const b = await send('POST', '/api/todoist/backlog/send-vault-task', LINE);
    expect(b.status).toBe(503);
  });

  it('синхронизирует, показывает статус и отдаёт задачи по представлениям', async () => {
    api.addTask({ content: 'Из Todoist', due: { date: '2026-11-24', string: 'today', is_recurring: false } });
    await start(makeService());
    const r = await send('POST', '/api/todoist/sync', {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ pulled: 1 });
    expect((await get('/api/todoist/tasks?view=today')).body.map((t: { title: string }) => t.title)).toEqual(['Из Todoist']);
    const h = await get('/api/health');
    expect(h.body.integrations[0]).toMatchObject({ state: 'ok', message: expect.stringContaining('синхронизировано') });
  });

  it('изменяющие запросы требуют заголовок X-Frame-OS', async () => {
    await start(makeService());
    const r = await send('POST', '/api/todoist/tasks', { content: 'x' }, { host: H.host });
    expect(r.status).toBe(403);
    expect(api.tasks.size).toBe(0);
  });

  it('создаёт, завершает и удаляет только с подтверждением', async () => {
    await start(makeService());
    const c = await send('POST', '/api/todoist/tasks', { content: 'Позвонить в банк', due_string: 'tomorrow' });
    expect(c.status).toBe(201);
    expect(c.body.due.date).toBe('2026-11-25');
    expect((await send('POST', `/api/todoist/tasks/${c.body.id}/complete`, {})).body.completed).toBe(true);
    const refused = await send('DELETE', `/api/todoist/tasks/${c.body.id}`, {});
    expect(refused.status).toBe(428);
    expect((await send('DELETE', `/api/todoist/tasks/${c.body.id}`, { confirmed: true })).status).toBe(204);
  });

  it('отправляет задачу из бэклога Obsidian и помечает строку в заметке', async () => {
    await start(makeService());
    const r = await send('POST', '/api/todoist/backlog/send-vault-task', { ...LINE, projectId: 'p_work' });
    expect(r.status).toBe(201);
    const id = r.body.todoist.todoistId;
    expect(api.tasks.get(id)).toMatchObject({ content: 'Записаться к стоматологу на чистку', priority: 2, project_id: 'p_work' });
    expect(api.tasks.get(id)!.description).toContain('obsidian://open?vault=Life&file=Areas%2F');

    const text = await fs.readFile(path.join(vaultDir, LINE.path), 'utf8');
    expect(text).toContain(`- [ ] Записаться к стоматологу на чистку 🔼 [todoist:: ${id}]`);
    expect(r.body.task).toMatchObject({ todoistId: id, title: 'Записаться к стоматологу на чистку' });

    // Ушла из бэклога Obsidian и не отправится второй раз.
    const backlog = await get('/api/tasks?view=backlog');
    expect(backlog.body.tasks.map((t: { title: string }) => t.title)).not.toContain('Записаться к стоматологу на чистку');
    const again = await send('POST', '/api/todoist/backlog/send-vault-task', { ...LINE, raw: `${LINE.raw} [todoist:: ${id}]` });
    expect(again.status).toBe(409);
    expect(api.tasks.size).toBe(1);
  });

  it('не создаёт задачу, если строка в заметке изменилась', async () => {
    await start(makeService());
    const r = await send('POST', '/api/todoist/backlog/send-vault-task', { ...LINE, raw: '- [ ] Другая задача' });
    expect(r.status).toBe(409);
    expect(api.tasks.size).toBe(0);
  });

  it('при недоступном Todoist не помечает строку и не оставляет задачу в очереди', async () => {
    const svc = makeService();
    await start(svc);
    api.failNext(() => true, 'network');
    const r = await send('POST', '/api/todoist/backlog/send-vault-task', LINE);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('network');
    expect((await svc.status()).pending).toBe(0);
    expect(await fs.readFile(path.join(vaultDir, LINE.path), 'utf8')).not.toContain('[todoist::');
  });

  it('лимит бесплатного тарифа возвращает понятное сообщение и не помечает строку', async () => {
    await start(makeService());
    api.failNext((r) => r.method === 'POST' && r.path === '/tasks', { status: 403, body: 'Maximum number of active tasks in project reached' });
    const r = await send('POST', '/api/todoist/backlog/send-vault-task', { ...LINE, projectId: 'p_work' });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: 'plan_limit', error: expect.stringContaining('бесплатного тарифа Todoist') });
    expect(await fs.readFile(path.join(vaultDir, LINE.path), 'utf8')).not.toContain('[todoist::');
  });

  it('завершение в Todoist отмечает строку в Obsidian, и наоборот', async () => {
    await start(makeService());
    const sent = await send('POST', '/api/todoist/backlog/send-vault-task', LINE);
    const id = sent.body.todoist.todoistId;
    api.completeRemote(id);
    const r = await send('POST', '/api/todoist/sync', {});
    expect(r.body.vaultCompleted).toBe(1);
    const text = await fs.readFile(path.join(vaultDir, LINE.path), 'utf8');
    expect(text).toContain(`- [x] Записаться к стоматологу на чистку 🔼 [todoist:: ${id}] ✅ 2026-11-24`);

    // Обратное направление: отметили в Obsidian → закрывается в Todoist.
    const second = await send('POST', '/api/todoist/backlog/send-vault-task', {
      path: 'Areas/Здоровье.md',
      line: 8,
      raw: '- [ ] Купить новые кроссовки для бега',
    });
    const id2 = second.body.todoist.todoistId;
    const dto = second.body.task;
    await send('PATCH', '/api/tasks', { path: dto.path, line: dto.line, raw: dto.raw, action: 'complete' });
    const r2 = await send('POST', '/api/todoist/sync', {});
    expect(r2.body.todoistCompleted).toBe(1);
    expect(api.completed.map((t) => t.id)).toContain(id2);
  });
});
