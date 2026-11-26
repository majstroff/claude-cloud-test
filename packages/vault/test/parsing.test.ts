import { describe, expect, it } from 'vitest';
import { addMonths, parseHumanDate, startOfWeek } from '../src/dates.ts';
import { parseFrontmatter, splitFrontmatter, updateFrontmatter } from '../src/frontmatter.ts';
import { appendToSection, extractLinks, getSectionText, setSectionText } from '../src/markdown.ts';
import { SearchIndex } from '../src/search.ts';
import {
  buildTaskLine,
  completeTaskLine,
  nextDate,
  parseTaskLine,
  reopenTaskLine,
  setTaskDueLine,
  setTaskPriorityLine,
} from '../src/tasks.ts';

describe('frontmatter', () => {
  it('разбирает YAML и тело заметки', () => {
    const s = splitFrontmatter('---\ntype: project\ntags: [a, b]\n---\n# Заголовок\nтекст');
    expect(s.yaml).toBe('type: project\ntags: [a, b]');
    expect(s.bodyLine).toBe(4);
    expect(parseFrontmatter(s.yaml).data).toEqual({ type: 'project', tags: ['a', 'b'] });
  });

  it('сообщает об ошибке YAML, не падая', () => {
    const r = parseFrontmatter('type: [oops');
    expect(r.data).toEqual({});
    expect(r.error).toMatch(/YAML/);
  });

  it('меняет поля, сохраняя комментарии и порядок', () => {
    const src = '---\n# мой комментарий\ntype: project\nstatus: active\n---\nтело\n';
    const out = updateFrontmatter(src, { status: 'done', goal: '[[Цель]]' });
    expect(out).toContain('# мой комментарий');
    expect(out).toContain('status: done');
    expect(out).toContain('goal: "[[Цель]]"');
    expect(out.indexOf('type:')).toBeLessThan(out.indexOf('status:'));
    expect(out.endsWith('---\nтело\n')).toBe(true);
  });

  it('добавляет frontmatter к заметке без него', () => {
    expect(updateFrontmatter('текст', { a: 1 })).toBe('---\na: 1\n---\nтекст');
  });

  it('оставляет даты строками', () => {
    const out = updateFrontmatter('---\ndeadline: 2026-12-01\n---\n', { x: 1 });
    expect(parseFrontmatter(splitFrontmatter(out).yaml).data.deadline).toBe('2026-12-01');
  });
});

describe('задачи', () => {
  it('понимает формат Obsidian Tasks', () => {
    const t = parseTaskLine('  - [ ] Позвонить в банк ⏫ 🔁 every week 📅 2026-11-25 #финансы')!;
    expect(t).toMatchObject({
      status: 'open',
      title: 'Позвонить в банк #финансы',
      due: '2026-11-25',
      priority: 'high',
      recurrence: 'every week',
      tags: ['финансы'],
      indent: '  ',
    });
  });

  it('понимает поля Dataview', () => {
    const t = parseTaskLine('- [x] Отчёт [due:: 2026-11-20] [completion:: 2026-11-21]')!;
    expect(t.status).toBe('done');
    expect(t.due).toBe('2026-11-20');
    expect(t.doneDate).toBe('2026-11-21');
    expect(t.title).toBe('Отчёт');
  });

  it('не считает обычный список задачей', () => {
    expect(parseTaskLine('- просто пункт')).toBeNull();
  });

  it('отмечает выполнение и снимает отметку', () => {
    const { line, next } = completeTaskLine('- [ ] Сделать 📅 2026-11-24', '2026-11-24');
    expect(line).toBe('- [x] Сделать 📅 2026-11-24 ✅ 2026-11-24');
    expect(next).toBeNull();
    expect(reopenTaskLine(line)).toBe('- [ ] Сделать 📅 2026-11-24');
  });

  it('создаёт следующее повторение', () => {
    const { line, next } = completeTaskLine('- [ ] Пробежка 🔁 every week 📅 2026-11-24', '2026-11-24');
    expect(next).toBe('- [ ] Пробежка 🔁 every week 📅 2026-12-01');
    expect(line).toContain('[x]');
  });

  it('меняет срок и приоритет', () => {
    expect(setTaskDueLine('- [ ] A 📅 2026-01-01', '2026-02-02')).toBe('- [ ] A 📅 2026-02-02');
    expect(setTaskDueLine('- [ ] A 📅 2026-01-01', null)).toBe('- [ ] A');
    expect(setTaskPriorityLine('- [ ] A ⏫', 'low')).toBe('- [ ] A 🔽');
    expect(buildTaskLine({ title: 'Новая', due: '2026-11-30', priority: 'high' })).toBe('- [ ] Новая ⏫ 📅 2026-11-30');
  });

  it('считает даты повторений', () => {
    expect(nextDate('every 2 weeks', '2026-11-24')).toBe('2026-12-08');
    expect(nextDate('every month', '2026-01-31')).toBe('2026-02-28');
    expect(nextDate('каждый день', '2026-11-24')).toBe('2026-11-25');
    expect(nextDate('when it rains', '2026-11-24')).toBeNull();
  });
});

