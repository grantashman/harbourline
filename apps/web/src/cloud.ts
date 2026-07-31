import {
  createClient,
  type AuthChangeEvent,
  type RealtimeChannel,
  type Session,
  type SupabaseClient
} from "@supabase/supabase-js";
import type {
  HouseholdRole,
  HouseholdSummary,
  PendingMutation,
  RemoteBudgetDocument,
  SyncResult
} from "@harbourline/sync";
import type {
  BetaEventName,
  BetaOnboardingProgress,
  BetaOnboardingStep,
  BetaOperationsSnapshot
} from "./beta-types";

interface HouseholdMemberRow {
  household_id: string;
  role: HouseholdRole;
}

interface HouseholdRow {
  id: string;
  name: string;
  updated_at: string;
}

interface BudgetRow {
  household_id: string;
  revision: number;
  schema_version: number;
  state: unknown;
  updated_at: string;
}

export interface BillingSubscription {
  stripe_customer_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingReconciliation {
  active: boolean;
  reconciled: boolean;
  subscription: BillingSubscription | null;
}

export interface GoogleCalendarStatus {
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description: string;
  startDate: string;
  endDate: string;
}

export class HarbourlineCloud {
  readonly configured: boolean;
  readonly client: SupabaseClient | null;
  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeHouseholdId: string | null = null;
  private realtimeSetup: Promise<void> = Promise.resolve();

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    this.configured = Boolean(url && publishableKey);
    this.client = this.configured
      ? createClient(url, publishableKey, {
        auth: {
          // The public homepage and app use different origins. The homepage
          // therefore returns OAuth sessions in the URL fragment so the app
          // can consume them after the redirect.
          flowType: "implicit",
          persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        })
      : null;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new Error("Online accounts have not been connected for this build.");
    }
    return this.client;
  }

