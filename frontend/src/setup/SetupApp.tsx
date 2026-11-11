import React, { useEffect, useId, useRef, useState } from "react";
import { unwrap } from "../gateway";
import { useI18n } from "../i18n/I18nProvider";
import { messagesFor } from "../i18n/catalog";
import { LANGUAGE_NAMES, LOCALES } from "../i18n/locales";
import { MachineSettings } from "../MachineSettings";
import { AccountPanel } from "../panels";
import { ErrorState } from "../ui";
import { AiConnectionForm } from "./AiConnectionForm";
import { ProfileSettings } from "./ProfileSettings";
import "./setup.css";

const LAST = 4;

export function SetupApp() {
  const { locale, m, setLocale } = useI18n();
  const t = m.setup;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const shownStep = useRef(step);

  // After Back/Next/Skip, focus lands on the new step's heading so keyboard
  // and screen-reader users start at the top of the step.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  // Shown in every language, current one first, so the step can be found by
  // someone who cannot read the current UI language.
  const languageTitle = [locale, ...LOCALES.filter((l) => l !== locale)]
    .map((l) => messagesFor(l).settings.language.title)
    .join(" · ");

  function go(next: number) {
    setError(null);
    setStep(next);
  }

  async function start() {
    const bridge = window.apex;
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(await bridge.completeSetup());
      // The main process closes this window; keep Start disabled until then.
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <header className="setup-header">
        <h1>{t.title}</h1>
        <p className="setup-progress">{t.progress(step + 1, LAST + 1)}</p>
      </header>
      <main className="setup-body">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {step === 0 ? languageTitle : t.steps[step]}
        </h2>
        {step > 0 && <p className="muted">{t.optional}</p>}
        {step === 0 && (
          <div
            className="setup-choices"
            role="radiogroup"
            aria-labelledby={headingId}
          >
            {LOCALES.map((l) => (
              <label key={l} className="check" lang={l}>
                <input
                  type="radio"
                  name="setup-locale"
                  value={l}
                  checked={locale === l}
                  onChange={() => setLocale(l)}
                />
                {LANGUAGE_NAMES[l]}
              </label>
            ))}
          </div>
        )}
        {step === 1 && <ProfileSettings />}
        {step === 2 && <AiConnectionForm />}
        {step === 3 && (
          <>
            <p className="muted">{t.machineNote}</p>
            <MachineSettings />
          </>
        )}
        {step === LAST && (
          <>
            <p className="muted">{t.accountNote}</p>
            <AccountPanel />
          </>
        )}
      </main>
      {error != null && (
        <div className="setup-error">
          <ErrorState error={error} />
        </div>
      )}
      <footer className="setup-footer">
        {step > 0 && (
          <button type="button" onClick={() => go(step - 1)}>
            {t.back}
          </button>
        )}
        <span className="setup-spacer" />
        {step > 0 && step < LAST && (
          <button type="button" onClick={() => go(step + 1)}>
            {t.skip}
          </button>
        )}
        {step < LAST ? (
          <button
            type="button"
            className="primary"
            onClick={() => go(step + 1)}
          >
            {t.next}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            {t.start}
          </button>
        )}
      </footer>
    </div>
  );
}
