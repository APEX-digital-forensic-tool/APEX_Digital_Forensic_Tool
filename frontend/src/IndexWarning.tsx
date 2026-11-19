import { useState } from "react";
import { gateway, type Row } from "./gateway";
import { ErrorState } from "./ui";
import { useI18n } from "./i18n/I18nProvider";

/**
 * Says which evidence has no (or a partial) search index or timeline, so an
 * empty result is never read as "nothing found", and offers the build.
 */
export function IndexWarning({
  route,
  caseId,
  state,
  onStarted,
}: {
  route: "SEARCH" | "TIMELINE";
  caseId: string;
  state: Row[] | undefined;
  onStarted: () => void;
}) {
  const { m } = useI18n();
  const t = m.views.indexState;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = route === "SEARCH" ? "search" : "timeline";
  const pending = (state ?? []).filter((e) => e[key]?.state !== "CURRENT");
  if (!pending.length) return null;
  async function build(evidenceId: string, kind: string) {
    setBusy(true);
    setError(null);
    try {
      await gateway.call("analysis.start", {
        case_id: caseId,
        evidence_id: evidenceId,
        kind,
        profile_type: "FULL_ANALYSIS",
      });
      onStarted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {pending.map((e) => {
        const none = e[key].state === "NONE";
        const needsFiles =
          e[key].source_items === 0 ||
          ["PARTIAL", "FAILED", "CANCELLED", "NOT_STARTED"].includes(
            e[key].source_status,
          );
        const failed = e[key].status === "FAILED";
        // A failed build is reported as failed even when it had nothing to build from.
        const message =
          route === "SEARCH"
            ? (failed ? t.searchFailed : none ? t.searchNone : t.searchPartial)(
                e.display_name,
              )
            : (failed
                ? t.timelineFailed
                : none
                  ? t.timelineNone
                  : t.timelinePartial)(e.display_name);
        const kind = needsFiles ? "FILES" : route;
        return (
          <div className="notice" role="status" key={e.evidence_id}>
            <span>
              {message}
              {needsFiles && ` ${t.needsFiles}`}
            </span>
            <button
              disabled={
                busy ||
                ["QUEUED", "RUNNING", "CANCELLING"].includes(e[key].status)
              }
              onClick={() => void build(e.evidence_id, kind)}
            >
              {needsFiles
                ? t.buildFiles
                : route === "SEARCH"
                  ? t.buildSearch
                  : t.buildTimeline}
            </button>
          </div>
        );
      })}
      {error != null && <ErrorState error={error} />}
    </>
  );
}
