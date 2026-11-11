import { koKR, type Messages } from "../locales/ko-KR";
import { enUS } from "../locales/en-US";

export type { Messages };

/** Unknown or missing locales fall back to the Korean source catalog. */
export function messagesFor(locale: unknown): Messages {
  return locale === "en-US" ? enUS : koKR;
}

/**
 * Looks up an engine code in a code→text table; unknown codes show as-is.
 * Own keys only: evidence values such as "constructor" must not resolve to
 * members inherited from Object.prototype.
 */
export function lookup(table: object, key: string): string {
  return Object.hasOwn(table, key)
    ? (table as Record<string, string>)[key]
    : key;
}
