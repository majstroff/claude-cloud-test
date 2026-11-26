import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Spheres, moonPhase, parseQuotes, splitRow } from '../src/index.ts';
import { openSample } from './helpers.ts';

async function setup(today?: string) {
  const s = await openSample(today);
  return { ...s, sp: new Spheres(s.life) };
}

const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf8');

describe('Финансы', () => {
  it('сводка месяца: доходы, расходы, лимиты, план и факт', async () => {
    const { sp } = await setup();
    const o = sp.finance.overview('2026-11');
    expect(o.income).toBe(220000);
    expect(o.expense).toBe(93950);
    expect(o.saved).toBe(20000);
    expect(o.factBalance).toBe(106050);
    const food = o.categories.find((c) => c.category === 'Продукты')!;
    expect(food).toMatchObject({ limit: 30000, spent: 21150, left: 8850, over: false });
    const cafe = o.categories.find((c) => c.category === 'Кафе')!;
    expect(cafe.over).toBe(true);
    // Категория без лимита тоже видна.
    expect(o.categories.find((c) => c.category === 'Дом')).toMatchObject({ limit: null, spent: 15000 });
    expect(o.plan.income).toBe(250000);
    expect(o.plan.limits).toBe(101000);
    // Подписки 399 + 750 и платёж по рассрочке 7500 вне лимитов.
    expect(o.plan.obligations).toBe(8649);
    expect(o.plan.savings).toBe(30000);
    expect(o.plan.balance).toBe(250000 - 101000 - 8649 - 30000);
    // Прогноз: факт + ещё ожидаемый доход − неоплаченное до конца месяца (рассрочка и Яндекс Плюс).
    expect(o.unpaidTotal).toBe(7899);
    expect(o.forecast).toBe(106050 + 30000 - 7899);
    // Расходы по проектам из операций.
    expect(o.projects.find((p) => p.title === 'Ремонт балкона')).toMatchObject({ budget: 80000, spent: 15000 });
    expect(o.transactions[0]!.date).toBe('2026-11-22');
    expect(o.transactions.find((t) => t.category === 'Фриланс')!.link?.path).toBe('Resources/Компании/Студия Север.md');
  });

  it('предстоящие платежи: подписки, обязательные платежи и долги', async () => {
    const { sp } = await setup();
    const ob = sp.finance.obligations('2026-12-05');
    expect(ob.map((o) => o.title)).toEqual(['Рассрочка за ноутбук', 'Яндекс Плюс', 'Оплата аренды — декабрь', 'Домашний интернет']);
    expect(ob[0]).toMatchObject({ kind: 'debt', amount: 7500, daysLeft: 1 });
    const subs = sp.finance.subscriptions();
    expect(subs.find((s) => s.title === 'Облачное хранилище')!.monthly).toBe(165.83);
  });

  it('добавляет операцию в таблицу месяца и создаёт заметку нового месяца', async () => {
    const { sp, dir } = await setup();
    const tx = await sp.finance.addTransaction({ kind: 'expense', amount: '1 250,50', category: 'Продукты', description: 'Рынок | овощи', link: 'Ремонт балкона' });
    expect(tx).toMatchObject({ date: '2026-11-24', amount: 1250.5, category: 'Продукты', description: 'Рынок / овощи' });
    expect(tx.project?.title).toBe('Ремонт балкона');
    const file = await read(dir, 'Areas/Финансы/Операции/2026-11.md');
    expect(file).toContain('| 2026-11-24 | Расход | 1250.50 | Продукты | Рынок / овощи | [[Ремонт балкона]] |');

    const dec = await sp.finance.addTransaction({ date: '2026-12-02', kind: 'income', amount: 5000, category: 'Фриланс' });
    expect(dec.path).toBe('Areas/Финансы/Операции/2026-12.md');
    expect(sp.finance.overview('2026-12').income).toBe(5000);
    await expect(sp.finance.addTransaction({ kind: 'expense', amount: 0 })).rejects.toThrow(/больше нуля/);
  });

  it('изменяет и удаляет операцию; при смене месяца переносит её', async () => {
    const { sp, dir } = await setup();
    const tx = await sp.finance.addTransaction({ kind: 'expense', amount: 1500, category: 'Продукты', description: 'Тестовая покупка' });
    const edited = await sp.finance.updateTransaction(tx.path, tx.line, tx.raw, { kind: 'expense', amount: '1700', category: 'Кафе', description: 'Обед', date: '2026-11-20' });
    expect(edited).toMatchObject({ amount: 1700, category: 'Кафе', description: 'Обед', date: '2026-11-20', line: tx.line });
    let file = await read(dir, 'Areas/Финансы/Операции/2026-11.md');
    expect(file).toContain('| 2026-11-20 | Расход | 1700 | Кафе | Обед |');
    expect(file).not.toContain('Тестовая покупка');
    await expect(sp.finance.updateTransaction(tx.path, tx.line, tx.raw, { kind: 'expense', amount: 1 })).rejects.toMatchObject({ code: 'conflict' });

    const moved = await sp.finance.updateTransaction(edited.path, edited.line, edited.raw, { kind: 'expense', amount: 1700, category: 'Кафе', description: 'Обед', date: '2026-12-01' });
    expect(moved.path).toBe('Areas/Финансы/Операции/2026-12.md');
    expect(await read(dir, 'Areas/Финансы/Операции/2026-11.md')).not.toContain('Обед');

    const del = await sp.finance.deleteTransaction(moved.path, moved.line, moved.raw);
    expect(del).toMatchObject({ amount: 1700, description: 'Обед' });
    file = await read(dir, 'Areas/Финансы/Операции/2026-12.md');
    expect(file).not.toContain('Обед');
    await expect(sp.finance.deleteTransaction('Projects/Ремонт балкона.md', 0, 'x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('оплата подписки переносит дату списания и пишет расход', async () => {
    const { sp, vault } = await setup();
    const rel = 'Areas/Финансы/Подписки/Яндекс Плюс.md';
    const r = await sp.finance.pay(rel);
    expect(r.transaction).toMatchObject({ amount: 399, category: 'Подписки', kind: 'expense' });
    expect(vault.require(rel).frontmatter.next_payment).toBe('2026-12-28');
    expect(sp.finance.detail(rel).history[0]!.text).toContain('Оплачено 399');
    expect(sp.finance.detail(rel).transactions).toHaveLength(1);
  });

  it('разовый платёж отмечается оплаченным, повторяющийся — переносится', async () => {
    const { sp, vault } = await setup();
    const once = 'Calendar/Оплата аренды — декабрь.md';
    await sp.finance.pay(once, { date: '2026-11-24' });
    expect(vault.require(once).frontmatter).toMatchObject({ status: 'paid', paid: '2026-11-24' });
    await expect(sp.finance.pay(once)).rejects.toThrow(/уже оплачен/);

    const n = await sp.finance.createEntity({ type: 'payment', title: 'Коммунальные', fields: { amount: 6200, date: '2026-11-25', recurrence: 'monthly', category: 'Коммунальные' } });
    expect(n.path).toBe('Areas/Финансы/Платежи/Коммунальные.md');
    await sp.finance.pay(n.path, { amount: 6450 });
    expect(vault.require(n.path).frontmatter).toMatchObject({ date: '2026-12-25', status: 'planned' });
    expect(sp.finance.overview().transactions[0]).toMatchObject({ amount: 6450, category: 'Коммунальные' });
  });

  it('платёж по долгу уменьшает остаток и закрывает долг', async () => {
    const { sp, vault } = await setup();
    const rel = 'Areas/Финансы/Долги/Рассрочка за ноутбук.md';
    const r = await sp.finance.debtPayment(rel, { amount: 7500 });
    expect(r.remaining).toBe(37500);
    expect(vault.require(rel).frontmatter.next_payment).toBe('2026-12-25');
    await expect(sp.finance.debtPayment(rel, { amount: 50000 })).rejects.toThrow(/больше остатка/);

    const lent = 'Areas/Финансы/Долги/Игорь — заём до зарплаты.md';
    const back = await sp.finance.debtPayment(lent, { amount: 10000 });
    expect(back.transaction).toMatchObject({ kind: 'income', category: 'Возврат долга' });
    expect(sp.finance.debt(vault.require(lent))).toMatchObject({ status: 'closed', remaining: 0, paidPercent: 100 });
    expect(sp.finance.debt(vault.require(lent)).counterparty?.path).toBe('Resources/Контакты/Игорь Петров.md');
  });

  it('накопления: пополнение, прогресс, связь с целью', async () => {
    const { sp, vault } = await setup();
    const rel = 'Areas/Финансы/Накопления/Подушка безопасности.md';
    let s = sp.finance.savingsOf(vault.require(rel));
    expect(s.progress).toBe(35);
    expect(s.goal?.path).toBe('Areas/Goals/Финансовая подушка на 6 месяцев.md');
    expect(s.neededPerMonth).toBeGreaterThan(30000);
    const r = await sp.finance.contribute(rel, { amount: 30000 });
    expect(r.current).toBe(240000);
    expect(r.transaction?.kind).toBe('saving');
    await expect(sp.finance.contribute(rel, { amount: 999999, withdraw: true })).rejects.toThrow(/не больше/);
    s = sp.finance.savingsOf(vault.require(rel));
    expect(s.progress).toBe(40);
  });

  it('бюджет сохраняется таблицей в заметку', async () => {
    const { sp, dir } = await setup();
    const b = await sp.finance.saveBudget({ income: 260000, limits: [{ category: 'Продукты', limit: 32000 }, { category: 'Спорт', limit: '5 000' }] });
    expect(b.income).toBe(260000);
    expect(b.limits).toEqual([{ category: 'Продукты', limit: 32000 }, { category: 'Спорт', limit: 5000 }]);
    const file = await read(dir, 'Areas/Финансы/Бюджет.md');
    expect(file).toContain('| Спорт | 5000 |');
    expect(file).toContain('income: 260000');
    await expect(sp.finance.saveBudget({ limits: [{ category: 'А', limit: 1 }, { category: 'а', limit: 2 }] })).rejects.toThrow(/дважды/);
  });

  it('подписки и платежи по долгам попадают в календарь', async () => {
    const { life } = await setup();
    const days = life.calendar('2026-11-24', '2026-11-30');
    const titles = days.flatMap((d) => d.items.map((i) => i.title));
    expect(titles).toContain('Подписка: Яндекс Плюс');
    expect(titles).toContain('Платёж по долгу: Рассрочка за ноутбук');
  });

  it('строки таблицы с экранированной ссылкой разбираются верно', () => {
    expect(splitRow('| 2026-11-01 | Расход | 10 | Дом | Лампа | [[Дом/Покупки\\|Покупки]] |')).toEqual(['2026-11-01', 'Расход', '10', 'Дом', 'Лампа', '[[Дом/Покупки\\|Покупки]]']);
    expect(splitRow('|---|---|')).toBeNull();
  });
});

describe('Регулярные дела', () => {
  it('вычисляет следующий срок и что нужно сделать сегодня', async () => {
    const { sp } = await setup();
    const due = sp.routines.dueToday().map((r) => r.title);
    expect(due).toEqual(['Генеральная уборка', 'Витамин D']);
    const clean = sp.routines.list('home').find((r) => r.title === 'Генеральная уборка')!;
    expect(clean).toMatchObject({ next: '2026-11-23', due: 'overdue', daysOverdue: 1, done30: 2 });
    expect(sp.routines.list('home').find((r) => r.title.startsWith('Заменить'))!).toMatchObject({ next: '2026-11-26', due: 'soon' });
  });

  it('отметка «Сделано» пишет дату и историю', async () => {
    const { sp, dir } = await setup();
    const rel = 'Areas/Дом/Регулярное/Генеральная уборка.md';
    const r = await sp.routines.markDone(rel, { note: 'плюс окна' });
    expect(r).toMatchObject({ lastDone: '2026-11-24', next: '2026-12-01', due: 'later' });
    expect(await read(dir, rel)).toContain('- 2026-11-24 · Сделано: плюс окна');
    await expect(sp.routines.markDone(rel, { date: '2026-12-01' })).rejects.toThrow(/будущем/);
  });

  it('создаётся в папке своей сферы и повторяется в календаре', async () => {
    const { sp, life } = await setup();
    const n = await sp.routines.createEntity({ type: 'routine', title: 'Полить цветы', fields: { sphere: 'home', every: 7, start: '2026-11-25' } });
    expect(n.path).toBe('Areas/Дом/Регулярное/Полить цветы.md');
    const dates = life.calendar('2026-11-24', '2026-12-09').filter((d) => d.items.some((i) => i.title === 'Полить цветы')).map((d) => d.date);
    expect(dates).toEqual(['2026-11-25', '2026-12-02', '2026-12-09']);
    // Ежедневное дело — только ближайший раз, а не каждый день месяца.
    const daily = life.calendar('2026-11-24', '2026-12-09').filter((d) => d.items.some((i) => i.title === 'Витамин D'));
    expect(daily.map((d) => d.date)).toEqual(['2026-11-24']);
    await expect(sp.routines.createEntity({ type: 'routine', title: 'X', fields: { every: 0 } })).rejects.toThrow(/не меньше 1/);
  });
});

describe('Спорт и здоровье', () => {
  it('читает тренировки, упражнения и прогресс по весам', async () => {
    const { sp } = await setup();
    const today = sp.health.workoutsOn('2026-11-24');
    expect(today).toHaveLength(1);
    expect(today[0]!.exercises[0]).toEqual({ name: 'Приседания', sets: 4, reps: '8', weight: 62.5 });
    const squat = sp.health.exerciseStats().find((e) => e.name === 'Приседания')!;
    expect(squat).toMatchObject({ best: 60, count: 1 });
    const detail = sp.health.workoutDetail(today[0]!.path);
    expect(detail.previous['Приседания']).toMatchObject({ date: '2026-11-20', weight: 60 });
  });

  it('тренировка выполняется, упражнения дописываются, создаётся повтор', async () => {
    const { sp, vault, dir } = await setup();
    const rel = 'Areas/Здоровье/Тренировки/2026-11-24 Силовая А.md';
    await sp.health.addExercise(rel, { name: 'Планка', sets: 3, reps: '60 с', weight: '' });
    const w = await sp.health.setWorkoutStatus(rel, 'done', { duration: 55, effort: 4 });
    expect(w).toMatchObject({ status: 'done', duration: 55, effort: 4 });
    expect(await read(dir, rel)).toContain('| Планка | 3 | 60 с |  |');
    expect(sp.health.exerciseStats().find((e) => e.name === 'Приседания')).toMatchObject({ best: 62.5, count: 2 });

    const next = await sp.health.repeatWorkout(rel, '2026-11-27');
    expect(next.path).toBe('Areas/Здоровье/Тренировки/2026-11-27 Силовая А.md');
    expect(next).toMatchObject({ status: 'planned', kind: 'strength', time: '19:00' });
    expect(next.exercises.map((e) => e.name)).toEqual(['Приседания', 'Жим лёжа', 'Тяга в наклоне', 'Планка']);
    expect(vault.require(next.path).type).toBe('workout');
  });

  it('пропущенная тренировка не показывается в календаре', async () => {
    const { sp, life } = await setup();
    const rel = 'Areas/Здоровье/Тренировки/2026-11-24 Силовая А.md';
    expect(life.calendar('2026-11-24', '2026-11-24')[0]!.items.some((i) => i.path === rel)).toBe(true);
    await sp.health.setWorkoutStatus(rel, 'skipped');
    expect(life.calendar('2026-11-24', '2026-11-24')[0]!.items.some((i) => i.path === rel)).toBe(false);
  });

  it('сон, вода, вес и питание — в ежедневной заметке', async () => {
    const { sp, dir } = await setup();
    expect(sp.health.dayHealth('2026-11-23')).toMatchObject({ sleep: 6.5, sleep_quality: 3, water: 1.5, weight: 78.4 });
    await sp.health.saveDayHealth('2026-11-24', { sleep: '7,5', water: 2, steps: 8000, recovery: 4 });
    await sp.health.saveNutrition('2026-11-24', 'Завтрак: овсянка\nОбед: суп');
    const file = await read(dir, 'Daily/2026-11-24.md');
    expect(file).toContain('sleep: 7.5');
    expect(file).toContain('## Питание\nЗавтрак: овсянка');
    await expect(sp.health.saveDayHealth('2026-11-24', { sleep: 30 })).rejects.toThrow(/не больше 24/);
    await expect(sp.health.saveDayHealth('2026-11-24', { recovery: 7 })).rejects.toThrow(/от 1 до 5/);
    await expect(sp.health.saveDayHealth('2026-11-30', { sleep: 7 })).rejects.toThrow(/прошедшие/);
    const o = sp.health.overview(sp.routines);
    expect(o.averages.sleep).toBe(7);
    expect(o.week.done).toBe(0); // неделя начинается с понедельника 23-го, выполненных пока нет
    expect(o.week.previousDone).toBe(2);
    expect(o.routines.map((r) => r.title)).toContain('Витамин D');
  });
});

describe('Чтение и обучение', () => {
  it('материалы, навыки, цитаты и статистика', async () => {
    const { sp } = await setup();
    const o = sp.learning.overview();
    const book = o.items.find((i) => i.title === 'Inspired')!;
    expect(book).toMatchObject({ type: 'book', status: 'active', percent: 38, quotes: 1, openActions: 1 });
    expect(book.skill?.path).toBe('Resources/Обучение/Навыки/Продуктовый менеджмент.md');
    expect(o.stats).toMatchObject({ active: 1, want: 1, doneThisYear: 1 });
    expect(o.quotes.map((q) => q.title).sort()).toEqual(['Inspired', 'Как писать PRD']);
    const pm = o.skills.find((s) => s.title === 'Продуктовый менеджмент')!;
    expect(pm.materials.map((m) => m.title).sort()).toEqual(['Inspired', 'SQL для аналитиков']);
    expect(o.skills.find((s) => s.title === 'Английский язык')!.minutes7).toBe(75);
  });

  it('прогресс до конца отмечает материал прочитанным', async () => {
    const { sp } = await setup();
    const rel = 'Resources/Обучение/Книги/Inspired.md';
    expect((await sp.learning.setProgress(rel, { progress: 200 })).percent).toBe(54);
    await expect(sp.learning.setProgress(rel, { progress: 400 })).rejects.toThrow(/больше 368/);
    const done = await sp.learning.setProgress(rel, { progress: 368 });
    expect(done).toMatchObject({ status: 'done', finished: '2026-11-24', percent: 100 });
    const course = await sp.learning.setProgress('Resources/Обучение/Курсы/SQL для аналитиков.md', { status: 'active' });
    expect(course.started).toBe('2026-11-24');
  });

  it('цитата, действие-задача и занятие по навыку пишутся в заметки', async () => {
    const { sp, life, dir } = await setup();
    const rel = 'Resources/Обучение/Книги/Inspired.md';
    await sp.learning.addQuote(rel, { text: 'Продукт — это не проект', page: '12' });
    const task = await sp.learning.addAction(rel, { text: 'Провести 5 интервью с пользователями', due: 'завтра' });
    expect(task.section).toBe('Действия');
    expect(task.due).toBe('2026-11-25');
    expect(life.tasks('upcoming').some((t) => t.title === 'Провести 5 интервью с пользователями')).toBe(true);
    const file = await read(dir, rel);
    expect(file).toContain('> Продукт — это не проект (с. 12)');
    expect(sp.learning.detail(rel)).toMatchObject({ quoteList: ['Лучшие команды влюблены в проблему, а не в решение. (с. 45)', 'Продукт — это не проект (с. 12)'] });

    const skill = await sp.learning.logSession('Resources/Обучение/Навыки/Английский язык.md', { minutes: 30, text: 'разговорный клуб' });
    expect(skill).toMatchObject({ hours: 120.5, minutes7: 105, lastSession: '2026-11-24' });
    await expect(sp.learning.logSession('Resources/Обучение/Навыки/Английский язык.md', { minutes: 0 })).rejects.toThrow(/от 1/);
  });

  it('новая книга создаётся в своей папке с секциями', async () => {
    const { sp, dir } = await setup();
    const n = await sp.learning.createEntity({ type: 'book', title: 'Атомные привычки', fields: { author: 'Джеймс Клир', total: 320, status: 'active' } });
    expect(n.path).toBe('Resources/Обучение/Книги/Атомные привычки.md');
    const file = await read(dir, n.path);
    expect(file).toContain('started: 2026-11-24');
    expect(file).toContain('## Действия');
  });

  it('разбирает цитаты в виде блоков и списков', () => {
    expect(parseQuotes('> Первая\n> строка\n\n- Вторая\n- [ ] задача — не цитата')).toEqual(['Первая строка', 'Вторая']);
  });
});

describe('Практики', () => {
  it('записи практик, состояний, благодарностей и намерения — в ежедневной заметке', async () => {
    const { sp, dir } = await setup();
    await sp.practices.setIntention('2026-11-24', 'Быть внимательным к телу');
    await sp.practices.logPractice({ kind: 'meditation', minutes: 15, time: '07:30', text: 'дыхание' });
    await sp.practices.logPractice({ kind: 'breathing', minutes: 5, time: '13:00' });
    await sp.practices.logState({ state: 'Спокойствие', level: 4, time: '14:20', text: 'после прогулки' });
    await sp.practices.addEntry({ section: 'gratitude', text: 'За солнечное утро' });
    await sp.practices.addEntry({ section: 'observations', text: 'Лучше думается после бега', time: '21:00' });
    await sp.practices.addEntry({ section: 'spreads', text: 'Три карты: Звезда, Отшельник, Солнце' });
    const file = await read(dir, 'Daily/2026-11-24.md');
    expect(file).toContain('## Намерение\nБыть внимательным к телу');
    expect(file).toContain('- 07:30 · Медитация · 15 мин · дыхание');
    expect(file).toContain('- 14:20 · Спокойствие · 4/5 · после прогулки');
    const d = sp.practices.day('2026-11-24');
    expect(d.practices).toEqual([
      { date: '2026-11-24', time: '07:30', kind: 'meditation', label: 'Медитация', minutes: 15, text: 'дыхание' },
      { date: '2026-11-24', time: '13:00', kind: 'breathing', label: 'Дыхание', minutes: 5, text: '' },
    ]);
    expect(d.states[0]).toMatchObject({ state: 'Спокойствие', level: 4, text: 'после прогулки' });
    expect(d.gratitude).toEqual(['За солнечное утро']);
    expect(d.observations[0]).toMatchObject({ time: '21:00', text: 'Лучше думается после бега' });
    expect(d.spreads).toHaveLength(1);

    const o = sp.practices.overview(sp.routines);
    expect(o.stats.streak).toBe(2);
    expect(o.stats.minutes7).toEqual({ meditation: 25, breathing: 5 });
    await expect(sp.practices.logState({ state: 'Радость', level: 9 })).rejects.toThrow(/от 1 до 5/);
    await expect(sp.practices.logPractice({ kind: 'meditation', date: '2026-12-01' })).rejects.toThrow(/будущем/);
  });

  it('фаза луны', () => {
    // 2026-11-24: через несколько дней после новолуния 9 ноября и перед полнолунием 24 ноября.
    const full = moonPhase('2026-11-24');
    expect(full.phase).toBe('full');
    expect(full.illumination).toBeGreaterThan(95);
    const n = moonPhase('2026-12-09');
    expect(['new', 'waning_crescent', 'waxing_crescent']).toContain(n.phase);
    expect(full.nextNew >= '2026-12-07' && full.nextNew <= '2026-12-10').toBe(true);
  });
});

describe('Дом', () => {
  it('техника и гарантии, бытовые дела, ремонт и счета', async () => {
    const { sp } = await setup();
    const o = sp.home.overview();
    const bosch = o.appliances.find((a) => a.brand === 'Bosch')!;
    expect(bosch).toMatchObject({ warrantyState: 'expiring', warrantyDaysLeft: 16, lastService: '2026-06-01', openTasks: 1 });
    expect(o.appliances.find((a) => a.brand === 'LG')!.warrantyState).toBe('expired');
    expect(o.warranties.map((w) => w.title)).toEqual(['Посудомоечная машина Bosch']);
    expect(o.shopping.items.map((t) => t.title)).toEqual(['Лампочки E27 ×4', 'Губки и средство для посуды', 'Батарейки AA']);
    expect(o.chores.map((t) => t.title)).toContain('Купить соль для посудомойки');
    expect(o.projects.map((p) => p.title)).toEqual(['Ремонт балкона']);
    expect(o.bills.map((b) => b.title)).toEqual(['Оплата аренды — декабрь']);
    expect(o.billSubscriptions.map((b) => b.title)).toEqual(['Домашний интернет']);
    expect(o.routines.map((r) => r.title)).toEqual(['Генеральная уборка', 'Заменить фильтр для воды']);
  });

  it('покупка отмечается и записывает расход в финансы', async () => {
    const { sp, life } = await setup();
    const item = await sp.home.addShoppingItem({ text: 'Фильтр для воды' });
    expect(item.path).toBe('Areas/Дом/Покупки.md');
    const r = await sp.home.buy({ path: item.path, line: item.line, raw: item.raw, amount: 890 });
    expect(r.task.status).toBe('done');
    expect(r.transaction).toMatchObject({ amount: 890, category: 'Дом', description: 'Фильтр для воды' });
    expect(life.tasks('done').some((t) => t.title === 'Фильтр для воды')).toBe(true);
  });

  it('бытовое дело и обслуживание техники', async () => {
    const { sp, dir } = await setup();
    const t = await sp.home.addChore({ text: 'Повесить полку', due: '2026-11-26' });
    expect(t.path).toBe('Areas/Дом/Бытовые дела.md');
    expect(sp.home.overview().chores.some((c) => c.title === 'Повесить полку')).toBe(true);
    const rel = 'Areas/Дом/Техника/Стиральная машина LG.md';
    await sp.home.logService(rel, { text: 'Замена ТЭНа', cost: 4500 });
    expect(await read(dir, rel)).toContain('- 2026-11-24 · Замена ТЭНа · 4');
    expect(sp.finance.overview().transactions[0]).toMatchObject({ amount: 4500, category: 'Дом' });
  });

  it('конец гарантии — в календаре', async () => {
    const { life } = await setup();
    const day = life.calendar('2026-12-10', '2026-12-10')[0]!;
    expect(day.items.map((i) => i.title)).toContain('Гарантия заканчивается: Посудомоечная машина Bosch');
  });
});

describe('Главная и «Сегодня»', () => {
  it('сводка для главной', async () => {
    const { sp } = await setup();
    const d = sp.dashboard();
    expect(d.obligations.map((o) => o.title)).toEqual(['Рассрочка за ноутбук', 'Яндекс Плюс', 'Оплата аренды — декабрь']);
    expect(d.obligationsTotal).toBe(52899);
    expect(d.workoutsToday.map((w) => w.title)).toEqual(['2026-11-24 Силовая А']);
    expect(d.routinesDue.map((r) => r.title)).toEqual(['Генеральная уборка', 'Витамин D']);
    expect(d.warranties).toHaveLength(1);
    expect(d.learningActive.map((i) => i.title)).toEqual(['Inspired']);
  });

  it('день: платежи, тренировки, регулярные дела, луна', async () => {
    const { sp } = await setup();
    const today = sp.day('2026-11-24');
    expect(today.routines.map((r) => r.title)).toEqual(['Генеральная уборка', 'Витамин D']);
    expect(today.workouts).toHaveLength(1);
    expect(today.tomorrowObligations.map((o) => o.title)).toEqual(['Рассрочка за ноутбук']);
    const future = sp.day('2026-11-28');
    expect(future.obligations.map((o) => o.title)).toEqual(['Яндекс Плюс']);
    expect(future.routines.map((r) => r.title)).toContain('Утренняя медитация');
    expect(future.routines.map((r) => r.title)).not.toContain('Генеральная уборка');
    expect(sp.day('2026-11-30').routines.map((r) => r.title)).toContain('Генеральная уборка');
  });
});

describe('Чтение и обучение: видео и аудио', () => {
  it('распознаёт ссылки YouTube, Rutube и Vimeo', async () => {
    const { videoEmbed } = await import('../src/learning.ts');
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbed('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(videoEmbed('https://rutube.ru/video/0123456789abcdef0123456789abcdef/')).toBe('https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef');
    expect(videoEmbed('https://example.com/podcast.mp3')).toBeNull();
  });

  it('прикрепляет файл, добавляет ссылку, удаляет в корзину и возвращает', async () => {
    const { Readable } = await import('node:stream');
    const { sp, dir } = await setup();
    const rel = 'Resources/Обучение/Книги/Inspired.md';
    const items = await sp.learning.attachMedia(rel, 'Лекция 1: введение.mp3', Readable.from([Buffer.from('ID3 test audio')]), 'Первая лекция');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'audio', title: 'Первая лекция', file: 'Resources/Вложения/Лекция 1 введение.mp3', missing: false });
    expect(await read(dir, rel)).toContain('## Медиа\n- ![[Лекция 1 введение.mp3|Первая лекция]]');
    expect(await fs.readFile(path.join(dir, 'Resources/Вложения/Лекция 1 введение.mp3'), 'utf8')).toBe('ID3 test audio');
    // Второй файл с тем же именем не затирает первый.
    const again = await sp.learning.attachMedia(rel, 'Лекция 1: введение.mp3', Readable.from([Buffer.from('second')]));
    expect(again.map((m) => m.file)).toContain('Resources/Вложения/Лекция 1 введение 2.mp3');
    await expect(sp.learning.attachMedia(rel, 'virus.exe', Readable.from([Buffer.from('x')]))).rejects.toThrow(/аудио/);
    await expect(sp.learning.attachMedia(rel, 'empty.mp4', Readable.from([Buffer.alloc(0)]))).rejects.toThrow(/пустой/);

    const withLink = await sp.learning.addMediaLink(rel, { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Доклад Кагана' });
    expect(withLink.at(-1)).toMatchObject({ kind: 'embed', title: 'Доклад Кагана', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
    await expect(sp.learning.addMediaLink(rel, { url: 'javascript:alert(1)' })).rejects.toThrow(/http/);

    const first = withLink[0]!;
    const del = await sp.learning.removeMedia(rel, { line: first.line, raw: first.raw });
    expect(del.trashed).toEqual({ from: 'Resources/Вложения/Лекция 1 введение.mp3', to: '.trash/Лекция 1 введение.mp3' });
    await expect(fs.access(path.join(dir, 'Resources/Вложения/Лекция 1 введение.mp3'))).rejects.toThrow();
    expect(await read(dir, rel)).not.toContain('Первая лекция');
    const back = await sp.learning.restoreMedia(rel, del);
    expect(back[0]).toMatchObject({ title: 'Первая лекция', missing: false });
    expect(await fs.readFile(path.join(dir, 'Resources/Вложения/Лекция 1 введение.mp3'), 'utf8')).toBe('ID3 test audio');
  });
});
