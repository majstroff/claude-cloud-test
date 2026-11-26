import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  JsonFileStore,
  MemoryStore,
  TodoistClient,
  TodoistError,
  TodoistSyncService,
  errorResponse,
  handleTodoistApi,
  resolveTodoistToken,
  type FrameTask,
  type SyncResult,
} from '@frame-os/todoist';
import type { Life, Priority, TaskDTO, Vault } from '@frame-os/vault';
import type { Integration, IntegrationStatus } from './integrations.ts';

export interface TodoistIntegrationOptions {
  vault: Vault;
  life: Life;
  dataDir: string;
  /** Ready-made service (tests). Otherwise built from the token found in env/file/keychain. */
  service?: TodoistSyncService | null;
  /** Background sync every N ms; 0 disables it. */
  autoSyncMs?: number;
}

/** Obsidian Tasks priority → Todoist priority (4 = p1, urgent). */
const PRIORITY_TO_TODOIST: Record<Priority, 1 | 2 | 3 | 4> = {
  highest: 4,
  high: 3,
  medium: 2,
  none: 1,
  low: 1,
  lowest: 1,
};

/**
 * Mounts the Todoist module on /api/todoist/* and links it to the vault:
 * a Backlog line sent to Todoist gets an [todoist:: id] mark, and completions
 * on either side are mirrored after every sync.
 */
