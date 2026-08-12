import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { HouseholdSummary, RemoteBudgetDocument } from "@harbourline/sync";
import { track } from "@vercel/analytics";
import {
  isVerifiedAccountUser,
  resolveWorkspaceAccess,
  type WorkspaceAccess
} from "./access-model";
import { getFocusWrapTarget } from "./auth-gate-focus";
import {
  shouldNotifySignupForAuthEvent,
  shouldPreserveRecoveryForSession
} from "./auth-event-policy";
import { HarbourlineCloud, type BillingSubscription, type GoogleCalendarStatus } from "./cloud";
import { GoogleCalendarSync } from "./calendar-sync";
import {
  CLEANUP_LATCH_CHANNEL_NAME,
  clearCleanupLatch,
  getCleanupLatch,
  setCleanupLatch,
  withCleanupLatchLock
} from "./local-sync-store";
import { reportError } from "./monitoring";
import { OnboardingFlow } from "./onboarding-flow";
import { SyncController } from "./sync-controller";
import type {
  AccountState,
  HarbourlineLocalBridge,
  Release2Status
} from "./release2-types";

const INITIAL_STATUS: Release2Status = {
  message: "Sign in to use the local starter. Subscribe to enable cloud sync.",
  tone: "neutral",
  queued: 0,
  online: navigator.onLine
};

const SUPPORT_EMAIL = String(import.meta.env.VITE_HARBOURLINE_SUPPORT_EMAIL ?? "").trim();
const BILLING_CURRENCY = String(import.meta.env.VITE_HARBOURLINE_BILLING_CURRENCY ?? "AUD").trim().toUpperCase();
const BILLING_LOCALE = String(import.meta.env.VITE_HARBOURLINE_BILLING_LOCALE ?? "en-AU").trim() || "en-AU";
const BILLING_PRICE_LABEL = BILLING_CURRENCY === "AUD" ? "A$2.50/week" : `${BILLING_CURRENCY} 2.50/week`;
const PAID_CLOUD_ACTIONS = new Set([
  "create-household",
  "create-invite",
  "accept-invite",
  "copy-invite",
  "google-calendar-sync",
  "google-calendar-disconnect",
  "link-device",
  "link-household",
  "keep-device",
  "use-household"
]);

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
    : new Intl.DateTimeFormat(BILLING_LOCALE, { dateStyle: "medium" }).format(date);
}

function emptyGoogleCalendarStatus(): GoogleCalendarStatus {
  return {
    connected: false,
    googleEmail: null,
    calendarId: null,
    lastSyncedAt: null,
    error: null
  };
}