  async getSession(): Promise<Session | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  onAuthChange(callback: (event: AuthChangeEvent, session: Session | null) => void): () => void {
    if (!this.client) return () => undefined;
    const { data } = this.client.auth.onAuthStateChange(callback);
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signInWithGoogle(): Promise<void> {
    const redirectTo = `${location.origin}${location.pathname}?account=signin`;
    const { error } = await this.requireClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async sendMagicLink(email: string): Promise<void> {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await this.requireClient().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: false
      }
    });
    if (error) throw error;
  }

  async sendPasswordReset(email: string): Promise<void> {
    const redirectTo = `${location.origin}${location.pathname}?recovery=1`;
    const { error } = await this.requireClient().auth.resetPasswordForEmail(email, {
      redirectTo
    });
    if (error) throw error;
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.requireClient().auth.updateUser({ password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.requireClient().auth.signOut({ scope: "local" });
    if (error) throw error;
  }

  async createCheckoutSession(): Promise<string> {
    const { data, error } = await this.requireClient().functions.invoke("create-checkout-session", {
      method: "POST",
      body: {}
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      const detail = response ? await response.text() : "";
      throw new Error(detail || error.message);
    }
    const url = (data as { url?: string } | null)?.url;
    if (!url) throw new Error("Checkout could not be started.");
    return url;
  }

  async createBillingPortalSession(): Promise<string> {
    const { data, error } = await this.requireClient().functions.invoke("create-billing-portal", {
      method: "POST",
      body: {}
    });
    if (error) {
      const response = (error as { context?: Response }).context;
      const detail = response ? await response.text() : "";
      throw new Error(detail || error.message);
    }
    const url = (data as { url?: string } | null)?.url;
    if (!url) throw new Error("Billing could not be opened.");
    return url;
  }

  async startGoogleCalendarConnect(returnPath = location.pathname): Promise<string> {
    const { data, error } = await this.requireClient().functions.invoke("google-calendar-start", {
      method: "POST",
      body: { returnPath }
    });
    if (error) throw await this.functionError(error);
    const url = (data as { authorizationUrl?: string } | null)?.authorizationUrl;
    if (!url) throw new Error("Google Calendar connection could not be started.");
    return url;
  }

  async getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
    const { data, error } = await this.requireClient().functions.invoke("google-calendar-status", {
      method: "POST",
      body: {}
    });
    if (error) throw await this.functionError(error);
    return data as GoogleCalendarStatus;
  }

  async syncGoogleCalendar(events: GoogleCalendarEvent[]): Promise<GoogleCalendarStatus> {
    const { data, error } = await this.requireClient().functions.invoke("google-calendar-sync", {
      method: "POST",
      body: { events }
    });
    if (error) throw await this.functionError(error);
    return data as GoogleCalendarStatus;
  }

  async disconnectGoogleCalendar(deleteEvents: boolean): Promise<void> {
    const { error } = await this.requireClient().functions.invoke("google-calendar-disconnect", {
      method: "POST",
      body: { deleteEvents }
    });
    if (error) throw await this.functionError(error);
  }

  async getBillingSubscription(): Promise<BillingSubscription | null> {
    const { data, error } = await this.requireClient()
      .from("billing_subscriptions")
      .select("stripe_customer_id, status, current_period_end, cancel_at_period_end")
      .maybeSingle();
    if (error) throw error;
    return data as BillingSubscription | null;
  }

  async reconcileBillingSubscription(): Promise<BillingReconciliation> {
    const { data, error } = await this.requireClient().functions.invoke("reconcile-billing-subscription", {
      method: "POST",
      body: {}
    });
    if (error) throw await this.functionError(error);
    return data as BillingReconciliation;
  }

  async hasActiveSubscription(): Promise<boolean> {
    const { data, error } = await this.requireClient().rpc("has_active_subscription");
    if (error) throw error;
    return Boolean(data);
  }

  async getBetaOnboarding(): Promise<BetaOnboardingProgress | null> {
    const { data, error } = await this.requireClient().functions.invoke("record-beta-progress", {
      method: "POST",
      body: { action: "get" }
    });
    if (error) {
      if (this.functionStatus(error) === 404) return null;
      throw await this.functionError(error);
    }
    return data as BetaOnboardingProgress;
  }

  async saveBetaProgress(progress: {
    householdId: string | null;
    step: BetaOnboardingStep;
  }): Promise<BetaOnboardingProgress> {
    const { data, error } = await this.requireClient().functions.invoke("record-beta-progress", {
      method: "POST",
      body: { action: "progress", ...progress }
    });
    if (error) throw await this.functionError(error);
    return data as BetaOnboardingProgress;
  }

  async recordBetaEvent(eventName: BetaEventName, householdId?: string | null): Promise<void> {
    const { error } = await this.requireClient().functions.invoke("record-beta-progress", {
      method: "POST",
      body: {
        action: "event",
        eventName,
        ...(householdId === undefined ? {} : { householdId })
      }
    });
    if (error) throw await this.functionError(error);
  }

  async getBetaOperations(): Promise<BetaOperationsSnapshot | null> {
    const { data, error } = await this.requireClient().functions.invoke("get-beta-operations", {
      method: "POST",
      body: {}
    });
    if (error) {
      if (this.functionStatus(error) === 403) return null;
      throw await this.functionError(error);
    }
    return data as BetaOperationsSnapshot;
  }

  async listHouseholds(): Promise<HouseholdSummary[]> {
    const client = this.requireClient();
    const { data: membershipData, error: membershipError } = await client
      .from("household_members")
      .select("household_id, role");
    if (membershipError) throw membershipError;

    const memberships = (membershipData ?? []) as HouseholdMemberRow[];
    if (!memberships.length) return [];
    const ids = memberships.map((membership) => membership.household_id);

    const [{ data: householdData, error: householdError }, { data: budgetData, error: budgetError }] =
      await Promise.all([
        client.from("households").select("id, name, updated_at").in("id", ids),
        client.from("budget_documents").select("household_id, revision, updated_at").in("household_id", ids)
      ]);
    if (householdError) throw householdError;
    if (budgetError) throw budgetError;

    const households = new Map(
      ((householdData ?? []) as HouseholdRow[]).map((household) => [household.id, household])
    );
    const budgets = new Map(
      ((budgetData ?? []) as Pick<BudgetRow, "household_id" | "revision" | "updated_at">[])
        .map((budget) => [budget.household_id, budget])
    );

    return memberships.flatMap((membership) => {
      const household = households.get(membership.household_id);
      if (!household) return [];
      const budget = budgets.get(membership.household_id);
      return [{
        id: household.id,
        name: household.name,
        role: membership.role,
        revision: Number(budget?.revision ?? 0),
        updatedAt: budget?.updated_at ?? household.updated_at
      }];
    });
  }

  async createHousehold(name: string): Promise<string> {
    const { data, error } = await this.requireClient().rpc("create_household", {
      household_name: name
    });
    if (error) throw error;
    return String(data);
  }

  async createInvite(householdId: string, email: string): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const { data, error } = await this.requireClient().rpc("create_household_invite", {
      target_household: householdId,
      invite_email: email,
      expires_in_hours: 168
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as {
      invite_token: string;
      expires_at: string;
    } | null;
    if (!row) throw new Error("The invitation could not be created.");
    return { token: row.invite_token, expiresAt: row.expires_at };
  }

  async acceptInvite(token: string): Promise<string> {
    const { data, error } = await this.requireClient().rpc("accept_household_invite", {
      invite_token: token
    });
    if (error) throw error;
    return String(data);
  }

  async fetchBudget(householdId: string): Promise<RemoteBudgetDocument> {
    const { data, error } = await this.requireClient()
      .from("budget_documents")
      .select("household_id, revision, schema_version, state, updated_at")
      .eq("household_id", householdId)
      .single();
    if (error) throw error;
    return this.mapBudget(data as BudgetRow);
  }

  async syncBudget(mutation: PendingMutation): Promise<SyncResult> {
    const { data, error } = await this.requireClient().rpc("sync_budget", {
      target_household: mutation.householdId,
      mutation_id: mutation.id,
      base_revision: mutation.baseRevision,
      document_schema_version: mutation.schemaVersion,
      document_state: mutation.state,
      document_state_hash: mutation.stateHash
    });
    if (error) throw error;
    return data as SyncResult;
  }

  subscribeToBudget(householdId: string, callback: () => void): Promise<void> {
    this.realtimeSetup = this.realtimeSetup.then(async () => {
      if (this.realtimeChannel && this.realtimeHouseholdId === householdId) return;
      await this.removeRealtimeChannel();
      const client = this.requireClient();
      this.realtimeChannel = client
        .channel(`budget:${householdId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "budget_documents",
            filter: `household_id=eq.${householdId}`
          },
          callback
        )
        .subscribe();
      this.realtimeHouseholdId = householdId;
    });
    return this.realtimeSetup;
  }

  unsubscribeFromBudget(): Promise<void> {
    this.realtimeSetup = this.realtimeSetup.then(() => this.removeRealtimeChannel());
    return this.realtimeSetup;
  }

  private async removeRealtimeChannel(): Promise<void> {
    if (this.client && this.realtimeChannel) {
      await this.client.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.realtimeHouseholdId = null;
  }

  async exportAccount(): Promise<unknown> {
    const { data, error } = await this.requireClient().rpc("export_my_account");
    if (error) throw error;
    return data;
  }

  async getMfaState(): Promise<{
    verified: Array<{ id: string; friendlyName?: string }>;
    currentLevel: string | null;
    nextLevel: string | null;
  }> {
    const client = this.requireClient();
    const [{ data: factors, error: factorsError }, { data: assurance, error: assuranceError }] =
      await Promise.all([
        client.auth.mfa.listFactors(),
        client.auth.mfa.getAuthenticatorAssuranceLevel()
      ]);
    if (factorsError) throw factorsError;
    if (assuranceError) throw assuranceError;
    return {
      verified: factors.totp
        .filter((factor) => factor.status === "verified")
        .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name })),
      currentLevel: assurance.currentLevel,
      nextLevel: assurance.nextLevel
    };
  }

  async startMfaEnrollment(): Promise<{ factorId: string; qrCode: string; secret: string }> {
    const { data, error } = await this.requireClient().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Harbourline"
    });
    if (error) throw error;
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret
    };
  }

  async verifyMfa(factorId: string, code: string): Promise<void> {
    const client = this.requireClient();
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
      factorId
    });
    if (challengeError) throw challengeError;
    const { error } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code
    });
    if (error) throw error;
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.requireClient().functions.invoke("delete-account", {
      method: "DELETE",
      body: { confirmation: "DELETE MY HARBOURLINE ACCOUNT" }
    });
    if (error) throw error;
  }

  private functionStatus(error: unknown): number | null {
    const response = (error as { context?: Response }).context;
    return response?.status ?? null;
  }

  private async functionError(error: { context?: Response; message: string }): Promise<Error> {
    const detail = error.context ? await error.context.text() : "";
    return new Error(detail || error.message);
  }

  private mapBudget(row: BudgetRow): RemoteBudgetDocument {
    return {
      householdId: row.household_id,
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
      state: row.state,
      updatedAt: row.updated_at
    };
  }
}
