import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  FolderKanban,
  Home,
  Inbox,
  Lightbulb,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  SunMoon,
  Target,
} from 'lucide-react';
import { api, type Dashboard, type Priority, type SearchResult, type NoteSummary } from '../api.ts';
import { TYPE_LABEL, noteHref, useTheme, useToast, fmtDate } from './ui.tsx';

const NAV = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/today', label: 'Сегодня', icon: CalendarDays },
  { to: '/strategy', label: 'Стратегия', icon: Target },
  { to: '/projects', label: 'Проекты', icon: FolderKanban },
  { to: '/backlog', label: 'Бэклог', icon: Inbox, badge: 'backlog' as const },
  { to: '/ideas', label: 'Идеи', icon: Lightbulb, badge: 'ideas' as const },
];

const TITLES: Record<string, string> = {
  '/': 'Главная',
  '/today': 'Сегодня',
  '/strategy': 'Стратегия',
  '/projects': 'Проекты',
  '/projects/view': 'Проект',
  '/backlog': 'Бэклог',
  '/ideas': 'Идеи',
  '/note': 'Заметка',
  '/favorites': 'Избранное',
  '/settings': 'Настройки',
};

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const loc = useLocation();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard') });
  const live = useLiveUpdates();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'n' || e.key === 'т')) {
        e.preventDefault();
        setQuickOpen(true);
      } else if (!typing && e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = TITLES[loc.pathname] ?? 'Frame OS';
  const badges = { backlog: dash.data?.backlogCount ?? 0, ideas: dash.data?.ideasNew ?? 0 };
  const nextTheme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';

  return (
    <div className="shell">
      <nav className="rail" aria-label="Разделы">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}>
            <n.icon size={18} />
            {n.badge && badges[n.badge] > 0 && <span className="badge">{badges[n.badge]}</span>}
            <span className="tip">{n.label}</span>
          </NavLink>
        ))}
        <div className="sep" />
        <NavLink to="/favorites" aria-label="Избранное">
          <Star size={18} />
          <span className="tip">Избранное</span>
        </NavLink>
        <button aria-label="Быстрый ввод" onClick={() => setQuickOpen(true)}>
          <Plus size={18} />
          <span className="tip">Быстрый ввод (N)</span>
        </button>
        <NavLink to="/settings" aria-label="Настройки">
          <Settings size={18} />
          <span className="tip">Настройки и статус</span>
        </NavLink>
      </nav>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="crumb">
              <span className="dot" /> Frame OS
              <span className={`sync ${live ? '' : 'off'}`} title={live ? 'Изменения из Obsidian подхватываются автоматически' : 'Нет связи с сервером'}>
                <i /> {live ? 'хранилище синхронизировано' : 'нет связи'}
              </span>
            </div>
            <h1 className="page-title">{title}</h1>
          </div>
          <div className="top-right">
            <div className="top-actions">
              <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Поиск">
                <Search size={16} />
                <span>Поиск по заметкам</span>
                <kbd>⌘K</kbd>
              </button>
              <button className="btn primary" onClick={() => setQuickOpen(true)}>
                <Plus size={16} /> Добавить
              </button>
              <button
                className="btn icon"
                onClick={() => setTheme(nextTheme)}
                aria-label="Сменить тему"
                title={theme === 'system' ? 'Тема: как в системе' : theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая'}
              >
                {theme === 'system' ? <SunMoon size={16} /> : theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            </div>
            <Clock />
          </div>
        </header>
        <Outlet />
      </main>

      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {quickOpen && <QuickAdd onClose={() => setQuickOpen(false)} />}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  const greet = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (
    <div className="clock">
      <div className="time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="date">
        {greet} · {fmtDate(iso, true)}
      </div>
    </div>
  );
}

/** Подписка на изменения файлов хранилища: обновляет данные без перезагрузки. */
function useLiveUpdates(): boolean {
  const qc = useQueryClient();
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource('/api/events');
      es.onopen = () => setOk(true);
      es.onmessage = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void qc.invalidateQueries(), 250);
      };
      es.onerror = () => {
        setOk(false);
        es?.close();
        timer = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (timer) clearTimeout(timer);
      if (debounce) clearTimeout(debounce);
    };
  }, [qc]);
  return ok;
}

