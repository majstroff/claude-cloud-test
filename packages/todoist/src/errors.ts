/**
 * Typed errors for the Todoist integration. Every error has a stable `code`
 * that the UI maps to a human message, and none of them ever carries the token.
 */

export type TodoistErrorCode =
  | "not_configured" // no API token available
  | "unauthorized" // 401/403: token wrong or revoked
  | "not_found" // 404: task/project deleted in Todoist
  | "validation" // 400/422: bad input
  | "rate_limited" // 429 after all retries
  | "server" // 5xx after all retries
  | "network" // DNS, offline, timeout
  | "conflict" // local and remote changed the same task
  | "confirmation_required" // destructive action without explicit confirmation
  | "unexpected";

export class TodoistError extends Error {
  readonly code: TodoistErrorCode;
  readonly status?: number;
  /** Seconds the API asked us to wait, when known. */
  readonly retryAfter?: number;
  /** True if retrying the same request later can succeed. */
  readonly retryable: boolean;

  constructor(
    code: TodoistErrorCode,
    message: string,
    opts: { status?: number; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "TodoistError";
    this.code = code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
    this.retryable = code === "rate_limited" || code === "server" || code === "network";
  }

  /** Safe JSON for API responses and logs. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      retryAfter: this.retryAfter,
      retryable: this.retryable,
    };
  }
}

/** Messages shown to the person in the UI (Russian, as the app's language). */
export const USER_MESSAGES: Record<TodoistErrorCode, string> = {
  not_configured:
    "Todoist не подключён. Добавьте API-токен (переменная TODOIST_API_TOKEN, файл или системное хранилище ключей).",
  unauthorized: "Todoist отклонил токен. Проверьте его в Настройках Todoist → Интеграции → Токен API.",
  not_found: "Задача или проект не найдены в Todoist: возможно, их удалили.",
  validation: "Todoist не принял данные. Проверьте название, срок и проект.",
  rate_limited: "Слишком много запросов к Todoist. Синхронизация повторится автоматически.",
  server: "Todoist временно недоступен. Изменения сохранены и будут отправлены позже.",
  network: "Нет связи с Todoist. Изменения сохранены локально и будут отправлены позже.",
  conflict: "Задача изменилась и в «Лёгкости», и в Todoist. Выберите, какую версию оставить.",
  confirmation_required: "Это действие нужно подтвердить.",
  unexpected: "Неожиданная ошибка Todoist.",
};

export function toTodoistError(err: unknown): TodoistError {
  if (err instanceof TodoistError) return err;
  return new TodoistError("unexpected", err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
