// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish } from "../i18n/testing";
import { I18nProvider } from "../i18n/I18nProvider";
import { createDemoBridge } from "../demoBridge";
import { SetupApp } from "./SetupApp";

afterEach(() => {
  cleanup();
  delete window.apex;
});

it("walks the five steps and finishes", async () => {
  const done = vi.fn(async () => ({ ok: true as const, data: null }));
  window.apex = { ...createDemoBridge(), completeSetup: done };
  render(
    <I18nProvider initialLocale="ko-KR">
      <SetupApp />
    </I18nProvider>,
  );
  expect(screen.getByText("1 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "English" }));
  expect(
    screen.getByRole("heading", { level: 1, name: "Set up APEX" }),
  ).toBeTruthy();
  expect(localStorage.getItem("apex.locale")).toBe("en-US");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(
    screen.getByRole("heading", { level: 2, name: "AI connection" }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "OCR and speech recognition",
    }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(
    screen.getByRole("heading", { level: 2, name: "Server account" }),
  ).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(done).toHaveBeenCalledOnce();
  expect(localStorage.getItem("apex.examinerName")).toBe("Kim");
});

it("goes back without losing what was entered", async () => {
  window.apex = createDemoBridge();
  renderInEnglish(<SetupApp />);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Examiner name"), "Kim");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    (screen.getByLabelText("Examiner name") as HTMLInputElement).value,
  ).toBe("Kim");
});

it("stays on the last step and reports when finishing fails", async () => {
  window.apex = {
    ...createDemoBridge(),
    completeSetup: async () => ({
      ok: false as const,
      error: { code: "DESKTOP_CONNECTION_FAILED" },
    }),
  };
  renderInEnglish(<SetupApp />);
  for (const name of ["Next", "Next", "Skip", "Next"])
    await userEvent.click(screen.getByRole("button", { name }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("5 / 5")).toBeTruthy();
});
