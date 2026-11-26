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
  kind: 'text' | 'date' | 'time' | 'url' | 'email' | 'tel' | 'number' | 'link' | 'list' | 'boolean' | 'select' | 'secret';
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
    key: 'number',
    label: 'Номер документа',
    kind: 'secret',
    hint: 'Хранится в заметке открытым текстом, в интерфейсе скрыт',
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

// ---------- Финансы, здоровье, обучение, практики, дом ----------

export const PERIOD_LABEL: Record<string, string> = { weekly: 'Еженедельно', monthly: 'Ежемесячно', quarterly: 'Раз в квартал', yearly: 'Раз в год' };
export const RECURRENCE_LABEL: Record<string, string> = { none: 'Разовый', monthly: 'Каждый месяц', quarterly: 'Каждый квартал', yearly: 'Каждый год' };
export const SUB_STATUS_LABEL: Record<string, string> = { active: 'Активна', paused: 'На паузе', cancelled: 'Отменена' };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { planned: 'К оплате', paid: 'Оплачен', cancelled: 'Отменён' };
export const DEBT_DIRECTION_LABEL: Record<string, string> = { i_owe: 'Я должен', owed_to_me: 'Мне должны' };
export const DEBT_STATUS_LABEL: Record<string, string> = { active: 'Активный', closed: 'Закрыт' };
export const SAVINGS_KIND_LABEL: Record<string, string> = { reserve: 'Резерв / подушка', goal: 'Финансовая цель', purchase: 'Крупная покупка' };
export const SAVINGS_STATUS_LABEL: Record<string, string> = { active: 'Копим', done: 'Достигнута', paused: 'На паузе' };
export const TX_KIND_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', saving: 'Накопления' };
export const OBLIGATION_LABEL: Record<string, string> = { payment: 'Платёж', subscription: 'Подписка', debt: 'Долг' };

export const WORKOUT_KIND_LABEL: Record<string, string> = {
  strength: 'Силовая', run: 'Бег', cardio: 'Кардио', swim: 'Плавание', bike: 'Велосипед', yoga: 'Йога', stretch: 'Растяжка', walk: 'Прогулка', other: 'Другое',
};
export const WORKOUT_STATUS_LABEL: Record<string, string> = { planned: 'План', done: 'Сделано', skipped: 'Пропущена' };

export const MATERIAL_TYPE_LABEL: Record<string, string> = { book: 'Книга', article: 'Статья', video: 'Видео', course: 'Курс' };
export const LEARN_STATUS_LABEL: Record<string, string> = { want: 'Хочу изучить', active: 'В процессе', paused: 'Пауза', done: 'Готово', dropped: 'Брошено' };
export const UNIT_LABEL: Record<string, string> = { pages: 'страниц', lessons: 'уроков', percent: '%', minutes: 'минут' };
export const SKILL_KIND_LABEL: Record<string, string> = { skill: 'Навык', language: 'Язык' };
export const SKILL_STATUS_LABEL: Record<string, string> = { active: 'Развиваю', paused: 'Пауза', done: 'Цель достигнута' };

export const SPHERE_LABEL: Record<string, string> = { health: 'Здоровье', home: 'Дом', practice: 'Практики', learning: 'Обучение', finance: 'Финансы', other: 'Другое' };
export const APPLIANCE_STATUS_LABEL: Record<string, string> = { in_use: 'Работает', repair: 'В ремонте', sold: 'Продана', disposed: 'Утилизирована' };

