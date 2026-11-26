/**
 * API разделов «Знания», «Путешествия» и «Отношения».
 * Все записи — Markdown-заметки в Vault; здесь только проверка входных данных.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { KNOWLEDGE_TYPES, VaultError, type Crm, type KnowledgeType, type Spheres } from '@frame-os/vault';

export function registerPersonalRoutes(app: FastifyInstance, s: Spheres, crm: Crm): void {
  const k = s.knowledge;
  const t = s.travel;
  const r = s.relations;

  // --- Знания ---
  app.get('/api/knowledge', async (req) => {
    const q = query(req);
    return k.overview({ type: knowledgeType(text(q.type)), tag: text(q.tag), para: para(text(q.para)) });
  });
  app.get('/api/knowledge/search', async (req) => {
    const q = query(req);
    const scope = text(q.scope) === 'all' ? 'all' : 'knowledge';
    const type = text(q.type);
    if (scope === 'knowledge') knowledgeType(type);
    return { results: k.search(text(q.q) ?? '', { scope, type, tag: text(q.tag), para: para(text(q.para)) }) };
  });
  app.get('/api/knowledge/item', async (req) => k.detail(path(query(req))));
  app.post('/api/knowledge/link', async (req) => {
    const b = body(req);
    const n = await k.link(required(text(b.from), 'from'), required(text(b.to), 'to'), text(b.comment));
    return { path: n.path };
  });
  app.post('/api/knowledge/create-for-link', async (req) => {
    const b = body(req);
    const n = await k.createForLink(required(text(b.target), 'target'), knowledgeType(text(b.type)) ?? 'note');
    return { path: n.path, title: n.title };
  });

  // --- Путешествия ---
  app.get('/api/travel', async () => t.overview());
  app.get('/api/travel/trip', async (req) => t.tripDetail(path(query(req))));
  app.get('/api/travel/booking', async (req) => t.bookingDetail(path(query(req))));
  app.post('/api/travel/route', async (req) => {
    const b = body(req);
    return { trip: await t.addRoutePoint(path(b), { date: text(b.date), text: required(text(b.text), 'текст') }) };
  });
  app.post('/api/travel/packing', async (req) => {
    const b = body(req);
    return { task: await t.addPackingItem(path(b), required(text(b.text), 'текст')) };
  });
  app.post('/api/travel/packing/template', async (req) => {
    const b = body(req);
    return t.fillPacking(path(b), required(text(b.template), 'список'));
  });
  app.post('/api/travel/expense', async (req) => {
    const b = body(req);
    if (b.amount === undefined || b.amount === null || b.amount === '') throw new VaultError('Укажите сумму', 'invalid');
    return { transaction: await t.addExpense(path(b), { amount: b.amount, description: text(b.description), date: text(b.date) }) };
  });
  app.post('/api/travel/pay', async (req) => {
    const b = body(req);
    return t.payBooking(path(b), { date: text(b.date), amount: b.amount });
  });

  // --- Отношения ---
  app.get('/api/relationships', async () => r.overview());
  app.get('/api/relationships/date', async (req) => r.dateDetail(path(query(req))));
  app.get('/api/relationships/person', async (req) => r.personDetail(path(query(req))));
  app.post('/api/relationships/gift-idea', async (req) => {
    const b = body(req);
    return r.addGiftIdea(path(b), required(text(b.text), 'текст'));
  });
  app.post('/api/relationships/gift', async (req) => {
    const b = body(req);
    return r.giveGift(path(b), { text: required(text(b.text), 'текст'), date: text(b.date), occasion: text(b.occasion), cost: b.cost });
  });
  app.post('/api/relationships/agreement', async (req) => {
    const b = body(req);
    return { task: await r.addAgreement(path(b), { text: required(text(b.text), 'текст'), due: text(b.due) }) };
  });
  /** «Связались»: запись в историю общения и дата последней связи. */
  app.post('/api/relationships/touch', async (req) => {
    const b = body(req);
    const res = await crm.logInteraction({ path: path(b), text: text(b.text) ?? 'Связались', channel: text(b.channel), date: text(b.date) });
    return { ...res, person: r.person(crm.life.vault.require(res.path)) };
  });
}

function knowledgeType(v: string | null): KnowledgeType | null {
  if (!v) return null;
  if (!(KNOWLEDGE_TYPES as readonly string[]).includes(v)) throw new VaultError('Неизвестный вид заметки', 'invalid');
  return v as KnowledgeType;
}

function para(v: string | null): string | null {
  if (!v) return null;
  if (!['projects', 'areas', 'resources', 'archive', 'none'].includes(v)) throw new VaultError('Неизвестная папка PARA', 'invalid');
  return v;
}

function query(req: FastifyRequest): Record<string, unknown> {
  return (req.query ?? {}) as Record<string, unknown>;
}

function body(req: FastifyRequest): Record<string, unknown> {
  const v = req.body;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function path(b: Record<string, unknown>): string {
  return required(text(b.path), 'path');
}

function required(v: string | null, name: string): string {
  if (!v) throw new VaultError(`Не указан параметр ${name}`, 'invalid');
  return v;
}
