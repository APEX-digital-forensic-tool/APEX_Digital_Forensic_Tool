import React, { useEffect, useId, useRef, useState } from "react";
import type { AiConnectionStatus } from "../../electron/aiConnection";
import { unwrap, type Reply } from "../gateway";
import { useI18n } from "../i18n/I18nProvider";
import { ErrorState, Loading } from "../ui";

export type AiFormState = {
  /** False when the connection is managed elsewhere or cannot be stored. */
  editable: boolean;
  busy: boolean;
  /** A connection is set up (stored here or managed elsewhere). */
  configured: boolean;
};

export function AiConnectionForm({
  blockedReason,
  showRemove,
  onChanged,
  formId,
  hideActions,
  onState,
}: {
  /** Save/remove are blocked with this reason shown (e.g. analysis tasks running). */
  blockedReason?: string;
  showRemove?: boolean;
  onChanged?: (status: AiConnectionStatus) => void;
  /** Lets a button outside the form submit it (`<button form={formId}>`). */
  formId?: string;
  /** The host supplies the submit button; the form's own buttons are left out. */
  hideActions?: boolean;
  onState?: (state: AiFormState) => void;
}) {
  const { m } = useI18n();
  const t = m.setup.ai;
  const keyHintId = useId();
  const [status, setStatus] = useState<AiConnectionStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [maxOutput, setMaxOutput] = useState("4096");
  const [timeout, setTimeoutSeconds] = useState("30");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The key lives only in this uncontrolled input; it is never in React state.
  const keyRef = useRef<HTMLInputElement>(null);
  const bridge = window.apex;

  function adopt(next: AiConnectionStatus) {
    setStatus(next);
    setBaseUrl(next.base_url ?? "");
    setModelId(next.model_id ?? "");
    setTemperature(String(next.temperature));
    setMaxOutput(String(next.max_output));
    setTimeoutSeconds(String(next.timeout));
  }

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge
      .aiConnection()
      .then((reply) => {
        if (live) adopt(unwrap(reply));
      })
      .catch((err) => {
        if (live) setError(err);
      });
    return () => {
      live = false;
    };
  }, [bridge, attempt]);

  const editable =
    status != null && !status.managed && status.storage_available;
  const configured = status?.configured ?? false;
  useEffect(() => {
    onState?.({ editable, busy, configured });
  }, [onState, editable, busy, configured]);

  if (!bridge) return null;

  const blocked = Boolean(blockedReason);

  async function run(call: () => Promise<Reply<AiConnectionStatus>>) {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const next = unwrap(await call());
      if (keyRef.current) keyRef.current.value = "";
      adopt(next);
      onChanged?.(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const apiKey = keyRef.current?.value ?? "";
    void run(() =>
      bridge!.saveAiConnection({
        base_url: baseUrl.trim(),
        model_id: modelId.trim(),
        ...(apiKey ? { api_key: apiKey } : {}),
        temperature: Number(temperature),
        max_output: Number(maxOutput),
        timeout: Number(timeout),
      }),
    );
  }

  if (!status) {
    return error ? (
      <ErrorState
        error={error}
        retry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    ) : (
      <Loading />
    );
  }
  // On a first run "not configured" is a given; the badge earns its place
  // once there is a connection or the form stands alone in Settings.
  const state = (status.configured || !hideActions) && (
    <p className="ai-status">
      <span className={`badge ${status.configured ? "green" : ""}`}>
        {status.configured ? t.configured : t.notConfigured}
      </span>
    </p>
  );
  if (!editable) {
    return (
      <div className="setup-fields">
        {state}
        <p className="setup-note">
          {status.managed ? t.managed : t.storageUnavailable}
        </p>
        <p className="setup-note">{t.policyNote}</p>
      </div>
    );
  }
  return (
    <form className="setup-fields" id={formId} onSubmit={save}>
      {state}
      <div className="setup-grid">
        <label>
          {t.baseUrl}
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label>
          {t.model}
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
        </label>
        <label className="setup-wide">
          {t.apiKey}
          <input
            ref={keyRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={status.has_key ? keyHintId : undefined}
          />
        </label>
      </div>
      {status.has_key && (
        <p id={keyHintId} className="setup-note">
          {t.keepKey}
        </p>
      )}
      <details className="setup-advanced">
        <summary>{t.advanced}</summary>
        <div className="setup-grid setup-grid-three">
          <label>
            {t.temperature}
            <input
              type="number"
              step="any"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
          <label>
            {t.maxOutput}
            <input
              type="number"
              step={1}
              value={maxOutput}
              onChange={(e) => setMaxOutput(e.target.value)}
            />
          </label>
          <label>
            {t.timeout}
            <input
              type="number"
              step="any"
              value={timeout}
              onChange={(e) => setTimeoutSeconds(e.target.value)}
            />
          </label>
        </div>
      </details>
      {error != null && <ErrorState error={error} />}
      {busy && (
        <p role="status" className="setup-note">
          {t.saving}
        </p>
      )}
      {blockedReason && <p className="setup-note">{blockedReason}</p>}
      {!hideActions && (
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || blocked}>
            {busy ? m.setup.saving : t.save}
          </button>
          {showRemove && (
            <button
              type="button"
              disabled={busy || blocked || !status.configured}
              onClick={() => void run(() => bridge.clearAiConnection())}
            >
              {t.remove}
            </button>
          )}
        </div>
      )}
      {!hideActions && <p className="setup-note">{t.restartNote}</p>}
      <p className="setup-note">{t.policyNote}</p>
    </form>
  );
}
