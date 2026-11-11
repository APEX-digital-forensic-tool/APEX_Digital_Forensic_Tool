import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { koKR } from "../locales/ko-KR";
import { messagesFor, type Messages } from "./catalog";
import {
  htmlLang,
  LOCALE_STORAGE_KEY,
  resolveInitialLocale,
  type Locale,
} from "./locales";

export interface I18nValue {
  locale: Locale;
  m: Messages;
  setLocale(next: Locale): void;
}

const I18nContext = createContext<I18nValue>({
  locale: "ko-KR",
  m: koKR,
  setLocale: () => {},
});

// Storage can be unavailable (blocked site data); the choice then lasts for the session.
function readStored(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory choice.
  }
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () =>
      initialLocale ??
      resolveInitialLocale(
        readStored(),
        navigator.languages ?? [navigator.language],
      ),
  );
  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      m: messagesFor(locale),
      setLocale: (next) => {
        writeStored(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
