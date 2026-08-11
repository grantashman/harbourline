import type { Session } from "@supabase/supabase-js";
import type { HouseholdSummary } from "@harbourline/sync";
import type { HarbourlineCloud } from "./cloud";
import type {
  BetaOnboardingProgress,
  BetaOnboardingStep
} from "./beta-types";
import type { HarbourlineLocalBridge } from "./release2-types";

type GuidedStep = Exclude<BetaOnboardingStep, "complete">;

export interface OnboardingDependencies {
  bridge: HarbourlineLocalBridge;
  cloud: Pick<HarbourlineCloud, "getBetaOnboarding" | "saveBetaProgress" | "recordBetaEvent">;
  createHousehold(name: string, currency: string): Promise<string>;
  linkHousehold(householdId: string): Promise<boolean>;
}

interface OnboardingContext {
  session: Session | null;
  subscriptionActive: boolean;
  households: HouseholdSummary[];
}

const STEP_LABELS: Record<GuidedStep, string> = {
  household: "Household",
  income: "Income",
  bills: "Bills",
  payday: "Payday"
};

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
  if (!value || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

export class OnboardingFlow {
  private overlay: HTMLElement | null = null;
  private context: OnboardingContext | null = null;
  private progress: BetaOnboardingProgress | null = null;
  private step: GuidedStep = "household";
  private notice = "";
  private busy = false;
  private startedForUser: string | null = null;
  private fiveBillsRecorded = false;
  private refreshGeneration = 0;
  private interactionGeneration = 0;

  constructor(private readonly dependencies: OnboardingDependencies) {}

  async refresh(context: OnboardingContext): Promise<void> {
    const previousUserId = this.context?.session?.user.id ?? null;
    if (previousUserId !== context.session?.user.id) this.interactionGeneration += 1;
    const refreshGeneration = ++this.refreshGeneration;
    this.context = context;
    if (!context.session || !context.subscriptionActive) {
      this.dispose();
      return;
    }

    if (this.startedForUser !== context.session.user.id) {
      this.startedForUser = context.session.user.id;
      this.fiveBillsRecorded = false;
    }

    const progress = await this.dependencies.cloud.getBetaOnboarding();
    if (refreshGeneration !== this.refreshGeneration) return;
    this.progress = progress;
    if (progress?.step === "complete" || (!progress && context.households.length > 0)) {
      this.dispose();
      return;
    }

    this.step = progress?.step ?? "household";
    if (!this.overlay) {
      const interactionGeneration = this.interactionGeneration;
      await this.dependencies.cloud.recordBetaEvent("onboarding_started", progress?.householdId ?? null).catch(() => undefined);
      if (
        refreshGeneration !== this.refreshGeneration ||
        interactionGeneration !== this.interactionGeneration
      ) return;
    }
    this.render();
  }

  dispose(): void {
    this.refreshGeneration += 1;
    this.interactionGeneration += 1;
    this.overlay?.remove();
    this.overlay = null;
    this.context = null;
    this.busy = false;
  }

  private ensureActive(expectedGeneration = this.interactionGeneration): void {
    if (
      expectedGeneration !== this.interactionGeneration ||
      !this.overlay ||
      !this.context?.session ||
      !this.context.subscriptionActive
    ) {
      throw new Error("Household onboarding is no longer active.");
    }
  }

  private render(): void {
    if (!this.overlay) {
      this.overlay = document.createElement("section");
      this.overlay.className = "release2-onboarding";
      this.overlay.setAttribute("role", "dialog");
      this.overlay.setAttribute("aria-modal", "true");
      this.overlay.setAttribute("aria-labelledby", "release2OnboardingTitle");
      this.overlay.addEventListener("submit", (event) => void this.handleSubmit(event));
      this.overlay.addEventListener("click", (event) => this.handleClick(event));
      document.body.append(this.overlay);
    }

    const stepIndex = Object.keys(STEP_LABELS).indexOf(this.step);
    const steps = Object.entries(STEP_LABELS)
      .map(([key, label], index) => `<li class="${index <= stepIndex ? "is-current" : ""}"><span>${index + 1}</span>${label}</li>`)
      .join("");

    this.overlay.innerHTML = `
      <div class="release2-onboarding-shell">
        <p class="eyebrow">Paid early access</p>
        <h1 id="release2OnboardingTitle">Build your first household plan.</h1>
        <p class="release2-onboarding-lede">A few details will turn Harbourline into a useful payday plan. You can keep refining everything in the full workspace afterwards.</p>
        <ol class="release2-onboarding-progress" aria-label="Onboarding progress">${steps}</ol>
        ${this.notice ? `<div class="release2-notice" role="status">${escapeHtml(this.notice)}</div>` : ""}
        ${this.renderStep()}
      </div>
    `;
  }

  private renderStep(): string {
    const disabled = this.busy ? "disabled" : "";
    if (this.step === "household") {
      return `
        <form class="release2-onboarding-form" data-onboarding-form="household">
          <label>Household name<input name="name" maxlength="80" placeholder="Our household" required ${disabled} /></label>
          <p>Use a shared name such as “Alex and Sam” or “The Smith household”.</p>
          <button class="btn" type="submit" ${disabled}>Create household</button>
        </form>
      `;
    }

    if (this.step === "income") {
      return `
        <form class="release2-onboarding-form" data-onboarding-form="income">
          <label>Income name<input name="label" maxlength="40" placeholder="Primary income" required ${disabled} /></label>
          <div class="release2-onboarding-fields">
            <label>Amount<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required ${disabled} /></label>
            <label>Frequency<select name="frequency" ${disabled}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option></select></label>
          </div>
          <label>Next pay date<input name="nextPayDate" type="date" ${disabled} /></label>
          <p>Use your normal take-home amount. You can add other income sources later.</p>
          <button class="btn" type="submit" ${disabled}>Save income</button>
        </form>
      `;
    }

    if (this.step === "bills") {
      return `
        <form class="release2-onboarding-form" data-onboarding-form="bills">
          <label>Bill or regular expense<input name="name" maxlength="60" placeholder="Rent, electricity, groceries" required ${disabled} /></label>
          <div class="release2-onboarding-fields">
            <label>Amount<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required ${disabled} /></label>
            <label>Frequency<select name="frequency" ${disabled}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="sixMonthly">Six monthly</option><option value="yearly">Yearly</option></select></label>
          </div>
          <div class="release2-onboarding-fields">
            <label>Category<select name="category" ${disabled}><option>Housing</option><option>Utilities</option><option>Food</option><option>Transport</option><option>Insurance</option><option>Debt</option><option>Subscriptions</option><option>Health</option><option>Lifestyle</option><option>Savings</option><option>Other</option></select></label>
            <label>Next due date<input name="due" type="date" ${disabled} /></label>
          </div>
          <p>Add one bill at a time. One is enough to continue, while five gives you a more useful first forecast.</p>
          <div class="release2-button-row">
            <button class="btn" type="submit" ${disabled}>Add bill</button>
            <button class="btn secondary" type="button" data-onboarding-action="payday" ${disabled}>Continue to payday</button>
          </div>
        </form>
      `;
    }

    return `
      <div class="release2-onboarding-form">
        <h2>Your payday plan is ready to explore.</h2>
        <p>Open the payday command centre to see what to set aside before your next pay arrives.</p>
        <button class="btn" type="button" data-onboarding-action="payday" ${disabled}>Open payday plan</button>
      </div>
    `;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>("[data-onboarding-action]")?.dataset.onboardingAction;
    if (action === "payday" && !this.busy) void this.advanceToPayday();
  }

  private async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || this.busy || !this.context) return;

    this.busy = true;
    this.notice = "";
    this.render();
    const operationGeneration = this.interactionGeneration;
    try {
      this.ensureActive(operationGeneration);
      const action = form.dataset.onboardingForm;
      if (action === "household") await this.saveHousehold(form, operationGeneration);
      else if (action === "income") await this.saveIncome(form, operationGeneration);
      else if (action === "bills") await this.saveBill(form, operationGeneration);
      if (
        operationGeneration !== this.interactionGeneration ||
        !this.overlay ||
        !this.context?.subscriptionActive
      ) return;
      await this.refresh(this.context);
    } catch (error) {
      if (
        operationGeneration === this.interactionGeneration &&
        this.overlay &&
        this.context?.subscriptionActive
      ) {
        this.notice = error instanceof Error ? error.message : "This step could not be saved.";
        this.render();
      }
    } finally {
      if (operationGeneration !== this.interactionGeneration) return;
      this.busy = false;
      if (this.overlay) this.render();
    }
  }

  private async saveHousehold(form: HTMLFormElement, operationGeneration: number): Promise<void> {
    this.ensureActive(operationGeneration);
    const name = formValue(form, "name");
    if (!name) throw new Error("Enter a household name.");
    const localState = this.dependencies.bridge.read();
    const source = localState && typeof localState === "object" ? localState as { currency?: unknown; household?: { currency?: unknown } } : {};
    const currency = String(source.currency ?? source.household?.currency ?? "AUD").trim().toUpperCase();
    const householdId = await this.dependencies.createHousehold(name, currency);
    this.ensureActive(operationGeneration);
    const linked = await this.dependencies.linkHousehold(householdId);
    if (!linked) throw new Error("The household could not be connected while access was changing.");
    this.ensureActive(operationGeneration);
    await this.dependencies.cloud.saveBetaProgress({ householdId, step: "income" });
    this.ensureActive(operationGeneration);
    await this.dependencies.cloud.recordBetaEvent("household_created", householdId);
  }

  private async saveIncome(form: HTMLFormElement, operationGeneration: number): Promise<void> {
    this.ensureActive(operationGeneration);
    const amount = Math.max(Number(formValue(form, "amount")) || 0, 0);
    const nextState = cloneState(this.dependencies.bridge.read());
    const incomes = Array.isArray(nextState.incomes) ? [...nextState.incomes] : [];
    incomes[0] = {
      ...(incomes[0] ?? { id: `income-${crypto.randomUUID()}` }),
      label: formValue(form, "label") || "Primary income",
      amount,
      frequency: formValue(form, "frequency") || "monthly",
      nextPayDate: formValue(form, "nextPayDate")
    };
    nextState.incomes = incomes;
    this.dependencies.bridge.replace(nextState, "onboarding");

    const householdId = this.progress?.householdId ?? this.context?.households[0]?.id ?? null;
    this.ensureActive(operationGeneration);
    await this.dependencies.cloud.saveBetaProgress({ householdId, step: "bills" });
    if (amount > 0) {
      this.ensureActive(operationGeneration);
      await this.dependencies.cloud.recordBetaEvent("income_added", householdId);
    }
  }

  private async saveBill(form: HTMLFormElement, operationGeneration: number): Promise<void> {
    this.ensureActive(operationGeneration);
    const name = formValue(form, "name");
    const amount = Math.max(Number(formValue(form, "amount")) || 0, 0);
    if (!name || !amount) throw new Error("Enter a bill name and amount.");

    const nextState = cloneState(this.dependencies.bridge.read());
    const expenses = Array.isArray(nextState.expenses) ? [...nextState.expenses] : [];
    const nextExpenses = [
      ...expenses,
      {
        id: `expense-${crypto.randomUUID()}`,
        name,
        category: formValue(form, "category") || "Other",
        amount,
        frequency: formValue(form, "frequency") || "monthly",
        due: formValue(form, "due"),
        reservedAmount: 0,
        debtBalance: 0,
        interestRate: 0
      }
    ];
    nextState.expenses = nextExpenses;
    this.dependencies.bridge.replace(nextState, "onboarding");

    const householdId = this.progress?.householdId ?? this.context?.households[0]?.id ?? null;
    this.ensureActive(operationGeneration);
    await this.dependencies.cloud.saveBetaProgress({ householdId, step: "bills" });
    if (!this.fiveBillsRecorded && expenses.length < 5 && nextExpenses.length >= 5) {
      this.fiveBillsRecorded = true;
      this.ensureActive(operationGeneration);
      await this.dependencies.cloud.recordBetaEvent("five_bills_added", householdId);
    }
  }

  private async advanceToPayday(): Promise<void> {
    if (!this.context || !this.overlay || !this.context.subscriptionActive || this.busy) return;
    this.busy = true;
    this.notice = "";
    this.render();
    const operationGeneration = this.interactionGeneration;
    try {
      this.ensureActive(operationGeneration);
      const householdId = this.progress?.householdId ?? this.context.households[0]?.id ?? null;
      this.dependencies.bridge.openWorkspace("payday");
      this.ensureActive(operationGeneration);
      await this.dependencies.cloud.recordBetaEvent("payday_viewed", householdId);
      this.ensureActive(operationGeneration);
      await this.dependencies.cloud.saveBetaProgress({ householdId, step: "complete" });
      this.ensureActive(operationGeneration);
      await this.dependencies.cloud.recordBetaEvent("onboarding_completed", householdId);
      this.dispose();
    } catch (error) {
      if (
        operationGeneration === this.interactionGeneration &&
        this.overlay &&
        this.context?.subscriptionActive
      ) {
        this.notice = error instanceof Error ? error.message : "The payday plan could not be opened.";
        this.render();
      }
    } finally {
      if (operationGeneration !== this.interactionGeneration) return;
      this.busy = false;
    }
  }
}
