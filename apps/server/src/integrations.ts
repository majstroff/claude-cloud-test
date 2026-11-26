import type { FastifyInstance } from 'fastify';
import type { TodoistSyncService } from '@frame-os/todoist';
import type { Life, Vault } from '@frame-os/vault';
import { registerTodoist } from './todoist.ts';

/**
 * Точка подключения внешних интеграций (Todoist и др.).
 *
 * Интеграция регистрирует свои маршруты под /api/<имя>/* и сообщает статус,
 * который интерфейс показывает в настройках и на страницах. Пока модуль не
 * подключён, интерфейс не показывает связанные с ним кнопки.
 */
export interface IntegrationStatus {
  id: string;
  name: string;
  state: 'not_installed' | 'not_configured' | 'ok' | 'error' | 'offline';
  message: string;
}

export interface IntegrationContext {
  vault: Vault;
  life: Life;
  dataDir: string;
  /** Фоновая работа (автосинхронизация); выключена в тестах. */
  background?: boolean;
  /** Подмена сервисов в тестах. null — интеграция без ключа. */
  todoist?: TodoistSyncService | null;
}

export interface Integration {
  id: string;
  status(): Promise<IntegrationStatus>;
}

export async function registerIntegrations(app: FastifyInstance, ctx: IntegrationContext): Promise<Integration[]> {
  const todoist = await registerTodoist(app, {
    vault: ctx.vault,
    life: ctx.life,
    dataDir: ctx.dataDir,
    service: ctx.todoist,
    autoSyncMs: ctx.background ? 5 * 60_000 : 0,
  });
  return [todoist];
}

export const KNOWN_INTEGRATIONS: Array<Pick<IntegrationStatus, 'id' | 'name'>> = [{ id: 'todoist', name: 'Todoist' }];
