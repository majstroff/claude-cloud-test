import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-vault');
const H = { 'x-frame-os': '1', host: '127.0.0.1:4317' };
let app: Awaited<ReturnType<typeof buildApp>> | undefined;

async function make(openExternal: ((url: string) => Promise<void>) | null) {
  const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-oe-vault-'));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-oe-data-'));
  await fs.cp(SAMPLE, vaultDir, { recursive: true });
  app = await buildApp({ vaultPath: vaultDir, dataDir, integrations: { todoist: null }, openExternal });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API: внешние ссылки из окна программы', () => {
  it('открывает только http(s), mailto, tel и obsidian и только с заголовком', async () => {
    const opened: string[] = [];
    const a = await make(async (u) => void opened.push(u));
    const post = (url: unknown, headers: Record<string, string> = H) =>
      a.inject({ method: 'POST', url: '/api/open-external', payload: { url }, headers });
    expect((await post('https://hh.ru/vacancy/1')).statusCode).toBe(200);
    expect((await post('obsidian://open?vault=Vault&file=Inbox')).statusCode).toBe(200);
    expect((await post('mailto:anna@example.com')).statusCode).toBe(200);
    expect((await post('file:///etc/passwd')).statusCode).toBe(400);
    expect((await post('javascript:alert(1)')).statusCode).toBe(400);
    expect((await post('не ссылка')).statusCode).toBe(400);
    expect((await post(42)).statusCode).toBe(400);
    expect((await post('https://example.com', { host: H.host })).statusCode).toBe(403);
    expect(opened).toEqual(['https://hh.ru/vacancy/1', 'obsidian://open?vault=Vault&file=Inbox', 'mailto:anna@example.com']);
  });

  it('без поддержки системы отвечает 501', async () => {
    const a = await make(null);
    const r = await a.inject({ method: 'POST', url: '/api/open-external', payload: { url: 'https://example.com' }, headers: H });
    expect(r.statusCode).toBe(501);
  });
});
