import React, { useId } from "react";
import { useI18n } from "./i18n/I18nProvider";
import { isLocale, LANGUAGE_NAMES, LOCALES } from "./i18n/locales";

export function LanguageSettings() {
  const { locale, m, setLocale } = useI18n();
  const titleId = useId();
  return (
    <div className="card">
      <h3 id={titleId}>{m.settings.language.title}</h3>
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
