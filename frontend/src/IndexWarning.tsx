import { useEffect, useState } from "react";
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
  evidenceId,
  state,
  tasks,
  onStarted,
}: {
  route: "SEARCH" | "TIMELINE";
  caseId: string;
  evidenceId?: string;
  state: Row[] | undefined;
  tasks: Row[];
  onStarted: () => void;
}) {
  const { m } = useI18n();
  const t = m.views.indexState;
  const [error, setError] = useState<unknown>(null);
  /** Builds this panel started: the job kind and the tasks that existed before it. */
  const [started, setStarted] = useState<
    Record<string, { kind: string; known: string[] }>
  >({});
  useEffect(() => {
    setError(null);
    setStarted({});
  }, [route, caseId]);
  // Before any query or after a build finishes the page has no fresh state: ask the engine.
  const [fetched, setFetched] = useState<Row[] | undefined>();
  const settled = tasks.filter(
    (task) => !["QUEUED", "RUNNING", "CANCELLING"].includes(task.status),
  ).length;
  useEffect(() => {
    if (state !== undefined || !caseId) return;
    let live = true;
    gateway
      .call("index.state", { case_id: caseId, evidence_id: evidenceId || null })
      .then((rows) => live && setFetched(rows as Row[]))
      .catch(() => live && setFetched(undefined));
    return () => {
      live = false;
    };
  }, [state, caseId, evidenceId, route, settled]);
  const running = (evidenceId: string) => {
    const s = started[evidenceId];
    if (!s) return false;
    const fresh = tasks.filter(
      (task) => task.kind === s.kind && !s.known.includes(task.task_id),
    );
    // No new task listed yet means the request is still on its way.
    return (
      fresh.length === 0 ||
      fresh.some((task) =>
        ["QUEUED", "RUNNING", "CANCELLING"].includes(task.status),
      )
    );
  };
  const key = route === "SEARCH" ? "search" : "timeline";
  const pending = (state ?? fetched ?? []).filter(
    (e) => e[key]?.state !== "CURRENT",
  );
  if (!pending.length) return null;
  async function build(evidenceId: string, kind: string) {
    setStarted((all) => ({
      ...all,
      [evidenceId]: { kind, known: tasks.map((task) => task.task_id) },
    }));
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
      setStarted(({ [evidenceId]: _dropped, ...rest }) => rest);
    }
  }
  return (
    <>
      {pending.map((e) => {
        const none = e[key].state === "NONE";
        const needsFiles = Boolean(e[key].needs_files);
        const message =
          route === "SEARCH"
            ? (none ? t.searchNone : t.searchPartial)(e.display_name)
            : (none
                ? t.timelineNone
                : e.timeline.failed
                  ? t.timelineFailed
                  : e.timeline.stale
                    ? t.timelineStale
                    : t.timelinePartial)(e.display_name);
        const kind = needsFiles ? "FILES" : route;
        return (
          <div className="notice" role="status" key={e.evidence_id}>
            <span>
              {message}
              {needsFiles && ` ${t.needsFiles}`}
            </span>
            <button
              disabled={running(e.evidence_id)}
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
