import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { useToast } from './ui.tsx';

/**
 * Удаление заметки с подтверждением. Файл переносится в корзину Obsidian
 * (папка `.trash` в хранилище), откуда его можно вернуть.
 * after: куда перейти после удаления (по умолчанию — назад); null — остаться.
 */
export function DeleteNoteButton({ path, title, after, small = true }: { path: string; title?: string; after?: string | null; small?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const m = useMutation({
    mutationFn: () => api.post<{ to: string }>('/api/note/trash', { path, confirmed: true }),
    onSuccess: () => {
      toast('Удалено. Заметка лежит в корзине Obsidian (.trash), её можно вернуть.');
      if (after === undefined) {
        if (window.history.length > 1) nav(-1);
        else nav('/');
      } else if (after !== null) nav(after);
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  if (confirm) {
    return (
      <span className="row" style={{ gap: 6 }}>
        <span className="small muted">Удалить{title ? ` «${title}»` : ''}?</span>
        <button className="btn small primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} disabled={m.isPending} onClick={() => m.mutate()}>
          Да, удалить
        </button>
        <button className="btn small ghost" onClick={() => setConfirm(false)}>
          Отмена
        </button>
      </span>
    );
  }
  return (
    <button className={`btn ${small ? 'small' : ''} ghost`} onClick={() => setConfirm(true)} aria-label={title ? `Удалить: ${title}` : 'Удалить заметку'} title="Удалить (в корзину Obsidian)">
      <Trash2 size={14} /> Удалить
    </button>
  );
}
