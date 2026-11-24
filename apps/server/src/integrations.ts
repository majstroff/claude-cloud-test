import type { FastifyInstance } from 'fastify';
import type { Life, Vault } from '@frame-os/vault';

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
}

export interface Integration {
  id: string;
  status(): Promise<IntegrationStatus>;
}

export async function registerIntegrations(_app: FastifyInstance, _ctx: IntegrationContext): Promise<Integration[]> {
  // Модуль @frame-os/todoist подключается здесь отдельным изменением.
  return [];
}

export const KNOWN_INTEGRATIONS: Array<Pick<IntegrationStatus, 'id' | 'name'>> = [{ id: 'todoist', name: 'Todoist' }];
