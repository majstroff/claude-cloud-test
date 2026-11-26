import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, FolderKanban, Plus, Refrigerator, ShoppingCart, Sparkles } from 'lucide-react';
import { api, type HomeData, type TaskDTO } from '../api.ts';
import { CreateEntityModal } from '../components/Entities.tsx';
import { Money, NewRoutineButton, RoutineList, useAct } from '../components/Spheres.tsx';
import { TaskList } from '../components/TaskList.tsx';
import { Empty, ErrorBox, Loading, Progress, fmtDate, noteHref, relDate } from '../components/ui.tsx';
import { APPLIANCE_FIELDS, APPLIANCE_STATUS_LABEL, entityHref } from '../entities.ts';

export function HouseholdPage() {
  const q = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/api/home') });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  if (q.isPending) return <div className="card"><Loading rows={6} /></div>;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="grid cols-3">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Sparkles size={16} /> Уборка и регулярные дела
            </h2>
            <NewRoutineButton sphere="home" />
          </div>
          <RoutineList routines={d.routines} today={d.today} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Бытовые дела</h2>
            <span className="card-sub">задачи из папки «Дом» и с тегом #дом</span>
          </div>
          {d.chores.length === 0 ? <Empty title="Бытовых дел нет" /> : <TaskList tasks={d.chores} today={d.today} />}
          <AddLine url="/api/home/chores" placeholder="Например: повесить полку" ok="Дело добавлено в «Бытовые дела»" withDate />
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Refrigerator size={16} /> Техника и гарантии
            </h2>
            <button className="btn small primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Техника
            </button>
          </div>
          {d.appliances.length === 0 ? (
            <Empty title="Техники пока нет">Добавьте холодильник, стиральную машину, ноутбук — с датой покупки и сроком гарантии.</Empty>
          ) : (
            <ul className="list">
              {d.appliances.map((a) => (
                <li key={a.path}>
                  <Link to={entityHref('appliance', a.path)}>
                    <span className="type-dot appliance" />
                    <span className="li-main">
                      <div className="li-title">{a.title}</div>
                      <div className="li-sub">
                        {[a.room, a.purchased ? `куплено ${fmtDate(a.purchased)} ${a.purchased.slice(0, 4)}` : null, a.lastService ? `обслуживание ${fmtDate(a.lastService)}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </span>
                    {a.status !== 'in_use' && <span className="chip">{APPLIANCE_STATUS_LABEL[a.status]}</span>}
                    <span className={`chip ${a.warrantyState === 'expiring' ? 'amber' : a.warrantyState === 'active' ? 'green' : ''}`}>
                      {a.warrantyState === 'none'
                        ? 'без гарантии'
                        : a.warrantyState === 'expired'
                          ? 'гарантия закончилась'
                          : `гарантия до ${fmtDate(a.warrantyUntil!)}${a.warrantyState === 'expiring' ? ` · ${a.warrantyDaysLeft} дн.` : ` ${a.warrantyUntil!.slice(0, 4)}`}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="stack">
        <ShoppingCard d={d} />
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Счета</h2>
            <Link to="/finance?tab=regular" className="btn small ghost">
              В финансах
            </Link>
          </div>
          {d.bills.length === 0 && d.billSubscriptions.length === 0 ? (
            <Empty title="Счетов нет">Платежи с категориями «Жильё», «Коммунальные», «Интернет» появятся здесь.</Empty>
          ) : (
            <ul className="list">
              {d.bills.map((b) => (
                <li key={b.path}>
                  <Link to={entityHref('payment', b.path)}>
                    <span className="type-dot payment" />
                    <span className="li-main">
                      <div className="li-title">{b.title}</div>
                      <div className="li-sub" style={{ color: b.overdue ? 'var(--red)' : undefined }}>{b.date ? relDate(b.date, d.today) : 'без даты'}</div>
                    </span>
                    <Money value={b.amount} />
                  </Link>
                </li>
              ))}
              {d.billSubscriptions.map((s) => (
                <li key={s.path}>
                  <Link to={entityHref('subscription', s.path)}>
                    <span className="type-dot subscription" />
                    <span className="li-main">
                      <div className="li-title">{s.title}</div>
                      <div className="li-sub">{s.nextPayment ? `списание ${relDate(s.nextPayment, d.today)}` : 'регулярно'}</div>
                    </span>
                    <Money value={s.amount} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>
            <FolderKanban size={16} /> Ремонт и проекты по дому
          </h2>
          {d.projects.length === 0 ? (
            <Empty title="Проектов нет">Проект со сферой «Дом» (area: Дом) появится здесь.</Empty>
          ) : (
            <ul className="list">
              {d.projects.map((p) => (
                <li key={p.path}>
                  <Link to={entityHref('project', p.path)}>
                    <span className="type-dot project" />
                    <span className="li-main">
                      <div className="li-title">{p.title}</div>
                      <Progress value={p.progress} tone="blue" />
                    </span>
                    <span className="small muted">{p.nextStep ? `→ ${p.nextStep}` : `${p.progress}%`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {creating && (
        <CreateEntityModal
          type="appliance"
          heading="Новая техника"
          defs={APPLIANCE_FIELDS}
          initial={{ status: 'in_use' }}
          textLabel="Заметки"
          folderHint="Заметка в «Дом/Техника»"
          onClose={() => setCreating(false)}
          onCreated={(p) => nav(entityHref('appliance', p))}
        />
      )}
    </div>
  );
}

function ShoppingCard({ d }: { d: HomeData }) {
  const open = d.shopping.items.filter((t) => t.status !== 'done');
  const bought = d.shopping.items.filter((t) => t.status === 'done');
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <ShoppingCart size={16} /> Покупки
        </h2>
        {d.shopping.path && (
          <Link to={noteHref(d.shopping.path)} className="card-sub">
            заметка
          </Link>
        )}
      </div>
      {open.length === 0 ? (
        <Empty title="Список пуст" />
      ) : (
        <ul className="list">
          {open.map((t) => (
            <li key={t.id}>
              <BuyLine task={t} />
            </li>
          ))}
        </ul>
      )}
      <AddLine url="/api/home/shopping" placeholder="Что купить" ok="Добавлено в список покупок" />
      {bought.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '14px 8px 4px' }}>Куплено недавно</div>
          <ul className="stack small muted" style={{ gap: 2, margin: 0, paddingLeft: 26 }}>
            {bought.map((t) => (
              <li key={t.id} style={{ textDecoration: 'line-through' }}>
                {t.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BuyLine({ task }: { task: TaskDTO }) {
  const [amount, setAmount] = useState('');
  const buy = useAct('/api/home/buy', (r: { transaction: unknown }) => (r.transaction ? 'Куплено, расход записан в финансы' : 'Отмечено как купленное'));
  return (
    <form
      className="li"
      onSubmit={(e) => {
        e.preventDefault();
        buy.mutate({ path: task.path, line: task.line, raw: task.raw, amount: amount.trim() || null });
      }}
    >
      <span className="li-main">
        <div className="li-title">{task.title}</div>
        {task.due && <div className="li-sub">к {fmtDate(task.due)}</div>}
      </span>
      <input className="input" style={{ width: 96, height: 30 }} inputMode="decimal" placeholder="₽" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Цена: ${task.title}`} title="Если указать цену, расход попадёт в «Финансы»" />
      <button className="btn small" type="submit" disabled={buy.isPending} aria-label={`Куплено: ${task.title}`}>
        <Check size={14} /> Куплено
      </button>
    </form>
  );
}

function AddLine({ url, placeholder, ok, withDate }: { url: string; placeholder: string; ok: string; withDate?: boolean }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const add = useAct(url, ok);
  return (
    <form
      className="inline-form"
      style={{ marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim())
          add.mutate(
            { text, due: due || null },
            {
              onSuccess: () => {
                setText('');
                setDue('');
              },
            },
          );
      }}
    >
      <input className="input grow" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label={placeholder} />
      {withDate && <input className="input" type="date" style={{ width: 150 }} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Срок" />}
      <button className="btn small" type="submit" disabled={add.isPending || !text.trim()}>
        <Plus size={14} /> Добавить
      </button>
    </form>
  );
}
