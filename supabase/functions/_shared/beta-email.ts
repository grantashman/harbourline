export type LifecycleEmailKind = "welcome" | "cancelled";

export interface LifecycleEmailInput {
  previousStatus: string | null;
  nextStatus: string;
}

export interface LifecycleEmail {
  kind: LifecycleEmailKind;
}

export interface SendLifecycleEmailInput extends LifecycleEmailInput {
  recipient: string;
  currentPeriodEnd: string | null;
}

export function lifecycleEmailFor({ previousStatus, nextStatus }: LifecycleEmailInput): LifecycleEmail | null {
  if (nextStatus === "active" && previousStatus !== "active") {
    return { kind: "welcome" };
  }

  if (nextStatus === "canceled" && previousStatus !== "canceled") {
    return { kind: "cancelled" };
  }

  return null;
}

function formatPeriodEnd(value: string | null): string {
  if (!value) return "the end of your current billing period";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the end of your current billing period";

  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney"
  });
}

export async function sendLifecycleEmail(input: SendLifecycleEmailInput): Promise<boolean> {
  const lifecycleEmail = lifecycleEmailFor(input);
  if (!lifecycleEmail) return false;

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("HARBOURLINE_FROM_EMAIL");
  const supportEmail = Deno.env.get("HARBOURLINE_SUPPORT_EMAIL");
  const appUrl = Deno.env.get("HARBOURLINE_APP_URL");
  if (!resendApiKey || !from || !supportEmail || !appUrl) {
    console.error("Lifecycle email was not sent because email delivery is not configured");
    return false;
  }

  const content = lifecycleEmail.kind === "welcome"
    ? {
      subject: "Welcome to Harbourline",
      html: `<p>Welcome to Harbourline.</p><p>Your account is ready. Add your income, bills and first payday plan to see the household picture clearly.</p><p><a href="${appUrl}">Open Harbourline</a></p><p>Need a hand? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    }
    : {
      subject: "Your Harbourline subscription has been cancelled",
      html: `<p>Your Harbourline subscription will end on ${formatPeriodEnd(input.currentPeriodEnd)}.</p><p>Your household data will be preserved. Before your access ends, you can export it from Harbourline.</p><p><a href="${appUrl}">Open Harbourline</a></p><p>Need a hand? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
    };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [input.recipient], ...content })
    });
    if (!response.ok) {
      console.error("Lifecycle email delivery request was rejected", { status: response.status, kind: lifecycleEmail.kind });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Lifecycle email delivery request failed", {
      kind: lifecycleEmail.kind,
      message: error instanceof Error ? error.message : "unknown error"
    });
    return false;
  }
}
