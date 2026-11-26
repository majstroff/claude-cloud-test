import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Crm, aiAccess, documentWarnings, parseHistory } from '../src/crm.ts';
import { openSample } from './helpers.ts';

async function setup() {
  const s = await openSample();
  return { ...s, crm: new Crm(s.life) };
}

describe('Работа: вакансии', () => {
  it('читает вакансии из хранилища и связывает их с компанией, рекрутером и резюме', async () => {
    const { crm } = await setup();
    const acme = crm.vacancies().find((v) => v.title === 'Product Manager — Acme')!;
    expect(acme.status).toBe('interview');
    expect(acme.company).toEqual({ path: 'Resources/Компании/Acme.md', title: 'Acme' });
    expect(acme.recruiter?.path).toBe('Resources/Контакты/Анна Смирнова.md');
    expect(acme.resume?.title).toBe('Резюме PM 2026');
    expect(acme.project?.title).toBe('Поиск работы');
    // Компания без карточки остаётся текстом.
    expect(crm.vacancies().find((v) => v.title.includes('Gamma'))!.company).toEqual({ path: null, title: 'Gamma Games' });
    // Закрытые вакансии — в конце списка.
    expect(crm.vacancies().at(-1)!.status).toBe('rejected');
  });

  it('сводка воронки, собеседования и материалы', async () => {
    const { crm } = await setup();
    const w = crm.work();
    expect(w.byStatus).toMatchObject({ interview: 1, applied: 1, test: 1, rejected: 1 });
    expect(w.active).toBe(3);
    expect(w.interviews.map((v) => v.interview)).toEqual(['2026-12-02']);
    expect(w.responseRate).toBe(75);
    const resume = w.materials.find((m) => m.title === 'Резюме PM 2026')!;
    expect(resume.usedIn).toBe(3);
  });

  it('задачи вакансии попадают в проект «Поиск работы»', async () => {
    const { life } = await setup();
    const t = life.tasks('open').find((x) => x.title === 'Изучить продукт Acme и конкурентов')!;
    expect(t.project?.title).toBe('Поиск работы');
  });

  it('создаёт вакансию с карточкой компании и ведёт историю статусов', async () => {
    const { crm, vault, dir } = await setup();
    const n = await crm.createEntity({
      type: 'vacancy',
      title: 'PM — Омега',
      fields: { company: 'Омега', position: 'Product Manager', url: 'https://omega.example.com/job', recruiter: 'Анна Смирнова' },
      createCompany: true,
    });
    expect(n.path).toBe('Areas/Работа/Вакансии/PM — Омега.md');
    expect(vault.get('Resources/Компании/Омега.md')?.type).toBe('company');
    let v = crm.vacancy(vault.require(n.path));
    expect(v.status).toBe('interesting');
    expect(v.company?.path).toBe('Resources/Компании/Омега.md');
    expect(v.recruiter?.title).toBe('Анна Смирнова');

    await crm.setVacancyStatus(n.path, 'applied', 'через сайт');
    v = crm.vacancy(vault.require(n.path));
    expect(v.applied).toBe('2026-11-24');
    await crm.scheduleInterview(n.path, { date: '2026-11-30', time: '10:30', format: 'Zoom' });
    const task = await crm.addTestAssignment(n.path, { due: '2026-12-03', text: 'прототип онбординга' });
    expect(task.title).toBe('Тестовое: прототип онбординга');
    expect(task.due).toBe('2026-12-03');

    const detail = crm.vacancyDetail(n.path);
    expect(detail.status).toBe('test');
    expect(detail.interview).toBe('2026-11-30');
    expect(detail.history.map((h) => h.text)).toEqual([
      'Собеседование → Тестовое: срок 2026-12-03',
      'Отклик → Собеседование: собеседование 2026-11-30 10:30 · Zoom',
      'Интересно → Отклик: через сайт',
      'Добавлена, статус «Интересно»',
    ]);
    const raw = await fs.readFile(path.join(dir, n.path), 'utf8');
    expect(raw).toContain('- 2026-11-30 10:30 · Zoom');
    expect(raw).toContain('- [ ] Тестовое: прототип онбординга ⏫ 📅 2026-12-03');

    // В календаре — собеседование и срок тестового.
    const days = crm.life.calendar('2026-11-30', '2026-12-03');
    const titles = days.flatMap((d) => d.items.map((i) => `${d.date} ${i.title}`));
    expect(titles).toContain('2026-11-30 Собеседование: PM — Омега');
    expect(titles).toContain('2026-12-03 Тестовое: PM — Омега');
  });

  it('проверяет поля и не принимает чужие свойства', async () => {
    const { crm } = await setup();
    await expect(crm.createEntity({ type: 'vacancy', title: 'X', fields: { url: 'omega.ru' } })).rejects.toThrow(/http/);
    await expect(crm.createEntity({ type: 'vacancy', title: 'X', fields: { status: 'hired' } })).rejects.toThrow(/Недопустимое/);
    await expect(crm.updateEntity('Areas/Работа/Вакансии/Senior PM — Beta Bank.md', { type: 'project' })).rejects.toThrow(/нельзя/);
    await expect(crm.updateEntity('Projects/Поиск работы.md', { status: 'x' })).rejects.toThrow(/нельзя/);
  });

  it('смена статуса через общее редактирование тоже пишется в историю', async () => {
    const { crm } = await setup();
    const rel = 'Areas/Работа/Вакансии/Senior PM — Beta Bank.md';
    await crm.updateEntity(rel, { status: 'response', salary: '330 тыс. ₽' });
    const d = crm.vacancyDetail(rel);
    expect(d.salary).toBe('330 тыс. ₽');
    expect(d.history[0]).toEqual({ date: '2026-11-24', text: 'Отклик → Ответ' });
  });
});

