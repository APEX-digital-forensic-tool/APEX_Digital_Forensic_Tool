import type { Row } from "./gateway";

// The engine re-checks every call. Speech has no name gate: the engine judges the bytes.
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
