import YAML from 'yaml';

export type Frontmatter = Record<string, unknown>;

export interface SplitResult {
  /** Сырой YAML между разделителями (без них) или null, если блока нет. */
  yaml: string | null;
  /** Текст заметки после блока frontmatter. */
  body: string;
  /** Номер строки (с 0), с которой начинается body в исходном файле. */
  bodyLine: number;
}

const OPEN = /^---\r?\n/;

export function splitFrontmatter(content: string): SplitResult {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  if (!OPEN.test(text)) return { yaml: null, body: text, bodyLine: 0 };
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.replace(/\r$/, '');
    if (l === '---' || l === '...') {
      return {
        yaml: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
        bodyLine: i + 1,
      };
    }
  }
  // Незакрытый блок: Obsidian тоже не считает его свойствами.
  return { yaml: null, body: text, bodyLine: 0 };
}

export interface ParsedFrontmatter {
  data: Frontmatter;
  error: string | null;
}

export function parseFrontmatter(yaml: string | null): ParsedFrontmatter {
  if (yaml === null || yaml.trim() === '') return { data: {}, error: null };
  try {
    const value = YAML.parse(yaml, { prettyErrors: true });
    if (value === null || value === undefined) return { data: {}, error: null };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { data: {}, error: 'Свойства заметки должны быть словарём ключ: значение' };
    }
    return { data: value as Frontmatter, error: null };
  } catch (e) {
    return { data: {}, error: `Ошибка YAML: ${(e as Error).message.split('\n')[0]}` };
  }
}

/**
 * Меняет поля frontmatter, сохраняя порядок, комментарии и остальное
 * содержимое файла. `undefined` в set удаляет ключ.
 */
export function updateFrontmatter(content: string, set: Frontmatter, unset: string[] = []): string {
  const { yaml, body } = splitFrontmatter(content);
  const doc = YAML.parseDocument(yaml ?? '');
  if (doc.errors.length > 0) {
    throw new FrontmatterError(`Нельзя изменить свойства: ошибка YAML (${doc.errors[0]!.message.split('\n')[0]})`);
  }
  if (doc.contents === null || doc.contents === undefined) {
    (doc as { contents: unknown }).contents = doc.createNode({});
  }
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  for (const key of unset) doc.delete(key);
  let out = doc.toString({ lineWidth: 0 });
  if (out.trim() === '{}' || out.trim() === '') {
    return body;
  }
  if (!out.endsWith('\n')) out += '\n';
  return `---\n${out}---\n${body}`;
}

export function buildNote(frontmatter: Frontmatter, body: string): string {
  const keys = Object.keys(frontmatter).filter((k) => frontmatter[k] !== undefined);
  if (keys.length === 0) return body;
  const clean: Frontmatter = {};
  for (const k of keys) clean[k] = frontmatter[k];
  const yaml = YAML.stringify(clean, { lineWidth: 0 });
  return `---\n${yaml}---\n${body}`;
}

export class FrontmatterError extends Error {}
