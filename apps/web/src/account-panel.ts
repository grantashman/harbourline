import type { Session } from "@supabase/supabase-js";
import type { HouseholdSummary, RemoteBudgetDocument } from "@harbourline/sync";
import { HarbourlineCloud } from "./cloud";
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

export class AccountPanel {
  private readonly cloud = new HarbourlineCloud();
  private readonly sync: SyncController;
  private readonly dialog: HTMLDialogElement;
  private readonly accountButton: HTMLButtonElement;
  private state: AccountState;
  private notice = "";
  private busy = false;
  private subscriptionActive: boolean | null = null;
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
    this.accountButton = this.createAccountButton();
    this.dialog = this.createDialog();
    this.updateAccessGate();
  }

  async initialise(): Promise<void> {
    await this.sync.initialise();
    this.state.metadata = this.sync.metadata;
    const shouldOpenAccount = this.consumeAccountRedirect();
    this.accountButton.addEventListener("click", () => {
      this.render();
      this.dialog.showModal();
    });
    this.dialog.addEventListener("click", (event) => this.handleClick(event));
    this.dialog.addEventListener("submit", (event) => void this.handleSubmit(event));
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });

    if (!this.cloud.configured) {
      this.render();
      if (shouldOpenAccount) this.dialog.showModal();
      return;
    }

    this.pendingRecoveryRedirect = this.consumeRecoveryRedirect();
    this.applySession(await this.cloud.getSession());
    this.openPendingRecoveryIfReady();
    this.cloud.onAuthChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        this.openRecoveryMode();
      }
      this.applySession(session);
      this.openPendingRecoveryIfReady();
      void this.refreshAccount();
      if (event === "PASSWORD_RECOVERY" && !this.dialog.open) {
        this.dialog.showModal();
      }
    });
    await this.refreshAccount();
    if (shouldOpenAccount && !this.dialog.open) this.dialog.showModal();
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

  private applySession(session: Session | null): void {
    this.state.session = session;
    this.state.user = session?.user ?? null;
    this.accountButton.classList.toggle("release2-signed-in", Boolean(session));
    this.accountButton.textContent = session ? "Account · On" : "Account";
  }

  private async refreshAccount(): Promise<void> {
    if (!this.state.session) {
      this.state.households = [];
      this.subscriptionActive = null;
      this.mfa = { verifiedCount: 0, currentLevel: null, nextLevel: null, enrollment: null };
      this.render();
      return;
    }
    try {
      const [households, mfa, subscriptionActive] = await Promise.all([
        this.cloud.listHouseholds(),
        this.cloud.getMfaState(),
        this.cloud.hasActiveSubscription()
      ]);
      this.state.households = households;
      this.subscriptionActive = subscriptionActive;
      this.state.metadata = this.sync.metadata;
      this.mfa.verifiedCount = mfa.verified.length;
      this.mfa.currentLevel = mfa.currentLevel;
      this.mfa.nextLevel = mfa.nextLevel;
      const linked = this.state.metadata?.householdId;
      if (subscriptionActive && linked && households.some((household) => household.id === linked)) {
        await this.sync.resumeForHousehold(linked);
      }
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "Account details could not be loaded.";
    }
    this.render();
  }

  private render(): void {
    this.updateAccessGate();
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
    gate.innerHTML = `
      <div class="release2-access-gate-card">
        <span class="eyebrow">Harbourline</span>
        <h1>${this.state.session ? "Complete your Harbourline plan" : "Your money plan starts here"}</h1>
        <p>${this.state.session
          ? "Your account is ready. Continue to secure payment to unlock your household planning workspace and cloud sync."
          : "Sign in or create your Harbourline account to access the hosted planning workspace."}</p>
        <button class="btn" type="button" data-action="open-account">${this.state.session ? "Continue to payment" : "Sign in to continue"}</button>
      </div>
    `;
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
          <p>Sign in securely to access your household plan across supported devices. New accounts are created on the public Harbourline homepage.</p>
        </div>
      </section>
      <div class="release2-auth-grid">
        <form class="release2-section" data-form="sign-in">
          <div class="release2-section-heading">
            <div><span>Welcome back</span><h3>Sign in</h3></div>
          </div>
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
          <button class="btn" type="submit" ${this.busy ? "disabled" : ""}>Sign in</button>
          <button class="btn secondary" type="button" data-action="magic-link" ${this.busy ? "disabled" : ""}>Email a sign-in link</button>
          <button class="btn secondary" type="button" data-action="password-reset" ${this.busy ? "disabled" : ""}>Forgot password?</button>
        </form>
        <section class="release2-section">
          <div class="release2-section-heading">
            <div><span>New accounts</span><h3>Join from the homepage</h3></div>
          </div>
          <p class="release2-empty">Account creation is handled on the Harbourline homepage. Create your account there, then return here to sign in and continue to secure payment.</p>
          <a class="btn secondary" href="https://grantashman.github.io/harbourline/#early-access" target="_blank" rel="noreferrer">Create account on homepage</a>
        </section>
      </div>
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
        <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required /></label>
        <label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" minlength="8" required /></label>
        <button class="btn" type="submit" ${this.busy ? "disabled" : ""}>Update password</button>
      </form>
    `;
  }

  private renderSignedIn(): string {
    const linkedId = this.sync.metadata?.householdId;
    const linkedHousehold = this.state.households.find((household) => household.id === linkedId);
    const status = this.state.status;
    return `
      ${this.renderNotice()}
      <section class="release2-sync-status release2-tone-${status.tone}">
        <span class="release2-status-dot"></span>
        <div>
          <strong>${escapeHtml(status.message)}</strong>
          <span>${status.online ? "Online" : "Offline"}${status.queued ? ` · ${status.queued} queued` : ""}${linkedHousehold ? ` · ${escapeHtml(linkedHousehold.name)}` : ""}</span>
        </div>
      </section>
      ${this.state.conflict ? this.renderConflict(this.state.conflict) : ""}
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Signed in as</span><h3>${escapeHtml(this.state.user?.email)}</h3></div>
          <button class="btn secondary" type="button" data-action="sign-out">Sign out</button>
        </div>
      </section>
      <section class="release2-section">
        <div class="release2-section-heading">
          <div><span>Harbourline plan</span><h3>A$2 first month, then A$5/month</h3></div>
          <span class="badge">One plan</span>
        </div>
        <p class="release2-empty">${this.subscriptionActive
          ? "Your Harbourline plan is active. Household sync is available across supported devices."
          : "Secure payment is handled by Stripe. Your financial information stays in Harbourline and your card details are never stored here."}</p>
        ${this.subscriptionActive
          ? `<span class="badge">Active</span>`
          : `<button class="btn" type="button" data-action="start-checkout" ${this.busy ? "disabled" : ""}>Continue to secure payment</button>`}
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

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("[data-action]");
    const action = button?.dataset.action;
    if (!action || this.busy) return;

    if (action === "close") {
      this.dialog.close();
      return;
    }
    void this.run(async () => {
      if (action === "magic-link") {
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
        await this.cloud.unsubscribeFromBudget();
        await this.cloud.signOut();
        this.notice = "Signed out. The cached budget remains on this device.";
      } else if (action === "start-checkout") {
        const checkoutUrl = await this.cloud.createCheckoutSession();
        window.location.assign(checkoutUrl);
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
      this.notice = error instanceof Error ? error.message : "That action could not be completed.";
    } finally {
      this.busy = false;
      this.state.metadata = this.sync.metadata;
      this.state.conflict = this.sync.conflict;
      this.render();
    }
  }
}
