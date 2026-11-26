import { NoteLinesCard } from '../components/NoteLines.tsx';
import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Lock, Pencil, Star, WandSparkles } from 'lucide-react';
import { api, ApiError, type Health, type NoteData, type NoteSummary } from '../api.ts';
import { TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, TYPE_LABEL, noteHref, useToast } from '../components/ui.tsx';
import { useFavorite } from './Projects.tsx';
import { DeleteNoteButton } from '../components/DeleteNote.tsx';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Markdown → безопасный HTML, вики-ссылки становятся внутренними ссылками приложения. */
function renderMarkdown(note: NoteData): string {
  const resolved = new Map<string, string | null>();
  for (const l of note.links) resolved.set(l.target.toLowerCase(), l.resolved);
  const withLinks = note.body.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (_m, bang: string, inner: string) => {
    const [targetPart, alias] = inner.split('|');
    const target = (targetPart ?? '').split('#')[0]!.trim();
    const label = escapeHtml((alias ?? targetPart ?? '').trim());
    const path = resolved.get(target.toLowerCase());
    if (bang) return `<span class="chip">${label}</span>`;
    if (!path) return `<a class="wikilink missing" title="Заметка не найдена">${label}</a>`;
    return `<a class="wikilink" data-internal="1" href="${noteHref(path)}">${label}</a>`;
  });
  const html = marked.parse(withLinks, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-internal'] });
}

export function NotePage() {
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const q = useQuery({ queryKey: ['note', path], queryFn: () => api.get<NoteData>(`/api/note?path=${encodeURIComponent(path)}`), enabled: !!path });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/api/health') });
  const [editing, setEditing] = useState(false);
  const nav = useNavigate();
  const fav = useFavorite();
  const html = useMemo(() => (q.data ? renderMarkdown(q.data) : ''), [q.data]);

  if (!path) return <Empty title="Заметка не выбрана" />;
  if (q.isPending) return <div className="card"><Loading rows={8} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const n = q.data;
  const fmEntries = Object.entries(n.frontmatter);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a?.dataset.internal) {
      e.preventDefault();
      nav(a.getAttribute('href')!);
    } else if (a && a.getAttribute('href')?.startsWith('http')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  };

  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className={`type-dot ${n.type}`} />
            <span className="chip">{TYPE_LABEL[n.type] ?? n.type}</span>
            {n.sensitive && (
              <span className="chip amber" title="Свойство sensitive: true — текст не показывается в поиске и не будет передаваться ИИ">
                <Lock size={11} /> Чувствительная
              </span>
            )}
            <span className="small muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.path}</span>
            {n.type === 'project' && (
              <Link className="btn small" to={`/projects/view?path=${encodeURIComponent(n.path)}`}>
                Карточка проекта
              </Link>
            )}
            {!n.sensitive && n.type !== 'document' && n.type !== 'daily' && (
              <Link className="btn small" to={`/assistant?tool=note&path=${encodeURIComponent(n.path)}`}>
                <WandSparkles size={14} /> Помощник
              </Link>
            )}
            <button className="btn small icon" aria-label={n.favorite ? 'Убрать из избранного' : 'В избранное'} onClick={() => fav.mutate({ path: n.path, favorite: !n.favorite })}>
              <Star size={14} fill={n.favorite ? 'currentColor' : 'none'} />
            </button>
            {!editing && <DeleteNoteButton path={n.path} title={n.title} />}
            {!editing && (
              <button className="btn small" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Редактировать
              </button>
            )}
          </div>
          {n.frontmatterError && <div className="error-box" style={{ marginBottom: 12 }}>{n.frontmatterError}. Свойства заметки не прочитаны, исправьте YAML в Obsidian или здесь.</div>}
          {editing ? (
            <Editor note={n} onDone={() => setEditing(false)} />
          ) : (
            <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Пустая заметка</p>' }} />
          )}
        </section>
      </div>
      <div className="stack">
        {!editing && <NoteLinesCard path={path} />}
        {fmEntries.length > 0 && (
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 10 }}>Свойства</h3>
            <dl className="props">
              {fmEntries.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {n.tasks.length > 0 && (
          <section className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Задачи в заметке</h3>
            <TaskList tasks={n.tasks} today={health.data?.today ?? ''} showSource={false} />
          </section>
        )}
        <LinkList title="Обратные ссылки" notes={n.backlinks} empty="На эту заметку никто не ссылается" />
        <LinkList
          title="Ссылки из заметки"
          notes={n.related.filter((r) => r.direction !== 'in')}
          empty="В заметке нет ссылок на другие заметки"
          missing={n.links.filter((l) => !l.resolved && !l.embed).map((l) => l.target)}
        />
      </div>
    </div>
  );
}

function LinkList({ title, notes, empty, missing = [] }: { title: string; notes: NoteSummary[]; empty: string; missing?: string[] }) {
  return (
    <section className="card">
      <h3 className="card-title" style={{ marginBottom: 8 }}>
        {title} · {notes.length}
      </h3>
      {notes.length === 0 && missing.length === 0 ? (
        <div className="small muted">{empty}</div>
      ) : (
        <ul className="list">
          {notes.map((b) => (
            <li key={b.path}>
              <Link to={b.type === 'project' ? `/projects/view?path=${encodeURIComponent(b.path)}` : noteHref(b.path)}>
                <span className={`type-dot ${b.type}`} />
                <span className="li-main">
                  <div className="li-title">{b.title}</div>
                  <div className="li-sub">{b.path}</div>
                </span>
              </Link>
            </li>
          ))}
          {[...new Set(missing)].map((m) => (
            <li key={m}>
              <div className="li">
                <span className="type-dot" />
                <span className="li-main">
                  <div className="li-title muted">{m}</div>
                  <div className="li-sub">заметка ещё не создана</div>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Editor({ note, onDone }: { note: NoteData; onDone: () => void }) {
  const [text, setText] = useState(note.content);
  const [base, setBase] = useState(note.hash);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.put<{ hash: string }>('/api/note', { path: note.path, content: text, baseHash: base }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Заметка сохранена');
      onDone();
    },
  });
  const conflict = m.error instanceof ApiError && m.error.status === 409;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <textarea
        className="textarea"
        style={{ minHeight: 420, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            m.mutate();
          }
        }}
        aria-label="Текст заметки (Markdown)"
      />
      {m.isError && (
        <div className="error-box">
          <div>
            {(m.error as Error).message}
            {conflict && <div className="small">Ваш текст не потерян. Можно скопировать его, загрузить свежую версию и перенести правки.</div>}
          </div>
          {conflict && (
            <button
              className="btn small"
              onClick={async () => {
                const fresh = await api.get<NoteData>(`/api/note?path=${encodeURIComponent(note.path)}`);
                setText(fresh.content);
                setBase(fresh.hash);
                m.reset();
              }}
            >
              Загрузить свежую версию
            </button>
          )}
        </div>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => m.mutate()} disabled={m.isPending || text === note.content}>
          {m.isPending ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button className="btn ghost" onClick={onDone}>
          Отмена
        </button>
        <span className="small muted">Ctrl/⌘+S — сохранить. Файл записывается в Markdown, YAML-свойства сохраняются как есть.</span>
      </div>
    </div>
  );
}