function verifiedSession(session: Session | null): Session | null {
  return isVerifiedAccountUser(session?.user) ? session : null;
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
  private actionGeneration = 0;
  private sessionGeneration = 0;
  private authEventGeneration = 0;
  private subscriptionActive: boolean | null = null;
  private billingReconciled = false;
  private workspaceAccess: WorkspaceAccess = "signed-out";
  private freeStarterViewed = false;
  private billingConfirmationPending = false;
  private billingSubscription: BillingSubscription | null = null;
  private accountRefreshGeneration = 0;
  private cleanupBlocked = false;
  private cleanupLatchOwnerId: string | null = null;
  private cleanupLatchChannel: BroadcastChannel | null = null;
  private readonly calendarSync: GoogleCalendarSync;
  private googleCalendarStatus: GoogleCalendarStatus = emptyGoogleCalendarStatus();
  private calendarBusy = false;
  private calendarOperationGeneration = 0;
  private recoveryMode = false;
  private recoveryFlowUserId: string | null = null;
  private pendingRecoveryRedirect = false;
  private pendingRecoveryUserId: string | null = null;
  private dialogReturnFocus: HTMLElement | null = null;
  private dialogHistoryActive = false;
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
      },
      cleanupFailure: (error, ownerId) => this.recordCleanupFailure(error, ownerId)
    });
    this.onboarding = new OnboardingFlow({
      bridge,
      cloud: this.cloud,
      createHousehold: (name, currency) => this.cloud.createHousehold(name, currency),
      linkHousehold: (householdId) => this.sync.linkDevice(householdId, "device")
    });
    this.calendarSync = new GoogleCalendarSync(bridge, this.cloud);
    this.accountButton = this.createAccountButton();
    this.dialog = this.createDialog();
    this.newsDialog = this.createNewsDialog();
    this.updateAccessGate();
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.cleanupLatchChannel = new BroadcastChannel(CLEANUP_LATCH_CHANNEL_NAME);
        this.cleanupLatchChannel.addEventListener("message", (event) => {
          const payload = event.data as { type?: unknown; latch?: { ownerId?: unknown } | null };
          if (
            payload?.type !== "cleanup-latch" ||
            !payload.latch ||
            typeof payload.latch.ownerId !== "string" ||
            payload.latch.ownerId.length === 0
          ) return;
          this.cleanupBlocked = true;
          this.cleanupLatchOwnerId = this.sync.metadata?.ownerId ?? this.state.user?.id ?? payload.latch.ownerId;
          this.accountRefreshGeneration += 1;
          this.actionGeneration += 1;
          this.calendarOperationGeneration += 1;
          this.sync.setCloudAccess(false, true);
          this.render();
        });
      } catch {
        this.cleanupLatchChannel = null;
      }
    }
    window.addEventListener("harbourline:workspace-viewed", (event) => {
      if (event.detail.tab === "payday" && this.workspaceAccess === "free") {
        track("free_starter_payday_viewed");
      }
    });
  }

  private localCurrency(): string {
    const localState = this.bridge.read();
    const source = localState && typeof localState === "object"
      ? localState as { currency?: unknown; household?: { currency?: unknown } }
      : {};
    const currency = String(source.currency ?? source.household?.currency ?? "AUD").trim().toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : "AUD";
  }

  async initialise(): Promise<void> {
    await this.sync.initialise();
    const cleanupLatch = await getCleanupLatch();
    this.cleanupLatchOwnerId = cleanupLatch?.ownerId ?? null;
    this.cleanupBlocked = cleanupLatch !== null;
    this.state.metadata = this.sync.metadata;
    const shouldOpenAccount = this.consumeAccountRedirect();
    const billingRedirect = this.consumeBillingRedirect();
    const calendarRedirect = this.consumeCalendarRedirect();
    this.bindCalendarControls();
    this.accountButton.addEventListener("click", () => {
      this.render();
      this.openAccountDialog();
    });
    this.dialog.addEventListener("click", (event) => this.handleClick(event));
    this.dialog.addEventListener("change", (event) => void this.handleCalendarPreferenceChange(event));
    this.dialog.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.closeAccountDialog();
    });
    this.dialog.addEventListener("close", () => {
      if (this.dialogHistoryActive) {
        this.dialogHistoryActive = false;
        history.back();
      }
      const returnFocus = this.dialogReturnFocus;
      this.dialogReturnFocus = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    });
    window.addEventListener("popstate", () => {
      if (!this.dialog.open) return;
      this.dialogHistoryActive = false;
      this.dialog.close();
    });
    this.newsDialog.addEventListener("click", (event) => this.handleNewsClick(event));

    if (!this.cloud.configured) {
      this.render();
      if (shouldOpenAccount) this.openAccountDialog(false);
      return;
    }

    const recoveryRedirect = this.consumeRecoveryRedirect();
    this.pendingRecoveryRedirect = recoveryRedirect;
    this.cloud.onAuthChange((event, session) => {
      const adoptedSession = verifiedSession(session);
      if (session && !adoptedSession) {
        void this.cloud.signOut().catch(reportError);
      }
      const authEventGeneration = ++this.authEventGeneration;
      const recoveryRedirectAtEvent = this.pendingRecoveryRedirect;
      void this.handleSessionChange(adoptedSession, event).then((accepted) => {
        if (!accepted || authEventGeneration !== this.authEventGeneration) return;
        if (event === "PASSWORD_RECOVERY") this.openRecoveryMode();
        if (shouldNotifySignupForAuthEvent(
          event,
          this.recoveryMode,
          recoveryRedirectAtEvent,
          this.recoveryFlowUserId,
          adoptedSession?.user.id ?? null
        )) {
          void this.notifySignupIfCurrent();
        }
        void this.refreshAccount();
        if (event === "PASSWORD_RECOVERY" && !this.dialog.open) {
          this.openAccountDialog(false);
        }
      });
    });
    const initialSession = await this.cloud.getSession();
    const adoptedInitialSession = verifiedSession(initialSession);
    if (initialSession && !adoptedInitialSession) {
      void this.cloud.signOut().catch(reportError);
    }
    const initialSessionAccepted = await this.handleSessionChange(adoptedInitialSession);
    if (initialSessionAccepted && adoptedInitialSession) {
      await this.refreshAccount();
    }
    this.handleBillingRedirect(billingRedirect);
    this.handleCalendarRedirect(calendarRedirect);
    if (billingRedirect || calendarRedirect) {
      if (!this.dialog.open) this.openAccountDialog(false);
    } else if (shouldOpenAccount && this.state.session) {
      this.openAccountDialog(false);
    } else if (shouldOpenAccount && !this.dialog.open) {
      this.openAccountDialog(false);
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
      if (this.billingReconciled && this.subscriptionActive) {
        this.billingConfirmationPending = false;
        this.notice = "Payment confirmed. Your Harbourline plan is active.";
        this.render();
        return;
      }
      this.billingConfirmationPending = true;
      this.notice = "Checking your Harbourline plan status…";
      this.waitForSubscriptionConfirmation();
    }
  }

  private handleCalendarRedirect(calendar: "connected" | "error" | null): void {
    if (calendar && !this.hasConfirmedPaidAccess()) return;
    if (calendar === "connected") {
      this.notice = "Google Calendar connected. Use Sync Google Calendar when you want to refresh its events.";
    } else if (calendar === "error") {
      this.notice = "Google Calendar could not be connected. Check the permission request and try again.";
    }
  }

  private waitForSubscriptionConfirmation(attempt = 1): void {
    const sessionGeneration = this.sessionGeneration;
    const actionGeneration = this.actionGeneration;
    const accountRefreshGeneration = this.accountRefreshGeneration;
    window.setTimeout(async () => {
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        !this.state.session ||
        (this.billingReconciled && this.subscriptionActive)
      ) return;
      await this.refreshAccount();
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        this.accountRefreshGeneration !== accountRefreshGeneration + 1
      ) return;
      if (this.billingReconciled && this.subscriptionActive) {
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
    const userId = this.state.session?.user.id ?? null;
    if (!userId) return;
    this.recoveryFlowUserId = userId;
    this.pendingRecoveryRedirect = false;
    this.pendingRecoveryUserId = userId;
    this.recoveryMode = true;
    this.notice = "Your recovery link is verified. Choose a new password.";
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

  private openAccountDialog(trackHistory = true): void {
    if (this.dialog.open) return;
    this.dialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : this.accountButton;
    this.dialogHistoryActive = trackHistory;
    if (trackHistory) {
      history.pushState({ ...(history.state ?? {}), harbourlineDialog: "account" }, "", location.href);
    }
    this.dialog.showModal();
    const firstFocusable = this.dialog.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]"
    );
    firstFocusable?.focus();
  }

  private closeAccountDialog(): void {
    if (this.dialog.open) this.dialog.close();
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
    const adoptedSession = verifiedSession(session);
    this.state.session = adoptedSession;
    this.state.user = adoptedSession?.user ?? null;
    this.updateAccountButton();
    this.updateAccessGate();
  }

  private async handleSessionChange(
    session: Session | null,
    authEvent: AuthChangeEvent | null = null
  ): Promise<boolean> {
    const adoptedSession = verifiedSession(session);
    const previousUserId = this.state.user?.id ?? null;
    const nextUserId = adoptedSession?.user.id ?? null;
    if (previousUserId !== nextUserId) {
      const preserveRecovery = shouldPreserveRecoveryForSession(
        this.pendingRecoveryRedirect,
        previousUserId,
        nextUserId,
        authEvent
      );
      this.pendingRecoveryRedirect = preserveRecovery;
      this.pendingRecoveryUserId = preserveRecovery && authEvent === "PASSWORD_RECOVERY"
        ? nextUserId
        : null;
      this.accountRefreshGeneration += 1;
      this.sessionGeneration += 1;
      this.actionGeneration += 1;
      const sessionChangeGeneration = this.accountRefreshGeneration;
      const sessionGeneration = this.sessionGeneration;
      this.busy = false;
      this.calendarBusy = false;
      this.calendarOperationGeneration += 1;
      this.sync.setCloudAccess(false, true);
      this.bridge.setUserScope(nextUserId);
      this.state.session = adoptedSession;
      this.state.user = adoptedSession?.user ?? null;
      this.resetCloudState(null);
      this.billingConfirmationPending = false;
      this.state.status = INITIAL_STATUS;
      this.notice = "";
      this.recoveryMode = false;
      if (!nextUserId || (this.recoveryFlowUserId && this.recoveryFlowUserId !== nextUserId)) {
        this.recoveryFlowUserId = null;
      }
      if (!nextUserId) {
        this.pendingRecoveryRedirect = false;
        this.pendingRecoveryUserId = null;
      }
      this.inviteToken = "";
      this.mfa = { verifiedCount: 0, currentLevel: null, nextLevel: null, enrollment: null };
      this.updateAccountButton();
      this.render();
      if (!await this.disconnectLocalSync(sessionGeneration, sessionChangeGeneration)) return false;
      if (
        sessionChangeGeneration !== this.accountRefreshGeneration ||
        sessionGeneration !== this.sessionGeneration
      ) return false;
      this.applySession(adoptedSession);
      return true;
    }
    this.applySession(adoptedSession);
    return true;
  }

  private async notifySignupIfCurrent(): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const userId = session.user.id;
    const sessionGeneration = this.sessionGeneration;
    const refreshGeneration = this.accountRefreshGeneration;
    try {
      await this.cloud.notifySignupNotification(session.access_token);
    } catch (error) {
      console.warn("Signup notification event could not be recorded", error);
      return;
    }
    if (
      this.sessionGeneration !== sessionGeneration ||
      this.accountRefreshGeneration !== refreshGeneration ||
      this.state.user?.id !== userId
    ) return;
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
    button.disabled = this.calendarBusy || !this.hasConfirmedPaidAccess();
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
    const sessionGeneration = this.sessionGeneration;
    const actionGeneration = ++this.actionGeneration;
    const refreshGeneration = this.accountRefreshGeneration;
    const current = this.bridge.read();
    const nextState = current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>), showExpenseNamesOnCalendar: enabled }
      : { showExpenseNamesOnCalendar: enabled };
    this.bridge.replace(nextState, "calendar-settings");
    this.notice = enabled
      ? "Expense names enabled. Updating your connected Google Calendar…"
      : "Generic calendar titles restored. Updating your connected Google Calendar…";
    this.render();

    if (!this.googleCalendarStatus.connected || !this.hasConfirmedPaidAccess()) {
      this.notice = enabled
        ? "Expense names will be used the next time you sync Google Calendar."
        : "Generic titles will be used the next time you sync Google Calendar.";
      this.render();
      return;
    }

    this.calendarBusy = true;
    const calendarOperationGeneration = ++this.calendarOperationGeneration;
    this.updateCalendarControls();
    try {
      const nextStatus = await this.calendarSync.sync();
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        refreshGeneration !== this.accountRefreshGeneration ||
        calendarOperationGeneration !== this.calendarOperationGeneration ||
        !this.hasConfirmedPaidAccess()
      ) return;
      this.googleCalendarStatus = nextStatus;
      this.notice = enabled
        ? "Expense names are now shown in your Google Calendar bill events."
        : "Google Calendar bill events now use generic titles.";
    } catch (error) {
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        refreshGeneration !== this.accountRefreshGeneration ||
        calendarOperationGeneration !== this.calendarOperationGeneration
      ) return;
      reportError(error);
      this.notice = error instanceof Error
        ? `${error.message} The preference was saved and will apply on the next successful sync.`
        : "Google Calendar could not be updated. The preference was saved for the next sync.";
    } finally {
      if (calendarOperationGeneration !== this.calendarOperationGeneration) return;
      this.calendarBusy = false;
      this.updateCalendarControls();
      this.render();
    }
  }

  private async handleCalendarButton(): Promise<void> {
    if (this.calendarBusy) return;
    if (!this.hasConfirmedPaidAccess()) {
      this.notice = this.state.session
        ? "Google Calendar sync is available after your Harbourline plan is active."
        : "Sign in and subscribe to connect Google Calendar.";
      this.render();
      if (!this.dialog.open) this.openAccountDialog();
      return;
    }
    const sessionGeneration = this.sessionGeneration;
    const actionGeneration = this.actionGeneration;
    const refreshGeneration = this.accountRefreshGeneration;
    this.calendarBusy = true;
    const calendarOperationGeneration = ++this.calendarOperationGeneration;
    this.updateCalendarControls();
    try {
      if (!this.googleCalendarStatus.connected) {
        const url = await this.calendarSync.connect();
        if (
          sessionGeneration !== this.sessionGeneration ||
          actionGeneration !== this.actionGeneration ||
          refreshGeneration !== this.accountRefreshGeneration ||
          calendarOperationGeneration !== this.calendarOperationGeneration ||
          !this.hasConfirmedPaidAccess()
        ) return;
        if (url) window.location.assign(url);
        return;
      }
      const nextStatus = await this.calendarSync.sync();
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        refreshGeneration !== this.accountRefreshGeneration ||
        calendarOperationGeneration !== this.calendarOperationGeneration ||
        !this.hasConfirmedPaidAccess()
      ) return;
      this.googleCalendarStatus = nextStatus;
      this.notice = "Google Calendar is up to date with your planned paydays and bill dates.";
    } catch (error) {
      if (
        sessionGeneration !== this.sessionGeneration ||
        actionGeneration !== this.actionGeneration ||
        refreshGeneration !== this.accountRefreshGeneration ||
        calendarOperationGeneration !== this.calendarOperationGeneration
      ) return;
      reportError(error);
      this.notice = error instanceof Error ? error.message : "Google Calendar could not be updated.";
    } finally {
      if (calendarOperationGeneration !== this.calendarOperationGeneration) return;
      this.calendarBusy = false;
      this.updateCalendarControls();
      this.render();
    }
  }

  private async refreshAccount(): Promise<void> {
    const refreshGeneration = ++this.accountRefreshGeneration;
    if (this.cleanupBlocked) {
      if (!await this.disconnectLocalSync(this.sessionGeneration, refreshGeneration)) return;
      if (
        this.cleanupBlocked ||
        refreshGeneration !== this.accountRefreshGeneration
      ) return;
    }
    if (!this.state.session) {
      if (!await this.disconnectLocalSync(this.sessionGeneration, refreshGeneration)) return;
      if (refreshGeneration !== this.accountRefreshGeneration) return;
      await this.onboarding.refresh({ session: null, subscriptionActive: false, households: [] });
      if (refreshGeneration !== this.accountRefreshGeneration) return;
      this.resetCloudState(null);
      this.billingConfirmationPending = false;
      this.billingSubscription = null;
      this.mfa = { verifiedCount: 0, currentLevel: null, nextLevel: null, enrollment: null };
      this.render();
      return;
    }
    this.resetCloudState(null);
    await this.sync.suspendCloudAccess(true);
    if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
    let calendarRefreshGeneration = this.calendarOperationGeneration;
    try {
      const billingReconciliation = await this.cloud.reconcileBillingSubscription();
      if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
      this.billingReconciled = billingReconciliation.reconciled === true;
      const subscriptionActive = billingReconciliation.reconciled === true && Boolean(billingReconciliation.active);
      const billingSubscription = billingReconciliation.subscription;
      const mfa = this.billingReconciled
        ? await this.cloud.getMfaState()
        : { verified: [], currentLevel: null, nextLevel: null };
      if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
      let households: HouseholdSummary[] = [];
      let googleCalendarStatus = emptyGoogleCalendarStatus();
      if (subscriptionActive) {
        households = await this.cloud.listHouseholds();
      }
      if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
      this.state.households = households;
      this.subscriptionActive = subscriptionActive;
      this.workspaceAccess = resolveWorkspaceAccess({
        signedIn: isVerifiedAccountUser(this.state.user),
        billingReconciled: this.billingReconciled,
        subscriptionActive
      });
      if (!subscriptionActive) {
        if (!await this.disconnectLocalSync(this.sessionGeneration, refreshGeneration)) return;
        if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
        this.state.metadata = null;
      }
      if (subscriptionActive) this.billingConfirmationPending = false;
      this.billingSubscription = billingSubscription;
      const metadata = this.sync.metadata;
      const linked = metadata?.householdId ?? null;
      const metadataAuthorized = Boolean(
        metadata &&
        metadata.ownerId === this.state.user?.id &&
        households.some((household) => household.id === metadata.householdId)
      );
      if (metadata && !metadataAuthorized) {
        if (!await this.disconnectLocalSync(this.sessionGeneration, refreshGeneration)) return;
        if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
      }
      this.state.metadata = metadataAuthorized ? metadata : null;
      if (subscriptionActive && this.state.user?.id) {
        calendarRefreshGeneration = this.calendarOperationGeneration;
        googleCalendarStatus = await this.calendarSync.refresh();
        if (
          refreshGeneration !== this.accountRefreshGeneration ||
          calendarRefreshGeneration !== this.calendarOperationGeneration ||
          !this.state.session
        ) return;
      }
      this.googleCalendarStatus = googleCalendarStatus;
      this.updateCalendarControls();
      if (subscriptionActive && this.state.user?.id && !this.cleanupBlocked) {
        const cloudActivated = await withCleanupLatchLock(async () => {
          const remainingLatch = await getCleanupLatch();
          if (remainingLatch) return false;
          if (
            refreshGeneration !== this.accountRefreshGeneration ||
            !this.state.session ||
            !this.state.user?.id
          ) return false;
          this.sync.setCloudAccess(true, false, this.state.user.id);
          return true;
        });
        if (cloudActivated !== true) {
          this.cleanupBlocked = true;
          this.sync.setCloudAccess(false, true);
          return;
        }
      }
      this.mfa.verifiedCount = mfa.verified.length;
      this.mfa.currentLevel = mfa.currentLevel;
      this.mfa.nextLevel = mfa.nextLevel;
      if (subscriptionActive && linked && households.some((household) => household.id === linked)) {
        await this.sync.resumeForHousehold(linked);
      }
      if (refreshGeneration !== this.accountRefreshGeneration || !this.state.session) return;
      await this.onboarding.refresh({
        session: this.state.session,
        subscriptionActive: Boolean(subscriptionActive),
        households
      });
    } catch (error) {
      if (
        refreshGeneration !== this.accountRefreshGeneration ||
        calendarRefreshGeneration !== this.calendarOperationGeneration
      ) return;
      reportError(error);
      if (!await this.disconnectLocalSync(this.sessionGeneration, refreshGeneration)) return;
      if (refreshGeneration !== this.accountRefreshGeneration) return;
      this.resetCloudState(null);
      await this.onboarding.refresh({
        session: this.state.session,
        subscriptionActive: false,
        households: []
      });
      if (refreshGeneration !== this.accountRefreshGeneration) return;
      this.notice = error instanceof Error ? error.message : "Account details could not be loaded.";
    }
    if (refreshGeneration !== this.accountRefreshGeneration) return;
    this.updateAccountButton();
    this.render();
  }

  private resetCloudState(subscriptionActive: boolean | null): void {
    this.calendarOperationGeneration += 1;
    this.calendarBusy = false;
    this.state.households = [];
    this.state.metadata = null;
    this.state.conflict = null;
    this.subscriptionActive = subscriptionActive;
    this.billingReconciled = false;
    this.workspaceAccess = this.state.session ? "free" : "signed-out";
    this.billingSubscription = null;
    this.googleCalendarStatus = emptyGoogleCalendarStatus();
    this.calendarSync.reset();
    this.inviteToken = "";
    this.onboarding.dispose();
    this.updateCalendarControls();
  }

  private async recordCleanupFailure(error: unknown, ownerId: string): Promise<void> {
    this.cleanupBlocked = true;
    this.cleanupLatchOwnerId = ownerId;
    this.accountRefreshGeneration += 1;
    this.actionGeneration += 1;
    this.calendarOperationGeneration += 1;
    this.sync.setCloudAccess(false, true);
    let latchPersistenceError: unknown = null;
    try {
      const metadata = this.sync.metadata;
      await setCleanupLatch(
        ownerId,
        metadata?.ownerId === ownerId ? metadata.householdId : undefined
      );
    } catch (latchError) {
      latchPersistenceError = latchError;
      reportError(latchError);
    }
    reportError(error);
    if (this.state.user?.id !== ownerId && this.state.user?.id) return;
    this.resetCloudState(null);
    this.notice = latchPersistenceError
      ? "Cloud sync is unavailable and the cleanup failure could not be persisted. Keep this tab open and retry cleanup."
      : "Cloud sync is unavailable until local cleanup succeeds.";
    this.render();
    if (latchPersistenceError) {
      throw new Error("Cleanup failure could not be persisted.", { cause: latchPersistenceError });
    }
  }

  private async disconnectLocalSync(
    expectedSessionGeneration = this.sessionGeneration,
    expectedRefreshGeneration = this.accountRefreshGeneration
  ): Promise<boolean> {
    try {
      await this.sync.disconnectDevice(this.cleanupLatchOwnerId ?? undefined);
      if (
        expectedSessionGeneration !== this.sessionGeneration ||
        expectedRefreshGeneration !== this.accountRefreshGeneration
      ) return false;
      const latchOwnerId = this.cleanupLatchOwnerId;
      const cleanupLatch = latchOwnerId ? await getCleanupLatch() : null;
      if (
        expectedSessionGeneration !== this.sessionGeneration ||
        expectedRefreshGeneration !== this.accountRefreshGeneration
      ) return false;
      if (
        latchOwnerId &&
        cleanupLatch &&
        cleanupLatch.ownerId !== latchOwnerId
      ) {
        this.cleanupBlocked = true;
        return false;
      }
      if (latchOwnerId && cleanupLatch && !await clearCleanupLatch(cleanupLatch)) {
        this.cleanupBlocked = true;
        return false;
      }
      const authoritativeCleanupLatch = await getCleanupLatch();
      if (
        expectedSessionGeneration !== this.sessionGeneration ||
        expectedRefreshGeneration !== this.accountRefreshGeneration
      ) return false;
      if (authoritativeCleanupLatch) {
        this.cleanupBlocked = true;
        this.cleanupLatchOwnerId = authoritativeCleanupLatch.ownerId;
        return false;
      }
      if (
        expectedSessionGeneration !== this.sessionGeneration ||
        expectedRefreshGeneration !== this.accountRefreshGeneration ||
        latchOwnerId !== this.cleanupLatchOwnerId
      ) return false;
      this.cleanupLatchOwnerId = null;
      this.cleanupBlocked = false;
      return true;
    } catch (error) {
      if (
        expectedSessionGeneration !== this.sessionGeneration ||
        expectedRefreshGeneration !== this.accountRefreshGeneration
      ) return false;
      const ownerId = this.cleanupLatchOwnerId ?? this.sync.metadata?.ownerId ?? this.state.user?.id;
      if (ownerId) await this.recordCleanupFailure(error, ownerId);
      else {
        this.cleanupBlocked = true;
        reportError(error);
      }
      return false;
    }
  }

  private hasConfirmedPaidAccess(): boolean {
    return Boolean(
      this.state.session &&
      this.billingReconciled &&
      !this.cleanupBlocked &&
      this.subscriptionActive === true &&
      this.workspaceAccess === "paid"
    );
  }

  private render(): void {
    this.updateAccessGate();
    this.updateCalendarControls();
    const body = this.dialog.querySelector(".release2-dialog-body");
    if (!body) return;
    const hasVerifiedSession = isVerifiedAccountUser(this.state.user);
    body.innerHTML = !this.state.configured
      ? this.renderUnconfigured()
      : this.recoveryMode && hasVerifiedSession
        ? this.renderRecovery()
        : hasVerifiedSession
        ? this.renderSignedIn()
        : this.renderSignedOut();
  }

  private updateAccessGate(): void {
    this.workspaceAccess = resolveWorkspaceAccess({
      signedIn: isVerifiedAccountUser(this.state.user),
      billingReconciled: this.billingReconciled,
      subscriptionActive: this.subscriptionActive
    });
    const app = document.querySelector<HTMLElement>("main.app");
    const gateId = "release2-access-gate";
    const bannerId = "release2-free-starter-banner";
    let gate = document.querySelector<HTMLElement>(`#${gateId}`);
    let banner = document.querySelector<HTMLElement>(`#${bannerId}`);

    if (this.workspaceAccess === "signed-out") {
      app?.setAttribute("inert", "");
      app?.setAttribute("aria-hidden", "true");
      banner?.remove();
      const gateWasCreated = !gate;
      const gateHadFocus = Boolean(gate?.contains(document.activeElement));
      const documentNeedsGateFocus = document.activeElement === document.body;
      if (!gate) {
        gate = document.createElement("section");
        gate.id = gateId;
        gate.className = "release2-access-gate";
        gate.setAttribute("role", "dialog");
        gate.setAttribute("aria-modal", "true");
        gate.setAttribute("aria-labelledby", "release2AccessGateTitle");
        const accessGate = gate;
        accessGate.addEventListener("keydown", (event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            accessGate.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")
          );
          if (!focusable.length) return;
          const target = getFocusWrapTarget(
            focusable,
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
            event.shiftKey
          );
          if (!target) return;
          event.preventDefault();
          target.focus();
        });
        accessGate.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element) || !target.closest("[data-action='open-account']")) return;
          track("auth_gate_sign_in_clicked");
          this.render();
          if (!this.dialog.open) this.openAccountDialog();
        });
        document.body.append(accessGate);
      }
      gate.innerHTML = `
        <div class="release2-access-gate-card">
          <span class="eyebrow">Free Starter</span>
          <h1 id="release2AccessGateTitle">Create an account to start planning.</h1>
          <p>Sign up for a free Harbourline account, then sign in to use the local planner and exports. No payment is required. Upgrade later if you want cloud sync, household sharing or multi-device access.</p>
          <div class="release2-gate-actions">
            <button class="btn" type="button" data-action="open-account">Sign in</button>
            <a class="btn secondary" href="https://www.harbourline.app/#early-access" target="_blank" rel="noreferrer">Create free account</a>
          </div>
          <p class="release2-gate-note">Already registered? Sign in here. New accounts are created on the Harbourline homepage.</p>
        </div>
      `;
      if (!this.dialog.open && (gateWasCreated || gateHadFocus || documentNeedsGateFocus)) {
        gate.querySelector<HTMLElement>("[data-action='open-account']")?.focus();
      }
      return;
    }

    const focusGateTarget = gate?.contains(document.activeElement) ? this.accountButton : null;
    app?.removeAttribute("inert");
    app?.removeAttribute("aria-hidden");
    gate?.remove();
    focusGateTarget?.focus();
    if (this.workspaceAccess === "paid") {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement("section");
      banner.id = bannerId;
      banner.className = "release2-free-starter-banner";
      banner.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest("[data-action='open-account']")) return;
        track("free_starter_upgrade_clicked");
        this.render();
        if (!this.dialog.open) this.openAccountDialog();
      });
      document.body.prepend(banner);
    }
    if (!this.freeStarterViewed) {
      this.freeStarterViewed = true;
      track("free_starter_viewed");
    }
    banner.innerHTML = `
      <div class="release2-free-starter-copy">
        <span class="eyebrow">Free Starter</span>
        <strong>Your local planner is ready.</strong>
        <span>Account required. Plan and export on this device. Secure cloud sync, household sharing and Calendar sync are included with the paid plan.</span>
      </div>
      ${this.cloud.configured
        ? `<button class="btn secondary" type="button" data-action="open-account">Explore cloud sync</button>`
        : ""}
    `;
  }

  private updateAccountButton(): void {
    const signedIn = isVerifiedAccountUser(this.state.user);
    const active = signedIn && this.billingReconciled && this.subscriptionActive === true;
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
          <div><span>Currency</span><strong>${escapeHtml(BILLING_CURRENCY)}</strong></div>
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
        message: "Update your payment method to restore cloud sync, household sharing and multi-device access.",
        icon: "!"
      },
      "not-started": {
        eyebrow: "Account status",
        title: "Ready to unlock cloud continuity",
        message: "Complete secure payment to unlock cloud sync, household sharing and multi-device access.",
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
    const confirmedSubscriptionActive = this.billingReconciled && this.subscriptionActive === true;
    const periodEnd = formatBillingDate(billing?.current_period_end ?? null);
    const paymentNeedsAttention = this.billingReconciled && Boolean(billing && ["incomplete", "past_due", "unpaid"].includes(billing.status));
    const hasBillingPortal = this.billingReconciled && Boolean(billing?.stripe_customer_id);
    const planState: "active" | "pending" | "checking" | "attention" | "not-started" = !this.billingReconciled || this.subscriptionActive === null
      ? "checking"
      : confirmedSubscriptionActive
        ? "active"
        : this.billingConfirmationPending
          ? "pending"
          : paymentNeedsAttention
            ? "attention"
            : "not-started";
    const planMessage = confirmedSubscriptionActive
      ? billing?.cancel_at_period_end
        ? `Your plan is active until ${periodEnd ?? "the end of the current billing period"}. Cancellation is scheduled after that date.`
        : `Household sync is available across supported devices${periodEnd ? `. Next billing is ${periodEnd}.` : "."}`
      : this.billingConfirmationPending
        ? "Your payment has been received. We’re waiting for the subscription confirmation before opening sync."
      : paymentNeedsAttention
        ? "A payment needs attention. Update your payment method or manage your subscription to restore cloud continuity."
        : "Secure payment is handled by our payment provider. Your local starter plan remains available on this device.";
    const planAction = confirmedSubscriptionActive
      ? hasBillingPortal
        ? `<div class="release2-plan-management"><div><strong>Manage your subscription</strong><p>Payment method, invoices and cancellation are handled securely by Stripe.</p></div><button class="btn secondary" type="button" data-action="open-billing-portal" ${this.busy ? "disabled" : ""}>Manage subscription</button></div>`
        : `<span class="badge release2-plan-badge is-active"><span class="release2-badge-dot" aria-hidden="true"></span>Subscribed</span>`
      : !this.billingReconciled || this.subscriptionActive === null || this.billingConfirmationPending
        ? `<div class="release2-button-row"><span class="badge release2-plan-badge is-pending">${this.subscriptionActive === null ? "Checking" : "Confirming"}</span><button class="btn secondary" type="button" data-action="refresh-subscription" ${this.busy ? "disabled" : ""}>Check plan status</button></div>`
      : paymentNeedsAttention
        ? hasBillingPortal
          ? `<div class="release2-button-row"><span class="badge release2-plan-badge is-attention">Payment needed</span><button class="btn secondary" type="button" data-action="open-billing-portal" ${this.busy ? "disabled" : ""}>Manage subscription</button></div>`
          : `<span class="badge release2-plan-badge is-attention">Payment needed</span>`
      : `<button class="btn" type="button" data-action="start-checkout" ${this.busy ? "disabled" : ""}>Continue to secure payment</button>`;
    const accountStatusMessage = confirmedSubscriptionActive
      ? linkedHousehold
        ? status.message
        : "Plan active. Create or join a household to sync this device."
      : !this.billingReconciled || this.subscriptionActive === null
        ? "Checking your Harbourline plan…"
        : "Local starter ready. Subscribe to enable cloud sync.";
    const accountStatusDetail = confirmedSubscriptionActive
      ? linkedHousehold
        ? `${status.online ? "Online" : "Offline"}${status.queued ? ` · ${status.queued} queued` : ""} · ${linkedHousehold.name}`
        : `${status.online ? "Online" : "Offline"} · Sync ready when a household is connected`
      : `${status.online ? "Online" : "Offline"}${status.queued ? ` · ${status.queued} queued` : ""}`;
    return `
      ${this.renderNotice()}
      ${this.renderSubscriptionSummary(planState, periodEnd)}
      <section class="release2-sync-status release2-tone-${status.tone}">
        <span class="release2-status-dot"></span>
        <div>
          <strong>${escapeHtml(accountStatusMessage)}</strong>
          <span>${escapeHtml(accountStatusDetail)}</span>
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
          <div><span>Harbourline plan</span><h3>${escapeHtml(BILLING_PRICE_LABEL)} introductory early access</h3></div>
          <span class="badge release2-plan-badge ${planState === "active" ? "is-active" : planState === "attention" ? "is-attention" : planState === "pending" || planState === "checking" ? "is-pending" : ""}">${planState === "active" ? "Subscribed" : planState === "pending" ? "Confirming" : planState === "checking" ? "Checking" : planState === "attention" ? "Payment needed" : "One plan"}</span>
        </div>
        ${confirmedSubscriptionActive ? `<div class="release2-plan-confirmation" role="status"><span class="release2-plan-check" aria-hidden="true">✓</span><div><strong>Subscription active</strong><p>Payment confirmed. Harbourline is ready for household planning and sync.</p></div></div>` : ""}
        <p class="release2-empty">${planMessage}</p>
        <div class="release2-plan-actions">${planAction}</div>
      </section>
      ${confirmedSubscriptionActive
        ? `
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Calendar connection</span><h3>Google Calendar</h3></div>
          <span class="badge">${this.googleCalendarStatus.connected ? "Connected" : "Optional"}</span>
        </div>
        <p class="release2-empty">Sync planned paydays and bill due dates. Amounts and household details stay in Harbourline.</p>
        <label class="release2-calendar-title-option">
          <input type="checkbox" data-action="calendar-title-preference" ${showExpenseNamesOnCalendar ? "checked" : ""} ${this.busy || this.calendarBusy ? "disabled" : ""} />
          <span class="release2-calendar-title-mark" aria-hidden="true"></span>
          <span class="release2-calendar-title-copy">
            <strong>Show expense names on calendar</strong>
            <small>When enabled, bill events use titles such as “Rent due”. Expense names will be visible in Google Calendar.</small>
          </span>
        </label>
        <div class="release2-button-row">
          <button class="btn secondary" type="button" data-action="google-calendar-sync" ${this.busy || this.calendarBusy ? "disabled" : ""}>${this.googleCalendarStatus.connected ? "Sync now" : "Connect Google Calendar"}</button>
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
      `
        : `
      ${this.renderLockedFeature(
        "Cloud sync and household sharing",
        "Keep this plan available across devices, invite another person and protect your household copy with secure cloud sync."
      )}
      ${this.renderLockedFeature(
        "Google Calendar sync",
        "Send planned paydays and bill due dates to Google Calendar when you want your household plan beside the rest of your week."
      )}
      `}
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
        <p>Download a complete account copy at any time. Account deletion uses authenticator verification when an authenticator app is configured and cannot proceed while you own a household.</p>
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
          <span>${escapeHtml(household.role)} · ${escapeHtml(household.currency ?? "AUD")} · Version ${household.revision}${linked ? " · Synced here" : ""}</span>
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

  private renderLockedFeature(title: string, description: string): string {
    return `
      <section class="release2-section release2-locked-feature">
        <div class="release2-section-heading">
          <div><span>Paid household plan</span><h3>${escapeHtml(title)}</h3></div>
          <span class="badge">Unlock</span>
        </div>
        <p>${escapeHtml(description)}</p>
        ${this.renderCloudUnlockAction()}
      </section>
    `;
  }

  private renderCloudUnlockAction(): string {
    if (!this.cloud.configured) return `<p class="release2-empty">Online account services are not connected in this build.</p>`;
    if (!this.billingReconciled || this.subscriptionActive === null || this.billingConfirmationPending) {
      return `<button class="btn secondary" type="button" data-action="refresh-subscription" ${this.busy ? "disabled" : ""}>Check plan status</button>`;
    }
    if (this.billingSubscription && ["incomplete", "past_due", "unpaid"].includes(this.billingSubscription.status)) {
      return this.billingSubscription.stripe_customer_id
        ? `<button class="btn secondary" type="button" data-action="open-billing-portal" ${this.busy ? "disabled" : ""}>Manage subscription</button>`
        : `<span class="badge release2-plan-badge is-attention">Payment needed</span>`;
    }
    return `<button class="btn secondary" type="button" data-action="start-checkout" ${this.busy ? "disabled" : ""}>Unlock with ${escapeHtml(BILLING_PRICE_LABEL)}</button>`;
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
    const updated = new Intl.DateTimeFormat(BILLING_LOCALE, {
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
    const sessionGeneration = this.sessionGeneration;
    await this.run(async () => {
      const operationActionGeneration = this.actionGeneration;
      const isCurrent = (): boolean => (
        sessionGeneration === this.sessionGeneration &&
        operationActionGeneration === this.actionGeneration
      );
      if (action && PAID_CLOUD_ACTIONS.has(action) && !this.hasConfirmedPaidAccess()) {
        await this.refreshAccount();
        return;
      }
      if (action === "sign-in") {
        await this.cloud.signIn(formValue(form, "email"), formValue(form, "password"));
        if (!isCurrent()) return;
        this.notice = "Signed in.";
      } else if (action === "update-password") {
        const password = formValue(form, "password");
        if (password !== formValue(form, "confirmation")) {
          throw new Error("The passwords do not match.");
        }
        await this.cloud.updatePassword(password);
        if (!isCurrent()) return;
        this.recoveryMode = false;
        this.notice = "Password updated. You are signed in.";
        await this.refreshAccount();
        if (!isCurrent()) return;
      } else if (action === "create-household") {
        const householdId = await this.cloud.createHousehold(formValue(form, "name"), this.localCurrency());
        if (!isCurrent()) return;
        await this.refreshAccount();
        if (!isCurrent()) return;
        const linked = await this.sync.linkDevice(householdId, "device");
        if (!isCurrent() || !this.hasConfirmedPaidAccess() || !linked) return;
        this.notice = "Household created and this device budget is now synced.";
      } else if (action === "create-invite") {
        const householdId = this.sync.metadata?.householdId;
        if (!householdId) throw new Error("Connect a household on this device first.");
        const invite = await this.cloud.createInvite(householdId, formValue(form, "email"));
        if (!isCurrent() || !this.hasConfirmedPaidAccess()) return;
        this.inviteToken = invite.token;
        this.notice = "Invite created. Share the private code with that person.";
      } else if (action === "accept-invite") {
        const householdId = await this.cloud.acceptInvite(formValue(form, "token"));
        if (!isCurrent()) return;
        await this.refreshAccount();
        if (!isCurrent() || !this.hasConfirmedPaidAccess()) return;
        this.notice = "Household joined. Choose which budget copy to use on this device.";
        const joined = this.state.households.find((household) => household.id === householdId);
        if (!joined) {
          await this.refreshAccount();
          if (!isCurrent() || !this.hasConfirmedPaidAccess()) return;
        }
      } else if (action === "verify-mfa") {
        if (!this.mfa.enrollment) throw new Error("Start authenticator setup first.");
        await this.cloud.verifyMfa(this.mfa.enrollment.factorId, formValue(form, "code"));
        if (!isCurrent()) return;
        this.mfa.enrollment = null;
        this.notice = "Authenticator protection is active.";
        await this.refreshAccount();
        if (!isCurrent()) return;
      }
      if (!isCurrent()) return;
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
      if (!this.dialog.open) this.openAccountDialog();
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
      this.closeAccountDialog();
      return;
    }
    if (action === "support") {
      const sessionGeneration = this.sessionGeneration;
      const actionGeneration = ++this.actionGeneration;
      const householdId = this.sync.metadata?.householdId;
      void (async () => {
        if (!this.state.session) return;
        try {
          await this.cloud.recordBetaEvent("support_requested", householdId);
          if (sessionGeneration !== this.sessionGeneration || actionGeneration !== this.actionGeneration) return;
        } catch {
          if (sessionGeneration !== this.sessionGeneration || actionGeneration !== this.actionGeneration) return;
        }
      })();
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
      const operationSessionGeneration = this.sessionGeneration;
      const operationActionGeneration = this.actionGeneration;
      const operationRefreshGeneration = this.accountRefreshGeneration;
      if (PAID_CLOUD_ACTIONS.has(action) && !this.hasConfirmedPaidAccess()) {
        await this.refreshAccount();
        return;
      }
      if (action === "open-billing-portal") {
        const paymentNeedsAttention = Boolean(
          this.billingSubscription && ["incomplete", "past_due", "unpaid"].includes(this.billingSubscription.status)
        );
        const canManageBilling = Boolean(
          this.state.session &&
          this.billingReconciled &&
          (this.subscriptionActive === true || (paymentNeedsAttention && this.billingSubscription?.stripe_customer_id))
        );
        if (!canManageBilling) {
          await this.refreshAccount();
          return;
        }
      }
      if (action === "google-sign-in") {
        await this.cloud.signInWithGoogle();
      } else if (action === "magic-link") {
        const form = button.closest("form");
        if (!(form instanceof HTMLFormElement)) return;
        const email = formValue(form, "email");
        if (!email) throw new Error("Enter your email address first.");
        await this.cloud.sendMagicLink(email);
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        this.notice = "Check your email for a secure sign-in link.";
      } else if (action === "password-reset") {
        const form = button.closest("form");
        if (!(form instanceof HTMLFormElement)) return;
        const email = formValue(form, "email");
        if (!email) throw new Error("Enter your email address first.");
        await this.cloud.sendPasswordReset(email);
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        this.notice = "Check your email for a password recovery link.";
      } else if (action === "sign-out") {
        await this.cloud.signOut();
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        this.notice = "Signed out. This device is ready for another account.";
      } else if (action === "start-checkout") {
        const paymentNeedsAttention = Boolean(
          this.billingSubscription && ["incomplete", "past_due", "unpaid"].includes(this.billingSubscription.status)
        );
        if (!this.state.session || this.subscriptionActive !== false || !this.billingReconciled || this.billingConfirmationPending || paymentNeedsAttention) {
          await this.refreshAccount();
          return;
        }
        const checkoutUrl = await this.cloud.createCheckoutSession();
        if (
          operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration ||
          operationRefreshGeneration !== this.accountRefreshGeneration ||
          !this.state.session ||
          !this.billingReconciled ||
          this.subscriptionActive !== false ||
          this.billingConfirmationPending
        ) return;
        window.location.assign(checkoutUrl);
      } else if (action === "refresh-subscription") {
        const refreshGeneration = this.accountRefreshGeneration;
        await this.refreshAccount();
        if (
          operationSessionGeneration !== this.sessionGeneration ||
          operationActionGeneration !== this.actionGeneration ||
          this.accountRefreshGeneration !== refreshGeneration + 1
        ) return;
        this.notice = this.billingReconciled && this.subscriptionActive
          ? "Payment confirmed. Your Harbourline plan is active."
          : "Your plan is still being confirmed. Check again shortly.";
      } else if (action === "google-calendar-sync") {
        await this.handleCalendarButton();
      } else if (action === "google-calendar-disconnect") {
        const sessionGeneration = this.sessionGeneration;
        const calendarActionGeneration = this.actionGeneration;
        const calendarRefreshGeneration = this.accountRefreshGeneration;
        const deleteEvents = confirm("Also remove the Harbourline-created events from Google Calendar?");
        if (!deleteEvents && !this.googleCalendarStatus.connected) return;
        const calendarOperationGeneration = ++this.calendarOperationGeneration;
        this.calendarBusy = true;
        this.updateCalendarControls();
        try {
          await this.calendarSync.disconnect(deleteEvents);
          if (
            sessionGeneration !== this.sessionGeneration ||
            calendarActionGeneration !== this.actionGeneration ||
            calendarRefreshGeneration !== this.accountRefreshGeneration ||
            calendarOperationGeneration !== this.calendarOperationGeneration ||
            !this.hasConfirmedPaidAccess()
          ) return;
          this.googleCalendarStatus = this.calendarSync.currentStatus;
          this.notice = deleteEvents
            ? "Google Calendar disconnected and Harbourline-created events removed."
            : "Google Calendar disconnected. Existing events were left in place.";
        } catch (error) {
          if (
            sessionGeneration === this.sessionGeneration &&
            calendarActionGeneration === this.actionGeneration &&
            calendarRefreshGeneration === this.accountRefreshGeneration &&
            calendarOperationGeneration === this.calendarOperationGeneration
          ) {
            reportError(error);
            this.notice = error instanceof Error ? error.message : "Google Calendar could not be disconnected.";
          }
        } finally {
          if (
            sessionGeneration !== this.sessionGeneration ||
            calendarActionGeneration !== this.actionGeneration ||
            calendarRefreshGeneration !== this.accountRefreshGeneration ||
            calendarOperationGeneration !== this.calendarOperationGeneration
          ) return;
          this.calendarBusy = false;
          this.updateCalendarControls();
        }
      } else if (action === "open-billing-portal") {
        const portalUrl = await this.cloud.createBillingPortalSession();
        const paymentNeedsAttention = Boolean(
          this.billingSubscription && ["incomplete", "past_due", "unpaid"].includes(this.billingSubscription.status)
        );
        const canManageBilling = Boolean(
          this.state.session &&
          this.billingReconciled &&
          (this.subscriptionActive === true || (paymentNeedsAttention && this.billingSubscription?.stripe_customer_id))
        );
        if (
          operationSessionGeneration !== this.sessionGeneration ||
          operationActionGeneration !== this.actionGeneration ||
          operationRefreshGeneration !== this.accountRefreshGeneration ||
          !canManageBilling
        ) return;
        window.location.assign(portalUrl);
      } else if (action === "link-device" || action === "link-household") {
        const householdId = button.dataset.household;
        if (!householdId) return;
        const linked = await this.sync.linkDevice(householdId, action === "link-device" ? "device" : "household");
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration || !this.hasConfirmedPaidAccess() || !linked) return;
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
        if (!await this.disconnectLocalSync(operationSessionGeneration, operationRefreshGeneration)) return;
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        this.state.metadata = null;
      } else if (action === "copy-invite") {
        await navigator.clipboard.writeText(this.inviteToken);
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration || !this.hasConfirmedPaidAccess()) return;
        this.notice = "Invite code copied.";
      } else if (action === "start-mfa") {
        const enrollment = await this.cloud.startMfaEnrollment();
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        this.mfa.enrollment = enrollment;
        this.notice = "Scan the code to finish authenticator setup.";
      } else if (action === "export-account") {
        const accountExport = await this.cloud.exportAccount();
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        downloadJson(accountExport, `harbourline-account-${new Date().toISOString().slice(0, 10)}.json`);
        this.notice = "Account copy downloaded.";
      } else if (action === "delete-account") {
        const confirmed = prompt('Type "DELETE MY HARBOURLINE ACCOUNT" to permanently delete your account.');
        if (confirmed !== "DELETE MY HARBOURLINE ACCOUNT") {
          this.notice = "Account deletion cancelled.";
          return;
        }
        await this.cloud.deleteAccount();
        if (operationSessionGeneration !== this.sessionGeneration || operationActionGeneration !== this.actionGeneration) return;
        let signOutError: unknown = null;
        try {
          await this.cloud.signOut();
        } catch (error) {
          signOutError = error;
        }
        if (this.state.user) await this.handleSessionChange(null, "SIGNED_OUT");
        if (signOutError) throw signOutError;
      }
    });
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    const actionGeneration = ++this.actionGeneration;
    const sessionGeneration = this.sessionGeneration;
    this.busy = true;
    this.notice = "";
    this.render();
    try {
      await operation();
      if (actionGeneration !== this.actionGeneration || sessionGeneration !== this.sessionGeneration) return;
      await this.refreshAccount();
    } catch (error) {
      if (actionGeneration !== this.actionGeneration || sessionGeneration !== this.sessionGeneration) return;
      reportError(error);
      this.notice = error instanceof Error ? error.message : "That action could not be completed.";
    } finally {
      if (actionGeneration !== this.actionGeneration || sessionGeneration !== this.sessionGeneration) return;
      this.busy = false;
      this.state.metadata = this.sync.metadata;
      this.state.conflict = this.sync.conflict;
      this.render();
    }
  }
}
