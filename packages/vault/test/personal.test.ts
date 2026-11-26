import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Crm, Spheres, nextOccurrence, parseAnniversary } from '../src/index.ts';
import { openSample } from './helpers.ts';

async function setup(today?: string) {
  const s = await openSample(today);
  return { ...s, sp: new Spheres(s.life) };
}

const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf8');
const METRICS = 'Resources/Знания/Метрики продукта.md';
const BOOKMARK = 'Resources/Знания/Ссылки/North Star Metric — гайд Amplitude.md';
const TRIP = 'Areas/Путешествия/Тбилиси — декабрь 2026.md';
const FLIGHT = 'Areas/Путешествия/Брони/Перелёт Москва — Тбилиси.md';
const MOM = 'Resources/Контакты/Мама.md';

describe('Знания', () => {
  it('сводка: виды заметок, теги, висячие ссылки, непрочитанные ссылки', async () => {
    const { sp } = await setup();
    const o = sp.knowledge.overview();
    expect(o.byType).toMatchObject({ instruction: 1, research: 1, bookmark: 1 });
    expect(o.unreadBookmarks).toBe(1);
    expect(o.items.map((i) => i.title)).toContain('Как проходить продуктовые собеседования');
    // Документы и конфиденциальное в «Знания» не попадают.
    expect(o.items.some((i) => i.title === 'Паспорт')).toBe(false);
    expect(o.tags.find((t) => t.tag === 'аналитика')!.count).toBe(3);
    const targets = o.unresolved.map((u) => u.target);
    expect(targets).toEqual(expect.arrayContaining(['North Star Metric', 'Разбор продуктовых кейсов']));
    expect(o.orphans.some((i) => i.title === 'Резервная копия хранилища')).toBe(true);
    const filtered = sp.knowledge.overview({ type: 'research' });
    expect(filtered.items.map((i) => i.title)).toEqual(['Исследование рынка продуктовой аналитики']);
  });

  it('полнотекстовый поиск с фильтрами, без конфиденциального', async () => {
    const { sp } = await setup();
    const hits = sp.knowledge.search('метрики');
    expect(hits.map((h) => h.title)).toContain('Метрики продукта');
    expect(sp.knowledge.search('метрики', { type: 'bookmark' }).every((h) => h.type === 'bookmark')).toBe(true);
    expect(sp.knowledge.search('номер копии', { scope: 'all' }).some((h) => h.title === 'Паспорт')).toBe(false);
    expect(sp.knowledge.search('продакт', { scope: 'all' }).length).toBeGreaterThan(0);
  });

  it('связи: исходящие, обратные, висячие и упоминания без ссылки', async () => {
    const { sp } = await setup();
    const d = sp.knowledge.detail(METRICS);
    expect(d.outgoing.map((x) => x.title)).toEqual(expect.arrayContaining(['Как проходить продуктовые собеседования', 'Исследование рынка продуктовой аналитики']));
    expect(d.dangling).toEqual(expect.arrayContaining(['North Star Metric', 'Разбор продуктовых кейсов']));
    expect(d.suggestions.map((x) => x.title)).toContain('North Star Metric — гайд Amplitude');
    expect(() => sp.knowledge.detail('Resources/Паспорт.md')).toThrow(/Конфиденциальные/);
  });

  it('связывает заметки и создаёт заметку для висячей ссылки', async () => {
    const { sp, dir, vault } = await setup();
    await sp.knowledge.link(BOOKMARK, METRICS, 'где применяю');
    expect(await read(dir, BOOKMARK)).toMatch(/## Связи\n- \[\[Метрики продукта\]\] — где применяю/);
    await expect(sp.knowledge.link(BOOKMARK, METRICS)).rejects.toThrow(/уже есть/);
    await expect(sp.knowledge.link('Resources/Паспорт.md', METRICS)).rejects.toThrow(/конфиденциальные/i);
    const n = await sp.knowledge.createForLink('Разбор продуктовых кейсов');
    expect(n.path).toBe('Resources/Знания/Разбор продуктовых кейсов.md');
    expect(vault.resolve('Разбор продуктовых кейсов')).toBe(n.path);
    expect(sp.knowledge.unresolved().some((u) => u.target === 'Разбор продуктовых кейсов')).toBe(false);
    expect(await read(dir, n.path)).toContain('Ссылаются: [[Метрики продукта]]');
    await expect(sp.knowledge.createForLink('Метрики продукта')).rejects.toThrow(/уже есть/);
  });

  it('создаёт инструкцию, исследование и ссылку по шаблонам', async () => {
    const { sp, dir } = await setup();
    const i = await sp.knowledge.createEntity({ type: 'instruction', title: 'Как продлить РВП', fields: { topic: 'Документы', tags: 'документы, миграция' } });
    const text = await read(dir, i.path);
    expect(i.path).toBe('Resources/Знания/Инструкции/Как продлить РВП.md');
    expect(text).toMatch(/status: active/);
    expect(text).toMatch(/reviewed: 2026-11-24/);
    expect(text).toContain('## Шаги');
    await expect(sp.knowledge.createEntity({ type: 'bookmark', title: 'Без адреса' })).rejects.toThrow(/адрес/);
    await expect(sp.knowledge.createEntity({ type: 'bookmark', title: 'Плохой', fields: { url: 'ftp://x' } })).rejects.toThrow(/http/);
    const b = await sp.knowledge.createEntity({ type: 'bookmark', title: 'SQL-шпаргалка', fields: { url: 'https://example.com/sql' } });
    expect(await read(dir, b.path)).toMatch(/read: false/);
  });
});

describe('Путешествия', () => {
  it('поездка: фаза по датам, бюджет, брони, вещи, документы', async () => {
    const { sp } = await setup();
    const t = sp.travel.trip(sp.life.vault.require(TRIP));
    expect(t).toMatchObject({ phase: 'booked', daysUntil: 24, nights: 5, budget: 90000, booked: 62500, unpaid: 62500, spent: 0, left: 27500, bookings: 2, packingTotal: 3, packingDone: 1, documentIssues: 0 });
    const kazan = sp.travel.trips().find((x) => x.title.startsWith('Казань'))!;
    expect(kazan.phase).toBe('done');
    const d = sp.travel.tripDetail(TRIP);
    expect(d.bookingList.map((b) => b.kind)).toEqual(['flight', 'apartment']);
    expect(d.routePoints[0]).toEqual({ date: '2026-12-18', text: 'Прилёт, Сололаки, ужин' });
    expect(d.documents[0]).toMatchObject({ title: 'Паспорт', level: 'ok' });
    expect(d.packing).toHaveLength(3);
    expect(d.tasks.map((x) => x.title)).toEqual(['Оформить страховку для поездки']);
    expect(sp.travel.next()?.path).toBe(TRIP);
  });

  it('в поездке и после: фаза меняется сама', async () => {
    const during = await setup('2026-12-20');
    expect(during.sp.travel.trip(during.vault.require(TRIP)).phase).toBe('ongoing');
    expect(during.sp.travel.day('2026-12-20').trips.map((t) => t.path)).toEqual([TRIP]);
    const after = await setup('2026-12-25');
    expect(after.sp.travel.trip(after.vault.require(TRIP)).phase).toBe('done');
  });

  it('вещи в поездку не попадают в бэклог, шаблон добавляет недостающее', async () => {
    const { sp, dir } = await setup();
    expect(sp.life.tasks('backlog').some((t) => t.section === 'Список вещей')).toBe(false);
    expect((await sp.travel.fillPacking(TRIP, 'base')).added).toBe(8);
    expect((await sp.travel.fillPacking(TRIP, 'base')).added).toBe(0);
    const text = await read(dir, TRIP);
    expect(text).toMatch(/## Список вещей\n- \[x\] Паспорт и документы\n- \[ \] Переходник для розеток\n- \[ \] Тёплая куртка\n- \[ \] Билеты и брони/);
    await expect(sp.travel.fillPacking(TRIP, 'луна')).rejects.toThrow(/Неизвестный/);
    const task = await sp.travel.addPackingItem(TRIP, 'Наушники');
    expect(task.section).toBe('Список вещей');
  });

  it('оплата брони пишет расход в финансы и меняет остаток бюджета', async () => {
    const { sp, dir } = await setup();
    const r = await sp.travel.payBooking(FLIGHT);
    expect(r.booking.paid).toBe(true);
    expect(r.transaction).toMatchObject({ amount: 24500, category: 'Путешествия', kind: 'expense' });
    expect(await read(dir, 'Areas/Финансы/Операции/2026-11.md')).toContain('Тбилиси — декабрь 2026: Перелёт Москва — Тбилиси');
    const t = sp.travel.trip(sp.life.vault.require(TRIP));
    expect(t).toMatchObject({ spent: 24500, unpaid: 38000, left: 27500 });
    await expect(sp.travel.payBooking(FLIGHT)).rejects.toThrow(/уже/);
    await sp.travel.addExpense(TRIP, { amount: 3000, description: 'такси' });
    expect(sp.travel.trip(sp.life.vault.require(TRIP))).toMatchObject({ spent: 27500, left: 24500 });
  });

  it('календарь: начало, возвращение, выезд и брони', async () => {
    const { sp } = await setup();
    const days = sp.life.calendar('2026-12-17', '2026-12-24');
    const on = (d: string) => days.find((x) => x.date === d)!.items.map((i) => i.title);
    expect(on('2026-12-18')).toEqual(expect.arrayContaining(['Поездка: Тбилиси — декабрь 2026', 'Перелёт Москва — Тбилиси', 'Апартаменты в Сололаки']));
    expect(on('2026-12-23')).toEqual(expect.arrayContaining(['Возвращение: Тбилиси — декабрь 2026', 'Выезд: Апартаменты в Сололаки']));
  });

  it('проверяет даты и маршрут', async () => {
    const { sp, dir } = await setup();
    await expect(sp.travel.updateEntity(TRIP, { end: '2026-12-01' })).rejects.toThrow(/раньше начала/);
    await expect(sp.travel.createEntity({ type: 'trip', title: 'Наоборот', fields: { start: '2027-01-10', end: '2027-01-05' } })).rejects.toThrow(/раньше/);
    await sp.travel.addRoutePoint(TRIP, { date: '2026-12-22', text: 'Кахетия, винодельни' });
    expect(await read(dir, TRIP)).toContain('- 2026-12-22 · Кахетия, винодельни');
    const n = await sp.travel.createEntity({ type: 'trip', title: 'Стамбул', fields: { start: '2027-03-01', end: '2027-03-05', documents: ['Паспорт'] } });
    expect(await read(dir, n.path)).toMatch(/documents:\n  - "\[\[Паспорт\]\]"/);
  });

  it('предупреждает, если документ истекает до конца поездки', async () => {
    const { sp } = await setup();
    const n = await sp.travel.createEntity({ type: 'trip', title: 'Далеко', fields: { start: '2031-05-01', end: '2031-05-20', documents: ['Паспорт', 'Виза в никуда'] } });
    const d = sp.travel.tripDetail(n.path).documents;
    expect(d[0]).toMatchObject({ title: 'Паспорт', level: 'error' });
    expect(d[1]).toMatchObject({ level: 'unknown' });
  });
});

describe('Отношения', () => {
  it('ежегодные даты: из контактов и заметок дат, сколько лет, напоминание', async () => {
    const { sp } = await setup();
    const o = sp.relations.occasions();
    expect(o.slice(0, 3).map((x) => [x.title, x.next, x.daysLeft])).toEqual([
      ['День рождения: Ольга Иванова', '2026-12-01', 7],
      ['День рождения мамы', '2026-12-03', 9],
      ['Годовщина свадьбы', '2026-12-07', 13],
    ]);
    expect(o[0]!.years).toBeNull();
    expect(o[1]!.person?.path).toBe(MOM);
    expect(o[2]).toMatchObject({ years: 7, remind: true, giftIdeas: 1 });
    expect(sp.relations.reminders().occasions.map((x) => x.title)).toEqual(['День рождения: Ольга Иванова', 'Годовщина свадьбы']);
  });

  it('календарь показывает даты каждый год, без повторов', async () => {
    const { sp } = await setup();
    const dec = sp.life.calendar('2026-12-01', '2027-12-31').flatMap((d) => d.items.map((i) => `${d.date} ${i.title}`));
    expect(dec.filter((x) => x.includes('мамы'))).toEqual(['2026-12-03 День рождения мамы', '2027-12-03 День рождения мамы']);
    expect(dec).toContain('2027-12-07 Годовщина свадьбы (8)');
  });

  it('ритм общения и договорённости', async () => {
    const { sp } = await setup();
    const people = sp.relations.people();
    expect(people.map((p) => p.title)).toEqual(['Ольга Иванова', 'Мама']);
    expect(people[0]).toMatchObject({ due: '2026-11-19', dueState: 'overdue', giftIdeas: 1, agreements: 1, birthdayIn: 7 });
    expect(people[1]).toMatchObject({ due: '2026-11-29', dueState: null });
    expect(sp.relations.contactsDue().map((p) => p.title)).toEqual(['Ольга Иванова']);
    expect(sp.relations.agreements().map((t) => t.title)).toEqual(expect.arrayContaining(['Скинуть Ольге варианты экскурсий', 'Прислать Игорю отчёт по первому этапу']));
    const t = await sp.relations.addAgreement(MOM, { text: 'Помочь с дачей', due: '2026-12-06' });
    expect(t.section).toBe('Договорённости');
    await new Crm(sp.life).logInteraction({ path: 'Resources/Контакты/Ольга Иванова.md', text: 'Созвонились' });
    expect(sp.relations.contactsDue()).toHaveLength(0);
  });

  it('подарки: идея, подарено, расход в финансах', async () => {
    const { sp, dir } = await setup();
    await sp.relations.addGiftIdea(MOM, 'Тёплый плед');
    await expect(sp.relations.addGiftIdea(MOM, 'тёплый плед')).rejects.toThrow(/уже/);
    const r = await sp.relations.giveGift(MOM, { text: 'Сертификат в спа', occasion: 'День рождения', cost: '5 000' });
    expect(r.ideas).toEqual(['Книга про сад', 'Тёплый плед']);
    expect(r.given[0]).toEqual({ date: '2026-11-24', text: 'Сертификат в спа · День рождения · 5 000 ₽' });
    expect(r.transaction).toMatchObject({ category: 'Подарки', amount: 5000 });
    const text = await read(dir, MOM);
    expect(text).toMatch(/## Идеи подарков\n- Книга про сад\n- Тёплый плед\n/);
    await expect(sp.relations.addGiftIdea('Areas/Документы/РВП.md', 'x')).rejects.toThrow(/Подарки/);
  });

  it('создание даты и день рождения в контакте', async () => {
    const { sp, dir } = await setup();
    await expect(sp.relations.createEntity({ type: 'important_date', title: 'Разовое', fields: { date: '05-01', yearly: false } })).rejects.toThrow(/год/);
    await expect(sp.relations.createEntity({ type: 'important_date', title: 'Плохая', fields: { date: '31.02' } })).rejects.toThrow(/Дата/);
    const n = await sp.relations.createEntity({ type: 'important_date', title: 'День знакомства', fields: { date: '14.02.2015', kind: 'anniversary', person: 'Ольга Иванова' } });
    const text = await read(dir, n.path);
    expect(n.path).toBe('Areas/Отношения/Даты/День знакомства.md');
    expect(text).toMatch(/date: 2015-02-14/);
    expect(text).toMatch(/person: "\[\[Ольга Иванова\]\]"/);
    const crm = new Crm(sp.life);
    await crm.updateEntity(MOM, { birthday: '03.12' });
    expect(await read(dir, MOM)).toMatch(/birthday: "?12-03"?/);
  });

  it('разбор ежегодных дат', () => {
    expect(parseAnniversary('1990-03-15')).toEqual({ year: 1990, md: '03-15' });
    expect(parseAnniversary('5.3')).toEqual({ year: null, md: '03-05' });
    expect(parseAnniversary('29.02.2023')).toBeNull();
    expect(parseAnniversary('29.02')).toEqual({ year: null, md: '02-29' });
    expect(nextOccurrence('02-29', '2027-01-10')).toBe('2027-02-28');
    expect(nextOccurrence('02-29', '2027-03-01')).toBe('2028-02-29');
    expect(nextOccurrence('11-24', '2026-11-24')).toBe('2026-11-24');
  });
});
