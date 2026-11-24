# @frame-os/todoist

Модуль Frame OS для двусторонней синхронизации с Todoist (API v1: `https://api.todoist.com/api/v1`; старые REST v2 и Sync v9 Doist уже отключил).

Todoist отвечает на вопрос «что сделать». Модуль держит локальную копию задач, чтобы Frame OS работал и без сети, и связывает задачи с заметками Obsidian (`obsidianPath` и ссылка `obsidian://` в описании задачи).

## Что умеет

- Задачи: просмотр, создание, изменение, завершение, повторное открытие, перенос в другой проект/раздел, удаление (только с `confirmed: true`).
- Сроки: текстом (`due_string`: «завтра», `every monday`, `каждый понедельник` + `due_lang: "ru"`), датой (`due_date`), датой со временем (`due_datetime`), снятие срока (`clearDue`), дедлайн (`deadline_date`).
- Повторяющиеся задачи: при завершении не помечаются выполненными, а переходят на следующую дату, как в Todoist.
- Проекты, разделы, метки; Quick Add (`quickAdd("Купить молоко завтра #Дом p1")`).
- Представления: `today`, `overdue`, `upcoming`, `backlog` (без даты), `completed`, `all`, плюс фильтр по проекту, метке и поиск. «Сегодня» считается в заданном часовом поясе.
- Backlog → Todoist: `sendBacklogItem(item, { projectId, due_string })`.

## Синхронизация

1. Каждое изменение сразу применяется к локальной копии и попадает в очередь (outbox), затем отправляется в Todoist.
2. Нет сети, Todoist недоступен или лимит запросов: изменения остаются в очереди и уходят при следующей синхронизации в том же порядке.
3. `sync()` сначала забирает изменения из Todoist, потом отправляет очередь.
4. Задача изменена и тут, и в Todoist: статус `conflict`, обе версии сохранены, выбор через `resolveConflict(id, "local" | "remote")`.
5. Задача удалена в Todoist: статус `remote_deleted`, локальная копия и связь с заметкой не удаляются.
6. Todoist отклонил изменение (например, непонятный срок): статус `error` с текстом ошибки, `retryTask(id)` отправит снова.

Кэш лежит в `<dataDir>/todoist-cache.json`: обычный читаемый JSON, права 600, записывается атомарно. Токена в нём нет.

## Ошибки и лимиты

- 429: ждём столько, сколько просит `Retry-After` (до 60 с внутри одного запроса), иначе ошибка `rate_limited` с `retryAfter`, а фоновая синхронизация откладывается.
- 5xx и сетевые ошибки: до 3 повторов с экспоненциальной задержкой.
- Каждая запись отправляется с `X-Request-Id`, одинаковым при повторах, поэтому Todoist не создаст дубль.
- Все ошибки типизированы (`TodoistError.code`) и имеют русское сообщение для интерфейса (`USER_MESSAGES`).

## API-токен

Токен берётся в таком порядке и никогда не попадает в репозиторий, vault, кэш или логи (он вырезается даже из текста ошибок Todoist):

1. Переменная окружения `TODOIST_API_TOKEN` (например, из `.env`, который в `.gitignore`).
2. Файл из `TODOIST_API_TOKEN_FILE` с правами только для владельца (`chmod 600`; файл с более широкими правами отклоняется).
3. Системное хранилище ключей, сервис `frame-os`, аккаунт `todoist`:
   - macOS: `security add-generic-password -s frame-os -a todoist -w` (токен спросят интерактивно)
   - Linux: `secret-tool store --label="Frame OS Todoist" service frame-os account todoist`

   Отключить: `TODOIST_USE_KEYCHAIN=0`.

Токен: Todoist → Настройки → Интеграции → Для разработчиков → Токен API.

Проверить подключение (только чтение, ничего не меняет): `npm run check:todoist`.

## HTTP API

`createNodeHandler(service)` подключается к любому `node:http` серверу, `handleTodoistApi(service, req)` к любому фреймворку. Все маршруты под `/api/todoist`, полный список в начале `src/http.ts`. Удаление без `{ "confirmed": true }` возвращает 428.

```ts
import { createTodoistService, createNodeHandler } from "@frame-os/todoist";

const { service } = await createTodoistService({ dataDir: ".frame-os", vaultName: "Life", timeZone: "Europe/Moscow" });
const todoist = createNodeHandler(service);
service.startAutoSync(5 * 60_000);
// в обработчике сервера: if (await todoist(req, res)) return;
```

## Разработка

```bash
npm install
npm test          # vitest, Todoist полностью замокан (test/fake-todoist.ts), сеть не нужна
npm run typecheck
```
