import rawImageFormats from "../../src/apex_forensic/domain/raw_image_extensions.json";

/** Raw disk images, defined once for the engine and this app. */
export const RAW_IMAGE_EXTENSIONS = Object.keys(rawImageFormats);
/** Containers the engine opens with a dedicated reader. */
export const CONTAINER_IMAGE_EXTENSIONS = ["e01", "vhd", "vhdx"];
export const IMAGE_EXTENSIONS = [
  ...CONTAINER_IMAGE_EXTENSIONS,
  ...RAW_IMAGE_EXTENSIONS,
];
