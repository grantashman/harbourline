export function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(finiteNumber(value, fallback), 0);
}

export function clamp(value: unknown, minimum: number, maximum: number): number {
  return Math.min(Math.max(finiteNumber(value, minimum), minimum), maximum);
}

