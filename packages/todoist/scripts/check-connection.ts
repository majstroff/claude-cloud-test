/**
 * Read-only check of the Todoist connection: finds the token, then counts
 * projects and active tasks. Changes nothing in Todoist. Never prints the token.
 *
 *   npm run check:todoist
 */
import { TodoistClient } from "../src/client.ts";
import { resolveTodoistToken } from "../src/credentials.ts";
import { USER_MESSAGES, toTodoistError } from "../src/errors.ts";

try {
  const resolved = await resolveTodoistToken();
  if (!resolved) {
    console.error(USER_MESSAGES.not_configured);
    process.exit(2);
  }
  const client = new TodoistClient({ token: resolved.token });
  const [projects, tasks] = await Promise.all([client.listProjects(), client.listTasks()]);
  const where = { env: "переменной окружения", file: "файла", keychain: "Связки ключей" }[resolved.source];
  console.log(`Todoist подключён (токен из ${where}): проектов ${projects.length}, активных задач ${tasks.length}.`);
} catch (err) {
  const e = toTodoistError(err);
  console.error(`${USER_MESSAGES[e.code]}\n(код: ${e.code}${e.status ? `, HTTP ${e.status}` : ""})`);
  process.exit(1);
}
