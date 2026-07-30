import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Car,
  Check,
  CircleEllipsis,
  CreditCard,
  Edit3,
  HeartPulse,
  Home,
  LayoutDashboard,
  Moon,
  PiggyBank,
  Plus,
  RefreshCcw,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Sun,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  Zap
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  calculateBudgetSummary,
  calculateCategoryTotals,
  createDefaultBudgetState,
  formatAud,
  monthlyAmount,
  projectSavings,
  weeklyAmount
} from "@harbourline/domain";
import type {
  BudgetState,
  Expense,
  Frequency,
  IncomeSource
} from "@harbourline/domain";
import {
  downloadBudget,
  importBudgetFile,
  loadBudget,
  readLegacyBudget,
  saveBudget
} from "./storage";

type View = "overview" | "income" | "expenses";
type SaveStatus = "loading" | "saving" | "saved" | "error";

const CATEGORIES = [
  "Housing",
  "Utilities",
  "Food",
  "Transport",
  "Insurance",
  "Debt",
  "Subscriptions",
  "Health",
  "Lifestyle",
  "Savings",
  "Other"
];

const CATEGORY_ICON = {
  Housing: Home,
  Utilities: Zap,
  Food: ShoppingBasket,
  Transport: Car,
  Insurance: ShieldCheck,
  Debt: CreditCard,
  Subscriptions: RefreshCcw,
  Health: HeartPulse,
  Lifestyle: Sparkles,
  Savings: PiggyBank,
  Other: CircleEllipsis
} as const;

const EMPTY_EXPENSE = {
  name: "",
  category: "Housing",
  amount: "",
  frequency: "monthly" as Frequency,
  due: ""
};

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function todayHeading(): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());
}