describe('даты', () => {
  it('разбирает человеческие даты', () => {
    expect(parseHumanDate('завтра', '2026-11-24')).toBe('2026-11-25');
    expect(parseHumanDate('через 3 дня', '2026-11-24')).toBe('2026-11-27');
    expect(parseHumanDate('в пятницу', '2026-11-24')).toBe('2026-11-27');
    expect(parseHumanDate('01.12', '2026-11-24')).toBe('2026-12-01');
    expect(parseHumanDate('01.01', '2026-11-24')).toBe('2027-01-01');
    expect(parseHumanDate('31.02', '2026-11-24')).toBeNull();
    expect(parseHumanDate('непонятно', '2026-11-24')).toBeNull();
  });

  it('считает недели и месяцы', () => {
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
  });
});

describe('Markdown', () => {
  it('находит вики-ссылки и markdown-ссылки, но не в коде', () => {
    const links = extractLinks('См. [[Проект#Этапы|этапы]], ![[схема.png]] и [док](Папка/Док%201.md)\n```\n[[не ссылка]]\n```');
    expect(links.map((l) => l.target)).toEqual(['Проект', 'схема.png', 'Папка/Док 1.md']);
    expect(links[0]).toMatchObject({ heading: 'Этапы', alias: 'этапы' });
  });

  it('читает и заменяет секции', () => {
    const text = '# День\n\n## Приоритеты\n1. A\n\n## Итог дня\nстарый\n';
    expect(getSectionText(text, 'приоритеты')).toBe('1. A');
    const out = setSectionText(text, 'Итог дня', 'новый итог');
    expect(getSectionText(out, 'Итог дня')).toBe('новый итог');
    expect(getSectionText(out, 'Приоритеты')).toBe('1. A');
    const added = setSectionText('# X\n', 'Заметки', 'текст');
    expect(added).toBe('# X\n\n## Заметки\nтекст\n');
  });

  it('добавляет строку в конец секции', () => {
    const r = appendToSection('## Задачи\n- [ ] A\n\n## Заметки\n', 'Задачи', '- [ ] B');
    expect(r.text).toBe('## Задачи\n- [ ] A\n- [ ] B\n\n## Заметки\n');
    expect(r.lineIndex).toBe(2);
  });
});

describe('поиск', () => {
  it('ищет по префиксам, с учётом ё и весом заголовка', () => {
    const idx = new SearchIndex();
    idx.upsert('a.md', 'Ёлка', 'зимний праздник');
    idx.upsert('b.md', 'Праздники', 'ёлка в гостях');
    const hits = idx.search('елк');
    expect(hits.map((h) => h.path)).toEqual(['a.md', 'b.md']);
    expect(idx.search('зимн праз').map((h) => h.path)).toEqual(['a.md']);
    idx.remove('a.md');
    expect(idx.search('зимн')).toEqual([]);
  });
});
