import { useEffect, useRef, useState } from "react";
import { gateway, type Row } from "./gateway";
import { ErrorState, Fields, Loading, Section } from "./ui";
import { X } from "./icons";
import { useI18n } from "./i18n/I18nProvider";

export function ForensicTools({
  caseId,
  evidenceId,
  selected,
  onTask,
}: {
  caseId: string;
  evidenceId: string;
  selected: Row | null;
  onTask: () => void;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [streams, setStreams] = useState<Row[]>([]);
  const [streamId, setStreamId] = useState("");
  const [offset, setOffset] = useState("0");
  const [language, setLanguage] = useState("eng");
  const [scope, setScope] = useState("UNALLOCATED");
  const [budget, setBudget] = useState("256");
  const [carveOffset, setCarveOffset] = useState("0");
  const revision = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const file = selected?.node_type === "FILE";
  const imageFile =
    selected?.filesystem_provider?.id === "apex.pytsk_filesystem_provider";
  useEffect(() => {
    setCarveOffset("0");
  }, [caseId, evidenceId]);
  useEffect(() => {
    revision.current++;
    setResult(null);
    setError(null);
    setStreams([]);
    setStreamId("");
    setOffset("0");
    setBusy(false);
    setOpen(false);
    return () => {
      revision.current++;
    };
  }, [caseId, evidenceId, selected?.id]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function call(operation: string, payload: Row, task = false) {
    const current = ++revision.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await gateway.call(operation, {
        case_id: caseId,
        ...payload,
      });
      if (current !== revision.current) return;
      if (operation === "files.streams") {
        setStreams(data.streams);
        setStreamId(String(data.streams[0]?.id ?? ""));
      } else setResult(data);
      if (task) onTask();
    } catch (err) {
      if (current === revision.current) setError(err);
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  const node = { node_id: selected?.id };
  return (
    <>
      <div className="tools-strip">
        <span>{m.tools.forensic.strip}</span>
        <button
          disabled={!caseId || !evidenceId}
          onClick={() => setOpen(true)}
          title={m.tools.forensic.openTitle}
        >
          {m.tools.forensic.open}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="modal forensic-tools"
        onCancel={() => setOpen(false)}
      >
        <header className="forensic-tools-header">
          <h2>{m.tools.forensic.title}</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label={m.tools.forensic.close}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          {m.tools.forensic.subject(
            selected?.original_name ?? m.tools.forensic.selectedEvidence,
          )}
        </p>
        <Section title={m.tools.forensic.recover.title}>
          <p>{m.tools.forensic.recover.body}</p>
          <button
            disabled={busy || !file || !selected?.is_deleted}
            onClick={() => void call("files.recover", node, true)}
          >
            {m.tools.forensic.recover.action}
          </button>
        </Section>
        <Section title={m.tools.forensic.streams.title}>
          <button
            disabled={busy || !file || !imageFile || !!selected?.is_deleted}
            onClick={() => void call("files.streams", node)}
          >
            {m.tools.forensic.streams.list}
          </button>
          {streams.length > 0 && (
            <>
              <label>
                {m.tools.forensic.streams.stream}
                <select
                  aria-label={m.tools.forensic.streams.streamLabel}
                  disabled={busy}
                  value={streamId}
                  onChange={(e) => {
                    setStreamId(e.target.value);
                    setOffset("0");
                    setResult(null);
                  }}
                >
                  {streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {m.tools.forensic.streams.option(
                        s.name || m.tools.forensic.streams.defaultStream,
                        s.size,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.tools.forensic.streams.offset}
                <input
                  disabled={busy}
                  value={offset}
                  onChange={(e) => {
                    setOffset(e.target.value);
                    setResult(null);
                  }}
                />
              </label>
              <button
                disabled={
                  busy ||
                  !streamId ||
                  !offset.trim() ||
                  !Number.isSafeInteger(Number(offset)) ||
                  Number(offset) < 0
                }
                onClick={() =>
                  void call("streams.read", {
                    ...node,
                    stream_id: Number(streamId),
                    offset: Number(offset),
                  })
                }
              >
                {m.tools.forensic.streams.read}
              </button>
              <button
                disabled={busy || !streamId}
                onClick={() =>
                  void call(
                    "streams.export",
                    { ...node, stream_id: Number(streamId) },
                    true,
                  )
                }
              >
                {m.tools.forensic.streams.export}
              </button>
            </>
          )}
        </Section>
        <Section title={m.tools.forensic.machine.title}>
          <p>{m.tools.forensic.machine.body}</p>
          <label>
            {m.tools.forensic.machine.language}
            <select
              disabled={busy}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="eng">{m.tools.forensic.machine.ocrEng}</option>
              <option value="kor+eng">
                {m.tools.forensic.machine.ocrKorEng}
              </option>
              <option value="ko">{m.tools.forensic.machine.sttKo}</option>
              <option value="en">{m.tools.forensic.machine.sttEn}</option>
              <option value="auto">{m.tools.forensic.machine.sttAuto}</option>
            </select>
          </label>
          {(["OCR", "STT"] as const).map((kind) => (
            <button
              key={kind}
              disabled={busy || !file || !!selected?.is_deleted}
              onClick={() =>
                void call(
                  "machine.run",
                  {
                    ...node,
                    kind,
                    language:
                      kind === "STT"
                        ? ({ eng: "en", "kor+eng": "ko" }[language] ?? language)
                        : ({ ko: "kor", en: "eng", auto: "eng" }[language] ??
                          language),
                  },
                  true,
                )
              }
            >
              {kind === "OCR"
                ? m.tools.forensic.machine.runOcr
                : m.tools.forensic.machine.runStt}
            </button>
          ))}
        </Section>
        <Section title={m.tools.forensic.carve.title}>
          <p>{m.tools.forensic.carve.body}</p>
          <label>
            {m.tools.forensic.carve.scope}
            <select
              disabled={busy}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="UNALLOCATED">
                {m.tools.forensic.carve.unallocated}
              </option>
              <option value="IMAGE">{m.tools.forensic.carve.wholeImage}</option>
            </select>
          </label>
          <label>
            {m.tools.forensic.carve.budget}
            <input
              type="number"
              disabled={busy}
              min="1"
              max="1048576"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label>
            {m.tools.forensic.carve.startOffset}
            <input
              disabled={busy}
              value={carveOffset}
              onChange={(e) => setCarveOffset(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !budget.trim() ||
              !Number.isSafeInteger(Number(budget)) ||
              Number(budget) < 1 ||
              Number(budget) > 1048576 ||
              !carveOffset.trim() ||
              !Number.isSafeInteger(Number(carveOffset)) ||
              Number(carveOffset) < 0
            }
            onClick={() =>
              void call(
                "evidence.carve",
                {
                  evidence_id: evidenceId,
                  scope,
                  max_scan_bytes: Number(budget) * 1048576,
                  start_offset: Number(carveOffset),
                },
                true,
              )
            }
          >
            {m.tools.forensic.carve.start}
          </button>
          <p>{m.tools.forensic.carve.resume}</p>
        </Section>
        {busy && <Loading />}
        {error != null && <ErrorState error={error} />}
        {result && (
          <Section
            title={
              result.task_id
                ? m.tools.forensic.taskRegistered
                : m.tools.forensic.result
            }
          >
            {result.text_preview && (
              <pre className="text-view">{result.text_preview}</pre>
            )}
            <Fields value={result} />
          </Section>
        )}
        <button onClick={() => window.apex?.openExports()}>
          {m.tools.forensic.openFolder}
        </button>
      </dialog>
    </>
  );
}
