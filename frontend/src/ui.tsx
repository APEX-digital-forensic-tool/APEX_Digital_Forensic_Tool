import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  SearchX,
} from "./icons";
import { type Row, errorText } from "./gateway";
import { useI18n } from "./i18n/I18nProvider";
import { lookup, type Messages } from "./i18n/catalog";
/** Case display timezone; App provides the current case's IANA zone. */
export const DisplayZone = createContext("Asia/Seoul");
const ISO_INSTANT =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/;
/** "UTC+9" style offset of `zone` at `at`. */
export function zoneOffset(zone: string, at: Date = new Date()) {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) return zone;
    return name.replace(/^GMT/, "UTC").replace(/^UTC(?:[+-]0)?$/, "UTC");
  } catch {
    return zone;
  }
}
/** Column-header label: a fixed offset, or the IANA name for DST zones. */
export function zoneLabel(zone: string) {
  const winter = zoneOffset(zone, new Date(Date.UTC(2026, 0, 15)));
  const summer = zoneOffset(zone, new Date(Date.UTC(2026, 6, 15)));
  return winter === summer ? winter : zone;
}
/** Plain-language value for a table cell or field. */
export function displayValue(
  value: unknown,
  zone: string,
  m: Messages,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value))
    return value.length
      ? value.map((v) => displayValue(v, zone, m)).join(", ")
      : "—";
  if (typeof value === "boolean") return value ? m.ui.yes : m.ui.no;
  if (typeof value === "string")
    return ISO_INSTANT.test(value)
      ? time(value, zone, m)
      : lookup(m.labels, value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
/** Custody wording wins where the shared label means a report or case status. */
export const custodyEvent = (type: unknown, m: Messages) =>
  typeof type === "string"
    ? lookup({ ...m.labels, ...m.ui.custodyOverrides }, type)
    : "—";
/** Image formats (RAW, E01, …) are proper names; only a folder is translated. */
export const evidenceFormat = (format: unknown, m: Messages) =>
  format === "DIRECTORY"
    ? m.ui.folder
    : typeof format === "string"
      ? format
      : "—";
/** 0–1 confidence as a percentage; categorical confidence as its label. */
export function confidence(value: unknown, m: Messages) {
  if (typeof value === "number" && value >= 0 && value <= 1)
    return `${Math.round(value * 100)}%`;
  return displayValue(value, "UTC", m);
}
export function Badge({ value }: { value: unknown }) {
  const { m } = useI18n();
  const text = String(value ?? "UNKNOWN");
  return (
    <span
      className={`badge ${/FAIL|DENY|MISMATCH|REJECT|CORRUPT/.test(text) ? "red" : /PARTIAL|STALE|LIMIT|REQUIRED|UNAVAILABLE|UNKNOWN|INTERRUPTED|CANDIDATE|UNSUPPORTED|CHANGES_REQUESTED|AI_/.test(text) ? "amber" : /AVAILABLE|COMPLETE|SUCCEEDED|APPROVED|ACCEPTED|READY|MATCH|ALLOW$/.test(text) ? "green" : ""}`}
    >
      {lookup(m.labels, text)}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  const { m } = useI18n();
  return (
    <div className="empty">
      <SearchX size={30} />
      <h2>{title ?? m.ui.empty.title}</h2>
      <p>{children ?? m.ui.empty.body}</p>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { m } = useI18n();
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={16} />
      <span>{errorText(error, m)}</span>
      {retry && <button onClick={retry}>{m.ui.retry}</button>}
    </div>
  );
}
export function Loading() {
  const { m } = useI18n();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={18} /> {m.ui.loading}
    </div>
  );
}
export function ResultState({ data }: { data: Row | null | undefined }) {
  const { m } = useI18n();
  if (!data) return null;
  const coverage = data.coverage;
  const partial =
    data.is_partial ||
    data.partial_state?.is_partial ||
    (coverage && !["COMPLETE", "SUCCEEDED"].includes(coverage.status));
  const stale =
    data.is_stale ||
    data.stale_state?.is_stale ||
    data.stale_reasons?.length > 0;
  return (
    <>
      {partial && (
        <div className="notice">
          <Badge value="PARTIAL" />
          {m.ui.result.partial}
        </div>
      )}
      {stale && (
        <div className="notice">
          <Badge value="STALE" />
          {m.ui.result.stale}
        </div>
      )}
      {coverage && (
        <div className="coverage">
          <span>{m.ui.result.coverage}</span>
          <Badge value={coverage.status} />
          <span>
            {m.ui.result.coverageCounts(
              coverage.discovered_items ?? "—",
              coverage.processed_items ?? "—",
              coverage.warning_count ?? 0,
            )}
          </span>
        </div>
      )}
      {data.warnings?.length > 0 && (
        <details className="warnings">
          <summary>{m.ui.result.warnings(data.warnings.length)}</summary>
          <Fields value={data.warnings} />
        </details>
      )}
    </>
  );
}
/** Single-value timestamp with its offset, e.g. "2026-09-14 09:00:00 (UTC+9)". */
export function timeWithZone(value: unknown, zone: string, m: Messages) {
  const text = time(value, zone, m);
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return text;
  return `${text} (${zoneOffset(zone, new Date(value))})`;
}
export function Fields({ value }: { value: unknown }) {
  const zone = useContext(DisplayZone);
  const { m } = useI18n();
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (Array.isArray(value))
    return (
      <div className="field-list">
        {value.map((v, i) => (
          <div key={i}>
            <Fields value={v} />
          </div>
        ))}
      </div>
    );
  if (typeof value === "object")
    return (
      <dl className="fields">
        {Object.entries(value)
          .filter(
            ([k]) => k !== "developer_message" && !k.endsWith("_resource_key"),
          )
          .map(([k, v]) => (
            <div key={k}>
              <dt>{lookup(m.ui.fieldNames, k)}</dt>
              <dd>
                {typeof v === "object" && v !== null ? (
                  <details>
                    <summary>
                      {Array.isArray(v)
                        ? m.ui.fields.itemCount(v.length)
                        : m.ui.fields.details}
                    </summary>
                    <Fields value={v} />
                  </details>
                ) : v === "<redacted>" ? (
                  m.ui.fields.redacted
                ) : typeof v === "boolean" ? (
                  v ? (
                    m.ui.yes
                  ) : (
                    m.ui.no
                  )
                ) : typeof v === "string" ? (
                  ISO_INSTANT.test(v) ? (
                    <span title={m.ui.fields.utcOriginal(v)}>
                      {timeWithZone(v, zone, m)}
                    </span>
                  ) : (
                    lookup(m.labels, v)
                  )
                ) : (
                  String(v ?? "—")
                )}
              </dd>
            </div>
          ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
const fileTypes: Record<string, string> = {
  db: "database",
  sqlite: "database",
  sqlite3: "database",
  edb: "database",
  mdb: "database",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  heic: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  flac: "audio",
  zip: "zip",
  rar: "zip",
  "7z": "zip",
  gz: "zip",
  tar: "zip",
  doc: "word",
  docx: "word",
  xls: "table",
  xlsx: "table",
  csv: "table",
  ppt: "powerpoint",
  pptx: "powerpoint",
  json: "json",
  xml: "xml",
  html: "html",
  js: "javascript",
  ts: "typescript",
  py: "python",
  md: "markdown",
  eml: "email",
  msg: "email",
  log: "log",
  evtx: "log",
  ini: "settings",
  cfg: "settings",
  exe: "exe",
  dll: "exe",
  e01: "disc",
  img: "disc",
  dd: "disc",
  vhd: "disc",
  vhdx: "disc",
};
export function fileIconName(row: Row) {
  if (["DIRECTORY", "ROOT"].includes(row.node_type)) return "folder-base";
  const ext = String(
    row.extension ??
      String(row.original_name ?? "")
        .split(".")
        .pop() ??
      "",
  )
    .replace(/^\./, "")
    .toLowerCase();
  return fileTypes[ext] ?? "document";
}
export function FileIcon({ row }: { row: Row }) {
  return (
    <img
      className="material-file-icon"
      src={`./icons/material/${fileIconName(row)}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
export function ArtifactSemantics({ row }: { row: Row }) {
  const type = String(row.artifact_type ?? "");
  return (
    <>
      {row.is_deleted || type.includes("DELETED") ? (
        <Badge value="DELETED_CANDIDATE" />
      ) : type.includes("PRIVATE_MODE_CANDIDATE") ? (
        <Badge value="PRIVATE_MODE_CANDIDATE" />
      ) : null}
    </>
  );
}
export function RawPreview({ data }: { data: Row }) {
  const { m } = useI18n();
  const [format, setFormat] = useState("hex");
  const { hex_preview, text_preview, ...metadata } = data;
  const remaining = [
    data.total_length,
    data.returned_offset,
    data.returned_length,
  ].every((value) => typeof value === "number" && Number.isFinite(value))
    ? Math.max(
        0,
        data.total_length - data.returned_offset - data.returned_length,
      )
    : null;
  return (
    <>
      <div className="raw-preview">
        <header>
          <span>{m.ui.raw.preview}</span>
          <div className="tabs compact" aria-label={m.ui.raw.formatLabel}>
            <button
              aria-pressed={format === "hex"}
              className={format === "hex" ? "active" : ""}
              onClick={() => setFormat("hex")}
            >
              Hex
            </button>
            <button
              aria-pressed={format === "text"}
              className={format === "text" ? "active" : ""}
              onClick={() => setFormat("text")}
            >
              {m.ui.raw.text}
            </button>
          </div>
        </header>
        <pre
          aria-label={format === "hex" ? m.ui.raw.hexLabel : m.ui.raw.textLabel}
        >
          {(format === "hex" ? hex_preview : text_preview) ??
            m.ui.raw.unavailable}
        </pre>
      </div>
      {data.truncated && <p className="muted small">{m.ui.raw.truncated}</p>}
      <Fields value={{ ...metadata, remaining_bytes: remaining }} />
    </>
  );
}
export const textValue = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
export const rowId = (r: Row) =>
  String(
    r.id ??
      r.report_id ??
      r.candidate_id ??
      r.timeline_event_id ??
      r.search_result_id ??
      r.result_id ??
      r.event_id ??
      r.task_id ??
      r.capability_id ??
      r.source_id ??
      "",
  );
export const size = (n: unknown) => {
  if (typeof n !== "number") return "—";
  if (n < 1024) return `${n} B`;
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
};
export function time(value: unknown, zone: string, m: Messages) {
  if (typeof value !== "string") return "—";
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value)) return value + m.ui.timeZoneUnknown;
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
export type Column = {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
  width?: number;
};
export function Table({
  rows,
  columns,
  selected,
  onSelect,
  onOpen,
  onSort,
}: {
  rows: Row[];
  columns: Column[];
  selected?: string;
  onSelect?: (r: Row) => void;
  onOpen?: (r: Row) => void;
  onSort?: (sort: { key: string; asc: boolean }) => void;
}) {
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const zone = useContext(DisplayZone);
  const { locale, m } = useI18n();
  const display = useMemo(
    () =>
      sort
        ? [...rows].sort((a, b) => {
            const x = a[sort.key],
              y = b[sort.key];
            return (
              (typeof x === "number" && typeof y === "number"
                ? x - y
                : textValue(x).localeCompare(textValue(y), locale)) *
              (sort.asc ? 1 : -1)
            );
          })
        : rows,
    [rows, sort, locale],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [focusIndex, setFocusIndex] = useState(0);
  const rowHeight = 30;
  const virtual = display.length > 200;
  const start = virtual
    ? Math.max(0, Math.floor((scrollTop - 36) / rowHeight) - 6)
    : 0;
  const end = virtual
    ? Math.min(display.length, start + Math.ceil(height / rowHeight) + 14)
    : display.length;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
    setFocusIndex(0);
  }, [rows, sort]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setHeight(el.clientHeight || 600),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="table-scroll"
      ref={scroller}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <table aria-rowcount={rows.length + 1}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ minWidth: c.width }}
                aria-sort={
                  sort?.key === c.key
                    ? sort.asc
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  title={m.ui.table.sort}
                  onClick={() => {
                    const next = {
                      key: c.key,
                      asc: sort?.key === c.key ? !sort.asc : true,
                    };
                    setSort(next);
                    onSort?.(next);
                  }}
                >
                  {c.label}
                  <ChevronDown size={11} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{ height: start * rowHeight, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {display.slice(start, end).map((r, i) => (
            <tr
              key={rowId(r) || i}
              className={`${selected === rowId(r) ? "selected" : ""} ${r.is_deleted ? "deleted" : ""}`}
              data-row-index={start + i}
              aria-rowindex={start + i + 2}
              tabIndex={
                onSelect ? (focusIndex === start + i ? 0 : -1) : undefined
              }
              aria-selected={selected === rowId(r)}
              onClick={() => {
                setFocusIndex(start + i);
                onSelect?.(r);
              }}
              onDoubleClick={() => onOpen?.(r)}
              onKeyDown={(e) => {
                if (!onSelect) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(r);
                  if (e.key === "Enter") onOpen?.(r);
                }
                const target =
                  e.key === "ArrowDown"
                    ? start + i + 1
                    : e.key === "ArrowUp"
                      ? start + i - 1
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? display.length - 1
                          : null;
                if (target === null) return;
                e.preventDefault();
                const index = Math.max(0, Math.min(display.length - 1, target));
                setFocusIndex(index);
                onSelect(display[index]);
                const el = scroller.current;
                if (el && virtual && (index < start || index >= end)) {
                  el.scrollTop = index * rowHeight;
                  setScrollTop(el.scrollTop);
                }
                requestAnimationFrame(() =>
                  el
                    ?.querySelector<HTMLTableRowElement>(
                      `tr[data-row-index="${index}"]`,
                    )
                    ?.focus(),
                );
              }}
            >
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(r) : displayValue(r[c.key], zone, m)}
                </td>
              ))}
            </tr>
          ))}
          {end < display.length && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{
                  height: (display.length - end) * rowHeight,
                  padding: 0,
                  border: 0,
                }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Section({
  title,
  children,
  initial = false,
}: {
  title: string;
  children: ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="inspector-section">
      <button
        className="section-title"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title}
      </button>
      {open && children}
    </section>
  );
}
