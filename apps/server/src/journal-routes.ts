/**
 * API дневника, итогов, аналитики и помощника.
 * Помощник только читает и предлагает; изменения выполняются отдельными
 * методами API после нажатия человеком (см. AssistantAction).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { VaultError, addDays, isIsoDate, type Assistant, type Journal, type ReviewPeriod } from '@frame-os/vault';

export function registerJournalRoutes(app: FastifyInstance, j: Journal, a: Assistant): void {
  // --- Дневник ---
  app.get('/api/journal', async (req) => {
    const q = query(req);
    const to = date(q.to) ?? j.today;
    const from = date(q.from) ?? addDays(to, -30);
    return { today: j.today, from, to, entries: j.entries(from, to), streak: j.streak(), reviews: j.reviews() };
  });
  app.get('/api/journal/entry', async (req) => j.entry(date(query(req).date) ?? j.today));
  app.put('/api/journal/entry', async (req) => {
    const b = body(req);
    const d = date(b.date);
    if (!d) throw new VaultError('Укажите дату', 'invalid');
    if (typeof b.text !== 'string') throw new VaultError('Нет текста записи', 'invalid');
    return j.saveEntry(d, b.text);
  });

  // --- Итоги и аналитика ---
  app.get('/api/analytics', async (req) => {
    const q = query(req);
    return j.analytics(period(q.period), date(q.date) ?? j.today);
  });
  app.get('/api/reviews', async () => ({ reviews: j.reviews() }));
  app.get('/api/reviews/draft', async (req) => {
    const q = query(req);
    return j.draft(period(q.period), date(q.date) ?? j.today);
  });
  app.post('/api/reviews', async (req) => {
    const b = body(req);
    const answers = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? (b.answers as Record<string, string>) : {};
    return j.saveReview(period(b.period), date(b.date) ?? j.today, answers);
  });

  // --- Помощник ---
  app.get('/api/assistant', async () => a.info());
  app.get('/api/assistant/plan', async (req) => a.planDay(date(query(req).date) ?? a.today));
  app.get('/api/assistant/priorities', async (req) => {
    const n = Number(query(req).limit ?? 7);
    return { items: a.priorities(Number.isFinite(n) ? n : 7) };
  });
  app.get('/api/assistant/overdue', async () => a.overdue());
  app.get('/api/assistant/job', async () => a.jobSearch());
  app.get('/api/assistant/note-tasks', async (req) => a.noteTasks(path(query(req))));
  app.get('/api/assistant/related', async (req) => a.related(path(query(req))));
  app.get('/api/assistant/next-step', async (req) => a.nextStep(path(query(req))));
}

function period(v: unknown): ReviewPeriod {
  if (v === undefined || v === null || v === '') return 'week';
  if (v !== 'week' && v !== 'month') throw new VaultError('Период: week или month', 'invalid');
  return v;
}

function date(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (!isIsoDate(v)) throw new VaultError('Дата должна быть в формате ГГГГ-ММ-ДД', 'invalid');
  return v;
}

function query(req: FastifyRequest): Record<string, unknown> {
  return (req.query ?? {}) as Record<string, unknown>;
}

function body(req: FastifyRequest): Record<string, unknown> {
  const v = req.body;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function path(b: Record<string, unknown>): string {
  const v = typeof b.path === 'string' ? b.path.trim() : '';
  if (!v) throw new VaultError('Не указан параметр path', 'invalid');
  return v;
}
