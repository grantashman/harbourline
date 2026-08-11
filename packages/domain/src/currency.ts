export interface CurrencyDefinition {
  code: string;
  minorUnit: number;
  defaultLocale: string;
}

export interface CurrencyRegistryConfig {
  enabledCurrencies?: readonly string[];
  defaultCurrency?: string;
  definitions?: Record<string, Partial<Omit<CurrencyDefinition, "code">> & { code?: string }>;
}

export interface CurrencyRegistry {
  readonly defaultCurrency: string;
  readonly enabledCurrencies: readonly string[];
  get(code: string): CurrencyDefinition;
  isEnabled(code: string): boolean;
  list(): CurrencyDefinition[];
}

export interface Money {
  currency: string;
  amountMinor: string;
}

const BUILTIN_CURRENCIES: Record<string, CurrencyDefinition> = {
  AUD: { code: "AUD", minorUnit: 2, defaultLocale: "en-AU" },
  CAD: { code: "CAD", minorUnit: 2, defaultLocale: "en-CA" },
  BHD: { code: "BHD", minorUnit: 3, defaultLocale: "en-BH" },
  EUR: { code: "EUR", minorUnit: 2, defaultLocale: "en-IE" },
  GBP: { code: "GBP", minorUnit: 2, defaultLocale: "en-GB" },
  INR: { code: "INR", minorUnit: 2, defaultLocale: "en-IN" },
  JPY: { code: "JPY", minorUnit: 0, defaultLocale: "ja-JP" },
  MXN: { code: "MXN", minorUnit: 2, defaultLocale: "es-MX" },
  NZD: { code: "NZD", minorUnit: 2, defaultLocale: "en-NZ" },
  SGD: { code: "SGD", minorUnit: 2, defaultLocale: "en-SG" },
  USD: { code: "USD", minorUnit: 2, defaultLocale: "en-US" }
};

/**
 * Currency metadata is deliberately broader than the enabled list. A code is
 * not supported merely because Intl or a payment provider knows about it.
 * Production starts with AUD and must opt currencies in through configuration.
 */
export const DEFAULT_CURRENCY_CONFIG: Readonly<{
  defaultCurrency: string;
  enabledCurrencies: readonly string[];
  definitions: Readonly<Record<string, CurrencyDefinition>>;
}> = Object.freeze({
  defaultCurrency: "AUD",
  enabledCurrencies: Object.freeze(["AUD"]),
  definitions: Object.freeze(BUILTIN_CURRENCIES)
});

function normaliseCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency codes must be ISO 4217 three-letter codes.");
  return code;
}

function normaliseMinorUnit(value: unknown, code: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 6) {
    throw new Error(`Currency ${code} must define a minor-unit precision from 0 to 6.`);
  }
  return Number(value);
}

function currencyDefinition(code: string, value: Partial<CurrencyDefinition> & { code?: string }): CurrencyDefinition {
  const defaultLocale = typeof value.defaultLocale === "string" ? value.defaultLocale.trim() : "";
  if (!defaultLocale) throw new Error(`Currency ${code} must define a default locale.`);
  return {
    code,
    minorUnit: normaliseMinorUnit(value.minorUnit, code),
    defaultLocale
  };
}

export function createCurrencyRegistry(config: CurrencyRegistryConfig = {}): CurrencyRegistry {
  const definitions: Record<string, CurrencyDefinition> = Object.fromEntries(
    Object.entries(BUILTIN_CURRENCIES).map(([code, definition]) => [code, { ...definition }])
  );
  for (const [configuredCode, configuredDefinition] of Object.entries(config.definitions ?? {})) {
    const code = normaliseCode(configuredDefinition.code ?? configuredCode);
    const existing = definitions[code];
    definitions[code] = currencyDefinition(code, {
      ...existing,
      ...configuredDefinition
    });
  }

  const configuredEnabled = config.enabledCurrencies ?? DEFAULT_CURRENCY_CONFIG.enabledCurrencies;
  // AUD is a compatibility currency: deployments may add currencies or change
  // the default, but they cannot silently make existing AUD records unreadable.
  const enabledCurrencies = [...new Set(["AUD", ...configuredEnabled.map(normaliseCode)])];
  if (enabledCurrencies.length === 0) throw new Error("At least one currency must be enabled.");
  for (const code of enabledCurrencies) {
    if (!definitions[code]) {
      throw new Error(`Currency ${code} has no minor-unit metadata.`);
    }
  }
  const defaultCurrency = normaliseCode(config.defaultCurrency ?? enabledCurrencies[0]);
  if (!enabledCurrencies.includes(defaultCurrency)) {
    throw new Error(`Default currency ${defaultCurrency} must be enabled.`);
  }

  return {
    defaultCurrency,
    enabledCurrencies: Object.freeze(enabledCurrencies),
    get(code: string): CurrencyDefinition {
      const normalised = normaliseCode(code);
      if (!enabledCurrencies.includes(normalised)) {
        throw new Error(`Currency ${normalised} is not enabled.`);
      }
      return { ...definitions[normalised]! };
    },
    isEnabled(code: string): boolean {
      try {
        return enabledCurrencies.includes(normaliseCode(code));
      } catch {
        return false;
      }
    },
    list(): CurrencyDefinition[] {
      return enabledCurrencies.map((code) => ({ ...definitions[code]! }));
    }
  };
}

export const DEFAULT_CURRENCY_REGISTRY = createCurrencyRegistry();

export function parseCurrencyAllowlist(value: unknown, fallback = DEFAULT_CURRENCY_CONFIG.enabledCurrencies): string[] {
  if (value === undefined || value === null || value === "") return [...fallback];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map(normaliseCode))];
}

