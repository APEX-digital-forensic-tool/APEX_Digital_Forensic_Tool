import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  X,
  ShieldCheck,
  LogIn,
  LogOut,
  Save,
  FolderOpen,
  Plus,
  Check,
} from "./icons";
import { gateway, unwrap, errorText, type Row } from "./gateway";
import { ReportCompare, ReportVersionDialog } from "./ReportTools";
import {
  isRequiredSection,
  reviewFlow,
  sectionStatus,
  type ReviewAction,
  type ReviewFlow,
} from "./reportWorkflow";
import {
  Badge,
  Fields,
  Loading,
  ErrorState,
  ResultState,
  Section,
  time,
} from "./ui";
import { useI18n } from "./i18n/I18nProvider";
import { lookup } from "./i18n/catalog";
export type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  max?: number;
  default?: string;
  options?: string[];
  /** Free text with these offered as completions (rendered as a datalist). */
  suggestions?: string[];
  /** Display names for options; falls back to the shared label map. */
  optionLabel?: (option: string) => string;
};
export function FormDialog({
  title,
  description,
  context,
  fields,
  onSubmit,
  onClose,
  submit,
}: {
  title: string;
  description?: string;
  /** What the decision is about, shown above the fields. */
  context?: ReactNode;
  fields: FieldSpec[];
  onSubmit: (data: Row) => Promise<void>;
  onClose: () => void;
  submit?: string;
}) {
  const { m } = useI18n();
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    (
      formRef.current?.querySelector<HTMLElement>("input, textarea, select") ??
      formRef.current?.querySelector<HTMLElement>("button")
    )?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        ref={formRef}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            onClose();
          }
          if (e.key !== "Tab") return;
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const data = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await onSubmit(data);
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            aria-label={m.panels.form.close}
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>
        {description && <p className="muted">{description}</p>}
        {context}
        {fields.map((f) => (
          <label key={f.key}>
            <span
              className="field-label"
              data-required-label={m.panels.form.required}
            >
              {f.label}
            </span>
            {f.type === "textarea" ? (
              <textarea
                name={f.key}
                defaultValue={f.default}
                required={f.required}
                maxLength={f.max}
                rows={5}
              />
            ) : f.options ? (
              <select
                name={f.key}
                defaultValue={f.default ?? (f.required ? "" : undefined)}
                required={f.required}
              >
                {f.required && f.default === undefined && (
                  <option value="" disabled>
                    {m.panels.form.choose}
                  </option>
                )}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {f.optionLabel?.(o) ?? lookup(m.labels, o)}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type={f.type ?? "text"}
                  name={f.key}
                  defaultValue={f.default}
                  required={f.required}
                  maxLength={f.max}
                  list={f.suggestions ? `${f.key}-suggestions` : undefined}
                  autoComplete={f.suggestions ? "off" : undefined}
                />
                {f.suggestions && (
                  <datalist id={`${f.key}-suggestions`}>
                    {f.suggestions.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                )}
              </>
            )}
          </label>
        ))}
        {error != null && <ErrorState error={error} />}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            {m.panels.form.cancel}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? m.panels.form.busy : (submit ?? m.panels.form.save)}
          </button>
        </footer>
      </form>
    </div>
  );
}
export function AccountPanel() {
  const { m } = useI18n();
  const [state, setState] = useState<Row>({ connected: false }),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.apex?.account().then(unwrap).then(setState).catch(setError);
  }, []);
  return (
    <div className="card">
      <h3>
        <ShieldCheck size={18} /> {m.panels.account.title}
      </h3>
      <p className="muted">{m.panels.account.body}</p>
      {state.connected ? (
        <>
          <p>
            <Badge value="AVAILABLE" /> {state.origin}
          </p>
          <button
            onClick={async () => {
              if (window.apex) {
                unwrap(await window.apex.logout());
                setState({ connected: false });
              }
            }}
          >
            <LogOut size={14} /> {m.panels.account.logout}
          </button>
          <p className="muted small">{m.panels.account.logoutHint}</p>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            try {
              if (window.apex) {
                setState(unwrap(await window.apex.login(data)));
                form.reset();
              }
            } catch (err) {
              setError(err);
            } finally {
              (form.elements.namedItem("password") as HTMLInputElement).value =
                "";
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              {m.panels.account.origin}
              <input
                name="origin"
                type="url"
                placeholder={m.panels.account.originPlaceholder}
                required
              />
            </label>
            <label>
              {m.panels.account.tenant}
              <input name="tenant_id" required />
            </label>
            <label>
              {m.panels.account.email}
              <input name="email" type="email" required />
            </label>
            <label>
              {m.panels.account.password}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          </div>
          <button disabled={!window.apex || busy}>
            <LogIn size={14} />
            {busy ? m.panels.account.signingIn : m.panels.account.connect}
          </button>
        </form>
      )}
      {error != null && <ErrorState error={error} />}
    </div>
  );
}
const POLICY_FLAGS = [
  "ai_enabled",
  "external_allowed",
  "local_only",
  "raw_allowed",
  "redaction_required",
  "projection_required",
] as const;
export function GovernanceAudit({ audit }: { audit: Row }) {
  const { m } = useI18n();
  const result = audit.result ?? {};
  const source = result.data?.source ?? {};
  const yesNo = (v: unknown) =>
    v === true
      ? m.panels.audit.applied
      : v === false
        ? m.panels.audit.notApplied
        : m.panels.audit.unknown;
  const fields: [string, unknown][] = [
    [m.panels.audit.case, source.case_id],
    [m.panels.audit.source, source.source_id],
    [m.panels.audit.sourceType, source.source_type],
    [m.panels.audit.classification, result.data?.classification],
    [m.panels.audit.destination, result.destination],
    [m.panels.audit.reason, result.reason],
    [m.panels.audit.redaction, yesNo(audit.redaction_applied)],
    [m.panels.audit.projection, yesNo(audit.projection_applied)],
    [m.panels.audit.policyRevision, result.policy_revision],
    [m.panels.audit.recordedAt, audit.created_at],
  ];
  return (
    <article className="audit">
      <Badge value={result.decision} />
      <dl className="audit-summary">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(value ?? "—")}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>{m.panels.audit.details}</summary>
        <Fields value={audit} />
      </details>
    </article>
  );
}
export function PolicyPanel({ caseId }: { caseId: string }) {
  const { m } = useI18n();
  const [policy, setPolicy] = useState<Row | null>(null),
    [audits, setAudits] = useState<Row[]>([]),
    [error, setError] = useState<unknown>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    try {
      const [p, a] = await Promise.all([
        gateway.call("policy.get", { case_id: caseId }),
        gateway.call<Row[]>("policy.audit", { case_id: caseId }),
      ]);
      setPolicy(p);
      setAudits(a);
      setLoaded(true);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => {
    void reload();
  }, [caseId]);
  return (
    <div className="card">
      <h3>{m.panels.policy.title}</h3>
      <p className="muted">{m.panels.policy.body}</p>
      {error != null && <ErrorState error={error} retry={reload} />}{" "}
      {!loaded ? (
        error != null ? null : (
          <Loading />
        )
      ) : (
        <form
          key={policy?.revision ?? 0}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const p: Row = {
              case_id: caseId,
              expected_revision: policy?.revision ?? 0,
              allowed_classifications: f.getAll("classification"),
              secret_handling: f.get("secret_handling"),
            };
            for (const k of POLICY_FLAGS) p[k] = f.has(k);
            setBusy(true);
            try {
              await gateway.call("policy.save", p);
              await reload();
              setError(null);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="policy-grid">
            {POLICY_FLAGS.map((k) => (
              <label className="check" key={k}>
                <input
                  name={k}
                  type="checkbox"
                  defaultChecked={
                    policy
                      ? !!policy[k]
                      : [
                          "local_only",
                          "redaction_required",
                          "projection_required",
                        ].includes(k)
                  }
                />
                {m.panels.policy.names[k]}
              </label>
            ))}
          </div>
          <fieldset>
            <legend>{m.panels.policy.classifications}</legend>
            {["PUBLIC", "INTERNAL", "SENSITIVE", "SECRET"].map((c) => (
              <label className="check inline" key={c}>
                <input
                  name="classification"
                  value={c}
                  type="checkbox"
                  defaultChecked={(
                    policy?.allowed_classifications ?? ["PUBLIC", "INTERNAL"]
                  ).includes(c)}
                />
                {c}
              </label>
            ))}
          </fieldset>
          <label>
            {m.panels.policy.secretHandling}
            <select
              name="secret_handling"
              defaultValue={policy?.secret_handling ?? "DENY"}
            >
              <option value="DENY">{m.panels.policy.deny}</option>
              <option value="REDACT">{m.panels.policy.redact}</option>
              <option value="ALLOW">{m.panels.policy.allow}</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            <Save size={14} /> {m.panels.policy.save}
          </button>
          <span className="muted small">
            {" "}
            {m.panels.policy.revision(
              policy?.revision ?? m.panels.policy.unset,
            )}
          </span>
        </form>
      )}
      <Section title={m.panels.policy.auditTitle(audits.length)}>
        {audits.length ? (
          <>
            <p className="muted small">{m.panels.policy.auditBody}</p>
            {audits.map((a, i) => (
              <GovernanceAudit key={a.audit_id ?? i} audit={a} />
            ))}
          </>
        ) : (
          <p className="muted">{m.panels.policy.auditNone}</p>
        )}
      </Section>
    </div>
  );
}
function ReviewFlowBar({
  flow,
  busy,
  olderThan,
  onAction,
}: {
  flow: ReviewFlow;
  busy: boolean;
  olderThan?: number;
  onAction: (action: ReviewAction | "export") => void;
}) {
  const hintId = useId();
  const { m } = useI18n();
  return (
    <section className="review-flow" aria-label={m.report.bar.label}>
      <ol className="review-steps">
        {m.report.reviewSteps.map((label, i) => {
          const current = i === flow.step;
          const state =
            i < flow.step ? "done" : current ? "current" : "upcoming";
          return (
            <li
              key={label}
              className={`${state} ${current && flow.tone ? flow.tone : ""}`}
              aria-current={current ? "step" : undefined}
            >
              <span className="review-step-mark" aria-hidden="true">
                {state === "done" ? <Check size={12} /> : i + 1}
              </span>
              {current && flow.stepLabel ? flow.stepLabel : label}
            </li>
          );
        })}
      </ol>
      <div className="review-next">
        <div className="review-guide">
          {olderThan !== undefined && (
            <p className="review-older">{m.report.bar.older(olderThan)}</p>
          )}
          <p id={hintId}>{flow.blocked ?? flow.hint}</p>
        </div>
        <div className="review-buttons">
          {flow.secondary.map((a) => (
            <button key={a} disabled={busy} onClick={() => onAction(a)}>
              {m.report.actions[a].label}
            </button>
          ))}
          <button
            className="primary"
            disabled={busy || flow.blocked !== undefined}
            aria-describedby={hintId}
            onClick={() => onAction(flow.primary)}
          >
            {m.report.actions[flow.primary].label}
          </button>
        </div>
      </div>
    </section>
  );
}
export function Reports({
  caseId,
  evidenceId,
  renderer,
  citations = [],
  onNotice,
}: {
  caseId: string;
  evidenceId: string;
  renderer: Row;
  citations?: Row[];
  onNotice: (s: string) => void;
}) {
  const { m } = useI18n();
  const [reports, setReports] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [versionId, setVersionId] = useState(""),
    [dialog, setDialog] = useState<
      "new" | "version" | "review" | "export" | null
    >(null),
    [action, setAction] = useState<ReviewAction>("submit"),
    [sectionId, setSectionId] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [exportResult, setExportResult] = useState<Row | null>(null);
  const [versionDraft, setVersionDraft] = useState<{
    reportId: string;
    evidenceId: string;
    base: Row | undefined;
    reportTitle: string;
    citations: Row[];
  } | null>(null);
  const [reportCursor, setReportCursor] = useState<string | null>(null);
  // Keep the current version and review dialog mounted during a refresh, but
  // never show the previous report's details under a new selection.
  const data = detail?.report.report_id === selected ? detail : null;
  const loadRevision = useRef(0);
  const load = async (id = selected, refreshList = true) => {
    const revision = ++loadRevision.current;
    setBusy(true);
    try {
      const [list, detail] = await Promise.all([
        refreshList ? gateway.call("reports.list", { case_id: caseId }) : null,
        id
          ? gateway.call("reports.get", { case_id: caseId, report_id: id })
          : null,
      ]);
      if (revision !== loadRevision.current) return;
      if (list) {
        setReports(list.items);
        setReportCursor(list.page?.next_cursor ?? null);
      }
      setDetail(detail);
      setError(null);
    } catch (err) {
      if (revision === loadRevision.current) setError(err);
    } finally {
      if (revision === loadRevision.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load(selected, !selected);
    return () => {
      loadRevision.current++;
    };
  }, [caseId, selected]);
  const versions: Row[] = data?.versions ?? [];
  const loadMore = async () => {
    if (!reportCursor || busy) return;
    const revision = ++loadRevision.current;
    setBusy(true);
    try {
      const next = await gateway.call("reports.list", {
        case_id: caseId,
        cursor: reportCursor,
      });
      if (revision !== loadRevision.current) return;
      setReports((previous) => [...previous, ...next.items]);
      setReportCursor(next.page?.next_cursor ?? null);
      setError(null);
    } catch (err) {
      if (revision === loadRevision.current) setError(err);
    } finally {
      if (revision === loadRevision.current) setBusy(false);
    }
  };
  const version =
    versions.find((v) => v.report_version_id === versionId) ?? versions.at(-1);
  const latest = versions.at(-1);
  const flow =
    version &&
    reviewFlow({
      version,
      decision:
        data?.approvals?.[version.report_version_id]?.decision ??
        version.approval_state?.decision,
      exported:
        data?.report?.status === "EXPORTED" &&
        data.report.active_version_id === version.report_version_id,
      m,
    });
  const review = (kind: ReviewAction, id: string | null = null) => {
    setAction(kind);
    setSectionId(id);
    setDialog("review");
  };
  const reviewSection = sectionId
    ? version?.sections.find((s: Row) => s.section_id === sectionId)
    : null;
  return (
    <div className="reports-layout">
      <aside className="report-list">
        <div className="section-heading">
          {m.report.list.heading}{" "}
          <button title={m.report.list.create} onClick={() => setDialog("new")}>
            <Plus size={15} />
          </button>
        </div>
        {reports.map((r) => (
          <button
            key={r.report_id}
            onClick={() => {
              setSelected(r.report_id);
              setVersionId("");
            }}
            className={selected === r.report_id ? "active" : ""}
          >
            <strong>{r.title}</strong>
            <Badge value={r.status} />
          </button>
        ))}
        {reportCursor && (
          <button disabled={busy} onClick={() => void loadMore()}>
            {m.report.list.more}
          </button>
        )}
      </aside>
      <div className="report-body">
        {error != null && <ErrorState error={error} retry={() => load()} />}{" "}
        {busy && <Loading />}
        {!selected ? (
          <div className="empty">
            <h2>{m.report.list.selectTitle}</h2>
            <p>{m.report.list.selectBody}</p>
            <button className="primary" onClick={() => setDialog("new")}>
              {m.report.list.create}
            </button>
          </div>
        ) : (
          <>
            <div className="report-heading">
              <div>
                <span className="muted small">{m.report.list.heading}</span>
                <h2>{data?.report?.title}</h2>
              </div>
              <button
                disabled={!data || busy || error != null}
                onClick={() => {
                  if (!data || busy || error != null) return;
                  setVersionDraft({
                    reportId: selected,
                    evidenceId,
                    base: version,
                    reportTitle: data.report.title,
                    citations: [...citations],
                  });
                  setDialog("version");
                }}
              >
                <Plus size={14} /> {m.report.list.newVersion}
              </button>
            </div>
            {versions.length > 0 && (
              <div className="toolbar">
                <select
                  aria-label={m.report.list.versionLabel}
                  value={version?.report_version_id ?? ""}
                  onChange={(e) => setVersionId(e.target.value)}
                >
                  {versions.map((v) => (
                    <option
                      key={v.report_version_id}
                      value={v.report_version_id}
                    >
                      {m.report.list.versionOption(
                        v.version_number,
                        lookup(m.labels, v.source_kind),
                      )}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {version && flow && (
              <>
                <ReviewFlowBar
                  flow={flow}
                  busy={busy}
                  olderThan={
                    latest && latest !== version
                      ? latest.version_number
                      : undefined
                  }
                  onAction={(a) =>
                    a === "export" ? setDialog("export") : review(a)
                  }
                />
                <ResultState data={version} />
                <p className="report-summary">{version.executive_summary}</p>
                {version.sections.map((s: Row) => {
                  const status = sectionStatus(version, s.section_id);
                  return (
                    <article key={s.section_id} className="report-section">
                      <header>
                        <h3>{s.title}</h3>
                        <div className="toolbar">
                          {!isRequiredSection(s) && (
                            <span className="muted small">
                              {m.report.list.optionalReview}
                            </span>
                          )}
                          {flow.stage !== "DRAFT" && <Badge value={status} />}
                          <Badge value={s.source_kind} />
                        </div>
                      </header>
                      <p>{s.content}</p>
                      {flow.sectionReview && (
                        <div className="toolbar">
                          {status !== "ACCEPTED" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                review("accept_section", s.section_id)
                              }
                            >
                              {m.report.actions.accept_section.label}
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              review("request_changes", s.section_id)
                            }
                          >
                            {m.report.actions.request_changes.label}
                          </button>
                        </div>
                      )}
                      <Section title={m.report.list.citations}>
                        <Fields value={s.citations} />
                      </Section>
                    </article>
                  );
                })}
                <Section title={m.report.list.limitations} initial>
                  <Fields
                    value={{
                      limitations: version.limitations,
                      content_fingerprint: version.content_fingerprint,
                      created_by: version.created_by,
                    }}
                  />
                </Section>
                <ReportCompare versions={versions} />
                <Section title={m.report.list.history}>
                  <Fields value={data?.reviews?.[version.report_version_id]} />
                </Section>
              </>
            )}
          </>
        )}
      </div>
      {exportResult && (
        <div className="export-result">
          <h3>{m.report.export.resultTitle}</h3>
          <button
            aria-label={m.report.export.closeResult}
            onClick={() => setExportResult(null)}
          >
            <X size={16} />
          </button>
          <Badge value={exportResult.manifest?.status} />
          <Fields value={exportResult.artifacts} />
          <Fields value={exportResult.manifest?.warnings} />
          <button onClick={() => window.apex?.openExports()}>
            {m.report.export.openFolder}
          </button>
        </div>
      )}
      {dialog === "new" && (
        <FormDialog
          title={m.report.list.create}
          fields={[
            {
              key: "title",
              label: m.report.create.titleField,
              required: true,
              max: 255,
            },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (f) => {
            const r = await gateway.call("reports.create", {
              case_id: caseId,
              ...f,
            });
            setSelected(r.report_id);
            await load(r.report_id);
          }}
        />
      )}
      {dialog === "version" && versionDraft && (
        <ReportVersionDialog
          caseId={caseId}
          {...versionDraft}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setVersionId("");
            await load();
          }}
        />
      )}
      {dialog === "review" && version && (
        <FormDialog
          title={
            reviewSection
              ? m.report.review.sectionTitle(
                  m.report.actions[action].title,
                  reviewSection.title,
                )
              : m.report.actions[action].title
          }
          description={m.report.actions[action].description}
          submit={m.report.actions[action].submit}
          fields={[
            {
              key: "reason",
              label: m.report.actions[action].field ?? m.report.review.reason,
              type: "textarea",
              required: true,
              max: 4096,
            },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (f) => {
            try {
              await gateway.call("reports.action", {
                case_id: caseId,
                report_version_id: version.report_version_id,
                action,
                reason: f.reason,
                section_id: sectionId,
                expected_review_revision: version.review_state.review_revision,
                expected_approval_revision:
                  version.approval_state?.approval_revision ?? null,
              });
              await load();
            } catch (err) {
              await load();
              throw err;
            }
          }}
        />
      )}{" "}
      {dialog === "export" && version && (
        <FormDialog
          title={m.report.export.title}
          description={m.report.export.description}
          fields={[
            {
              key: "format",
              label: m.report.export.format,
              options: renderer.supported_formats ?? ["HTML"],
            },
            {
              key: "filename",
              label: m.report.export.filename,
              default: "report.html",
              required: true,
              max: 200,
            },
            ...(version.stale_state?.is_stale
              ? [
                  {
                    key: "stale_confirmed",
                    label: m.report.export.staleConfirm,
                    type: "checkbox",
                    required: true,
                  },
                ]
              : []),
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (f) => {
            const r = await gateway.call("reports.export", {
              case_id: caseId,
              report_version_id: version.report_version_id,
              ...f,
              stale_confirmed: f.stale_confirmed === "on",
            });
            setExportResult(r);
            onNotice(
              r.manifest?.status === "COMPLETED"
                ? m.report.export.done
                : m.report.export.check,
            );
            await load();
          }}
        />
      )}
    </div>
  );
}
