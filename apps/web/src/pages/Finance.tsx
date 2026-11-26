import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, PiggyBank, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { api, type DebtDTO, type FinanceData, type SavingsDTO } from '../api.ts';
import { CreateEntityModal } from '../components/Entities.tsx';
import { Modal } from '../components/Layout.tsx';
import { Money, ObligationList, useAct } from '../components/Spheres.tsx';
import { Empty, ErrorBox, Loading, MONTHS, Progress, fmtDate, noteHref, relDate } from '../components/ui.tsx';
import {
  DEBT_DIRECTION_LABEL,
  DEBT_FIELDS,
  PAYMENT_FIELDS,
  PAYMENT_STATUS_LABEL,
  PERIOD_LABEL,
  RECURRENCE_LABEL,
  SAVINGS_FIELDS,
  SAVINGS_KIND_LABEL,
  SUBSCRIPTION_FIELDS,
  SUB_STATUS_LABEL,
  TX_KIND_LABEL,
  entityHref,
  rub,
} from '../entities.ts';

type Tab = 'overview' | 'ops' | 'regular' | 'debts';
type Creating = null | 'subscription' | 'payment' | 'debt' | 'savings';

function shiftMonth(month: string, d: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(y!, m! - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const month = params.get('month');
  const q = useQuery({ queryKey: ['finance', month], queryFn: () => api.get<FinanceData>(`/api/finance${month ? `?month=${month}` : ''}`) });
  const [creating, setCreating] = useState<Creating>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const [y, m] = d.month.split('-').map(Number);
  const isCurrent = d.month === d.today.slice(0, 7);

  return (
    <div className="stack">
      <div className="filters">
        <div className="tabs" role="tablist">
          {(
            [
              ['overview', 'Обзор'],
              ['ops', `Операции · ${d.transactions.length}`],
              ['regular', 'Подписки и платежи'],
              ['debts', 'Долги и накопления'],
            ] as Array<[Tab, string]>
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'overview' ? null : k)} role="tab" aria-selected={tab === k}>
              {l}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn small icon" aria-label="Предыдущий месяц" onClick={() => set('month', shiftMonth(d.month, -1))}>
          <ChevronLeft size={14} />
        </button>
        <strong style={{ minWidth: 120, textAlign: 'center' }}>
          {MONTHS[m! - 1]} {y}
        </strong>
        <button className="btn small icon" aria-label="Следующий месяц" onClick={() => set('month', shiftMonth(d.month, 1))}>
          <ChevronRight size={14} />
        </button>
        {!isCurrent && (
          <button className="btn small" onClick={() => set('month', null)}>
            Текущий
          </button>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Stat label="Доходы" value={d.income} tone="var(--green)" />
        <Stat label="Расходы" value={d.expense} />
        <Stat label="Отложено" value={d.saved} />
        <Stat label="Фактический остаток" value={d.factBalance} hint="доходы − расходы − отложено" tone={d.factBalance < 0 ? 'var(--red)' : undefined} />
        <Stat label="Плановый остаток" value={d.plan.balance} hint={d.plan.income === null ? 'задайте план дохода в бюджете' : 'план дохода − лимиты − обязательные − накопления'} />
        {isCurrent && <Stat label="Прогноз на конец месяца" value={d.forecast} hint={`с учётом неоплаченного: ${rub(d.unpaidTotal)}`} tone={d.forecast < 0 ? 'var(--red)' : undefined} />}
      </div>

      {tab === 'overview' && <Overview d={d} onBudget={() => setBudgetOpen(true)} />}
      {tab === 'ops' && <Operations d={d} />}
      {tab === 'regular' && <Regular d={d} onCreate={setCreating} />}
      {tab === 'debts' && <DebtsAndSavings d={d} onCreate={setCreating} />}

      <div className="notice">
        <ShieldCheck size={18} style={{ flex: '0 0 auto' }} />
        <div className="small">
          Банковские счета не подключаются: операции вводятся здесь или правкой таблицы в заметках <code>Финансы/Операции/ГГГГ-ММ.md</code>. Номера карт не записывайте — достаточно последних цифр.
        </div>
      </div>

      {creating && <CreateFinance type={creating} onClose={() => setCreating(null)} />}
      {budgetOpen && <BudgetModal d={d} onClose={() => setBudgetOpen(false)} />}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number | null; hint?: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: tone }} className="money">
        {rub(value)}
      </div>
      <div className="small muted">{label}</div>
      {hint && <div className="small muted" style={{ marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Overview({ d, onBudget }: { d: FinanceData; onBudget: () => void }) {
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Бюджет по категориям</h2>
            <button className="btn small" onClick={onBudget}>
              Изменить бюджет
            </button>
          </div>
          {d.categories.length === 0 ? (
            <Empty title="Расходов и лимитов пока нет" action={<button className="btn small" onClick={onBudget}>Задать лимиты</button>}>
              Лимиты хранятся таблицей в заметке «Бюджет».
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {d.categories.map((c) => (
                <div key={c.category}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{c.category}</span>
                    <span className="small">
                      <Money value={c.spent} />
                      {c.limit !== null && (
                        <span className="muted">
                          {' '}из {rub(c.limit)} · {c.over ? <span style={{ color: 'var(--red)' }}>перерасход {rub(-c.left!)}</span> : `осталось ${rub(c.left)}`}
                        </span>
                      )}
                      {c.limit === null && <span className="muted"> · без лимита</span>}
                    </span>
                  </div>
                  {c.limit !== null && <Progress value={Math.min(100, Math.round((c.spent / Math.max(1, c.limit)) * 100))} tone={c.over ? 'red' : 'green'} />}
                </div>
              ))}
            </div>
          )}
          {d.budget.path && (
            <div className="small muted row" style={{ marginTop: 12 }}>
              <FileText size={14} /> <Link to={noteHref(d.budget.path)}>{d.budget.path}</Link>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>План месяца</h2>
          <table className="table">
            <tbody>
              <tr><td>План дохода</td><td className="r"><Money value={d.plan.income} /></td></tr>
              <tr><td>Лимиты по категориям</td><td className="r"><Money value={d.plan.limits} /></td></tr>
              <tr><td>Обязательные платежи и подписки вне лимитов</td><td className="r"><Money value={d.plan.obligations} /></td></tr>
              <tr><td>Плановые взносы в накопления</td><td className="r"><Money value={d.plan.savings} /></td></tr>
              <tr><td><strong>Плановый остаток</strong></td><td className="r"><strong><Money value={d.plan.balance} /></strong></td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">К оплате</h2>
            <span className="card-sub">30 дней</span>
          </div>
          <ObligationList items={d.obligations} today={d.today} />
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>Расходы по проектам</h2>
          {d.projects.length === 0 ? (
            <Empty title="Нет проектов с бюджетом">Укажите в операции связь с проектом — расход попадёт сюда.</Empty>
          ) : (
            <ul className="list">
              {d.projects.map((p) => (
                <li key={p.path}>
                  <Link to={entityHref('project', p.path)}>
                    <span className="type-dot project" />
                    <span className="li-main">
                      <div className="li-title">{p.title}</div>
                      {p.budget !== null && <Progress value={Math.min(100, Math.round((p.spent / Math.max(1, p.budget)) * 100))} tone="blue" />}
                    </span>
                    <span className="small">
                      <Money value={p.spent} />
                      {p.budget !== null && <span className="muted"> из {rub(p.budget)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function AddTransaction({ d }: { d: FinanceData }) {
  const [kind, setKind] = useState<'expense' | 'income' | 'saving'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState(d.today);
  const add = useAct('/api/finance/transactions', 'Операция записана в заметку месяца');
  const cats = kind === 'income' ? d.incomeCategories : d.expenseCategories;
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount.trim()) return;
        add.mutate(
          { kind, amount, category, description, link, date },
          {
            onSuccess: () => {
              setAmount('');
              setDescription('');
              setLink('');
            },
          },
        );
      }}
    >
      <div className="inline-form">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'expense')} aria-label="Тип операции">
          {Object.entries(TX_KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="Сумма, ₽" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Сумма" required />
        <input className="input" style={{ width: 150 }} list="fin-cats" placeholder="Категория" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория" />
        <datalist id="fin-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input className="input" type="date" style={{ width: 150 }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата операции" />
      </div>
      <div className="inline-form">
        <input className="input grow" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Описание" />
        <input className="input grow" placeholder="Связь: проект, контакт…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Связь" />
        <button className="btn primary small" type="submit" disabled={add.isPending || !amount.trim()}>
          <Plus size={14} /> Записать
        </button>
      </div>
    </form>
  );
}

function Operations({ d }: { d: FinanceData }) {
  const [kind, setKind] = useState('all');
  const [cat, setCat] = useState('all');
  const list = useMemo(() => d.transactions.filter((t) => (kind === 'all' || t.kind === kind) && (cat === 'all' || t.category === cat)), [d, kind, cat]);
  const cats = [...new Set(d.transactions.map((t) => t.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title" style={{ marginBottom: 10 }}>Новая операция</h2>
        <AddTransaction d={d} />
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Операции месяца</h2>
          <div className="inline-form">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Фильтр по типу">
              <option value="all">Все типы</option>
              {Object.entries(TX_KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Фильтр по категории">
              <option value="all">Все категории</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        {list.length === 0 ? (
          <Empty title={d.transactions.length ? 'Нет операций по фильтру' : 'Операций в этом месяце нет'}>Добавьте первую операцию в форме выше.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Связь</th>
                  <th className="r">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={`${t.path}:${t.line}`}>
                    <td className="small">{fmtDate(t.date)}</td>
                    <td>
                      {t.category}
                      {t.kind === 'saving' && <span className="chip" style={{ marginLeft: 6 }}>накопления</span>}
                    </td>
                    <td>{t.description}</td>
                    <td className="small">{t.link ? t.link.path ? <Link to={entityHref(typeOfLink(t.link.path, d), t.link.path)}>{t.link.title}</Link> : t.link.title : ''}</td>
                    <td className="r">
                      <Money value={t.amount} sign={t.kind === 'income' ? 'plus' : 'minus'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="small muted" style={{ marginTop: 10 }}>
          Исправить или удалить операцию можно в заметке месяца:{' '}
          {[...new Set(list.map((t) => t.path))].map((p) => (
            <Link key={p} to={noteHref(p)} style={{ marginRight: 8 }}>
              {p}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Тип заметки по пути — для ссылки в нужный раздел. */
function typeOfLink(path: string, d: FinanceData): string {
  if (d.subscriptions.some((s) => s.path === path)) return 'subscription';
  if (d.debts.some((s) => s.path === path)) return 'debt';
  if (d.savings.some((s) => s.path === path)) return 'savings';
  if (d.payments.some((s) => s.path === path)) return 'payment';
  if (d.projects.some((s) => s.path === path)) return 'project';
  return 'note';
}

function Regular({ d, onCreate }: { d: FinanceData; onCreate: (t: Creating) => void }) {
  const pay = useAct('/api/finance/pay', 'Оплата записана в операции');
  return (
    <div className="grid cols-2">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Подписки</h2>
          <span className="card-sub">≈ {rub(d.subscriptionsMonthly)} в месяц</span>
          <button className="btn small" onClick={() => onCreate('subscription')}>
            <Plus size={14} /> Подписка
          </button>
        </div>
        {d.subscriptions.length === 0 ? (
          <Empty title="Подписок нет" />
        ) : (
          <ul className="list">
            {d.subscriptions.map((s) => (
              <li key={s.path}>
                <div className="li">
                  <span className="type-dot subscription" />
                  <Link to={entityHref('subscription', s.path)} className="li-main">
                    <div className="li-title">{s.title}</div>
                    <div className="li-sub">
                      {PERIOD_LABEL[s.period]} · {s.category}
                      {s.nextPayment && s.status === 'active' ? ` · списание ${relDate(s.nextPayment, d.today)}` : ''}
                    </div>
                  </Link>
                  {s.status !== 'active' && <span className="chip">{SUB_STATUS_LABEL[s.status]}</span>}
                  <Money value={s.amount} />
                  {s.status === 'active' && (
                    <button className="btn small" onClick={() => pay.mutate({ path: s.path })} disabled={pay.isPending}>
                      Оплачено
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Обязательные платежи</h2>
          <button className="btn small" onClick={() => onCreate('payment')}>
            <Plus size={14} /> Платёж
          </button>
        </div>
        {d.payments.length === 0 ? (
          <Empty title="Платежей нет">Платёж — заметка type: payment с датой и суммой: аренда, налоги, коммунальные.</Empty>
        ) : (
          <ul className="list">
            {d.payments.map((p) => (
              <li key={p.path}>
                <div className="li">
                  <span className="type-dot payment" />
                  <Link to={entityHref('payment', p.path)} className="li-main">
                    <div className="li-title">{p.title}</div>
                    <div className="li-sub" style={{ color: p.overdue ? 'var(--red)' : undefined }}>
                      {RECURRENCE_LABEL[p.recurrence]}
                      {p.date ? ` · ${relDate(p.date, d.today)}` : ''}
                      {p.category ? ` · ${p.category}` : ''}
                    </div>
                  </Link>
                  <span className={`chip ${p.status === 'paid' ? 'green' : p.overdue ? 'red' : ''}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                  <Money value={p.amount} />
                  {p.status === 'planned' && (
                    <button className="btn small" onClick={() => pay.mutate({ path: p.path })} disabled={pay.isPending || !p.amount}>
                      Оплачено
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AmountAction({ label, onSubmit, pending, placeholder }: { label: string; onSubmit: (amount: string) => void; pending: boolean; placeholder?: string }) {
  const [v, setV] = useState('');
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v);
        setV('');
      }}
    >
      <input className="input" style={{ width: 110 }} inputMode="decimal" placeholder={placeholder ?? 'Сумма'} value={v} onChange={(e) => setV(e.target.value)} aria-label={`${label}: сумма`} />
      <button className="btn small" type="submit" disabled={pending || !v.trim()}>
        {label}
      </button>
    </form>
  );
}

function DebtsAndSavings({ d, onCreate }: { d: FinanceData; onCreate: (t: Creating) => void }) {
  const debt = useAct('/api/finance/debt-payment', 'Платёж по долгу записан');
  const contribute = useAct('/api/finance/contribute', 'Накопления пополнены');
  return (
    <div className="grid cols-2">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Долги</h2>
          <button className="btn small" onClick={() => onCreate('debt')}>
            <Plus size={14} /> Долг
          </button>
        </div>
        {d.debts.length === 0 ? (
          <Empty title="Долгов нет" />
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {d.debts.map((x: DebtDTO) => (
              <div key={x.path} className="stat" style={{ display: 'grid', gap: 8 }}>
                <div className="row">
                  <Link to={entityHref('debt', x.path)} style={{ flex: 1 }}>
                    <strong>{x.title}</strong>
                  </Link>
                  <span className={`chip ${x.status === 'closed' ? 'green' : x.overdue ? 'red' : ''}`}>{x.status === 'closed' ? 'Закрыт' : DEBT_DIRECTION_LABEL[x.direction]}</span>
                </div>
                <Progress value={x.paidPercent} tone="green" />
                <div className="small muted">
                  Осталось {rub(x.remaining)}
                  {x.amount ? ` из ${rub(x.amount)}` : ''}
                  {x.nextPayment && x.status === 'active' ? ` · платёж ${rub(x.monthlyPayment)} ${relDate(x.nextPayment, d.today)}` : ''}
                  {x.due ? ` · до ${fmtDate(x.due)}` : ''}
                  {x.counterparty ? ` · ${x.counterparty.title}` : ''}
                </div>
                {x.status === 'active' && (
                  <AmountAction
                    label={x.direction === 'i_owe' ? 'Погасить' : 'Получено'}
                    placeholder={x.monthlyPayment ? String(x.monthlyPayment) : 'Сумма'}
                    pending={debt.isPending}
                    onSubmit={(amount) => debt.mutate({ path: x.path, amount })}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">
            <PiggyBank size={16} /> Накопления и финансовые цели
          </h2>
          <button className="btn small" onClick={() => onCreate('savings')}>
            <Plus size={14} /> Цель
          </button>
        </div>
        {d.savings.length === 0 ? (
          <Empty title="Накоплений пока нет">Подушка безопасности, крупная покупка или финансовая цель.</Empty>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {d.savings.map((s: SavingsDTO) => (
              <div key={s.path} className="stat" style={{ display: 'grid', gap: 8 }}>
                <div className="row">
                  <Link to={entityHref('savings', s.path)} style={{ flex: 1 }}>
                    <strong>{s.title}</strong>
                  </Link>
                  <span className="chip">{SAVINGS_KIND_LABEL[s.kind]}</span>
                </div>
                <Progress value={s.progress} tone="green" />
                <div className="small muted">
                  {rub(s.current)}
                  {s.target ? ` из ${rub(s.target)} · ${s.progress}%` : ''}
                  {s.deadline ? ` · к ${fmtDate(s.deadline)} ${s.deadline.slice(0, 4)}` : ''}
                  {s.neededPerMonth ? ` · нужно ${rub(s.neededPerMonth)} в месяц` : ''}
                  {s.goal ? (
                    <>
                      {' · цель: '}
                      {s.goal.path ? <Link to={noteHref(s.goal.path)}>{s.goal.title}</Link> : s.goal.title}
                    </>
                  ) : null}
                </div>
                {s.status === 'active' && (
                  <AmountAction label="Пополнить" placeholder={s.monthly ? String(s.monthly) : 'Сумма'} pending={contribute.isPending} onSubmit={(amount) => contribute.mutate({ path: s.path, amount })} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateFinance({ type, onClose }: { type: Exclude<Creating, null>; onClose: () => void }) {
  const cfg = {
    subscription: { heading: 'Новая подписка', defs: SUBSCRIPTION_FIELDS, initial: { period: 'monthly', status: 'active', category: 'Подписки' } },
    payment: { heading: 'Новый обязательный платёж', defs: PAYMENT_FIELDS, initial: { recurrence: 'monthly', status: 'planned' } },
    debt: { heading: 'Новый долг', defs: DEBT_FIELDS, initial: { direction: 'i_owe', status: 'active' } },
    savings: { heading: 'Новая цель накоплений', defs: SAVINGS_FIELDS, initial: { kind: 'goal', status: 'active' } },
  }[type];
  return <CreateEntityModal type={type} heading={cfg.heading} defs={cfg.defs} initial={cfg.initial} textLabel="Заметки" folderHint="Заметка в папке «Финансы»" onClose={onClose} />;
}

function BudgetModal({ d, onClose }: { d: FinanceData; onClose: () => void }) {
  const [income, setIncome] = useState(d.budget.income !== null ? String(d.budget.income) : '');
  const [rows, setRows] = useState(d.budget.limits.length ? d.budget.limits.map((l) => ({ category: l.category, limit: String(l.limit) })) : [{ category: '', limit: '' }]);
  const save = useAct('/api/finance/budget', 'Бюджет сохранён в заметку', 'put');
  return (
    <Modal onClose={onClose} label="Бюджет">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ income: income.trim() || null, limits: rows.filter((r) => r.category.trim()) }, { onSuccess: onClose });
        }}
      >
        <div className="modal-head">
          <strong>Бюджет на месяц</strong>
        </div>
        <div className="modal-body" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <label className="field">
            План дохода, ₽
            <input className="input" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} />
          </label>
          <div className="small muted">Лимиты расходов по категориям</div>
          {rows.map((r, i) => (
            <div key={i} className="inline-form">
              <input className="input grow" list="budget-cats" placeholder="Категория" value={r.category} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} aria-label="Категория" />
              <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="Лимит" value={r.limit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, limit: e.target.value } : x)))} aria-label="Лимит" />
              <button type="button" className="btn small icon ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Убрать строку">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <datalist id="budget-cats">
            {d.expenseCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button type="button" className="btn small" onClick={() => setRows([...rows, { category: '', limit: '' }])}>
            <Plus size={14} /> Категория
          </button>
          {save.isError && <div className="error-box">{(save.error as Error).message}</div>}
        </div>
        <div className="modal-foot">
          <span className="small muted">Таблица «Лимиты» в заметке «Бюджет»</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            <Save size={14} /> Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
