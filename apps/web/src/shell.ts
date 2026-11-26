import { api } from './api.ts';

/**
 * Окно программы «Лёгкость.app» (Chrome в режиме --app) открывает ссылки target=_blank
 * в отдельном пустом окне Chrome. Чтобы так не было, внешние ссылки в этом окне
 * открываются в браузере по умолчанию через сервер. Признак окна программы —
 * параметр ?shell=mac, который ставит launcher.sh; он запоминается до закрытия окна.
 */
const KEY = 'frame-shell';

export function detectShell(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const shell = params.get('shell');
    if (shell) {
      // native — своя программа на WebKit: она сама открывает внешние ссылки в браузере.
      if (shell === 'mac') sessionStorage.setItem(KEY, 'mac');
      params.delete('shell');
      const q = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash);
    }
    return sessionStorage.getItem(KEY) === 'mac';
  } catch {
    return false;
  }
}

function isExternal(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute('href');
  if (!href) return false;
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === 'obsidian:' || url.protocol === 'mailto:' || url.protocol === 'tel:') return true;
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function installShellLinks(): void {
  if (!detectShell()) return;
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button > 1) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!(a instanceof HTMLAnchorElement) || !isExternal(a)) return;
      e.preventDefault();
      const url = new URL(a.getAttribute('href')!, window.location.href).toString();
      api.post('/api/open-external', { url }).catch(() => window.open(url, '_blank', 'noopener'));
    },
    true,
  );
  // Средняя кнопка мыши.
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (a instanceof HTMLAnchorElement && isExternal(a)) {
      e.preventDefault();
      void api.post('/api/open-external', { url: new URL(a.getAttribute('href')!, window.location.href).toString() }).catch(() => undefined);
    }
  }, true);
}
