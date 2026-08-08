import type { Session } from "@supabase/supabase-js";
import type { HouseholdSummary, RemoteBudgetDocument } from "@harbourline/sync";
import { HarbourlineCloud, type BillingSubscription, type GoogleCalendarStatus } from "./cloud";
import { GoogleCalendarSync } from "./calendar-sync";
import { reportError } from "./monitoring";
import { OnboardingFlow } from "./onboarding-flow";
import { SyncController } from "./sync-controller";
import type {
  AccountState,
  HarbourlineLocalBridge,
  Release2Status
} from "./release2-types";

const INITIAL_STATUS: Release2Status = {
  message: "Sign in and subscribe to enable Harbourline.",
  tone: "neutral",
  queued: 0,
  online: navigator.onLine
};

const SUPPORT_EMAIL = String(import.meta.env.VITE_HARBOURLINE_SUPPORT_EMAIL ?? "").trim();

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function formatBillingDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(date);
}

export class AccountPanel {
  private readonly cloud = new HarbourlineCloud();
  private readonly sync: SyncController;
  private readonly dialog: HTMLDialogElement;
  private readonly newsDialog: HTMLDialogElement;
  private readonly accountButton: HTMLButtonElement;
  private readonly onboarding: OnboardingFlow;
  private state: AccountState;
  private notice = "";
  private busy = false;
  private sessionResolved = false;
  private subscriptionActive: boolean | null = null;
  private billingConfirmationPending = false;
  private billingSubscription: BillingSubscription | null = null;
  private readonly calendarSync: GoogleCalendarSync;
  private googleCalendarStatus: GoogleCalendarStatus = {
    connected: false,
    googleEmail: null,
    calendarId: null,
    lastSyncedAt: null,
    error: null
  };
  private calendarBusy = false;
  private recoveryMode = false;
  private pendingRecoveryRedirect = false;
  private inviteToken = "";
  private mfa: {
    verifiedCount: number;
    currentLevel: string | null;
    nextLevel: string | null;
    enrollment: { factorId: string; qrCode: string; secret: string } | null;
  } = {
    verifiedCount: 0,
    currentLevel: null,
    nextLevel: null,
    enrollment: null
  };

  constructor(private readonly bridge: HarbourlineLocalBridge) {
    this.state = {
      configured: this.cloud.configured,
      session: null,
      user: null,
      households: [],
      metadata: null,
      conflict: null,
      status: INITIAL_STATUS
    };
    this.sync = new SyncController(bridge, this.cloud, {
      status: (status) => {
        this.state.status = status;
        this.render();
      },
      conflict: (conflict) => {
        this.state.conflict = conflict;
        this.render();
      }
    });
    this.onboarding = new OnboardingFlow({
      bridge,
      cloud: this.cloud,
      createHousehold: (name) => this.cloud.createHousehold(name),
      linkHousehold: (householdId) => this.sync.linkDevice(householdId, "device")
    });
    this.calendarSync = new GoogleCalendarSync(bridge, this.cloud);
    this.accountButton = this.createAccountButton();
    this.dialog = this.createDialog();
    this.newsDialog = this.createNewsDialog();
    this.updateAccessGate();
  }

