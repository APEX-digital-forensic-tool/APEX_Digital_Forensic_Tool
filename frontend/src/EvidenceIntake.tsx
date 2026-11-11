import type { ReactNode } from "react";
import type { Row } from "./gateway";
import type { FieldSpec } from "./panels";
import { AlertCircle } from "./icons";
import { Badge } from "./ui";
import { useI18n } from "./i18n/I18nProvider";
import { lookup, type Messages } from "./i18n/catalog";

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
const hashOptions = ["SHA256", "SHA1", "MD5", "NONE"];
/** Algorithm names are proper names and are not translated. */
const HASH_NAMES: Record<string, string> = {
  SHA256: "SHA-256",
  SHA1: "SHA-1",
  MD5: "MD5",
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
            ? m.evidence.subject.folder
            : extension
              ? m.evidence.subject.imageWithExtension(extension.toUpperCase())
              : m.evidence.subject.image}{" "}
          {m.evidence.subject.formatNote}
        </figcaption>
      </figure>
      {missing.map((c) => (
        <div key={c.id} className="notice error intake-warning" role="alert">
          <AlertCircle size={16} />
          <span>
            {m.evidence.subject.missing(
              lookup(m.evidence.readers, c.id),
              c.id,
              c.reason ? ` (${lookup(m.labels, c.reason)})` : "",
            )}
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
  m,
}: {
  picked: PickedSource;
  kind: "file" | "directory";
  capabilities: Row[];
  register: (input: {
    displayName: string;
    algorithm: string | null;
  }) => Promise<void>;
  m: Messages;
}): {
  title: string;
  description: string;
  context: ReactNode;
  submitLabel: string;
  fields: FieldSpec[];
  submit: (f: Row) => Promise<void>;
} {
  return {
    title:
      kind === "directory"
        ? m.evidence.dialog.folderTitle
        : m.evidence.dialog.imageTitle,
    description: m.evidence.dialog.description,
    context: (
      <IntakeSubject picked={picked} kind={kind} capabilities={capabilities} />
    ),
    submitLabel: m.evidence.dialog.submit,
    fields: [
      {
        key: "display_name",
        label: m.evidence.dialog.displayName,
        required: true,
        max: 255,
        default: picked.name,
      },
      {
        key: "hash_algorithm",
        label: m.evidence.dialog.hashAfter,
        options: hashOptions,
        optionLabel: (o) =>
          o === "NONE"
            ? m.evidence.hashNone
            : o === "SHA256"
              ? m.evidence.hashRecommended(HASH_NAMES[o])
              : (HASH_NAMES[o] ?? o),
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
export function integritySummary(
  evidence: Row,
  m: Messages,
): {
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
      label:
        evidence.status === "HASHING"
          ? m.evidence.hashing
          : m.evidence.hashPending,
      status: null,
      digest: null,
    };
  return {
    label: HASH_NAMES[best.algorithm] ?? best.algorithm,
    status: best.verification_status ?? "NOT_CHECKED",
    digest: best.digest_hex ?? null,
  };
}

export const shortDigest = (digest: string) =>
  digest.length > 20 ? `${digest.slice(0, 8)}…${digest.slice(-8)}` : digest;
