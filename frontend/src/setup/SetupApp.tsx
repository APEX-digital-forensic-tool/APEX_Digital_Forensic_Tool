import React, { useEffect, useId, useRef, useState } from "react";
import { unwrap } from "../gateway";
import { useI18n } from "../i18n/I18nProvider";
import { messagesFor } from "../i18n/catalog";
import { LANGUAGE_NAMES, LOCALES } from "../i18n/locales";
import { BrandLogo, Check } from "../icons";
import { MachineSettings } from "../MachineSettings";
import { AccountPanel } from "../panels";
import { ErrorState } from "../ui";
import { AiConnectionForm, type AiFormState } from "./AiConnectionForm";
import { readExaminerName } from "./profile";
import { ProfileSettings } from "./ProfileSettings";
import "./setup.css";

const STEP_COUNT = 5;
const LAST = STEP_COUNT - 1;
const AI_STEP = 2;
// macOS draws its window buttons over the top-left corner of this window.
const MAC = /Macintosh/.test(navigator.userAgent);

export function SetupApp() {
  const { locale, m, setLocale } = useI18n();
  const t = m.setup;
  const [step, setStep] = useState(0);
  // A step stays mounted once opened, so what was typed survives moving around.
  const [visited, setVisited] = useState([true, false, false, false, false]);
  const [ai, setAi] = useState<AiFormState>({
    editable: false,
    busy: false,
    configured: false,
  });
  const [examiner, setExaminer] = useState(readExaminerName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const ids = useId();
  const aiFormId = `${ids}-ai`;
  const shownStep = useRef(step);
  // Read by the AI form's callback, which may fire long after it was created.
  const currentStep = useRef(step);
  currentStep.current = step;
  // An AI save restarts the engine (up to ~90s); nothing moves until it settles.
  const locked = ai.busy || busy;
  const saveButton = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);

  // The save button is disabled while saving, which drops keyboard focus to
  // the page. After a failed save it goes back to the button; a successful
  // one moves to the next step's heading instead.
  useEffect(() => {
    const failed = wasSaving.current && !ai.busy && step === AI_STEP;
    wasSaving.current = ai.busy;
    if (failed && document.activeElement === document.body)
      saveButton.current?.focus();
  }, [ai.busy, step]);

  // After moving, focus lands on the new step's heading so keyboard and
  // screen-reader users start at the top of the step.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headings.current[step]?.focus();
  }, [step]);

  // Shown in every language, current one first, so the step can be found by
  // someone who cannot read the current UI language.
  const languageTitle = [locale, ...LOCALES.filter((l) => l !== locale)]
    .map((l) => messagesFor(l).settings.language.title)
    .join(" · ");

  function go(next: number) {
    setError(null);
    setVisited((seen) => seen.map((v, i) => v || i === next));
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

  const content = [
    <div
      className="setup-choices"
      role="radiogroup"
      aria-labelledby={`${ids}-h0`}
    >
      {LOCALES.map((l) => (
        <label key={l} className="setup-choice" lang={l}>
          <input
            type="radio"
            name="setup-locale"
            value={l}
            checked={locale === l}
            disabled={locked}
            onChange={() => setLocale(l)}
          />
          <span>{LANGUAGE_NAMES[l]}</span>
          <Check size={16} className="setup-choice-check" />
        </label>
      ))}
    </div>,
    <ProfileSettings showHint={false} onNameChange={setExaminer} />,
    <AiConnectionForm
      formId={aiFormId}
      hideActions
      onState={setAi}
      onChanged={() => {
        if (currentStep.current === AI_STEP) go(AI_STEP + 1);
      }}
    />,
    <MachineSettings compact />,
    <AccountPanel compact />,
  ];

  // A check claims something is set, so passing a step is not enough. A
  // language is always chosen; OCR/STT and the account never claim it.
  const isSet = [true, examiner.trim() !== "", ai.configured, false, false];
  const stepState = (i: number) =>
    i === step ? "current" : isSet[i] ? "done" : "todo";

  // On the AI step the primary button saves what was typed, then moves on.
  const savesAi = step === AI_STEP && ai.editable;

  return (
    <div className={`setup${MAC ? " setup-mac" : ""}`}>
      <aside className="setup-rail">
        <BrandLogo />
        <h1>{t.title}</h1>
        <nav aria-label={t.stepsLabel}>
          <ol className="setup-steps">
            {t.steps.map((name, i) => (
              <li key={i} data-state={stepState(i)}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  disabled={locked}
                  onClick={() => go(i)}
                >
                  <span className="setup-step-mark" aria-hidden="true">
                    {stepState(i) === "done" && <Check size={11} />}
                  </span>
                  {name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <p className="setup-rail-note">{t.intro}</p>
      </aside>
      <div className="setup-pane">
        <main className="setup-body">
          {content.map(
            (body, i) =>
              visited[i] && (
                <section key={i} className="setup-step" hidden={i !== step}>
                  <h2
                    id={`${ids}-h${i}`}
                    tabIndex={-1}
                    ref={(node) => {
                      headings.current[i] = node;
                    }}
                  >
                    {i === 0 ? languageTitle : t.steps[i]}
                  </h2>
                  <p className="setup-lead">{t.descriptions[i]}</p>
                  {body}
                </section>
              ),
          )}
        </main>
        {error != null && (
          <div className="setup-error">
            <ErrorState error={error} />
          </div>
        )}
        <footer className="setup-footer">
          {step > 0 && (
            <button
              type="button"
              className="setup-quiet"
              disabled={locked}
              onClick={() => go(step - 1)}
            >
              {t.back}
            </button>
          )}
          <span className="setup-progress">
            {t.progress(step + 1, STEP_COUNT)}
          </span>
          <span className="setup-spacer" />
          {step > 0 && step < LAST && (
            <button
              type="button"
              className="setup-quiet"
              disabled={locked}
              onClick={() => go(step + 1)}
            >
              {t.skip}
            </button>
          )}
          {savesAi ? (
            <button
              ref={saveButton}
              type="submit"
              form={aiFormId}
              className="primary"
              disabled={ai.busy}
            >
              {ai.busy ? t.saving : t.saveAndNext}
            </button>
          ) : step < LAST ? (
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
    </div>
  );
}
