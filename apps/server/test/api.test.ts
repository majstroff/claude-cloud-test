import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-vault');
const H = { 'x-frame-os': '1', host: '127.0.0.1:4317' };

let app: Awaited<ReturnType<typeof buildApp>>;
let vaultDir: string;
let dataDir: string;

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-api-vault-'));
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-api-data-'));
  await fs.cp(SAMPLE, vaultDir, { recursive: true });
  app = await buildApp({ vaultPath: vaultDir, dataDir, clock: () => '2026-11-24' });
});

afterEach(async () => {
  await app.close();
});

async function get(url: string) {
  const r = await app.inject({ method: 'GET', url, headers: { host: H.host } });
  return { status: r.statusCode, body: r.json() };
}
async function send(method: 'POST' | 'PUT' | 'PATCH', url: string, payload: unknown, headers: Record<string, string> = H) {
  const r = await app.inject({ method, url, payload: payload as object, headers });
  return { status: r.statusCode, body: r.json() };
}

describe('API', () => {
  it('health показывает статус хранилища и интеграций', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body.vault.notes).toBeGreaterThan(20);
    expect(body.integrations).toEqual([expect.objectContaining({ id: 'todoist', state: 'not_installed' })]);
  });

  it('отклоняет изменения без заголовка X-Frame-OS и чужой Host', async () => {
    const r = await send('POST', '/api/ideas', { title: 'x' }, { host: '127.0.0.1' });
    expect(r.status).toBe(403);
    const r2 = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example.com' } });
    expect(r2.statusCode).toBe(403);
  });

  it('главная отдаёт реальные данные vault', async () => {
    const { body } = await get('/api/dashboard');
    expect(body.today).toBe('2026-11-24');
    expect(body.overdue.map((t: { title: string }) => t.title)).toEqual(['Ответить рекрутеру Анне']);
    expect(body.cycle.week).toBe(6);
  });

  it('полный сценарий задачи: создать, выполнить, увидеть в «сделано»', async () => {
    const created = await send('POST', '/api/quick', { kind: 'task', text: 'Проверить API сегодня' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ kind: 'task', due: '2026-11-24' });
    const today = await get('/api/tasks?view=today');
    const t = today.body.tasks.find((x: { title: string }) => x.title === 'Проверить API');
    expect(t).toBeTruthy();
    const done = await send('PATCH', '/api/tasks', { path: t.path, line: t.line, raw: t.raw, action: 'complete' });
    expect(done.body.task.status).toBe('done');
    const doneList = await get('/api/tasks?view=done');
    expect(doneList.body.tasks.map((x: { title: string }) => x.title)).toContain('Проверить API');
    const raw = await fs.readFile(path.join(vaultDir, t.path), 'utf8');
    expect(raw).toContain('- [x] Проверить API 📅 2026-11-24 ✅ 2026-11-24');
  });

  it('возвращает 409 при конфликте задачи и 400 при неверных данных', async () => {
    const backlog = await get('/api/tasks?view=backlog');
    const t = backlog.body.tasks[0];
    const conflict = await send('PATCH', '/api/tasks', { path: t.path, line: t.line, raw: 'другое', action: 'complete' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/изменилась/);
    const bad = await send('PATCH', '/api/tasks', { path: t.path, line: t.line, raw: t.raw, action: 'setDue', due: 'когда-нибудь' });
    expect(bad.status).toBe(400);
    expect((await get('/api/tasks?view=nope')).status).toBe(400);
  });

  it('читает и сохраняет заметку с контролем версии', async () => {
    const rel = encodeURIComponent('Projects/Поиск работы.md');
    const note = await get(`/api/note?path=${rel}`);
    expect(note.body.title).toBe('Поиск работы');
    expect(note.body.backlinks.map((b: { title: string }) => b.title)).toContain('Собеседование в Acme');
    const ok = await send('PUT', '/api/note', { path: note.body.path, content: note.body.content + '\nДобавлено\n', baseHash: note.body.hash });
    expect(ok.status).toBe(200);
    const stale = await send('PUT', '/api/note', { path: note.body.path, content: 'перезапись', baseHash: note.body.hash });
    expect(stale.status).toBe(409);
    const outside = await get(`/api/note?path=${encodeURIComponent('../secret.md')}`);
    expect(outside.status).toBe(403);
  });

  it('поиск находит заметки по началу слова', async () => {
    const { body } = await get(`/api/search?q=${encodeURIComponent('полумараф')}`);
    expect(body.results.map((r: { note: { title: string } }) => r.note.title)).toEqual(
      expect.arrayContaining(['Пробежать полумарафон', 'Подготовка к полумарафону']),
    );
  });

  it('стратегия: создать цель и проект под неё', async () => {
    const goal = await send('POST', '/api/goals', { title: 'Выучить испанский', horizon: '1 год' });
    const project = await send('POST', '/api/projects', { title: 'Испанский A1', goal: goal.body.path, deadline: '2027-03-01' });
    expect(project.status).toBe(200);
    const s = await get('/api/strategy');
    const g = s.body.goals.find((x: { path: string }) => x.path === goal.body.path);
    expect(g.projects.map((p: { title: string }) => p.title)).toEqual(['Испанский A1']);
    expect(s.body.current.title).toBe('Цикл 2026 Q4');
    const badDate = await send('POST', '/api/projects', { title: 'X', deadline: 'завтра' });
    expect(badDate.status).toBe(400);
  });

  it('идеи: создать и превратить в проект', async () => {
    const idea = await send('POST', '/api/ideas', { title: 'Мастер-класс по нетворкингу' });
    const conv = await send('POST', '/api/ideas/convert', { path: idea.body.path, to: 'project' });
    expect(conv.body.created).toBe('Projects/Мастер-класс по нетворкингу.md');
    const ideas = await get('/api/ideas');
    expect(ideas.body.ideas.find((i: { path: string }) => i.path === idea.body.path).status).toBe('converted');
  });

  it('день: сохраняет вечерний итог в ежедневную заметку', async () => {
    const r = await send('PUT', '/api/day/section', { date: '2026-11-24', section: 'review', content: 'Хороший день' });
    expect(r.body.review).toBe('Хороший день');
    const m = await send('PUT', '/api/day/metrics', { date: '2026-11-24', mood: 9 });
    expect(m.status).toBe(400);
  });

  it('избранное хранится вне vault и переживает перезапуск', async () => {
    await send('POST', '/api/favorites', { path: 'Projects/Поиск работы.md' });
    await app.close();
    app = await buildApp({ vaultPath: vaultDir, dataDir, clock: () => '2026-11-24' });
    const f = await get('/api/favorites');
    expect(f.body.favorites.map((x: { title: string }) => x.title)).toEqual(['Поиск работы']);
    const vaultFiles = await fs.readdir(vaultDir);
    expect(vaultFiles).not.toContain('state.json');
  });

  it('архивирование требует подтверждения', async () => {
    const r = await send('POST', '/api/note/archive', { path: 'Projects/Ремонт балкона.md' });
    expect(r.status).toBe(400);
    const ok = await send('POST', '/api/note/archive', { path: 'Projects/Ремонт балкона.md', confirmed: true });
    expect(ok.body.path).toBe('Archive/Ремонт балкона.md');
  });

  it('неизвестный метод API возвращает понятную ошибку', async () => {
    const r = await get('/api/unknown');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/Нет такого метода/);
  });
});
