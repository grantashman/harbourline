export function parseFunctionErrorMessage(detail: string, fallback: string): string {
  const text = detail.trim();
  if (!text) return fallback;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (text.startsWith("{") || text.startsWith("[")) return fallback;
  } catch {
    if (text.startsWith("{") || text.startsWith("[")) return fallback;
  }

  return text;
}
