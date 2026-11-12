import { useEffect, useRef, useState } from "react";
import { gateway, type Row } from "./gateway";
import { AlertCircle } from "./icons";
import { Badge, ErrorState, Fields, Loading, Section } from "./ui";
import { useI18n } from "./i18n/I18nProvider";

export function AiAssistant({
  caseId,
  selected,
}: {
  caseId: string;
  selected: { type: string; id: string } | null;
}) {
  const { m } = useI18n();
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("STRUCTURE");
  const [reviewed, setReviewed] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setResult(null);
    setError(null);
    setBusy(false);
    setReviewed(false);
    return () => {
      revision.current++;
    };
  }, [caseId, selected?.type, selected?.id, mode]);
  const supported =
    selected &&
    [
      "FILE_SYSTEM_NODE",
      "ARTIFACT",
      "TIMELINE_EVENT",
      "SEARCH_RESULT",
      "MACHINE_CANDIDATE",
    ].includes(selected.type);
  async function analyze(prepare = false) {
    if (!selected || busy) return;
    const current = ++revision.current;
    setBusy(true);
    setError(null);
    try {
      const response = await gateway.call(
        prepare ? "ai.prepare" : "ai.analyze",
        {
          case_id: caseId,
          resource_type: selected.type,
          resource_id: selected.id,
          mode,
          ...(mode === "CONTENT" && reviewed && result?.preview?.fingerprint
            ? { reviewed_fingerprint: result.preview.fingerprint }
            : {}),
        },
      );
      if (current === revision.current) {
        setResult(response);
        if (response.status === "REVIEW_REQUIRED") setReviewed(false);
      }
    } catch (err) {
      if (current === revision.current) setError(err);
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  const summary = result?.execution?.result;
  return (
    <div className="ai-panel">
      <p className="ai-lead">{m.ai.intro}</p>
      {!supported && <p className="ai-note">{m.ai.selectFirst}</p>}
      <label className="ai-field">
        {m.ai.mode}
        <select
          value={mode}
          disabled={busy}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="STRUCTURE">{m.ai.structure}</option>
          <option value="CONTENT">{m.ai.content}</option>
        </select>
      </label>
      {mode === "CONTENT" && (
        <section className="ai-excerpt" aria-labelledby="ai-excerpt-title">
          <h3 id="ai-excerpt-title">{m.ai.excerpt}</h3>
          <button
            disabled={!supported || busy}
            onClick={() => void analyze(true)}
          >
            {m.ai.prepare}
          </button>
          {result?.preview && (
            <>
              {/* The engine's notice is Korean-only; show the catalog's wording. */}
              {result.preview.notice && (
                <p className="ai-caution">
                  <AlertCircle size={15} />
                  <span>{m.ai.redactionNotice}</span>
                </p>
              )}
              <pre className="text-view" tabIndex={0}>
                {result.preview.payload.text}
              </pre>
              {result.preview.payload.truncated && (
                <p className="ai-note">{m.ai.truncated}</p>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>{m.ai.consent}</span>
              </label>
            </>
          )}
        </section>
      )}
      <button
        className="primary ai-request"
        disabled={
          !caseId || !supported || busy || (mode === "CONTENT" && !reviewed)
        }
        onClick={() => void analyze()}
      >
        {m.ai.request}
      </button>
      {busy && <Loading />}
      {error != null && (
        <ErrorState error={error} retry={() => void analyze()} />
      )}
      {result?.status === "CONFIGURATION_REQUIRED" && (
        <p className="ai-status-note" role="status">
          {m.ai.configRequired}
        </p>
      )}
      {result?.status === "POLICY_DENIED" && (
        <p className="ai-status-note" role="status">
          {m.ai.policyDenied}
        </p>
      )}
      {result?.audit && (
        <Section title={m.ai.policyEvaluation}>
          <Fields value={result.audit.result} />
        </Section>
      )}
      {summary && (
        <Section title={summary.title ?? m.ai.resultTitle}>
          <Badge value="AI_INFERENCE" />
          <p>{summary.summary_text}</p>
          <ul>
            {summary.key_points?.map((point: string, index: number) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
          <p className="muted small">
            {mode === "CONTENT"
              ? m.ai.contentDisclaimer
              : m.ai.structureDisclaimer}
          </p>
          <Section title={m.ai.sources}>
            <Fields value={summary.citations} />
          </Section>
        </Section>
      )}
      {result?.request && (
        <Section title={m.ai.savedRequest}>
          <Fields
            value={{
              assistance_request_id: result.request.assistance_request_id,
              context_snapshot_id: result.request.context_snapshot_id,
            }}
          />
        </Section>
      )}
    </div>
  );
}
