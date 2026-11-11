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
    return (
      <p className="pane-empty">증거나 파일을 선택하면 속성이 표시됩니다.</p>
    );
  const fields: [string, unknown][] = row?.node_type
    ? [
        ["이름", row.original_name],
        ["유형", lookup(m.labels, row.node_type)],
        ["경로", row.display_path],
        ["크기", size(row.file_size)],
        ["파일 ID", row.id],
        ["MIME", row.mime_candidate],
        ["삭제 상태", row.is_deleted ? "삭제됨" : "삭제되지 않음"],
        ["생성 시간", timeWithZone(row.utc_timestamps?.created, zone, m)],
        ["수정 시간", timeWithZone(row.utc_timestamps?.modified, zone, m)],
        ["접근 시간", timeWithZone(row.utc_timestamps?.accessed, zone, m)],
        ["결과 범위", row.is_partial ? "부분 결과" : "관찰됨"],
      ]
    : [
        ["이름", item.display_name ?? item.title],
        [
          "유형",
          item.format
            ? evidenceFormat(item.format, m)
            : lookup(m.labels, item.artifact_type),
        ],
        ["크기", size(item.size_bytes)],
        ["상태", lookup(m.labels, item.status)],
        ["증거 ID", item.id],
        ["리더", item.reader?.id],
      ];
  return (
    <div className="properties-content">
      <div className="property-selection">
        <FileIcon row={item} />
        <strong>
          {item.original_name ?? item.display_name ?? item.title ?? "선택 항목"}
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
              <dt>소스 증거</dt>
              <dd>{evidence.display_name}</dd>
            </div>
            <div>
              <dt>접근 모드</dt>
              <dd>읽기 전용</dd>
            </div>
            <IntegrityRow evidence={evidence} />
          </>
        )}
        {evidence?.fingerprint?.value && (
          <div>
            <dt>증거 SHA-256</dt>
            <dd className="mono">{evidence.fingerprint.value}</dd>
          </div>
        )}
      </dl>
      {evidence && integritySummary(evidence).status === "MISMATCH" && (
        <div className="notice error" role="alert">
          무결성 검증 결과가 이전 기준 해시와 일치하지 않습니다. 원인 확인이
          필요합니다.
        </div>
      )}
    </div>
  );
}
function IntegrityRow({ evidence }: { evidence: Row }) {
  const h = integritySummary(evidence);
  return (
    <div>
      <dt>무결성 해시</dt>
      <dd className="integrity-cell" title={h.digest ?? undefined}>
        <span>{h.label}</span>
        {h.digest && <code>{shortDigest(h.digest)}</code>}
        {h.status && <Badge value={h.status} />}
      </dd>
    </div>
  );
}