export async function registerTodoist(app: FastifyInstance, opts: TodoistIntegrationOptions): Promise<Integration> {
  const { vault, life } = opts;
  let tokenSource: string | null = null;
  let svc: TodoistSyncService;
  if (opts.service) {
    svc = opts.service;
  } else if (opts.service === null) {
    svc = new TodoistSyncService({ client: null, store: new MemoryStore() });
  } else {
    const resolved = await resolveTodoistToken().catch((e: TodoistError) => {
      app.log.warn(`Todoist: ${e.message}`);
      return null;
    });
    tokenSource = resolved?.source ?? null;
    svc = new TodoistSyncService({
      client: resolved ? new TodoistClient({ token: resolved.token }) : null,
      store: new JsonFileStore(path.join(opts.dataDir, 'todoist-cache.json')),
      vaultName: path.basename(vault.stats().root),
      onSync: async () => {
        await reconcileVault();
      },
    });
  }

  /** Vault lines marked [todoist:: id] follow the Todoist task's completion, and vice versa. */
  async function reconcileVault(): Promise<{ vaultCompleted: number; todoistCompleted: number }> {
    const marked = vault.allTasks().filter((t) => t.todoistId && !t.recurrence);
    if (!marked.length) return { vaultCompleted: 0, todoistCompleted: 0 };
    const byId = new Map<string, FrameTask>();
    for (const t of await svc.listTasks()) if (t.todoistId) byId.set(t.todoistId, t);
    let vaultCompleted = 0;
    let todoistCompleted = 0;
    for (const line of marked) {
      const remote = byId.get(line.todoistId!);
      if (!remote || remote.due?.recurring) continue;
      const lineOpen = line.status === 'open' || line.status === 'in_progress';
      try {
        if (lineOpen && remote.completed && remote.syncState === 'synced') {
          await life.updateTask({ path: line.path, line: line.line, raw: line.raw, action: 'complete' });
          vaultCompleted++;
        } else if (line.status === 'done' && !remote.completed && remote.syncState === 'synced') {
          await svc.completeTask(remote.id);
          todoistCompleted++;
        }
      } catch (e) {
        app.log.warn(`Todoist: не удалось сверить задачу ${line.path}:${line.line}: ${(e as Error).message}`);
      }
    }
    return { vaultCompleted, todoistCompleted };
  }

  /** Send one Backlog line from a vault note to Todoist and mark the line. */
  app.post('/api/todoist/backlog/send-vault-task', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const rel = typeof b.path === 'string' ? b.path : '';
    if (!rel || typeof b.line !== 'number' || typeof b.raw !== 'string') {
      return send(reply, errorResponse(new TodoistError('validation', 'Нужны path, line и raw задачи')));
    }
    if (!svc.configured) return send(reply, errorResponse(new TodoistError('not_configured', 'Todoist API token not found')));
    const note = vault.require(rel);
    const task = note.tasks.find((t) => t.line === b.line && t.raw === b.raw) ?? note.tasks.find((t) => t.raw === b.raw);
    if (!task) {
      return reply.code(409).send({ error: 'Задача изменилась в Obsidian. Обновите список и повторите.', code: 'conflict' });
    }
    if (task.todoistId) {
      return reply.code(409).send({ error: 'Эта задача уже отправлена в Todoist', code: 'already_sent', todoistId: task.todoistId });
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const dueString = str(b.due_string) ?? (task.recurrence ?? undefined);
    let created: FrameTask;
    try {
      created = await svc.sendBacklogItem(
        { title: task.title, labels: task.tags.length ? task.tags : undefined, priority: PRIORITY_TO_TODOIST[task.priority], obsidianPath: rel },
        { projectId: str(b.projectId), due_string: dueString, due_lang: dueString ? str(b.due_lang) ?? 'ru' : undefined },
      );
    } catch (e) {
      return send(reply, errorResponse(e));
    }
    if (!created.todoistId) {
      // Todoist недоступен: не оставляем задачу висеть в очереди, чтобы не было дублей при повторной отправке.
      const reason = created.syncError ?? (await svc.status()).lastError;
      await svc.deleteTask(created.id, { confirmed: true }).catch(() => undefined);
      const code = (reason?.code ?? 'network') as TodoistError['code'];
      return send(reply, errorResponse(new TodoistError(code, reason?.message ?? 'Todoist недоступен')));
    }
    let updated: TaskDTO;
    try {
      updated = await life.updateTask({ path: task.path, line: task.line, raw: task.raw, action: 'setTodoist', todoistId: created.todoistId });
    } catch (e) {
      // Задача уже в Todoist; сообщаем, что метку в заметку поставить не удалось.
      return reply.code(207).send({ todoist: created, task: null, warning: `Задача создана в Todoist, но заметка не обновлена: ${(e as Error).message}` });
    }
    return reply.code(201).send({ todoist: created, task: updated });
  });

  app.post('/api/todoist/sync', async (_req, reply) => {
    try {
      const result: SyncResult = await svc.sync();
      // Сверка идемпотентна: повтор после onSync ничего не меняет, но возвращает счётчики.
      return reply.send({ ...result, ...(await reconcileVault()) });
    } catch (e) {
      return send(reply, errorResponse(e));
    }
  });

  const forward = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(req.url, 'http://localhost');
    const out = await handleTodoistApi(svc, { method: req.method, path: url.pathname, query: url.searchParams, body: req.body });
    return send(reply, out ?? { status: 404, body: { error: 'Не найдено' } });
  };
  app.route({ method: ['GET', 'POST', 'PATCH', 'DELETE'], url: '/api/todoist/*', handler: forward });

  let stopAuto: (() => void) | null = null;
  if (svc.configured && (opts.autoSyncMs ?? 0) > 0) {
    stopAuto = svc.startAutoSync(opts.autoSyncMs, (e) => app.log.warn(`Todoist: ${e.code}: ${e.message}`), 2_000);
  }
  app.addHook('onClose', async () => stopAuto?.());

  return {
    id: 'todoist',
    async status(): Promise<IntegrationStatus> {
      const base = { id: 'todoist', name: 'Todoist' };
      if (!svc.configured) {
        return {
          ...base,
          state: 'not_configured',
          message: 'Добавьте API-токен: переменная TODOIST_API_TOKEN, файл TODOIST_API_TOKEN_FILE или Связка ключей (сервис frame-os, аккаунт todoist)',
        };
      }
      const s = await svc.status();
      const queue = s.pending ? `, в очереди ${s.pending}` : '';
      const conflicts = s.conflicts ? `, конфликтов ${s.conflicts}` : '';
      if (s.lastError) {
        const offline = ['network', 'server', 'rate_limited'].includes(s.lastError.code);
        return {
          ...base,
          state: offline ? 'offline' : 'error',
          message: `${offline ? 'Нет связи с Todoist' : s.lastError.message}${queue}${conflicts}`,
        };
      }
      const when = s.lastSyncAt ? `синхронизировано ${new Date(s.lastSyncAt).toLocaleString('ru-RU')}` : 'ещё не синхронизировано';
      const src = tokenSource ? ` · ключ: ${tokenSource === 'env' ? 'переменная окружения' : tokenSource === 'file' ? 'файл' : 'Связка ключей'}` : '';
      return { ...base, state: 'ok', message: `Подключено, ${when}${queue}${conflicts}${src}` };
    },
  };
}

function send(reply: FastifyReply, out: { status: number; body: unknown }) {
  if (out.status === 204) return reply.code(204).send();
  const body = out.body as { error?: { message?: string; userMessage?: string; code?: string } } | null;
  // Единый формат ошибок сервера: { error: строка, code }, плюс подробности Todoist.
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    return reply.code(out.status).send({ error: body.error.userMessage ?? body.error.message, code: body.error.code, details: body.error });
  }
  return reply.code(out.status).send(out.body);
}
