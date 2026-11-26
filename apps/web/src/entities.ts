/** Поля и подписи сущностей «Работа», «Контакты», «Документы» (совпадают со схемой сервера). */

export const VACANCY_STATUSES = ['interesting', 'applied', 'response', 'interview', 'test', 'offer', 'rejected', 'archived'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export const VACANCY_ACTIVE: VacancyStatus[] = ['interesting', 'applied', 'response', 'interview', 'test', 'offer'];

export const VACANCY_STATUS_LABEL: Record<VacancyStatus, string> = {
  interesting: 'Интересно',
  applied: 'Отклик',
  response: 'Ответ',
  interview: 'Собеседование',
  test: 'Тестовое',
  offer: 'Оффер',
  rejected: 'Отказ',
  archived: 'Архив',
};

export const CONTACT_KIND_LABEL: Record<string, string> = {
  client: 'Клиент',
  recruiter: 'Рекрутер',
  colleague: 'Коллега',
  partner: 'Партнёр',
  friend: 'Друг',
  family: 'Семья',
  other: 'Другое',
};

export const RELATION_STATUS_LABEL: Record<string, string> = {
  lead: 'Потенциальный',
  active: 'Активный',
  paused: 'На паузе',
  former: 'Бывший',
};

export const COMPANY_KIND_LABEL: Record<string, string> = {
  employer: 'Работодатель',
  client: 'Клиент',
  partner: 'Партнёр',
  vendor: 'Поставщик',
  other: 'Другое',
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  passport: 'Паспорт',
  residence: 'РВП / ВНЖ',
  visa: 'Виза',
  contract: 'Договор',
  diploma: 'Диплом',
  certificate: 'Сертификат',
  insurance: 'Страховка',
  warranty: 'Гарантия',
  medical: 'Медицинский',
  other: 'Другое',
};

export const DOC_STATE_LABEL: Record<string, string> = {
  valid: 'Действует',
  expiring: 'Пора продлевать',
  expired: 'Истёк',
  no_expiry: 'Бессрочный',
};

export type FieldDef = {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'time' | 'url' | 'email' | 'tel' | 'number' | 'link' | 'list' | 'boolean' | 'select';
  options?: Record<string, string>;
  /** Для ссылок: подсказки из заметок этих типов. */
  linkTypes?: string[];
  placeholder?: string;
  hint?: string;
  wide?: boolean;
};

export const VACANCY_FIELDS: FieldDef[] = [
  { key: 'position', label: 'Должность', kind: 'text' },
  { key: 'company', label: 'Компания', kind: 'link', linkTypes: ['company'] },
  { key: 'url', label: 'Ссылка на вакансию', kind: 'url', placeholder: 'https://…' },
  { key: 'salary', label: 'Зарплата', kind: 'text' },
  { key: 'location', label: 'Локация / формат', kind: 'text', placeholder: 'Москва, удалёнка…' },
  { key: 'source', label: 'Источник', kind: 'text', placeholder: 'hh.ru, рекомендация…' },
  { key: 'recruiter', label: 'Рекрутер', kind: 'link', linkTypes: ['contact'] },
  { key: 'resume', label: 'Версия резюме', kind: 'link', linkTypes: ['resume', 'portfolio'] },
  { key: 'applied', label: 'Дата отклика', kind: 'date' },
  { key: 'next_step', label: 'Следующий шаг', kind: 'text', wide: true },
  { key: 'next_date', label: 'Дата шага', kind: 'date' },
  { key: 'result', label: 'Результат', kind: 'text', wide: true },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const CONTACT_FIELDS: FieldDef[] = [
  { key: 'company', label: 'Компания', kind: 'link', linkTypes: ['company'] },
  { key: 'role', label: 'Должность', kind: 'text' },
  { key: 'kind', label: 'Кто это', kind: 'select', options: CONTACT_KIND_LABEL },
  { key: 'client_status', label: 'Статус клиента', kind: 'select', options: RELATION_STATUS_LABEL },
  { key: 'phone', label: 'Телефон', kind: 'tel' },
  { key: 'email', label: 'Email', kind: 'email' },
  { key: 'links', label: 'Ссылки (по одной в строке)', kind: 'list', wide: true },
  { key: 'last_contact', label: 'Последняя связь', kind: 'date' },
  { key: 'next_contact', label: 'Следующий контакт', kind: 'date' },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const COMPANY_FIELDS: FieldDef[] = [
  { key: 'kind', label: 'Вид', kind: 'select', options: COMPANY_KIND_LABEL },
  { key: 'status', label: 'Статус', kind: 'select', options: RELATION_STATUS_LABEL },
  { key: 'website', label: 'Сайт', kind: 'url', placeholder: 'https://…' },
  { key: 'industry', label: 'Отрасль', kind: 'text' },
  { key: 'city', label: 'Город', kind: 'text' },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const DOCUMENT_FIELDS: FieldDef[] = [
  { key: 'doc_type', label: 'Тип', kind: 'select', options: DOC_TYPE_LABEL },
  { key: 'owner', label: 'Владелец', kind: 'text', placeholder: 'Я, супруга, ребёнок…' },
  { key: 'storage', label: 'Где хранится оригинал / скан', kind: 'text', wide: true, placeholder: 'Сейф дома; скан — в зашифрованном архиве' },
  {
    key: 'number_last4',
    label: 'Последние 4 символа номера',
    kind: 'text',
    hint: 'Полный номер не записывается в хранилище',
  },
  { key: 'issued', label: 'Дата выдачи', kind: 'date' },
  { key: 'expires', label: 'Действует до', kind: 'date' },
  { key: 'remind_days', label: 'Напомнить за, дней', kind: 'number', hint: 'По умолчанию зависит от типа' },
  { key: 'organization', label: 'Организация', kind: 'link', linkTypes: ['company'] },
  { key: 'sensitive', label: 'Конфиденциально: не показывать в поиске и не передавать ИИ', kind: 'boolean', wide: true },
];

export const MATERIAL_FIELDS: FieldDef[] = [
  { key: 'version', label: 'Версия', kind: 'text', placeholder: 'v3' },
  { key: 'url', label: 'Ссылка', kind: 'url', placeholder: 'https://…' },
  { key: 'updated', label: 'Обновлено', kind: 'date' },
];

/** Где открыть заметку: в своём разделе или в общем просмотре. */
export function entityHref(type: string, path: string): string {
  const p = encodeURIComponent(path);
  switch (type) {
    case 'project':
      return `/projects/view?path=${p}`;
    case 'vacancy':
      return `/work/view?path=${p}`;
    case 'contact':
      return `/contacts/view?path=${p}`;
    case 'company':
      return `/contacts/company?path=${p}`;
    case 'document':
      return `/documents/view?path=${p}`;
    default:
      return `/note?path=${p}`;
  }
}
