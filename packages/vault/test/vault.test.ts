import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vault, VaultError } from '../src/vault.ts';
import { openSample, TODAY } from './helpers.ts';

describe('Vault: чтение', () => {
  it('находит папки PARA и типы заметок', async () => {
    const { vault } = await openSample();
    expect(vault.folders).toMatchObject({
      projects: 'Projects',
      areas: 'Areas',
      resources: 'Resources',
      archive: 'Archive',
      goals: 'Areas/Goals',
      cycles: 'Areas/Cycles',
      ideas: 'Inbox/Ideas',
      daily: 'Daily',
    });
    expect(vault.get('Projects/Ремонт балкона.md')?.type).toBe('project');
    expect(vault.get('Projects/Личный сайт-портфолио/Личный сайт-портфолио.md')?.type).toBe('project');
    expect(vault.get('Projects/Личный сайт-портфолио/Кейсы для портфолио.md')?.type).toBe('note');
    expect(vault.get('Archive/Блог о путешествиях.md')?.para).toBe('archive');
  });

  it('разрешает ссылки и строит обратные ссылки', async () => {
    const { vault } = await openSample();
    const project = vault.require('Projects/Поиск работы.md');
    const goal = project.links.find((l) => l.key === 'goal');
    expect(goal?.resolved).toBe('Areas/Goals/Найти работу продакт-менеджером.md');
    expect(vault.backlinks('Resources/Контакты/Анна Смирнова.md')).toEqual([
      'Inbox/Заметки с созвона с Анной.md',
      'Projects/Поиск работы.md',
    ]);
    expect(vault.resolve('анна смирнова')).toBe('Resources/Контакты/Анна Смирнова.md');
    expect(vault.resolve('Нет такой')).toBeNull();
  });

  it('ищет по всему хранилищу и скрывает текст чувствительных заметок', async () => {
    const { vault } = await openSample();
    const hits = vault.searchNotes('собеседован');
    expect(hits.map((h) => h.path)).toContain('Resources/Как проходить продуктовые собеседования.md');
    const passport = vault.searchNotes('паспорт');
    expect(passport[0]!.path).toBe('Resources/Паспорт.md');
    expect(passport[0]!.snippet).toBe('');
    expect(passport[0]!.note.frontmatter).not.toHaveProperty('expires');
  });

  it('не падает на битом YAML и показывает ошибку', async () => {
    const { dir } = await openSample();
    await fs.writeFile(path.join(dir, 'Inbox', 'Битая.md'), '---\ntype: [oops\n---\nтекст\n');
    const v = await Vault.open({ root: dir, clock: () => TODAY });
    expect(v.get('Inbox/Битая.md')?.frontmatterError).toMatch(/YAML/);
    expect(v.stats().frontmatterErrors).toHaveLength(1);
  });

  it('сообщает, если папки нет', async () => {
    await expect(Vault.open({ root: '/nonexistent/vault' })).rejects.toThrow(/не найдена/);
  });

  it('читает папку ежедневных заметок из настроек Obsidian', async () => {
    const { dir } = await openSample();
    await fs.writeFile(path.join(dir, '.obsidian', 'daily-notes.json'), '{"folder":"Journal/Days","format":"DD.MM.YYYY"}');
    const v = await Vault.open({ root: dir, clock: () => TODAY });
    expect(v.dailyPath('2026-11-24')).toBe('Journal/Days/24.11.2026.md');
  });
});

describe('Vault: запись', () => {
  it('создаёт заметку с YAML и не перезаписывает существующую', async () => {
    const { vault, dir } = await openSample();
    const a = await vault.createNote({ folder: 'Inbox', title: 'Новая: заметка?', frontmatter: { type: 'note' }, body: 'Текст' });
    expect(a.path).toBe('Inbox/Новая заметка.md');
    const b = await vault.createNote({ folder: 'Inbox', title: 'Новая заметка', body: 'Другой' });
    expect(b.path).toBe('Inbox/Новая заметка 2.md');
    const raw = await fs.readFile(path.join(dir, a.path), 'utf8');
    expect(raw).toBe('---\ntype: note\n---\nТекст');
  });

  it('запрещает пути вне хранилища и не-Markdown файлы', async () => {
    const { vault } = await openSample();
    await expect(vault.writeNote('../evil.md', 'x', null)).rejects.toBeInstanceOf(VaultError);
    await expect(vault.writeNote('/etc/passwd.md', 'x', null)).rejects.toThrow(/Недопустимый путь/);
    await expect(vault.writeNote('Inbox/script.js', 'x', null)).rejects.toThrow(/\.md/);
    await expect(vault.writeNote('.obsidian/app.md', 'x', null)).rejects.toThrow(/Недопустимый путь/);
  });

  it('обнаруживает конфликт, если файл изменили в Obsidian', async () => {
    const { vault, dir } = await openSample();
    const rel = 'Inbox/Заметки с созвона с Анной.md';
    const { hash } = await vault.readRaw(rel);
    await fs.appendFile(path.join(dir, rel), '\nправка из Obsidian\n');
    await expect(vault.writeNote(rel, 'моя версия', hash)).rejects.toMatchObject({ code: 'conflict' });
    const fresh = await vault.readRaw(rel);
    const saved = await vault.writeNote(rel, fresh.content + '\nи моя правка\n', fresh.hash);
    expect(saved.body).toContain('правка из Obsidian');
    expect(saved.body).toContain('и моя правка');
  });

  it('меняет свойства, не трогая текст', async () => {
    const { vault, dir } = await openSample();
    const rel = 'Projects/Ремонт балкона.md';
    const before = await fs.readFile(path.join(dir, rel), 'utf8');
    await vault.updateProperties(rel, { status: 'active' });
    const after = await fs.readFile(path.join(dir, rel), 'utf8');
    expect(after).toContain('status: active');
    expect(after.split('---\n').slice(2).join('---\n')).toBe(before.split('---\n').slice(2).join('---\n'));
    expect(vault.require(rel).frontmatter.status).toBe('active');
  });

  it('создаёт ежедневную заметку по шаблону', async () => {
    const { vault } = await openSample();
    const n = await vault.ensureDaily('2026-11-25');
    expect(n.path).toBe('Daily/2026-11-25.md');
    expect(n.type).toBe('daily');
    expect(n.body).toContain('## Итог дня');
    expect((await vault.ensureDaily('2026-11-25')).path).toBe(n.path);
  });

  it('подхватывает изменения файлов, сделанные извне', async () => {
    const { vault, dir } = await openSample();
    await fs.writeFile(path.join(dir, 'Inbox', 'Внешняя.md'), '# Внешняя\n- [ ] Задача из Obsidian\n');
    await vault.refresh('Inbox/Внешняя.md');
    expect(vault.get('Inbox/Внешняя.md')?.tasks[0]?.title).toBe('Задача из Obsidian');
    await fs.rm(path.join(dir, 'Inbox', 'Внешняя.md'));
    await vault.refresh('Inbox/Внешняя.md');
    expect(vault.get('Inbox/Внешняя.md')).toBeUndefined();
  });

  it('перемещает заметку в архив', async () => {
    const { vault } = await openSample();
    const moved = await vault.move('Projects/Ремонт балкона.md', 'Archive');
    expect(moved.path).toBe('Archive/Ремонт балкона.md');
    expect(moved.para).toBe('archive');
    expect(vault.get('Projects/Ремонт балкона.md')).toBeUndefined();
  });
});