function registryDefinition(code: string, registry: CurrencyRegistry): CurrencyDefinition {
  return registry.get(normaliseCode(code));
}

function normaliseMinor(value: string | bigint): string {
  const text = typeof value === "bigint" ? value.toString() : value.trim();
  if (!/^-?(?:0|[1-9]\d*)$/.test(text)) throw new Error("Minor-unit amounts must be integer strings.");
  return BigInt(text).toString();
}

function decimalInput(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error("Money amounts must be finite and within the safe numeric range.");
    }
    return String(value);
  }
  if (typeof value !== "string") throw new Error("Money amounts must be decimal strings or finite numbers.");
  const text = value.trim();
  if (!/^-?(?:\d+)(?:\.\d+)?$/.test(text)) {
    throw new Error("Money amounts must be plain decimal amounts, not exponent notation or grouped text.");
  }
  return text;
}

export function parseMajorToMinor(
  value: unknown,
  code: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY,
  options: { allowNegative?: boolean } = {}
): string {
  const definition = registryDefinition(code, registry);
  const input = decimalInput(value);
  const negative = input.startsWith("-");
  if (negative && options.allowNegative === false) throw new Error("Negative money amounts are not allowed.");
  const unsigned = negative ? input.slice(1) : input;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const scale = 10n ** BigInt(definition.minorUnit);
  const wholeMinor = BigInt(wholePart || "0") * scale;
  const retained = definition.minorUnit > 0
    ? fractionPart.slice(0, definition.minorUnit).padEnd(definition.minorUnit, "0")
    : "";
  let minor = wholeMinor + BigInt(retained || "0");
  const discarded = fractionPart.slice(definition.minorUnit);
  if (discarded && Number(discarded[0]) >= 5) minor += 1n;
  if (negative) minor *= -1n;
  return minor.toString();
}

export function parseDecimalFraction(value: unknown): readonly [bigint, bigint] {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^-?(?:\d+)(?:\.\d+)?$/.test(text)) {
    throw new Error("Decimal values must use plain decimal notation.");
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole || "0"}${fraction}` || "0") * (negative ? -1n : 1n);
  return [numerator, denominator];
}

export function sumMinor(values: Iterable<string | bigint>): string {
  let total = 0n;
  for (const value of values) total += BigInt(normaliseMinor(value));
  return total.toString();
}

export function scaleMinorDecimal(
  amountMinor: string | bigint,
  value: unknown,
  denominator: number | bigint = 1n
): string {
  const [numerator, decimalDenominator] = parseDecimalFraction(value);
  return scaleMinor(amountMinor, numerator, decimalDenominator * BigInt(denominator));
}

export function minorToNumber(value: string | bigint, code: string, registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY): number {
  const result = Number(minorToMajor(value, code, registry));
  if (!Number.isFinite(result)) throw new Error("Money value is outside the supported numeric range.");
  return result;
}

export function minorToMajor(value: string | bigint, code: string, registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY): string {
  const definition = registryDefinition(code, registry);
  const minor = normaliseMinor(value);
  const negative = minor.startsWith("-");
  const unsigned = negative ? minor.slice(1) : minor;
  if (definition.minorUnit === 0) return `${negative ? "-" : ""}${unsigned}`;
  const padded = unsigned.padStart(definition.minorUnit + 1, "0");
  const splitAt = padded.length - definition.minorUnit;
  const major = `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
  return `${negative ? "-" : ""}${major}`;
}

export function createMoney(
  code: string,
  amountMinor: string | bigint,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): Money {
  const currency = registryDefinition(code, registry).code;
  return { currency, amountMinor: normaliseMinor(amountMinor) };
}

export function addMoney(left: Money, right: Money, registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY): Money {
  const currency = registryDefinition(left.currency, registry).code;
  if (currency !== registryDefinition(right.currency, registry).code) {
    throw new Error("Money values in different currencies cannot be combined.");
  }
  return createMoney(currency, BigInt(left.amountMinor) + BigInt(right.amountMinor), registry);
}

export function scaleMinor(amountMinor: string | bigint, numerator: number | bigint, denominator: number | bigint): string {
  const amount = BigInt(normaliseMinor(amountMinor));
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (bottom === 0n) throw new Error("A scale denominator cannot be zero.");
  const signedNumerator = amount * top;
  const sign = signedNumerator < 0n !== bottom < 0n ? -1n : 1n;
  const absoluteNumerator = signedNumerator < 0n ? -signedNumerator : signedNumerator;
  const absoluteDenominator = bottom < 0n ? -bottom : bottom;
  let rounded = absoluteNumerator / absoluteDenominator;
  if ((absoluteNumerator % absoluteDenominator) * 2n >= absoluteDenominator) rounded += 1n;
  return (sign * rounded).toString();
}

export function minorUnitStep(code: string, registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY): string {
  const definition = registryDefinition(code, registry);
  return minorToMajor(1n, definition.code, registry);
}

export function formatMoney(
  value: Money | string | bigint,
  locale?: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): string {
  const money = typeof value === "object"
    ? createMoney(value.currency, value.amountMinor, registry)
    : createMoney(registry.defaultCurrency, value, registry);
  const definition = registryDefinition(money.currency, registry);
  const numeric = Number(money.amountMinor) / 10 ** definition.minorUnit;
  if (Number.isSafeInteger(Number(money.amountMinor)) && Number.isFinite(numeric)) {
    return new Intl.NumberFormat(locale ?? definition.defaultLocale, {
      style: "currency",
      currency: definition.code,
      minimumFractionDigits: definition.minorUnit,
      maximumFractionDigits: definition.minorUnit
    }).format(numeric);
  }
  return `${definition.code} ${minorToMajor(money.amountMinor, definition.code, registry)}`;
}
