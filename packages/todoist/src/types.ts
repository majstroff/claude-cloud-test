/**
 * Shapes of the Todoist API v1 (https://api.todoist.com/api/v1).
 * REST v2 and Sync v9 were shut down by Doist, so only v1 is supported.
 * Only the fields Frame OS uses are typed; unknown fields are kept as-is.
 */

export interface TodoistDue {
  /** YYYY-MM-DD, or a full datetime (YYYY-MM-DDTHH:mm:ss[Z]) for timed tasks. */
  date: string;
  /** Human text, e.g. "every monday" or "tomorrow 10am". */
  string: string;
  lang?: string;
  is_recurring: boolean;
  timezone?: string | null;
}

export interface TodoistDeadline {
  date: string;
  lang?: string;
}

export interface TodoistDuration {
  amount: number;
  unit: "minute" | "day";
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  labels: string[] | null;
  /** 1 (normal) … 4 (urgent). Note: shown as p1 in the Todoist UI when 4. */
  priority: number;
  due: TodoistDue | null;
  deadline: TodoistDeadline | null;
  duration: TodoistDuration | null;
  checked?: boolean;
  completed_at: string | null;
  added_at?: string;
  updated_at: string | null;
  child_order?: number;
  [extra: string]: unknown;
}

export interface TodoistProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  parent_id: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  inbox_project?: boolean;
  child_order?: number;
  [extra: string]: unknown;
}

export interface TodoistSection {
  id: string;
  project_id: string;
  name: string;
  section_order?: number;
  [extra: string]: unknown;
}

export interface TodoistLabel {
  id: string;
  name: string;
  color: string;
  is_favorite: boolean;
  [extra: string]: unknown;
}

export interface Page<T> {
  results: T[];
  next_cursor: string | null;
}

/** Due date may be given in exactly one way. */
export interface DueInput {
  /** Natural language, including recurrence: "every 2 weeks", "каждый понедельник". */
  due_string?: string;
  /** Language of due_string, e.g. "ru" or "en". */
  due_lang?: string;
  /** All-day date YYYY-MM-DD. */
  due_date?: string;
  /** RFC 3339 datetime, e.g. 2026-11-25T09:00:00Z. */
  due_datetime?: string;
}

export interface CreateTaskInput extends DueInput {
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  deadline_date?: string;
  duration?: number;
  duration_unit?: "minute" | "day";
}

export interface UpdateTaskInput extends DueInput {
  content?: string;
  description?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  deadline_date?: string | null;
  duration?: number;
  duration_unit?: "minute" | "day";
}

export interface MoveTaskInput {
  project_id?: string;
  section_id?: string;
  parent_id?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  parent_id?: string;
  color?: string;
  is_favorite?: boolean;
}
