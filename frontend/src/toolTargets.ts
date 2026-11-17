import type { Row } from "./gateway";

// Mirrors src/apex_desktop/tool_targets.py; the engine re-checks every call.
const IMAGE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "tif",
  "tiff",
  "bmp",
  "webp",
]);
const AUDIO_VIDEO = new Set([
  ...["wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "amr"],
  ...["mp4", "m4v", "mov", "mkv", "avi", "webm", "wmv", "3gp"],
]);
const extension = (node: Row | null) =>
  String(node?.extension ?? "")
    .toLowerCase()
    .replace(/^\./, "");
const mime = (node: Row | null) =>
  String(node?.mime_candidate ?? "").toLowerCase();

export const isImageFile = (node: Row | null) =>
  extension(node) === "" ||
  IMAGE.has(extension(node)) ||
  mime(node).startsWith("image/");
export const isAudioVideoFile = (node: Row | null) =>
  extension(node) === "" ||
  AUDIO_VIDEO.has(extension(node)) ||
  mime(node).startsWith("audio/") ||
  mime(node).startsWith("video/");
