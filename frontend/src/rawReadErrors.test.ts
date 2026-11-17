import { expect, it } from "vitest";
import { enUS } from "./locales/en-US";
import { koKR } from "./locales/ko-KR";

// Read errors the speech pre-check passes through; each needs words, not a bare code.
it.each([
  "RAW_LOCATOR_UNSUPPORTED",
  "RAW_SOURCE_OUTSIDE_EVIDENCE",
  "RAW_SOURCE_CHANGED",
  "RAW_SOURCE_UNAVAILABLE",
  "RAW_READ_LIMIT_EXCEEDED",
])("explains %s in both languages", (code) => {
  for (const errors of [koKR.errors, enUS.errors])
    expect(Object.hasOwn(errors, code)).toBe(true);
});

// OCR and speech jobs both end with this code when the bytes cannot be decoded.
it("words a decode failure for audio as well as images", () => {
  expect(koKR.errors.MEDIA_DECODE_FAILED).not.toContain("이미지");
  expect(enUS.errors.MEDIA_DECODE_FAILED).not.toMatch(/image/i);
});
