import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

async function main() {
  const host = process.env.FRAME_HOST ?? '127.0.0.1';
  const port = Number(process.env.FRAME_PORT ?? 4317);
  const dataDir = path.resolve(expandHome(process.env.FRAME_DATA_DIR ?? path.join(repoRoot, '.data')));
  let vaultPath = process.env.FRAME_VAULT_PATH ? path.resolve(expandHome(process.env.FRAME_VAULT_PATH)) : null;

  if (!vaultPath) {
    // Без настроенного хранилища работаем на копии тестового vault, чтобы не трогать оригинал в репозитории.
    vaultPath = path.join(dataDir, 'sample-vault');
    const exists = await fs.stat(vaultPath).then(() => true, () => false);
    if (!exists) {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.cp(path.join(repoRoot, 'sample-vault'), vaultPath, { recursive: true });
    }
    console.log(`FRAME_VAULT_PATH не задан — используется тестовое хранилище: ${vaultPath}`);
  }

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.warn('Внимание: сервер открыт не только для этого компьютера. Данные хранилища будут доступны по сети.');
  }

  const app = await buildApp({
    vaultPath,
    dataDir,
    webDist: path.join(repoRoot, 'apps/web/dist'),
    watch: true,
    logger: process.env.FRAME_LOG === '1',
  });
  await app.listen({ host, port });
  const stats = app.vault.stats();
  console.log(`Лёгкость ОС: http://${host === '::1' ? '[::1]' : host}:${port}`);
  console.log(`Хранилище: ${stats.root} — заметок: ${stats.notes}, задач: ${stats.tasks}`);

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(`Не удалось запустить «Лёгкость ОС»: ${(e as Error).message}`);
  process.exit(1);
});
