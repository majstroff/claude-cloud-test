import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Film, Link2, Music, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api.ts';
import { Empty, useToast } from './ui.tsx';

export interface MediaItem {
  kind: 'audio' | 'video' | 'embed' | 'link';
  title: string;
  file: string | null;
  url: string | null;
  embed: string | null;
  line: number;
  raw: string;
  missing: boolean;
}

const ACCEPT = '.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.mp4,.m4v,.mov,.webm,audio/*,video/*';
const MAX_BYTES = 4 * 1024 ** 3;

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Загрузка файла потоком с прогрессом (fetch не умеет показывать прогресс отправки). */
function upload(notePath: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/learning/media/upload?path=${encodeURIComponent(notePath)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Frame-OS', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error((JSON.parse(xhr.responseText) as { error?: string }).error ?? `Ошибка ${xhr.status}`));
      } catch {
        reject(new Error(`Ошибка ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Нет связи с сервером'));
    xhr.send(file);
  });
}

/** Плеер, который помнит, где вы остановились (в этой программе на этом компьютере). */
function Player({ item }: { item: MediaItem }) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const key = `media-pos:${item.file}`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const restore = () => {
      try {
        const t = Number(localStorage.getItem(key));
        if (t > 3 && t < el.duration - 3) el.currentTime = t;
      } catch {
        /* хранилище браузера недоступно */
      }
    };
    let last = 0;
    const save = () => {
      if (Math.abs(el.currentTime - last) < 5) return;
      last = el.currentTime;
      try {
        localStorage.setItem(key, String(Math.floor(el.currentTime)));
      } catch {
        /* не страшно */
      }
    };
    const ended = () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* не страшно */
      }
    };
    el.addEventListener('loadedmetadata', restore);
    el.addEventListener('timeupdate', save);
    el.addEventListener('pause', save);
    el.addEventListener('ended', ended);
    return () => {
      el.removeEventListener('loadedmetadata', restore);
      el.removeEventListener('timeupdate', save);
      el.removeEventListener('pause', save);
      el.removeEventListener('ended', ended);
    };
  }, [key]);
  const src = `/api/media?path=${encodeURIComponent(item.file!)}`;
  return item.kind === 'audio' ? (
    <audio ref={(el) => void (ref.current = el)} controls preload="metadata" src={src} style={{ width: '100%' }} aria-label={`Аудио: ${item.title}`} />
  ) : (
    <video ref={(el) => void (ref.current = el)} controls preload="metadata" src={src} style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 420 }} aria-label={`Видео: ${item.title}`} />
  );
}

/** Аудио и видео материала: файлы в хранилище, YouTube/Rutube/Vimeo и другие ссылки. */
export function MediaCard({ path }: { path: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['learning-media', path], queryFn: () => api.get<{ items: MediaItem[] }>(`/api/learning/media?path=${encodeURIComponent(path)}`) });
  const [progress, setProgress] = useState<{ name: string; p: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [link, setLink] = useState({ url: '', title: '' });
  const [confirm, setConfirm] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => void qc.invalidateQueries();
  const send = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) {
        toast(`«${f.name}» больше 4 ГБ — такой файл лучше хранить отдельно и добавить ссылкой`, 'error');
        continue;
      }
      setProgress({ name: f.name, p: 0 });
      try {
        await upload(path, f, (p) => setProgress({ name: f.name, p }));
        toast(`Прикреплено: ${f.name} (${size(f.size)})`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    setProgress(null);
    refresh();
  };
  const addLink = useMutation({
    mutationFn: () => api.post('/api/learning/media/link', { path, ...link }),
    onSuccess: () => {
      setLink({ url: '', title: '' });
      toast('Ссылка добавлена');
      refresh();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (it: MediaItem) => api.post<{ deleted: { path: string; line: number; raw: string; trashed: { from: string; to: string } | null } }>('/api/learning/media/delete', { path, line: it.line, raw: it.raw }),
    onSuccess: ({ deleted }, it) => {
      setConfirm(null);
      refresh();
      toast(
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span>Убрано: «{it.title}»{deleted.trashed ? ' (файл в корзине Obsidian)' : ''}</span>
          <button
            className="btn small"
            onClick={() =>
              void api
                .post('/api/learning/media/restore', deleted)
                .then(() => toast('Возвращено'))
                .catch((e: Error) => toast(e.message, 'error'))
                .finally(refresh)
            }
          >
            Отменить
          </button>
        </span>,
        'info',
        8000,
      );
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  const items = q.data?.items ?? [];
  return (
    <section
      className="card"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
      }}
      style={drag ? { outline: '2px dashed var(--blue)', outlineOffset: -6 } : undefined}
    >
      <div className="card-head">
        <h3 className="card-title">
          <Film size={16} /> Видео и аудио
        </h3>
        <button className="btn small" onClick={() => input.current?.click()} disabled={!!progress}>
          <Upload size={14} /> Прикрепить файл
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          aria-label="Выбрать аудио или видео"
          onChange={(e) => {
            if (e.target.files?.length) void send(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {progress && (
        <div className="small" style={{ marginBottom: 10 }}>
          Загружается «{progress.name}» — {Math.round(progress.p * 100)}%
          <div className="progress blue" style={{ marginTop: 4 }}>
            <div style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
        </div>
      )}
      {items.length === 0 && !q.isLoading ? (
        <Empty title="Пока ничего не прикреплено">
          Перетащите сюда лекцию, урок или подкаст (mp3, m4a, mp4, mov…) или добавьте ссылку на YouTube. Файл копируется в хранилище и виден в Obsidian.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {items.map((it) => {
            const id = `${it.line}:${it.raw}`;
            return (
              <div key={id} className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {it.kind === 'audio' ? <Music size={15} /> : it.kind === 'link' ? <Link2 size={15} /> : <Film size={15} />}
                  <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</strong>
                  {it.url && (
                    <a className="btn small ghost icon" href={it.url} target="_blank" rel="noreferrer noopener" title="Открыть в браузере" aria-label={`Открыть в браузере: ${it.title}`}>
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {confirm === id ? (
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span className="small muted">{it.file ? 'Убрать и удалить файл?' : 'Убрать?'}</span>
                      <button className="btn small danger" disabled={remove.isPending} onClick={() => remove.mutate(it)}>
                        Да, удалить
                      </button>
                      <button className="btn small ghost icon" aria-label="Не удалять" onClick={() => setConfirm(null)}>
                        <X size={14} />
                      </button>
                    </span>
                  ) : (
                    <button className="btn small ghost icon" title="Удалить" aria-label={`Удалить медиа: ${it.title}`} onClick={() => setConfirm(id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {it.missing ? (
                  <div className="small" style={{ color: 'var(--red)' }}>Файл не найден в хранилище — возможно, его переименовали или удалили в Obsidian.</div>
                ) : it.file ? (
                  <Player item={it} />
                ) : it.embed ? (
                  <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                    <iframe
                      src={it.embed}
                      title={it.title}
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                      allowFullScreen
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <form
        className="inline-form"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (link.url.trim()) addLink.mutate();
        }}
      >
        <input className="input grow" placeholder="Ссылка: YouTube, Rutube, Vimeo, подкаст…" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} aria-label="Ссылка на видео или аудио" />
        <input className="input" style={{ width: 200 }} placeholder="Название (необязательно)" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} aria-label="Название ссылки" />
        <button className="btn small" type="submit" disabled={addLink.isPending || !link.url.trim()}>
          <Link2 size={14} /> Добавить ссылку
        </button>
      </form>
      <div className="small muted" style={{ marginTop: 8 }}>Можно перетащить файлы прямо в эту карточку. До 4 ГБ на файл. Плеер запоминает, где вы остановились.</div>
    </section>
  );
}
