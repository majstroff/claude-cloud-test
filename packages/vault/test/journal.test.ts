import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Assistant, Crm, Journal, Spheres, candidateFromLine } from '../src/index.ts';
import { openSample } from './helpers.ts';

async function setup(today?: string) {
  const s = await openSample(today);
  const sp = new Spheres(s.life);
  const crm = new Crm(s.life);
  return { ...s, sp, crm, j: new Journal(s.life, sp), a: new Assistant(s.life, sp, crm) };
}
const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf8');

describe('Дневник', () => {
  it('список записей, серия и запись дня', async () => {
    const { j } = await setup();
    const list = j.entries('2026-11-01', '2026-11-24');
    expect(list.map((e) => e.date)).toEqual(['2026-11-24', '2026-11-23']);
    const d23 = list[1]!;
    expect(d23).toMatchObject({ written: true, mood: 4, energy: 3, doneTasks: 1 });
    expect(d23.excerpt).toMatch(/^Спокойное утро/);
    expect(j.streak()).toBe(1);
    const e = j.entry('2026-11-23');
    expect(e.text).toMatch(/медитация помогла/);
    expect(e.gratitude).toEqual(['Анне за быстрый ответ']);
    expect(e.next).toBe('2026-11-24');
    expect(e.prompts).toHaveLength(3);
  });

  it('запись сохраняется в секцию «Дневник», остальное не трогается; будущее запрещено', async () => {
    const { j, dir } = await setup();
    const res = await j.saveEntry('2026-11-24', 'Хороший день.\nМного сделал.');
    expect(res.text).toBe('Хороший день.\nМного сделал.');
    const text = await read(dir, 'Daily/2026-11-24.md');
    expect(text).toContain('## Дневник\nХороший день.');
    expect(text).toContain('## Приоритеты\n1. Сопроводительное письмо');
    expect(j.streak()).toBe(2);
    await expect(j.saveEntry('2026-11-25', 'рано')).rejects.toThrow(/будущую/);
    // Новая заметка создаётся по шаблону.
    await j.saveEntry('2026-11-20', 'Запись задним числом');
    expect(await read(dir, 'Daily/2026-11-20.md')).toMatch(/type: daily[\s\S]*## Дневник\nЗапись задним числом/);
  });
});

describe('Аналитика и итоги', () => {
  it('неделя: задачи, настроение, сон, практики и выводы', async () => {
    const { j } = await setup();
    const { stats, prev, insights } = j.analytics('week', '2026-11-24');
    expect(stats).toMatchObject({ start: '2026-11-23', end: '2026-11-29', days: 2, label: 'Неделя 23–29 ноября' });
    expect(stats.tasks.done).toBe(1);
    expect(stats.tasks.doneByDay).toHaveLength(7);
    expect(stats.mood.avg).toBe(4);
    expect(stats.health.sleepAvg).toBe(6.5);
    expect(stats.practices).toEqual({ days: 1, minutes: 10 });
    expect(prev.start).toBe('2026-11-16');
    const texts = insights.map((i) => i.text).join('\n');
    expect(texts).toMatch(/Сон в среднем 6,5 ч/);
    expect(texts).toMatch(/Дневник: 1 из 2 дней/);
  });

  it('месяц: черновик с цифрами и списками, сохранение и пересчёт без потери ответов', async () => {
    const { j, dir } = await setup();
    const d = j.draft('month', '2026-11-24');
    expect(d.title).toBe('Итоги месяца 2026-11');
    expect(d.existing).toBeNull();
    expect(d.auto['Цифры']).toMatch(/Выполнено задач: 7/);
    expect(d.auto['Цифры']).toMatch(/расходы: 93 950 ₽/);
    expect(d.auto['Не сделано в срок']).toMatch(/Ответить рекрутеру Анне \(срок 2026-11-22\) — \[\[Поиск работы\]\]/);
    expect(d.auto['Наблюдения']).toMatch(/«Личный сайт-портфолио»: 3 задачи/);

    const saved = await j.saveReview('month', '2026-11-24', { 'Что получилось': 'Сайт запущен' });
    expect(saved).toEqual({ path: 'Areas/Итоги/Итоги месяца 2026-11.md', created: true });
    let text = await read(dir, saved.path);
    expect(text).toMatch(/type: review\nperiod: month\nstart: 2026-11-01\nend: 2026-11-30/);
    expect(text).toContain('## Что получилось\nСайт запущен');
    expect(j.reviews()).toMatchObject([{ period: 'month', start: '2026-11-01' }]);

    // Человек дописал свой текст в Obsidian; пересчёт меняет только цифры.
    await fs.writeFile(path.join(dir, saved.path), text.replace('## Чему научился\n', '## Чему научился\nДелегировать\n'));
    await j.vault.refresh(saved.path);
    await j.life.createTask({ text: 'Новая сделанная', due: '2026-11-24' });
    const again = await j.saveReview('month', '2026-11-24');
    expect(again.created).toBe(false);
    text = await read(dir, saved.path);
    expect(text).toContain('## Чему научился\nДелегировать');
    expect(text).toContain('## Что получилось\nСайт запущен');
    expect(j.draft('month', '2026-11-24').human['Чему научился']).toBe('Делегировать');
  });
});

describe('Помощник (локальные правила)', () => {
  it('не платный и не внешний', async () => {
    const { a } = await setup();
    expect(a.info().engine).toMatchObject({ id: 'local', external: false, paid: false });
  });

  it('приоритеты с объяснением', async () => {
    const { a } = await setup();
    const p = a.priorities(3);
    expect(p[0]!.task.title).toBe('Ответить рекрутеру Анне');
    expect(p[0]!.reasons).toEqual(expect.arrayContaining(['наивысший приоритет', 'просрочена на 2 дн.']));
    expect(p[0]!.actions[0]).toMatchObject({ kind: 'set_due', due: '2026-11-24' });
  });

  it('план дня: обязательное без дублей, фокус из трёх и текст приоритетов', async () => {
    const { a } = await setup();
    const plan = await a.planDay();
    expect(plan.fixed.filter((f) => f.path?.includes('Силовая')).length).toBe(1);
    expect(plan.focus).toHaveLength(3);
    expect(plan.prioritiesText.split('\n')[0]).toBe('1. Ответить рекрутеру Анне');
    expect(plan.actions[0]).toMatchObject({ kind: 'write_priorities', label: 'Заменить приоритеты дня' });
    await expect(a.planDay('2026-11-01')).rejects.toThrow(/сегодня или на будущий/);
  });

  it('просрочки по группам с вариантами переноса', async () => {
    const { a } = await setup('2026-12-20');
    const o = a.overdue();
    expect(o.total).toBeGreaterThan(3);
    const old = o.groups.find((g) => g.id === 'old')!;
    expect(old.items[0]!.actions.map((x) => x.kind === 'set_due' && x.due)).toContain(null);
    expect(o.summary[0]).toMatch(/^Просрочено \d+/);
  });

  it('строки заметки превращаются в предложения задач, документы не читаются', async () => {
    const { a } = await setup();
    const r = a.noteTasks('Inbox/Заметки с созвона с Анной.md');
    expect(r.candidates.map((c) => [c.text, c.due])).toEqual([
      ['Узнать вилку зарплаты в Beta Bank', null],
      ['Подготовить вопросы про команду', '2026-11-28'],
    ]);
    expect(r.actions[0]).toMatchObject({ kind: 'create_task', text: 'Узнать вилку зарплаты в Beta Bank [[Заметки с созвона с Анной]]' });
    expect(() => a.noteTasks('Areas/Документы/РВП.md')).toThrow(/не читает/);
    expect(() => a.related('Areas/Документы/РВП.md')).toThrow(/не читает/);
    expect(candidateFromLine('- Купил хлеб', '2026-11-24')).toBeNull();
    expect(candidateFromLine('TODO: купить билеты до 05.12', '2026-11-24')).toEqual({ text: 'Купить билеты', due: '2026-12-05' });
  });

  it('поиск работы, связанные записи и следующий шаг', async () => {
    const { a } = await setup();
    const job = a.jobSearch();
    expect(job.funnel).toMatchObject({ interview: 1, test: 1, applied: 1 });
    expect(job.advice.some((x) => x.title.startsWith('Тестовое до 2026-11-27'))).toBe(true);
    const rel = a.related('Resources/Знания/Метрики продукта.md');
    expect(rel.items[0]!.note.title).toBe('Исследование рынка продуктовой аналитики');
    expect(rel.items.every((i) => i.note.type !== 'document' && !i.note.sensitive)).toBe(true);
    expect(a.nextStep('Projects/Поиск работы.md')).toMatchObject({ kind: 'project', title: 'Ответить рекрутеру Анне' });
    expect(a.nextStep('Areas/Работа/Вакансии/Product Manager — Acme.md')).toMatchObject({ title: 'Отправить благодарность после первого интервью' });
  });
});

describe('Удаление заметок', () => {
  it('переносит файл в корзину Obsidian (.trash), не стирая его', async () => {
    const { vault, dir } = await setup();
    const rel = 'Inbox/Ideas/Курс по SQL для продактов.md';
    const before = await read(dir, rel);
    const r = await vault.trash(rel);
    expect(r).toEqual({ from: rel, to: '.trash/Курс по SQL для продактов.md' });
    expect(vault.get(rel)).toBeUndefined();
    expect(await read(dir, r.to)).toBe(before);
    await fs.writeFile(path.join(dir, rel), 'снова');
    await vault.refresh(rel);
    expect((await vault.trash(rel)).to).toBe('.trash/Курс по SQL для продактов 2.md');
    await expect(vault.trash('Нет такой.md')).rejects.toThrow(/не найдена/);
    await expect(vault.trash('../вне.md')).rejects.toThrow();
  });
});
