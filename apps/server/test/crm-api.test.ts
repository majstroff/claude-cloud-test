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
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-crm-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-crm-data-'));
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

describe('API: работа', () => {
  it('отдаёт воронку и проводит вакансию по статусам', async () => {
    const w = await get('/api/work');
    expect(w.status).toBe(200);
    expect(w.body.active).toBe(3);

    const created = await send('POST', '/api/entities', {
      type: 'vacancy',
      title: 'PM — Сигма',
      fields: { company: 'Сигма', salary: '200 тыс.', url: '' },
      createCompany: true,
    });
    expect(created.status).toBe(200);
    const rel = created.body.path;
    expect((await send('POST', '/api/vacancy/status', { path: rel, status: 'applied' })).status).toBe(200);
    expect((await send('POST', '/api/vacancy/interview', { path: rel, date: '2026-11-27', time: '12:00' })).status).toBe(200);
    const t = await send('POST', '/api/vacancy/test', { path: rel, due: '2026-11-29' });
    expect(t.body.task.due).toBe('2026-11-29');
    expect((await send('PUT', '/api/entity/section', { path: rel, section: 'cover_letter', content: 'Добрый день!' })).status).toBe(200);

    const d = await get(`/api/vacancy?path=${encodeURIComponent(rel)}`);
    expect(d.body).toMatchObject({ status: 'test', coverLetter: 'Добрый день!', interview: '2026-11-27', company: { title: 'Сигма' } });
    expect(d.body.tasks).toHaveLength(1);

    const cal = await get('/api/calendar?from=2026-11-27&to=2026-11-27');
    expect(cal.body.days[0].items.map((i: { title: string }) => i.title)).toContain('Собеседование: PM — Сигма');
  });

  it('понятные ошибки на неверные данные', async () => {
    const bad = await send('POST', '/api/entities', { type: 'vacancy', title: 'X', fields: { applied: '24.11.2026' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/ГГГГ-ММ-ДД/);
    expect((await send('POST', '/api/entities', { type: 'spaceship', title: 'X' })).status).toBe(400);
    expect((await send('POST', '/api/vacancy/status', { path: 'Projects/Поиск работы.md', status: 'offer' })).status).toBe(400);
    expect((await get('/api/vacancy?path=' + encodeURIComponent('Нет/Такой.md'))).status).toBe(404);
    // Без заголовка X-Frame-OS изменения запрещены.
    expect((await send('POST', '/api/entities', { type: 'contact', title: 'X' }, { host: H.host })).status).toBe(403);
  });
});

describe('API: контакты и документы', () => {
  it('журнал общения и карточка контакта', async () => {
    const rel = 'Resources/Контакты/Игорь Петров.md';
    const r = await send('POST', '/api/contacts/log', { path: rel, text: 'Созвон по отчёту', channel: 'звонок', nextContact: '2026-12-05' });
    expect(r.status).toBe(200);
    const c = await get(`/api/contact?path=${encodeURIComponent(rel)}`);
    expect(c.body).toMatchObject({ lastContact: '2026-11-24', nextContact: '2026-12-05', followUp: null });
    const list = await get('/api/contacts');
    expect(list.body.contacts.map((x: { title: string }) => x.title)).toContain('Игорь Петров');
    expect(list.body.companies.length).toBe(3);
    const company = await get(`/api/company?path=${encodeURIComponent('Resources/Компании/Студия Север.md')}`);
    expect(company.body.contacts.map((x: { title: string }) => x.title)).toEqual(['Игорь Петров']);
  });

  it('документы: список, изменение, задача на продление, напоминания на главной', async () => {
    const docs = await get('/api/documents');
    expect(docs.body.documents[0]).toMatchObject({ title: 'РВП', state: 'expiring' });
    const rel = 'Areas/Документы/Полис ОСАГО.md';
    expect((await send('PUT', '/api/entity', { path: rel, set: { sensitive: true, number: 'ХХХ 0123454521' } })).status).toBe(200);
    expect((await send('PUT', '/api/entity', { path: rel, set: { number: 'x'.repeat(41) } })).status).toBe(400);
    const d = await get(`/api/document?path=${encodeURIComponent(rel)}`);
    expect(d.body).toMatchObject({ sensitive: true, number: 'ХХХ 0123454521', numberLast4: '4521', warnings: [] });
    // В общем списке заметок свойства конфиденциального документа скрыты.
    const notes = await get('/api/notes?type=document');
    expect(JSON.stringify(notes.body)).not.toContain('0123454521');

    const task = await send('POST', '/api/documents/renewal-task', { path: 'Areas/Документы/РВП.md' });
    expect(task.body.task.due).toBe('2026-11-24');
    expect((await send('POST', '/api/documents/renewal-task', { path: 'Areas/Документы/РВП.md' })).status).toBe(409);
    expect((await send('POST', '/api/documents/renewal-task', { path: 'Areas/Документы/Диплом магистра.md' })).status).toBe(400);

    const dash = await get('/api/dashboard');
    expect(dash.body.reminders.documents.map((x: { title: string }) => x.title)).toEqual(['РВП']);
    expect(dash.body.reminders.followUps.map((x: { title: string }) => x.title)).toEqual(['Игорь Петров']);
    // Задача на продление сразу видна в «Сегодня».
    expect(dash.body.todayTasks.map((x: { title: string }) => x.title)).toContain('Продлить: РВП (до 2027-04-15)');
  });

  it('конфиденциальные документы не раскрывают свойства в общем списке заметок и поиске', async () => {
    const notes = await get('/api/notes?type=document');
    const rvp = notes.body.notes.find((n: { title: string }) => n.title === 'РВП');
    expect(rvp.frontmatter).toEqual({ type: 'document', sensitive: true });
    const s = await get('/api/search?q=' + encodeURIComponent('ВНЖ'));
    expect(s.body.results.every((r: { snippet: string; note: { sensitive: boolean } }) => !r.note.sensitive || r.snippet === '')).toBe(true);
  });
});
