import React, { useEffect, useId, useRef, useState } from "react";
import type { AiConnectionStatus } from "../../electron/aiConnection";
import { unwrap, type Reply } from "../gateway";
import { useI18n } from "../i18n/I18nProvider";
import { ErrorState, Loading } from "../ui";

export function AiConnectionForm({
  blockedReason,
  showRemove,
  onChanged,
}: {
  /** Save/remove are blocked with this reason shown (e.g. analysis tasks running). */
  blockedReason?: string;
  showRemove?: boolean;
  onChanged?: (status: AiConnectionStatus) => void;
}) {
  const { m } = useI18n();
  const t = m.setup.ai;
  const ids = useId();
  const [status, setStatus] = useState<AiConnectionStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [maxOutput, setMaxOutput] = useState("4096");
  const [timeout, setTimeoutSeconds] = useState("30");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
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
  }, [bridge]);

  if (!bridge) return null;

  async function run(call: () => Promise<Reply<AiConnectionStatus>>) {
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
    return error ? <ErrorState error={error} /> : <Loading />;
  }
  const state = (
    <p>
      <span className="badge">
        {status.configured ? t.configured : t.notConfigured}
      </span>
    </p>
  );
  if (status.managed) {
    return (
      <>
        {state}
        <p className="muted">{t.managed}</p>
        <p className="muted">{t.policyNote}</p>
      </>
    );
  }
  if (!status.storage_available) {
    return (
      <>
        {state}
        <p className="muted">{t.storageUnavailable}</p>
        <p className="muted">{t.policyNote}</p>
      </>
    );
  }
  const blocked = Boolean(blockedReason);
  return (
    <form onSubmit={save}>
      {state}
      <label htmlFor={`${ids}-url`}>{t.baseUrl}</label>
      <input
        id={`${ids}-url`}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <label htmlFor={`${ids}-model`}>{t.model}</label>
      <input
        id={`${ids}-model`}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
      />
      <label htmlFor={`${ids}-key`}>{t.apiKey}</label>
      <input
        id={`${ids}-key`}
        ref={keyRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
      />
      {status.has_key && <p className="muted">{t.keepKey}</p>}
      <details>
        <summary>{t.advanced}</summary>
        <label htmlFor={`${ids}-temp`}>{t.temperature}</label>
        <input
          id={`${ids}-temp`}
          type="number"
          step="any"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
        />
        <label htmlFor={`${ids}-max`}>{t.maxOutput}</label>
        <input
          id={`${ids}-max`}
          type="number"
          step={1}
          value={maxOutput}
          onChange={(e) => setMaxOutput(e.target.value)}
        />
        <label htmlFor={`${ids}-timeout`}>{t.timeout}</label>
        <input
          id={`${ids}-timeout`}
          type="number"
          step="any"
          value={timeout}
          onChange={(e) => setTimeoutSeconds(e.target.value)}
        />
      </details>
      {blockedReason && <p className="muted">{blockedReason}</p>}
      <p className="muted">{t.restartNote}</p>
      {error != null && <ErrorState error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || blocked}>
          {t.save}
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
      <p className="muted">{t.policyNote}</p>
    </form>
  );
}
