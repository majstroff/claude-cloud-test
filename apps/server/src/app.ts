import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  Life,
  Vault,
  VaultError,
  endOfMonth,
  isIsoDate,
  startOfMonth,
  summarize,
  type Clock,
  type FolderConfig,
  type Priority,
  type TaskView,
} from '@frame-os/vault';
import { StateStore } from './state.ts';
import { KNOWN_INTEGRATIONS, registerIntegrations, type IntegrationStatus } from './integrations.ts';

export interface AppOptions {
  vaultPath: string;
  dataDir: string;
  clock?: Clock;
  /** Папка собранного интерфейса (apps/web/dist). Если нет — отдаётся только API. */
  webDist?: string | null;
  watch?: boolean;
  logger?: boolean;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<VaultError['code'], number> = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  forbidden: 403,
  io: 500,
};

const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'none', 'low', 'lowest'];
const TASK_VIEWS: TaskView[] = ['today', 'overdue', 'upcoming', 'backlog', 'done', 'open', 'all'];
const FOLDER_KEYS: Array<keyof FolderConfig> = [
  'projects', 'areas', 'resources', 'archive', 'goals', 'cycles', 'ideas', 'inbox', 'daily', 'events',
];

export async function buildApp(opts: AppOptions): Promise<FastifyInstance & { vault: Vault; life: Life }> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 6 * 1024 * 1024 });
  const state = new StateStore(opts.dataDir);
  const saved = await state.load();
  const vault = await Vault.open({ root: opts.vaultPath, clock: opts.clock, folders: saved.folders });
  const life = new Life(vault);
  if (opts.watch) vault.watch();
  app.addHook('onClose', async () => vault.unwatch());

  // --- Защита локального сервера ---
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]', ''].includes(host)) {
      // Защита от DNS rebinding: отвечаем только на локальные имена.
      return reply.code(403).send({ error: 'Доступ разрешён только с localhost' });
    }
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // Сторонний сайт не может выставить этот заголовок без CORS-разрешения.
      if (req.headers['x-frame-os'] !== '1') {
        return reply.code(403).send({ error: 'Запрос отклонён: нет заголовка X-Frame-OS' });
      }
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof VaultError) return reply.code(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: `Внутренняя ошибка: ${err.message}` });
  });

  const integrations = await registerIntegrations(app, { vault, life, dataDir: opts.dataDir });

  // --- Служебное ---
  app.get('/api/health', async () => {
    const statuses: IntegrationStatus[] = [];
    for (const known of KNOWN_INTEGRATIONS) {
      const impl = integrations.find((i) => i.id === known.id);
      if (impl) {
        try {
          statuses.push(await impl.status());
        } catch (e) {
          statuses.push({ ...known, state: 'error', message: (e as Error).message });
        }
      } else {
        statuses.push({ ...known, state: 'not_installed', message: 'Модуль интеграции ещё не подключён к этой сборке' });
      }
    }
    return { ok: true, today: vault.today(), vault: vault.stats(), integrations: statuses };
  });

  app.post('/api/reindex', async () => {
    await vault.scan();
    return { ok: true, vault: vault.stats() };
  });

  app.get('/api/settings', async () => ({ folders: vault.folders, overrides: state.get().folders }));

  app.put('/api/settings', async (req) => {
    const body = obj(req.body);
    const folders = obj(body.folders);
    const next: Partial<FolderConfig> = {};
    for (const k of FOLDER_KEYS) {
      const v = folders[k];
      if (typeof v === 'string' && v.trim()) (next as Record<string, string>)[k] = v.trim().replace(/^\/+|\/+$/g, '');
    }
    await vault.setFolderOverrides(next);
    await state.update((s) => {
      s.folders = next;
    });
    return { folders: vault.folders, overrides: next };
  });

  // Поток событий об изменениях в хранилище (в том числе сделанных в Obsidian).
  const streams = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const close of streams) close();
  });
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const off = vault.onChange((paths) => reply.raw.write(`data: ${JSON.stringify({ paths })}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    const close = () => {
      off();
      clearInterval(ping);
      streams.delete(close);
      reply.raw.end();
    };
    streams.add(close);
    req.raw.on('close', close);
  });

  // --- Заметки и поиск ---
  app.get('/api/search', async (req) => {
    const q = query(req);
    const text = str(q.q);
    if (!text) return { results: [] };
    const results = vault.searchNotes(text, { limit: clampInt(q.limit, 1, 100, 30), type: str(q.type) ?? undefined });
    return { results };
  });

  app.get('/api/notes', async (req) => {
    const q = query(req);
    const type = str(q.type);
    const folder = str(q.folder);
    const tag = str(q.tag);
    let list = vault.all();
    if (type) list = list.filter((n) => n.type === type);
    if (folder) list = list.filter((n) => n.path.startsWith(folder.replace(/\/+$/, '') + '/'));
    if (tag) list = list.filter((n) => n.tags.includes(tag));
    return {
      notes: list
        .map(summarize)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, clampInt(q.limit, 1, 2000, 500)),
    };
  });

  app.get('/api/note', async (req) => {
    const rel = required(str(query(req).path), 'path');
    vault.safePath(rel);
    const n = vault.require(rel);
    const { content, hash } = await vault.readRaw(rel);
    return {
      ...summarize(n),
      frontmatter: n.frontmatter,
      frontmatterError: n.frontmatterError,
      content,
      hash,
      body: n.body,
      links: n.links,
      backlinks: vault.backlinks(rel).map((p) => summarize(vault.require(p))),
      related: life.related(n),
      tasks: n.tasks.map((t) => life.toDTO(t)),
      favorite: state.get().favorites.includes(rel),
    };
  });

  app.put('/api/note', async (req) => {
    const b = obj(req.body);
    const rel = required(str(b.path), 'path');
    if (typeof b.content !== 'string') throw new HttpError(400, 'Нет содержимого заметки');
    const baseHash = b.baseHash === null ? null : required(str(b.baseHash), 'baseHash');
    const n = await vault.writeNote(rel, b.content, baseHash);
    return { path: n.path, hash: n.hash };
  });

  app.post('/api/notes', async (req) => {
    const b = obj(req.body);
    const title = required(str(b.title), 'title');
    const folder = str(b.folder) ?? vault.folders.inbox;
    const fm = b.frontmatter && typeof b.frontmatter === 'object' && !Array.isArray(b.frontmatter) ? (b.frontmatter as Record<string, unknown>) : {};
    const n = await vault.createNote({ folder, title, frontmatter: fm, body: typeof b.body === 'string' ? b.body : `# ${title}\n` });
    return { path: n.path };
  });

  app.patch('/api/note/properties', async (req) => {
    const b = obj(req.body);
    const rel = required(str(b.path), 'path');
    const set = obj(b.set);
    const unset = Array.isArray(b.unset) ? b.unset.filter((x): x is string => typeof x === 'string') : [];
    const n = await vault.updateProperties(rel, set, unset);
    return { path: n.path, frontmatter: n.frontmatter };
  });

  app.post('/api/note/archive', async (req) => {
    const b = obj(req.body);
    const rel = required(str(b.path), 'path');
    if (b.confirmed !== true) throw new HttpError(400, 'Перемещение в архив требует подтверждения');
    const n = await vault.move(rel, vault.folders.archive);
    await state.update((s) => {
      s.favorites = s.favorites.map((f) => (f === rel ? n.path : f));
    });
    return { path: n.path };
  });

  // --- Избранное ---
  app.get('/api/favorites', async () => ({
    favorites: state
      .get()
      .favorites.map((p) => vault.get(p))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map(summarize),
  }));

  app.post('/api/favorites', async (req) => {
    const b = obj(req.body);
    const rel = required(str(b.path), 'path');
    vault.require(rel);
    const on = b.favorite !== false;
    await state.update((s) => {
      s.favorites = s.favorites.filter((p) => p !== rel);
      if (on) s.favorites.unshift(rel);
    });
    return { path: rel, favorite: on };
  });

  // --- Задачи ---
  app.get('/api/tasks', async (req) => {
    const q = query(req);
    const view = (str(q.view) ?? 'open') as TaskView;
    if (!TASK_VIEWS.includes(view)) throw new HttpError(400, `Неизвестный список задач: ${view}`);
    const date = str(q.date);
    if (date && !isIsoDate(date)) throw new HttpError(400, 'Дата должна быть в формате ГГГГ-ММ-ДД');
    return { view, tasks: life.tasks(view, { date: date ?? undefined, projectPath: str(q.project) ?? undefined, days: clampInt(q.days, 1, 366, 7) }) };
  });

  app.post('/api/tasks', async (req) => {
    const b = obj(req.body);
    const task = await life.createTask({
      text: required(str(b.text), 'text'),
      due: str(b.due),
      priority: priority(b.priority),
      recurrence: str(b.recurrence),
      path: str(b.path),
      section: str(b.section) ?? undefined,
    });
    return { task };
  });

  app.patch('/api/tasks', async (req) => {
    const b = obj(req.body);
    const action = str(b.action);
    if (!['complete', 'reopen', 'setDue', 'setPriority'].includes(action ?? '')) throw new HttpError(400, 'Неизвестное действие');
    if (typeof b.line !== 'number' || typeof b.raw !== 'string') throw new HttpError(400, 'Нужны line и raw задачи');
    const task = await life.updateTask({
      path: required(str(b.path), 'path'),
      line: b.line,
      raw: b.raw,
      action: action as 'complete',
      due: b.due === null ? null : str(b.due),
      priority: priority(b.priority),
    });
    return { task };
  });

  // --- Главная, день, календарь ---
  app.get('/api/dashboard', async () => life.dashboard());

  app.get('/api/day', async (req) => {
    const date = str(query(req).date) ?? vault.today();
    return life.day(date);
  });

  app.put('/api/day/section', async (req) => {
    const b = obj(req.body);
    const date = required(str(b.date), 'date');
    const section = str(b.section);
    if (section !== 'priorities' && section !== 'review' && section !== 'notes') throw new HttpError(400, 'Неизвестная секция дня');
    if (typeof b.content !== 'string') throw new HttpError(400, 'Нет текста');
    if (!isIsoDate(date)) throw new HttpError(400, 'Дата должна быть в формате ГГГГ-ММ-ДД');
    return life.saveDaySection(date, section, b.content);
  });

  app.put('/api/day/metrics', async (req) => {
    const b = obj(req.body);
    const date = required(str(b.date), 'date');
    if (!isIsoDate(date)) throw new HttpError(400, 'Дата должна быть в формате ГГГГ-ММ-ДД');
    const m = (v: unknown) => (v === null ? null : typeof v === 'number' ? v : undefined);
    return life.saveDayMetrics(date, { mood: m(b.mood), energy: m(b.energy) });
  });

  app.get('/api/calendar', async (req) => {
    const q = query(req);
    const today = vault.today();
    const from = str(q.from) ?? startOfMonth(today);
    const to = str(q.to) ?? endOfMonth(today);
    return { from, to, days: life.calendar(from, to) };
  });

  app.post('/api/quick', async (req) => {
    const b = obj(req.body);
    const kind = str(b.kind) ?? 'task';
    if (kind !== 'task' && kind !== 'idea' && kind !== 'note') throw new HttpError(400, 'Неизвестный тип записи');
    return life.quickAdd({ kind, text: required(str(b.text), 'text'), due: str(b.due), priority: priority(b.priority) });
  });

  // --- Проекты, цели, циклы, идеи ---
  app.get('/api/projects', async () => ({ projects: life.projects(), favorites: state.get().favorites }));

  app.get('/api/project', async (req) => {
    const rel = required(str(query(req).path), 'path');
    return { ...life.projectDetail(rel), favorite: state.get().favorites.includes(rel) };
  });

  app.post('/api/projects', async (req) => {
    const b = obj(req.body);
    const n = await life.createProject({
      title: required(str(b.title), 'title'),
      goal: str(b.goal),
      deadline: str(b.deadline),
      area: str(b.area),
      budget: typeof b.budget === 'number' ? b.budget : null,
      description: str(b.description) ?? undefined,
    });
    return { path: n.path };
  });

  app.get('/api/strategy', async () => {
    const cycles = life.cycles();
    return {
      today: vault.today(),
      goals: life.goals(),
      cycles,
      current: cycles.find((c) => c.state === 'current') ?? null,
      projectsWithoutGoal: life.projects().filter((p) => !p.goal && p.status === 'active'),
    };
  });

  app.post('/api/goals', async (req) => {
    const b = obj(req.body);
    const n = await life.createGoal({
      title: required(str(b.title), 'title'),
      horizon: str(b.horizon),
      deadline: str(b.deadline),
      area: str(b.area),
      metric: str(b.metric),
      cycle: str(b.cycle),
      why: str(b.why) ?? undefined,
    });
    return { path: n.path };
  });

  app.post('/api/cycles', async (req) => {
    const b = obj(req.body);
    const n = await life.createCycle({ title: required(str(b.title), 'title'), start: required(str(b.start), 'start'), focus: str(b.focus) });
    return { path: n.path };
  });

  app.get('/api/ideas', async () => ({ ideas: life.ideas() }));

  app.post('/api/ideas', async (req) => {
    const b = obj(req.body);
    const n = await life.createIdea({ title: required(str(b.title), 'title'), text: str(b.text) ?? undefined });
    return { path: n.path };
  });

  app.post('/api/ideas/convert', async (req) => {
    const b = obj(req.body);
    const to = str(b.to);
    if (to !== 'project' && to !== 'task' && to !== 'hypothesis') throw new HttpError(400, 'Можно превратить в project, task или hypothesis');
    return life.convertIdea(required(str(b.path), 'path'), to, { due: str(b.due) });
  });

  app.post('/api/ideas/status', async (req) => {
    const b = obj(req.body);
    const status = str(b.status);
    if (!['new', 'hypothesis', 'rejected', 'parked'].includes(status ?? '')) throw new HttpError(400, 'Недопустимый статус идеи');
    const rel = required(str(b.path), 'path');
    if (vault.require(rel).type !== 'idea') throw new HttpError(400, 'Это не заметка-идея');
    const n = await vault.updateProperties(rel, { status });
    return { path: n.path, status };
  });

  app.all('/api/*', async (req, reply) => reply.code(404).send({ error: `Нет такого метода API: ${req.method} ${req.url.split('?')[0]}` }));

  // --- Интерфейс ---
  if (opts.webDist && fs.existsSync(path.join(opts.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Не найдено' });
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send('<p>Frame OS API работает. Интерфейс не собран: выполните <code>npm run build</code> или запустите <code>npm run dev</code>.</p>'),
    );
  }

  const out = app as unknown as FastifyInstance & { vault: Vault; life: Life };
  out.vault = vault;
  out.life = life;
  return out;
}

// ---------- Разбор входных данных ----------

function query(req: FastifyRequest): Record<string, unknown> {
  return (req.query ?? {}) as Record<string, unknown>;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function required(v: string | null, name: string): string {
  if (!v) throw new HttpError(400, `Не указан параметр ${name}`);
  return v;
}

function priority(v: unknown): Priority | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' && (PRIORITIES as string[]).includes(v)) return v as Priority;
  throw new HttpError(400, 'Недопустимый приоритет');
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
