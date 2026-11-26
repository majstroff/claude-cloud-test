import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSample } from './helpers.ts';

describe('Life: задачи', () => {
  it('раскладывает задачи по спискам', async () => {
    const { life } = await openSample();
    const today = life.tasks('today').map((t) => t.title);
    expect(today).toEqual(
      expect.arrayContaining(['Написать сопроводительное письмо для Beta Bank', 'Позвонить в банк по поводу карты', 'Пробежка 5 км в лёгком темпе']),
    );
    expect(life.tasks('overdue').map((t) => t.title)).toEqual(['Ответить рекрутеру Анне']);
    const backlog = life.tasks('backlog').map((t) => t.title);
    expect(backlog).toContain('Попросить рекомендацию у бывшего руководителя');
    expect(backlog).not.toContain('Старая задача из архива');
    const upcoming = life.tasks('upcoming').map((t) => t.date);
    expect(upcoming.every((d) => d! > '2026-11-24' && d! <= '2026-12-01')).toBe(true);
  });

  it('определяет проект задачи по папке проекта', async () => {
    const { life } = await openSample();
    const t = life.tasks('open').find((x) => x.title.startsWith('Кейс: рост конверсии'))!;
    expect(t.project?.title).toBe('Личный сайт-портфолио');
  });

  it('создаёт задачу в ежедневной заметке и отмечает её выполненной', async () => {
    const { life, dir } = await openSample();
    const t = await life.createTask({ text: 'Купить молоко', due: 'завтра', priority: 'medium' });
    expect(t.path).toBe('Daily/2026-11-24.md');
    expect(t.due).toBe('2026-11-25');
    const raw = await fs.readFile(path.join(dir, t.path), 'utf8');
    expect(raw).toContain('- [ ] Купить молоко 🔼 📅 2026-11-25');
    // Задача добавлена в секцию «Задачи», а не в конец файла.
    expect(raw.indexOf('Купить молоко')).toBeLessThan(raw.indexOf('## Заметки'));

    const done = await life.updateTask({ path: t.path, line: t.line, raw: t.raw, action: 'complete' });
    expect(done.status).toBe('done');
    expect(done.doneDate).toBe('2026-11-24');
    expect(life.tasks('done').map((x) => x.title)).toContain('Купить молоко');

    const reopened = await life.updateTask({ path: done.path, line: done.line, raw: done.raw, action: 'reopen' });
    expect(reopened.status).toBe('open');
  });

  it('повторяющаяся задача создаёт следующий экземпляр', async () => {
    const { life } = await openSample();
    const t = life.tasks('today').find((x) => x.title === 'Пробежка 5 км в лёгком темпе')!;
    const done = await life.updateTask({ path: t.path, line: t.line, raw: t.raw, action: 'complete' });
    expect(done.status).toBe('done');
    const next = life.tasks('upcoming').find((x) => x.title === 'Пробежка 5 км в лёгком темпе');
    expect(next?.due).toBe('2026-12-01');
  });

  it('переносит задачу и находит её даже после правок файла выше', async () => {
    const { life, vault, dir } = await openSample();
    const t = life.tasks('backlog').find((x) => x.title === 'Выбрать утеплитель')!;
    const file = path.join(dir, t.path);
    const content = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, content.replace('## Задачи', '## Задачи\nНовая строка из Obsidian'));
    await vault.refresh(t.path);
    const moved = await life.updateTask({ path: t.path, line: t.line, raw: t.raw, action: 'setDue', due: '2026-12-05' });
    expect(moved.due).toBe('2026-12-05');
    expect(moved.line).toBe(t.line + 1);
  });

  it('сообщает о конфликте, если задачу изменили', async () => {
    const { life } = await openSample();
    const t = life.tasks('backlog')[0]!;
    await expect(
      life.updateTask({ path: t.path, line: t.line, raw: t.raw + ' изменено', action: 'complete' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('быстрый ввод понимает дату и приоритет в конце строки', async () => {
    const { life } = await openSample();
    const r = await life.quickAdd({ kind: 'task', text: 'Отправить отчёт завтра !1' });
    expect(r).toMatchObject({ kind: 'task', title: 'Отправить отчёт', due: '2026-11-25' });
    const task = life.tasks('upcoming').find((t) => t.title === 'Отправить отчёт')!;
    expect(task.priority).toBe('high');
    const idea = await life.quickAdd({ kind: 'idea', text: 'Подкаст\nс друзьями' });
    expect(idea.path).toBe('Inbox/Ideas/Подкаст.md');
  });
});

describe('Life: проекты, цели, циклы, идеи', () => {
  it('считает прогресс и следующий шаг проекта', async () => {
    const { life } = await openSample();
    const p = life.projects().find((x) => x.title === 'Поиск работы')!;
    expect(p.tasksTotal).toBe(9);
    expect(p.tasksDone).toBe(2);
    expect(p.progress).toBe(22);
    expect(p.tasksOverdue).toBe(1);
    expect(p.nextStep).toBe('Ответить рекрутеру Анне');
    expect(p.goal?.title).toBe('Найти работу продакт-менеджером');
    const site = life.projects().find((x) => x.title === 'Личный сайт-портфолио')!;
    expect(site.tasksTotal).toBe(9);
    expect(site.budget).toBe(15000);
    expect(life.projects().find((x) => x.title === 'Блог о путешествиях')?.status).toBe('archived');
  });

  it('показывает связи проекта: цель, контакты, события', async () => {
    const { life } = await openSample();
    const d = life.projectDetail('Projects/Поиск работы.md');
    const titles = d.related.map((r) => r.title);
    expect(titles).toEqual(expect.arrayContaining(['Анна Смирнова', 'Найти работу продакт-менеджером', 'Собеседование в Acme']));
    expect(d.stages).toContain('Отправить 30 откликов');
  });

  it('связывает цели с проектами и циклом', async () => {
    const { life } = await openSample();
    const goal = life.goals().find((g) => g.title === 'Найти работу продакт-менеджером')!;
    expect(goal.projects.map((p) => p.title).sort()).toEqual(['Личный сайт-портфолио', 'Поиск работы']);
    expect(goal.progressSource).toBe('projects');
    expect(life.goals().find((g) => g.title.startsWith('Финансовая'))!.progress).toBe(35);
    const [cycle] = life.cycles();
    expect(cycle).toMatchObject({ state: 'current', week: 6, end: '2027-01-10' });
    expect(cycle!.goals.map((g) => g.title).sort()).toEqual(['Найти работу продакт-менеджером', 'Пробежать полумарафон']);
    expect(cycle!.phases).toHaveLength(4);
  });

  it('создаёт цель, проект под цель и цикл', async () => {
    const { life, vault } = await openSample();
    const goal = await life.createGoal({ title: 'Выучить испанский', horizon: '1 год', why: 'Путешествия' });
    const project = await life.createProject({ title: 'Курс испанского A1', goal: goal.path, deadline: '2027-03-01' });
    expect(vault.require(project.path).frontmatter.goal).toBe('[[Выучить испанский]]');
    const g = life.goals().find((x) => x.path === goal.path)!;
    expect(g.projects.map((p) => p.title)).toEqual(['Курс испанского A1']);
    const cycle = await life.createCycle({ title: 'Цикл 2027 Q1', start: '2027-01-11' });
    expect(life.cycles().find((c) => c.path === cycle.path)?.state).toBe('planned');
  });

  it('превращает идею в проект и в задачу, сохраняя исходную заметку', async () => {
    const { life, vault } = await openSample();
    const r = await life.convertIdea('Inbox/Ideas/Telegram-канал о продуктовой аналитике.md', 'project');
    expect(r.created).toBe('Projects/Telegram-канал о продуктовой аналитике.md');
    const idea = vault.require('Inbox/Ideas/Telegram-канал о продуктовой аналитике.md');
    expect(idea.frontmatter).toMatchObject({ status: 'converted', converted_to: '[[Projects/Telegram-канал о продуктовой аналитике]]' });
    // Имя совпадает у идеи и проекта — ссылка должна различать их путём.
    expect(life.ideas().find((i) => i.path === idea.path)?.convertedTo).toBe(r.created);

    const t = await life.convertIdea('Inbox/Ideas/Курс по SQL для продактов.md', 'task', { due: '2026-12-01' });
    expect(t.created).toBe('Daily/2026-11-24.md');
    expect(life.tasks('open').some((x) => x.title.startsWith('Курс по SQL для продактов'))).toBe(true);

    await life.convertIdea('Inbox/Ideas/Курс по SQL для продактов.md', 'hypothesis');
    expect(vault.require('Inbox/Ideas/Курс по SQL для продактов.md').frontmatter.status).toBe('hypothesis');
  });
});

describe('Life: день, календарь, главная', () => {
  it('собирает день и сохраняет приоритеты и вечерний итог в заметку', async () => {
    const { life, dir } = await openSample();
    const d = await life.day('2026-11-24');
    expect(d.priorities).toContain('Сопроводительное письмо');
    expect(d.overdue.map((t) => t.title)).toEqual(['Ответить рекрутеру Анне']);
    await life.saveDaySection('2026-11-24', 'review', 'Сделал письмо, кейс перенёс.');
    await life.saveDayMetrics('2026-11-24', { mood: 4, energy: 2 });
    const raw = await fs.readFile(path.join(dir, 'Daily/2026-11-24.md'), 'utf8');
    expect(raw).toContain('## Итог дня\nСделал письмо, кейс перенёс.');
    expect(raw).toContain('mood: 4');
    const d2 = await life.day('2026-11-24');
    expect(d2.review).toBe('Сделал письмо, кейс перенёс.');
    expect(d2.energy).toBe(2);
  });

  it('создаёт ежедневную заметку при первом сохранении на новый день', async () => {
    const { life } = await openSample();
    const before = await life.day('2026-11-28');
    expect(before.note).toBeNull();
    const after = await life.saveDaySection('2026-11-28', 'priorities', '1. Отдых');
    expect(after.note?.path).toBe('Daily/2026-11-28.md');
    expect(after.priorities).toBe('1. Отдых');
  });

  it('показывает в календаре задачи, события, платежи и сроки', async () => {
    const { life } = await openSample();
    const days = life.calendar('2026-11-24', '2026-12-15');
    const kinds = (date: string) => days.find((d) => d.date === date)!.items.map((i) => `${i.kind}:${i.title}`);
    expect(kinds('2026-11-26')).toEqual(expect.arrayContaining(['event:Собеседование в Acme', 'task:Интервальная тренировка']));
    expect(kinds('2026-12-01')).toContain('event:Оплата аренды — декабрь');
    expect(kinds('2026-12-15')).toContain('deadline:Срок: Личный сайт-портфолио');
    expect(days.find((d) => d.date === '2026-11-24')!.hasDaily).toBe(true);
  });

  it('собирает данные главной', async () => {
    const { life } = await openSample();
    const d = life.dashboard();
    expect(d.todayTasks.length).toBeGreaterThan(0);
    expect(d.overdue).toHaveLength(1);
    expect(d.cycle?.week).toBe(6);
    expect(d.events.map((e) => e.title)).toContain('Собеседование в Acme');
    expect(d.ideasNew).toBe(2);
    expect(d.projects.every((p) => p.status === 'active')).toBe(true);
  });
});