  async initialise(): Promise<void> {
    await this.sync.initialise();
    this.state.metadata = this.sync.metadata;
    const shouldOpenAccount = this.consumeAccountRedirect();
    const billingRedirect = this.consumeBillingRedirect();
    const calendarRedirect = this.consumeCalendarRedirect();
    this.bindCalendarControls();
    this.accountButton.addEventListener("click", () => {
      this.render();
      this.dialog.showModal();
    });
    this.dialog.addEventListener("click", (event) => this.handleClick(event));
    this.dialog.addEventListener("change", (event) => void this.handleCalendarPreferenceChange(event));
    this.dialog.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.newsDialog.addEventListener("click", (event) => this.handleNewsClick(event));

    if (!this.cloud.configured) {
      this.render();
      if (shouldOpenAccount) this.dialog.showModal();
      return;
    }

    this.pendingRecoveryRedirect = this.consumeRecoveryRedirect();
    await this.handleSessionChange(await this.cloud.getSession());
    this.openPendingRecoveryIfReady();
    this.cloud.onAuthChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        this.openRecoveryMode();
      }
      void this.handleSessionChange(session).then(() => {
        this.openPendingRecoveryIfReady();
        void this.refreshAccount();
        if (event === "PASSWORD_RECOVERY" && !this.dialog.open) {
          this.dialog.showModal();
        }
      });
    });
    await this.refreshAccount();
    this.handleBillingRedirect(billingRedirect);
    this.handleCalendarRedirect(calendarRedirect);
    if (billingRedirect || calendarRedirect) {
      if (!this.dialog.open) this.dialog.showModal();
    } else if (shouldOpenAccount && this.state.session) {
      this.newsDialog.showModal();
    } else if (shouldOpenAccount && !this.dialog.open) {
      this.dialog.showModal();
    }
  }

  private consumeAccountRedirect(): boolean {
    const url = new URL(location.href);
    if (url.searchParams.get("account") !== "signin") return false;
    url.searchParams.delete("account");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  private consumeRecoveryRedirect(): boolean {
    const url = new URL(location.href);
    if (url.searchParams.get("recovery") !== "1") return false;
    url.searchParams.delete("recovery");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  private consumeBillingRedirect(): "success" | "cancelled" | "portal" | null {
    const url = new URL(location.href);
    const billing = url.searchParams.get("billing");
    if (billing !== "success" && billing !== "cancelled" && billing !== "portal") return null;
    url.searchParams.delete("billing");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return billing;
  }

  private consumeCalendarRedirect(): "connected" | "error" | null {
    const url = new URL(location.href);
    const calendar = url.searchParams.get("calendar");
    if (calendar !== "connected" && calendar !== "error") return null;
    url.searchParams.delete("calendar");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return calendar;
  }

  private handleBillingRedirect(billing: "success" | "cancelled" | "portal" | null): void {
    if (billing === "cancelled") {
      this.billingConfirmationPending = false;
      this.notice = "Payment was not completed. Your account has not been charged.";
      return;
    }
    if (billing === "portal") {
      this.billingConfirmationPending = false;
      this.notice = "Your billing details have been updated.";
      return;
    }
    if (billing === "success") {
      this.billingConfirmationPending = !this.subscriptionActive;
      this.notice = this.subscriptionActive
        ? "Payment confirmed. Your Harbourline plan is active."
        : "Payment received. We’re confirming your Harbourline plan now.";
      if (!this.subscriptionActive) this.waitForSubscriptionConfirmation();
    }
  }

  private handleCalendarRedirect(calendar: "connected" | "error" | null): void {
    if (calendar === "connected") {
      this.notice = "Google Calendar connected. Use Sync Google Calendar when you want to refresh its events.";
    } else if (calendar === "error") {
      this.notice = "Google Calendar could not be connected. Check the permission request and try again.";
    }
  }

  private waitForSubscriptionConfirmation(attempt = 1): void {
    window.setTimeout(async () => {
      if (!this.state.session || this.subscriptionActive) return;
      await this.refreshAccount();
      if (this.subscriptionActive) {
        this.billingConfirmationPending = false;
        this.notice = "Payment confirmed. Your Harbourline plan is active.";
        this.render();
      } else if (attempt < 5) {
        this.waitForSubscriptionConfirmation(attempt + 1);
      } else {
        this.notice = "Payment is still being confirmed. Check the plan status again shortly.";
        this.render();
      }
    }, attempt * 1500);
  }

  private openRecoveryMode(): void {
    this.recoveryMode = true;
    this.notice = "Your recovery link is verified. Choose a new password.";
  }

  private openPendingRecoveryIfReady(): void {
    if (!this.pendingRecoveryRedirect || !this.state.session) return;
    this.pendingRecoveryRedirect = false;
    this.openRecoveryMode();
    if (!this.dialog.open) this.dialog.showModal();
  }

  private createAccountButton(): HTMLButtonElement {
    const actions = document.querySelector(".topbar .actions");
    if (!actions) throw new Error("Harbourline header actions were not found.");
    const button = document.createElement("button");
    button.className = "btn secondary release2-account-button";
    button.type = "button";
    button.textContent = "Account";
    actions.prepend(button);
    return button;
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "release2-dialog";
    dialog.setAttribute("aria-labelledby", "release2DialogTitle");
    dialog.innerHTML = `
      <div class="release2-dialog-shell">
        <header class="release2-dialog-header">
          <div>
            <p class="eyebrow">Harbourline account</p>
            <h2 id="release2DialogTitle">Account & household</h2>
          </div>
          <button class="release2-icon-button" type="button" data-action="close" aria-label="Close account panel" title="Close">×</button>
        </header>
        <div class="release2-dialog-body"></div>
      </div>
    `;
    document.body.append(dialog);
    return dialog;
  }

  private createNewsDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "release2-dialog release2-news-dialog";
    dialog.setAttribute("aria-labelledby", "release2NewsTitle");
    dialog.innerHTML = `
      <div class="release2-dialog-shell">
        <header class="release2-dialog-header">
          <div>
            <p class="eyebrow">Harbourline update</p>
            <h2 id="release2NewsTitle">What’s new</h2>
          </div>
          <button class="release2-icon-button" type="button" data-news-action="close" aria-label="Close Harbourline update" title="Close">×</button>
        </header>
        <div class="release2-dialog-body release2-news-body">
          <section class="release2-news-hero">
            <span class="eyebrow">August 2026</span>
            <h3>Plan the payday. See the next move.</h3>
            <p>Harbourline is getting better at turning your household plan into a calm, repeatable weekly rhythm.</p>
          </section>
          <div class="release2-news-list" aria-label="Latest Harbourline features">
            <article class="release2-news-item">
              <span class="release2-news-index">01</span>
              <h3>Payday Check-in</h3>
              <p>Move bills, protect savings and debt, then confirm what is safe to spend before money moves.</p>
            </article>
            <article class="release2-news-item">
              <span class="release2-news-index">02</span>
              <h3>Reality in the plan</h3>
              <p>Mark bills paid to keep reserves, recurring dates and the 13-week forecast aligned.</p>
            </article>
            <article class="release2-news-item">
              <span class="release2-news-index">03</span>
              <h3>Calendar control</h3>
              <p>Sync planned paydays and bills to Google Calendar, with expense names optional and private by default.</p>
            </article>
          </div>
          <footer class="release2-news-footer">
            <p>You’re signed in and ready to continue your household plan.</p>
            <div class="release2-news-actions">
              <button class="btn secondary" type="button" data-news-action="account">Open account</button>
              <button class="btn" type="button" data-news-action="close">Keep planning</button>
            </div>
          </footer>
        </div>
      </div>
    `;
    document.body.append(dialog);
    return dialog;
  }

  private applySession(session: Session | null): void {
    this.sessionResolved = true;
    this.state.session = session;
    this.state.user = session?.user ?? null;
    this.updateAccountButton();
    this.updateAccessGate();
  }

  private async handleSessionChange(session: Session | null): Promise<void> {
    const previousUserId = this.state.user?.id ?? null;
    const nextUserId = session?.user.id ?? null;
    if (previousUserId !== nextUserId) {
      await this.sync.disconnectDevice();
      this.bridge.setUserScope(nextUserId);
      this.state.metadata = null;
      this.state.conflict = null;
    }
    this.applySession(session);
  }

  private bindCalendarControls(): void {
    const button = document.querySelector<HTMLButtonElement>("#googleCalendarSyncButton");
    button?.addEventListener("click", () => void this.handleCalendarButton());
    this.updateCalendarControls();
  }

  private updateCalendarControls(): void {
    const button = document.querySelector<HTMLButtonElement>("#googleCalendarSyncButton");
    const status = document.querySelector<HTMLElement>("#googleCalendarSyncStatus");
    if (!button || !status) return;
    button.disabled = this.calendarBusy;
    button.textContent = this.calendarBusy
      ? "Syncing Google Calendar…"
      : this.googleCalendarStatus.connected
        ? "Sync Google Calendar"
        : "Connect Google Calendar";
    status.textContent = this.googleCalendarStatus.connected
      ? `Connected${this.googleCalendarStatus.googleEmail ? ` · ${this.googleCalendarStatus.googleEmail}` : ""}`
      : this.googleCalendarStatus.error
        ? "Sync needs attention"
        : "Not connected";
  }

  private calendarExpenseNamesEnabled(): boolean {
    const current = this.bridge.read();
    return Boolean(
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      (current as Record<string, unknown>).showExpenseNamesOnCalendar === true
    );
  }

  private async handleCalendarPreferenceChange(event: Event): Promise<void> {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.dataset.action !== "calendar-title-preference" ||
      this.busy ||
      this.calendarBusy
    ) return;

    const enabled = target.checked;
    const current = this.bridge.read();
    const nextState = current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>), showExpenseNamesOnCalendar: enabled }
      : { showExpenseNamesOnCalendar: enabled };
    this.bridge.replace(nextState, "calendar-settings");
    this.notice = enabled
      ? "Expense names enabled. Updating your connected Google Calendar…"
      : "Generic calendar titles restored. Updating your connected Google Calendar…";
    this.render();

    if (!this.googleCalendarStatus.connected || !this.subscriptionActive) {
      this.notice = enabled
        ? "Expense names will be used the next time you sync Google Calendar."
        : "Generic titles will be used the next time you sync Google Calendar.";
      this.render();
      return;
    }

    this.calendarBusy = true;
    this.updateCalendarControls();
    try {
      this.googleCalendarStatus = await this.calendarSync.sync();
      this.notice = enabled
        ? "Expense names are now shown in your Google Calendar bill events."
        : "Google Calendar bill events now use generic titles.";
    } catch (error) {
      reportError(error);
      this.notice = error instanceof Error
        ? `${error.message} The preference was saved and will apply on the next successful sync.`
        : "Google Calendar could not be updated. The preference was saved for the next sync.";
    } finally {
      this.calendarBusy = false;
      this.updateCalendarControls();
      this.render();
    }
  }

  private async handleCalendarButton(): Promise<void> {
    if (this.calendarBusy) return;
    if (!this.state.session || !this.subscriptionActive) {
      this.notice = this.state.session
        ? "Google Calendar sync is available after your Harbourline plan is active."
        : "Sign in and subscribe to connect Google Calendar.";
      this.render();
      if (!this.dialog.open) this.dialog.showModal();
      return;
    }
    this.calendarBusy = true;
    this.updateCalendarControls();
    try {
      if (!this.googleCalendarStatus.connected) {
        await this.calendarSync.connect();
        return;
      }
      this.googleCalendarStatus = await this.calendarSync.sync();
      this.notice = "Google Calendar is up to date with your planned paydays and bill dates.";
    } catch (error) {
      reportError(error);
      this.notice = error instanceof Error ? error.message : "Google Calendar could not be updated.";
    } finally {
      this.calendarBusy = false;
      this.updateCalendarControls();
      this.render();
    }
  }

  private async refreshAccount(): Promise<void> {
    if (!this.state.session) {
      await this.onboarding.refresh({ session: null, subscriptionActive: false, households: [] });
      this.state.households = [];
      this.subscriptionActive = null;
      this.billingConfirmationPending = false;
      this.billingSubscription = null;
      this.googleCalendarStatus = {
        connected: false,
        googleEmail: null,
        calendarId: null,
        lastSyncedAt: null,
        error: null
      };
      this.updateCalendarControls();
      this.mfa = { verifiedCount: 0, currentLevel: null, nextLevel: null, enrollment: null };
      this.render();
      return;
    }
    try {
      const [households, mfa, billingReconciliation, googleCalendarStatus] = await Promise.all([
        this.cloud.listHouseholds(),
        this.cloud.getMfaState(),
        this.cloud.reconcileBillingSubscription().catch((error) => {
          reportError(error);
          return null;
        }),
        this.cloud.getGoogleCalendarStatus().catch(() => this.googleCalendarStatus)
      ]);
      const subscriptionActive = billingReconciliation?.active ?? await this.cloud.hasActiveSubscription();
      const billingSubscription = billingReconciliation?.subscription ?? await this.cloud.getBillingSubscription();
      this.state.households = households;
      this.subscriptionActive = subscriptionActive;
      if (subscriptionActive) this.billingConfirmationPending = false;
      this.billingSubscription = billingSubscription;
      this.googleCalendarStatus = googleCalendarStatus;
      this.updateCalendarControls();
      this.state.metadata = this.sync.metadata;
      this.mfa.verifiedCount = mfa.verified.length;
      this.mfa.currentLevel = mfa.currentLevel;
      this.mfa.nextLevel = mfa.nextLevel;
      const linked = this.state.metadata?.householdId;
      if (subscriptionActive && linked && households.some((household) => household.id === linked)) {
        await this.sync.resumeForHousehold(linked);
      }
      await this.onboarding.refresh({
        session: this.state.session,
        subscriptionActive: Boolean(subscriptionActive),
        households
      });
    } catch (error) {
      reportError(error);
      this.notice = error instanceof Error ? error.message : "Account details could not be loaded.";
    }
    this.updateAccountButton();
    this.render();
  }

  private render(): void {
    this.updateAccessGate();
    this.updateCalendarControls();
    const body = this.dialog.querySelector(".release2-dialog-body");
    if (!body) return;
    body.innerHTML = !this.state.configured
      ? this.renderUnconfigured()
      : this.recoveryMode && this.state.session
        ? this.renderRecovery()
        : this.state.session
        ? this.renderSignedIn()
        : this.renderSignedOut();
  }

  private updateAccessGate(): void {
    const waitingForSession = this.cloud.configured && !this.sessionResolved;
    const waitingForPlan = this.cloud.configured && this.sessionResolved && Boolean(this.state.session) && this.subscriptionActive === null;
    const checking = waitingForSession || waitingForPlan;
    const active = Boolean(this.state.session && this.subscriptionActive);
    let gate = document.querySelector<HTMLElement>("#release2-access-gate");
    if (active) {
      gate?.remove();
      return;
    }
    if (!gate) {
      gate = document.createElement("section");
      gate.id = "release2-access-gate";
      gate.className = "release2-access-gate";
      gate.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("[data-action='open-account']")) return;
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
      });
      document.body.append(gate);
    }
    if (checking) {
      gate.classList.add("release2-access-gate-checking");
      gate.setAttribute("role", "status");
      gate.setAttribute("aria-live", "polite");
      gate.setAttribute("aria-busy", "true");
      gate.innerHTML = `
        <div class="release2-access-gate-card">
          <span class="eyebrow">Harbourline account</span>
          <div class="release2-gate-status">
            <span class="release2-status-dot" aria-hidden="true"></span>
            <span>${waitingForSession ? "Restoring your secure session" : "Checking your plan access"}</span>
          </div>
          <h1>${waitingForSession ? "Getting your plan ready" : "Almost there"}</h1>
          <p>${waitingForSession
            ? "We’re checking this device before showing the right account options."
            : "Your account is restored. We’re confirming your Harbourline plan now."}</p>
        </div>
      `;
      return;
    }
    gate.classList.remove("release2-access-gate-checking");
    gate.removeAttribute("role");
    gate.removeAttribute("aria-live");
    gate.removeAttribute("aria-busy");
    gate.innerHTML = `
      <div class="release2-access-gate-card">
        <span class="eyebrow">Harbourline</span>
        <h1>${this.state.session ? "Complete your Harbourline plan" : "Your money plan starts here"}</h1>
        <p>${this.state.session
          ? "Your account is ready. Continue to secure payment to unlock your household planning workspace and cloud sync."
          : "Sign in or create your Harbourline account to access the hosted planning workspace."}</p>
        <div class="release2-gate-actions">
          <button class="btn" type="button" data-action="open-account">${this.state.session ? "Continue to payment" : "Sign in to continue"}</button>
          ${this.state.session ? "" : `<a class="btn secondary" href="https://www.harbourline.app/#early-access" target="_blank" rel="noreferrer">Create account</a>`}
        </div>
        <p class="release2-gate-note">${this.state.session
          ? "Payment is handled securely by Stripe. Your card details are never stored in Harbourline."
          : "New to Harbourline? Create your account on the homepage first. Already registered? Sign in here."}</p>
      </div>
    `;
  }

  private updateAccountButton(): void {
    const signedIn = Boolean(this.state.session);
    const active = signedIn && this.subscriptionActive === true;
    this.accountButton.classList.toggle("release2-signed-in", signedIn);
    this.accountButton.classList.toggle("release2-plan-active", active);
    this.accountButton.textContent = !signedIn
      ? "Account"
      : active
        ? "Account · Active"
        : "Account · On";
  }

  private renderNotice(): string {
    return this.notice
      ? `<div class="release2-notice" role="status">${escapeHtml(this.notice)}</div>`
      : "";
  }

  private renderUnconfigured(): string {
    return `
      ${this.renderNotice()}
      <section class="release2-section release2-intro">
        <span class="release2-status-dot"></span>
        <div>
          <h3>Harbourline account required</h3>
          <p>This hosted build uses secure Harbourline accounts for sign-in and household sync. Connect the production account settings before using the hosted experience.</p>
        </div>
      </section>
      <section class="release2-section">
        <h3>Hosted account protection</h3>
        <div class="release2-fact-grid">
          <div><span>Account</span><strong>Harbourline</strong></div>
          <div><span>Registration</span><strong>Homepage only</strong></div>
          <div><span>Currency</span><strong>AUD</strong></div>
        </div>
      </section>
    `;
  }

  private renderSignedOut(): string {
    return `
      ${this.renderNotice()}
      <section class="release2-section release2-intro">
        <span class="release2-status-dot"></span>
        <div>
          <h3>Sign in to Harbourline</h3>
          <p>Returning to Harbourline? Sign in below. New accounts start on the public homepage, where you can review the plan and early-access price first.</p>
        </div>
      </section>
      <div class="release2-auth-grid">
        <section class="release2-section release2-account-path">
          <div class="release2-section-heading">
            <div><span>New here?</span><h3>Create your account first</h3></div>
          </div>
          <p class="release2-empty">Create your account on the homepage, confirm your email, then return here to sign in and continue to secure payment.</p>
          <a class="btn secondary release2-homepage-button" href="https://www.harbourline.app/#early-access" target="_blank" rel="noreferrer">Create account on homepage</a>
        </section>
        <form class="release2-section" data-form="sign-in">
          <div class="release2-section-heading">
            <div><span>Welcome back</span><h3>Sign in</h3></div>
          </div>
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label class="release2-password-field">Password<input id="signInPassword" name="password" type="password" autocomplete="current-password" minlength="8" required /><button class="release2-password-toggle" type="button" data-action="toggle-password" data-password-target="signInPassword" aria-controls="signInPassword" aria-pressed="false">Show</button></label>
          <button class="btn" type="submit" ${this.busy ? "disabled" : ""}>Sign in</button>
          <div class="release2-auth-divider" role="separator"><span>or continue with</span></div>
          <button class="btn secondary release2-google-button" type="button" data-action="google-sign-in" ${this.busy ? "disabled" : ""}>
            <svg class="release2-provider-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="#4285F4" d="M21.35 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.7 2.91-4.2 2.91-7.18Z"/>
              <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.35l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.74 9.74 0 0 0 12 21.6Z"/>
              <path fill="#FBBC05" d="M6.54 13.7a5.86 5.86 0 0 1 0-3.4V7.78H3.3a9.6 9.6 0 0 0 0 8.44l3.24-2.52Z"/>
              <path fill="#EA4335" d="M12 6.27c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.37 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.7 5.38l3.24 2.52C7.31 7.99 9.46 6.27 12 6.27Z"/>
            </svg>
            <span>Continue with Google</span>
          </button>
          <button class="btn secondary" type="button" data-action="magic-link" ${this.busy ? "disabled" : ""}>Email a sign-in link</button>
          <button class="btn secondary" type="button" data-action="password-reset" ${this.busy ? "disabled" : ""}>Forgot password?</button>
        </form>
      </div>
    `;
  }

  private renderSubscriptionSummary(
    planState: "active" | "pending" | "checking" | "attention" | "not-started",
    periodEnd: string | null
  ): string {
    const summary = {
      active: {
        eyebrow: "Account status",
        title: "Connected and subscribed",
        message: `Your plan is active${periodEnd ? ` through ${periodEnd}` : ""}. Create or join a household below to start syncing.`,
        icon: "✓"
      },
      pending: {
        eyebrow: "Payment received",
        title: "Confirming your subscription",
        message: "Stripe has received your payment. Harbourline will open household sync as soon as the plan is confirmed.",
        icon: "…"
      },
      checking: {
        eyebrow: "Account status",
        title: "Checking your plan",
        message: "We’re checking the latest subscription status for this account.",
        icon: "…"
      },
      attention: {
        eyebrow: "Account status",
        title: "Payment needs attention",
        message: "Update your payment method to restore Harbourline access and household sync.",
        icon: "!"
      },
      "not-started": {
        eyebrow: "Account status",
        title: "Ready to secure your plan",
        message: "Complete secure payment to unlock household planning and cloud sync.",
        icon: "→"
      }
    }[planState];
    return `
      <section class="release2-account-summary release2-summary-${planState}" aria-live="polite">
        <span class="release2-account-summary-icon" aria-hidden="true">${summary.icon}</span>
        <div>
          <span class="release2-account-summary-eyebrow">${summary.eyebrow}</span>
          <h3>${summary.title}</h3>
          <p>${summary.message}</p>
        </div>
        <span class="badge release2-summary-badge">${planState === "active" ? "Ready" : planState === "pending" ? "Confirming" : planState === "checking" ? "Checking" : planState === "attention" ? "Action needed" : "Not active"}</span>
      </section>
    `;
  }

  private renderRecovery(): string {
    return `
      ${this.renderNotice()}
      <section class="release2-section release2-intro">
        <span class="release2-status-dot"></span>
        <div>
          <h3>Choose a new password</h3>
          <p>Use at least eight characters. Your Harbourline account will stay connected across supported devices.</p>
        </div>
      </section>
      <form class="release2-section" data-form="update-password">
        <label class="release2-password-field">New password<input id="recoveryPassword" name="password" type="password" autocomplete="new-password" minlength="8" required /><button class="release2-password-toggle" type="button" data-action="toggle-password" data-password-target="recoveryPassword" aria-controls="recoveryPassword" aria-pressed="false">Show</button></label>
        <label class="release2-password-field">Confirm new password<input id="recoveryConfirmation" name="confirmation" type="password" autocomplete="new-password" minlength="8" required /><button class="release2-password-toggle" type="button" data-action="toggle-password" data-password-target="recoveryConfirmation" aria-controls="recoveryConfirmation" aria-pressed="false">Show</button></label>
        <button class="btn" type="submit" ${this.busy ? "disabled" : ""}>Update password</button>
      </form>
    `;
  }

  private renderSignedIn(): string {
    const linkedId = this.sync.metadata?.householdId;
    const linkedHousehold = this.state.households.find((household) => household.id === linkedId);
    const showExpenseNamesOnCalendar = this.calendarExpenseNamesEnabled();
    const status = this.state.status;
    const billing = this.billingSubscription;
    const periodEnd = formatBillingDate(billing?.current_period_end ?? null);
    const paymentNeedsAttention = billing && ["incomplete", "past_due", "unpaid"].includes(billing.status);
    const hasBillingPortal = Boolean(billing?.stripe_customer_id);
    const planState: "active" | "pending" | "checking" | "attention" | "not-started" = this.subscriptionActive === null
      ? "checking"
      : this.subscriptionActive
        ? "active"
        : this.billingConfirmationPending
          ? "pending"
          : paymentNeedsAttention
            ? "attention"
            : "not-started";
    const planMessage = this.subscriptionActive
      ? billing?.cancel_at_period_end
        ? `Your plan is active until ${periodEnd ?? "the end of the current billing period"}. Cancellation is scheduled after that date.`
        : `Household sync is available across supported devices${periodEnd ? `. Next billing is ${periodEnd}.` : "."}`
      : this.billingConfirmationPending
        ? "Your payment has been received. We’re waiting for the subscription confirmation before opening sync."
      : paymentNeedsAttention
        ? "A payment needs attention. Update your payment method or manage your subscription to restore access."
        : "Secure payment is handled by our payment provider. Your card details are never stored in Harbourline.";
    const planAction = this.subscriptionActive
      ? hasBillingPortal
        ? `<div class="release2-plan-management"><div><strong>Manage your subscription</strong><p>Payment method, invoices and cancellation are handled securely by Stripe.</p></div><button class="btn secondary" type="button" data-action="open-billing-portal" ${this.busy ? "disabled" : ""}>Manage subscription</button></div>`
        : `<span class="badge release2-plan-badge is-active"><span class="release2-badge-dot" aria-hidden="true"></span>Subscribed</span>`
      : this.subscriptionActive === null || this.billingConfirmationPending
        ? `<div class="release2-button-row"><span class="badge release2-plan-badge is-pending">${this.subscriptionActive === null ? "Checking" : "Confirming"}</span><button class="btn secondary" type="button" data-action="refresh-subscription" ${this.busy ? "disabled" : ""}>Check plan status</button></div>`
      : paymentNeedsAttention
        ? hasBillingPortal
          ? `<div class="release2-button-row"><span class="badge release2-plan-badge is-attention">Payment needed</span><button class="btn secondary" type="button" data-action="open-billing-portal" ${this.busy ? "disabled" : ""}>Manage subscription</button></div>`
          : `<span class="badge release2-plan-badge is-attention">Payment needed</span>`
      : `<button class="btn" type="button" data-action="start-checkout" ${this.busy ? "disabled" : ""}>Continue to secure payment</button>`;
    const accountStatusMessage = this.subscriptionActive
      ? linkedHousehold
        ? status.message
        : "Plan active. Create or join a household to sync this device."
      : this.subscriptionActive === null
        ? "Checking your Harbourline plan…"
        : status.message;
    const accountStatusDetail = this.subscriptionActive
      ? linkedHousehold
        ? `${status.online ? "Online" : "Offline"}${status.queued ? ` · ${status.queued} queued` : ""} · ${escapeHtml(linkedHousehold.name)}`
        : `${status.online ? "Online" : "Offline"} · Sync ready when a household is connected`
      : `${status.online ? "Online" : "Offline"}${status.queued ? ` · ${status.queued} queued` : ""}`;
    return `
      ${this.renderNotice()}
      ${this.renderSubscriptionSummary(planState, periodEnd)}
      <section class="release2-sync-status release2-tone-${status.tone}">
        <span class="release2-status-dot"></span>
        <div>
          <strong>${escapeHtml(accountStatusMessage)}</strong>
          <span>${accountStatusDetail}</span>
        </div>
      </section>
      ${this.state.conflict ? this.renderConflict(this.state.conflict) : ""}
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Signed in as</span><h3>${escapeHtml(this.state.user?.email)}</h3></div>
          <button class="btn secondary" type="button" data-action="sign-out">Sign out</button>
        </div>
      </section>
      <section class="release2-section release2-plan-card release2-plan-${planState}">
        <div class="release2-section-heading">
          <div><span>Harbourline plan</span><h3>A$1/week introductory early access</h3></div>
          <span class="badge release2-plan-badge ${planState === "active" ? "is-active" : planState === "attention" ? "is-attention" : planState === "pending" || planState === "checking" ? "is-pending" : ""}">${planState === "active" ? "Subscribed" : planState === "pending" ? "Confirming" : planState === "checking" ? "Checking" : planState === "attention" ? "Payment needed" : "One plan"}</span>
        </div>
        ${this.subscriptionActive ? `<div class="release2-plan-confirmation" role="status"><span class="release2-plan-check" aria-hidden="true">✓</span><div><strong>Subscription active</strong><p>Payment confirmed. Harbourline is ready for household planning and sync.</p></div></div>` : ""}
        <p class="release2-empty">${planMessage}</p>
        <div class="release2-plan-actions">${planAction}</div>
      </section>
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Calendar connection</span><h3>Google Calendar</h3></div>
          <span class="badge">${this.googleCalendarStatus.connected ? "Connected" : "Optional"}</span>
        </div>
        <p class="release2-empty">Sync planned paydays and bill due dates. Amounts and household details stay in Harbourline.</p>
        <label class="release2-calendar-title-option">
          <input type="checkbox" data-action="calendar-title-preference" ${showExpenseNamesOnCalendar ? "checked" : ""} ${this.busy || this.calendarBusy || !this.subscriptionActive ? "disabled" : ""} />
          <span class="release2-calendar-title-mark" aria-hidden="true"></span>
          <span class="release2-calendar-title-copy">
            <strong>Show expense names on calendar</strong>
            <small>When enabled, bill events use titles such as “Rent due”. Expense names will be visible in Google Calendar.</small>
          </span>
        </label>
        <div class="release2-button-row">
          <button class="btn secondary" type="button" data-action="google-calendar-sync" ${this.busy || this.calendarBusy || !this.subscriptionActive ? "disabled" : ""}>${this.googleCalendarStatus.connected ? "Sync now" : "Connect Google Calendar"}</button>
          ${this.googleCalendarStatus.connected ? `<button class="btn secondary" type="button" data-action="google-calendar-disconnect" ${this.busy || this.calendarBusy ? "disabled" : ""}>Disconnect</button>` : ""}
        </div>
      </section>
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Shared planning</span><h3>Households</h3></div>
          <span class="badge">${this.state.households.length}</span>
        </div>
        <div class="release2-household-list">
          ${this.state.households.length
            ? this.state.households.map((household) => this.renderHousehold(household, linkedId)).join("")
            : `<p class="release2-empty">Create a household to securely sync this device and invite another person.</p>`}
        </div>
        <form class="release2-inline-form" data-form="create-household">
          <label>New household<input name="name" maxlength="80" placeholder="Our household" required /></label>
          <button class="btn" type="submit">Create</button>
        </form>
        <form class="release2-inline-form" data-form="accept-invite">
          <label>Have an invite code?<input name="token" autocomplete="off" required /></label>
          <button class="btn secondary" type="submit">Join household</button>
        </form>
      </section>
      ${linkedHousehold ? this.renderSharing(linkedHousehold) : ""}
      ${this.renderSupport()}
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Sign-in protection</span><h3>Authenticator app</h3></div>
          <span class="badge">${this.mfa.verifiedCount ? "Protected" : "Optional"}</span>
        </div>
        ${this.renderMfa()}
      </section>
      <section class="release2-section release2-data-controls">
        <div class="release2-section-heading">
          <div><span>Privacy controls</span><h3>Your account data</h3></div>
        </div>
        <p>Download a complete account copy at any time. Account deletion requires authenticator verification and cannot proceed while you own a household.</p>
        <div class="release2-button-row">
          <button class="btn secondary" type="button" data-action="export-account">Download account copy</button>
          ${linkedId ? `<button class="btn secondary" type="button" data-action="disconnect-sync">Disconnect this device</button>` : ""}
          <button class="btn danger" type="button" data-action="delete-account">Delete account</button>
        </div>
      </section>
    `;
  }

  private renderHousehold(household: HouseholdSummary, linkedId: string | undefined): string {
    const linked = household.id === linkedId;
    return `
      <article class="release2-household ${linked ? "is-linked" : ""}">
        <div>
          <strong>${escapeHtml(household.name)}</strong>
          <span>${escapeHtml(household.role)} · Version ${household.revision}${linked ? " · Synced here" : ""}</span>
        </div>
        ${linked
          ? `<span class="release2-linked-label">Connected</span>`
          : `<div class="release2-household-actions">
              <button class="btn" type="button" data-action="link-device" data-household="${escapeHtml(household.id)}">Use this device</button>
              ${household.revision > 0
                ? `<button class="btn secondary" type="button" data-action="link-household" data-household="${escapeHtml(household.id)}">Use household copy</button>`
                : ""}
            </div>`}
      </article>
    `;
  }

  private renderSharing(household: HouseholdSummary): string {
    return `
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>${escapeHtml(household.name)}</span><h3>Invite household member</h3></div>
        </div>
        ${household.role === "owner"
          ? `<form class="release2-inline-form" data-form="create-invite">
              <label>Email address<input name="email" type="email" autocomplete="email" required /></label>
              <button class="btn" type="submit">Create invite</button>
            </form>`
          : `<p class="release2-empty">Only the household owner can create invitations.</p>`}
        ${this.inviteToken
          ? `<div class="release2-invite-token">
              <span>Private invite code</span>
              <code>${escapeHtml(this.inviteToken)}</code>
              <button class="btn secondary" type="button" data-action="copy-invite">Copy code</button>
            </div>`
          : ""}
      </section>
    `;
  }

  private renderSupport(): string {
    if (!SUPPORT_EMAIL) return "";
    const subject = encodeURIComponent("Harbourline support request");
    const body = encodeURIComponent(
      "Please avoid including account numbers, passwords or a budget export in your message.\n\nHow can we help?"
    );
    const href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    return `
      <section class="release2-section release2-support">
        <div class="release2-section-heading">
          <div><span>Need a hand?</span><h3>Contact Harbourline support</h3></div>
        </div>
        <p>Tell us what happened without including passwords, account numbers or budget values.</p>
        <a class="btn secondary" href="${escapeHtml(href)}" data-action="support">Email support</a>
      </section>
    `;
  }

  private renderConflict(remote: RemoteBudgetDocument): string {
    const updated = new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(remote.updatedAt));
    return `
      <section class="release2-conflict" role="alert">
        <div>
          <span>Sync needs your choice</span>
          <h3>Another device changed this household</h3>
          <p>The household copy was updated ${escapeHtml(updated)}. Choose which complete version to keep.</p>
        </div>
        <div class="release2-button-row">
          <button class="btn" type="button" data-action="keep-device">Keep this device</button>
          <button class="btn secondary" type="button" data-action="use-household">Use household version</button>
        </div>
      </section>
    `;
  }

  private renderMfa(): string {
    if (this.mfa.enrollment) {
      return `
        <div class="release2-mfa-enrolment">
          <img src="${escapeHtml(this.mfa.enrollment.qrCode)}" alt="Authenticator setup QR code" />
          <div>
            <p>Scan this code in your authenticator app, then enter its six-digit code.</p>
            <code>${escapeHtml(this.mfa.enrollment.secret)}</code>
            <form class="release2-inline-form" data-form="verify-mfa">
              <label>Verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
              <button class="btn" type="submit">Verify</button>
            </form>
          </div>
        </div>
      `;
    }
    return this.mfa.verifiedCount
      ? `<p>Your account has authenticator protection. Current session: <strong>${escapeHtml(this.mfa.currentLevel?.toUpperCase() ?? "AAL1")}</strong>.</p>`
      : `<p>Add an authenticator app for stronger sign-in protection and sensitive account actions.</p>
         <button class="btn secondary" type="button" data-action="start-mfa">Set up authenticator</button>`;
  }

  private async handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || this.busy) return;
    const action = form.dataset.form;
    await this.run(async () => {
      if (action === "sign-in") {
        await this.cloud.signIn(formValue(form, "email"), formValue(form, "password"));
        this.notice = "Signed in.";
      } else if (action === "update-password") {
        const password = formValue(form, "password");
        if (password !== formValue(form, "confirmation")) {
          throw new Error("The passwords do not match.");
        }
        await this.cloud.updatePassword(password);
        this.recoveryMode = false;
        this.notice = "Password updated. You are signed in.";
        await this.refreshAccount();
      } else if (action === "create-household") {
        const householdId = await this.cloud.createHousehold(formValue(form, "name"));
        await this.refreshAccount();
        await this.sync.linkDevice(householdId, "device");
        this.notice = "Household created and this device budget is now synced.";
      } else if (action === "create-invite") {
        const householdId = this.sync.metadata?.householdId;
        if (!householdId) throw new Error("Connect a household on this device first.");
        const invite = await this.cloud.createInvite(householdId, formValue(form, "email"));
        this.inviteToken = invite.token;
        this.notice = "Invite created. Share the private code with that person.";
      } else if (action === "accept-invite") {
        const householdId = await this.cloud.acceptInvite(formValue(form, "token"));
        await this.refreshAccount();
        this.notice = "Household joined. Choose which budget copy to use on this device.";
        const joined = this.state.households.find((household) => household.id === householdId);
        if (!joined) await this.refreshAccount();
      } else if (action === "verify-mfa") {
        if (!this.mfa.enrollment) throw new Error("Start authenticator setup first.");
        await this.cloud.verifyMfa(this.mfa.enrollment.factorId, formValue(form, "code"));
        this.mfa.enrollment = null;
        this.notice = "Authenticator protection is active.";
        await this.refreshAccount();
      }
      form.reset();
    });
  }

  private handleNewsClick(event: MouseEvent): void {
    const target = event.target;
    if (target === this.newsDialog) {
      this.newsDialog.close();
      return;
    }
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>("[data-news-action]")?.dataset.newsAction;
    if (action === "close") {
      this.newsDialog.close();
      return;
    }
    if (action === "account") {
      this.newsDialog.close();
      this.render();
      if (!this.dialog.open) this.dialog.showModal();
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("[data-action]");
    const action = button?.dataset.action;
    if (!action || this.busy) return;

    // The checkbox is handled by the delegated change listener. Do not let
    // the click listener treat it as a button action and start a no-op run.
    if (action === "calendar-title-preference") return;

    if (action === "close") {
      this.dialog.close();
      return;
    }
    if (action === "support") {
      void this.cloud.recordBetaEvent("support_requested", this.sync.metadata?.householdId)
        .catch(() => undefined);
      return;
    }
    if (action === "toggle-password") {
      const input = document.getElementById(button?.dataset.passwordTarget ?? "");
      if (!(input instanceof HTMLInputElement)) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      if (button) {
        button.textContent = visible ? "Show" : "Hide";
        button.setAttribute("aria-pressed", String(!visible));
      }
      return;
    }
    void this.run(async () => {
      if (action === "google-sign-in") {
        await this.cloud.signInWithGoogle();
      } else if (action === "magic-link") {
        const form = button.closest("form");
        if (!(form instanceof HTMLFormElement)) return;
        const email = formValue(form, "email");
        if (!email) throw new Error("Enter your email address first.");
        await this.cloud.sendMagicLink(email);
        this.notice = "Check your email for a secure sign-in link.";
      } else if (action === "password-reset") {
        const form = button.closest("form");
        if (!(form instanceof HTMLFormElement)) return;
        const email = formValue(form, "email");
        if (!email) throw new Error("Enter your email address first.");
        await this.cloud.sendPasswordReset(email);
        this.notice = "Check your email for a password recovery link.";
      } else if (action === "sign-out") {
        await this.cloud.signOut();
        this.notice = "Signed out. This device is ready for another account.";
      } else if (action === "start-checkout") {
        const checkoutUrl = await this.cloud.createCheckoutSession();
        window.location.assign(checkoutUrl);
      } else if (action === "refresh-subscription") {
        await this.refreshAccount();
        this.notice = this.subscriptionActive
          ? "Payment confirmed. Your Harbourline plan is active."
          : "Your plan is still being confirmed. Check again shortly.";
      } else if (action === "google-calendar-sync") {
        await this.handleCalendarButton();
      } else if (action === "google-calendar-disconnect") {
        const deleteEvents = confirm("Also remove the Harbourline-created events from Google Calendar?");
        this.calendarBusy = true;
        this.updateCalendarControls();
        try {
          await this.calendarSync.disconnect(deleteEvents);
          this.googleCalendarStatus = this.calendarSync.currentStatus;
          this.notice = deleteEvents
            ? "Google Calendar disconnected and Harbourline-created events removed."
            : "Google Calendar disconnected. Existing events were left in place.";
        } finally {
          this.calendarBusy = false;
          this.updateCalendarControls();
        }
      } else if (action === "open-billing-portal") {
        const portalUrl = await this.cloud.createBillingPortalSession();
        window.location.assign(portalUrl);
      } else if (action === "link-device" || action === "link-household") {
        const householdId = button.dataset.household;
        if (!householdId) return;
        await this.sync.linkDevice(householdId, action === "link-device" ? "device" : "household");
        this.state.metadata = this.sync.metadata;
        this.notice = action === "link-device"
          ? "This device budget is now the household copy."
          : "The household budget is now on this device.";
      } else if (action === "keep-device") {
        await this.sync.keepDeviceVersion();
      } else if (action === "use-household") {
        await this.sync.useHouseholdVersion();
      } else if (action === "disconnect-sync") {
        if (!confirm("Disconnect cloud sync on this device? Your cached budget will remain available.")) return;
        await this.sync.disconnectDevice();
        this.state.metadata = null;
      } else if (action === "copy-invite") {
        await navigator.clipboard.writeText(this.inviteToken);
        this.notice = "Invite code copied.";
      } else if (action === "start-mfa") {
        this.mfa.enrollment = await this.cloud.startMfaEnrollment();
        this.notice = "Scan the code to finish authenticator setup.";
      } else if (action === "export-account") {
        downloadJson(
          await this.cloud.exportAccount(),
          `harbourline-account-${new Date().toISOString().slice(0, 10)}.json`
        );
        this.notice = "Account copy downloaded.";
      } else if (action === "delete-account") {
        const confirmed = prompt('Type "DELETE MY HARBOURLINE ACCOUNT" to permanently delete your account.');
        if (confirmed !== "DELETE MY HARBOURLINE ACCOUNT") {
          this.notice = "Account deletion cancelled.";
          return;
        }
        await this.cloud.deleteAccount();
        await this.sync.disconnectDevice();
        this.notice = "Account deleted. Your cached device copy remains available.";
      }
    });
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.notice = "";
    this.render();
    try {
      await operation();
      await this.refreshAccount();
    } catch (error) {
      reportError(error);
      this.notice = error instanceof Error ? error.message : "That action could not be completed.";
    } finally {
      this.busy = false;
      this.state.metadata = this.sync.metadata;
      this.state.conflict = this.sync.conflict;
      this.render();
    }
  }
}
