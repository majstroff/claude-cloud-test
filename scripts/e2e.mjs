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

  await step('Неделя и месяц в Today', async () => {
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

  await step('Strategy показывает цели, цикл и новый проект под целью', async () => {
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

  await step('Backlog: фильтр и перенос задачи на сегодня', async () => {
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

  await step('Изменение файла в Obsidian появляется без перезагрузки', async () => {
    await page.goto(`${base}/backlog`);
    await page.locator('li.task').first().waitFor();
    await fs.appendFile(path.join(vault, 'Inbox', 'Заметки с созвона с Анной.md'), '- [ ] Задача, добавленная в Obsidian\n');
    await expectText('Задача, добавленная в Obsidian', 8000);
  });

  await step('Тёмная тема и мобильная ширина', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Сменить тему' }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== 'dark') throw new Error(`theme=${theme}`);
    await shot('home-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await expectText('Сегодня');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('Горизонтальная прокрутка на мобильной ширине');
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
