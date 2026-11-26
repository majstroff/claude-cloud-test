import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FrameProject, FrameTask } from "./model.ts";
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "./types.ts";

export type OutboxOp =
  | { kind: "create"; input: CreateTaskInput }
  | { kind: "update"; input: UpdateTaskInput & { clearDue?: boolean } }
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "move"; input: MoveTaskInput }
  | { kind: "delete" };

export type OutboxEntry = OutboxOp & {
  opId: string;
  taskId: string;
  createdAt: string;
  attempts: number;
};

export interface SyncSnapshot {
  version: 1;
  tasks: Record<string, FrameTask>;
  projects: FrameProject[];
  outbox: OutboxEntry[];
  lastSyncAt: string | null;
  lastError: { code: string; message: string; at: string } | null;
}

export function emptySnapshot(): SyncSnapshot {
  return { version: 1, tasks: {}, projects: [], outbox: [], lastSyncAt: null, lastError: null };
}

/** Where the offline cache and outbox live. It never contains the API token. */
export interface SyncStore {
  load(): Promise<SyncSnapshot>;
  save(s: SyncSnapshot): Promise<void>;
}

export class MemoryStore implements SyncStore {
  snapshot: SyncSnapshot;
  constructor(initial?: SyncSnapshot) {
    this.snapshot = initial ?? emptySnapshot();
  }
  async load() {
    return structuredClone(this.snapshot);
  }
  async save(s: SyncSnapshot) {
    this.snapshot = structuredClone(s);
  }
}

/**
 * Plain, readable JSON file (default: <data dir>/todoist-cache.json).
 * Written atomically (temp file + rename) so a crash never leaves half a file.
 */
export class JsonFileStore implements SyncStore {
  constructor(readonly path: string) {}

  async load(): Promise<SyncSnapshot> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
      throw e;
    }
    const data = JSON.parse(text) as SyncSnapshot;
    if (data?.version !== 1) throw new Error(`Unsupported Todoist cache version in ${this.path}`);
    return { ...emptySnapshot(), ...data };
  }

  async save(s: SyncSnapshot) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
