import type {
  CalendarDay,
  CycleDTO,
  GoalDTO,
  IdeaDTO,
  NoteLink,
  NoteSummary,
  Priority,
  ProjectDTO,
  TaskDTO,
  CalendarItem,
  FolderConfig,
  VacancyDTO,
  ContactDTO,
  CompanyDTO,
  DocumentDTO,
  MaterialDTO,
  HistoryEntry,
  Ref,
} from '@frame-os/vault';

export type { VacancyDTO, ContactDTO, CompanyDTO, DocumentDTO, MaterialDTO, HistoryEntry, Ref };

export type { CalendarDay, CalendarItem, CycleDTO, GoalDTO, IdeaDTO, NoteSummary, Priority, ProjectDTO, TaskDTO, FolderConfig };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Frame-OS': '1' } : { 'X-Frame-OS': '1' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Сервер Frame OS недоступен. Проверьте, что он запущен (npm run dev или npm start).');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Пустой или не-JSON ответ.
  }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `Ошибка ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
};

export const q = (path: string) => encodeURIComponent(path);

export interface Health {
  ok: boolean;
  today: string;
  vault: {
    root: string;
    notes: number;
    tasks: number;
    types: Record<string, number>;
    frontmatterErrors: Array<{ path: string; error: string }>;
    readErrors: Array<{ path: string; error: string }>;
    lastScan: number;
    folders: FolderConfig;
  };
  integrations: Array<{ id: string; name: string; state: string; message: string }>;
}

export interface Dashboard {
  today: string;
  todayTasks: TaskDTO[];
  overdue: TaskDTO[];
  doneToday: TaskDTO[];
  upcomingTasks: TaskDTO[];
  todayEvents: CalendarItem[];
  events: Array<CalendarItem & { date: string }>;
  projects: ProjectDTO[];
  projectsTotal: number;
  cycle: CycleDTO | null;
  backlogCount: number;
  ideasNew: number;
  priorities: string;
  dailyPath: string | null;
  reminders: {
    followUps: ContactDTO[];
    documents: DocumentDTO[];
    interviews: VacancyDTO[];
    vacanciesActive: number;
  };
  spheres: SpheresDashboard;
}

type Related = Array<NoteSummary & { direction: 'out' | 'in' | 'both' }>;

export interface WorkData {
  today: string;
  vacancies: VacancyDTO[];
  byStatus: Record<string, number>;
  active: number;
  responseRate: number | null;
  interviews: VacancyDTO[];
  attention: VacancyDTO[];
  materials: MaterialDTO[];
  companies: CompanyDTO[];
}

export interface VacancyDetail extends VacancyDTO {
  description: string;
  coverLetter: string;
  interviews: string;
  history: HistoryEntry[];
  tasks: TaskDTO[];
  related: Related;
}

export interface ContactDetail extends ContactDTO {
  notes: string;
  history: HistoryEntry[];
  agreements: TaskDTO[];
  tasks: TaskDTO[];
  vacancies: Array<{ path: string; title: string; status: string }>;
  related: Related;
}

export interface CompanyDetail extends CompanyDTO {
  notes: string;
  history: HistoryEntry[];
  tasks: TaskDTO[];
  related: Related;
  documents: DocumentDTO[];
}

export interface DocumentDetail extends DocumentDTO {
  tasks: TaskDTO[];
  related: Related;
}

export interface DayData {
  date: string;
  isToday: boolean;
  note: { path: string; hash: string; mtimeMs: number } | null;
  notePath: string;
  priorities: string;
  review: string;
  notes: string;
  mood: number | null;
  energy: number | null;
  planned: TaskDTO[];
  overdue: TaskDTO[];
  done: TaskDTO[];
  dailyTasks: TaskDTO[];
  events: CalendarItem[];
}

export interface NoteData extends NoteSummary {
  frontmatterError: string | null;
  content: string;
  hash: string;
  body: string;
  links: NoteLink[];
  backlinks: NoteSummary[];
  related: Array<NoteSummary & { direction: 'out' | 'in' | 'both' }>;
  tasks: TaskDTO[];
  favorite: boolean;
}

export interface ProjectDetail extends ProjectDTO {
  frontmatter: Record<string, unknown>;
  tasks: TaskDTO[];
  related: Array<NoteSummary & { direction: 'out' | 'in' | 'both' }>;
  stages: string | null;
  favorite: boolean;
}

export interface Strategy {
  today: string;
  goals: GoalDTO[];
  cycles: CycleDTO[];
  current: CycleDTO | null;
  projectsWithoutGoal: ProjectDTO[];
}

export interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  note: NoteSummary;
}

// ---------- Финансы, здоровье, обучение, практики, дом ----------

import type { Finance, Health as HealthModule, Learning, Practices, Household, Routines, Spheres } from '@frame-os/vault';
export type {
  TransactionDTO,
  ObligationDTO,
  SubscriptionDTO,
  PaymentDTO,
  DebtDTO,
  SavingsDTO,
  WorkoutDTO,
  LearningItemDTO,
  SkillDTO,
  RoutineDTO,
  ApplianceDTO,
  MoonInfo,
} from '@frame-os/vault';

export type FinanceData = ReturnType<Finance['overview']>;
export type FinanceItem = ReturnType<Finance['detail']>;
export type SportData = ReturnType<HealthModule['overview']>;
export type WorkoutDetail = ReturnType<HealthModule['workoutDetail']>;
export type DayHealthData = ReturnType<HealthModule['dayHealth']>;
export type LearningData = ReturnType<Learning['overview']>;
export type LearningDetail = ReturnType<Learning['detail']>;
export type PracticesData = ReturnType<Practices['overview']>;
export type PracticeDay = ReturnType<Practices['day']>;
export type HomeData = ReturnType<Household['overview']>;
export type ApplianceDetail = ReturnType<Household['applianceDetail']>;
export type RoutineDetail = ReturnType<Routines['detail']>;
export type SpheresDashboard = ReturnType<Spheres['dashboard']>;
export type SpheresDay = ReturnType<Spheres['day']>;
