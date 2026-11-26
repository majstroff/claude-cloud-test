import type { TodoistProject, TodoistTask } from "./types.ts";

/** A task as Frame OS sees it: a local mirror of a Todoist task plus links into the vault. */
export interface FrameTask {
  /** Local id, stable even before the task reaches Todoist. */
  id: string;
  todoistId: string | null;
  title: string;
  notes: string;
  projectId: string | null;
  sectionId: string | null;
  parentId: string | null;
  labels: string[];
  /** Todoist priority: 4 = p1 (urgent) … 1 = p4 (normal). */
  priority: 1 | 2 | 3 | 4;
  due: FrameDue | null;
  deadline: string | null;
  completed: boolean;
  completedAt: string | null;
  /** Todoist's updated_at at the last successful sync; used to spot remote edits. */
  remoteUpdatedAt: string | null;
  localUpdatedAt: string;
  syncState: SyncState;
  syncError: { code: string; message: string } | null;
  /** The remote version, kept while syncState is "conflict". */
  conflictRemote: FrameTask | null;
  /** Vault-relative path of the linked Obsidian note (e.g. a Backlog or project note). */
  obsidianPath: string | null;
  url: string | null;
}

export interface FrameDue {
  /** YYYY-MM-DD in the task's own day. */
  date: string;
  /** Full datetime when the task has a time. */
  datetime: string | null;
  /** Todoist's human text, e.g. "every monday". */
  string: string | null;
  recurring: boolean;
  timezone: string | null;
}

export type SyncState =
  | "synced" // matches Todoist
  | "pending" // local change waiting in the outbox
  | "conflict" // both sides changed; needs a choice
  | "error" // Todoist refused the change (see syncError)
  | "remote_deleted"; // gone from Todoist; local copy kept, nothing deleted

export function priorityLabel(p: number): "p1" | "p2" | "p3" | "p4" {
  return (["p4", "p3", "p2", "p1"] as const)[Math.min(4, Math.max(1, p)) - 1]!;
}

export function taskUrl(todoistId: string) {
  return `https://app.todoist.com/app/task/${encodeURIComponent(todoistId)}`;
}

export function fromTodoist(t: TodoistTask, base?: Partial<FrameTask>): FrameTask {
  const hasTime = !!t.due && t.due.date.includes("T");
  return {
    id: base?.id ?? `td_${t.id}`,
    todoistId: t.id,
    title: t.content,
    notes: t.description ?? "",
    projectId: t.project_id ?? null,
    sectionId: t.section_id ?? null,
    parentId: t.parent_id ?? null,
    labels: t.labels ?? [],
    priority: clampPriority(t.priority),
    due: t.due
      ? {
          date: t.due.date.slice(0, 10),
          datetime: hasTime ? t.due.date : null,
          string: t.due.string || null,
          recurring: !!t.due.is_recurring,
          timezone: t.due.timezone ?? null,
        }
      : null,
    deadline: t.deadline?.date ?? null,
    completed: !!(t.checked || t.completed_at),
    completedAt: t.completed_at ?? null,
    remoteUpdatedAt: t.updated_at ?? t.added_at ?? null,
    localUpdatedAt: base?.localUpdatedAt ?? new Date().toISOString(),
    syncState: "synced",
    syncError: null,
    conflictRemote: null,
    obsidianPath: base?.obsidianPath ?? null,
    url: taskUrl(t.id),
  };
}

function clampPriority(p: unknown): 1 | 2 | 3 | 4 {
  const n = Number(p);
  return n >= 1 && n <= 4 ? (Math.round(n) as 1 | 2 | 3 | 4) : 1;
}

export interface FrameProject {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  isInbox: boolean;
  isFavorite: boolean;
}

export function projectFromTodoist(p: TodoistProject): FrameProject {
  return {
    id: p.id,
    name: p.name,
    parentId: p.parent_id ?? null,
    color: p.color,
    isInbox: !!p.inbox_project,
    isFavorite: !!p.is_favorite,
  };
}
