/** Ссылки, заголовки и секции Markdown-заметок Obsidian. */

export interface RawLink {
  /** Цель ссылки как написана: «Проекты/Сайт» или «Сайт». */
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+?\.md)(#[^)]*)?\)/g;

export function parseWikiTarget(inner: string): { target: string; heading: string | null; alias: string | null } {
  let rest = inner;
  let alias: string | null = null;
  const pipe = rest.indexOf('|');
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim() || null;
    rest = rest.slice(0, pipe);
  }
  let heading: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    heading = rest.slice(hash + 1).replace(/^\^/, '').trim() || null;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, alias };
}

/** Убирает блоки кода, чтобы не находить ссылки и задачи внутри них. */
export function maskCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

export function extractLinks(text: string): RawLink[] {
  const masked = maskCode(text);
  const links: RawLink[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const parsed = parseWikiTarget(m[2]!);
    if (!parsed.target && !parsed.heading) continue;
    links.push({ ...parsed, embed: m[1] === '!' });
  }
  for (const m of masked.matchAll(MDLINK_RE)) {
    const href = m[3]!;
    if (/^[a-z]+:/i.test(href)) continue;
    let target: string;
    try {
      target = decodeURIComponent(href);
    } catch {
      target = href;
    }
    links.push({
      target,
      heading: m[4] ? m[4].slice(1) : null,
      alias: m[2] || null,
      embed: m[1] === '!',
    });
  }
  return links;
}

/** Ссылки из значений свойств: goal: "[[Цель]]", contacts: ["[[Анна]]"]. */
export function extractFrontmatterLinks(data: Record<string, unknown>): Array<RawLink & { key: string }> {
  const out: Array<RawLink & { key: string }> = [];
  const visit = (key: string, v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(WIKILINK_RE)) {
        const parsed = parseWikiTarget(m[2]!);
        if (parsed.target) out.push({ ...parsed, embed: false, key });
      }
    } else if (Array.isArray(v)) {
      for (const item of v) visit(key, item);
    }
  };
  for (const [k, v] of Object.entries(data)) visit(k, v);
  return out;
}

export function extractTags(text: string): string[] {
  const masked = maskCode(text);
  const tags = new Set<string>();
  for (const m of masked.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu)) tags.add(m[2]!);
  return [...tags];
}

export function firstHeading(body: string): string | null {
  const m = /^#\s+(.+)$/m.exec(maskCode(body));
  return m ? m[1]!.trim() : null;
}

export interface Section {
  heading: string;
  level: number;
  /** Индекс строки заголовка в массиве строк. */
  start: number;
  /** Индекс строки после конца секции (исключительно). */
  end: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function findSections(lines: string[]): Section[] {
  const heads: Array<{ heading: string; level: number; start: number }> = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = HEADING_RE.exec(line);
    if (m) heads.push({ heading: m[2]!, level: m[1]!.length, start: i });
  });
  return heads.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j]!.level <= h.level) {
        end = heads[j]!.start;
        break;
      }
    }
    return { ...h, end };
  });
}

function normHeading(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

export function findSection(lines: string[], heading: string | string[]): Section | null {
  const wanted = (Array.isArray(heading) ? heading : [heading]).map(normHeading);
  return findSections(lines).find((s) => wanted.includes(normHeading(s.heading))) ?? null;
}

/** Содержимое секции без строки заголовка, с обрезанными пустыми краями. */
export function getSectionText(text: string, heading: string | string[]): string | null {
  const lines = text.split('\n');
  const s = findSection(lines, heading);
  if (!s) return null;
  return lines.slice(s.start + 1, s.end).join('\n').trim();
}

/** Заменяет содержимое секции; если секции нет — добавляет её в конец. */
export function setSectionText(text: string, heading: string, content: string, level = 2): string {
  const lines = text.split('\n');
  const s = findSection(lines, heading);
  const contentLines = content.trim() === '' ? [] : content.replace(/\s+$/, '').split('\n');
  if (!s) {
    const base = text.replace(/\s+$/, '');
    const head = `${'#'.repeat(level)} ${heading}`;
    return `${base}${base ? '\n\n' : ''}${head}\n${contentLines.join('\n')}${contentLines.length ? '\n' : ''}`;
  }
  const before = lines.slice(0, s.start + 1);
  const after = lines.slice(s.end);
  const block = [...contentLines];
  if (after.length > 0) block.push('');
  return [...before, ...block, ...after].join('\n');
}

/**
 * Вставляет строку в конец секции (после последней непустой строки).
 * Если секции нет — создаёт её в конце файла.
 */
export function appendToSection(text: string, heading: string, line: string, level = 2): { text: string; lineIndex: number } {
  const lines = text.split('\n');
  const s = findSection(lines, heading);
  if (!s) {
    const out = setSectionText(text, heading, line, level);
    const outLines = out.split('\n');
    const idx = outLines.lastIndexOf(line);
    return { text: out, lineIndex: idx };
  }
  let insertAt = s.end;
  while (insertAt > s.start + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
  lines.splice(insertAt, 0, line);
  return { text: lines.join('\n'), lineIndex: insertAt };
}
