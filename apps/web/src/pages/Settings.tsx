import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Star } from 'lucide-react';
import { api, type FolderConfig, type Health, type NoteSummary } from '../api.ts';
import { Empty, ErrorBox, Loading, TYPE_LABEL, noteHref, useTheme, useToast } from '../components/ui.tsx';

const FOLDER_LABELS: Array<[keyof FolderConfig, string]> = [
  ['projects', 'Проекты'],
  ['areas', 'Сферы ответственности'],
  ['resources', 'Ресурсы'],
  ['archive', 'Архив'],
  ['goals', 'Цели'],
  ['cycles', '12-недельные циклы'],
  ['ideas', 'Идеи'],
  ['inbox', 'Входящие'],
  ['daily', 'Ежедневные заметки'],
  ['events', 'Календарь / события'],
  ['work', 'Работа (вакансии и материалы)'],
  ['contacts', 'Контакты'],
  ['companies', 'Компании'],
  ['documents', 'Документы'],
  ['finance', 'Финансы'],
  ['health', 'Спорт и здоровье'],
  ['learning', 'Чтение и обучение'],
  ['practices', 'Практики'],
  ['home', 'Дом'],
];

export function SettingsPage() {
  const h = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ folders: FolderConfig; overrides: Partial<FolderConfig> }>('/api/settings') });
  const [theme, setTheme] = useTheme();
  const [folders, setFolders] = useState<Partial<FolderConfig>>({});
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (s.data) setFolders(s.data.folders);
  }, [s.data]);
  const reindex = useMutation({
    mutationFn: () => api.post('/api/reindex', {}),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Хранилище перечитано');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const save = useMutation({
    mutationFn: () => {
      // Сохраняем только отличия от автоматически найденных папок.
      const overrides: Record<string, string> = {};
      for (const [k] of FOLDER_LABELS) {
        const v = folders[k];
        if (typeof v === 'string' && v.trim() && (v !== s.data?.folders[k] || s.data?.overrides[k])) overrides[k] = v.trim();
      }
      return api.put('/api/settings', { folders: overrides });
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Папки сохранены, хранилище перечитано');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (h.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (h.isError) return <ErrorBox error={h.error} onRetry={() => h.refetch()} />;
  const v = h.data.vault;
  const errors = [...v.frontmatterErrors, ...v.readErrors];

  return (
    <div className="grid cols-2">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Хранилище Obsidian</h2>
            <button className="btn small" onClick={() => reindex.mutate()} disabled={reindex.isPending}>
              <RefreshCw size={14} /> Перечитать
            </button>
          </div>
          <dl className="props">
            <dt>Папка</dt>
            <dd>
              <code>{v.root}</code>
            </dd>
            <dt>Заметок</dt>
            <dd>{v.notes}</dd>
            <dt>Задач</dt>
            <dd>{v.tasks}</dd>
            <dt>По типам</dt>
            <dd>
              {Object.entries(v.types)
                .sort((a, b) => b[1] - a[1])
                .map(([t, c]) => `${TYPE_LABEL[t] ?? t}: ${c}`)
                .join(', ')}
            </dd>
            <dt>Прочитано</dt>
            <dd>{new Date(v.lastScan).toLocaleString('ru-RU')}</dd>
          </dl>
          <p className="small muted">
            Путь к хранилищу задаётся переменной <code>FRAME_VAULT_PATH</code> при запуске. Изменения в Obsidian подхватываются автоматически.
          </p>
          {errors.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <strong className="small">Проблемы при чтении · {errors.length}</strong>
              {errors.map((e) => (
                <div key={e.path} className="error-box small">
                  <Link to={noteHref(e.path)}>{e.path}</Link>: {e.error}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 10 }}>Интеграции</h2>
          <ul className="list">
            {h.data.integrations.map((i) => (
              <li key={i.id}>
                <div className="li">
                  <span className="li-main">
                    <div className="li-title">{i.name}</div>
                    <div className="li-sub">{i.message}</div>
                  </span>
                  <span className={`chip ${i.state === 'ok' ? 'green' : i.state === 'error' ? 'red' : ''}`}>
                    {i.state === 'ok' ? 'Подключено' : i.state === 'not_installed' ? 'Не подключён' : i.state === 'not_configured' ? 'Нужен ключ' : i.state === 'offline' ? 'Офлайн' : 'Ошибка'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 10 }}>Оформление</h2>
          <div className="tabs">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
                {t === 'system' ? 'Как в системе' : t === 'light' ? 'Светлая' : 'Тёмная'}
              </button>
            ))}
          </div>
          <p className="small muted">
            Горячие клавиши: <kbd>⌘K</kbd> или <kbd>/</kbd> — поиск, <kbd>N</kbd> — быстрый ввод, <kbd>Esc</kbd> — закрыть окно.
          </p>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Структура папок</h2>
        <p className="small muted">Найдена автоматически по именам папок и настройкам плагина «Ежедневные заметки». Можно указать свои пути относительно корня хранилища.</p>
        {s.isError ? (
          <ErrorBox error={s.error} />
        ) : (
          <form
            className="stack"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {FOLDER_LABELS.map(([k, label]) => (
              <label key={k} className="field">
                {label}
                <input className="input" value={(folders[k] as string) ?? ''} onChange={(e) => setFolders({ ...folders, [k]: e.target.value })} />
              </label>
            ))}
            <div className="small muted">
              Формат имени ежедневной заметки: <code>{s.data?.folders.dailyFormat}</code>
            </div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={save.isPending}>
                Сохранить
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function FavoritesPage() {
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => api.get<{ favorites: NoteSummary[] }>('/api/favorites') });
  if (q.isPending) return <div className="card"><Loading /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section className="card">
      {q.data.favorites.length === 0 ? (
        <Empty icon={<Star size={18} />} title="Избранного пока нет">
          Отметьте звёздочкой проект или заметку, чтобы быстро возвращаться к ним. Избранное хранится в настройках «Лёгкости», а не в заметках.
        </Empty>
      ) : (
        <ul className="list">
          {q.data.favorites.map((n) => (
            <li key={n.path}>
              <Link to={n.type === 'project' ? `/projects/view?path=${encodeURIComponent(n.path)}` : noteHref(n.path)}>
                <span className={`type-dot ${n.type}`} />
                <span className="li-main">
                  <div className="li-title">{n.title}</div>
                  <div className="li-sub">{n.path}</div>
                </span>
                <span className="chip">{TYPE_LABEL[n.type] ?? n.type}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
