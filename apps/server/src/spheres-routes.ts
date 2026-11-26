/**
 * API разделов «Финансы», «Спорт и здоровье», «Чтение и обучение», «Практики»,
 * «Дом» и регулярных дел. Все записи — Markdown-заметки в Vault.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SPHERES, TX_KINDS, VaultError, WORKOUT_STATUSES, type Sphere, type Spheres, type TxKind } from '@frame-os/vault';

export function registerSpheresRoutes(app: FastifyInstance, s: Spheres): void {
  // --- Регулярные дела ---
  app.get('/api/routines', async (req) => {
    const sphere = text(query(req).sphere);
    if (sphere && !(SPHERES as readonly string[]).includes(sphere)) throw new VaultError('Неизвестная сфера', 'invalid');
    return { today: s.life.today, routines: s.routines.list((sphere as Sphere) ?? undefined) };
  });
  app.get('/api/routine', async (req) => s.routines.detail(path(query(req))));
  app.post('/api/routines/done', async (req) => {
    const b = body(req);
    return { routine: await s.routines.markDone(path(b), { date: text(b.date), note: text(b.note) }) };
  });

  // --- Финансы ---
  app.get('/api/finance', async (req) => s.finance.overview(text(query(req).month) ?? undefined));
  app.get('/api/finance/item', async (req) => s.finance.detail(path(query(req))));
  app.post('/api/finance/transactions', async (req) => {
    const b = body(req);
    const kind = text(b.kind) as TxKind | null;
    if (!kind || !TX_KINDS.includes(kind)) throw new VaultError('Тип операции: доход, расход или накопления', 'invalid');
    return {
      transaction: await s.finance.addTransaction({
        date: text(b.date),
        kind,
        amount: amount(b.amount),
        category: text(b.category),
        description: text(b.description),
        link: text(b.link),
      }),
    };
  });
  app.put('/api/finance/budget', async (req) => {
    const b = body(req);
    if (!Array.isArray(b.limits)) throw new VaultError('Нет списка лимитов', 'invalid');
    return s.finance.saveBudget({
      income: b.income as number | string | null,
      limits: b.limits.map((l) => record(l)).map((l) => ({ category: String(l.category ?? ''), limit: l.limit as number | string })),
    });
  });
  app.post('/api/finance/pay', async (req) => {
    const b = body(req);
    return s.finance.pay(path(b), { date: text(b.date), amount: (b.amount as number | string | null) ?? null });
  });
  app.post('/api/finance/debt-payment', async (req) => {
    const b = body(req);
    return s.finance.debtPayment(path(b), { amount: amount(b.amount), date: text(b.date) });
  });
  app.post('/api/finance/contribute', async (req) => {
    const b = body(req);
    return s.finance.contribute(path(b), { amount: amount(b.amount), date: text(b.date), withdraw: b.withdraw === true });
  });

  // --- Спорт и здоровье ---
  app.get('/api/sport', async () => s.health.overview(s.routines));
  app.get('/api/sport/workout', async (req) => s.health.workoutDetail(path(query(req))));
  app.post('/api/sport/workout/status', async (req) => {
    const b = body(req);
    const status = text(b.status);
    if (!status || !(WORKOUT_STATUSES as readonly string[]).includes(status)) throw new VaultError('Недопустимый статус тренировки', 'invalid');
    return { workout: await s.health.setWorkoutStatus(path(b), status as 'done', { duration: b.duration, distance: b.distance, effort: b.effort, note: text(b.note) }) };
  });
  app.post('/api/sport/workout/exercise', async (req) => {
    const b = body(req);
    return { workout: await s.health.addExercise(path(b), { name: String(b.name ?? ''), sets: b.sets, reps: b.reps, weight: b.weight }) };
  });
  app.post('/api/sport/workout/repeat', async (req) => {
    const b = body(req);
    return { workout: await s.health.repeatWorkout(path(b), required(text(b.date), 'дата')) };
  });
  app.put('/api/sport/day', async (req) => {
    const { date, ...rest } = body(req);
    return s.health.saveDayHealth(required(text(date), 'дата'), rest);
  });
  app.put('/api/sport/nutrition', async (req) => {
    const b = body(req);
    if (typeof b.content !== 'string') throw new VaultError('Нет текста', 'invalid');
    return s.health.saveNutrition(required(text(b.date), 'дата'), b.content);
  });

  // --- Чтение и обучение ---
  app.get('/api/learning', async () => s.learning.overview());
  app.get('/api/learning/item', async (req) => s.learning.detail(path(query(req))));
  app.post('/api/learning/progress', async (req) => {
    const b = body(req);
    return { item: await s.learning.setProgress(path(b), { progress: b.progress, status: text(b.status) }) };
  });
  app.post('/api/learning/quote', async (req) => {
    const b = body(req);
    return { item: await s.learning.addQuote(path(b), { text: required(text(b.text), 'текст'), page: text(b.page) }) };
  });
  app.post('/api/learning/action', async (req) => {
    const b = body(req);
    return { task: await s.learning.addAction(path(b), { text: required(text(b.text), 'текст'), due: text(b.due) }) };
  });
  app.post('/api/learning/session', async (req) => {
    const b = body(req);
    return { skill: await s.learning.logSession(path(b), { minutes: b.minutes, text: text(b.text), date: text(b.date) }) };
  });

  // --- Практики ---
  app.get('/api/practices', async (req) => {
    const days = Number(text(query(req).days) ?? 30);
    return s.practices.overview(s.routines, Number.isFinite(days) ? days : 30);
  });
  app.post('/api/practices/log', async (req) => {
    const b = body(req);
    return s.practices.logPractice({ date: text(b.date), time: text(b.time), kind: required(text(b.kind), 'вид практики'), minutes: b.minutes, text: text(b.text) });
  });
  app.post('/api/practices/state', async (req) => {
    const b = body(req);
    return s.practices.logState({ date: text(b.date), time: text(b.time), state: required(text(b.state), 'состояние'), level: b.level, text: text(b.text) });
  });
  app.post('/api/practices/entry', async (req) => {
    const b = body(req);
    const section = text(b.section);
    if (section !== 'gratitude' && section !== 'observations' && section !== 'spreads') throw new VaultError('Неизвестный вид записи', 'invalid');
    return s.practices.addEntry({ date: text(b.date), section, text: required(text(b.text), 'текст'), time: text(b.time) });
  });
  app.put('/api/practices/intention', async (req) => {
    const b = body(req);
    if (typeof b.text !== 'string') throw new VaultError('Нет текста', 'invalid');
    return s.practices.setIntention(required(text(b.date), 'дата'), b.text);
  });

  // --- Дом ---
  app.get('/api/home', async () => s.home.overview());
  app.get('/api/home/appliance', async (req) => s.home.applianceDetail(path(query(req))));
  app.post('/api/home/service', async (req) => {
    const b = body(req);
    return { appliance: await s.home.logService(path(b), { text: required(text(b.text), 'текст'), date: text(b.date), cost: b.cost }) };
  });
  app.post('/api/home/shopping', async (req) => {
    const b = body(req);
    return { task: await s.home.addShoppingItem({ text: required(text(b.text), 'текст'), due: text(b.due) }) };
  });
  app.post('/api/home/chores', async (req) => {
    const b = body(req);
    const p = text(b.priority);
    if (p && !['high', 'medium', 'low', 'none'].includes(p)) throw new VaultError('Недопустимый приоритет', 'invalid');
    return { task: await s.home.addChore({ text: required(text(b.text), 'текст'), due: text(b.due), priority: (p as 'high') ?? undefined }) };
  });
  app.post('/api/home/buy', async (req) => {
    const b = body(req);
    if (typeof b.line !== 'number' || typeof b.raw !== 'string') throw new VaultError('Не указана строка покупки', 'invalid');
    return s.home.buy({ path: path(b), line: b.line, raw: b.raw, amount: b.amount, category: text(b.category) });
  });

  // --- «Сегодня» ---
  app.get('/api/spheres/day', async (req) => s.day(text(query(req).date) ?? s.life.today));
}

function query(req: FastifyRequest): Record<string, unknown> {
  return (req.query ?? {}) as Record<string, unknown>;
}

function body(req: FastifyRequest): Record<string, unknown> {
  return record(req.body);
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function path(b: Record<string, unknown>): string {
  return required(text(b.path), 'path');
}

function amount(v: unknown): number | string {
  if (typeof v === 'number' || (typeof v === 'string' && v.trim())) return v;
  throw new VaultError('Укажите сумму', 'invalid');
}

function required(v: string | null, name: string): string {
  if (!v) throw new VaultError(`Не указан параметр ${name}`, 'invalid');
  return v;
}
