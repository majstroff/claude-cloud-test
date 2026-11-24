import { join } from "node:path";
import { TodoistClient, type TodoistClientOptions } from "./client.ts";
import { type CredentialDeps, resolveTodoistToken } from "./credentials.ts";
import { TodoistSyncService } from "./service.ts";
import { JsonFileStore } from "./store.ts";

export * from "./client.ts";
export * from "./credentials.ts";
export * from "./errors.ts";
export * from "./http.ts";
export * from "./model.ts";
export * from "./service.ts";
export * from "./store.ts";
export type * from "./types.ts";

export interface CreateTodoistOptions {
  /** Folder for the offline cache (todoist-cache.json). Keep it outside git. */
  dataDir: string;
  vaultName?: string;
  timeZone?: string;
  autoFlush?: boolean;
  credentials?: CredentialDeps;
  client?: Omit<TodoistClientOptions, "token">;
}

/**
 * Wires token lookup, the API client and the offline store together.
 * Without a token the service still works offline and reports `configured: false`.
 */
export async function createTodoistService(opts: CreateTodoistOptions) {
  const resolved = await resolveTodoistToken(opts.credentials);
  const client = resolved ? new TodoistClient({ ...opts.client, token: resolved.token }) : null;
  const service = new TodoistSyncService({
    client,
    store: new JsonFileStore(join(opts.dataDir, "todoist-cache.json")),
    vaultName: opts.vaultName,
    timeZone: opts.timeZone,
    autoFlush: opts.autoFlush,
  });
  return { service, tokenSource: resolved?.source ?? null };
}
