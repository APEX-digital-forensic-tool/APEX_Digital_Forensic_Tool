export type Locale = "ko-KR" | "en-US";

export const LOCALES: readonly Locale[] = ["ko-KR", "en-US"];

/** Each language is named in itself so it can be found from either UI. */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  "ko-KR": "한국어",
  "en-US": "English",
};

export const LOCALE_STORAGE_KEY = "apex.locale";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Stored choice, then the first Korean or English system language, else English. */
export function resolveInitialLocale(
  stored: string | null,
  languages: readonly string[],
): Locale {
  if (isLocale(stored)) return stored;
  for (const language of languages) {
    const tag = language.toLowerCase();
    if (tag.startsWith("ko")) return "ko-KR";
    if (tag.startsWith("en")) return "en-US";
  }
  return "en-US";
}

export function htmlLang(locale: Locale): "ko" | "en" {
  return locale === "ko-KR" ? "ko" : "en";
}
