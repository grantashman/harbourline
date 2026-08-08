import { HarbourlineCloud, type GoogleCalendarEvent, type GoogleCalendarStatus } from "./cloud";

const SYNC_HORIZON_DAYS = 366;

interface CalendarState {
  paydayPlan?: { payCycle?: string; nextPayday?: string };
  showExpenseNamesOnCalendar?: boolean;
  expenses?: Array<{ id?: string; name?: string; due?: string; frequency?: string }>;
}

const EMPTY_STATUS: GoogleCalendarStatus = {
  connected: false,
  googleEmail: null,
  calendarId: null,
  lastSyncedAt: null,
  error: null
};

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

function todayDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString().slice(0, 10);
}

function hashId(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (const character of value) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `h${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function billSummary(expenseName?: string): string {
  const name = typeof expenseName === "string"
    ? expenseName.trim().replace(/\s+/g, " ").slice(0, 100).trim()
    : "";
  return name ? `${name} due` : "Harbourline bill due";
}

function event(
  kind: "payday" | "bill",
  source: string,
  date: string,
  expenseName?: string
): GoogleCalendarEvent {
  return {
    id: hashId(`${kind}|${source}|${date}`),
    kind,
    summary: kind === "payday"
      ? "Harbourline payday"
      : billSummary(expenseName),
    description: kind === "payday"
      ? "Planned payday from Harbourline. Open Harbourline for private budget details."
      : "Planned bill due date from Harbourline. Open Harbourline for private budget details.",
    startDate: date,
    endDate: addDays(date, 1)
  };
}

function nextOccurrence(value: string, frequency: string | undefined): string | null {
  if (frequency === "weekly") return addDays(value, 7);
  if (frequency === "fortnightly") return addDays(value, 14);
  if (frequency === "fourWeekly") return addDays(value, 28);
  if (frequency === "monthly") return addMonths(value, 1);
  if (frequency === "quarterly") return addMonths(value, 3);
  if (frequency === "sixMonthly") return addMonths(value, 6);
  if (frequency === "yearly") return addMonths(value, 12);
  return null;
}

export function buildGoogleCalendarEvents(input: unknown, start = todayDate()): GoogleCalendarEvent[] {
  const state = (input && typeof input === "object" ? input : {}) as CalendarState;
  const horizon = addDays(start, SYNC_HORIZON_DAYS);
  const events: GoogleCalendarEvent[] = [];
  const payCycleDays = state.paydayPlan?.payCycle === "fortnightly" ? 14 : 7;
  let payday = dateOnly(state.paydayPlan?.nextPayday);
  if (payday && payday < start) payday = start;
  for (let count = 0; payday && payday <= horizon && count < 60; count += 1) {
    events.push(event("payday", "household", payday));
    payday = addDays(payday, payCycleDays);
  }

  for (const [index, expense] of (state.expenses ?? []).entries()) {
    let due = dateOnly(expense.due);
    if (!due || due > horizon || due < start && !nextOccurrence(due, expense.frequency)) continue;
    if (due < start) {
      while (due < start) {
        const next = nextOccurrence(due, expense.frequency);
        if (!next) break;
        due = next;
      }
    }
    for (let count = 0; due && due <= horizon && count < 60; count += 1) {
      events.push(event(
        "bill",
        String(expense.id ?? `expense-${index}`),
        due,
        state.showExpenseNamesOnCalendar ? expense.name : undefined
      ));
      due = nextOccurrence(due, expense.frequency);
    }
  }
  return events;
}

export class GoogleCalendarSync {
  private status: GoogleCalendarStatus = EMPTY_STATUS;
  private operationGeneration = 0;

  constructor(private readonly bridge: { read(): unknown }, private readonly cloud: HarbourlineCloud) {}

  get currentStatus(): GoogleCalendarStatus {
    return this.status;
  }

  reset(): void {
    this.operationGeneration += 1;
    this.status = EMPTY_STATUS;
  }

  async refresh(): Promise<GoogleCalendarStatus> {
    const generation = ++this.operationGeneration;
    const status = await this.cloud.getGoogleCalendarStatus();
    if (generation !== this.operationGeneration) return this.status;
    this.status = status;
    return this.status;
  }

  async connect(): Promise<string | null> {
    const generation = ++this.operationGeneration;
    const url = await this.cloud.startGoogleCalendarConnect(location.pathname);
    return generation === this.operationGeneration ? url : null;
  }

  async sync(): Promise<GoogleCalendarStatus> {
    const generation = ++this.operationGeneration;
    const events = buildGoogleCalendarEvents(this.bridge.read());
    const status = await this.cloud.syncGoogleCalendar(events);
    if (generation !== this.operationGeneration) return this.status;
    this.status = status;
    return this.status;
  }

  async disconnect(deleteEvents: boolean): Promise<void> {
    const generation = ++this.operationGeneration;
    await this.cloud.disconnectGoogleCalendar(deleteEvents);
    if (generation !== this.operationGeneration) return;
    this.status = EMPTY_STATUS;
  }
}
