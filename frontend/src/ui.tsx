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
export const labels: Record<string, string> = {
  FILE_SYSTEM_NODE: "파일 시스템 항목",
  FILE: "파일",
  DIRECTORY: "폴더",
  ROOT: "루트 폴더",
  ARTIFACT: "아티팩트",
  EVIDENCE: "증거",
  TIMELINE_EVENT: "타임라인 이벤트",
  SEARCH_RESULT: "검색 결과",
  MACHINE_CANDIDATE: "자동 추출 후보",
  CUSTODY_EVENT: "보관 이력 이벤트",
  SIMPLE: "간단히",
  DETAILED: "상세히",
  RAW: "원본",
  CORRUPT: "손상됨",
  UNSUPPORTED: "지원하지 않음",
  SUCCESS: "정상 파싱",
  DELETED_CANDIDATE: "삭제 후보",
  RECOVERED_CANDIDATE: "복구 후보",
  PRIVATE_MODE_CANDIDATE: "비공개 모드 후보",
  MACHINE_EXTRACTED_CANDIDATE_NOT_OBSERVED_FACT: "자동 추출 후보 · 사실 미확정",
  OBSERVED_FACT: "관찰 사실",
  ANALYST_ANNOTATION: "분석가 주석",
  AI_DRAFT: "AI 초안 · 검토 필요",
  AI_INFERENCE: "AI 추론",
  AI_RECOMMENDATION: "AI 권고",
  NOT_CHECKED: "미검증",
  HASHING: "해시 계산 중",
  DEPENDENCY_NOT_INSTALLED: "필요한 구성요소가 설치되지 않음",
  EXECUTABLE_NOT_FOUND: "실행 파일을 찾을 수 없음",
  MATCH: "일치",
  MISMATCH: "불일치",
  AVAILABLE: "사용 가능",
  AVAILABLE_WITH_LIMITATIONS: "제한적 사용",
  CAPABILITY_UNAVAILABLE: "사용 불가",
  EXTERNAL_CONFIGURATION_REQUIRED: "외부 설정 필요",
  UNSUPPORTED_PLATFORM: "플랫폼 미지원",
  BLOCKED_EXTERNAL_FIXTURE: "검증 자료 필요",
  HOST_VERIFICATION_REQUIRED: "호스트 검증 필요",
  PARTIAL: "부분 결과",
  STALE: "갱신 필요",
  FAILED: "실패",
  SUCCEEDED: "완료",
  QUEUED: "대기 중",
  RUNNING: "진행 중",
  CANCELLING: "취소 중",
  CANCELLED: "취소됨",
  INTERRUPTED: "중단됨",
  COMPLETE: "완료",
  REGISTERED: "등록됨",
  READY: "준비됨",
  OPEN: "진행 중",
  CLOSED: "종료",
  ARCHIVED: "보관됨",
  APPROVED: "승인됨",
  DRAFT: "초안",
  IN_REVIEW: "검토 중",
  REVIEW_COMPLETE: "검토 완료",
  EXPORTED: "내보내기 완료",
  ANALYST_DRAFT: "분석가 초안",
  DERIVED_ANALYSIS: "파생 분석 · 해석 검토 필요",
  REVIEW_REQUIRED: "검토 필요",
  REJECTED: "반려",
  CHANGES_REQUESTED: "수정 요청",
  REVOKED: "승인 철회됨",
  UNREVIEWED: "미검토",
  ACCEPTED: "채택",
  CORRECTED: "정정",
  ALLOW: "허용",
  DENY: "차단",
  ALLOW_WITH_REDACTION: "민감정보 제거 후 재평가",
  ALLOW_PROJECTION_ONLY: "안전한 투영 생성 후 재평가",
  // Chain-of-custody event types (schemas/v1/chain-of-custody).
  ACQUISITION: "획득",
  RECEIVED: "인수",
  TRANSFERRED: "이관",
  STORED: "보관",
  OPENED: "개봉",
  MOUNTED: "마운트",
  ANALYZED: "분석",
  ANALYSIS: "분석",
  REVIEW: "검토",
  HASH_VERIFIED: "해시 검증",
  COPIED: "복제",
  RETURNED: "반환",
  RELEASED: "인도",
  DISPOSED: "폐기",
  CORRECTION: "정정",
  // Search modes and source types.
  TERM: "단어 일치",
  PHRASE: "구문 일치",
  PREFIX: "앞부분 일치",
  EXACT: "정확히 일치",
  REGEX_METADATA: "정규식 (메타데이터)",
  WINDOWS_ARTIFACT: "Windows 아티팩트",
  // Timezone confidence.
  CONFIRMED: "확정",
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
  UNKNOWN: "알 수 없음",
  // Machine-extraction sources.
  IMAGE: "이미지",
  IMAGE_FILE: "이미지 파일",
  VIDEO_FRAME: "영상 프레임",
  AUDIO: "음성",
  AUDIO_FILE: "음성 파일",
  DOCUMENT: "문서",
  OTHER: "기타",
  // Artifact types.
  REGISTRY_KEY: "레지스트리 키",
  REGISTRY_VALUE: "레지스트리 값",
  REGISTRY_AUTORUN: "자동 실행",
  REGISTRY_USB_DEVICE: "USB 장치",
  REGISTRY_TIMEZONE: "시간대 설정",
  REGISTRY_USERASSIST: "UserAssist",
  EVENT_LOG_RECORD: "이벤트 로그",
  PREFETCH_EXECUTION: "프리패치 실행 기록",
  BROWSER_PROFILE: "브라우저 프로필",
  BROWSER_VISIT: "방문 기록",
  BROWSER_SEARCH: "검색 기록",
  BROWSER_DOWNLOAD: "다운로드",
  BROWSER_COOKIE: "쿠키",
  BROWSER_CREDENTIAL: "저장된 자격 증명",
  BROWSER_CACHE_ENTRY: "캐시",
  BROWSER_DELETED_SQLITE_ROW: "삭제 후보 (SQLite)",
  BROWSER_PRIVATE_MODE_CANDIDATE: "비공개 모드 후보",
  MEDIA_IMAGE: "이미지",
  MEDIA_VIDEO: "동영상",
  MEDIA_AUDIO: "오디오",
  COMMUNICATION_PROFILE: "통신 프로필",
  COMMUNICATION_ACCOUNT: "통신 계정",
  COMMUNICATION_CONVERSATION: "대화",
  COMMUNICATION_MESSAGE: "메시지",
  COMMUNICATION_ATTACHMENT: "첨부파일",
  COMMUNICATION_UNSUPPORTED_STORE: "미지원 저장소",
  // Timeline event and source types (schemas/v1/timeline-event).
  FILE_CREATED: "파일 생성",
  FILE_MODIFIED: "파일 수정",
  FILE_ACCESSED: "파일 접근",
  FILE_METADATA_CHANGED: "파일 메타데이터 변경",
  REGISTRY_KEY_LAST_WRITE: "레지스트리 키 마지막 기록",
  REGISTRY_VALUE_OBSERVED: "레지스트리 값 확인",
  PROCESS_EXECUTION: "프로그램 실행",
  LOGON: "로그온",
  LOGOFF: "로그오프",
  PROCESS_CREATED: "프로세스 생성",
  NETWORK_CONNECTION: "네트워크 연결",
  FILE_CREATED_BY_PROCESS: "프로세스가 만든 파일",
  REGISTRY_MODIFIED: "레지스트리 변경",
  DNS_QUERY: "DNS 조회",
  SERVICE_INSTALLED: "서비스 설치",
  EVENT_LOG_CLEARED: "이벤트 로그 삭제",
  PREFETCH_LAST_RUN: "마지막 실행 (프리패치)",
  MEDIA_CREATED: "미디어 생성",
  MEDIA_MODIFIED: "미디어 수정",
  MEDIA_CAPTURED: "촬영",
  MEDIA_METADATA_TIMESTAMP: "미디어 메타데이터 시각",
  MEDIA_CAPTURED_CANDIDATE: "촬영 시각 후보",
  BROWSER_PROFILE_OBSERVED: "브라우저 프로필 확인",
  BROWSER_DOWNLOAD_STARTED: "다운로드 시작",
  BROWSER_DOWNLOAD_COMPLETED: "다운로드 완료",
  BROWSER_DOWNLOAD_OBSERVED: "다운로드 확인",
  BROWSER_COOKIE_OBSERVED: "쿠키 확인",
  BROWSER_CREDENTIAL_OBSERVED: "자격 증명 확인",
  BROWSER_CACHE_ENTRY_OBSERVED: "캐시 확인",
  BROWSER_DELETED_SQLITE_ROW_CANDIDATE: "삭제 후보 (SQLite)",
  COMMUNICATION_PROFILE_OBSERVED: "통신 프로필 확인",
  COMMUNICATION_ACCOUNT_OBSERVED: "통신 계정 확인",
  COMMUNICATION_CONVERSATION_OBSERVED: "대화 확인",
  REGISTRY_ARTIFACT: "레지스트리",
  EVENT_LOG_ARTIFACT: "이벤트 로그",
  PREFETCH_ARTIFACT: "프리패치",
  MEDIA_ARTIFACT: "미디어",
  BROWSER_ARTIFACT: "브라우저",
  COMMUNICATION_ARTIFACT: "통신",
};
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
export function displayValue(value: unknown, zone: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value))
    return value.length
      ? value.map((v) => displayValue(v, zone)).join(", ")
      : "—";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "string")
    return ISO_INSTANT.test(value)
      ? time(value, zone)
      : (labels[value] ?? value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
/** Custody wording where the shared label means a report or case status. */
const custodyOverrides: Record<string, string> = {
  EXPORTED: "반출",
  ARCHIVED: "보존 처리",
};
export const custodyEvent = (type: unknown) =>
  typeof type === "string"
    ? (custodyOverrides[type] ?? labels[type] ?? type)
    : "—";
/** Image formats (RAW, E01, …) are proper names; only a folder is translated. */
export const evidenceFormat = (format: unknown) =>
  format === "DIRECTORY" ? "폴더" : typeof format === "string" ? format : "—";
/** 0–1 confidence as a percentage; categorical confidence as its label. */
export function confidence(value: unknown) {
  if (typeof value === "number" && value >= 0 && value <= 1)
    return `${Math.round(value * 100)}%`;
  return displayValue(value, "UTC");
}
export function Badge({ value }: { value: unknown }) {
  const text = String(value ?? "UNKNOWN");
  return (
    <span
      className={`badge ${/FAIL|DENY|MISMATCH|REJECT|CORRUPT/.test(text) ? "red" : /PARTIAL|STALE|LIMIT|REQUIRED|UNAVAILABLE|UNKNOWN|INTERRUPTED|CANDIDATE|UNSUPPORTED|CHANGES_REQUESTED|AI_/.test(text) ? "amber" : /AVAILABLE|COMPLETE|SUCCEEDED|APPROVED|ACCEPTED|READY|MATCH|ALLOW$/.test(text) ? "green" : ""}`}
    >
      {labels[text] ?? text}
    </span>
  );
}
export function Empty({
  title = "조회 결과가 없습니다",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <SearchX size={30} />
      <h2>{title}</h2>
      <p>{children ?? "선택한 범위에서 확인된 항목이 없습니다."}</p>
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
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={16} />
      <span>{errorText(error)}</span>
      {retry && <button onClick={retry}>다시 시도</button>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={18} /> 엔진 응답을 기다리는 중
    </div>
  );
}
export function ResultState({ data }: { data: Row | null | undefined }) {
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
          현재 확인된 일부 결과입니다. 전체 분석 완료를 의미하지 않습니다.
        </div>
      )}
      {stale && (
        <div className="notice">
          <Badge value="STALE" />
          원본 버전이 변경되었습니다. 새로고침 또는 재분석이 필요합니다.
        </div>
      )}
      {coverage && (
        <div className="coverage">
          <span>분석 범위</span>
          <Badge value={coverage.status} />
          <span>
            확인 {coverage.discovered_items ?? "—"} · 처리{" "}
            {coverage.processed_items ?? "—"} · 경고{" "}
            {coverage.warning_count ?? 0}
          </span>
        </div>
      )}
      {data.warnings?.length > 0 && (
        <details className="warnings">
          <summary>경고 {data.warnings.length}건</summary>
          <Fields value={data.warnings} />
        </details>
      )}
    </>
  );
}
const names: Record<string, string> = {
  id: "ID",
  case_id: "사건 ID",
  evidence_id: "증거 ID",
  source_id: "소스 ID",
  source_path: "소스 경로",
  source_kind: "소스 유형",
  raw_timestamp: "원본 시각",
  normalized_utc: "정규화 UTC",
  confidence: "신뢰도",
  is_partial: "부분 결과",
  analyzer_id: "분석기",
  analyzer_version: "분석기 버전",
  raw_locator: "원본 위치",
  citations: "인용",
  provenance: "출처",
  summary: "요약",
  title: "제목",
  reason: "사유",
  created_at: "생성 시각",
  timestamp: "시각",
  value: "값",
  label: "항목",
  field_id: "필드 ID",
  citation_count: "인용 수",
  next_recommended_view: "권장 보기",
  original_name: "원본 이름",
  display_path: "표시 경로",
  original_relative_path: "원본 상대 경로",
  node_type: "유형",
  file_size: "파일 크기",
  is_deleted: "삭제됨",
  is_readable: "읽기 가능",
  source_revision: "소스 버전",
  timezone: "표시 시간대",
  parse_status: "파싱 상태",
  provider_id: "제공자",
  provider_version: "제공자 버전",
  requested_offset: "요청 오프셋",
  requested_length: "요청 길이",
  returned_offset: "반환 오프셋",
  returned_length: "반환 길이",
  total_length: "전체 길이",
  encoding: "인코딩",
  truncated: "요청 범위 또는 미리보기 잘림",
  remaining_bytes: "반환 범위 이후 남은 원본 바이트",
  image_metadata: "이미지 상세정보",
  width: "가로 픽셀",
  height: "세로 픽셀",
  format: "포맷",
  mime: "MIME 유형",
  color_mode: "색상 모드",
  exif: "EXIF",
  thumbnail_cache: "썸네일 상태",
  classification: "데이터 분류",
  destination: "전송 대상",
  policy_revision: "정책 버전",
  pragma_key_hash: "Pragma key Fingerprint",
  user_nonce_hash: "User nonce Fingerprint",
  content_sha256: "Content Fingerprint (SHA-256)",
  source_fingerprint: "Source Fingerprint",
  content_fingerprint: "Content Fingerprint",
  fingerprint: "Fingerprint",
  correction_text: "검토자가 정정한 내용",
  original_text: "원본 추출 텍스트",
  evidence_status: "증거 상태",
  hashes: "무결성 해시",
  reader: "증거 리더",
  semantic_category: "결과 분류",
  review_status: "검토 상태",
  warnings: "경고",
  reason_codes: "사유 코드",
  redaction_applied: "민감정보 제거 적용",
  projection_applied: "안전한 투영 적용",
  limitations: "한계",
  created_by: "작성자",
  timestamp_meanings: "시각의 의미",
  utc_timestamps: "UTC 시각",
  created: "생성",
  modified: "수정",
  accessed: "접근",
  changed: "변경",
  mime_candidate: "MIME 후보",
  extension: "확장자",
  rank: "관련도 점수 (BM25 · 낮을수록 관련)",
  matched_terms: "일치 검색어",
  matched_fields: "일치 필드",
  snippet: "일치 내용",
  source_type: "소스 유형",
  extraction_type: "추출 방식",
  language: "언어",
  event_type: "이벤트 유형",
  occurred_at_utc: "발생 시각",
  observed_at_utc: "관찰 시각",
  event_hash: "이벤트 해시",
  previous_event_hash: "이전 이벤트 해시",
  timezone_confidence: "시간대 신뢰도",
  timezone_source: "시간대 출처",
  artifact_type: "아티팩트 유형",
  description: "설명",
  synthetic: "합성 데이터",
};
/** Single-value timestamp with its offset, e.g. "2026-09-14 09:00:00 (UTC+9)". */
export function timeWithZone(value: unknown, zone: string) {
  const text = time(value, zone);
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return text;
  return `${text} (${zoneOffset(zone, new Date(value))})`;
}
export function Fields({ value }: { value: unknown }) {
  const zone = useContext(DisplayZone);
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
              <dt>{names[k] ?? k}</dt>
              <dd>
                {typeof v === "object" && v !== null ? (
                  <details>
                    <summary>
                      {Array.isArray(v) ? `${v.length}개 항목` : "상세 보기"}
                    </summary>
                    <Fields value={v} />
                  </details>
                ) : v === "<redacted>" ? (
                  "보호됨 (redacted)"
                ) : typeof v === "boolean" ? (
                  v ? (
                    "예"
                  ) : (
                    "아니요"
                  )
                ) : typeof v === "string" ? (
                  ISO_INSTANT.test(v) ? (
                    <span title={`UTC 원문: ${v}`}>
                      {timeWithZone(v, zone)}
                    </span>
                  ) : (
                    (labels[v] ?? v)
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
          <span>원본 미리보기</span>
          <div className="tabs compact" aria-label="원본 표시 형식">
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
              텍스트
            </button>
          </div>
        </header>
        <pre aria-label={format === "hex" ? "원본 Hex" : "원본 텍스트"}>
          {(format === "hex" ? hex_preview : text_preview) ??
            "이 범위의 미리보기가 제공되지 않았습니다."}
        </pre>
      </div>
      {data.truncated && (
        <p className="muted small">
          요청 범위 또는 화면 미리보기 일부가 잘렸습니다. 반환 길이와 전체
          길이를 확인하고 더 작은 범위를 요청하세요.
        </p>
      )}
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
export function time(value: unknown, zone: string) {
  if (typeof value !== "string") return "—";
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value)) return value + " · 시간대 미확정";
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
  const display = useMemo(
    () =>
      sort
        ? [...rows].sort((a, b) => {
            const x = a[sort.key],
              y = b[sort.key];
            return (
              (typeof x === "number" && typeof y === "number"
                ? x - y
                : textValue(x).localeCompare(textValue(y), "ko")) *
              (sort.asc ? 1 : -1)
            );
          })
        : rows,
    [rows, sort],
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
                  title="현재 불러온 결과 정렬"
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
                  {c.render ? c.render(r) : displayValue(r[c.key], zone)}
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