describe('Контакты и компании', () => {
  it('показывает, с кем пора связаться', async () => {
    const { crm } = await setup();
    const list = crm.contacts();
    expect(list[0]).toMatchObject({ title: 'Игорь Петров', followUp: 'overdue', daysSinceContact: 14 });
    const anna = list.find((c) => c.title === 'Анна Смирнова')!;
    expect(anna.followUp).toBeNull(); // 28 ноября — дальше трёх дней
    expect(anna.company).toEqual({ path: null, title: 'Talent Hub' });
  });

  it('карточка контакта: история, договорённости, вакансии и связи', async () => {
    const { crm } = await setup();
    const igor = crm.contactDetail('Resources/Контакты/Игорь Петров.md');
    expect(igor.history.map((h) => h.date)).toEqual(['2026-11-10', '2026-11-03']);
    expect(igor.agreements.map((t) => t.title)).toEqual(['Прислать Игорю отчёт по первому этапу']);
    expect(igor.company?.path).toBe('Resources/Компании/Студия Север.md');
    const anna = crm.contactDetail('Resources/Контакты/Анна Смирнова.md');
    expect(anna.vacancies.map((v) => v.title)).toEqual(['Product Manager — Acme']);
  });

  it('записывает общение, переносит следующий контакт и добавляет договорённость', async () => {
    const { crm, dir } = await setup();
    const rel = 'Resources/Контакты/Игорь Петров.md';
    const r = await crm.logInteraction({
      path: rel,
      channel: 'звонок',
      text: 'Обсудили отчёт',
      agreement: 'Выставить счёт за первый этап',
      agreementDue: 'завтра',
    });
    expect(r.agreement?.due).toBe('2026-11-25');
    let c = crm.contactDetail(rel);
    expect(c.lastContact).toBe('2026-11-24');
    expect(c.nextContact).toBeNull(); // запланированный контакт состоялся
    expect(c.history[0]).toEqual({ date: '2026-11-24', text: 'звонок: Обсудили отчёт' });
    expect(c.agreements).toHaveLength(2);
    await crm.logInteraction({ path: rel, text: 'Письмо с отчётом', nextContact: '2026-12-01' });
    c = crm.contactDetail(rel);
    expect(c.nextContact).toBe('2026-12-01');
    const raw = await fs.readFile(path.join(dir, rel), 'utf8');
    expect(raw).toContain('- 2026-11-24 · Письмо с отчётом');
    await expect(crm.logInteraction({ path: rel, text: 'x', date: '2026-12-31' })).rejects.toThrow(/будущем/);
    await expect(crm.logInteraction({ path: rel, text: '  ' })).rejects.toThrow(/Опишите/);
  });

  it('компания собирает контакты, вакансии и документы', async () => {
    const { crm } = await setup();
    const sever = crm.companyDetail('Resources/Компании/Студия Север.md');
    expect(sever.contacts.map((c) => c.title)).toEqual(['Игорь Петров']);
    expect(sever.tasks.map((t) => t.title)).toEqual([]);
    const acme = crm.companies().find((c) => c.title === 'Acme')!;
    expect(acme.vacancies).toEqual([{ path: 'Areas/Работа/Вакансии/Product Manager — Acme.md', title: 'Product Manager — Acme', status: 'interview' }]);
  });

  it('новый контакт записывается в папку контактов с секциями', async () => {
    const { crm, dir } = await setup();
    const n = await crm.createEntity({ type: 'contact', title: 'Мария Иванова', fields: { email: 'maria@example.com', company: 'Acme', kind: 'colleague' } });
    expect(n.path).toBe('Resources/Контакты/Мария Иванова.md');
    const raw = await fs.readFile(path.join(dir, n.path), 'utf8');
    expect(raw).toContain('company: "[[Acme]]"');
    expect(raw).toContain('## История общения');
    await expect(crm.createEntity({ type: 'contact', title: 'X', fields: { email: 'не почта' } })).rejects.toThrow(/email/);
  });
});

