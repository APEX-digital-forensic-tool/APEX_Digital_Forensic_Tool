import { useEffect, useRef, useState } from "react";
import { gateway, type Row } from "./gateway";
import { ErrorState, Fields, Loading } from "./ui";
import { useI18n } from "./i18n/I18nProvider";

export function VideoInspector({
  caseId,
  resourceType,
  resourceId,
}: {
  caseId: string;
  resourceType: string;
  resourceId: string;
}) {
  const { m } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    revision.current++;
    setResult(null);
    setError(null);
    setBusy(false);
    setSeconds(0);
    return () => {
      revision.current++;
    };
  }, [caseId, resourceType, resourceId]);
  async function inspect() {
    const id = ++revision.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await gateway.call("media.video", {
        case_id: caseId,
        resource_type: resourceType,
        resource_id: resourceId,
        timestamp_seconds: seconds,
        max_dimension: 1536,
      });
      if (id === revision.current) setResult(data);
    } catch (e) {
      if (id === revision.current) setError(e);
    } finally {
      if (id === revision.current) setBusy(false);
    }
  }
  return (
    <>
      <button onClick={() => dialog.current?.showModal()}>
        {m.tools.video.open}
      </button>
      <dialog
        className="image-dialog"
        ref={dialog}
        aria-labelledby="video-inspector-title"
      >
        <header>
          <h2 id="video-inspector-title">{m.tools.video.open}</h2>
          <button onClick={() => dialog.current?.close()}>
            {m.panels.form.close}
          </button>
        </header>
        <p>{m.tools.video.intro}</p>
        <p className="muted small">{m.tools.video.limits}</p>
        <label>
          {m.tools.video.seconds}
          <input
            type="number"
            min={0}
            max={604800}
            step={0.1}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
        <button
          disabled={
            busy || !Number.isFinite(seconds) || seconds < 0 || seconds > 604800
          }
          onClick={() => void inspect()}
        >
          {m.tools.video.read}
        </button>
        {busy && <Loading />}
        {error != null && <ErrorState error={error} />}
        {result && (
          <>
            <p>{m.tools.video.requested(result.timestamp_seconds_requested)}</p>
            <div className="image-viewport">
              <img alt={m.tools.video.alt} src={result.image_url} />
            </div>
            <details>
              <summary>{m.tools.video.details}</summary>
              <Fields
                value={Object.fromEntries(
                  Object.entries(result).filter(([key]) => key !== "image_url"),
                )}
              />
            </details>
          </>
        )}
      </dialog>
    </>
  );
}
