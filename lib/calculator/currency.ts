/**
 * Currencies the public calculator can display in.
 *
 * Each one is formatted in a locale that renders its own symbol bare — en-GB
 * spells USD "US$67,000", which reads as a conversion rather than a fee.
 */

export type CurrencyCode = "GBP" | "USD" | "EUR";

export const CURRENCIES: ReadonlyArray<{
  code: CurrencyCode;
  symbol: string;
  locale: string;
}> = [
  { code: "GBP", symbol: "£", locale: "en-GB" },
  { code: "USD", symbol: "$", locale: "en-US" },
  { code: "EUR", symbol: "€", locale: "en-IE" },
];

export const DEFAULT_CURRENCY: CurrencyCode = "GBP";

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return CURRENCIES.some((c) => c.code === value);
}

export function currencySymbol(currency: CurrencyCode): string {
  return CURRENCIES.find((c) => c.code === currency)?.symbol ?? "£";
}

export function formatMoney(amount: number, currency: CurrencyCode): string {
  const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
