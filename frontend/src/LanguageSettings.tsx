import React, { useId } from "react";
import { useI18n } from "./i18n/I18nProvider";
import { messagesFor } from "./i18n/catalog";
import { isLocale, LANGUAGE_NAMES, LOCALES } from "./i18n/locales";

export function LanguageSettings() {
  const { locale, m, setLocale } = useI18n();
  const titleId = useId();
  // The title is shown in every language, current one first, so the card can
  // be found by someone who cannot read the current UI language.
  const title = [locale, ...LOCALES.filter((l) => l !== locale)]
    .map((l) => messagesFor(l).settings.language.title)
    .join(" · ");
  return (
    <div className="card">
      <h3 id={titleId}>{title}</h3>
      <p className="muted">{m.settings.language.description}</p>
      <select
        aria-labelledby={titleId}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
