export interface MarketingAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  landingPath?: string;
}

const ATTRIBUTION_KEYS = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_content", "content"],
  ["utm_term", "term"]
] as const;

const MAX_VALUE_LENGTH = 120;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function safeValue(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > MAX_VALUE_LENGTH || !SAFE_VALUE.test(trimmed)) return undefined;
  return trimmed;
}

function safeLandingPath(pathname: string): string | undefined {
  if (!pathname.startsWith("/") || pathname.length > MAX_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(pathname)) {
    return undefined;
  }
  return pathname;
}

export function parseMarketingAttribution(search: string, pathname: string): MarketingAttribution {
  const params = new URLSearchParams(search);
  const attribution: MarketingAttribution = {};

  for (const [queryKey, outputKey] of ATTRIBUTION_KEYS) {
    const value = safeValue(params.get(queryKey));
    if (value) attribution[outputKey] = value;
  }

  const landingPath = safeLandingPath(pathname);
  if (landingPath) attribution.landingPath = landingPath;
  return attribution;
}

export function attributionMetadata(attribution: MarketingAttribution): {
  marketing_attribution: MarketingAttribution;
} {
  return { marketing_attribution: attribution };
}