export const SUBSCRIPTION_FIELDS: FieldDef[] = [
  { key: 'amount', label: 'Сумма, ₽', kind: 'number' },
  { key: 'period', label: 'Период', kind: 'select', options: PERIOD_LABEL },
  { key: 'next_payment', label: 'Следующее списание', kind: 'date' },
  { key: 'category', label: 'Категория', kind: 'text', placeholder: 'Подписки' },
  { key: 'status', label: 'Статус', kind: 'select', options: SUB_STATUS_LABEL },
  { key: 'account', label: 'Карта / счёт', kind: 'text', placeholder: 'карта …1234', hint: 'Не пишите полный номер карты' },
  { key: 'url', label: 'Ссылка на управление', kind: 'url', placeholder: 'https://…' },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const PAYMENT_FIELDS: FieldDef[] = [
  { key: 'amount', label: 'Сумма, ₽', kind: 'number' },
  { key: 'date', label: 'Дата платежа', kind: 'date' },
  { key: 'recurrence', label: 'Повторение', kind: 'select', options: RECURRENCE_LABEL },
  { key: 'category', label: 'Категория', kind: 'text', placeholder: 'Жильё, Коммунальные…' },
  { key: 'status', label: 'Статус', kind: 'select', options: PAYMENT_STATUS_LABEL },
  { key: 'contact', label: 'Получатель', kind: 'link', linkTypes: ['contact', 'company'] },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const DEBT_FIELDS: FieldDef[] = [
  { key: 'direction', label: 'Направление', kind: 'select', options: DEBT_DIRECTION_LABEL },
  { key: 'counterparty', label: 'Кто', kind: 'link', linkTypes: ['contact', 'company'], placeholder: 'Банк, человек…' },
  { key: 'amount', label: 'Сумма долга, ₽', kind: 'number' },
  { key: 'remaining', label: 'Осталось, ₽', kind: 'number', hint: 'По умолчанию — вся сумма' },
  { key: 'monthly_payment', label: 'Ежемесячный платёж, ₽', kind: 'number' },
  { key: 'next_payment', label: 'Следующий платёж', kind: 'date' },
  { key: 'due', label: 'Погасить до', kind: 'date' },
  { key: 'rate', label: 'Ставка, %', kind: 'number' },
  { key: 'status', label: 'Статус', kind: 'select', options: DEBT_STATUS_LABEL },
];

export const SAVINGS_FIELDS: FieldDef[] = [
  { key: 'kind', label: 'Вид', kind: 'select', options: SAVINGS_KIND_LABEL },
  { key: 'target', label: 'Цель, ₽', kind: 'number' },
  { key: 'current', label: 'Уже накоплено, ₽', kind: 'number' },
  { key: 'monthly', label: 'Откладывать в месяц, ₽', kind: 'number' },
  { key: 'deadline', label: 'Срок', kind: 'date' },
  { key: 'goal', label: 'Цель в «Стратегии»', kind: 'link', linkTypes: ['goal'] },
  { key: 'status', label: 'Статус', kind: 'select', options: SAVINGS_STATUS_LABEL },
];

export const WORKOUT_FIELDS: FieldDef[] = [
  { key: 'date', label: 'Дата', kind: 'date' },
  { key: 'time', label: 'Время', kind: 'time' },
  { key: 'kind', label: 'Вид', kind: 'select', options: WORKOUT_KIND_LABEL },
  { key: 'status', label: 'Статус', kind: 'select', options: WORKOUT_STATUS_LABEL },
  { key: 'duration', label: 'Длительность, мин', kind: 'number' },
  { key: 'distance', label: 'Дистанция, км', kind: 'number' },
  { key: 'effort', label: 'Нагрузка, 1–5', kind: 'number' },
  { key: 'goal', label: 'Цель', kind: 'link', linkTypes: ['goal'] },
];

export const MATERIAL_FIELDS_LEARN: FieldDef[] = [
  { key: 'status', label: 'Статус', kind: 'select', options: LEARN_STATUS_LABEL },
  { key: 'author', label: 'Автор', kind: 'text' },
  { key: 'url', label: 'Ссылка', kind: 'url', placeholder: 'https://…' },
  { key: 'unit', label: 'Прогресс в', kind: 'select', options: { pages: 'страницах', lessons: 'уроках', percent: 'процентах', minutes: 'минутах' } },
  { key: 'total', label: 'Всего', kind: 'number' },
  { key: 'progress', label: 'Пройдено', kind: 'number' },
  { key: 'started', label: 'Начато', kind: 'date' },
  { key: 'finished', label: 'Закончено', kind: 'date' },
  { key: 'rating', label: 'Оценка, 1–5', kind: 'number' },
  { key: 'skill', label: 'Навык', kind: 'link', linkTypes: ['skill'] },
  { key: 'goal', label: 'Цель', kind: 'link', linkTypes: ['goal'] },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const SKILL_FIELDS: FieldDef[] = [
  { key: 'kind', label: 'Вид', kind: 'select', options: SKILL_KIND_LABEL },
  { key: 'level', label: 'Текущий уровень', kind: 'text', placeholder: 'B1, Middle…' },
  { key: 'target_level', label: 'Целевой уровень', kind: 'text' },
  { key: 'weekly_minutes', label: 'Цель, минут в неделю', kind: 'number' },
  { key: 'hours', label: 'Часов практики', kind: 'number' },
  { key: 'status', label: 'Статус', kind: 'select', options: SKILL_STATUS_LABEL },
  { key: 'goal', label: 'Цель', kind: 'link', linkTypes: ['goal'] },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const APPLIANCE_FIELDS: FieldDef[] = [
  { key: 'brand', label: 'Бренд', kind: 'text' },
  { key: 'model', label: 'Модель', kind: 'text' },
  { key: 'room', label: 'Где стоит', kind: 'text', placeholder: 'Кухня' },
  { key: 'purchased', label: 'Куплено', kind: 'date' },
  { key: 'price', label: 'Цена, ₽', kind: 'number' },
  { key: 'store', label: 'Магазин', kind: 'text' },
  { key: 'warranty_until', label: 'Гарантия до', kind: 'date' },
  { key: 'serial', label: 'Серийный номер', kind: 'text' },
  { key: 'manual', label: 'Инструкция (ссылка)', kind: 'url', placeholder: 'https://…' },
  { key: 'status', label: 'Состояние', kind: 'select', options: APPLIANCE_STATUS_LABEL },
  { key: 'project', label: 'Проект', kind: 'link', linkTypes: ['project'] },
];

export const ROUTINE_FIELDS: FieldDef[] = [
  { key: 'sphere', label: 'Сфера', kind: 'select', options: SPHERE_LABEL },
  { key: 'every', label: 'Раз в N дней', kind: 'number', placeholder: '7' },
  { key: 'time', label: 'Время', kind: 'time' },
  { key: 'start', label: 'Первый раз', kind: 'date', hint: 'Если ещё ни разу не делали' },
  { key: 'last_done', label: 'Последний раз', kind: 'date' },
  { key: 'status', label: 'Статус', kind: 'select', options: { active: 'Активно', paused: 'На паузе' } },
];

/** Типы записей, которые открываются на общей странице записи раздела. */
export const SPHERE_ITEM_TYPES = ['subscription', 'payment', 'debt', 'savings', 'workout', 'book', 'article', 'video', 'course', 'skill', 'appliance', 'routine'];

export function fieldsFor(type: string): FieldDef[] {
  switch (type) {
    case 'subscription':
      return SUBSCRIPTION_FIELDS;
    case 'payment':
      return PAYMENT_FIELDS;
    case 'debt':
      return DEBT_FIELDS;
    case 'savings':
      return SAVINGS_FIELDS;
    case 'workout':
      return WORKOUT_FIELDS;
    case 'book':
    case 'article':
    case 'video':
    case 'course':
      return MATERIAL_FIELDS_LEARN;
    case 'skill':
      return SKILL_FIELDS;
    case 'appliance':
      return APPLIANCE_FIELDS;
    case 'routine':
      return ROUTINE_FIELDS;
    default:
      return [];
  }
}

export const rub = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`);

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
    case 'ledger':
    case 'budget':
      return '/finance';
    case 'shopping':
    case 'chores':
      return '/home';
    default:
      if (SPHERE_ITEM_TYPES.includes(type)) return `/item?path=${p}`;
      return `/note?path=${p}`;
  }
}
