import fs from 'node:fs/promises';
import path from 'node:path';
import type { FolderConfig } from '@frame-os/vault';

/**
 * Небольшое локальное состояние приложения (не данные пользователя):
 * избранное и переопределения папок. Хранится в dataDir/state.json,
 * вне хранилища Obsidian, и может быть удалено без потери заметок.
 */
export interface AppState {
  version: 1;
  favorites: string[];
  folders: Partial<FolderConfig>;
}

const EMPTY: AppState = { version: 1, favorites: [], folders: {} };

export class StateStore {
  private file: string;
  private state: AppState = structuredClone(EMPTY);
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'state.json');
  }

  async load(): Promise<AppState> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = {
        version: 1,
        favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x: unknown) => typeof x === 'string') : [],
        folders: raw.folders && typeof raw.folders === 'object' ? raw.folders : {},
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Повреждённый файл не должен ломать запуск: сохраняем копию и начинаем с пустого.
        await fs.rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => {});
      }
      this.state = structuredClone(EMPTY);
    }
    return this.state;
  }

  get(): AppState {
    return this.state;
  }

  async update(fn: (s: AppState) => void): Promise<AppState> {
    fn(this.state);
    const snapshot = JSON.stringify(this.state, null, 2);
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    await this.queue;
    return this.state;
  }
}
