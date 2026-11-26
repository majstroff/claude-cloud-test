/**
 * API разделов «Работа», «Контакты» и «Документы».
 * Все записи — Markdown-заметки в Vault; здесь только проверка входных данных.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ENTITY_TYPES, VACANCY_STATUSES, VaultError, type Crm, type EntityType, type Spheres, type VacancyStatus } from '@frame-os/vault';

export function registerCrmRoutes(app: FastifyInstance, crm: Crm, spheres?: Spheres): void {
  // --- Общее для всех сущностей ---
  app.post('/api/entities', async (req) => {
    const b = body(req);
    const type = text(b.type) as EntityType | null;
    const owner = type ? spheres?.ownerOf(type) : null;
    if (type && owner) {
      const n = await owner.createEntity({ type, title: required(text(b.title), 'название'), fields: record(b.fields), text: text(b.text) ?? undefined });
      return { path: n.path, title: n.title };
    }
    if (!type || !ENTITY_TYPES.includes(type)) throw new VaultError('Неизвестный тип записи', 'invalid');
    const n = await crm.createEntity({
      type,
      title: required(text(b.title), 'название'),
      fields: record(b.fields),
      text: text(b.text) ?? undefined,
      createCompany: b.createCompany === true,
    });
    return { path: n.path, title: n.title };
  });

  app.put('/api/entity', async (req) => {
    const b = body(req);
    const rel = required(text(b.path), 'path');
    const owner = spheres?.ownerOf(crm.life.vault.require(rel).type);
    const n = owner ? await owner.updateEntity(rel, record(b.set)) : await crm.updateEntity(rel, record(b.set));
    return { path: n.path };
  });

  app.put('/api/entity/section', async (req) => {
    const b = body(req);
    const section = text(b.section);
    const rel = required(text(b.path), 'path');
    const owner = spheres?.ownerOf(crm.life.vault.require(rel).type);
    if (owner) {
      if (!section || typeof b.content !== 'string') throw new VaultError('Не указана секция или текст', 'invalid');
      return { path: (await owner.saveSection(rel, section, b.content)).path };
    }
    if (section !== 'description' && section !== 'cover_letter' && section !== 'notes' && section !== 'comment') {
      throw new VaultError('Неизвестная секция', 'invalid');
    }
    if (typeof b.content !== 'string') throw new VaultError('Нет текста', 'invalid');
    const n = await crm.saveSection(required(text(b.path), 'path'), section, b.content);
    return { path: n.path };
  });

  // --- Работа ---
  app.get('/api/work', async () => crm.work());

  app.get('/api/vacancy', async (req) => crm.vacancyDetail(required(text(query(req).path), 'path')));

  app.post('/api/vacancy/status', async (req) => {
    const b = body(req);
    const status = text(b.status) as VacancyStatus | null;
    if (!status || !VACANCY_STATUSES.includes(status)) throw new VaultError('Недопустимый статус вакансии', 'invalid');
    const n = await crm.setVacancyStatus(required(text(b.path), 'path'), status, text(b.comment));
    return { path: n.path, status };
  });

  app.post('/api/vacancy/interview', async (req) => {
    const b = body(req);
    const n = await crm.scheduleInterview(required(text(b.path), 'path'), {
      date: required(text(b.date), 'дата'),
      time: text(b.time),
      format: text(b.format),
    });
    return { path: n.path };
  });

  app.post('/api/vacancy/test', async (req) => {
    const b = body(req);
    const task = await crm.addTestAssignment(required(text(b.path), 'path'), { due: required(text(b.due), 'срок'), text: text(b.text) });
    return { task };
  });

  // --- Контакты и компании ---
  app.get('/api/contacts', async () => ({ today: crm.life.today, contacts: crm.contacts(), companies: crm.companies() }));

  app.get('/api/contact', async (req) => crm.contactDetail(required(text(query(req).path), 'path')));

  app.get('/api/company', async (req) => crm.companyDetail(required(text(query(req).path), 'path')));

  app.post('/api/contacts/log', async (req) => {
    const b = body(req);
    return crm.logInteraction({
      path: required(text(b.path), 'path'),
      text: required(text(b.text), 'текст'),
      channel: text(b.channel),
      date: text(b.date),
      nextContact: text(b.nextContact),
      agreement: text(b.agreement),
      agreementDue: text(b.agreementDue),
    });
  });

  // --- Документы ---
  app.get('/api/documents', async () => ({ today: crm.life.today, documents: crm.documents() }));

  app.get('/api/document', async (req) => crm.documentDetail(required(text(query(req).path), 'path')));

  app.post('/api/documents/renewal-task', async (req) => {
    const task = await crm.createRenewalTask(required(text(body(req).path), 'path'));
    return { task };
  });
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

function required(v: string | null, name: string): string {
  if (!v) throw new VaultError(`Не указан параметр ${name}`, 'invalid');
  return v;
}