function Metric({
  label,
  value,
  note,
  tone,
  icon
}: {
  label: string;
  value: string;
  note: string;
  tone: "blue" | "amber" | "mint" | "rose";
  icon: ReactNode;
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="metric-head">
        <span>{label}</span>
        <i aria-hidden="true">{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function App() {
  const [budget, setBudget] = useState<BudgetState>(createDefaultBudgetState);
  const [view, setView] = useState<View>("overview");
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [legacyBudget, setLegacyBudget] = useState<BudgetState | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => (
    localStorage.getItem("harbourline-foundation-theme") === "dark" ? "dark" : "light"
  ));
  const [notice, setNotice] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState(EMPTY_EXPENSE);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadBudget().then((loaded) => {
      if (!active) return;
      setBudget(loaded);
      setLegacyBudget(readLegacyBudget());
      setReady(true);
      setSaveStatus("saved");
    }).catch(() => {
      if (!active) return;
      setReady(true);
      setSaveStatus("error");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("harbourline-foundation-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveBudget(budget)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [budget, ready]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summary = useMemo(() => calculateBudgetSummary(budget), [budget]);
  const categories = useMemo(() => calculateCategoryTotals(budget), [budget]);
  const savings = useMemo(() => projectSavings({
    monthlyIncome: summary.monthlyIncome,
    monthlyExpenses: summary.monthlyExpenses,
    debtExtraPayment: budget.debtPlan.extraPayment,
    allocationPercent: budget.savingsPlan.allocationPercent,
    startingSavings: budget.savingsPlan.startingSavings,
    annualReturnPercent: budget.savingsPlan.annualReturnPercent,
    years: budget.savingsPlan.years
  }), [budget, summary]);

  function updateIncome(id: string, patch: Partial<IncomeSource>) {
    setBudget((current) => ({
      ...current,
      incomes: current.incomes.map((income) => (
        income.id === id ? { ...income, ...patch } : income
      ))
    }));
  }

  function addIncome() {
    setBudget((current) => ({
      ...current,
      incomes: [
        ...current.incomes,
        {
          id: createId("income"),
          label: `Income ${current.incomes.length + 1}`,
          amount: 0,
          frequency: "monthly",
          nextPayDate: ""
        }
      ]
    }));
  }

  function removeIncome(id: string) {
    setBudget((current) => ({
      ...current,
      incomes: current.incomes.filter((income) => income.id !== id)
    }));
  }

  function submitExpense(event: FormEvent) {
    event.preventDefault();
    const name = expenseDraft.name.trim();
    const amount = Math.max(Number(expenseDraft.amount) || 0, 0);
    if (!name || !amount) return;

    setBudget((current) => {
      const expense: Expense = {
        id: editingExpenseId ?? createId("expense"),
        name,
        category: expenseDraft.category,
        amount,
        frequency: expenseDraft.frequency,
        due: expenseDraft.due,
        reservedAmount: editingExpenseId
          ? current.expenses.find((item) => item.id === editingExpenseId)?.reservedAmount ?? 0
          : 0
      };
      return {
        ...current,
        expenses: editingExpenseId
          ? current.expenses.map((item) => item.id === editingExpenseId ? { ...item, ...expense } : item)
          : [...current.expenses, expense]
      };
    });
    setExpenseDraft(EMPTY_EXPENSE);
    setEditingExpenseId(null);
    setNotice(editingExpenseId ? "Expense updated" : "Expense added");
  }

  function editExpense(expense: Expense) {
    setExpenseDraft({
      name: expense.name,
      category: expense.category,
      amount: String(expense.amount),
      frequency: expense.frequency,
      due: expense.due
    });
    setEditingExpenseId(expense.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function removeExpense(id: string) {
    setBudget((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => expense.id !== id)
    }));
    if (editingExpenseId === id) {
      setEditingExpenseId(null);
      setExpenseDraft(EMPTY_EXPENSE);
    }
    setNotice("Expense removed");
  }

  function importLegacy() {
    if (!legacyBudget) return;
    setBudget(legacyBudget);
    setLegacyBudget(null);
    setNotice("Existing browser budget imported");
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await importBudgetFile(file);
      setBudget(imported);
      setNotice("Budget backup imported");
    } catch {
      setNotice("That backup could not be imported");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const activeIncomeNames = budget.incomes
    .filter((income) => income.amount > 0)
    .map((income) => income.label);
  const nextMove = summary.monthlyIncome <= 0
    ? "Add your household income to establish the plan."
    : summary.monthlyShortfall > 0
      ? `Close the ${formatAud(summary.monthlyShortfall)} monthly shortfall.`
      : budget.expenses.length === 0
        ? "Add recurring bills to calculate the weekly provision."
        : `Set aside ${formatAud(summary.weeklyExpenses)} for bills this week.`;
  const maxFlow = Math.max(summary.monthlyIncome, summary.monthlyExpenses, 1);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="./favicon.svg" alt="" aria-hidden="true" />
          <div>
            <span>Household money planning</span>
            <strong>Harbourline</strong>
          </div>
        </div>
        <div className="header-actions">
          <span className={`save-state save-${saveStatus}`}>
            <Check size={14} aria-hidden="true" />
            {saveStatus === "loading"
              ? "Loading"
              : saveStatus === "saving"
                ? "Saving"
                : saveStatus === "error"
                  ? "Save issue"
                  : "Saved locally"}
          </span>
          <button
            className="icon-button"
            type="button"
            title={`Use ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Use ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <button className="button button-secondary header-command" type="button" onClick={() => fileInput.current?.click()}>
            <ArrowUpFromLine size={17} />
            <span>Import</span>
          </button>
          <button className="button button-secondary header-command" type="button" onClick={() => downloadBudget(budget)}>
            <ArrowDownToLine size={17} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {legacyBudget && (
        <aside className="migration-banner">
          <div>
            <strong>Existing Harbourline budget found</strong>
            <span>Review it here without changing the original local copy.</span>
          </div>
          <button className="button button-primary" type="button" onClick={importLegacy}>
            Import budget
          </button>
        </aside>
      )}

      <div className="app-layout">
        <nav className="side-nav" aria-label="Budget views">
          <button className={view === "overview" ? "active" : ""} type="button" onClick={() => setView("overview")}>
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </button>
          <button className={view === "income" ? "active" : ""} type="button" onClick={() => setView("income")}>
            <Users size={19} />
            <span>Income</span>
          </button>
          <button className={view === "expenses" ? "active" : ""} type="button" onClick={() => setView("expenses")}>
            <WalletCards size={19} />
            <span>Expenses</span>
          </button>
        </nav>

        <section className="workspace">
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <span>{todayHeading()}</span>
                  <h1>{budget.household.name}</h1>
                </div>
                <button className="button button-primary" type="button" onClick={() => setView("expenses")}>
                  <Plus size={17} />
                  Add expense
                </button>
              </div>

              <section className="metrics-grid" aria-label="Financial summary">
                <Metric
                  label="Monthly income"
                  value={formatAud(summary.monthlyIncome)}
                  note={activeIncomeNames.length ? activeIncomeNames.join(", ") : "No income added"}
                  tone="blue"
                  icon={<TrendingUp size={18} />}
                />
                <Metric
                  label="Weekly bills provision"
                  value={formatAud(summary.weeklyExpenses)}
                  note={`${budget.expenses.length} recurring item${budget.expenses.length === 1 ? "" : "s"}`}
                  tone="amber"
                  icon={<CalendarDays size={18} />}
                />
                <Metric
                  label={summary.monthlyShortfall > 0 ? "Monthly shortfall" : "Monthly available"}
                  value={formatAud(summary.monthlyShortfall || summary.monthlyRemaining)}
                  note={summary.monthlyShortfall > 0 ? "Income or spending adjustment needed" : `${formatAud(summary.weeklyRemaining)} per average week`}
                  tone={summary.monthlyShortfall > 0 ? "rose" : "mint"}
                  icon={summary.monthlyShortfall > 0 ? <TrendingDown size={18} /> : <PiggyBank size={18} />}
                />
              </section>

              <section className="overview-grid">
                <article className="panel flow-panel">
                  <div className="panel-heading">
                    <div>
                      <span>Monthly position</span>
                      <h2>Money flow</h2>
                    </div>
                    <strong>{percentage(summary.expenseRatio)}</strong>
                  </div>
                  <div className="flow-row">
                    <div><span>Income</span><strong>{formatAud(summary.monthlyIncome)}</strong></div>
                    <div className="flow-track"><i className="flow-income" style={{ width: `${summary.monthlyIncome / maxFlow * 100}%` }} /></div>
                  </div>
                  <div className="flow-row">
                    <div><span>Expenses</span><strong>{formatAud(summary.monthlyExpenses)}</strong></div>
                    <div className="flow-track"><i className="flow-expenses" style={{ width: `${summary.monthlyExpenses / maxFlow * 100}%` }} /></div>
                  </div>
                  <div className="next-move">
                    <span>Next move</span>
                    <strong>{nextMove}</strong>
                  </div>
                </article>

                <article className="panel category-panel">
                  <div className="panel-heading">
                    <div>
                      <span>Expense mix</span>
                      <h2>Largest categories</h2>
                    </div>
                  </div>
                  <div className="category-list">
                    {categories.slice(0, 5).map((category) => {
                      const Icon = CATEGORY_ICON[category.name as keyof typeof CATEGORY_ICON] ?? CircleEllipsis;
                      return (
                        <div className="category-row" key={category.name}>
                          <i><Icon size={17} /></i>
                          <div>
                            <span>{category.name}</span>
                            <div className="category-track"><b style={{ width: `${category.share * 100}%` }} /></div>
                          </div>
                          <strong>{formatAud(category.value)}</strong>
                        </div>
                      );
                    })}
                    {!categories.length && (
                      <button className="empty-action" type="button" onClick={() => setView("expenses")}>
                        Add expenses to see the household spending mix.
                      </button>
                    )}
                  </div>
                </article>

                <article className="panel savings-panel">
                  <div className="panel-heading">
                    <div>
                      <span>{budget.savingsPlan.years}-year view</span>
                      <h2>Savings trajectory</h2>
                    </div>
                    <strong>{formatAud(savings.balance)}</strong>
                  </div>
                  <div className="savings-bars" aria-label="Projected yearly savings balance">
                    {savings.yearly.map((year) => (
                      <i
                        key={year.year}
                        style={{ height: `${Math.max(year.balance / Math.max(savings.balance, 1) * 100, 4)}%` }}
                        title={`Year ${year.year}: ${formatAud(year.balance)}`}
                      />
                    ))}
                  </div>
                  <div className="savings-footer">
                    <span>{formatAud(savings.monthlyContribution)} monthly</span>
                    <span>{formatAud(savings.compoundGrowth)} projected growth</span>
                  </div>
                </article>
              </section>
            </>
          )}

          {view === "income" && (
            <>
              <div className="page-heading">
                <div>
                  <span>Household plan</span>
                  <h1>Income</h1>
                </div>
                <button className="button button-primary" type="button" onClick={addIncome}>
                  <Plus size={17} />
                  Add income
                </button>
              </div>
              <section className="income-grid" aria-label="Income sources">
                {budget.incomes.map((income, index) => (
                  <article className="income-card" key={income.id}>
                    <div className="income-card-heading">
                      <span>Source {index + 1}</span>
                      {budget.incomes.length > 1 && (
                        <button className="icon-button danger-icon" type="button" title="Remove income" aria-label={`Remove ${income.label}`} onClick={() => removeIncome(income.id)}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <label>
                      Name
                      <input value={income.label} maxLength={40} onChange={(event) => updateIncome(income.id, { label: event.target.value })} />
                    </label>
                    <div className="form-grid">
                      <label>
                        Amount
                        <span className="money-input"><i>$</i><input type="number" min="0" step="0.01" value={income.amount || ""} onChange={(event) => updateIncome(income.id, { amount: Math.max(Number(event.target.value) || 0, 0) })} /></span>
                      </label>
                      <label>
                        Frequency
                        <select value={income.frequency} onChange={(event) => updateIncome(income.id, { frequency: event.target.value as Frequency })}>
                          {FREQUENCIES.filter((item) => item !== "once").map((item) => <option key={item} value={item}>{FREQUENCY_LABELS[item]}</option>)}
                        </select>
                      </label>
                    </div>
                    <label>
                      Next pay date
                      <input type="date" value={income.nextPayDate} onChange={(event) => updateIncome(income.id, { nextPayDate: event.target.value })} />
                    </label>
                    <div className="income-equivalent">
                      <span>Monthly equivalent</span>
                      <strong>{formatAud(monthlyAmount(income.amount, income.frequency))}</strong>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}

          {view === "expenses" && (
            <>
              <div className="page-heading">
                <div>
                  <span>Household plan</span>
                  <h1>Expenses</h1>
                </div>
                <strong className="page-total">{formatAud(summary.weeklyExpenses)} weekly</strong>
              </div>

              <form className="expense-form" onSubmit={submitExpense}>
                <div className="form-heading">
                  <div>
                    <span>{editingExpenseId ? "Editing" : "New item"}</span>
                    <h2>{editingExpenseId ? "Update expense" : "Add expense or bill"}</h2>
                  </div>
                  {editingExpenseId && (
                    <button className="button button-secondary" type="button" onClick={() => {
                      setEditingExpenseId(null);
                      setExpenseDraft(EMPTY_EXPENSE);
                    }}>
                      Cancel
                    </button>
                  )}
                </div>
                <div className="expense-form-grid">
                  <label>
                    Name
                    <input required placeholder="Rent, groceries, insurance" value={expenseDraft.name} onChange={(event) => setExpenseDraft((current) => ({ ...current, name: event.target.value }))} />
                  </label>
                  <label>
                    Category
                    <select value={expenseDraft.category} onChange={(event) => setExpenseDraft((current) => ({ ...current, category: event.target.value }))}>
                      {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                    </select>
                  </label>
                  <label>
                    Amount
                    <span className="money-input"><i>$</i><input required type="number" min="0.01" step="0.01" value={expenseDraft.amount} onChange={(event) => setExpenseDraft((current) => ({ ...current, amount: event.target.value }))} /></span>
                  </label>
                  <label>
                    Frequency
                    <select value={expenseDraft.frequency} onChange={(event) => setExpenseDraft((current) => ({ ...current, frequency: event.target.value as Frequency }))}>
                      {FREQUENCIES.map((item) => <option key={item} value={item}>{FREQUENCY_LABELS[item]}</option>)}
                    </select>
                  </label>
                  <label>
                    Due date
                    <input type="date" value={expenseDraft.due} onChange={(event) => setExpenseDraft((current) => ({ ...current, due: event.target.value }))} />
                  </label>
                  <button className="button button-primary form-submit" type="submit">
                    {editingExpenseId ? <Check size={17} /> : <Plus size={17} />}
                    {editingExpenseId ? "Save changes" : "Add expense"}
                  </button>
                </div>
                <p className="conversion-preview">
                  {expenseDraft.amount
                    ? `${formatAud(weeklyAmount(Number(expenseDraft.amount), expenseDraft.frequency))} should be set aside each week.`
                    : "Enter an amount to calculate the weekly provision."}
                </p>
              </form>

              <section className="expense-list" aria-label="Expenses and bills">
                {budget.expenses
                  .slice()
                  .sort((a, b) => monthlyAmount(b.amount, b.frequency) - monthlyAmount(a.amount, a.frequency))
                  .map((expense) => {
                    const Icon = CATEGORY_ICON[expense.category as keyof typeof CATEGORY_ICON] ?? CircleEllipsis;
                    return (
                      <article className="expense-row" key={expense.id}>
                        <i className="expense-icon"><Icon size={19} /></i>
                        <div className="expense-copy">
                          <div><strong>{expense.name}</strong><span>{expense.category}</span></div>
                          <small>{formatAud(expense.amount)} {FREQUENCY_LABELS[expense.frequency].toLowerCase()}{expense.due ? ` | Due ${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${expense.due}T00:00:00`))}` : ""}</small>
                        </div>
                        <div className="expense-values">
                          <strong>{formatAud(monthlyAmount(expense.amount, expense.frequency))}</strong>
                          <span>{formatAud(weeklyAmount(expense.amount, expense.frequency))} weekly</span>
                        </div>
                        <div className="row-actions">
                          <button className="icon-button" type="button" title="Edit expense" aria-label={`Edit ${expense.name}`} onClick={() => editExpense(expense)}>
                            <Edit3 size={16} />
                          </button>
                          <button className="icon-button danger-icon" type="button" title="Remove expense" aria-label={`Remove ${expense.name}`} onClick={() => removeExpense(expense.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                {!budget.expenses.length && (
                  <div className="empty-list">
                    <WalletCards size={28} />
                    <strong>No expenses yet</strong>
                    <span>Add the household's regular bills to establish the weekly provision.</span>
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      </div>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

export default App;

