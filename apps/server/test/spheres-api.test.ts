import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-vault');
const H = { 'x-frame-os': '1', host: '127.0.0.1:4317' };

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-sp-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-sp-data-'));
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

describe('API: правка и удаление строк', () => {
  it('операция: изменение, удаление и возврат; задача: текст, удаление и возврат', async () => {
    const add = await send('POST', '/api/finance/transactions', { kind: 'expense', amount: 1500, category: 'Продукты', description: 'Тест' });
    const tx = add.body.transaction;
    expect((await send('PUT', '/api/finance/transactions', { ...tx, amount: 900, link: '' }, { host: H.host })).status).toBe(403);
    const upd = await send('PUT', '/api/finance/transactions', { path: tx.path, line: tx.line, raw: tx.raw, kind: 'expense', amount: 900, category: 'Кафе', description: 'Тест', date: tx.date });
    expect(upd.status).toBe(200);
    expect(upd.body.transaction).toMatchObject({ amount: 900, category: 'Кафе' });
    expect((await send('POST', '/api/finance/transactions/delete', { path: tx.path, line: tx.line })).status).toBe(400);
    const del = await send('POST', '/api/finance/transactions/delete', { path: tx.path, line: upd.body.transaction.line, raw: upd.body.transaction.raw });
    expect(del.body.deleted).toMatchObject({ amount: 900, description: 'Тест' });

    const t = (await send('POST', '/api/tasks', { text: 'Проверить API' })).body.task;
    const r = await app.inject({ method: 'PATCH', url: '/api/tasks', headers: H, payload: { path: t.path, line: t.line, raw: t.raw, action: 'rename', text: 'Проверить API ещё раз' } });
    const renamed = r.json().task;
    expect(renamed.title).toBe('Проверить API ещё раз');
    const gone = await send('POST', '/api/tasks/delete', { path: renamed.path, line: renamed.line, raw: renamed.raw });
    expect(gone.status).toBe(200);
    const back = await send('POST', '/api/tasks/restore', gone.body.deleted);
    expect(back.body.task.title).toBe('Проверить API ещё раз');
    expect((await send('POST', '/api/tasks/restore', { path: t.path, line: 0, raw: 'не задача' })).status).toBe(400);
  });
});

describe('API: финансы', () => {
  it('сводка, операция, оплата подписки и бюджет', async () => {
    const f = await get('/api/finance?month=2026-11');
    expect(f.status).toBe(200);
    expect(f.body.income).toBe(220000);
    const tx = await send('POST', '/api/finance/transactions', { kind: 'expense', amount: '500', category: 'Кафе', description: 'Кофе' });
    expect(tx.status).toBe(200);
    expect((await get('/api/finance')).body.expense).toBe(94450);
    expect((await send('POST', '/api/finance/pay', { path: 'Areas/Финансы/Подписки/Яндекс Плюс.md' })).status).toBe(200);
    const b = await send('PUT', '/api/finance/budget', { income: 250000, limits: [{ category: 'Продукты', limit: 31000 }] });
    expect(b.body.limits).toEqual([{ category: 'Продукты', limit: 31000 }]);
    expect((await send('POST', '/api/finance/transactions', { kind: 'bribe', amount: 1 })).status).toBe(400);
    expect((await get('/api/finance?month=ноябрь')).status).toBe(400);
  });

  it('создание и правка записей через общие методы', async () => {
    const c = await send('POST', '/api/entities', { type: 'subscription', title: 'Спортзал', fields: { amount: 3500, period: 'monthly', next_payment: '2026-12-01', category: 'Спорт' } });
    expect(c.status).toBe(200);
    expect(c.body.path).toBe('Areas/Финансы/Подписки/Спортзал.md');
    expect((await send('PUT', '/api/entity', { path: c.body.path, set: { amount: 'много' } })).status).toBe(400);
    expect((await send('PUT', '/api/entity', { path: c.body.path, set: { amount: '3 900' } })).status).toBe(200);
    expect((await get(`/api/finance/item?path=${encodeURIComponent(c.body.path)}`)).body.amount).toBe(3900);
    expect((await send('PUT', '/api/entity/section', { path: c.body.path, section: 'notes', content: 'Абонемент на год' })).status).toBe(200);
    // Запись без подтверждающего заголовка не принимается.
    expect((await send('POST', '/api/finance/pay', { path: c.body.path }, { host: H.host })).status).toBe(403);
  });
});

describe('API: здоровье, обучение, практики, дом', () => {
  it('тренировка, показатели дня и регулярное дело', async () => {
    const s = await get('/api/sport');
    expect(s.body.upcoming[0].title).toBe('2026-11-24 Силовая А');
    const rel = s.body.upcoming[0].path;
    expect((await send('POST', '/api/sport/workout/status', { path: rel, status: 'done', duration: 50 })).body.workout.status).toBe('done');
    expect((await send('PUT', '/api/sport/day', { date: '2026-11-24', sleep: 8, water: 2.5 })).body.sleep).toBe(8);
    expect((await send('PUT', '/api/sport/day', { date: '2026-11-24', blood: 1 })).status).toBe(400);
    const r = await send('POST', '/api/routines/done', { path: 'Areas/Здоровье/Регулярное/Витамин D.md' });
    expect(r.body.routine).toMatchObject({ lastDone: '2026-11-24', next: '2026-11-25', due: 'soon' });
  });

  it('книга, практика, покупка и главная', async () => {
    const l = await send('POST', '/api/learning/progress', { path: 'Resources/Обучение/Книги/Inspired.md', progress: 150 });
    expect(l.body.item.progress).toBe(150);
    const p = await send('POST', '/api/practices/log', { kind: 'meditation', minutes: 10, time: '08:00' });
    expect(p.body.practices).toHaveLength(1);
    expect((await get('/api/practices')).body.stats.streak).toBe(2);
    const item = await send('POST', '/api/home/shopping', { text: 'Батарейки AAA' });
    const t = item.body.task;
    const buy = await send('POST', '/api/home/buy', { path: t.path, line: t.line, raw: t.raw, amount: 300 });
    expect(buy.body.transaction.amount).toBe(300);
    const d = await get('/api/dashboard');
    expect(d.body.spheres.routinesDue.map((x: { title: string }) => x.title)).toEqual(['Генеральная уборка', 'Витамин D']);
    expect(d.body.spheres.obligations.length).toBe(3);
    const day = await get('/api/spheres/day?date=2026-11-24');
    expect(day.body.moon.phaseLabel).toBe('Полнолуние');
  });
});
