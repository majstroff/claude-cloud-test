#!/usr/bin/env node
/**
 * Сквозная проверка основных сценариев в настоящем браузере.
 *
 *   npm run build && npm run test:e2e
 *
 * Запускает сервер на копии тестового хранилища (оригинал не меняется),
 * открывает интерфейс в Chromium через Playwright и проходит сценарии.
 * Нужен пакет playwright: `npm i -D playwright && npx playwright install chromium`.
 * SCREENSHOTS=<папка> — сохранить скриншоты страниц.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Для e2e нужен Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

try {
  await fs.access(path.join(root, 'apps/web/dist/index.html'));
} catch {
  console.error('Интерфейс не собран. Сначала выполните: npm run build');
  process.exit(2);
}

const port = 4399;
const base = `http://127.0.0.1:${port}`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-e2e-'));
const vault = path.join(tmp, 'vault');
await fs.cp(path.join(root, 'sample-vault'), vault, { recursive: true });
const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : null;
if (shots) await fs.mkdir(shots, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'apps/server/src/main.ts')], {
  env: { ...process.env, FRAME_VAULT_PATH: vault, FRAME_DATA_DIR: path.join(tmp, 'data'), FRAME_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Сервер не запустился:\n${serverLog}`);
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`);
  }
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const expectText = async (text, timeout = 5000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

  console.log('Frame OS e2e');

  await step('Главная показывает данные из vault', async () => {
    await page.goto(base);
    await expectText('Сегодня');
    await expectText('Активные проекты');
    await expectText('Поиск работы');
    await expectText('неделя цикла');
    await expectText('каждую неделю');
    for (const name of ['Главная', 'Сегодня', 'Стратегия', 'Проекты', 'Бэклог', 'Идеи']) {
      await page.getByRole('link', { name, exact: true }).first().waitFor({ state: 'attached' });
    }
    await shot('home');
  });

  await step('Быстрый ввод создаёт задачу на сегодня в ежедневной заметке', async () => {
    await page.keyboard.press('n');
    await page.getByRole('dialog', { name: 'Быстрый ввод' }).waitFor();
    await page.getByLabel('Текст').fill('E2E: проверить Frame OS сегодня');
    await page.keyboard.press('Enter');
    await expectText('сохранена в');
    await page.goto(`${base}/today`);
    await expectText('E2E: проверить Frame OS');
    const today = (await (await fetch(`${base}/api/health`)).json()).today;
    const raw = await fs.readFile(path.join(vault, 'Daily', `${today}.md`), 'utf8');
    if (!raw.includes(`- [ ] E2E: проверить Frame OS 📅 ${today}`)) throw new Error('Задача не записана в Markdown');
    await shot('today');
  });

  await step('Задача отмечается выполненной и пишет ✅ в файл', async () => {
    const item = page.locator('li.task', { hasText: 'E2E: проверить Frame OS' }).first();
    await item.getByRole('button', { name: 'Отметить выполненной' }).click();
    await page.locator('li.task.done', { hasText: 'E2E: проверить Frame OS' }).first().waitFor();
    const today = (await (await fetch(`${base}/api/health`)).json()).today;
    const raw = await fs.readFile(path.join(vault, 'Daily', `${today}.md`), 'utf8');
    if (!raw.includes(`- [x] E2E: проверить Frame OS 📅 ${today} ✅ ${today}`)) throw new Error('В файле нет отметки выполнения');
  });

  await step('Вечерний итог сохраняется в секцию заметки', async () => {
    await page.getByLabel('review').fill('Итог из e2e');
    await page.locator('section', { hasText: 'Вечерний итог' }).getByRole('button', { name: 'Сохранить' }).click();
    await expectText('Сохранено в ежедневную заметку');
    const today = (await (await fetch(`${base}/api/health`)).json()).today;
    const raw = await fs.readFile(path.join(vault, 'Daily', `${today}.md`), 'utf8');
    if (!/## Итог дня\nИтог из e2e/.test(raw)) throw new Error('Итог не записан');
  });

  await step('Неделя и месяц в разделе «Сегодня»', async () => {
    await page.getByRole('tab', { name: 'Неделя' }).click();
    await page.locator('.week .col').first().waitFor();
    await page.getByRole('tab', { name: 'Месяц' }).click();
    await page.locator('.cal .day').first().waitFor();
  });

  await step('Глобальный поиск находит заметку и открывает её', async () => {
    await page.keyboard.press('Control+k');
    await page.getByLabel('Поисковый запрос').fill('собеседован');
    await expectText('Как проходить продуктовые собеседования');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/note\?path=/);
    await expectText('Обратные ссылки');
    await shot('note');
  });

  await step('Проект: создание под цель и добавление задачи в заметку проекта', async () => {
    await page.goto(`${base}/projects`);
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await page.getByLabel('Название').fill('E2E проект');
    await page.getByLabel('Цель').selectOption({ label: 'Пробежать полумарафон' });
    await page.getByRole('button', { name: 'Создать' }).click();
    await page.waitForURL(/projects\/view/);
    await page.getByLabel('Новая задача').fill('Первая задача проекта');
    await page.getByLabel('Новая задача').press('Enter');
    await expectText('Первая задача проекта');
    const raw = await fs.readFile(path.join(vault, 'Projects', 'E2E проект.md'), 'utf8');
    if (!raw.includes('goal: "[[Пробежать полумарафон]]"') || !raw.includes('- [ ] Первая задача проекта')) throw new Error(raw);
    await shot('project');
  });

  await step('«Стратегия» показывает цели, цикл и новый проект под целью', async () => {
    await page.goto(`${base}/strategy`);
    await expectText('Найти работу продакт-менеджером');
    await expectText('E2E проект');
    await shot('strategy');
  });

  await step('Идея превращается в проект', async () => {
    await page.goto(`${base}/ideas`);
    await page.getByLabel('Название идеи').fill('E2E идея');
    await page.getByRole('button', { name: 'Сохранить идею' }).click();
    const card = page.locator('.card', { hasText: 'E2E идея' }).first();
    await card.waitFor();
    await card.getByRole('button', { name: 'В проект' }).click();
    await expectText('Создано:');
    await fs.access(path.join(vault, 'Projects', 'E2E идея.md'));
    await shot('ideas');
  });

  await step('Бэклог: фильтр и перенос задачи на сегодня', async () => {
    await page.goto(`${base}/backlog`);
    await page.getByLabel('Поиск по задачам').fill('утеплитель');
    const item = page.locator('li.task', { hasText: 'Выбрать утеплитель' });
    await item.waitFor();
    await item.hover();
    await item.getByRole('button', { name: 'Изменить срок' }).click();
    await item.getByRole('button', { name: 'Сегодня' }).click();
    await page.locator('li.task', { hasText: 'Выбрать утеплитель' }).waitFor({ state: 'detached' });
    const raw = await fs.readFile(path.join(vault, 'Projects', 'Ремонт балкона.md'), 'utf8');
    if (!/Выбрать утеплитель 📅 \d{4}-\d{2}-\d{2}/.test(raw)) throw new Error('Срок не записан');
    await shot('backlog');
  });

  await step('Работа: вакансия проходит по воронке, собеседование попадает в файл и календарь', async () => {
    await page.goto(`${base}/work`);
    await expectText('Product Manager — Acme');
    await page.getByRole('button', { name: 'Вакансия', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Новая вакансия' });
    await dlg.getByLabel('Название (например, «PM — Acme»)').fill('E2E PM — Зета');
    await dlg.getByLabel('Компания', { exact: true }).fill('Зета');
    await dlg.getByLabel('Ссылка на вакансию').fill('https://zeta.example.com/pm');
    await dlg.getByLabel('Рекрутер').fill('Анна Смирнова');
    await dlg.getByRole('button', { name: 'Создать' }).click();
    await page.waitForURL(/work\/view/);
    await page.getByRole('button', { name: 'Отклик', exact: true }).click();
    await expectText('Интересно → Отклик');
    await page.getByLabel('Дата собеседования').fill('2026-12-10');
    await page.getByLabel('Время').fill('14:30');
    await page.getByRole('button', { name: 'Назначить' }).click();
    await expectText('Отклик → Собеседование');
    const raw = await fs.readFile(path.join(vault, 'Areas/Работа/Вакансии/E2E PM — Зета.md'), 'utf8');
    for (const part of ['status: interview', 'interview: 2026-12-10', 'recruiter: "[[Анна Смирнова]]"', 'company: "[[Зета]]"', '- 2026-12-10 14:30']) {
      if (!raw.includes(part)) throw new Error(`Нет «${part}» в файле:\n${raw}`);
    }
    await fs.access(path.join(vault, 'Resources/Компании/Зета.md'));
    const cal = await (await fetch(`${base}/api/calendar?from=2026-12-10&to=2026-12-10`)).json();
    if (!cal.days[0].items.some((i) => i.title === 'Собеседование: E2E PM — Зета')) throw new Error('Нет в календаре');
    await shot('vacancy');
  });

  await step('Контакты: запись общения с договорённостью и следующим контактом', async () => {
    await page.goto(`${base}/contacts`);
    await expectText('Игорь Петров');
    await page.locator('.contact-card', { hasText: 'Игорь Петров' }).click();
    await page.waitForURL(/contacts\/view/);
    await page.getByLabel('Что обсудили').fill('E2E: обсудили второй этап');
    await page.getByLabel('Договорённость').fill('E2E: отправить смету');
    await page.getByRole('button', { name: 'Записать' }).click();
    await expectText('Записано в историю общения');
    await expectText('E2E: отправить смету');
    const raw = await fs.readFile(path.join(vault, 'Resources/Контакты/Игорь Петров.md'), 'utf8');
    if (!/- \d{4}-\d{2}-\d{2} · звонок: E2E: обсудили второй этап/.test(raw) || !raw.includes('- [ ] E2E: отправить смету')) throw new Error(raw);
    if (raw.includes('next_contact: 2026-11-20')) throw new Error('Прошедший следующий контакт не снят');
    await shot('contact');
    await page.goto(`${base}/contacts?tab=companies`);
    await expectText('Студия Север');
  });

  await step('Документы: номер скрыт в интерфейсе, создаётся конфиденциальная заметка и задача на продление', async () => {
    await page.goto(`${base}/documents`);
    await page.locator('.li-title', { hasText: 'РВП' }).first().waitFor();
    await page.getByRole('button', { name: 'Документ', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Новый документ' });
    await dlg.getByLabel('Название').fill('E2E Загранпаспорт');
    const numberInput = dlg.getByLabel('Номер документа');
    if ((await numberInput.getAttribute('type')) !== 'password') throw new Error('Номер не скрыт при вводе');
    await numberInput.fill('75 1236789');
    await dlg.getByLabel('Действует до').fill('2027-02-01');
    await dlg.getByRole('button', { name: 'Создать' }).click();
    await page.waitForURL(/documents\/view/);
    await expectText('••••6789');
    if (await page.getByText('75 1236789').count()) throw new Error('Номер виден без нажатия «Показать»');
    await page.getByRole('button', { name: 'Показать номер' }).first().click();
    await expectText('75 1236789');
    await page.getByRole('button', { name: 'Создать задачу на продление' }).click();
    await expectText('Задача на продление создана');
    const raw = await fs.readFile(path.join(vault, 'Areas/Документы/E2E Загранпаспорт.md'), 'utf8');
    if (!raw.includes('sensitive: true') || !raw.includes('number: 75 1236789') || !raw.includes('- [ ] Продлить: E2E Загранпаспорт (до 2027-02-01)')) throw new Error(raw);
    const s = await (await fetch(`${base}/api/search?q=${encodeURIComponent('Загранпаспорт')}`)).json();
    if (s.results.some((r) => r.snippet)) throw new Error('Сниппет конфиденциального документа в поиске');
    await shot('document');
  });

  await step('Главная показывает напоминания: контакты, документы, собеседования', async () => {
    await page.goto(base);
    const card = page.locator('section', { hasText: 'Напоминания' });
    await card.getByText('Продлить: РВП').waitFor();
    await card.getByText('Собеседование: Product Manager — Acme').waitFor();
    for (const name of ['Работа', 'Контакты', 'Документы']) {
      await page.getByRole('link', { name, exact: true }).first().waitFor({ state: 'attached' });
    }
  });

  await step('Изменение файла в Obsidian появляется без перезагрузки', async () => {
    await page.goto(`${base}/backlog`);
    await page.locator('li.task').first().waitFor();
    await fs.appendFile(path.join(vault, 'Inbox', 'Заметки с созвона с Анной.md'), '- [ ] Задача, добавленная в Obsidian\n');
    await expectText('Задача, добавленная в Obsidian', 8000);
  });

  const todayDate = async () => (await (await fetch(`${base}/api/health`)).json()).today;
  const readVault = (rel) => fs.readFile(path.join(vault, rel), 'utf8');

  await step('Главная и «Сегодня» показывают платежи, тренировки и регулярные дела', async () => {
    await page.goto(base);
    await expectText('Платежи на 7 дней');
    await expectText('Тренировки сегодня');
    await expectText('Регулярное на сегодня');
    await page.goto(`${base}/today`);
    await expectText('Регулярное, тренировки и платежи');
  });

  await step('Финансы: операция записывается в таблицу месяца', async () => {
    await page.goto(`${base}/finance`);
    await page.getByRole('tab', { name: 'Операции' }).click();
    await page.getByLabel('Сумма', { exact: true }).fill('1234');
    await page.getByLabel('Категория', { exact: true }).fill('Продукты');
    await page.getByLabel('Описание', { exact: true }).fill('E2E покупка');
    await page.getByRole('button', { name: 'Записать' }).click();
    await expectText('E2E покупка');
    const month = (await todayDate()).slice(0, 7);
    const raw = await readVault(`Areas/Финансы/Операции/${month}.md`);
    if (!/\| Продукты \| E2E покупка \|/.test(raw)) throw new Error('Операция не записана');
    await shot('finance');
  });

  await step('Финансы: оплата подписки переносит дату следующего платежа', async () => {
    const before = await readVault('Areas/Финансы/Подписки/Яндекс Плюс.md');
    const next = before.match(/next_payment: (\S+)/)[1];
    await page.goto(`${base}/finance`);
    await page.getByRole('button', { name: 'Оплачено: Яндекс Плюс' }).first().click();
    await expectText('Оплата записана');
    const after = await readVault('Areas/Финансы/Подписки/Яндекс Плюс.md');
    const moved = after.match(/next_payment: (\S+)/)[1];
    if (!(moved > next)) throw new Error(`Дата не перенесена: ${next} → ${moved}`);
  });

  await step('Здоровье: тренировка отмечается выполненной, показатели дня сохраняются', async () => {
    await page.goto(`${base}/health`);
    await page.getByRole('button', { name: /Выполнено: .*Силовая А/ }).first().click();
    await expectText('Тренировка отмечена выполненной');
    const w = await readVault('Areas/Здоровье/Тренировки/2026-11-24 Силовая А.md');
    if (!/status: done/.test(w)) throw new Error('Статус не записан');
    await page.getByLabel('Вода, л').fill('1,5');
    await page.getByRole('button', { name: 'Сохранить показатели' }).click();
    await expectText('Показатели записаны');
    const daily = await readVault(`Daily/${await todayDate()}.md`);
    if (!/water: 1\.5/.test(daily)) throw new Error('Вода не записана в ежедневную заметку');
    await shot('health');
  });

  await step('Регулярное дело отмечается сделанным', async () => {
    await page.getByRole('button', { name: 'Сделано: Витамин D' }).first().click();
    await expectText('сегодня ✓');
    const r = await readVault('Areas/Здоровье/Регулярное/Витамин D.md');
    if (!r.includes(`last_done: ${await todayDate()}`)) throw new Error('last_done не обновлён');
  });

  await step('Обучение: прогресс книги сохраняется', async () => {
    await page.goto(`${base}/learning`);
    await page.getByLabel('Прогресс: Inspired').fill('180');
    await page.getByLabel('Прогресс: Inspired').press('Enter');
    await expectText('180');
    const b = await readVault('Resources/Обучение/Книги/Inspired.md');
    if (!/progress: 180/.test(b)) throw new Error('Прогресс не записан');
    await shot('learning');
  });

  await step('Практики: запись попадает в ежедневную заметку', async () => {
    await page.goto(`${base}/practices`);
    await page.getByLabel('Минут').fill('15');
    await page.getByLabel('Комментарий к практике').fill('E2E дыхание');
    await page.getByRole('button', { name: 'Записать', exact: true }).click();
    await expectText('Практика записана');
    const daily = await readVault(`Daily/${await todayDate()}.md`);
    if (!/## Практики[\s\S]*15 мин[\s\S]*E2E дыхание/.test(daily)) throw new Error('Практика не записана');
    await shot('practices');
  });

  await step('Дом: покупка с ценой отмечается и пишет расход в финансы', async () => {
    await page.goto(`${base}/home`);
    await page.getByLabel('Цена: Лампочки E27 ×4').fill('560');
    await page.getByRole('button', { name: 'Куплено: Лампочки E27 ×4' }).click();
    await expectText('расход записан');
    const list = await readVault('Areas/Дом/Покупки.md');
    if (!list.includes('- [x] Лампочки E27 ×4')) throw new Error('Покупка не отмечена');
    const month = (await todayDate()).slice(0, 7);
    const ledger = await readVault(`Areas/Финансы/Операции/${month}.md`);
    if (!ledger.includes('Лампочки E27')) throw new Error('Расход не записан в операции');
    await shot('house');
  });

  await step('Тёмная тема и мобильная ширина', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Сменить тему' }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== 'dark') throw new Error(`theme=${theme}`);
    await shot('home-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.getByRole('heading', { name: 'Главная' }).waitFor();
    await page.locator('li.task').first().waitFor();
    const overflow = await page.evaluate(() => {
      const w = window.innerWidth;
      if (document.documentElement.scrollWidth <= w + 1) return null;
      return [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > w + 1)
        .slice(-3)
        .map((e) => `${e.tagName.toLowerCase()}.${e.className}: ${(e.textContent ?? '').slice(0, 40)}`)
        .join('; ');
    });
    if (overflow) throw new Error(`Горизонтальная прокрутка на мобильной ширине: ${overflow}`);
    await shot('home-mobile');
  });

  await step('Ошибки показываются понятным сообщением', async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/note?path=${encodeURIComponent('Нет/такой заметки.md')}`);
    await expectText('Заметка не найдена');
  });

  await step('В консоли браузера нет ошибок', async () => {
    const real = consoleErrors.filter((e) => !/404|Not Found/.test(e));
    if (real.length) throw new Error(real.join('\n'));
  });
} catch (e) {
  console.error(e);
  results.push([false, 'запуск']);
} finally {
  await browser?.close();
  server.kill();
  await fs.rm(tmp, { recursive: true, force: true });
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} из ${results.length} сценариев прошли`);
process.exit(failed ? 1 : 0);
