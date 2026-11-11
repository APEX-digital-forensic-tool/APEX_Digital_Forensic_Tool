import { type Row } from "../gateway";
import { integritySummary, shortDigest } from "../EvidenceIntake";
import {
  Badge,
  FileIcon,
  evidenceFormat,
  size,
  textValue,
  timeWithZone,
} from "../ui";
import { useI18n } from "../i18n/I18nProvider";
import { lookup } from "../i18n/catalog";

export function Properties({
  row,
  evidence,
  zone,
}: {
  row: Row | null;
  evidence?: Row;
  zone: string;
}) {
  const { m } = useI18n();
  const item = row ?? evidence;
  if (!item)
    return <p className="pane-empty">{m.workbench.properties.empty}</p>;
  const fields: [string, unknown][] = row?.node_type
    ? [
        [m.workbench.properties.name, row.original_name],
        [m.workbench.properties.type, lookup(m.labels, row.node_type)],
        [m.workbench.properties.path, row.display_path],
        [m.workbench.properties.size, size(row.file_size)],
        [m.workbench.properties.fileId, row.id],
        ["MIME", row.mime_candidate],
        [
          m.workbench.properties.deleteState,
          row.is_deleted
            ? m.workbench.properties.deleted
            : m.workbench.properties.notDeleted,
        ],
        [
          m.workbench.properties.created,
          timeWithZone(row.utc_timestamps?.created, zone, m),
        ],
        [
          m.workbench.properties.modified,
          timeWithZone(row.utc_timestamps?.modified, zone, m),
        ],
        [
          m.workbench.properties.accessed,
          timeWithZone(row.utc_timestamps?.accessed, zone, m),
        ],
        [
          m.workbench.properties.scope,
          row.is_partial
            ? m.workbench.properties.partial
            : m.workbench.properties.observed,
        ],
      ]
    : [
        [m.workbench.properties.name, item.display_name ?? item.title],
        [
          m.workbench.properties.type,
          item.format
            ? evidenceFormat(item.format, m)
            : lookup(m.labels, item.artifact_type),
        ],
        [m.workbench.properties.size, size(item.size_bytes)],
        [m.workbench.properties.status, lookup(m.labels, item.status)],
        [m.workbench.properties.evidenceId, item.id],
        [m.workbench.properties.reader, item.reader?.id],
      ];
  return (
    <div className="properties-content">
      <div className="property-selection">
        <FileIcon row={item} />
        <strong>
          {item.original_name ??
            item.display_name ??
            item.title ??
            m.workbench.properties.selection}
        </strong>
      </div>
      <dl className="property-grid">
        {fields
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd title={textValue(value)}>{textValue(value)}</dd>
            </div>
          ))}
        {evidence && (
          <>
            <div>
              <dt>{m.workbench.properties.sourceEvidence}</dt>
              <dd>{evidence.display_name}</dd>
            </div>
            <div>
              <dt>{m.workbench.properties.accessMode}</dt>
              <dd>{m.workbench.properties.readOnly}</dd>
            </div>
            <IntegrityRow evidence={evidence} />
          </>
        )}
        {evidence?.fingerprint?.value && (
          <div>
            <dt>{m.workbench.properties.evidenceSha}</dt>
            <dd className="mono">{evidence.fingerprint.value}</dd>
          </div>
        )}
      </dl>
      {evidence && integritySummary(evidence, m).status === "MISMATCH" && (
        <div className="notice error" role="alert">
          {m.workbench.properties.mismatch}
        </div>
      )}
    </div>
  );
}
function IntegrityRow({ evidence }: { evidence: Row }) {
  const { m } = useI18n();
  const h = integritySummary(evidence, m);
  return (
    <div>
      <dt>{m.workbench.properties.integrity}</dt>
      <dd className="integrity-cell" title={h.digest ?? undefined}>
        <span>{h.label}</span>
        {h.digest && <code>{shortDigest(h.digest)}</code>}
        {h.status && <Badge value={h.status} />}
      </dd>
    </div>
  );
}
