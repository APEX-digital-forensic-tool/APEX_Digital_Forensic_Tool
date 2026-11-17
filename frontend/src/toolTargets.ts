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
  IMAGE.has(extension(node)) ||
  mime(node).startsWith("image/") ||
  (!!node && !extension(node) && !mime(node));
export const isAudioVideoFile = (node: Row | null) =>
  AUDIO_VIDEO.has(extension(node)) ||
  (!!node && !extension(node) && !mime(node)) ||
  mime(node).startsWith("audio/") ||
  mime(node).startsWith("video/");
