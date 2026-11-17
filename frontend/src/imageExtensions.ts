/** Mirrors RAW_IMAGE_FORMATS in src/apex_forensic/domain/raw_image_extensions.py; a Python test checks it. */
export const RAW_IMAGE_EXTENSIONS = ["dd", "img", "raw", "001"];
/** Containers the engine opens with a dedicated reader. */
export const CONTAINER_IMAGE_EXTENSIONS = ["e01", "vhd", "vhdx"];
export const IMAGE_EXTENSIONS = [
  ...CONTAINER_IMAGE_EXTENSIONS,
  ...RAW_IMAGE_EXTENSIONS,
];
