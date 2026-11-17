import React, { useEffect, useId, useRef, useState } from "react";
import type { AiConnectionStatus, AiMode } from "../../electron/aiConnection";
import type { AccountStatus } from "../../electron/serverSession";
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
  // A new connection starts on the APEX server: it needs no key.
  const [mode, setMode] = useState<AiMode>("server");
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [maxOutput, setMaxOutput] = useState("4096");
  const [timeout, setTimeoutSeconds] = useState("30");
  const [error, setError] = useState<unknown>(null);
  // Which action is running; both restart the engine.
  const [action, setAction] = useState<"save" | "remove" | null>(null);
  const busy = action !== null;
  const [attempt, setAttempt] = useState(0);
  // The key lives only in this uncontrolled input; it is never in React state.
  const keyRef = useRef<HTMLInputElement>(null);
  const bridge = window.apex;

  function adopt(next: AiConnectionStatus) {
    setStatus(next);
    setMode(next.mode ?? (next.configured ? "custom" : "server"));
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
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge
      .account()
      .then((reply) => {
        if (live && reply.ok) setAccount(reply.data);
      })
      .catch(() => {
        /* The hint is optional; the AI request reports a missing sign-in itself. */
      });
    const stop = bridge.onAccountChange?.(setAccount);
    return () => {
      live = false;
      stop?.();
    };
  }, [bridge]);

  const editable = status != null && !status.managed;
  // A direct connection stores a key, which needs OS encryption; the server mode stores none.
  const canStore = mode === "server" || (status?.storage_available ?? false);
  const configured = status?.configured ?? false;
  const savable = editable && canStore;
  useEffect(() => {
    onState?.({ editable: savable, busy, configured });
  }, [onState, savable, busy, configured]);

  if (!bridge) return null;

  const blocked = Boolean(blockedReason);

  async function run(
    kind: "save" | "remove",
    call: () => Promise<Reply<AiConnectionStatus>>,
  ) {
    if (busy || blocked) return;
    setAction(kind);
    setError(null);
    try {
      const next = unwrap(await call());
      if (keyRef.current) keyRef.current.value = "";
      adopt(next);
      onChanged?.(next);
    } catch (err) {
      setError(err);
    } finally {
      setAction(null);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canStore) return;
    const apiKey = keyRef.current?.value ?? "";
    const params = {
      temperature: Number(temperature),
      max_output: Number(maxOutput),
      timeout: Number(timeout),
    };
    void run("save", () =>
      bridge!.saveAiConnection(
        mode === "server"
          ? { mode, ...params }
          : {
              mode,
              base_url: baseUrl.trim(),
              model_id: modelId.trim(),
              ...(apiKey ? { api_key: apiKey } : {}),
              ...params,
            },
      ),
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
        <p className="setup-note">{t.managed}</p>
        <p className="setup-note">{t.policyNote}</p>
      </div>
    );
  }
  return (
    <form className="setup-fields" id={formId} onSubmit={save}>
      {state}
      <fieldset className="setup-choices setup-mode">
        <legend className="setup-legend">{t.modeLabel}</legend>
        {(["server", "custom"] as const).map((value) => (
          <label key={value} className="setup-choice">
            <input
              type="radio"
              name={`${formId ?? "ai"}-mode`}
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <span>
              {value === "server" ? t.modeServer : t.modeCustom}
              <small>
                {value === "server" ? t.modeServerHint : t.modeCustomHint}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "server" ? (
        <p className="setup-note" role="status">
          {account?.state === "signed_in" && account.origin
            ? t.serverSignedIn(account.origin)
            : t.serverSignedOut}
        </p>
      ) : !status.storage_available ? (
        <p className="setup-note">{t.storageUnavailable}</p>
      ) : (
        <>
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
        </>
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
      {/* Always present, so screen readers announce the text when it arrives. */}
      <div role="status">
        {busy && <p className="setup-note">{t.saving}</p>}
      </div>
      {blockedReason && <p className="setup-note">{blockedReason}</p>}
      {!hideActions && (
        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || blocked || !canStore}
          >
            {action === "save" ? m.setup.saving : t.save}
          </button>
          {showRemove && (
            <button
              type="button"
              disabled={busy || blocked || !status.configured}
              onClick={() =>
                void run("remove", () => bridge.clearAiConnection())
              }
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
