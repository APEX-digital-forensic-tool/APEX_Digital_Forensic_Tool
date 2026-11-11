import type { Messages } from "../ko-KR";

export const machine: Messages["machine"] = {
  errorReasons: {
    EMPTY: "Settings are empty",
    JSON_SYNTAX: "JSON syntax error",
    ENCODING: "Encoding is not UTF-8",
    NOT_OBJECT: "Settings are not an object",
    INVALID_FIELDS: "Fields or values that are not allowed",
    UNREADABLE: "File cannot be read",
  },
  title: "Local OCR and speech recognition settings",
  privacy:
    "The source is never sent externally. Installed analyzers and local models are used.",
  sttIntro:
    "STT converts recorded speech to text. It uses a local speech recognition model, not an API key. The multilingual model bundled with the installer analyzes Korean and English offline. No separate account or download is needed.",
  readiness: "Local feature readiness",
  bundledLabel: "Bundled STT model:",
  bundledModelName: "Whisper base · Multilingual (incl. Korean and English)",
  noBundled:
    "No bundled model · When running from source, prepare the assets or choose a model",
  ffmpegLabel: "FFmpeg for video frames:",
  ffprobeLabel: "ffprobe for video and audio information:",
  ready: "Ready",
  notReady: "Needs setup",
  dpapiLabel: "DPAPI decryption engine:",
  dpapiReady: "Ready · The target's keys and credentials are needed separately",
  dpapiMissing: "Library needs setup",
  managed:
    "These settings are managed by an environment variable. Change them in the runtime environment.",
  settingsError: (reason: string, fields: string) =>
    `The saved analyzer settings could not be read: ${reason}${fields}. OCR and STT will not run until the settings are restored.`,
  resetAction: "Preserve the damaged settings and restore defaults",
  fixEnv:
    "Fix the APEX_DESKTOP_MACHINE_CONFIG value in the runtime environment.",
  preserved: (file: string) =>
    `The previous settings file was preserved as ${file}. Case and evidence data were not changed.`,
  legend: "Analyzers and models",
  ocr: "Text recognition",
  ocrAuto: "Automatically choose an available analyzer",
  pickTessdata: "Choose OCR language model folder",
  defaultTessdata: "Default language model path",
  stt: "Speech recognition",
  pickModel: "Choose speech model",
  useBundled: "Use the bundled multilingual model",
  noModel: "No model set",
  fasterWhisperHelp:
    "To use a larger model, choose the whole folder of a Faster Whisper/CTranslate2 model. It needs model.bin, config.json, tokenizer.json and the vocabulary file. Use a multilingual model for Korean. Models whose names end in .en are English-only.",
  whisperCppHelp:
    "A whisper.cpp model file and the whisper-cli executable on PATH are required. The default Faster Whisper needs no separate executable.",
  restoreBundled: "Restore the bundled model",
  clearModel: "Clear speech model",
  save: "Save analyzer settings",
  sttReady: "Saved STT settings: analyzer and model files are ready",
  sttNotReady: "Saved STT settings: the model or analyzer needs setup",
  runnable: "Runtime availability",
};
