import React, { type ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { I18nProvider } from "./I18nProvider";

/** Hangul jamo, compatibility jamo and syllables. */
export const HANGUL =
  /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/;

export function renderInEnglish(ui: ReactElement): RenderResult {
  return render(<I18nProvider initialLocale="en-US">{ui}</I18nProvider>);
}
