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

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-j-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-j-data-'));
  await fs.cp(SAMPLE, vaultDir, { recursive: true });
  app = await buildApp({ vaultPath: vaultDir, dataDir, clock: () => '2026-11-24', integrations: { todoist: null } });
});

afterEach(async () => {
  await app.close();
});

async function get(url: string) {
  const r = await app.inject({ method: 'GET', url, headers: { host: H.host } });
  return { status: r.statusCode, body: r.json() };
}
async function send(method: 'POST' | 'PUT', url: string, payload: unknown, headers: Record<string, string> = H) {
  const r = await app.inject({ method, url, payload: payload as object, headers });
  return { status: r.statusCode, body: r.json() };
}
const q = encodeURIComponent;

describe('API: дневник и итоги', () => {
  it('записи, запись дня, сохранение и защита', async () => {
    const list = await get('/api/journal');
    expect(list.status).toBe(200);
    expect(list.body.entries.map((e: { date: string }) => e.date)).toEqual(['2026-11-24', '2026-11-23']);
    expect(list.body.streak).toBe(1);
    expect((await get('/api/journal/entry?date=2026-11-23')).body.text).toMatch(/Спокойное утро/);
    expect((await get('/api/journal/entry?date=23.11')).status).toBe(400);
    expect((await send('PUT', '/api/journal/entry', { date: '2026-11-24', text: 'x' }, { host: H.host })).status).toBe(403);
    const saved = await send('PUT', '/api/journal/entry', { date: '2026-11-24', text: 'Записал день' });
    expect(saved.body.text).toBe('Записал день');
    expect((await get('/api/dashboard')).body.journal).toEqual({ streak: 2, writtenToday: true });
  });

  it('аналитика, черновик и сохранение итогов', async () => {
    const a = await get('/api/analytics?period=month&date=2026-11-10');
    expect(a.body.stats.start).toBe('2026-11-01');
    expect(a.body.insights.length).toBeGreaterThan(2);
    expect((await get('/api/analytics?period=year')).status).toBe(400);
    const d = await get('/api/reviews/draft?period=week');
    expect(d.body.title).toBe('Итоги недели 2026-11-23');
    const s = await send('POST', '/api/reviews', { period: 'week', answers: { 'Фокус на следующий период': 'Собеседования' } });
    expect(s.body).toEqual({ path: 'Areas/Итоги/Итоги недели 2026-11-23.md', created: true });
    expect((await get('/api/reviews')).body.reviews).toHaveLength(1);
    expect((await get('/api/reviews/draft?period=week')).body.human['Фокус на следующий период']).toBe('Собеседования');
  });
});

describe('API: помощник', () => {
  it('предлагает, но ничего не меняет сам', async () => {
    const before = await fs.readFile(path.join(vaultDir, 'Projects/Поиск работы.md'), 'utf8');
    const info = await get('/api/assistant');
    expect(info.body.engine).toMatchObject({ id: 'local', paid: false, external: false });
    const plan = await get('/api/assistant/plan');
    expect(plan.body.focus).toHaveLength(3);
    expect((await get('/api/assistant/priorities?limit=2')).body.items).toHaveLength(2);
    expect((await get('/api/assistant/overdue')).body.total).toBe(1);
    expect((await get('/api/assistant/job')).body.funnel.interview).toBe(1);
    expect((await get(`/api/assistant/note-tasks?path=${q('Inbox/Заметки с созвона с Анной.md')}`)).body.candidates).toHaveLength(2);
    expect((await get(`/api/assistant/related?path=${q('Projects/Поиск работы.md')}`)).body.items.length).toBeGreaterThan(0);
    expect((await get(`/api/assistant/next-step?path=${q('Projects/Поиск работы.md')}`)).body.title).toBe('Ответить рекрутеру Анне');
    expect((await get(`/api/assistant/note-tasks?path=${q('Areas/Документы/РВП.md')}`)).status).toBe(403);
    expect((await get('/api/assistant/note-tasks')).status).toBe(400);
    expect(await fs.readFile(path.join(vaultDir, 'Projects/Поиск работы.md'), 'utf8')).toBe(before);
  });
});

describe('API: удаление заметки', () => {
  it('только с подтверждением и в корзину', async () => {
    const rel = 'Inbox/Ideas/Курс по SQL для продактов.md';
    expect((await send('POST', '/api/note/trash', { path: rel })).status).toBe(400);
    expect((await send('POST', '/api/note/trash', { path: rel, confirmed: true }, { host: H.host })).status).toBe(403);
    const r = await send('POST', '/api/note/trash', { path: rel, confirmed: true });
    expect(r.body.to).toBe('.trash/Курс по SQL для продактов.md');
    expect((await get(`/api/note?path=${q(rel)}`)).status).toBe(404);
    await fs.access(path.join(vaultDir, '.trash/Курс по SQL для продактов.md'));
  });
});
