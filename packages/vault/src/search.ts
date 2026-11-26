/**
 * Полнотекстовый поиск по заметкам. Индекс живёт в памяти и полностью
 * пересобирается из Markdown-файлов, поэтому он не является источником данных.
 */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

export function tokenize(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

interface DocEntry {
  title: string;
  text: string;
  length: number;
}

export interface SearchHit {
  path: string;
  score: number;
  snippet: string;
}

export class SearchIndex {
  private postings = new Map<string, Map<string, number>>();
  private docs = new Map<string, DocEntry>();
  private sortedTerms: string[] | null = null;

  get size(): number {
    return this.docs.size;
  }

  upsert(path: string, title: string, body: string): void {
    this.remove(path);
    const counts = new Map<string, number>();
    const add = (t: string, w: number) => counts.set(t, (counts.get(t) ?? 0) + w);
    for (const t of tokenize(title)) add(t, 8);
    for (const t of tokenize(path.replace(/\.md$/, ''))) add(t, 2);
    const bodyTokens = tokenize(body);
    for (const t of bodyTokens) add(t, 1);
    for (const [t, c] of counts) {
      let p = this.postings.get(t);
      if (!p) {
        p = new Map();
        this.postings.set(t, p);
        this.sortedTerms = null;
      }
      p.set(path, c);
    }
    this.docs.set(path, { title, text: body, length: bodyTokens.length + 1 });
  }

  remove(path: string): void {
    if (!this.docs.has(path)) return;
    this.docs.delete(path);
    for (const [t, p] of this.postings) {
      if (p.delete(path) && p.size === 0) {
        this.postings.delete(t);
        this.sortedTerms = null;
      }
    }
  }

  private termsWithPrefix(prefix: string): string[] {
    if (!this.sortedTerms) this.sortedTerms = [...this.postings.keys()].sort();
    const terms = this.sortedTerms;
    let lo = 0;
    let hi = terms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (terms[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < terms.length && terms[i]!.startsWith(prefix); i++) out.push(terms[i]!);
    return out;
  }

  /**
   * Все слова запроса должны встретиться (как префикс слова в заметке).
   * Точное совпадение слова весит больше, чем префиксное.
   */
  search(query: string, opts: { limit?: number; filter?: (path: string) => boolean } = {}): SearchHit[] {
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0) return [];
    const N = Math.max(1, this.docs.size);
    let scores: Map<string, number> | null = null;
    for (const qt of qTokens) {
      const local = new Map<string, number>();
      for (const term of this.termsWithPrefix(qt)) {
        const p = this.postings.get(term)!;
        const idf = Math.log(1 + N / p.size);
        const exact = term === qt ? 1 : 0.6;
        for (const [path, tf] of p) {
          const s = (1 + Math.log(tf)) * idf * exact;
          local.set(path, Math.max(local.get(path) ?? 0, s));
        }
      }
      if (scores === null) {
        scores = local;
      } else {
        const next = new Map<string, number>();
        for (const [path, s] of scores) {
          const add = local.get(path);
          if (add !== undefined) next.set(path, s + add);
        }
        scores = next;
      }
      if (scores.size === 0) return [];
    }
    const hits: SearchHit[] = [];
    for (const [path, score] of scores ?? []) {
      if (opts.filter && !opts.filter(path)) continue;
      const doc = this.docs.get(path)!;
      const phraseBonus = normalize(doc.title).includes(normalize(query.trim())) ? 5 : 0;
      hits.push({ path, score: score + phraseBonus, snippet: makeSnippet(doc.text, qTokens) });
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, opts.limit ?? 30);
  }
}

export function makeSnippet(text: string, qTokens: string[], radius = 70): string {
  const flat = text.replace(/^---[\s\S]*?---/, '').replace(/\s+/g, ' ').trim();
  const norm = normalize(flat);
  let pos = -1;
  for (const t of qTokens) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}`, 'u');
    const m = re.exec(norm);
    if (m) {
      const p = m.index + m[1]!.length;
      if (pos === -1 || p < pos) pos = p;
    }
  }
  if (pos === -1) return flat.slice(0, radius * 2);
  const start = Math.max(0, pos - radius);
  const end = Math.min(flat.length, pos + radius);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
