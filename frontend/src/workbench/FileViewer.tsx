import { useEffect, useMemo, useRef, useState } from "react";
import { gateway, type Row } from "../gateway";
import {
  ErrorState,
  Fields,
  FileIcon,
  Loading,
  ResultState,
  Section,
} from "../ui";
import { ImageInspector } from "../ImageInspector";
import { VideoInspector } from "../VideoInspector";
import { Splitter } from "./Splitter";
import { useI18n } from "../i18n/I18nProvider";

type Format = "preview" | "text" | "hex" | "metadata";
export function FileViewer({
  caseId,
  selected,
  height,
  onHeight,
  onCollect,
  onSelect,
}: {
  caseId: string;
  selected: Row | null;
  height: number;
  onHeight: (height: number) => void;
  onCollect: (citations: Row[]) => void;
  onSelect: (row: Row) => void;
}) {
  const { m } = useI18n();
  const [format, setFormat] = useState<Format>("preview");
  const [offset, setOffset] = useState("0");
  const [range, setRange] = useState({ offset: 0, length: 4096 });
  const [projection, setProjection] = useState<Row | null>(null);
  const [raw, setRaw] = useState<Row | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const directory =
    selected && ["ROOT", "DIRECTORY"].includes(selected.node_type);
  const resourceType = selected?._resource_type ?? "FILE_SYSTEM_NODE";
  const resourceId = selected?._resource_id ?? selected?.id;
  const sourceKey = `${caseId}:${resourceType}:${resourceId}`;
  const previousSource = useRef(sourceKey);
  const isImage =
    !directory &&
    /\.(png|jpe?g|gif|tiff?|bmp|webp)$/i.test(selected?.original_name ?? "");
  const isVideo =
    !directory &&
    (selected?.artifact_type === "MEDIA_VIDEO" ||
      /\.(mp4|m4v|mov|3gp|3g2|avi|mkv|webm)$/i.test(
        selected?.original_name ?? "",
      ));
  const kind =
    format === "metadata" || directory
      ? "metadata"
      : format === "preview" && isImage
        ? "image"
        : "raw";
  useEffect(() => {
    if (previousSource.current !== sourceKey) {
      previousSource.current = sourceKey;
      setOffset("0");
      if (range.offset !== 0) {
        setRange({ offset: 0, length: 4096 });
        return;
      }
    }
    let live = true;
    setProjection(null);
    setRaw(null);
    setPreview(null);
    setError(null);
    if (!selected) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const input = {
      case_id: caseId,
      resource_type: resourceType,
      resource_id: resourceId,
    };
    async function load() {
      try {
        const view = await gateway.call("view", {
          ...input,
          view_mode: kind === "raw" ? "RAW" : "DETAILED",
        });
        if (!live) return;
        setProjection(view);
        if (kind === "image") {
          const image = await gateway.call("media.inspect", {
            ...input,
            action: "PREVIEW",
            channel: "RGB",
            bit: null,
            channels: "RGB",
            bit_order: "MSB_FIRST",
            pixel_offset: 0,
            byte_limit: 512,
            max_dimension: 1536,
          });
          if (live) setPreview(image);
        } else if (
          kind === "raw" &&
          view.available_actions?.includes("view.raw-read")
        ) {
          const bytes = await gateway.call("raw.read", { ...input, ...range });
          if (live) setRaw(bytes);
        }
      } catch (error) {
        if (live) setError(error);
      } finally {
        if (live) setBusy(false);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [caseId, resourceType, resourceId, kind, range, retry]);

  const hexLines = useMemo(() => {
    const compact = String(raw?.hex_preview ?? "").replace(/\s/g, "");
    if (!compact || !/^(?:[0-9a-f]{2})+$/i.test(compact)) return [];
    const bytes = compact.match(/.{2}/g) ?? [];
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const part = bytes.slice(i, i + 16);
      lines.push({
        offset: ((raw?.returned_offset ?? range.offset) + i)
          .toString(16)
          .padStart(8, "0")
          .toUpperCase(),
        hex: part
          .map((byte, index) => byte.toUpperCase() + (index === 7 ? " " : ""))
          .join(" ")
          .padEnd(48, " "),
        ascii: part
          .map((byte) => {
            const n = parseInt(byte, 16);
            return n >= 32 && n <= 126 ? String.fromCharCode(n) : ".";
          })
          .join(""),
      });
    }
    return lines;
  }, [raw, range.offset]);
  const maxHeight = Math.max(180, Math.floor(window.innerHeight * 0.65));
  const total = raw?.total_length ?? raw?.total_size_bytes;
  return (
    <section
      className="file-viewer"
      aria-label={m.workbench.viewer.label}
      style={{ height }}
    >
      <Splitter
        axis="horizontal"
        label={m.workbench.viewer.resize}
        value={height}
        min={180}
        max={maxHeight}
        onChange={onHeight}
      />
      <header className="pane-title">
        <span>{m.workbench.viewer.title}</span>
        <span className="viewer-file">
          {selected && <FileIcon row={selected} />}
          {selected?.original_name ??
            selected?.title ??
            m.workbench.viewer.noFile}
        </span>
        <span className="pane-caption">{m.workbench.viewer.readOnly}</span>
      </header>
      <div className="viewer-toolbar">
        <div
          className="tabs compact"
          aria-label={m.workbench.viewer.formatLabel}
        >
          {(
            [
              ["preview", "Preview"],
              ["text", "Text"],
              ["hex", "Hex"],
              ["metadata", m.workbench.viewer.metadata],
            ] as [Format, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={format === value}
              className={format === value ? "active" : ""}
              disabled={
                !selected || (!!directory && ["text", "hex"].includes(value))
              }
              onClick={() => setFormat(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {selected && isImage && (
          <ImageInspector
            caseId={caseId}
            resourceType={resourceType}
            resourceId={resourceId}
          />
        )}
        {selected && isVideo && (
          <VideoInspector
            key={sourceKey}
            caseId={caseId}
            resourceType={resourceType}
            resourceId={resourceId}
          />
        )}
      </div>
      {selected && kind === "raw" && (
        <form
          className="byte-range"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(offset);
            if (Number.isSafeInteger(value) && value >= 0)
              setRange({ offset: value, length: 4096 });
          }}
        >
          <label htmlFor="viewer-offset">Offset</label>
          <input
            id="viewer-offset"
            aria-label={m.workbench.viewer.offsetLabel}
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
            placeholder={m.workbench.viewer.offsetPlaceholder}
          />
          <button
            disabled={
              busy ||
              !offset.trim() ||
              !Number.isSafeInteger(Number(offset)) ||
              Number(offset) < 0
            }
          >
            {m.workbench.viewer.go}
          </button>
          <span>{m.workbench.viewer.maxPerRequest}</span>
          <span className="spacer" />
          <button
            type="button"
            disabled={busy || range.offset === 0}
            onClick={() => {
              const next = Math.max(0, range.offset - 4096);
              setOffset(String(next));
              setRange({ offset: next, length: 4096 });
            }}
          >
            {m.workbench.viewer.previous}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !raw ||
              (typeof total === "number"
                ? range.offset + (raw.returned_length ?? 0) >= total
                : !raw.truncated)
            }
            onClick={() => {
              const next = range.offset + (raw?.returned_length || 4096);
              setOffset(String(next));
              setRange({ offset: next, length: 4096 });
            }}
          >
            {m.workbench.viewer.next}
          </button>
        </form>
      )}
      <div className={`viewer-body ${format === "hex" ? "hex-body" : ""}`}>
        {!selected ? (
          <div className="viewer-empty">
            <FileIcon row={{ original_name: "file" }} />
            <p>{m.workbench.viewer.emptyTitle}</p>
            <small>{m.workbench.viewer.emptyFormats}</small>
          </div>
        ) : busy ? (
          <Loading />
        ) : error != null ? (
          <ErrorState error={error} retry={() => setRetry((v) => v + 1)} />
        ) : (
          <>
            <ResultState data={projection} />
            {kind === "metadata" ? (
              <>
                <FieldGroups
                  groups={[
                    [
                      m.workbench.viewer.groups.basic,
                      projection?.primary_fields,
                    ],
                    [
                      m.workbench.viewer.groups.extra,
                      projection?.secondary_fields,
                    ],
                    [
                      m.workbench.viewer.groups.technical,
                      projection?.technical_fields,
                    ],
                    [m.workbench.viewer.groups.times, projection?.timestamps],
                  ]}
                />
                <Section title={m.workbench.viewer.locator}>
                  <Fields value={projection?.raw_locator} />
                  <Fields value={projection?.citations} />
                  {projection?.citations?.map(
                    (citation: Row, index: number) => {
                      const types: Record<string, string> = {
                        FILE: "FILE_SYSTEM_NODE",
                        FILE_SYSTEM_NODE: "FILE_SYSTEM_NODE",
                        ARTIFACT: "ARTIFACT",
                        TIMELINE_EVENT: "TIMELINE_EVENT",
                      };
                      const type =
                        types[citation.source_kind ?? citation.source_type];
                      return type && citation.source_id ? (
                        <button
                          key={index}
                          onClick={() =>
                            onSelect({
                              id: citation.source_id,
                              _resource_id: citation.source_id,
                              _resource_type: type,
                              title: m.workbench.viewer.citationSource,
                            })
                          }
                        >
                          {m.workbench.viewer.viewCitation(index + 1)}
                        </button>
                      ) : null;
                    },
                  )}
                  {!!projection?.citations?.length && (
                    <button onClick={() => onCollect(projection.citations)}>
                      {m.workbench.viewer.addToReport}
                    </button>
                  )}
                </Section>
              </>
            ) : kind === "image" && preview ? (
              <div className="inline-image">
                <img
                  src={preview.image_url}
                  alt={m.workbench.viewer.previewAlt(selected.original_name)}
                />
                <p>
                  {m.workbench.viewer.imageInfo(
                    preview.width,
                    preview.height,
                    preview.color_mode,
                    preview.is_resized ? m.workbench.viewer.resized : "",
                  )}
                </p>
              </div>
            ) : raw ? (
              <>
                <ResultState data={raw} />
                {format === "hex" ||
                (format === "preview" && !raw.text_preview) ? (
                  <div
                    className="hex-view"
                    aria-label={m.workbench.viewer.hexLabel}
                  >
                    <div className="hex-heading">
                      <span>Offset (h)</span>
                      <span>
                        {"00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F"}
                      </span>
                      <span>ASCII</span>
                    </div>
                    {hexLines.length ? (
                      hexLines.map((line) => (
                        <div className="hex-line" key={line.offset}>
                          <span>{line.offset}</span>
                          <span>{line.hex}</span>
                          <span>{line.ascii}</span>
                        </div>
                      ))
                    ) : (
                      <p className="pane-empty">{m.workbench.viewer.noHex}</p>
                    )}
                  </div>
                ) : (
                  <pre
                    className="text-view"
                    aria-label={m.workbench.viewer.textLabel}
                  >
                    {raw.text_preview ?? m.workbench.viewer.noText}
                  </pre>
                )}
                <Section title={m.workbench.viewer.rangeSource}>
                  <Fields
                    value={{
                      ...raw,
                      hex_preview: undefined,
                      text_preview: undefined,
                    }}
                  />
                </Section>
              </>
            ) : (
              <p className="pane-empty">{m.workbench.viewer.noRaw}</p>
            )}
          </>
        )}
      </div>
      {raw && (
        <footer className="viewer-status">
          {m.workbench.viewer.status(
            raw.returned_offset ?? range.offset,
            raw.returned_length ?? 0,
          )}
          {typeof total === "number" ? m.workbench.viewer.total(total) : ""}
          {raw.truncated ? m.workbench.viewer.truncated : ""}
          {raw.synthetic ? m.workbench.viewer.synthetic : ""}
        </footer>
      )}
    </section>
  );
}
/**
 * Projection groups often repeat the same field (the engine may echo a value in
 * several groups). Show each key/value once, under the first group that has it.
 */
function FieldGroups({ groups }: { groups: [string, unknown][] }) {
  const seen = new Set<string>();
  return (
    <>
      {groups.map(([title, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return value == null ? null : <Fields key={title} value={value} />;
        const fresh = Object.fromEntries(
          Object.entries(value as Row).filter(([key, v]) => {
            const signature = `${key}:${JSON.stringify(v)}`;
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
          }),
        );
        if (!Object.keys(fresh).length) return null;
        return (
          <section key={title} className="field-group">
            <h3>{title}</h3>
            <Fields value={fresh} />
          </section>
        );
      })}
    </>
  );
}