describe('Документы', () => {
  it('считает сроки и состояние документов', async () => {
    const { crm } = await setup();
    const docs = crm.documents();
    const rvp = docs.find((d) => d.title === 'РВП')!;
    expect(rvp).toMatchObject({ docType: 'residence', state: 'expiring', remindFrom: '2026-10-17', sensitive: true, daysLeft: 142 });
    expect(docs[0]!.title).toBe('РВП'); // требующие внимания — первыми
    expect(docs.find((d) => d.title === 'Паспорт')).toMatchObject({ docType: 'passport', state: 'valid', remindDays: 180 });
    expect(docs.find((d) => d.title === 'Диплом магистра')!.state).toBe('no_expiry');
    expect(docs.find((d) => d.title === 'Полис ОСАГО')!.warnings).toEqual([
      expect.stringContaining('не помечен как конфиденциальный'),
    ]);
  });

  it('создаёт документ конфиденциальным и не принимает полный номер', async () => {
    const { crm, vault } = await setup();
    await expect(
      crm.createEntity({ type: 'document', title: 'Загранпаспорт', fields: { doc_type: 'passport', number_last4: '123456789' } }),
    ).rejects.toThrow(/4 последних/);
    const n = await crm.createEntity({ type: 'document', title: 'Загранпаспорт', fields: { doc_type: 'passport', number_last4: '6789', expires: '2027-01-10' } });
    expect(n.path).toBe('Areas/Документы/Загранпаспорт.md');
    const note = vault.require(n.path);
    expect(note.sensitive).toBe(true);
    // Конфиденциальная заметка не показывает текст в поиске.
    expect(vault.searchNotes('Загранпаспорт')[0]?.snippet).toBe('');
    const task = await crm.createRenewalTask(n.path);
    expect(task.due).toBe('2026-11-24'); // 180 дней до срока уже наступили
    expect(task.title).toBe('Продлить: Загранпаспорт (до 2027-01-10)');
    await expect(crm.createRenewalTask(n.path)).rejects.toThrow(/уже есть/);
    expect(crm.document(vault.require(n.path)).renewalTask?.id).toBe(task.id);
  });

  it('предупреждает о скане в хранилище и полном номере', () => {
    const w = documentWarnings({ body: 'Скан: ![[passport.jpg]]\nНомер 45 12 345678', frontmatter: {}, sensitive: true }, 'passport');
    expect(w).toHaveLength(2);
    expect(documentWarnings({ body: 'Выдан 2020-01-01', frontmatter: { issued: '2020-01-01' }, sensitive: true }, 'passport')).toEqual([]);
  });

  it('истечение документа и следующий контакт видны в календаре', async () => {
    const { crm } = await setup();
    const items = crm.life.calendar('2026-11-28', '2026-11-28')[0]!.items.map((i) => i.title);
    expect(items).toContain('Связаться: Анна Смирнова');
    const exp = crm.life.calendar('2027-04-15', '2027-04-15')[0]!.items.map((i) => i.title);
    expect(exp).toContain('Истекает: РВП');
  });

  it('напоминания для главной', async () => {
    const { crm } = await setup();
    const r = crm.reminders();
    expect(r.followUps.map((c) => c.title)).toEqual(['Игорь Петров']);
    expect(r.documents.map((d) => d.title)).toEqual(['РВП']);
    expect(r.interviews.map((v) => v.title)).toEqual(['Product Manager — Acme']);
    expect(r.vacanciesActive).toBe(3);
  });
});

describe('Доступ ИИ', () => {
  it('закрывает документы и конфиденциальные заметки без явного разрешения', async () => {
    const { vault } = await setup();
    expect(aiAccess(vault.require('Resources/Паспорт.md')).allowed).toBe(false);
    expect(aiAccess(vault.require('Areas/Документы/Полис ОСАГО.md'))).toEqual({ allowed: false, reason: expect.stringContaining('ai: true') });
    expect(aiAccess(vault.require('Projects/Поиск работы.md')).allowed).toBe(true);
    expect(aiAccess({ type: 'document', sensitive: false, frontmatter: { ai: true } }).allowed).toBe(true);
    expect(aiAccess({ type: 'note', sensitive: false, frontmatter: { ai: false } }).allowed).toBe(false);
  });
});

describe('parseHistory', () => {
  it('разбирает строки с датой и сортирует от новых к старым', () => {
    expect(parseHistory('- 2026-01-02 · b\n- 2026-01-03 - c\nпросто текст\n* 2026-01-01 a')).toEqual([
      { date: '2026-01-03', text: 'c' },
      { date: '2026-01-02', text: 'b' },
      { date: '2026-01-01', text: 'a' },
    ]);
  });
});
