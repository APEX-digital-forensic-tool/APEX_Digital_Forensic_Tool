// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSettings } from "./LanguageSettings";
import { I18nProvider } from "./i18n/I18nProvider";
import { messagesFor } from "./i18n/catalog";
import { renderInEnglish } from "./i18n/testing";

afterEach(cleanup);

it("switches the display language and remembers it", async () => {
  render(
    <I18nProvider initialLocale="ko-KR">
      <LanguageSettings />
    </I18nProvider>,
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "언어" }),
    "en-US",
  );
  expect(screen.getByRole("heading", { name: "Language" })).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("apex.locale")).toBe("en-US");
});

it("names each language in its own language", () => {
  renderInEnglish(<LanguageSettings />);
  expect(
    screen
      .getAllByRole("option")
      .map((o) => [o.getAttribute("value"), o.textContent]),
  ).toEqual([
    ["ko-KR", "한국어"],
    ["en-US", "English"],
  ]);
});

it("localizes native picker text and falls back to Korean", () => {
  expect(messagesFor("en-US").native.pickTitle).toBe(
    "Select evidence to analyze",
  );
  expect(messagesFor("bogus").native.pickTitle).toBe("분석할 증거 선택");
});
