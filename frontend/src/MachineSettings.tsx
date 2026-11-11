import { useEffect, useState } from "react";
import { gateway, unwrap, type Row } from "./gateway";
import { ErrorState, Fields, Loading } from "./ui";
import { useI18n } from "./i18n/I18nProvider";
import { lookup } from "./i18n/catalog";

export function MachineSettings() {
  const { locale, m } = useI18n();
  const [data, setData] = useState<Row | null>(null);
  const [settings, setSettings] = useState<Row>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    gateway
      .call("machine.capabilities")
      .then((r) => {
        if (live) {
          setData(r);
          setSettings(r.settings);
        }
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, []);
  async function pick(key: string, kind: "file" | "directory") {
    if (!window.apex) return;
    try {
      const picked = unwrap(await window.apex.pick(kind, locale));
      if (picked)
        setSettings((s) => ({
          ...s,
          [key + "_reference"]: picked.reference,
          [key + "_label"]: picked.name,
        }));
    } catch (e) {
      setError(e);
    }
  }
  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.call("machine.reset");
      setData(result);
      setSettings(result.settings);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.call("machine.configure", {
        ocr_provider: settings.ocr_provider,
        stt_provider: settings.stt_provider,
        model_reference: settings.model_reference,
        tessdata_reference: settings.tessdata_reference,
      });
      setData(result);
      setSettings(result.settings);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h3>{m.machine.title}</h3>
      <p>{m.machine.privacy}</p>
      <p>{m.machine.sttIntro}</p>
      {error != null && <ErrorState error={error} />}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <h4>{m.machine.readiness}</h4>
          <ul>
            <li>
              {m.machine.bundledLabel}{" "}
              {/* The engine's model name is Korean-only; show the catalog's. */}
              {data.bundled_stt?.available
                ? m.machine.bundledModelName
                : m.machine.noBundled}
            </li>
            <li>
              {m.machine.ffmpegLabel}{" "}
              {data.media?.ffmpeg?.is_available
                ? m.machine.ready
                : m.machine.notReady}
            </li>
            <li>
              {m.machine.ffprobeLabel}{" "}
              {data.media?.ffprobe?.is_available
                ? m.machine.ready
                : m.machine.notReady}
            </li>
            <li>
              {m.machine.dpapiLabel}{" "}
              {data.dpapi?.runtime_status === "IMPLEMENTED_RUNTIME"
                ? m.machine.dpapiReady
                : m.machine.dpapiMissing}
            </li>
          </ul>
          {data.managed && <p>{m.machine.managed}</p>}
          {data.settings_error && (
            <div role="alert" className="settings-error">
              <p>
                {m.machine.settingsError(
                  lookup(m.machine.errorReasons, data.settings_error.reason),
                  data.settings_error.fields?.length
                    ? ` (${data.settings_error.fields.join(", ")})`
                    : "",
                )}
              </p>
              {data.settings_error.resettable ? (
                <button disabled={busy} onClick={() => void reset()}>
                  {m.machine.resetAction}
                </button>
              ) : (
                <p>{m.machine.fixEnv}</p>
              )}
            </div>
          )}
          {data.preserved_settings_file && (
            <p role="status">
              {m.machine.preserved(data.preserved_settings_file)}
            </p>
          )}
          <fieldset disabled={busy || data.managed}>
            <legend>{m.machine.legend}</legend>
            <label>
              {m.machine.ocr}
              <select
                value={settings.ocr_provider}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, ocr_provider: e.target.value }))
                }
              >
                <option value="auto">{m.machine.ocrAuto}</option>
                <option value="tesseract">Tesseract</option>
                <option value="rapidocr">RapidOCR</option>
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void pick("tessdata", "directory")}
            >
              {m.machine.pickTessdata}
            </button>
            <p>
              {settings.tessdata_label ??
                settings.tessdata_path ??
                m.machine.defaultTessdata}
            </p>
            <label>
              {m.machine.stt}
              <select
                value={settings.stt_provider}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    stt_provider: e.target.value,
                    model_reference: null,
                    model_label: undefined,
                    stt_model_path: null,
                  }))
                }
              >
                <option value="faster-whisper">Faster Whisper</option>
                <option value="whisper.cpp">whisper.cpp</option>
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void pick(
                  "model",
                  settings.stt_provider === "whisper.cpp"
                    ? "file"
                    : "directory",
                )
              }
            >
              {m.machine.pickModel}
            </button>
            <p>
              {settings.model_label ??
                settings.stt_model_path ??
                (settings.stt_provider === "faster-whisper" &&
                data.bundled_stt?.available
                  ? m.machine.useBundled
                  : m.machine.noModel)}
            </p>
            {settings.stt_provider === "faster-whisper" ? (
              <p>{m.machine.fasterWhisperHelp}</p>
            ) : (
              <p>{m.machine.whisperCppHelp}</p>
            )}
            <button
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  model_reference: null,
                  model_label: undefined,
                  stt_model_path: null,
                }))
              }
            >
              {settings.stt_provider === "faster-whisper"
                ? m.machine.restoreBundled
                : m.machine.clearModel}
            </button>
            <button disabled={busy} onClick={() => void save()}>
              {m.machine.save}
            </button>
          </fieldset>
          <p role="status">
            {data.stt?.is_available
              ? m.machine.sttReady
              : m.machine.sttNotReady}
          </p>
          <details>
            <summary>{m.machine.runnable}</summary>
            <Fields
              value={{
                ocr: data.ocr,
                stt: data.stt,
                media: data.media,
                dpapi: data.dpapi,
              }}
            />
          </details>
        </>
      )}
    </div>
  );
}
