import { configuredAppOrigin } from "./beta.ts";

export type LifecycleEmailKind = "welcome" | "past_due" | "cancelled";

export interface LifecycleEmailInput {
  previousStatus: string | null;
  nextStatus: string;
}

export interface LifecycleEmail {
  kind: LifecycleEmailKind;
}

export interface SendLifecycleEmailInput extends LifecycleEmailInput {
  kind: LifecycleEmailKind;
  recipient: string;
  currentPeriodEnd: string | null;
  idempotencyKey: string;
}

export function lifecycleEmailFor({ previousStatus, nextStatus }: LifecycleEmailInput): LifecycleEmail | null {
  if (nextStatus === "active" && (previousStatus === null || previousStatus === "incomplete" || previousStatus === "trialing")) {
    return { kind: "welcome" };
  }

  if (nextStatus === "canceled" && previousStatus !== "canceled") {
    return { kind: "cancelled" };
  }

  if (nextStatus === "past_due" && previousStatus !== "past_due") {
    return { kind: "past_due" };
  }

  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
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
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("HARBOURLINE_FROM_EMAIL");
    const supportEmail = Deno.env.get("HARBOURLINE_SUPPORT_EMAIL");
    const appUrl = configuredAppOrigin();
    if (!resendApiKey || !from || !supportEmail || !appUrl) {
      console.error("Lifecycle email was not sent because email delivery is not configured");
      return false;
    }

    const accountUrl = new URL("?account=signin", appUrl).toString();
    const content = input.kind === "welcome"
      ? {
      subject: "Welcome to Harbourline",
      html: `<p>Welcome to Harbourline.</p><p>Your account is ready. Add your income, bills and first payday plan to see the household picture clearly.</p><p><a href="${appUrl}">Open Harbourline</a></p><p>Need a hand? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
      }
      : input.kind === "past_due"
      ? {
      subject: "Action needed for your Harbourline payment",
      html: `<p>We could not confirm your latest Harbourline payment.</p><p>Your household data is preserved, but cloud access may pause until your payment method is updated.</p><p><a href="${appUrl}?account=signin">Open Harbourline to review billing</a></p><p>Need a hand? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
      }
      : {
      subject: "Your Harbourline subscription has been cancelled",
      html: `<p>Your Harbourline subscription will end on ${formatPeriodEnd(input.currentPeriodEnd)}.</p><p>Your household data will be preserved. Before your access ends, <a href="${accountUrl}">open your account panel</a> and use Export to download a copy.</p><p>Need a hand? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
      };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({ from, to: [input.recipient], ...content }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      console.error("Lifecycle email delivery request was rejected", { status: response.status, kind: input.kind });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Lifecycle email delivery request failed", {
      kind: input.kind,
      message: error instanceof Error ? error.message : "unknown error"
    });
    return false;
  }
}

export interface SignupNotificationInput {
  signupEmail: string;
  provider: string | null;
  createdAt: string;
  idempotencyKey: string;
}

export function signupNotificationContent(input: Pick<SignupNotificationInput, "signupEmail" | "provider" | "createdAt">): {
  subject: string;
  html: string;
  text: string;
} {
  const email = escapeHtml(input.signupEmail);
  const provider = escapeHtml(input.provider || "email");
  const createdAt = escapeHtml(input.createdAt);
  return {
    subject: "New Harbourline account signup",
    html: `<p>A new Harbourline account has completed verification or sign-in.</p><p><strong>Email:</strong> ${email}<br><strong>Provider:</strong> ${provider}<br><strong>Time:</strong> ${createdAt}</p><p>This notification contains no household budget data.</p>`,
    text: `A new Harbourline account has completed verification or sign-in.\n\nEmail: ${input.signupEmail}\nProvider: ${input.provider || "email"}\nTime: ${input.createdAt}\n\nThis notification contains no household budget data.`
  };
}

export async function sendSignupNotification(input: SignupNotificationInput): Promise<boolean> {
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("HARBOURLINE_FROM_EMAIL");
    const operatorEmails = [...new Set(
      (Deno.env.get("HARBOURLINE_OPERATOR_EMAILS") ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )];
    if (!resendApiKey || !from || !operatorEmails.length) {
      console.error("Signup notification was not sent because operator email delivery is not configured");
      return false;
    }

    const content = signupNotificationContent(input);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({ from, to: operatorEmails, ...content }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      console.error("Signup notification delivery request was rejected", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Signup notification delivery request failed", {
      message: error instanceof Error ? error.message : "unknown error"
    });
    return false;
  }
}
