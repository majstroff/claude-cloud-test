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
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-pa-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-pa-data-'));
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

describe('API: знания', () => {
  it('сводка, фильтр, поиск, связь и заметка для висячей ссылки', async () => {
    const o = await get('/api/knowledge?type=instruction');
    expect(o.status).toBe(200);
    expect(o.body.items.map((i: { title: string }) => i.title)).toEqual(['Резервная копия хранилища']);
    expect((await get('/api/knowledge?type=passport')).status).toBe(400);
    const s = await get(`/api/knowledge/search?q=${q('метрики')}`);
    expect(s.body.results.map((r: { title: string }) => r.title)).toContain('Метрики продукта');
    const item = await get(`/api/knowledge/item?path=${q('Resources/Знания/Метрики продукта.md')}`);
    expect(item.body.dangling).toContain('North Star Metric');
    expect((await get(`/api/knowledge/item?path=${q('Areas/Документы/РВП.md')}`)).status).toBe(403);
    const link = await send('POST', '/api/knowledge/link', { from: 'Resources/Знания/Инструкции/Резервная копия хранилища.md', to: 'Resources/Знания/Метрики продукта.md' });
    expect(link.status).toBe(200);
    expect((await send('POST', '/api/knowledge/link', { from: 'Resources/Знания/Инструкции/Резервная копия хранилища.md', to: 'Resources/Знания/Метрики продукта.md' })).status).toBe(409);
    const c = await send('POST', '/api/knowledge/create-for-link', { target: 'North Star Metric' });
    expect(c.body.path).toBe('Resources/Знания/North Star Metric.md');
    const created = await send('POST', '/api/entities', { type: 'bookmark', title: 'Гайд', fields: { url: 'https://example.com', tags: 'аналитика' } });
    expect(created.status).toBe(200);
    expect((await send('PUT', '/api/entity', { path: created.body.path, set: { read: true } })).status).toBe(200);
    expect(await fs.readFile(path.join(vaultDir, created.body.path), 'utf8')).toMatch(/read: true/);
    // Запись без заголовка X-Frame-OS отклоняется.
    expect((await send('POST', '/api/knowledge/link', { from: 'a', to: 'b' }, { host: H.host })).status).toBe(403);
  });
});

describe('API: путешествия', () => {
  it('поездки, оплата брони, вещи, маршрут и расход', async () => {
    const trip = 'Areas/Путешествия/Тбилиси — декабрь 2026.md';
    const o = await get('/api/travel');
    expect(o.body.upcoming.map((t: { title: string }) => t.title)).toEqual(['Тбилиси — декабрь 2026']);
    expect(o.body.past.map((t: { title: string }) => t.title)).toEqual(['Казань — сентябрь 2026']);
    const d = await get(`/api/travel/trip?path=${q(trip)}`);
    expect(d.body.bookingList).toHaveLength(2);
    const pay = await send('POST', '/api/travel/pay', { path: 'Areas/Путешествия/Брони/Апартаменты в Сололаки.md', amount: '37 500' });
    expect(pay.body.transaction.amount).toBe(37500);
    expect((await send('POST', '/api/travel/pay', { path: 'Areas/Путешествия/Брони/Апартаменты в Сололаки.md' })).status).toBe(409);
    expect((await send('POST', '/api/travel/packing/template', { path: trip, template: 'beach' })).body.added).toBe(6);
    expect((await send('POST', '/api/travel/packing', { path: trip, text: 'Зонт' })).status).toBe(200);
    expect((await send('POST', '/api/travel/route', { path: trip, date: '2026-12-20', text: 'Фуникулёр' })).status).toBe(200);
    expect((await send('POST', '/api/travel/expense', { path: trip, amount: 1200, description: 'такси' })).status).toBe(200);
    expect((await send('POST', '/api/travel/expense', { path: trip })).status).toBe(400);
    const after = await get(`/api/travel/trip?path=${q(trip)}`);
    expect(after.body).toMatchObject({ spent: 38700, unpaid: 24500, packingTotal: 10 });
    expect(after.body.routePoints.some((p: { text: string }) => p.text === 'Фуникулёр')).toBe(true);
    const bk = await send('POST', '/api/entities', { type: 'booking', title: 'Поезд в Батуми', fields: { trip: 'Тбилиси — декабрь 2026', kind: 'train', date: '2026-12-22', cost: 3000 } });
    expect(bk.status).toBe(200);
    expect((await get(`/api/travel/trip?path=${q(trip)}`)).body.bookings).toBe(3);
    expect((await send('PUT', '/api/entity', { path: trip, set: { end: '2026-12-01' } })).status).toBe(400);
    const day = await get('/api/spheres/day?date=2026-12-18');
    expect(day.body.travel.trips).toHaveLength(1);
    expect(day.body.travel.bookings.map((b: { title: string }) => b.title)).toEqual(expect.arrayContaining(['Перелёт Москва — Тбилиси']));
    // Вещи в поездку не попадают в бэклог.
    const backlog = await get('/api/tasks?view=backlog');
    expect(backlog.body.tasks.some((t: { title: string }) => t.title === 'Зонт')).toBe(false);
  });
});