export function Modal({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 150);
    return () => clearTimeout(t);
  }, [text]);
  const res = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(debounced)}&limit=20`),
    enabled: debounced.length > 0,
  });
  const fav = useQuery({ queryKey: ['favorites'], queryFn: () => api.get<{ favorites: NoteSummary[] }>('/api/favorites'), enabled: !debounced });
  const items: Array<{ path: string; title: string; type: string; snippet: string }> = debounced
    ? (res.data?.results ?? []).map((r) => ({ path: r.path, title: r.note.title, type: r.note.type, snippet: r.snippet }))
    : (fav.data?.favorites ?? []).map((n) => ({ path: n.path, title: n.title, type: n.type, snippet: n.path }));
  const open = (path: string, type: string) => {
    onClose();
    nav(type === 'project' ? `/projects/view?path=${encodeURIComponent(path)}` : noteHref(path));
  };
  return (
    <Modal onClose={onClose} label="Поиск">
      <div className="modal-head">
        <Search size={18} className="muted" />
        <input
          autoFocus
          placeholder="Искать по заметкам, проектам, целям…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter' && items[sel]) {
              open(items[sel]!.path, items[sel]!.type);
            }
          }}
          aria-label="Поисковый запрос"
        />
        <kbd>Esc</kbd>
      </div>
      {!debounced && items.length === 0 && (
        <div className="empty">
          <div className="t">Полнотекстовый поиск по хранилищу Obsidian</div>
          <div className="small">Введите слово или его начало. Избранные заметки появятся здесь.</div>
        </div>
      )}
      {!debounced && items.length > 0 && <div className="small muted" style={{ padding: '10px 18px 0' }}>Избранное</div>}
      {debounced && res.isError && (
        <div style={{ padding: 16 }}>
          <div className="error-box">{(res.error as Error).message}</div>
        </div>
      )}
      {debounced && res.isSuccess && items.length === 0 && (
        <div className="empty">
          <div className="t">Ничего не найдено</div>
          <div className="small">Попробуйте другое слово или начало слова.</div>
        </div>
      )}
      {items.length > 0 && (
        <ul className="results">
          {items.map((it, i) => (
            <li key={it.path} className={i === sel ? 'sel' : ''}>
              <a
                href={noteHref(it.path)}
                onClick={(e) => {
                  e.preventDefault();
                  open(it.path, it.type);
                }}
                onMouseEnter={() => setSel(i)}
              >
                <span className="r-title">
                  <span className={`type-dot ${it.type}`} />
                  {it.title}
                  <span className="chip">{TYPE_LABEL[it.type] ?? it.type}</span>
                </span>
                <span className="r-snip">{it.snippet || it.path}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function QuickAdd({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'task' | 'idea' | 'note'>('task');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [prio, setPrio] = useState<Priority>('none');
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ kind: string; path: string; title: string; due?: string | null }>('/api/quick', {
        kind,
        text,
        due: kind === 'task' && due ? due : null,
        priority: kind === 'task' && prio !== 'none' ? prio : null,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast(
        <span>
          {r.kind === 'task' ? 'Задача' : r.kind === 'idea' ? 'Идея' : 'Заметка'} «{r.title}» сохранена в{' '}
          <Link to={noteHref(r.path)}>{r.path}</Link>
        </span>,
      );
      onClose();
    },
  });
  const hints = {
    task: 'Запишется в сегодняшнюю ежедневную заметку. Можно писать «… завтра», «… 01.12» и «!1» для приоритета.',
    idea: 'Создаст заметку-идею в папке идей. Первая строка — название.',
    note: 'Создаст заметку во «Входящих». Первая строка — название.',
  };
  return (
    <Modal onClose={onClose} label="Быстрый ввод">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) m.mutate();
        }}
      >
        <div className="modal-head">
          <div className="tabs" role="tablist">
            {(['task', 'idea', 'note'] as const).map((k) => (
              <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} role="tab" aria-selected={kind === k}>
                {k === 'task' ? 'Задача' : k === 'idea' ? 'Идея' : 'Заметка'}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <kbd>Esc</kbd>
        </div>
        <div className="modal-body">
          <textarea
            ref={ref}
            autoFocus
            className="textarea"
            style={{ minHeight: kind === 'task' ? 64 : 110 }}
            placeholder={kind === 'task' ? 'Что нужно сделать?' : kind === 'idea' ? 'Идея…' : 'Заметка…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (kind === 'task' && !e.shiftKey))) {
                e.preventDefault();
                if (text.trim()) m.mutate();
              }
            }}
            aria-label="Текст"
          />
          {kind === 'task' && (
            <div className="row">
              <label className="field" style={{ flex: '1 1 160px' }}>
                Срок
                <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label className="field" style={{ flex: '1 1 160px' }}>
                Приоритет
                <select className="select" value={prio} onChange={(e) => setPrio(e.target.value as Priority)}>
                  <option value="none">Без приоритета</option>
                  <option value="high">Высокий</option>
                  <option value="medium">Средний</option>
                  <option value="low">Низкий</option>
                </select>
              </label>
            </div>
          )}
          <div className="small muted">{hints[kind]}</div>
          {m.isError && <div className="error-box">{(m.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="small muted">Enter — сохранить</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={!text.trim() || m.isPending}>
            {m.isPending ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
