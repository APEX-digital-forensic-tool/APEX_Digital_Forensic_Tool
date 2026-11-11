import { koKR, type Messages } from "../locales/ko-KR";
import { enUS } from "../locales/en-US";

export type { Messages };

/** Unknown or missing locales fall back to the Korean source catalog. */
export function messagesFor(locale: unknown): Messages {
  return locale === "en-US" ? enUS : koKR;
}

/** Looks up an engine code in a code→text table; unknown codes show as-is. */
export function lookup(table: object, key: string): string {
  return (table as Record<string, string | undefined>)[key] ?? key;
}