describe('API: отношения', () => {
  it('даты, ритм, подарки, договорённость и «связались»', async () => {
    const o = await get('/api/relationships');
    expect(o.status).toBe(200);
    expect(o.body.upcoming[0].title).toBe('День рождения: Ольга Иванова');
    expect(o.body.contactsDue.map((p: { title: string }) => p.title)).toEqual(['Ольга Иванова']);
    const dash = await get('/api/dashboard');
    expect(dash.body.spheres.occasions.map((x: { title: string }) => x.title)).toContain('День рождения: Ольга Иванова');
    expect(dash.body.spheres.nextTrip.title).toBe('Тбилиси — декабрь 2026');
    const olga = 'Resources/Контакты/Ольга Иванова.md';
    const touch = await send('POST', '/api/relationships/touch', { path: olga, text: 'Созвонились про поездку' });
    expect(touch.body.person.dueState).toBeNull();
    expect((await get('/api/relationships')).body.contactsDue).toHaveLength(0);
    expect((await send('POST', '/api/relationships/gift-idea', { path: olga, text: 'Путеводитель по Грузии' })).body.ideas).toContain('Путеводитель по Грузии');
    const gift = await send('POST', '/api/relationships/gift', { path: olga, text: 'Плёночный фотоаппарат', cost: 7000, occasion: 'День рождения' });
    expect(gift.body.ideas).toEqual(['Путеводитель по Грузии']);
    expect(gift.body.transaction.category).toBe('Подарки');
    expect((await send('POST', '/api/relationships/gift', { path: olga, text: 'x', cost: -5 })).status).toBe(400);
    expect((await send('POST', '/api/relationships/agreement', { path: olga, text: 'Купить билеты на фуникулёр', due: '2026-12-01' })).body.task.section).toBe('Договорённости');
    const p = await get(`/api/relationships/person?path=${q(olga)}`);
    expect(p.body).toMatchObject({ birthday: '12-01', agreements: 2 });
    const date = await send('POST', '/api/entities', { type: 'important_date', title: 'Годовщина переезда', fields: { date: '01.09.2024', kind: 'anniversary' } });
    expect(date.status).toBe(200);
    const dd = await get(`/api/relationships/date?path=${q(date.body.path)}`);
    expect(dd.body.occasion).toMatchObject({ next: '2027-09-01', years: 3 });
    expect((await send('PUT', '/api/entity', { path: olga, set: { birthday: '31.04' } })).status).toBe(400);
    const cal = await get('/api/calendar?from=2026-12-01&to=2026-12-07');
    const titles = cal.body.days.flatMap((d: { items: Array<{ title: string }> }) => d.items.map((i) => i.title));
    expect(titles).toEqual(expect.arrayContaining(['День рождения: Ольга Иванова', 'День рождения мамы', 'Годовщина свадьбы (7)']));
  });
});
