const API_KEY_PATTERN = /^hl_live_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  token: string;
  prefix: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

export function isApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export async function hashApiKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function generateApiKey(
  randomBytes: () => Uint8Array = () =>
    crypto.getRandomValues(new Uint8Array(32)),
): GeneratedApiKey {
  const token = `hl_live_${bytesToBase64Url(randomBytes())}`;
  if (!isApiKey(token)) {
    throw new Error("Could not generate a valid Harbourline API key");
  }
  return {
    token,
    prefix: token.slice(0, 20),
  };
}
