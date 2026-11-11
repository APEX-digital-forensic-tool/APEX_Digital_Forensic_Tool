import { useEffect, useRef, useState } from "react";
import { gateway, unwrap, type Row } from "./gateway";
import { Badge, ErrorState, Fields, Loading } from "./ui";
import { useI18n } from "./i18n/I18nProvider";

export function ImageInspector({
  caseId,
  resourceType,
  resourceId,
}: {
  caseId: string;
  resourceType: string;
  resourceId: string;
}) {
  const { m } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [preview, setPreview] = useState<Row | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [channel, setChannel] = useState("RGB");
  const [viewBit, setViewBit] = useState(-1);
  const [dimension, setDimension] = useState(1536);
  const [zoom, setZoom] = useState(100);
  const [channels, setChannels] = useState("RGB");
  const [bit, setBit] = useState(0);
  const [order, setOrder] = useState("MSB_FIRST");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(512);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function run(action: "PREVIEW" | "EXTRACT") {
    const revision = ++request.current;
    setBusy(true);
    setError(null);
    if (action === "PREVIEW") setPreview(null);
    else setResult(null);
    try {
      const value = await gateway.call("media.inspect", {
        case_id: caseId,
        resource_type: resourceType,
        resource_id: resourceId,
        action,
        channel,
        bit: action === "PREVIEW" ? (viewBit < 0 ? null : viewBit) : bit,
        channels,
        bit_order: order,
        pixel_offset: offset,
        byte_limit: limit,
        max_dimension: dimension,
      });
      if (revision !== request.current) return;
      if (action === "PREVIEW") setPreview(value);
      else setResult(value);
    } catch (err) {
      if (revision === request.current) setError(err);
    } finally {
      if (revision === request.current) setBusy(false);
    }
  }
  const valid =
    /^[RGBA]{1,4}$/.test(channels) &&
    new Set(channels).size === channels.length &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset < 25000000 &&
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= 65536;
  return (
    <>
      <button
        onClick={() => {
          dialog.current?.showModal();
          if (!preview) void run("PREVIEW");
        }}
      >
        {m.tools.image.open}
      </button>
      <dialog
        className="image-dialog"
        ref={dialog}
        aria-labelledby="image-inspector-title"
      >
        <header>
          <h2 id="image-inspector-title">{m.tools.image.open}</h2>
          <button onClick={() => dialog.current?.close()}>
            {m.panels.form.close}
          </button>
        </header>
        <p className="muted small">{m.tools.image.intro}</p>
        <fieldset disabled={busy} className="image-controls">
          <legend>{m.tools.image.display.legend}</legend>
          <label>
            {m.tools.image.display.channel}
            <select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setPreview(null);
              }}
            >
              {["RGB", "R", "G", "B", "A"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            {m.tools.image.display.bitPlane}
            <select
              value={viewBit}
              onChange={(e) => {
                setViewBit(Number(e.target.value));
                setPreview(null);
              }}
            >
              <option value={-1}>{m.tools.image.display.allValues}</option>
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i} value={i}>
                  bit {i}
                  {i === 0 ? " · LSB" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {m.tools.image.display.maxSize}
            <select
              value={dimension}
              onChange={(e) => {
                setDimension(Number(e.target.value));
                setPreview(null);
              }}
            >
              {[256, 1536, 4096].map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void run("PREVIEW")}>
            {m.tools.image.display.show}
          </button>
          <label>
            {m.tools.image.display.zoom}
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[25, 50, 100, 200, 400, 800].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {busy && <Loading />}
        {error != null && <ErrorState error={error} />}
        {preview && (
          <>
            <p className="small">
              {preview.format} · {preview.width} × {preview.height} ·{" "}
              {preview.color_mode}
              {preview.is_resized
                ? m.tools.image.resized(
                    preview.preview_width,
                    preview.preview_height,
                  )
                : m.tools.image.original}
            </p>
            <div className="image-viewport">
              <img
                alt={m.tools.image.alt(
                  `${preview.channel}${preview.bit == null ? "" : ` bit ${preview.bit}`}`,
                )}
                src={preview.image_url}
                style={{ width: (preview.preview_width * zoom) / 100 }}
              />
            </div>
            <p className="small image-hash">
              {m.tools.image.sourceHash(preview.source_sha256)}
            </p>
          </>
        )}
        <fieldset disabled={busy} className="image-controls">
          <legend>{m.tools.image.extract.legend}</legend>
          <label>
            {m.tools.image.extract.channelOrder}
            <input
              value={channels}
              maxLength={4}
              onChange={(e) => setChannels(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            {m.tools.image.extract.bit}
            <select
              value={bit}
              onChange={(e) => setBit(Number(e.target.value))}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i} value={i}>
                  bit {i}
                  {i === 0 ? " · LSB" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {m.tools.image.extract.byteOrder}
            <select value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="MSB_FIRST">
                {m.tools.image.extract.msbFirst}
              </option>
              <option value="LSB_FIRST">
                {m.tools.image.extract.lsbFirst}
              </option>
            </select>
          </label>
          <label>
            {m.tools.image.extract.startPixel}
            <input
              type="number"
              min={0}
              max={24999999}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
          </label>
          <label>
            {m.tools.image.extract.maxBytes}
            <input
              type="number"
              min={1}
              max={65536}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>
          <button disabled={!valid} onClick={() => void run("EXTRACT")}>
            {m.tools.image.extract.run}
          </button>
        </fieldset>
        <p className="muted small">{m.tools.image.hint}</p>
        {result && (
          <section
            className="image-extraction"
            aria-label={m.tools.image.result.label}
          >
            <h3>
              {m.tools.image.result.title} <Badge value="DERIVED_ANALYSIS" />
            </h3>
            <p>
              {m.tools.image.result.summary(
                result.channels,
                result.bit,
                result.bit_order === "MSB_FIRST"
                  ? m.tools.image.result.msb
                  : m.tools.image.result.lsb,
                result.pixel_offset,
                result.returned_bytes,
                result.available_bytes,
                result.has_more
                  ? m.tools.image.result.more
                  : m.tools.image.result.end,
              )}
            </p>
            <label>
              {m.tools.image.result.text}
              <textarea
                readOnly
                rows={6}
                value={String(result.text).replace(
                  /[\x00-\x08\x0b-\x1f\x7f]/g,
                  "·",
                )}
              />
            </label>
            <p className="muted small">{m.tools.image.result.controlNote}</p>
            <details>
              <summary>{m.tools.image.result.hex}</summary>
              <pre>{result.hex}</pre>
            </details>
            <details>
              <summary>{m.tools.image.result.conditions}</summary>
              <Fields
                value={Object.fromEntries(
                  Object.entries(result).filter(
                    ([key]) => !["text", "hex"].includes(key),
                  ),
                )}
              />
            </details>
            <p className="small">
              {m.tools.image.result.saved(result.export_relative_path)}
            </p>
            <button
              onClick={async () => {
                try {
                  if (window.apex) unwrap(await window.apex.openExports());
                } catch (err) {
                  setError(err);
                }
              }}
            >
              {m.tools.image.result.openFolder}
            </button>
          </section>
        )}
      </dialog>
    </>
  );
}
