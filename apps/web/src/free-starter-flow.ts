import { track } from "./analytics";
import {
  canCompleteFreeStarter,
  FREE_STARTER_MIN_EXPENSES,
  getFreeStarterStep,
  type FreeStarterStep
} from "./free-starter-activation";
import type { HarbourlineLocalBridge } from "./release2-types";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function cloneState(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

function positiveExpenseCount(state: Record<string, any>): number {
  return Array.isArray(state.expenses)
    ? state.expenses.filter((expense: any) => Number(expense?.amount) > 0).length
    : 0;
}

function isPositiveIncome(income: any): boolean {
  return Number(income?.amount) > 0 && String(income?.nextPayDate ?? "").trim().length > 0;
}

export class FreeStarterFlow {
  private overlay: HTMLElement | null = null;
  private activeStorageKey: string | null = null;
  private dismissedStorageKey: string | null = null;
  private step: FreeStarterStep = "income";
  private notice = "";
  private busy = false;
  private startedForStorageKey: string | null = null;
  private threeBillsRecordedForStorageKey: string | null = null;

  constructor(private readonly bridge: HarbourlineLocalBridge) {}

  refresh(active: boolean): void {
    if (!active) {
      this.dispose();
      return;
    }

    const storageKey = this.bridge.storageKey;
    if (storageKey !== this.activeStorageKey) {
      this.activeStorageKey = storageKey;
      this.dismissedStorageKey = null;
      this.startedForStorageKey = null;
      this.threeBillsRecordedForStorageKey = null;
    }

    const state = this.bridge.read();
    if (
      this.dismissedStorageKey === storageKey ||
      canCompleteFreeStarter(state && typeof state === "object" ? state : {})
    ) {
      this.dispose();
      return;
    }

    this.step = getFreeStarterStep(state && typeof state === "object" ? state : {});
    if (!this.overlay) {
      if (this.startedForStorageKey !== storageKey) {
        this.startedForStorageKey = storageKey;
        track("free_starter_onboarding_started");
      }
      this.createOverlay();
    }
    this.render();
  }

  dispose(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.busy = false;
    this.notice = "";
  }

  isOpen(): boolean {
    return this.overlay !== null;
  }

  private createOverlay(): void {
    this.overlay = document.createElement("section");
    this.overlay.className = "release2-onboarding release2-free-starter-onboarding";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-labelledby", "freeStarterOnboardingTitle");
    this.overlay.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.overlay.addEventListener("click", (event) => this.handleClick(event));
    document.body.append(this.overlay);
  }

  private render(): void {
    if (!this.overlay) return;
    const state = cloneState(this.bridge.read());
    const stepIndex = ["income", "bills", "payday"].indexOf(this.step);
    const steps = ["Income", "Regular bills", "Payday"]
      .map((label, index) => `<li class="${index <= stepIndex ? "is-current" : ""}"><span>${index + 1}</span>${label}</li>`)
      .join("");

    this.overlay.innerHTML = `
      <div class="release2-onboarding-shell">
        <p class="eyebrow">Getting started</p>
        <h1 id="freeStarterOnboardingTitle">Build your first payday plan.</h1>
        <p class="release2-onboarding-lede">Three simple steps will give Harbourline enough context to show what your next pay needs to cover. You can keep refining the plan in the full workspace afterwards.</p>
        <ol class="release2-onboarding-progress" aria-label="Getting started progress">${steps}</ol>
        ${this.notice ? `<div class="release2-notice" role="status">${escapeHtml(this.notice)}</div>` : ""}
        ${this.renderStep(state)}
      </div>
    `;
  }

  private renderStep(state: Record<string, any>): string {
    const disabled = this.busy ? "disabled" : "";
    if (this.step === "income") {
      const existing = Array.isArray(state.incomes)
        ? state.incomes.find((income: any) => isPositiveIncome(income))
        : null;
      return `
        <form class="release2-onboarding-form" data-free-starter-form="income">
          <label>Income name<input name="label" maxlength="40" placeholder="Primary income" value="${escapeHtml(existing?.label ?? "")}" required ${disabled} /></label>
          <div class="release2-onboarding-fields">
            <label>Amount<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${escapeHtml(existing?.amount ?? "")}" required ${disabled} /></label>
            <label>Frequency<select name="frequency" ${disabled}>
              ${["weekly", "fortnightly", "monthly", "yearly"].map((frequency) => `<option value="${frequency}" ${existing?.frequency === frequency ? "selected" : ""}>${frequency.slice(0, 1).toUpperCase()}${frequency.slice(1)}</option>`).join("")}
            </select></label>
          </div>
          <label>Next pay date<input name="nextPayDate" type="date" value="${escapeHtml(existing?.nextPayDate ?? "")}" required ${disabled} /></label>
          <p>Use your normal take-home amount. You can add other income sources later.</p>
          <div class="release2-button-row">
            <button class="btn" type="submit" ${disabled}>Save income</button>
            <button class="btn secondary" type="button" data-free-starter-action="skip" ${disabled}>Continue to planner</button>
          </div>
        </form>
      `;
    }

    if (this.step === "bills") {
      const count = positiveExpenseCount(state);
      const continueLabel = count >= FREE_STARTER_MIN_EXPENSES ? "Open payday plan" : `Add ${FREE_STARTER_MIN_EXPENSES - count} more commitment${FREE_STARTER_MIN_EXPENSES - count === 1 ? "" : "s"}`;
      return `
        <form class="release2-onboarding-form" data-free-starter-form="bills">
          <label>Bill or regular expense<input name="name" maxlength="60" placeholder="Rent, electricity, groceries" required ${disabled} /></label>
          <div class="release2-onboarding-fields">
            <label>Amount<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required ${disabled} /></label>
            <label>Frequency<select name="frequency" ${disabled}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="sixMonthly">Six monthly</option><option value="yearly">Yearly</option></select></label>
          </div>
          <div class="release2-onboarding-fields">
            <label>Category<select name="category" ${disabled}><option>Housing</option><option>Utilities</option><option>Food</option><option>Transport</option><option>Insurance</option><option>Debt</option><option>Subscriptions</option><option>Health</option><option>Lifestyle</option><option>Savings</option><option>Other</option></select></label>
            <label>Next due date<input name="due" type="date" ${disabled} /></label>
          </div>
          <p>${count} of ${FREE_STARTER_MIN_EXPENSES} useful recurring commitments added. Add the commitments that shape what your next pay needs to cover.</p>
          <div class="release2-button-row">
            <button class="btn" type="submit" ${disabled}>Add commitment</button>
            <button class="btn secondary" type="button" data-free-starter-action="payday" ${count < FREE_STARTER_MIN_EXPENSES || this.busy ? "disabled" : ""}>${continueLabel}</button>
            <button class="btn secondary" type="button" data-free-starter-action="skip" ${disabled}>Continue to planner</button>
          </div>
        </form>
      `;
    }

    return `
      <div class="release2-onboarding-form">
        <h2>Your payday plan is ready to explore.</h2>
        <p>Open the payday command centre to see what to set aside before your next pay arrives.</p>
        <div class="release2-button-row">
          <button class="btn" type="button" data-free-starter-action="payday" ${disabled}>Open payday plan</button>
          <button class="btn secondary" type="button" data-free-starter-action="skip" ${disabled}>Continue to planner</button>
        </div>
      </div>
    `;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>("[data-free-starter-action]")?.dataset.freeStarterAction;
    if (action === "skip") {
      this.dismissedStorageKey = this.activeStorageKey;
      this.dispose();
    } else if (action === "payday" && !this.busy) {
      void this.openPayday();
    }
  }

  private async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || this.busy) return;
    this.busy = true;
    this.notice = "";
    this.render();
    try {
      if (form.dataset.freeStarterForm === "income") this.saveIncome(form);
      if (form.dataset.freeStarterForm === "bills") this.saveBill(form);
      this.refresh(true);
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "This step could not be saved.";
      this.render();
    } finally {
      this.busy = false;
      if (this.overlay) this.render();
    }
  }

  private saveIncome(form: HTMLFormElement): void {
    const amount = Number(formValue(form, "amount"));
    const nextPayDate = formValue(form, "nextPayDate");
    if (!Number.isFinite(amount) || amount <= 0 || !nextPayDate) {
      throw new Error("Enter a positive income amount and your next pay date.");
    }

    const nextState = cloneState(this.bridge.read());
    const incomes = Array.isArray(nextState.incomes) ? [...nextState.incomes] : [];
    const index = incomes.findIndex((income: any) => !isPositiveIncome(income));
    const incomeIndex = index >= 0 ? index : incomes.length;
    incomes[incomeIndex] = {
      ...(incomes[incomeIndex] ?? { id: `income-${crypto.randomUUID()}` }),
      label: formValue(form, "label") || "Primary income",
      amount,
      frequency: formValue(form, "frequency") || "monthly",
      nextPayDate
    };
    nextState.incomes = incomes;
    nextState.paydayPlan = {
      ...(nextState.paydayPlan && typeof nextState.paydayPlan === "object" ? nextState.paydayPlan : {}),
      nextPayday: nextPayDate
    };
    this.bridge.replace(nextState, "free-starter-onboarding");
    track("free_starter_income_added");
  }

  private saveBill(form: HTMLFormElement): void {
    const name = formValue(form, "name");
    const amount = Number(formValue(form, "amount"));
    if (!name || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a commitment name and a positive amount.");
    }

    const nextState = cloneState(this.bridge.read());
    const expenses = Array.isArray(nextState.expenses) ? [...nextState.expenses] : [];
    expenses.push({
      id: `expense-${crypto.randomUUID()}`,
      name,
      category: formValue(form, "category") || "Other",
      amount,
      frequency: formValue(form, "frequency") || "monthly",
      due: formValue(form, "due"),
      reservedAmount: 0,
      debtBalance: 0,
      interestRate: 0
    });
    nextState.expenses = expenses;
    this.bridge.replace(nextState, "free-starter-onboarding");
    track("free_starter_commitment_added");
    if (
      positiveExpenseCount(nextState) >= FREE_STARTER_MIN_EXPENSES &&
      this.threeBillsRecordedForStorageKey !== this.activeStorageKey
    ) {
      this.threeBillsRecordedForStorageKey = this.activeStorageKey;
      track("free_starter_three_commitments_added");
    }
  }

  private async openPayday(): Promise<void> {
    if (this.busy) return;
    const state = this.bridge.read();
    if (!canCompleteFreeStarter(state && typeof state === "object" ? state : {})) {
      this.notice = `Add income and ${FREE_STARTER_MIN_EXPENSES} recurring commitments before opening the payday plan.`;
      this.render();
      return;
    }
    this.busy = true;
    this.render();
    try {
      this.bridge.openWorkspace("payday");
      track("free_starter_activation_completed");
      this.dispose();
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "The payday plan could not be opened.";
      this.busy = false;
      this.render();
    }
  }
}
