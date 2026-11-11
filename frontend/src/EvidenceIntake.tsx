import type { ReactNode } from "react";
import type { Row } from "./gateway";
import type { FieldSpec } from "./panels";
import { AlertCircle } from "./icons";
import { Badge } from "./ui";
import { useI18n } from "./i18n/I18nProvider";
import { lookup } from "./i18n/catalog";

/** Engine readers an image of this kind needs; the engine still probes the format. */
const readersByExtension: Record<string, string[]> = {
  e01: ["e01-libewf", "pytsk3"],
  ex01: ["e01-libewf", "pytsk3"],
  vhd: ["vhd-libvhdi", "pytsk3"],
  vhdx: ["vhdx-qemu-img", "pytsk3"],
  raw: ["raw-dd-img", "pytsk3"],
  dd: ["raw-dd-img", "pytsk3"],
  img: ["raw-dd-img", "pytsk3"],
  "001": ["raw-dd-img", "pytsk3"],
};
const readerNames: Record<string, string> = {
  "e01-libewf": "E01 이미지 읽기",
  "vhd-libvhdi": "VHD 이미지 읽기",
  "vhdx-qemu-img": "VHDX 이미지 읽기",
  "raw-dd-img": "RAW·DD 이미지 읽기",
  pytsk3: "디스크 이미지 파일시스템 해석",
  "filesystem-provider": "폴더 읽기",
};
const hashOptions = ["SHA256", "SHA1", "MD5", "NONE"];
const hashNames: Record<string, string> = {
  SHA256: "SHA-256 (권장)",
  SHA1: "SHA-1",
  MD5: "MD5",
  NONE: "지금은 계산하지 않음",
};

export type PickedSource = { reference: string; name: string };

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Capabilities this source depends on that the runtime reports as unusable. */
export function missingReaders(
  kind: "file" | "directory",
  name: string,
  capabilities: Row[],
) {
  const needed =
    kind === "directory"
      ? ["filesystem-provider"]
      : (readersByExtension[extensionOf(name)] ?? []);
  return needed
    .map((id) => capabilities.find((c) => c.id === id))
    .filter(
      (c): c is Row =>
        !!c && !["AVAILABLE", "AVAILABLE_WITH_LIMITATIONS"].includes(c.status),
    );
}

function IntakeSubject({
  picked,
  kind,
  capabilities,
}: {
  picked: PickedSource;
  kind: "file" | "directory";
  capabilities: Row[];
}) {
  const { m } = useI18n();
  const extension = extensionOf(picked.name);
  const missing = missingReaders(kind, picked.name, capabilities);
  return (
    <>
      <figure className="decision-subject">
        <blockquote>{picked.name}</blockquote>
        <figcaption>
          {kind === "directory"
            ? "폴더"
            : extension
              ? `이미지 파일 · 확장자 .${extension.toUpperCase()}`
              : "이미지 파일"}{" "}
          · 형식은 등록할 때 엔진이 확인합니다.
        </figcaption>
      </figure>
      {missing.map((c) => (
        <div key={c.id} className="notice error intake-warning" role="alert">
          <AlertCircle size={16} />
          <span>
            이 PC에서는 {readerNames[c.id] ?? c.id} 구성요소({c.id})를 사용할 수
            없습니다
            {c.reason ? ` (${lookup(m.labels, c.reason)})` : ""}. 등록이
            실패하거나 내부 파일을 읽지 못할 수 있습니다.
          </span>
          <Badge value={c.status} />
        </div>
      ))}
    </>
  );
}

/** Dialog spec for confirming an evidence source before registration. */
export function intakeDialog({
  picked,
  kind,
  capabilities,
  register,
}: {
  picked: PickedSource;
  kind: "file" | "directory";
  capabilities: Row[];
  register: (input: {
    displayName: string;
    algorithm: string | null;
  }) => Promise<void>;
}): {
  title: string;
  description: string;
  context: ReactNode;
  submitLabel: string;
  fields: FieldSpec[];
  submit: (f: Row) => Promise<void>;
} {
  return {
    title: kind === "directory" ? "폴더 증거 등록" : "이미지 증거 등록",
    description:
      "원본은 읽기 전용으로 열리며 수정되지 않습니다. 등록과 해시 계산은 작업 목록에서 진행 상황을 볼 수 있습니다.",
    context: (
      <IntakeSubject picked={picked} kind={kind} capabilities={capabilities} />
    ),
    submitLabel: "증거 등록",
    fields: [
      {
        key: "display_name",
        label: "표시 이름",
        required: true,
        max: 255,
        default: picked.name,
      },
      {
        key: "hash_algorithm",
        label: "등록 후 무결성 해시",
        options: hashOptions,
        optionLabel: (o) => hashNames[o] ?? o,
        default: "SHA256",
      },
    ],
    submit: (f) =>
      register({
        displayName: String(f.display_name),
        algorithm:
          f.hash_algorithm === "NONE" ? null : String(f.hash_algorithm),
      }),
  };
}

/** Plain-language integrity line for an evidence record's best hash. */
export function integritySummary(evidence: Row): {
  label: string;
  status: string | null;
  digest: string | null;
} {
  const hashes: Row[] = evidence.hashes ?? [];
  const best =
    hashes.find((h) => h.verification_status === "MISMATCH") ??
    hashes.find((h) => h.algorithm === "SHA256") ??
    hashes[0];
  if (!best)
    return {
      label: evidence.status === "HASHING" ? "해시 계산 중" : "해시 계산 전",
      status: null,
      digest: null,
    };
  return {
    label: hashNames[best.algorithm]?.replace(" (권장)", "") ?? best.algorithm,
    status: best.verification_status ?? "NOT_CHECKED",
    digest: best.digest_hex ?? null,
  };
}

export const shortDigest = (digest: string) =>
  digest.length > 20 ? `${digest.slice(0, 8)}…${digest.slice(-8)}` : digest;
