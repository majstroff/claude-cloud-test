import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault } from '../src/vault.ts';
import { Life } from '../src/life.ts';

export const SAMPLE_VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-vault');
export const TODAY = '2026-11-24';

/** Копирует тестовое хранилище во временную папку, чтобы тесты не меняли оригинал. */
export async function tempVaultCopy(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-os-vault-'));
  await fs.cp(SAMPLE_VAULT, dir, { recursive: true });
  return dir;
}

export async function openSample(today = TODAY): Promise<{ vault: Vault; life: Life; dir: string }> {
  const dir = await tempVaultCopy();
  const vault = await Vault.open({ root: dir, clock: () => today });
  return { vault, life: new Life(vault), dir };
}
